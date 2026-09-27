import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import './auth.css'
import {
  Boxes,
  CircleDollarSign,
  Home,
  KeyRound,
  LogOut,
  PackagePlus,
  Plus,
  ShieldCheck,
  ShoppingBag,
  TrendingUp,
  UserCircle,
  Users,
  WalletCards,
} from 'lucide-react'
import {
  AuthError,
  changeOwnPassword,
  createUser as createBackendUser,
  getStoredUser,
  listUsers,
  login as loginBackend,
  logout as logoutBackend,
  resetUserPassword,
  setUserActive,
} from './api'
import { currentStockValue, expectedProfit, grossProfit, investedAmount, money, revenue, stockForProduct } from './calculations'
import { clearLocalCache, loadSnapshot, recordSale, saveProductWithBatch } from './db'
import type { AuthUser, Product, Sale, StockBatch, TemporaryPasswordResult, UserAccount, UserRole } from './types'

type View = 'dashboard' | 'inventory' | 'add' | 'sales' | 'users' | 'account'

const uid = () => crypto.randomUUID()

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function App() {
  const [auth, setAuth] = useState<AuthUser | null>(() => getStoredUser())
  const [view, setView] = useState<View>('dashboard')
  const [products, setProducts] = useState<Product[]>([])
  const [batches, setBatches] = useState<StockBatch[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [ready, setReady] = useState(false)
  const [sellProductId, setSellProductId] = useState<string | null>(null)

  async function refresh() {
    try {
      const snapshot = await loadSnapshot()
      setProducts([...snapshot.products].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
      setBatches(snapshot.batches)
      setSales([...snapshot.sales].sort((a, b) => b.soldAt.localeCompare(a.soldAt)))
      setReady(true)
    } catch (error) {
      if (error instanceof AuthError) {
        setAuth(null)
        setProducts([])
        setBatches([])
        setSales([])
        setReady(true)
        return
      }
      throw error
    }
  }

  useEffect(() => {
    if (!auth || auth.mustChangePassword) {
      setReady(true)
      return
    }
    setReady(false)
    refresh().catch((error) => {
      console.error(error)
      setReady(true)
    })
  }, [auth?.id, auth?.mustChangePassword])

  const metrics = useMemo(() => ({
    invested: investedAmount(batches),
    stockValue: currentStockValue(batches),
    revenue: revenue(sales),
    profit: grossProfit(sales),
    expectedProfit: expectedProfit(products, batches),
    stockCount: batches.reduce((sum, batch) => sum + batch.quantityRemaining, 0),
    itemsSold: sales.reduce((sum, sale) => sum + sale.quantity, 0),
  }), [products, batches, sales])

  async function handleLogin(username: string, password: string) {
    const result = await loginBackend(username, password)
    setAuth(result.user)
    setView('dashboard')
  }

  async function handleLogout() {
    try { await logoutBackend() } catch (error) { console.warn(error) }
    await clearLocalCache().catch(console.warn)
    setAuth(null)
    setProducts([])
    setBatches([])
    setSales([])
    setView('dashboard')
  }

  async function handlePasswordChanged() {
    await clearLocalCache().catch(console.warn)
    setAuth(null)
    setProducts([])
    setBatches([])
    setSales([])
    setView('dashboard')
  }

  async function addStock(form: HTMLFormElement) {
    const data = new FormData(form)
    const existingProductId = String(data.get('existingProductId') || '')
    const existingProduct = products.find((item) => item.id === existingProductId)
    const name = String(data.get('name') || '').trim()
    const category = String(data.get('category') || '').trim()
    const sku = String(data.get('sku') || '').trim()
    const quantity = Number(data.get('quantity'))
    const totalCost = Number(data.get('totalCost'))
    const sellingPrice = Number(data.get('sellingPrice'))
    if ((!existingProduct && !name) || quantity <= 0 || totalCost < 0 || sellingPrice < 0) return

    const imageFile = data.get('image') as File | null
    const image = imageFile && imageFile.size > 0 ? await fileToDataUrl(imageFile) : undefined
    const now = new Date().toISOString()
    const product: Product = existingProduct
      ? {
          ...existingProduct,
          category: category || existingProduct.category,
          sku: sku || existingProduct.sku,
          image: image || existingProduct.image,
          defaultSellingPrice: sellingPrice,
        }
      : {
          id: uid(),
          name,
          category: category || 'Jewelry',
          sku: sku || undefined,
          image,
          defaultSellingPrice: sellingPrice,
          createdAt: now,
        }
    const batch: StockBatch = {
      id: uid(),
      productId: product.id,
      quantityPurchased: quantity,
      quantityRemaining: quantity,
      totalPurchaseCost: totalCost,
      unitCost: quantity ? totalCost / quantity : 0,
      purchaseDate: String(data.get('purchaseDate') || now.slice(0, 10)),
      supplier: String(data.get('supplier') || '').trim() || undefined,
      notes: String(data.get('notes') || '').trim() || undefined,
    }
    await saveProductWithBatch(product, batch)
    form.reset()
    await refresh()
    setView('inventory')
  }

  async function makeSale(productId: string, quantity: number, unitSellingPrice: number, paymentMethod: string) {
    const available = stockForProduct(productId, batches)
    if (quantity <= 0 || quantity > available) throw new Error('Quantity exceeds available stock.')

    let remaining = quantity
    let costOfGoods = 0
    const allocations: Sale['allocations'] = []
    const updated = batches.map((batch) => ({ ...batch })).sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate))
    for (const batch of updated) {
      if (batch.productId !== productId || batch.quantityRemaining <= 0 || remaining <= 0) continue
      const used = Math.min(batch.quantityRemaining, remaining)
      batch.quantityRemaining -= used
      remaining -= used
      costOfGoods += used * batch.unitCost
      allocations.push({ batchId: batch.id, quantity: used, unitCost: batch.unitCost })
    }

    const totalAmount = quantity * unitSellingPrice
    const sale: Sale = {
      id: uid(),
      productId,
      quantity,
      unitSellingPrice,
      totalAmount,
      costOfGoods,
      profit: totalAmount - costOfGoods,
      soldAt: new Date().toISOString(),
      paymentMethod,
      allocations,
    }

    await recordSale(sale, updated.filter((batch) => allocations.some((allocation) => allocation.batchId === batch.id)))
    await refresh()
    setSellProductId(null)
  }

  if (!auth) return <LoginScreen onLogin={handleLogin} />
  if (auth.mustChangePassword) return <PasswordChangeScreen auth={auth} required onChanged={handlePasswordChanged} />
  if (!ready) return <div className="splash">Loading Eni's Inventory…</div>

  const isAdmin = auth.role === 'admin'

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">{isAdmin ? 'Admin workspace' : 'Staff workspace'}</span>
          <h1>Eni's Inventory</h1>
        </div>
        <button className="profile-button" onClick={() => setView('account')} aria-label="Account">
          <span className="avatar">{auth.displayName.slice(0, 1).toUpperCase()}</span>
          <span className="profile-copy"><strong>{auth.displayName}</strong><small>{auth.role}</small></span>
        </button>
      </header>

      <main className="main-content">
        {view === 'dashboard' && <Dashboard isAdmin={isAdmin} metrics={metrics} products={products} batches={batches} sales={sales} onSell={setSellProductId} />}
        {view === 'inventory' && <Inventory isAdmin={isAdmin} products={products} batches={batches} onSell={setSellProductId} onAdd={() => setView('add')} />}
        {view === 'add' && <AddStock products={products} onSubmit={addStock} />}
        {view === 'sales' && <Sales isAdmin={isAdmin} products={products} sales={sales} />}
        {view === 'users' && isAdmin && <UserManagement currentUser={auth} />}
        {view === 'account' && <Account auth={auth} onLogout={handleLogout} onPasswordChanged={handlePasswordChanged} />}
      </main>

      <nav className="bottom-nav" aria-label="Primary navigation">
        <NavButton active={view === 'dashboard'} label="Home" icon={<Home size={21} />} onClick={() => setView('dashboard')} />
        <NavButton active={view === 'inventory'} label="Inventory" icon={<Boxes size={21} />} onClick={() => setView('inventory')} />
        <button className="add-fab" onClick={() => setView('add')} aria-label="Add stock"><Plus size={28} /></button>
        <NavButton active={view === 'sales'} label="Sales" icon={<ShoppingBag size={21} />} onClick={() => setView('sales')} />
        {isAdmin
          ? <NavButton active={view === 'users'} label="Users" icon={<Users size={21} />} onClick={() => setView('users')} />
          : <NavButton active={view === 'account'} label="Account" icon={<UserCircle size={21} />} onClick={() => setView('account')} />}
      </nav>

      {sellProductId && (
        <SellModal
          product={products.find((product) => product.id === sellProductId)!}
          available={stockForProduct(sellProductId, batches)}
          onClose={() => setSellProductId(null)}
          onConfirm={makeSale}
        />
      )}
    </div>
  )
}

function LoginScreen({ onLogin }: { onLogin: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      await onLogin(username, password)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to sign in.'
      setError(message === 'INVALID_CREDENTIALS' ? 'Incorrect username or password.' : message)
    } finally {
      setLoading(false)
    }
  }

  return <main className="auth-page">
    <section className="auth-card">
      <div className="auth-brand"><span className="auth-logo"><ShoppingBag size={28}/></span><div><span className="eyebrow">Secure inventory</span><h1>Eni's Inventory</h1></div></div>
      <div><h2>Welcome back</h2><p className="muted">Sign in with your Admin or Staff account.</p></div>
      <form className="auth-form" onSubmit={submit}>
        <div className="field"><label>Username</label><input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required /></div>
        <div className="field"><label>Password</label><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        {error && <p className="error-text">{error}</p>}
        <button className="primary-button large" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </section>
  </main>
}

function PasswordChangeScreen({ auth, required = false, onChanged }: { auth: AuthUser; required?: boolean; onChanged: () => Promise<void> }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (newPassword !== confirmPassword) { setError('The new passwords do not match.'); return }
    if (newPassword.length < 8) { setError('Use at least 8 characters.'); return }
    setLoading(true)
    setError('')
    try {
      await changeOwnPassword(currentPassword, newPassword)
      await onChanged()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not change password.'
      setError(message === 'CURRENT_PASSWORD_INCORRECT' ? 'Your current password is incorrect.' : message)
    } finally {
      setLoading(false)
    }
  }

  return <main className={required ? 'auth-page' : ''}>
    <section className={required ? 'auth-card' : 'form-card'}>
      <div className="auth-brand"><span className="auth-logo"><KeyRound size={26}/></span><div><span className="eyebrow">{required ? 'First sign in' : 'Security'}</span><h2>{required ? 'Create your password' : 'Change password'}</h2></div></div>
      <p className="muted">{required ? `Hi ${auth.displayName}. Replace your temporary password before continuing.` : 'Changing your password will sign you out on all devices.'}</p>
      <form className="auth-form" onSubmit={submit}>
        <div className="field"><label>Current password</label><input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required /></div>
        <div className="field"><label>New password</label><input type="password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required /></div>
        <div className="field"><label>Confirm new password</label><input type="password" minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required /></div>
        {error && <p className="error-text">{error}</p>}
        <button className="primary-button large" disabled={loading}>{loading ? 'Updating…' : 'Update password'}</button>
      </form>
    </section>
  </main>
}

function Dashboard({ isAdmin, metrics, products, batches, sales, onSell }: {
  isAdmin: boolean
  metrics: { invested: number; stockValue: number; revenue: number; profit: number; expectedProfit: number; stockCount: number; itemsSold: number }
  products: Product[]
  batches: StockBatch[]
  sales: Sale[]
  onSell: (id: string) => void
}) {
  const adminCards = [
    ['Money invested', money(metrics.invested), <WalletCards size={20} />],
    ['Sales revenue', money(metrics.revenue), <CircleDollarSign size={20} />],
    ['Gross profit', money(metrics.profit), <TrendingUp size={20} />],
    ['Stock value', money(metrics.stockValue), <Boxes size={20} />],
  ] as const
  const staffCards = [
    ['Current stock', `${metrics.stockCount} items`, <Boxes size={20} />],
    ['Items sold', `${metrics.itemsSold}`, <ShoppingBag size={20} />],
    ['Sales revenue', money(metrics.revenue), <CircleDollarSign size={20} />],
    ['Products', `${products.length}`, <PackagePlus size={20} />],
  ] as const
  const cards = isAdmin ? adminCards : staffCards
  const recent = sales.slice(0, 4)

  return <section className="stack">
    <div className="hero-card">
      <div>
        <span className="eyebrow light">Current stock</span>
        <strong>{metrics.stockCount} items</strong>
        <p>{isAdmin ? `Expected profit on remaining stock: ${money(metrics.expectedProfit)}` : 'Ready to sell across your active inventory.'}</p>
      </div>
      <PackagePlus size={42} />
    </div>
    <div className="metric-grid">
      {cards.map(([label, value, icon]) => <article className="metric-card" key={label}><span className="metric-icon">{icon}</span><small>{label}</small><strong>{value}</strong></article>)}
    </div>
    <div className="section-heading"><div><span className="eyebrow">Quick sell</span><h2>In stock</h2></div></div>
    <div className="horizontal-products">
      {products.filter((product) => stockForProduct(product.id, batches) > 0).slice(0, 5).map((product) => (
        <button className="mini-product" key={product.id} onClick={() => onSell(product.id)}><ProductImage product={product}/><span>{product.name}</span><small>{stockForProduct(product.id, batches)} left</small></button>
      ))}
      {products.length === 0 && <Empty message="Add your first stock batch to start tracking the business." />}
    </div>
    <div className="section-heading"><div><span className="eyebrow">Latest activity</span><h2>Recent sales</h2></div></div>
    <div className="list-card">
      {recent.map((sale) => {
        const product = products.find((item) => item.id === sale.productId)
        return <div className="sale-row" key={sale.id}><div><strong>{product?.name || 'Product'}</strong><small>{new Date(sale.soldAt).toLocaleString()}{sale.createdByName ? ` · ${sale.createdByName}` : ''}</small></div><div className="right"><strong>{money(sale.totalAmount)}</strong>{isAdmin && <small className={sale.profit >= 0 ? 'positive' : 'negative'}>{money(sale.profit)} profit</small>}</div></div>
      })}
      {recent.length === 0 && <Empty message="Sales you record will appear here." />}
    </div>
  </section>
}

function Inventory({ isAdmin, products, batches, onSell, onAdd }: { isAdmin: boolean; products: Product[]; batches: StockBatch[]; onSell: (id: string) => void; onAdd: () => void }) {
  const [query, setQuery] = useState('')
  const filtered = products.filter((product) => `${product.name} ${product.category} ${product.sku || ''}`.toLowerCase().includes(query.toLowerCase()))
  return <section className="stack">
    <div className="section-heading"><div><span className="eyebrow">Stock room</span><h2>Inventory</h2></div><button className="secondary-button" onClick={onAdd}><Plus size={17}/> Add</button></div>
    <input className="search" placeholder="Search product, category or SKU…" value={query} onChange={(event) => setQuery(event.target.value)} />
    <div className="product-grid">
      {filtered.map((product) => {
        const qty = stockForProduct(product.id, batches)
        const productBatches = batches.filter((batch) => batch.productId === product.id)
        const averageCost = productBatches.length ? productBatches.reduce((sum, batch) => sum + batch.unitCost * batch.quantityRemaining, 0) / Math.max(1, qty) : 0
        return <article className="product-card" key={product.id}><ProductImage product={product}/><div className="product-card-body"><span className="status-pill">{qty > 0 ? `${qty} in stock` : 'Sold out'}</span><h3>{product.name}</h3><small>{product.category}</small><div className={`price-line ${isAdmin ? '' : 'single'}`}>{isAdmin && <div><small>Cost</small><strong>{money(averageCost)}</strong></div>}<div><small>Selling</small><strong>{money(product.defaultSellingPrice)}</strong></div></div><button className="primary-button" disabled={qty === 0} onClick={() => onSell(product.id)}>Record sale</button></div></article>
      })}
      {filtered.length === 0 && <Empty message="No inventory items match this view." />}
    </div>
  </section>
}

function AddStock({ products, onSubmit }: { products: Product[]; onSubmit: (form: HTMLFormElement) => Promise<void> }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    setSaving(true); setError('')
    try { await onSubmit(form) } catch (err) { setError(err instanceof Error ? err.message : 'Could not save stock.') } finally { setSaving(false) }
  }
  return <section className="stack"><div className="section-heading"><div><span className="eyebrow">New purchase</span><h2>Add stock batch</h2></div></div><form className="form-card" onSubmit={submit}>
    {products.length > 0 && <div className="field"><label>Restock an existing product</label><select name="existingProductId" defaultValue=""><option value="">Create a new product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select><small className="field-hint">Choose an existing item to add this purchase as another batch.</small></div>}
    <label className="image-upload"><input type="file" name="image" accept="image/*" capture="environment"/><PackagePlus size={30}/><span>Add product photo</span><small>Camera or gallery · optional when restocking</small></label>
    <div className="field"><label>Product name</label><input name="name" placeholder="Required only for a new product" /></div>
    <div className="field-row"><div className="field"><label>Category</label><input name="category" placeholder="Defaults to Jewelry" /></div><div className="field"><label>SKU</label><input name="sku" placeholder="Optional" /></div></div>
    <div className="field-row"><div className="field"><label>Quantity</label><input name="quantity" required type="number" min="1" inputMode="numeric" /></div><div className="field"><label>Total purchase cost</label><input name="totalCost" required type="number" min="0" step="0.01" inputMode="decimal" /></div></div>
    <div className="field"><label>Selling price per item</label><input name="sellingPrice" required type="number" min="0" step="0.01" inputMode="decimal" /></div>
    <div className="field"><label>Purchase date</label><input name="purchaseDate" type="date" defaultValue={new Date().toISOString().slice(0,10)} /></div>
    <div className="field"><label>Supplier</label><input name="supplier" placeholder="Optional" /></div>
    <div className="field"><label>Notes</label><textarea name="notes" rows={3} placeholder="Optional batch notes" /></div>
    {error && <p className="error-text">{error}</p>}
    <button className="primary-button large" disabled={saving}>{saving ? 'Saving…' : 'Save stock batch'}</button>
  </form></section>
}

function Sales({ isAdmin, products, sales }: { isAdmin: boolean; products: Product[]; sales: Sale[] }) {
  return <section className="stack"><div className="section-heading"><div><span className="eyebrow">Transaction history</span><h2>Sales</h2></div></div><div className="list-card">
    {sales.map((sale) => { const product = products.find((item) => item.id === sale.productId); return <div className="sale-row" key={sale.id}><div><strong>{product?.name || 'Product'} × {sale.quantity}</strong><small>{new Date(sale.soldAt).toLocaleString()} · {sale.paymentMethod || 'Payment not set'}{sale.createdByName ? ` · ${sale.createdByName}` : ''}</small></div><div className="right"><strong>{money(sale.totalAmount)}</strong>{isAdmin && <small className={sale.profit >= 0 ? 'positive' : 'negative'}>{money(sale.profit)} profit</small>}</div></div> })}
    {sales.length === 0 && <Empty message="No sales recorded yet." />}
  </div></section>
}

function UserManagement({ currentUser }: { currentUser: AuthUser }) {
  const [users, setUsers] = useState<UserAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [credentials, setCredentials] = useState<TemporaryPasswordResult | null>(null)

  async function refreshUsers() {
    setLoading(true)
    try { setUsers(await listUsers()) } catch (err) { setError(err instanceof Error ? err.message : 'Could not load users.') } finally { setLoading(false) }
  }
  useEffect(() => { refreshUsers() }, [])

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setSaving(true); setError(''); setCredentials(null)
    try {
      const result = await createBackendUser(String(data.get('username') || ''), String(data.get('displayName') || ''), String(data.get('role') || 'staff') as UserRole)
      setCredentials(result)
      form.reset()
      await refreshUsers()
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create user.') } finally { setSaving(false) }
  }

  async function toggle(user: UserAccount) {
    setError('')
    try { await setUserActive(user.id, !user.active); await refreshUsers() } catch (err) { setError(err instanceof Error ? err.message : 'Could not update user.') }
  }

  async function reset(user: UserAccount) {
    if (!window.confirm(`Reset ${user.displayName}'s password? Their current sessions will be signed out.`)) return
    setError(''); setCredentials(null)
    try { setCredentials(await resetUserPassword(user.id)); await refreshUsers() } catch (err) { setError(err instanceof Error ? err.message : 'Could not reset password.') }
  }

  return <section className="stack">
    <div className="section-heading"><div><span className="eyebrow">Admin only</span><h2>Users & access</h2></div><ShieldCheck size={26}/></div>
    <form className="form-card" onSubmit={create}>
      <h3 className="card-title">Create account</h3>
      <div className="field-row"><div className="field"><label>Display name</label><input name="displayName" required placeholder="e.g. Chidinma" /></div><div className="field"><label>Username</label><input name="username" required placeholder="e.g. chidinma" /></div></div>
      <div className="field"><label>Role</label><select name="role" defaultValue="staff"><option value="staff">Staff</option><option value="admin">Admin</option></select></div>
      <button className="primary-button" disabled={saving}>{saving ? 'Creating…' : 'Create user'}</button>
      {error && <p className="error-text">{error}</p>}
    </form>
    {credentials && <div className="credential-card"><KeyRound size={24}/><div><strong>Temporary login created</strong><p>Username: <b>{credentials.user.username}</b></p><p>Password: <code>{credentials.temporaryPassword}</code></p><small>Share it privately. The user must change it after first login.</small></div></div>}
    <div className="list-card">
      {loading && <div className="empty-state"><p>Loading users…</p></div>}
      {!loading && users.map((user) => <div className="user-row" key={user.id}><div className="user-main"><span className={`role-badge ${user.role}`}>{user.role}</span><div><strong>{user.displayName}</strong><small>@{user.username} · {user.active ? 'Active' : 'Disabled'}{user.mustChangePassword ? ' · Password change required' : ''}</small></div></div><div className="user-actions"><button className="text-button compact" onClick={() => reset(user)}>Reset password</button><button className="secondary-button" disabled={user.id === currentUser.id} onClick={() => toggle(user)}>{user.active ? 'Disable' : 'Enable'}</button></div></div>)}
    </div>
  </section>
}

function Account({ auth, onLogout, onPasswordChanged }: { auth: AuthUser; onLogout: () => Promise<void>; onPasswordChanged: () => Promise<void> }) {
  return <section className="stack">
    <div className="account-card"><span className="avatar large-avatar">{auth.displayName.slice(0,1).toUpperCase()}</span><div><span className={`role-badge ${auth.role}`}>{auth.role}</span><h2>{auth.displayName}</h2><p>@{auth.username}</p></div></div>
    <PasswordChangeScreen auth={auth} onChanged={onPasswordChanged}/>
    <button className="secondary-button logout-button" onClick={onLogout}><LogOut size={18}/> Sign out</button>
  </section>
}

function SellModal({ product, available, onClose, onConfirm }: { product: Product; available: number; onClose: () => void; onConfirm: (productId: string, quantity: number, price: number, payment: string) => Promise<void> }) {
  const [quantity, setQuantity] = useState(1)
  const [price, setPrice] = useState(product.defaultSellingPrice)
  const [payment, setPayment] = useState('Transfer')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); setError(''); try { await onConfirm(product.id, quantity, price, payment) } catch (err) { setError(err instanceof Error ? err.message : 'Could not record sale.') } finally { setSaving(false) } }
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><div className="modal-handle"/><div className="modal-title"><div><span className="eyebrow">Record sale</span><h2>{product.name}</h2></div><span className="status-pill">{available} available</span></div>
    <div className="field"><label>Quantity</label><input type="number" min="1" max={available} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))}/></div>
    <div className="field"><label>Selling price per item</label><input type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(Number(event.target.value))}/></div>
    <div className="field"><label>Payment</label><select value={payment} onChange={(event) => setPayment(event.target.value)}><option>Transfer</option><option>Cash</option><option>POS</option><option>Other</option></select></div>
    <div className="sale-total"><span>Total</span><strong>{money(quantity * price)}</strong></div>
    {error && <p className="error-text">{error}</p>}
    <button className="primary-button large" disabled={saving}>{saving ? 'Recording…' : 'Confirm sale'}</button><button type="button" className="text-button" onClick={onClose}>Cancel</button>
  </form></div>
}

function ProductImage({ product }: { product: Product }) { return product.image ? <img className="product-image" src={product.image} alt="" /> : <div className="product-image placeholder"><ShoppingBag size={30}/></div> }
function Empty({ message }: { message: string }) { return <div className="empty-state"><ShoppingBag size={28}/><p>{message}</p></div> }
function NavButton({ active, label, icon, onClick }: { active: boolean; label: string; icon: ReactNode; onClick: () => void }) { return <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span></button> }
