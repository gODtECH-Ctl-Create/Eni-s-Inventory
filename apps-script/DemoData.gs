function seedDemoInventoryData() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet()
  if (!spreadsheet) throw new Error('Open the inventory Google Sheet before running this function.')

  const props = PropertiesService.getScriptProperties()
  props.setProperty('SPREADSHEET_ID', spreadsheet.getId())

  ensureSheet_(spreadsheet, TAB.PRODUCTS, HEADERS[TAB.PRODUCTS])
  ensureSheet_(spreadsheet, TAB.BATCHES, HEADERS[TAB.BATCHES])

  const demoItems = [
    { name: 'Classic Gold Necklace', category: 'Necklace', sku: 'DEMO-NK-001', quantity: 10, totalPurchaseCost: 45000, sellingPrice: 7500 },
    { name: 'Silver Hoop Earrings', category: 'Earrings', sku: 'DEMO-ER-002', quantity: 15, totalPurchaseCost: 30000, sellingPrice: 4000 },
    { name: 'Pearl Charm Bracelet', category: 'Bracelet', sku: 'DEMO-BR-003', quantity: 12, totalPurchaseCost: 36000, sellingPrice: 5500 },
    { name: 'Rose Gold Ring', category: 'Ring', sku: 'DEMO-RG-004', quantity: 8, totalPurchaseCost: 28000, sellingPrice: 6000 },
    { name: 'Layered Chain Necklace', category: 'Necklace', sku: 'DEMO-NK-005', quantity: 9, totalPurchaseCost: 40500, sellingPrice: 7500 },
    { name: 'Crystal Drop Earrings', category: 'Earrings', sku: 'DEMO-ER-006', quantity: 14, totalPurchaseCost: 35000, sellingPrice: 4500 },
    { name: 'Minimalist Anklet', category: 'Anklet', sku: 'DEMO-AK-007', quantity: 11, totalPurchaseCost: 22000, sellingPrice: 3500 },
    { name: 'Heart Pendant Necklace', category: 'Necklace', sku: 'DEMO-NK-008', quantity: 7, totalPurchaseCost: 24500, sellingPrice: 6000 },
    { name: 'Beaded Statement Bracelet', category: 'Bracelet', sku: 'DEMO-BR-009', quantity: 10, totalPurchaseCost: 25000, sellingPrice: 4500 },
    { name: 'Stud Earring Set', category: 'Earrings', sku: 'DEMO-ER-010', quantity: 20, totalPurchaseCost: 40000, sellingPrice: 3500 },
  ]

  const now = new Date()
  const nowIso = now.toISOString()
  const purchaseDate = dateOnly_(now)
  let added = 0
  let skipped = 0

  demoItems.forEach(function (item) {
    const existing = findProduct_(item.sku, item.name)
    if (existing) {
      skipped += 1
      return
    }

    const product = {
      id: Utilities.getUuid(),
      name: item.name,
      category: item.category,
      sku: item.sku,
      image: '',
      defaultSellingPrice: item.sellingPrice,
      createdAt: nowIso,
    }

    const batch = {
      id: Utilities.getUuid(),
      productId: product.id,
      productName: product.name,
      quantityPurchased: item.quantity,
      totalPurchaseCost: item.totalPurchaseCost,
      unitCost: item.totalPurchaseCost / item.quantity,
      purchaseDate: purchaseDate,
      supplier: 'Demo Supplier',
      notes: 'Demo inventory data',
      createdAt: nowIso,
      createdByUserId: '',
      createdByName: 'Demo Seeder',
    }

    upsertObject_(TAB.PRODUCTS, HEADERS[TAB.PRODUCTS], product)
    upsertObject_(TAB.BATCHES, HEADERS[TAB.BATCHES], batch)
    added += 1
  })

  SpreadsheetApp.getUi().alert(
    'Demo inventory ready',
    added + ' demo products added. ' + skipped + ' existing demo products skipped.\n\nRefresh the PWA to see the inventory.',
    SpreadsheetApp.getUi().ButtonSet.OK
  )
}
