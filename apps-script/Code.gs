const TAB = {
  PRODUCTS: 'Products',
  BATCHES: 'Batches',
  SALES: 'Sales',
  ALLOCATIONS: 'SaleAllocations',
  INTAKE: 'Stock Intake',
  USERS: 'Users',
  AUDIT: 'AuditLog',
}

const HEADERS = {
  Products: ['id', 'name', 'category', 'sku', 'image', 'defaultSellingPrice', 'createdAt'],
  Batches: ['id', 'productId', 'productName', 'quantityPurchased', 'totalPurchaseCost', 'unitCost', 'purchaseDate', 'supplier', 'notes', 'createdAt', 'createdByUserId', 'createdByName'],
  Sales: ['id', 'productId', 'productName', 'quantity', 'unitSellingPrice', 'totalAmount', 'costOfGoods', 'profit', 'soldAt', 'paymentMethod', 'customerName', 'createdByUserId', 'createdByName'],
  SaleAllocations: ['saleId', 'batchId', 'quantity', 'unitCost'],
  'Stock Intake': ['status', 'productName', 'category', 'sku', 'imageUrl', 'quantity', 'totalPurchaseCost', 'sellingPrice', 'purchaseDate', 'supplier', 'notes'],
  Users: ['id', 'username', 'displayName', 'role', 'passwordHash', 'salt', 'active', 'mustChangePassword', 'createdAt', 'updatedAt'],
  AuditLog: ['id', 'timestamp', 'userId', 'username', 'role', 'action', 'details'],
}

const SESSION_TTL_MS = 12 * 60 * 60 * 1000

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Eni Inventory')
    .addItem('Setup / repair backend', 'setupInventoryBackend')
    .addItem('Process pending stock intake', 'processPendingStockIntake')
    .addToUi()
}

function setupInventoryBackend() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet()
  const props = PropertiesService.getScriptProperties()
  props.setProperty('SPREADSHEET_ID', spreadsheet.getId())

  Object.keys(HEADERS).forEach(function (name) {
    ensureSheet_(spreadsheet, name, HEADERS[name])
  })

  if (!props.getProperty('IMAGE_FOLDER_ID')) {
    const folder = DriveApp.createFolder('Eni Inventory Images - ' + spreadsheet.getName())
    props.setProperty('IMAGE_FOLDER_ID', folder.getId())
  }

  if (!props.getProperty('AUTH_PEPPER')) {
    props.setProperty('AUTH_PEPPER', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''))
  }

  const intake = spreadsheet.getSheetByName(TAB.INTAKE)
  if (intake) {
    intake.setFrozenRows(1)
    intake.getRange('A1:K1').setFontWeight('bold')
  }

  const users = objects_(TAB.USERS, HEADERS[TAB.USERS])
  let bootstrapMessage = 'Existing user accounts were preserved.'
  if (users.length === 0) {
    const temporaryPassword = temporaryPassword_()
    createUserRecord_('admin', 'Administrator', 'admin', temporaryPassword, true)
    bootstrapMessage = 'First Admin account created.\n\nUsername: admin\nTemporary password: ' + temporaryPassword + '\n\nYou will be required to change this password after your first login.'
  }

  SpreadsheetApp.getUi().alert(
    'Eni Inventory backend is ready',
    bootstrapMessage + '\n\nDeploy or update the Apps Script Web App as a new version. Keep access set to Anyone; application access is now protected by individual Admin/Staff logins.',
    SpreadsheetApp.getUi().ButtonSet.OK
  )
}

function doGet() {
  return json_({ ok: true, data: { service: "Eni's Inventory", status: 'ok', auth: 'admin-staff' } })
}

function doPost(e) {
  try {
    const request = JSON.parse((e.postData && e.postData.contents) || '{}')
    const action = String(request.action || '')
    const payload = request.payload || {}

    if (action === 'login') return json_({ ok: true, data: login_(payload) })

    const session = requireSession_(request.token)
    const user = session.user

    if (action === 'logout') {
      logout_(request.token, user)
      return json_({ ok: true, data: { success: true } })
    }

    if (action === 'changeOwnPassword') {
      return json_({ ok: true, data: changeOwnPassword_(user, payload) })
    }

    if (user.mustChangePassword) {
      return json_({ ok: false, error: 'PASSWORD_CHANGE_REQUIRED' })
    }

    if (action === 'snapshot') {
      return json_({ ok: true, data: buildSnapshotForUser_(user) })
    }

    if (action === 'listUsers') {
      requireAdmin_(user)
      return json_({ ok: true, data: listUsers_() })
    }

    if (action === 'createUser') {
      requireAdmin_(user)
      return json_({ ok: true, data: createUser_(user, payload) })
    }

    if (action === 'setUserActive') {
      requireAdmin_(user)
      return json_({ ok: true, data: setUserActive_(user, payload) })
    }

    if (action === 'resetUserPassword') {
      requireAdmin_(user)
      return json_({ ok: true, data: resetUserPassword_(user, payload) })
    }

    const lock = LockService.getScriptLock()
    lock.waitLock(15000)
    try {
      if (action === 'addProductWithBatch') {
        addProductWithBatch_(payload, user)
        audit_(user, 'ADD_PRODUCT_BATCH', payload && payload.product ? payload.product.name : '')
      } else if (action === 'addBatch') {
        addBatch_(payload, user)
        audit_(user, 'ADD_BATCH', payload && payload.batch ? payload.batch.productId : '')
      } else if (action === 'recordSale') {
        const sale = recordSale_(payload, user)
        audit_(user, 'RECORD_SALE', sale.productName + ' x ' + sale.quantity)
      } else {
        throw new Error('Unknown action: ' + action)
      }
      return json_({ ok: true, data: buildSnapshotForUser_(user) })
    } finally {
      lock.releaseLock()
    }
  } catch (error) {
    const message = String(error && error.message ? error.message : error)
    return json_({ ok: false, error: message })
  }
}

function login_(payload) {
  cleanupSessions_()
  const username = normalizeUsername_(payload.username)
  const password = String(payload.password || '')
  if (!username || !password) throw new Error('INVALID_CREDENTIALS')

  const user = findUserByUsername_(username)
  if (!user || !isTrue_(user.active)) throw new Error('INVALID_CREDENTIALS')
  if (hashPassword_(password, String(user.salt || '')) !== String(user.passwordHash || '')) {
    throw new Error('INVALID_CREDENTIALS')
  }

  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '')
  const session = {
    userId: String(user.id),
    expiresAt: Date.now() + SESSION_TTL_MS,
  }
  PropertiesService.getScriptProperties().setProperty('SESSION_' + token, JSON.stringify(session))
  const safeUser = publicUser_(user)
  audit_(safeUser, 'LOGIN', '')
  return { token: token, user: safeUser }
}

function logout_(token, user) {
  if (token) PropertiesService.getScriptProperties().deleteProperty('SESSION_' + String(token))
  audit_(user, 'LOGOUT', '')
}

function requireSession_(token) {
  if (!token) throw new Error('UNAUTHENTICATED')
  const props = PropertiesService.getScriptProperties()
  const key = 'SESSION_' + String(token)
  const raw = props.getProperty(key)
  if (!raw) throw new Error('UNAUTHENTICATED')

  let session
  try { session = JSON.parse(raw) } catch (error) { session = null }
  if (!session || number_(session.expiresAt) <= Date.now()) {
    props.deleteProperty(key)
    throw new Error('SESSION_EXPIRED')
  }

  const user = findObjectById_(TAB.USERS, HEADERS[TAB.USERS], session.userId)
  if (!user || !isTrue_(user.active)) {
    props.deleteProperty(key)
    throw new Error('UNAUTHENTICATED')
  }

  return { token: String(token), user: publicUser_(user) }
}

function cleanupSessions_() {
  const props = PropertiesService.getScriptProperties()
  const all = props.getProperties()
  Object.keys(all).forEach(function (key) {
    if (key.indexOf('SESSION_') !== 0) return
    try {
      const session = JSON.parse(all[key])
      if (!session || number_(session.expiresAt) <= Date.now()) props.deleteProperty(key)
    } catch (error) {
      props.deleteProperty(key)
    }
  })
}

function changeOwnPassword_(user, payload) {
  const currentPassword = String(payload.currentPassword || '')
  const newPassword = String(payload.newPassword || '')
  validatePassword_(newPassword)

  const row = findObjectById_(TAB.USERS, HEADERS[TAB.USERS], user.id)
  if (!row) throw new Error('USER_NOT_FOUND')
  if (hashPassword_(currentPassword, String(row.salt || '')) !== String(row.passwordHash || '')) {
    throw new Error('CURRENT_PASSWORD_INCORRECT')
  }

  const salt = newSalt_()
  row.salt = salt
  row.passwordHash = hashPassword_(newPassword, salt)
  row.mustChangePassword = false
  row.updatedAt = new Date().toISOString()
  upsertObject_(TAB.USERS, HEADERS[TAB.USERS], row)
  revokeUserSessions_(user.id)
  audit_(user, 'CHANGE_PASSWORD', '')
  return { success: true }
}

function listUsers_() {
  return objects_(TAB.USERS, HEADERS[TAB.USERS]).map(publicUser_)
}

function createUser_(admin, payload) {
  const username = normalizeUsername_(payload.username)
  const displayName = String(payload.displayName || '').trim()
  const role = String(payload.role || 'staff').toLowerCase() === 'admin' ? 'admin' : 'staff'
  if (!username) throw new Error('Username is required.')
  if (!displayName) throw new Error('Display name is required.')
  if (findUserByUsername_(username)) throw new Error('USERNAME_EXISTS')

  const temporaryPassword = temporaryPassword_()
  const user = createUserRecord_(username, displayName, role, temporaryPassword, true)
  audit_(admin, 'CREATE_USER', username + ' (' + role + ')')
  return { user: publicUser_(user), temporaryPassword: temporaryPassword }
}

function setUserActive_(admin, payload) {
  const id = String(payload.userId || '')
  if (!id) throw new Error('User id is required.')
  if (id === admin.id && !Boolean(payload.active)) throw new Error('You cannot deactivate your own account.')

  const row = findObjectById_(TAB.USERS, HEADERS[TAB.USERS], id)
  if (!row) throw new Error('USER_NOT_FOUND')
  row.active = Boolean(payload.active)
  row.updatedAt = new Date().toISOString()
  upsertObject_(TAB.USERS, HEADERS[TAB.USERS], row)
  if (!row.active) revokeUserSessions_(id)
  audit_(admin, row.active ? 'ACTIVATE_USER' : 'DEACTIVATE_USER', String(row.username || ''))
  return publicUser_(row)
}

function resetUserPassword_(admin, payload) {
  const id = String(payload.userId || '')
  const row = findObjectById_(TAB.USERS, HEADERS[TAB.USERS], id)
  if (!row) throw new Error('USER_NOT_FOUND')

  const temporaryPassword = temporaryPassword_()
  const salt = newSalt_()
  row.salt = salt
  row.passwordHash = hashPassword_(temporaryPassword, salt)
  row.mustChangePassword = true
  row.updatedAt = new Date().toISOString()
  upsertObject_(TAB.USERS, HEADERS[TAB.USERS], row)
  revokeUserSessions_(id)
  audit_(admin, 'RESET_PASSWORD', String(row.username || ''))
  return { user: publicUser_(row), temporaryPassword: temporaryPassword }
}

function createUserRecord_(username, displayName, role, password, mustChangePassword) {
  validatePassword_(password)
  const salt = newSalt_()
  const now = new Date().toISOString()
  const user = {
    id: Utilities.getUuid(),
    username: normalizeUsername_(username),
    displayName: String(displayName || '').trim(),
    role: role === 'admin' ? 'admin' : 'staff',
    passwordHash: hashPassword_(password, salt),
    salt: salt,
    active: true,
    mustChangePassword: Boolean(mustChangePassword),
    createdAt: now,
    updatedAt: now,
  }
  upsertObject_(TAB.USERS, HEADERS[TAB.USERS], user)
  return user
}

function publicUser_(row) {
  return {
    id: String(row.id || ''),
    username: String(row.username || ''),
    displayName: String(row.displayName || row.username || ''),
    role: String(row.role || 'staff') === 'admin' ? 'admin' : 'staff',
    active: isTrue_(row.active),
    mustChangePassword: isTrue_(row.mustChangePassword),
    createdAt: iso_(row.createdAt || new Date()),
  }
}

function requireAdmin_(user) {
  if (!user || user.role !== 'admin') throw new Error('FORBIDDEN')
}

function findUserByUsername_(username) {
  const normalized = normalizeUsername_(username)
  return objects_(TAB.USERS, HEADERS[TAB.USERS]).find(function (row) {
    return normalizeUsername_(row.username) === normalized
  }) || null
}

function normalizeUsername_(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '.')
}

function validatePassword_(password) {
  if (String(password || '').length < 8) throw new Error('Password must be at least 8 characters.')
}

function newSalt_() {
  return Utilities.getUuid().replace(/-/g, '')
}

function temporaryPassword_() {
  return 'Eni-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10) + '!'
}

function hashPassword_(password, salt) {
  const pepper = PropertiesService.getScriptProperties().getProperty('AUTH_PEPPER') || ''
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt) + ':' + String(password) + ':' + pepper,
    Utilities.Charset.UTF_8
  )
  return bytes.map(function (byte) {
    const value = byte < 0 ? byte + 256 : byte
    return ('0' + value.toString(16)).slice(-2)
  }).join('')
}

function revokeUserSessions_(userId) {
  const props = PropertiesService.getScriptProperties()
  const all = props.getProperties()
  Object.keys(all).forEach(function (key) {
    if (key.indexOf('SESSION_') !== 0) return
    try {
      const session = JSON.parse(all[key])
      if (String(session.userId || '') === String(userId)) props.deleteProperty(key)
    } catch (error) {
      props.deleteProperty(key)
    }
  })
}

function audit_(user, action, details) {
  try {
    appendObject_(TAB.AUDIT, HEADERS[TAB.AUDIT], {
      id: Utilities.getUuid(),
      timestamp: new Date().toISOString(),
      userId: user && user.id ? user.id : '',
      username: user && user.username ? user.username : '',
      role: user && user.role ? user.role : '',
      action: action,
      details: String(details || ''),
    })
  } catch (error) {
    console.warn('Could not write audit record:', error)
  }
}

function buildSnapshotForUser_(user) {
  const snapshot = buildSnapshotRaw_()
  if (user.role === 'admin') return snapshot

  return {
    products: snapshot.products,
    batches: snapshot.batches.map(function (batch) {
      return Object.assign({}, batch, { totalPurchaseCost: 0, unitCost: 0 })
    }),
    sales: snapshot.sales.map(function (sale) {
      return Object.assign({}, sale, {
        costOfGoods: 0,
        profit: 0,
        allocations: sale.allocations.map(function (allocation) {
          return Object.assign({}, allocation, { unitCost: 0 })
        }),
      })
    }),
  }
}

function onEdit(e) {
  if (!e || !e.range) return
  const sheet = e.range.getSheet()
  if (sheet.getName() !== TAB.INTAKE || e.range.getRow() === 1) return

  const start = e.range.getRow()
  const end = start + e.range.getNumRows() - 1
  for (let row = start; row <= end; row += 1) {
    try {
      processStockIntakeRow_(row)
    } catch (error) {
      sheet.getRange(row, 1).setValue('ERROR | ' + String(error && error.message ? error.message : error))
    }
  }
}

function processPendingStockIntake() {
  const sheet = spreadsheet_().getSheetByName(TAB.INTAKE)
  if (!sheet || sheet.getLastRow() < 2) return
  for (let row = 2; row <= sheet.getLastRow(); row += 1) processStockIntakeRow_(row)
}

function processStockIntakeRow_(row) {
  const sheet = spreadsheet_().getSheetByName(TAB.INTAKE)
  const values = sheet.getRange(row, 1, 1, HEADERS[TAB.INTAKE].length).getValues()[0]
  const item = rowToObject_(HEADERS[TAB.INTAKE], values)
  if (String(item.status || '').trim()) return

  const name = String(item.productName || '').trim()
  const quantity = number_(item.quantity)
  const totalPurchaseCost = number_(item.totalPurchaseCost)
  const sellingPrice = number_(item.sellingPrice)
  if (!name || quantity <= 0 || totalPurchaseCost < 0 || item.sellingPrice === '') return

  const lock = LockService.getScriptLock()
  lock.waitLock(15000)
  try {
    let product = findProduct_(String(item.sku || '').trim(), name)
    const now = new Date().toISOString()
    if (!product) {
      product = {
        id: Utilities.getUuid(),
        name: name,
        category: String(item.category || 'Jewelry').trim() || 'Jewelry',
        sku: String(item.sku || '').trim(),
        image: String(item.imageUrl || '').trim(),
        defaultSellingPrice: sellingPrice,
        createdAt: now,
      }
    } else {
      if (item.category) product.category = String(item.category).trim()
      if (item.sku) product.sku = String(item.sku).trim()
      if (item.imageUrl) product.image = String(item.imageUrl).trim()
      if (item.sellingPrice !== '') product.defaultSellingPrice = sellingPrice
    }
    upsertObject_(TAB.PRODUCTS, HEADERS[TAB.PRODUCTS], product)

    const batch = {
      id: Utilities.getUuid(),
      productId: product.id,
      productName: product.name,
      quantityPurchased: quantity,
      totalPurchaseCost: totalPurchaseCost,
      unitCost: quantity ? totalPurchaseCost / quantity : 0,
      purchaseDate: dateOnly_(item.purchaseDate || new Date()),
      supplier: String(item.supplier || '').trim(),
      notes: String(item.notes || '').trim(),
      createdAt: now,
      createdByUserId: '',
      createdByName: 'Google Sheet',
    }
    upsertObject_(TAB.BATCHES, HEADERS[TAB.BATCHES], batch)
    sheet.getRange(row, 1).setValue('ADDED | ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'))
  } finally {
    lock.releaseLock()
  }
}

function addProductWithBatch_(payload, user) {
  const product = Object.assign({}, payload.product || {})
  const batch = Object.assign({}, payload.batch || {})
  if (!product.name) throw new Error('Product name is required.')

  product.id = product.id || Utilities.getUuid()
  product.category = product.category || 'Jewelry'
  product.defaultSellingPrice = number_(product.defaultSellingPrice)
  product.createdAt = iso_(product.createdAt || new Date())
  if (product.image) product.image = saveImageIfNeeded_(product.image, product.id)

  batch.id = batch.id || Utilities.getUuid()
  batch.productId = product.id
  batch.productName = product.name
  batch.quantityPurchased = number_(batch.quantityPurchased)
  batch.totalPurchaseCost = number_(batch.totalPurchaseCost)
  if (batch.quantityPurchased <= 0) throw new Error('Quantity must be greater than zero.')
  batch.unitCost = batch.totalPurchaseCost / batch.quantityPurchased
  batch.purchaseDate = dateOnly_(batch.purchaseDate || new Date())
  batch.createdAt = iso_(batch.createdAt || new Date())
  batch.createdByUserId = user.id
  batch.createdByName = user.displayName

  upsertObject_(TAB.PRODUCTS, HEADERS[TAB.PRODUCTS], product)
  upsertObject_(TAB.BATCHES, HEADERS[TAB.BATCHES], batch)
}

function addBatch_(payload, user) {
  const batch = Object.assign({}, payload.batch || {})
  const product = findObjectById_(TAB.PRODUCTS, HEADERS[TAB.PRODUCTS], batch.productId)
  if (!product) throw new Error('Product not found.')

  batch.id = batch.id || Utilities.getUuid()
  batch.productName = product.name
  batch.quantityPurchased = number_(batch.quantityPurchased)
  batch.totalPurchaseCost = number_(batch.totalPurchaseCost)
  if (batch.quantityPurchased <= 0) throw new Error('Quantity must be greater than zero.')
  batch.unitCost = batch.totalPurchaseCost / batch.quantityPurchased
  batch.purchaseDate = dateOnly_(batch.purchaseDate || new Date())
  batch.createdAt = iso_(batch.createdAt || new Date())
  batch.createdByUserId = user.id
  batch.createdByName = user.displayName

  upsertObject_(TAB.BATCHES, HEADERS[TAB.BATCHES], batch)
}

function recordSale_(payload, user) {
  const incoming = Object.assign({}, payload.sale || {})
  incoming.id = incoming.id || Utilities.getUuid()
  const existing = findObjectById_(TAB.SALES, HEADERS[TAB.SALES], incoming.id)
  if (existing) return existing

  const snapshot = buildSnapshotRaw_()
  const product = snapshot.products.find(function (item) { return item.id === incoming.productId })
  if (!product) throw new Error('Product not found.')

  const quantity = number_(incoming.quantity)
  const unitSellingPrice = number_(incoming.unitSellingPrice)
  if (quantity <= 0) throw new Error('Sale quantity must be greater than zero.')

  const candidates = snapshot.batches
    .filter(function (batch) { return batch.productId === incoming.productId && batch.quantityRemaining > 0 })
    .sort(function (a, b) { return String(a.purchaseDate).localeCompare(String(b.purchaseDate)) })
  const available = candidates.reduce(function (sum, batch) { return sum + batch.quantityRemaining }, 0)
  if (quantity > available) throw new Error('Only ' + available + ' items are available in stock.')

  let remaining = quantity
  let costOfGoods = 0
  const allocations = []
  candidates.forEach(function (batch) {
    if (remaining <= 0) return
    const used = Math.min(batch.quantityRemaining, remaining)
    remaining -= used
    costOfGoods += used * batch.unitCost
    allocations.push({ saleId: incoming.id, batchId: batch.id, quantity: used, unitCost: batch.unitCost })
  })

  const totalAmount = quantity * unitSellingPrice
  const sale = {
    id: incoming.id,
    productId: product.id,
    productName: product.name,
    quantity: quantity,
    unitSellingPrice: unitSellingPrice,
    totalAmount: totalAmount,
    costOfGoods: costOfGoods,
    profit: totalAmount - costOfGoods,
    soldAt: iso_(incoming.soldAt || new Date()),
    paymentMethod: String(incoming.paymentMethod || '').trim(),
    customerName: String(incoming.customerName || '').trim(),
    createdByUserId: user.id,
    createdByName: user.displayName,
  }
  upsertObject_(TAB.SALES, HEADERS[TAB.SALES], sale)
  allocations.forEach(function (allocation) { appendObject_(TAB.ALLOCATIONS, HEADERS[TAB.ALLOCATIONS], allocation) })
  return sale
}

function buildSnapshotRaw_() {
  const products = objects_(TAB.PRODUCTS, HEADERS[TAB.PRODUCTS]).map(function (row) {
    return {
      id: String(row.id || ''),
      name: String(row.name || ''),
      category: String(row.category || 'Jewelry'),
      sku: String(row.sku || ''),
      image: String(row.image || ''),
      defaultSellingPrice: number_(row.defaultSellingPrice),
      createdAt: iso_(row.createdAt || new Date()),
    }
  }).filter(function (product) { return product.id && product.name })

  const allocationRows = objects_(TAB.ALLOCATIONS, HEADERS[TAB.ALLOCATIONS])
  const allocatedByBatch = {}
  allocationRows.forEach(function (row) {
    const batchId = String(row.batchId || '')
    allocatedByBatch[batchId] = (allocatedByBatch[batchId] || 0) + number_(row.quantity)
  })

  const batches = objects_(TAB.BATCHES, HEADERS[TAB.BATCHES]).map(function (row) {
    const purchased = number_(row.quantityPurchased)
    const id = String(row.id || '')
    return {
      id: id,
      productId: String(row.productId || ''),
      quantityPurchased: purchased,
      quantityRemaining: Math.max(0, purchased - (allocatedByBatch[id] || 0)),
      totalPurchaseCost: number_(row.totalPurchaseCost),
      unitCost: number_(row.unitCost),
      purchaseDate: dateOnly_(row.purchaseDate || new Date()),
      supplier: String(row.supplier || ''),
      notes: String(row.notes || ''),
    }
  }).filter(function (batch) { return batch.id && batch.productId })

  const sales = objects_(TAB.SALES, HEADERS[TAB.SALES]).map(function (row) {
    const saleId = String(row.id || '')
    return {
      id: saleId,
      productId: String(row.productId || ''),
      quantity: number_(row.quantity),
      unitSellingPrice: number_(row.unitSellingPrice),
      totalAmount: number_(row.totalAmount),
      costOfGoods: number_(row.costOfGoods),
      profit: number_(row.profit),
      soldAt: iso_(row.soldAt || new Date()),
      paymentMethod: String(row.paymentMethod || ''),
      customerName: String(row.customerName || ''),
      createdByName: String(row.createdByName || ''),
      allocations: allocationRows
        .filter(function (allocation) { return String(allocation.saleId || '') === saleId })
        .map(function (allocation) {
          return { batchId: String(allocation.batchId || ''), quantity: number_(allocation.quantity), unitCost: number_(allocation.unitCost) }
        }),
    }
  }).filter(function (sale) { return sale.id && sale.productId })

  return { products: products, batches: batches, sales: sales }
}

function findProduct_(sku, name) {
  const products = objects_(TAB.PRODUCTS, HEADERS[TAB.PRODUCTS])
  const normalizedSku = String(sku || '').trim().toLowerCase()
  const normalizedName = String(name || '').trim().toLowerCase()
  return products.find(function (product) {
    if (normalizedSku && String(product.sku || '').trim().toLowerCase() === normalizedSku) return true
    return String(product.name || '').trim().toLowerCase() === normalizedName
  }) || null
}

function findObjectById_(sheetName, headers, id) {
  if (!id) return null
  return objects_(sheetName, headers).find(function (row) { return String(row.id || '') === String(id) }) || null
}

function objects_(sheetName, headers) {
  const sheet = spreadsheet_().getSheetByName(sheetName)
  if (!sheet || sheet.getLastRow() < 2) return []
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues()
  return values
    .filter(function (row) { return row.some(function (value) { return value !== '' }) })
    .map(function (row) { return rowToObject_(headers, row) })
}

function rowToObject_(headers, row) {
  const object = {}
  headers.forEach(function (header, index) { object[header] = row[index] })
  return object
}

function upsertObject_(sheetName, headers, object) {
  const sheet = spreadsheet_().getSheetByName(sheetName)
  const id = String(object.id || '')
  if (!id) throw new Error(sheetName + ' record is missing an id.')

  let rowNumber = -1
  if (sheet.getLastRow() >= 2) {
    const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().map(function (row) { return String(row[0] || '') })
    const index = ids.indexOf(id)
    if (index >= 0) rowNumber = index + 2
  }
  const values = headers.map(function (header) { return object[header] === undefined ? '' : object[header] })
  if (rowNumber > 0) sheet.getRange(rowNumber, 1, 1, headers.length).setValues([values])
  else sheet.appendRow(values)
}

function appendObject_(sheetName, headers, object) {
  const sheet = spreadsheet_().getSheetByName(sheetName)
  sheet.appendRow(headers.map(function (header) { return object[header] === undefined ? '' : object[header] }))
}

function ensureSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name)
  if (!sheet) sheet = spreadsheet.insertSheet(name)
  const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0]
  const needsHeaders = headers.some(function (header, index) { return current[index] !== header })
  if (needsHeaders) sheet.getRange(1, 1, 1, headers.length).setValues([headers])
  sheet.setFrozenRows(1)
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold')
  return sheet
}

function saveImageIfNeeded_(value, id) {
  const input = String(value || '')
  if (input.indexOf('data:image/') !== 0) return input
  const match = input.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
  if (!match) throw new Error('Invalid image data.')

  const folderId = PropertiesService.getScriptProperties().getProperty('IMAGE_FOLDER_ID')
  if (!folderId) throw new Error('Image folder is not configured. Run setupInventoryBackend first.')
  const mimeType = match[1]
  const extension = mimeType.split('/')[1].replace('jpeg', 'jpg')
  const blob = Utilities.newBlob(Utilities.base64Decode(match[2]), mimeType, id + '.' + extension)
  const file = DriveApp.getFolderById(folderId).createFile(blob)
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW) } catch (error) { console.warn(error) }
  return 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1000'
}

function spreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')
  if (id) return SpreadsheetApp.openById(id)
  const active = SpreadsheetApp.getActiveSpreadsheet()
  if (!active) throw new Error('Spreadsheet is not configured. Run setupInventoryBackend first.')
  return active
}

function isTrue_(value) {
  return value === true || String(value).toLowerCase() === 'true' || String(value) === '1'
}

function number_(value) {
  const result = Number(value)
  return Number.isFinite(result) ? result : 0
}

function dateOnly_(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (isNaN(date.getTime())) return String(value || '')
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd')
}

function iso_(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (isNaN(date.getTime())) return String(value || '')
  return date.toISOString()
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON)
}
