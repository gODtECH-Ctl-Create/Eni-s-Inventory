import {
  AuthError,
  createRemoteBatch,
  createRemoteProductWithBatch,
  createRemoteSale,
  fetchRemoteSnapshot,
  remoteBackendConfigured,
} from './api'
import type { InventorySnapshot, Product, Sale, StockBatch } from './types'

const DB_NAME = 'eni-inventory-db'
const DB_VERSION = 1
const PRODUCTS = 'products'
const BATCHES = 'batches'
const SALES = 'sales'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(PRODUCTS)) db.createObjectStore(PRODUCTS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(BATCHES)) db.createObjectStore(BATCHES, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(SALES)) db.createObjectStore(SALES, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function loadLocalSnapshot(): Promise<InventorySnapshot> {
  const db = await openDb()
  const tx = db.transaction([PRODUCTS, BATCHES, SALES], 'readonly')
  const [products, batches, sales] = await Promise.all([
    requestToPromise(tx.objectStore(PRODUCTS).getAll()) as Promise<Product[]>,
    requestToPromise(tx.objectStore(BATCHES).getAll()) as Promise<StockBatch[]>,
    requestToPromise(tx.objectStore(SALES).getAll()) as Promise<Sale[]>,
  ])
  db.close()
  return { products, batches, sales }
}

async function cacheSnapshot(snapshot: InventorySnapshot): Promise<void> {
  const db = await openDb()
  const tx = db.transaction([PRODUCTS, BATCHES, SALES], 'readwrite')
  const productStore = tx.objectStore(PRODUCTS)
  const batchStore = tx.objectStore(BATCHES)
  const salesStore = tx.objectStore(SALES)
  productStore.clear()
  batchStore.clear()
  salesStore.clear()
  snapshot.products.forEach((product) => productStore.put(product))
  snapshot.batches.forEach((batch) => batchStore.put(batch))
  snapshot.sales.forEach((sale) => salesStore.put(sale))
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
  db.close()
}

export async function clearLocalCache(): Promise<void> {
  const db = await openDb()
  const tx = db.transaction([PRODUCTS, BATCHES, SALES], 'readwrite')
  tx.objectStore(PRODUCTS).clear()
  tx.objectStore(BATCHES).clear()
  tx.objectStore(SALES).clear()
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function loadSnapshot(): Promise<InventorySnapshot> {
  if (remoteBackendConfigured()) {
    try {
      const snapshot = await fetchRemoteSnapshot()
      await cacheSnapshot(snapshot)
      return snapshot
    } catch (error) {
      if (error instanceof AuthError) throw error
      console.warn('Google Sheets backend unavailable; using the last authenticated local cache.', error)
    }
  }
  return loadLocalSnapshot()
}

export async function saveProductWithBatch(product: Product, batch: StockBatch): Promise<void> {
  if (remoteBackendConfigured()) {
    const snapshot = await createRemoteProductWithBatch(product, batch)
    await cacheSnapshot(snapshot)
    return
  }
  const db = await openDb()
  const tx = db.transaction([PRODUCTS, BATCHES], 'readwrite')
  tx.objectStore(PRODUCTS).put(product)
  tx.objectStore(BATCHES).put(batch)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
  db.close()
}

export async function saveBatch(batch: StockBatch): Promise<void> {
  if (remoteBackendConfigured()) {
    const snapshot = await createRemoteBatch(batch)
    await cacheSnapshot(snapshot)
    return
  }
  const db = await openDb()
  const tx = db.transaction(BATCHES, 'readwrite')
  tx.objectStore(BATCHES).put(batch)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function recordSale(sale: Sale, updatedBatches: StockBatch[]): Promise<void> {
  if (remoteBackendConfigured()) {
    const snapshot = await createRemoteSale(sale)
    await cacheSnapshot(snapshot)
    return
  }
  const db = await openDb()
  const tx = db.transaction([BATCHES, SALES], 'readwrite')
  const batchStore = tx.objectStore(BATCHES)
  updatedBatches.forEach((batch) => batchStore.put(batch))
  tx.objectStore(SALES).put(sale)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
  db.close()
}
