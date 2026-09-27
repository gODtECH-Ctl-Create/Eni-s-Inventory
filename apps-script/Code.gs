const TAB = {
  PRODUCTS: 'Products',
  BATCHES: 'Batches',
  SALES: 'Sales',
  ALLOCATIONS: 'SaleAllocations',
  INTAKE: 'Stock Intake',
}

const HEADERS = {
  Products: ['id', 'name', 'category', 'sku', 'image', 'defaultSellingPrice', 'createdAt'],
  Batches: ['id', 'productId', 'productName', 'quantityPurchased', 'totalPurchaseCost', 'unitCost', 'purchaseDate', 'supplier', 'notes', 'createdAt'],
  Sales: ['id', 'productId', 'productName', 'quantity', 'unitSellingPrice', 'totalAmount', 'costOfGoods', 'profit', 'soldAt', 'paymentMethod', 'customerName'],
  SaleAllocations: ['saleId', 'batchId', 'quantity', 'unitCost'],
  'Stock Intake': ['status', 'productName', 'category', 'sku', 'imageUrl', 'quantity', 'totalPurchaseCost', 'sellingPrice', 'purchaseDate', 'supplier', 'notes'],
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Eni Inventory")
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

  let accessKey = props.getProperty('API_KEY')
  if (!accessKey) {
    accessKey = Utilities.getUuid().replace(/-/g, '')
    props.setProperty('API_KEY', accessKey)
  }

  const intake = spreadsheet.getSheetByName(TAB.INTAKE)
  if (intake) {
    intake.setFrozenRows(1)
    intake.getRange('A1:K1').setFontWeight('bold')
  }

  SpreadsheetApp.getUi().alert(
    'Eni Inventory backend is ready',
    'Keep this access key private. The PWA will ask for it the first time it connects:\n\n' + accessKey +
      '\n\nNext: Deploy this script as a Web app, execute as you, with access set to Anyone. Copy the /exec URL into the GitHub Actions variable VITE_APPS_SCRIPT_URL.',
    SpreadsheetApp.getUi().ButtonSet.OK
  )
}

function doGet() {
  return json_({ ok: true, data: { service: "Eni's Inventory", status: 'ok' } })
}

function doPost(e) {
  try {
    const request = JSON.parse((e.postData && e.postData.contents) || '{}')
    if (!authorized_(request.accessKey)) return json_({ ok: false, error: 'UNAUTHORIZED' })

    if (request.action === 'snapshot') {
      return json_({ ok: true, data: buildSnapshot_() })
    }

    const lock = LockService.getScriptLock()
    lock.waitLock(15000)
    try {
      let data
      switch (request.action) {
        case 'addProductWithBatch':
          data = addProductWithBatch_(request.payload || {})
          break
        case 'addBatch':
          data = addBatch_(request.payload || {})
          break
        case 'recordSale':
          data = recordSale_(request.payload || {})
          break
        default:
          throw new Error('Unknown action: ' + request.action)
      }
      return json_({ ok: true, data: data })
    } finally {
      lock.releaseLock()
    }
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message ? error.message : error) })
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
  for (let row = 2; row <= sheet.getLastRow(); row += 1) {
    processStockIntakeRow_(row)
  }
}

function processStockIntakeRow_(row) {
  const spreadsheet = spreadsheet_()
  const sheet = spreadsheet.getSheetByName(TAB.INTAKE)
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
    }

    upsertObject_(TAB.BATCHES, HEADERS[TAB.BATCHES], batch)
    sheet.getRange(row, 1).setValue('ADDED | ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'))
  } finally {
    lock.releaseLock()
  }
}

function addProductWithBatch_(payload) {
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

  upsertObject_(TAB.PRODUCTS, HEADERS[TAB.PRODUCTS], product)
  upsertObject_(TAB.BATCHES, HEADERS[TAB.BATCHES], batch)
  return buildSnapshot_()
}

function addBatch_(payload) {
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

  upsertObject_(TAB.BATCHES, HEADERS[TAB.BATCHES], batch)
  return buildSnapshot_()
}

function recordSale_(payload) {
  const incoming = Object.assign({}, payload.sale || {})
  incoming.id = incoming.id || Utilities.getUuid()

  const existing = findObjectById_(TAB.SALES, HEADERS[TAB.SALES], incoming.id)
  if (existing) return buildSnapshot_()

  const snapshot = buildSnapshot_()
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
    allocations.push({
      saleId: incoming.id,
      batchId: batch.id,
      quantity: used,
      unitCost: batch.unitCost,
    })
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
  }

  upsertObject_(TAB.SALES, HEADERS[TAB.SALES], sale)
  allocations.forEach(function (allocation) {
    appendObject_(TAB.ALLOCATIONS, HEADERS[TAB.ALLOCATIONS], allocation)
  })

  return buildSnapshot_()
}

function buildSnapshot_() {
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
      allocations: allocationRows
        .filter(function (allocation) { return String(allocation.saleId || '') === saleId })
        .map(function (allocation) {
          return {
            batchId: String(allocation.batchId || ''),
            quantity: number_(allocation.quantity),
            unitCost: number_(allocation.unitCost),
          }
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
  if (rowNumber > 0) {
    sheet.getRange(rowNumber, 1, 1, headers.length).setValues([values])
  } else {
    sheet.appendRow(values)
  }
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

  const props = PropertiesService.getScriptProperties()
  const folderId = props.getProperty('IMAGE_FOLDER_ID')
  if (!folderId) throw new Error('Image folder is not configured. Run setupInventoryBackend first.')

  const mimeType = match[1]
  const extension = mimeType.split('/')[1].replace('jpeg', 'jpg')
  const blob = Utilities.newBlob(Utilities.base64Decode(match[2]), mimeType, id + '.' + extension)
  const file = DriveApp.getFolderById(folderId).createFile(blob)

  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW)
  } catch (error) {
    console.warn('Could not enable link sharing for image:', error)
  }

  return 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1000'
}

function authorized_(providedKey) {
  const expected = PropertiesService.getScriptProperties().getProperty('API_KEY')
  return Boolean(expected && providedKey && String(providedKey) === expected)
}

function spreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')
  if (id) return SpreadsheetApp.openById(id)
  const active = SpreadsheetApp.getActiveSpreadsheet()
  if (!active) throw new Error('Spreadsheet is not configured. Run setupInventoryBackend first.')
  return active
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
