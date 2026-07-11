# Received Invoice Workflow

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Daily Checklist & Invoice Flow                │
└─────────────────────────────────────────────────────────────────┘

Step 1: CHECKLIST CREATION (Existing Feature)
┌──────────────┐
│ Shop Manager │ Creates daily checklist
│   (mgr001)   │ "Need: 50 Apples, 30 Oranges, 20 Bananas"
└──────┬───────┘
       │
       ▼
┌──────────────────────┐
│ store_checklists     │
│ - Product names      │
│ - quantity_needed    │
│ - quantity_to_bring  │ ← Manager fills this
└──────┬───────────────┘
       │
       │ Submits to warehouse
       ▼
┌─────────────────┐
│ Warehouse Mgr   │ Reviews and prepares items
│    (wh001)      │
└─────────────────┘


Step 2: DELIVERY & INVOICE CREATION (New Feature)
┌─────────────────┐
│ Physical        │ Warehouse delivers items to store
│ Delivery        │ (May not match exact requested quantities)
└────────┬────────┘
         │
         │ Shop manager receives delivery
         ▼
┌──────────────┐
│ Shop Manager │ Goes to: /manager/received-invoice
│   (mgr001)   │
└──────┬───────┘
       │
       │ System auto-creates invoice
       ▼
┌──────────────────────┐
│ received_invoices    │ AUTO-POPULATED from checklist:
│ ├─ invoice_date      │ - Apples: Ordered 50 → Received __
│ ├─ status: draft     │ - Oranges: Ordered 30 → Received __
│ └─ checklist_id ─────┼─► Links to original checklist
└──────────────────────┘
       │
       │ Manager fills actual received quantities
       ▼
┌──────────────┐
│ Shop Manager │ Enters:
│   (mgr001)   │ - Apples: 45 (5 short!)
└──────┬───────┘ - Oranges: 30 (perfect)
       │         - Bananas: 25 (5 extra!)
       │         
       │ Adds notes:
       │ "5 apples damaged, warehouse sent 5 extra bananas"
       │
       │ Clicks "Submit Invoice to RM001"
       ▼
┌──────────────────────────┐
│ received_invoices        │
│ - status: submitted ✓    │
│ - submitted_at: NOW()    │
└──────────────────────────┘
       │
       │ Read-only after submission
       ▼
┌──────────────┐
│ Invoice sent │
│  to RM001    │
└──────────────┘


Step 3: REVIEW BY RM001 (New Feature)
┌─────────────────────┐
│ Receiving Manager   │ Goes to: /receiving-manager/received-invoices
│     (RM001)         │
└──────┬──────────────┘
       │
       │ Views list of all submitted invoices
       ▼
┌────────────────────────────────────┐
│ Invoice List (All Stores)          │
│ ├─ Store A - July 11, 2026         │ ← Submitted by mgr001
│ ├─ Store B - July 11, 2026         │ ← Submitted by mgr002
│ └─ Store C - July 10, 2026         │ ← Submitted by mgr003
└────────┬───────────────────────────┘
         │
         │ Clicks "View Details" on Store A
         ▼
┌─────────────────────────────────────────────┐
│ Invoice Detail - Store A                    │
│                                              │
│ ┌─────────────┬─────────┬──────────┬────┐  │
│ │ Product     │ Ordered │ Received │ Δ  │  │
│ ├─────────────┼─────────┼──────────┼────┤  │
│ │ Apples 🔶   │   50    │    45    │ -5 │  │ ← DISCREPANCY
│ │ Oranges     │   30    │    30    │  0 │  │
│ │ Bananas 🔶  │   20    │    25    │ +5 │  │ ← DISCREPANCY
│ └─────────────┴─────────┴──────────┴────┘  │
│                                              │
│ Notes:                                       │
│ "5 apples damaged, warehouse sent 5 extra   │
│  bananas as compensation"                    │
│                                              │
│ 🔶 = Highlighted discrepancy                │
└─────────────────────────────────────────────┘
       │
       │ RM001 reviews and takes action
       │ (external to system - maybe contact warehouse)
       ▼
   [Business Decision]
```

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        DATABASE TABLES                       │
└─────────────────────────────────────────────────────────────┘

store_checklists (Existing)              received_invoices (New)
┌─────────────────────┐                 ┌──────────────────────┐
│ id                  │                 │ id                   │
│ store_id           ─┼────────┐       │ store_id            │
│ check_date          │        │       │ checklist_id ────────┼──┐
│ status              │        │       │ invoice_date         │  │
│ submitted_by        │        │       │ status               │  │
│ submitted_at        │        │       │ submitted_by         │  │
└─────────────────────┘        │       │ submitted_at         │  │
         │                     │       │ notes                │  │
         │                     │       └──────────────────────┘  │
         ▼                     │                │                │
store_checklist_items          │                ▼                │
┌─────────────────────┐        │       received_invoice_items   │
│ id                  │        │       ┌──────────────────────┐ │
│ checklist_id        │        │       │ id                   │ │
│ product_name        │        │       │ invoice_id           │ │
│ quantity_needed     │        └───────┼─ product_name        │◄┘
│ quantity_to_bring  ─┼────────────────┼─ quantity_ordered    │
│ sort_order          │   Auto-populates│ quantity_received   │
└─────────────────────┘                │ item_notes           │
                                        │ sort_order           │
                                        └──────────────────────┘
```

## User Roles & Permissions

```
┌───────────────────────────────────────────────────────────┐
│                        ROLES                              │
└───────────────────────────────────────────────────────────┘

Shop Manager (store_manager)
├─ Create daily checklists ✓
├─ Submit checklists to warehouse ✓
├─ Create received invoices ✓ (NEW)
├─ Submit invoices to RM001 ✓ (NEW)
├─ View own store's invoices ✓ (NEW)
└─ Edit draft invoices only ✓ (NEW)

Receiving Manager (receiving_manager)
├─ View all submitted invoices ✓ (NEW)
├─ View invoice details ✓ (NEW)
├─ See discrepancy highlights ✓ (NEW)
└─ Read-only access (no approval flow) ✓ (NEW)

Warehouse Manager (warehouse_manager)
├─ View submitted checklists ✓
├─ Mark checklists as reviewed ✓
└─ No access to invoices
```

## State Machine

```
┌─────────────────────────────────────────────────────────┐
│              Invoice Status Lifecycle                    │
└─────────────────────────────────────────────────────────┘

    ┌─────────┐
    │  START  │
    └────┬────┘
         │
         │ Manager creates invoice
         ▼
    ┌────────────┐
    │   DRAFT    │◄─────┐
    └────┬───────┘      │
         │              │
         │ Can edit:    │ Can re-edit
         │ - Add items  │ before submission
         │ - Edit qtys  │ (future feature)
         │ - Add notes  │
         │              │
         │ Submit       │
         ▼              │
    ┌────────────┐      │
    │ SUBMITTED  │──────┘
    └────┬───────┘
         │
         │ Read-only
         │ Visible to RM001
         │
         ▼
    ┌─────────┐
    │   END   │
    └─────────┘

Note: Currently no "approved" or "rejected" states
      (RM001 has view-only access)
```

## URL Routes

```
┌───────────────────────────────────────────────────────────┐
│                    ROUTE MAPPING                           │
└───────────────────────────────────────────────────────────┘

Shop Manager Routes:
/manager/received-invoice
├─ GET  → View/create today's invoice
├─ POST /add-item → Add custom product
└─ POST /submit → Submit invoice to RM001

RM001 Routes:
/receiving-manager/received-invoices
├─ GET → List all submitted invoices (paginated)
└─ GET /:id → View specific invoice detail

Authentication:
├─ requireAuth middleware → Validates session
└─ roleGuard middleware → Checks role permissions
```

## Integration Points

```
┌─────────────────────────────────────────────────────────┐
│            System Integration Overview                   │
└─────────────────────────────────────────────────────────┘

Existing Checklist System
    │
    ├─ Creates: store_checklists
    ├─ Creates: store_checklist_items
    │
    └─┬─ NEW: Referenced by received_invoices
      │
      ▼
Invoice System (New)
    │
    ├─ Reads: store_checklists (to auto-populate)
    ├─ Reads: store_checklist_items (to copy items)
    │
    ├─ Creates: received_invoices
    └─ Creates: received_invoice_items
           │
           ▼
    Displayed to RM001
```

## Example Scenario

```
TIME: Monday, July 11, 2026

08:00 AM - Manager creates checklist
┌────────────────────────────────┐
│ Store A Daily Checklist        │
│ - Milk: 100 bottles            │
│ - Bread: 200 loaves            │
│ - Eggs: 50 dozens              │
└────────────────────────────────┘
         │
         │ Submit to warehouse
         ▼

09:00 AM - Warehouse prepares order

10:00 AM - Warehouse delivers to Store A

11:00 AM - Manager receives delivery & creates invoice
┌────────────────────────────────────────┐
│ Store A Received Invoice (Draft)      │
│ Auto-populated from checklist:         │
│                                        │
│ Milk:   Ordered 100 → Received [___]  │
│ Bread:  Ordered 200 → Received [___]  │
│ Eggs:   Ordered 50  → Received [___]  │
└────────────────────────────────────────┘

11:15 AM - Manager fills in actual received quantities
┌────────────────────────────────────────┐
│ Store A Received Invoice (Draft)      │
│                                        │
│ Milk:   Ordered 100 → Received [95]   │
│         Note: "5 bottles broken"       │
│                                        │
│ Bread:  Ordered 200 → Received [200]  │
│                                        │
│ Eggs:   Ordered 50  → Received [55]   │
│         Note: "Warehouse sent extra"   │
│                                        │
│ General Notes: "Overall good delivery" │
└────────────────────────────────────────┘

11:20 AM - Manager submits to RM001
         Status: draft → submitted

02:00 PM - RM001 reviews invoices
┌─────────────────────────────────────────┐
│ All Invoices List                       │
│                                         │
│ ✓ Store A - July 11 (11:20 AM) 🔶     │
│ ✓ Store B - July 11 (10:45 AM)         │
│ ✓ Store C - July 11 (09:30 AM) 🔶     │
│                                         │
│ 🔶 = Has discrepancies                 │
└─────────────────────────────────────────┘

02:05 PM - RM001 views Store A details
┌────────────────────────────────────────────┐
│ Store A Invoice - July 11, 2026           │
│                                            │
│ Product  │ Ordered │ Received │ Diff      │
│──────────┼─────────┼──────────┼──────     │
│ Milk 🔶  │   100   │    95    │  -5 🔴   │
│ Bread    │   200   │   200    │   0      │
│ Eggs 🔶  │    50   │    55    │  +5 🟢   │
│                                            │
│ Notes from Manager:                        │
│ - Milk: 5 bottles broken                   │
│ - Eggs: Warehouse sent extra               │
│ - Overall good delivery                    │
└────────────────────────────────────────────┘

02:10 PM - RM001 takes action
         - Notes the milk shortage
         - Contacts warehouse about broken bottles
         - Updates tracking spreadsheet
```

## Benefits

✅ **Accountability**: Track what was ordered vs what was received
✅ **Transparency**: RM001 can see all store deliveries in one place
✅ **Historical Record**: Keep records of all deliveries and discrepancies
✅ **Process Improvement**: Identify patterns (e.g., "Warehouse often shorts milk")
✅ **Dispute Resolution**: Evidence for claims against warehouse
✅ **Inventory Accuracy**: Better reconciliation of inventory records
