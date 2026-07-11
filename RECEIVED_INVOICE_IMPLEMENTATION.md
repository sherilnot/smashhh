# Received Invoice Implementation

## Overview
This feature allows shop managers to submit daily invoices of items received from the warehouse to the receiving manager (RM001). This complements the existing checklist system where managers request items from the warehouse.

## Workflow

### Daily Process:
1. **Manager creates checklist** → Sends to Warehouse Manager (existing)
2. **Warehouse prepares items** → May not deliver exact quantities (existing)
3. **Shop Manager receives items** → Creates invoice with actual quantities received (**NEW**)
4. **Shop Manager submits invoice** → Sends to RM001 (**NEW**)
5. **RM001 views invoices** → Reviews what was actually delivered (**NEW**)

## Components Created

### 1. Database Schema (`db/15-received-invoices.sql`)

**Tables:**
- `received_invoices`: Main invoice table
  - Links to store, checklist (optional), and submitting manager
  - Status: 'draft' or 'submitted'
  - Tracks invoice date, submission timestamp, and general notes
  
- `received_invoice_items`: Invoice line items
  - Product name
  - Quantity ordered (from checklist)
  - Quantity received (filled by manager)
  - Item-specific notes

**Features:**
- One invoice per store per day (unique constraint)
- Cascading deletes for data integrity
- Indexed for performance

### 2. Service Layer (`src/services/receivedInvoiceService.js`)

**Functions:**
- `getOrCreateTodayInvoice(managerId)`: Gets or creates today's invoice, auto-populates from checklist if available
- `addInvoiceItem(managerId, invoiceId, productName)`: Adds custom items
- `submitInvoice(managerId, invoiceId, items, generalNotes)`: Submits invoice to RM001
- `getSubmittedInvoices(page, limit)`: Lists all submitted invoices (for RM001)
- `getInvoiceDetail(invoiceId)`: Gets full invoice details including items

### 3. Manager Routes (`src/routes/manager.js`)

**New Routes:**
- `GET /manager/received-invoice`: View/create today's invoice
- `POST /manager/received-invoice/add-item`: Add custom item to invoice
- `POST /manager/received-invoice/submit`: Submit invoice with quantities and notes

### 4. Receiving Manager Routes (`src/routes/receiving-manager.js`)

**New Routes:**
- `GET /receiving-manager/received-invoices`: List all submitted invoices (paginated)
- `GET /receiving-manager/received-invoices/:id`: View detailed invoice

### 5. Views

**Manager View (`src/views/manager/received-invoice.ejs`):**
- Form to enter received quantities for each product
- Item-level notes field for discrepancies
- General notes field for overall delivery comments
- Auto-populates from today's checklist if available
- Add custom items not on checklist
- Submit to RM001
- Read-only view after submission

**RM001 Views:**
- `src/views/receiving-manager/received-invoices.ejs`: List view with pagination
- `src/views/receiving-manager/received-invoice-detail.ejs`: Detailed view with:
  - All items with ordered vs received quantities
  - Automatic discrepancy detection and highlighting
  - Difference calculation (received - ordered)
  - Color-coded differences (green=more, red=less)
  - Item and general notes display

## Installation

### 1. Run Database Migration

Start your Docker containers first:
```bash
docker-compose up -d
```

Then run the migration:
```bash
cat db/15-received-invoices.sql | docker exec -i smash-postgres-1 psql -U smash_user -d smash_db
```

### 2. Restart the Application
```bash
npm start
# or
docker-compose restart
```

## Usage

### For Shop Managers:

1. Log in as a shop manager (e.g., mgr001, password: 123)
2. Navigate to **"Received Invoice"** from the dashboard
3. The invoice will auto-populate from today's checklist if one was submitted
4. Enter actual quantities received for each item
5. Add notes for any discrepancies (e.g., "Ordered 50, only received 45")
6. Add general notes if needed
7. Click **"Submit Invoice to RM001"**
8. Once submitted, the invoice becomes read-only

### For Receiving Manager (RM001):

1. Log in as RM001 (user: RM001, password: 123)
2. Navigate to **"Received Invoices"** from the navigation
3. View list of all submitted invoices from all stores
4. Click **"View Details"** on any invoice to see:
   - All items with ordered vs received quantities
   - Discrepancies highlighted in yellow
   - Color-coded differences
   - Notes from the shop manager

## Features

### Manager Features:
- ✅ Auto-populate from today's checklist
- ✅ Enter received quantities
- ✅ Add item-level notes
- ✅ Add general delivery notes
- ✅ Add custom items not on checklist
- ✅ One invoice per store per day
- ✅ Draft and submitted states
- ✅ Read-only view after submission

### RM001 Features:
- ✅ View all submitted invoices from all stores
- ✅ Paginated list (50 per page)
- ✅ Detailed invoice view
- ✅ Automatic discrepancy detection
- ✅ Visual highlighting of mismatches
- ✅ Difference calculation
- ✅ Store and date information
- ✅ Submission timestamps

### Technical Features:
- ✅ Session-based authentication
- ✅ Role-based access control (store_manager, receiving_manager)
- ✅ Database foreign key constraints
- ✅ Cascading deletes
- ✅ Unique constraints (one invoice per store per day)
- ✅ Indexed for performance
- ✅ Optional link to original checklist

## Database Schema Details

### received_invoices
```sql
- id (UUID, PK)
- store_id (UUID, FK → stores)
- checklist_id (UUID, FK → store_checklists, nullable)
- submitted_by (UUID, FK → users)
- invoice_date (DATE)
- status (VARCHAR: 'draft' | 'submitted')
- submitted_at (TIMESTAMP)
- notes (TEXT)
- created_at (TIMESTAMP)

UNIQUE: (store_id, invoice_date)
```

### received_invoice_items
```sql
- id (UUID, PK)
- invoice_id (UUID, FK → received_invoices)
- product_name (VARCHAR 200)
- quantity_ordered (VARCHAR 50)
- quantity_received (VARCHAR 50)
- item_notes (TEXT)
- sort_order (INTEGER)
- created_at (TIMESTAMP)
```

## Future Enhancements (Not Implemented)

Potential features for future development:
- Email/push notifications to RM001 when invoices are submitted
- Analytics dashboard showing delivery accuracy by warehouse
- Historical discrepancy tracking
- Approval/rejection workflow by RM001
- Export to CSV/Excel
- Photo upload for damaged/missing items
- Integration with inventory management
- Automatic reorder suggestions based on discrepancies

## Testing

### Test Scenario 1: Happy Path
1. Login as mgr001
2. Create and submit a checklist
3. Create a received invoice (should auto-populate)
4. Fill in received quantities
5. Submit invoice
6. Login as RM001
7. View the submitted invoice
8. Verify all data is correct

### Test Scenario 2: Discrepancies
1. Login as mgr001
2. Create checklist requesting 50 of Product A
3. Create invoice and enter 45 received (5 short)
4. Add note: "Warehouse was short 5 units"
5. Submit invoice
6. Login as RM001
7. View invoice - should see discrepancy highlighted
8. Difference should show -5 in red

### Test Scenario 3: Custom Items
1. Login as mgr001
2. Create invoice
3. Add custom item not on checklist
4. Fill in received quantity
5. Submit invoice
6. Login as RM001
7. Verify custom item appears

## Access URLs

- **Manager Invoice**: http://localhost:3000/manager/received-invoice
- **RM001 Invoice List**: http://localhost:3000/receiving-manager/received-invoices
- **RM001 Invoice Detail**: http://localhost:3000/receiving-manager/received-invoices/{invoice-id}

## Notes

- No notifications implemented (as per requirements)
- RM001 has view-only access
- Invoices are date-based (one per store per day)
- Integrates seamlessly with existing checklist system
- Uses same authentication and session management as rest of app
- Follows existing code patterns and conventions
