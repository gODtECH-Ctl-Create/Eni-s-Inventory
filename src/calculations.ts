import type { Product, Sale, StockBatch } from './types'

export function money(value: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(value)
}

export function stockForProduct(productId: string, batches: StockBatch[]): number {
  return batches
    .filter((batch) => batch.productId === productId)
    .reduce((sum, batch) => sum + batch.quantityRemaining, 0)
}

export function investedAmount(batches: StockBatch[]): number {
  return batches.reduce((sum, batch) => sum + batch.totalPurchaseCost, 0)
}

export function currentStockValue(batches: StockBatch[]): number {
  return batches.reduce((sum, batch) => sum + batch.quantityRemaining * batch.unitCost, 0)
}

export function revenue(sales: Sale[]): number {
  return sales.reduce((sum, sale) => sum + sale.totalAmount, 0)
}

export function grossProfit(sales: Sale[]): number {
  return sales.reduce((sum, sale) => sum + sale.profit, 0)
}

export function expectedProfit(products: Product[], batches: StockBatch[]): number {
  return products.reduce((total, product) => {
    const productBatches = batches.filter((batch) => batch.productId === product.id)
    return total + productBatches.reduce((sum, batch) => {
      return sum + batch.quantityRemaining * Math.max(0, product.defaultSellingPrice - batch.unitCost)
    }, 0)
  }, 0)
}
