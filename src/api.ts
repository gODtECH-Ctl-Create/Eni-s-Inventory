import type { InventorySnapshot, Product, Sale, StockBatch } from './types'

const BACKEND_URL = import.meta.env.VITE_APPS_SCRIPT_URL?.trim() || ''
const ACCESS_KEY_STORAGE = 'eni-inventory-backend-access-key'

type ApiEnvelope<T> = {
  ok: boolean
  data?: T
  error?: string
}

export function remoteBackendConfigured(): boolean {
  return Boolean(BACKEND_URL)
}

function getAccessKey(): string {
  let key = localStorage.getItem(ACCESS_KEY_STORAGE)?.trim() || ''
  if (!key) {
    key = window.prompt("Enter Eni's Inventory backend access key")?.trim() || ''
    if (!key) throw new Error('A backend access key is required.')
    localStorage.setItem(ACCESS_KEY_STORAGE, key)
  }
  return key
}

function clearAccessKey() {
  localStorage.removeItem(ACCESS_KEY_STORAGE)
}

async function callBackend<T>(action: string, payload: unknown = {}): Promise<T> {
  if (!BACKEND_URL) throw new Error('Google Apps Script backend URL is not configured.')

  const accessKey = getAccessKey()
  const response = await fetch(BACKEND_URL, {
    method: 'POST',
    body: JSON.stringify({ action, accessKey, payload }),
    redirect: 'follow',
  })

  if (!response.ok) {
    throw new Error(`Backend request failed with HTTP ${response.status}.`)
  }

  const envelope = await response.json() as ApiEnvelope<T>
  if (!envelope.ok || envelope.data === undefined) {
    if (envelope.error === 'UNAUTHORIZED') {
      clearAccessKey()
      window.alert('The inventory backend access key is incorrect. Please enter it again on the next request.')
    }
    throw new Error(envelope.error || 'The inventory backend returned an error.')
  }

  return envelope.data
}

export function fetchRemoteSnapshot(): Promise<InventorySnapshot> {
  return callBackend<InventorySnapshot>('snapshot')
}

export function createRemoteProductWithBatch(product: Product, batch: StockBatch): Promise<InventorySnapshot> {
  return callBackend<InventorySnapshot>('addProductWithBatch', { product, batch })
}

export function createRemoteBatch(batch: StockBatch): Promise<InventorySnapshot> {
  return callBackend<InventorySnapshot>('addBatch', { batch })
}

export function createRemoteSale(sale: Sale): Promise<InventorySnapshot> {
  return callBackend<InventorySnapshot>('recordSale', {
    sale: {
      id: sale.id,
      productId: sale.productId,
      quantity: sale.quantity,
      unitSellingPrice: sale.unitSellingPrice,
      soldAt: sale.soldAt,
      paymentMethod: sale.paymentMethod,
      customerName: sale.customerName,
    },
  })
}
