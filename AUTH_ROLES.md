# Admin and Staff permissions

## Admin
- Full financial dashboard
- View inventory, purchase cost and selling price
- Add and restock products
- Record sales
- View sales profit
- Create Admin and Staff accounts
- Enable or disable accounts
- Reset passwords
- View attribution in Sales and AuditLog

## Staff
- View inventory and selling prices
- Add and restock products
- Record sales
- View sales revenue/history
- Cannot view purchase cost, investment or profit figures
- Cannot manage users

Authentication and authorization are enforced by the Apps Script backend. The frontend only presents the permissions returned by the logged-in role.
