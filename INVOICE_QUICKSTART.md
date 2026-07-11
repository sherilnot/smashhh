# Received Invoice - Quick Start Guide

## Setup (One-time)

1. **Start Docker Desktop** (if not running)

2. **Run the setup script:**
   ```bash
   ./scripts/setup-received-invoices.sh
   ```

   Or manually:
   ```bash
   docker-compose up -d
   cat db/15-received-invoices.sql | docker exec -i smash-postgres-1 psql -U smash_user -d smash_db
   ```

3. **Start the application:**
   ```bash
   npm start
   ```

## How to Use

### As Shop Manager (mgr001):

1. **Login**: http://localhost:3000/login
   - User: `mgr001`
   - Password: `123`

2. **Navigate**: Go to "Received Invoice" (or directly: http://localhost:3000/manager/received-invoice)

3. **Fill the invoice**:
   - Enter quantities received for each item
   - Add notes for any discrepancies
   - Example: "Ordered 50, only received 45 - shortage noted"

4. **Submit**: Click "Submit Invoice to RM001"

### As Receiving Manager (RM001):

1. **Login**: http://localhost:3000/login
   - User: `RM001`
   - Password: `123`

2. **View invoices**: 
   - Navigate to "Received Invoices"
   - Or directly: http://localhost:3000/receiving-manager/received-invoices

3. **Review details**:
   - Click "View Details" on any invoice
   - See discrepancies highlighted in yellow
   - Review notes from shop managers

## Key Features

✅ **Auto-populate from checklist** - Items automatically filled from today's checklist
✅ **Track discrepancies** - Enter actual vs ordered quantities
✅ **Add notes** - Explain shortages or issues
✅ **One per day** - One invoice per store per day
✅ **Read-only after submit** - Can't edit after submission
✅ **Visual discrepancies** - Automatically highlights mismatches

## Workflow Example

```
Morning:
  Manager creates checklist: "Need 50 apples, 30 oranges"
  → Sends to warehouse

Afternoon:
  Warehouse delivers items to store
  Manager receives: 45 apples, 30 oranges (5 apples short!)
  
  Manager creates invoice:
  ✓ Apples: Ordered 50 → Received 45 → Note: "Warehouse shortage"
  ✓ Oranges: Ordered 30 → Received 30 → Note: "Perfect"
  ✓ General notes: "Delivery was late due to traffic"
  
  → Submits to RM001

Evening:
  RM001 reviews all invoices from all stores
  RM001 sees Store A had 5 apples short (highlighted)
  RM001 can follow up with warehouse
```

## URLs

| Role | Page | URL |
|------|------|-----|
| Manager | Create/Submit Invoice | http://localhost:3000/manager/received-invoice |
| RM001 | View All Invoices | http://localhost:3000/receiving-manager/received-invoices |
| RM001 | View Invoice Detail | http://localhost:3000/receiving-manager/received-invoices/{id} |

## Troubleshooting

**"No items in invoice"**
- Make sure you created and submitted a checklist first
- Or manually add items using the "Add Item" button

**"Invoice not found"**
- Check if you're logged in as the correct user
- Managers can only see their own store's invoices
- RM001 can see all submitted invoices

**Database error**
- Make sure Docker is running
- Run the setup script again
- Check `docker ps` to see if containers are up

**Can't submit**
- Make sure at least one item has a received quantity
- Check that you're not trying to edit an already-submitted invoice

## Support

For more details, see: `RECEIVED_INVOICE_IMPLEMENTATION.md`
