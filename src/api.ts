import type {
  AuthUser,
  InventorySnapshot,
  LoginResult,
  Product,
  Sale,
  StockBatch,
  TemporaryPasswordResult,
  UserAccount,
  UserRole,
} from './types'

const BACKEND_URL = import.meta.env.VITE_APPS_SCRIPT_URL?.trim() || ''
const TOKEN_STORAGE = 'eni-inventory-session-token'
const USER_STORAGE = 'eni-inventory-session-user'

type ApiEnvelope<T> = {
  ok: boolean
  data?: T
  error?: string
}

export class AuthError extends Error {}

export function remoteBackendConfigured(): boolean {
  return Boolean(BACKEND_URL)
}

export function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_STORAGE)
    return raw ? JSON.parse(raw) as AuthUser : null
  } catch {
    return null
  }
}

export function hasStoredSession(): boolean {
  return Boolean(localStorage.getItem(TOKEN_STORAGE) && getStoredUser())
}

export function clearStoredSession() {
  localStorage.removeItem(TOKEN_STORAGE)
  localStorage.removeItem(USER_STORAGE)
}

function storeSession(result: LoginResult) {
  localStorage.setItem(TOKEN_STORAGE, result.token)
  localStorage.setItem(USER_STORAGE, JSON.stringify(result.user))
}

async function request<T>(action: string, payload: unknown = {}, authenticated = true): Promise<T> {
  if (!BACKEND_URL) throw new Error('Google Apps Script backend URL is not configured.')
  const token = authenticated ? localStorage.getItem(TOKEN_STORAGE) || '' : ''

  const response = await fetch(BACKEND_URL, {
    method: 'POST',
    body: JSON.stringify({ action, token, payload }),
    redirect: 'follow',
  })

  if (!response.ok) throw new Error(`Backend request failed with HTTP ${response.status}.`)
  const envelope = await response.json() as ApiEnvelope<T>

  if (!envelope.ok || envelope.data === undefined) {
    const message = envelope.error || 'The inventory backend returned an error.'
    if (['UNAUTHENTICATED', 'SESSION_EXPIRED', 'INVALID_CREDENTIALS'].includes(message)) {
      if (message !== 'INVALID_CREDENTIALS') clearStoredSession()
      throw new AuthError(message)
    }
    throw new Error(message)
  }

  return envelope.data
}

export async function login(username: string, password: string): Promise<LoginResult> {
  const result = await request<LoginResult>('login', { username, password }, false)
  storeSession(result)
  return result
}

export async function logout(): Promise<void> {
  try {
    if (hasStoredSession()) await request<{ success: boolean }>('logout')
  } finally {
    clearStoredSession()
  }
}

export async function changeOwnPassword(currentPassword: string, newPassword: string): Promise<void> {
  await request<{ success: boolean }>('changeOwnPassword', { currentPassword, newPassword })
  clearStoredSession()
}

export function fetchRemoteSnapshot(): Promise<InventorySnapshot> {
  return request<InventorySnapshot>('snapshot')
}

export function createRemoteProductWithBatch(product: Product, batch: StockBatch): Promise<InventorySnapshot> {
  return request<InventorySnapshot>('addProductWithBatch', { product, batch })
}

export function createRemoteBatch(batch: StockBatch): Promise<InventorySnapshot> {
  return request<InventorySnapshot>('addBatch', { batch })
}

export function createRemoteSale(sale: Sale): Promise<InventorySnapshot> {
  return request<InventorySnapshot>('recordSale', {
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

export function listUsers(): Promise<UserAccount[]> {
  return request<UserAccount[]>('listUsers')
}

export function createUser(username: string, displayName: string, role: UserRole): Promise<TemporaryPasswordResult> {
  return request<TemporaryPasswordResult>('createUser', { username, displayName, role })
}

export function setUserActive(userId: string, active: boolean): Promise<UserAccount> {
  return request<UserAccount>('setUserActive', { userId, active })
}

export function resetUserPassword(userId: string): Promise<TemporaryPasswordResult> {
  return request<TemporaryPasswordResult>('resetUserPassword', { userId })
}
