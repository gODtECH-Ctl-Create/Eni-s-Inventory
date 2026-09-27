export type Product = {
  id: string
  name: string
  category: string
  sku?: string
  image?: string
  defaultSellingPrice: number
  createdAt: string
}

export type StockBatch = {
  id: string
  productId: string
  quantityPurchased: number
  quantityRemaining: number
  totalPurchaseCost: number
  unitCost: number
  purchaseDate: string
  supplier?: string
  notes?: string
}

export type SaleAllocation = {
  batchId: string
  quantity: number
  unitCost: number
}

export type Sale = {
  id: string
  productId: string
  quantity: number
  unitSellingPrice: number
  totalAmount: number
  costOfGoods: number
  profit: number
  soldAt: string
  paymentMethod?: string
  customerName?: string
  allocations: SaleAllocation[]
}

export type InventorySnapshot = {
  products: Product[]
  batches: StockBatch[]
  sales: Sale[]
}
