# Eni's Inventory

A mobile-first inventory and profit tracking PWA for small product businesses such as jewelry and accessories.

## Architecture

- **Frontend:** React + TypeScript + Vite PWA on GitHub Pages
- **Backend/API:** Google Apps Script Web App
- **Primary data store:** Google Sheets
- **Product images:** Google Drive via Apps Script
- **Local cache:** IndexedDB for fast loading and read access when the backend is temporarily unavailable

Google Sheets is the source of truth. Stock can be entered from the PWA or directly from the spreadsheet using the human-friendly **Stock Intake** tab created by Apps Script.

## Current MVP

- Add new products from the app
- Restock existing products as separate purchase batches
- Add inventory directly from the Google Sheet `Stock Intake` tab
- Capture/upload product photos from the app
- Store uploaded product photos in Google Drive
- Track purchase cost, selling price and remaining quantity
- Record sales with server-side FIFO batch costing
- Automatically calculate revenue, cost of goods sold and gross profit
- Dashboard for money invested, stock value, revenue, profit and expected profit
- Sales history
- Installable PWA and service-worker caching
- GitHub Pages compatible (`/Eni-s-Inventory/` base path)

## Google Sheet setup

1. Create a new Google Sheet for Eni's Inventory.
2. In the Sheet, open **Extensions → Apps Script**.
3. Copy the contents of `apps-script/Code.gs` into the Apps Script editor.
4. Save the project.
5. Run `setupInventoryBackend()` once from the Apps Script editor and approve the requested permissions.
6. The script creates these tabs automatically:
   - `Stock Intake`
   - `Products`
   - `Batches`
   - `Sales`
   - `SaleAllocations`
7. Copy the backend access key shown by the setup dialog. Keep it private.
8. Deploy the script through **Deploy → New deployment → Web app**.
9. Set **Execute as** to yourself and make the Web App accessible to **Anyone**.
10. Copy the production URL ending in `/exec`.

The frontend asks for the access key the first time it connects. The key is stored only in that browser's local storage; it is not committed to this repository or injected into the public JavaScript bundle.

## Connect GitHub Pages to Apps Script

In the GitHub repository, create an Actions repository variable:

```text
Name:  VITE_APPS_SCRIPT_URL
Value: https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
```

Path in GitHub:

```text
Settings → Secrets and variables → Actions → Variables → New repository variable
```

The Pages workflow injects this URL during the build. The URL itself is not treated as a secret; write/read access is protected by the separate access key generated inside Apps Script.

For local development, copy `.env.example` to `.env.local` and replace the placeholder with the `/exec` URL.

## Adding stock directly from Google Sheets

Use the `Stock Intake` tab rather than manually creating IDs in the backend tables.

Fill in a row with:

- Product name
- Category
- SKU (optional)
- Image URL (optional when entering through the Sheet)
- Quantity
- Total purchase cost
- Selling price
- Purchase date
- Supplier (optional)
- Notes (optional)

As soon as the required values are present, the Sheet's `onEdit` Apps Script processes the row. It creates or matches the product, creates a new purchase batch, calculates unit cost, and marks the row as `ADDED`.

This means a seller can add stock from either place:

```text
PWA → Apps Script → Google Sheets

or

Google Sheet Stock Intake → Apps Script → Products/Batches
```

The next refresh in the PWA pulls the same data from the Sheet.

## Sales and FIFO costing

Sales should be recorded through the app. The Apps Script backend performs the FIFO allocation against the current Sheet data, records the sale, writes its batch allocations, and returns the refreshed inventory snapshot. This keeps profit calculations consistent even when new stock was entered directly in the Sheet.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Build

```bash
npm run build
```

## Deployment

The repository includes a GitHub Actions workflow that builds and deploys `main` to GitHub Pages. If Pages has not been enabled yet, set the repository's Pages source to **GitHub Actions** in the repository settings.

## Offline behavior

When the Google Apps Script backend is configured, Google Sheets is authoritative. The latest successful server snapshot is cached in IndexedDB so inventory can still be viewed if connectivity drops. For now, new stock and sales require a connection to the backend; an offline write queue can be added later without changing the Sheet schema.
