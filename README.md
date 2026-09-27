# Eni's Inventory

A mobile-first, offline-first inventory and profit tracking PWA for small product businesses such as jewelry and accessories.

## Current MVP

- Add products and stock in purchase batches
- Capture/upload product photos
- Track purchase cost, selling price and remaining quantity
- Record sales with FIFO batch costing
- Automatically calculate revenue, cost of goods sold and gross profit
- Dashboard for money invested, stock value, revenue, profit and expected profit
- Sales history
- IndexedDB persistence in the browser
- Installable PWA and service-worker caching
- GitHub Pages compatible (`/Eni-s-Inventory/` base path)

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deployment

The repository includes a GitHub Actions workflow that builds and deploys `main` to GitHub Pages. If Pages has not been enabled yet, set the repository's Pages source to **GitHub Actions** in the repository settings.

## Data note

The first version stores business data and images in the browser using IndexedDB. This makes it fast and usable offline, but the data is tied to that browser/device. A cloud-sync phase should add authentication, PostgreSQL storage, and object storage for product images so the same inventory can be accessed safely from multiple devices.
