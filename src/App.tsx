import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { BarChart3, Boxes, CircleDollarSign, Home, PackagePlus, Plus, ShoppingBag, TrendingUp, WalletCards } from 'lucide-react'
import { currentStockValue, expectedProfit, grossProfit, investedAmount, money, revenue, stockForProduct } from './calculations'
import { loadSnapshot, recordSale, saveProductWithBatch } from './db'
import type { Product, Sale, StockBatch } from './types'

type View = 'dashboard' | 'inventory' | 'add' | 'sales'

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
  const [view, setView] = useState<View>('dashboard')
  const [products, setProducts] = useState<Product[]>([])
  const [batches, setBatches] = useState<StockBatch[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [ready, setReady] = useState(false)
  const [sellProductId, setSellProductId] = useState<string | null>(null)

  async function refresh() {
    const snapshot = await loadSnapshot()
    setProducts(snapshot.products.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    setBatches(snapshot.batches)
    setSales(snapshot.sales.sort((a, b) => b.soldAt.localeCompare(a.soldAt)))
    setReady(true)
  }

  useEffect(() => {
    refresh().catch(console.error)
  }, [])

  const metrics = useMemo(() => ({
    invested: investedAmount(batches),
    stockValue: currentStockValue(batches),
    revenue: revenue(sales),
    profit: grossProfit(sales),
    expectedProfit: expectedProfit(products, batches),
    stockCount: batches.reduce((sum, batch) => sum + batch.quantityRemaining, 0),
  }), [products, batches, sales])

  async function addStock(form: HTMLFormElement) {
    const data = new FormData(form)
    const name = String(data.get('name') || '').trim()
    const quantity = Number(data.get('quantity'))
    const totalCost = Number(data.get('totalCost'))
    const sellingPrice = Number(data.get('sellingPrice'))
    if (!name || quantity <= 0 || totalCost < 0 || sellingPrice < 0) return

    const imageFile = data.get('image') as File | null
    const image = imageFile && imageFile.size > 0 ? await fileToDataUrl(imageFile) : undefined
    const now = new Date().toISOString()
    const product: Product = {
      id: uid(),
      name,
      category: String(data.get('category') || 'Jewelry').trim() || 'Jewelry',
      sku: String(data.get('sku') || '').trim() || undefined,
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
    const updated = batches.map((batch) => ({ ...batch }))
      .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate))

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

  if (!ready) return <div className="splash">Loading Eni's Inventory…</div>

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">Personal business tracker</span>
          <h1>Eni's Inventory</h1>
        </div>
        <button className="avatar" aria-label="Profile">E</button>
      </header>

      <main className="main-content">
        {view === 'dashboard' && <Dashboard metrics={metrics} products={products} batches={batches} sales={sales} onSell={setSellProductId} />}
        {view === 'inventory' && <Inventory products={products} batches={batches} onSell={setSellProductId} onAdd={() => setView('add')} />}
        {view === 'add' && <AddStock onSubmit={addStock} />}
        {view === 'sales' && <Sales products={products} sales={sales} />}
      </main>

      <nav className="bottom-nav" aria-label="Primary navigation">
        <NavButton active={view === 'dashboard'} label="Home" icon={<Home size={21} />} onClick={() => setView('dashboard')} />
        <NavButton active={view === 'inventory'} label="Inventory" icon={<Boxes size={21} />} onClick={() => setView('inventory')} />
        <button className="add-fab" onClick={() => setView('add')} aria-label="Add stock"><Plus size={28} /></button>
        <NavButton active={view === 'sales'} label="Sales" icon={<ShoppingBag size={21} />} onClick={() => setView('sales')} />
        <NavButton active={false} label="Reports" icon={<BarChart3 size={21} />} onClick={() => setView('dashboard')} />
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

function Dashboard({ metrics, products, batches, sales, onSell }: {
  metrics: { invested: number; stockValue: number; revenue: number; profit: number; expectedProfit: number; stockCount: number }
  products: Product[]
  batches: StockBatch[]
  sales: Sale[]
  onSell: (id: string) => void
}) {
  const cards = [
    ['Money invested', money(metrics.invested), <WalletCards size={20} />],
    ['Sales revenue', money(metrics.revenue), <CircleDollarSign size={20} />],
    ['Gross profit', money(metrics.profit), <TrendingUp size={20} />],
    ['Stock value', money(metrics.stockValue), <Boxes size={20} />],
  ] as const
  const recent = sales.slice(0, 4)

  return <section className="stack">
    <div className="hero-card">
      <div>
        <span className="eyebrow light">Current stock</span>
        <strong>{metrics.stockCount} items</strong>
        <p>Expected profit on remaining stock: {money(metrics.expectedProfit)}</p>
      </div>
      <PackagePlus size={42} />
    </div>

    <div className="metric-grid">
      {cards.map(([label, value, icon]) => <article className="metric-card" key={label}><span className="metric-icon">{icon}</span><small>{label}</small><strong>{value}</strong></article>)}
    </div>

    <div className="section-heading"><div><span className="eyebrow">Quick sell</span><h2>In stock</h2></div></div>
    <div className="horizontal-products">
      {products.filter((product) => stockForProduct(product.id, batches) > 0).slice(0, 5).map((product) => (
        <button className="mini-product" key={product.id} onClick={() => onSell(product.id)}>
          <ProductImage product={product} />
          <span>{product.name}</span>
          <small>{stockForProduct(product.id, batches)} left</small>
        </button>
      ))}
      {products.length === 0 && <Empty message="Add your first stock batch to start tracking the business." />}
    </div>

    <div className="section-heading"><div><span className="eyebrow">Latest activity</span><h2>Recent sales</h2></div></div>
    <div className="list-card">
      {recent.map((sale) => {
        const product = products.find((item) => item.id === sale.productId)
        return <div className="sale-row" key={sale.id}><div><strong>{product?.name || 'Product'}</strong><small>{new Date(sale.soldAt).toLocaleString()}</small></div><div className="right"><strong>{money(sale.totalAmount)}</strong><small className={sale.profit >= 0 ? 'positive' : 'negative'}>{money(sale.profit)} profit</small></div></div>
      })}
      {recent.length === 0 && <Empty message="Sales you record will appear here." />}
    </div>
  </section>
}

function Inventory({ products, batches, onSell, onAdd }: { products: Product[]; batches: StockBatch[]; onSell: (id: string) => void; onAdd: () => void }) {
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
        return <article className="product-card" key={product.id}>
          <ProductImage product={product} />
          <div className="product-card-body"><span className="status-pill">{qty > 0 ? `${qty} in stock` : 'Sold out'}</span><h3>{product.name}</h3><small>{product.category}</small><div className="price-line"><div><small>Cost</small><strong>{money(averageCost)}</strong></div><div><small>Selling</small><strong>{money(product.defaultSellingPrice)}</strong></div></div><button className="primary-button" disabled={qty === 0} onClick={() => onSell(product.id)}>Record sale</button></div>
        </article>
      })}
      {filtered.length === 0 && <Empty message="No inventory items match this view." />}
    </div>
  </section>
}

function AddStock({ onSubmit }: { onSubmit: (form: HTMLFormElement) => Promise<void> }) {
  const [saving, setSaving] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    setSaving(true)
    try { await onSubmit(form) } finally { setSaving(false) }
  }
  return <section className="stack"><div className="section-heading"><div><span className="eyebrow">New purchase</span><h2>Add stock batch</h2></div></div><form className="form-card" onSubmit={submit}>
    <label className="image-upload"><input type="file" name="image" accept="image/*" capture="environment"/><PackagePlus size={30}/><span>Add product photo</span><small>Camera or gallery</small></label>
    <div className="field"><label>Product name</label><input name="name" required placeholder="e.g. Gold butterfly necklace" /></div>
    <div className="field-row"><div className="field"><label>Category</label><input name="category" defaultValue="Jewelry" /></div><div className="field"><label>SKU</label><input name="sku" placeholder="Optional" /></div></div>
    <div className="field-row"><div className="field"><label>Quantity</label><input name="quantity" required type="number" min="1" inputMode="numeric" /></div><div className="field"><label>Total purchase cost</label><input name="totalCost" required type="number" min="0" step="0.01" inputMode="decimal" /></div></div>
    <div className="field"><label>Selling price per item</label><input name="sellingPrice" required type="number" min="0" step="0.01" inputMode="decimal" /></div>
    <div className="field"><label>Purchase date</label><input name="purchaseDate" type="date" defaultValue={new Date().toISOString().slice(0,10)} /></div>
    <div className="field"><label>Supplier</label><input name="supplier" placeholder="Optional" /></div>
    <div className="field"><label>Notes</label><textarea name="notes" rows={3} placeholder="Optional batch notes" /></div>
    <button className="primary-button large" disabled={saving}>{saving ? 'Saving…' : 'Save stock batch'}</button>
  </form></section>
}

function Sales({ products, sales }: { products: Product[]; sales: Sale[] }) {
  return <section className="stack"><div className="section-heading"><div><span className="eyebrow">Transaction history</span><h2>Sales</h2></div></div><div className="list-card">
    {sales.map((sale) => { const product = products.find((item) => item.id === sale.productId); return <div className="sale-row" key={sale.id}><div><strong>{product?.name || 'Product'} × {sale.quantity}</strong><small>{new Date(sale.soldAt).toLocaleString()} · {sale.paymentMethod || 'Payment not set'}</small></div><div className="right"><strong>{money(sale.totalAmount)}</strong><small className={sale.profit >= 0 ? 'positive' : 'negative'}>{money(sale.profit)} profit</small></div></div> })}
    {sales.length === 0 && <Empty message="No sales recorded yet." />}
  </div></section>
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
