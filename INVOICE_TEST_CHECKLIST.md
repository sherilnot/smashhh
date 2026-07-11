# Received Invoice Testing Checklist

## Pre-Testing Setup

- [ ] Docker Desktop is running
- [ ] Run: `./scripts/setup-received-invoices.sh`
- [ ] Database migration completed successfully
- [ ] Application started: `npm start`
- [ ] Browser opened to: http://localhost:3000

## Test 1: Basic Invoice Creation (Shop Manager)

- [ ] Login as **mgr001** / **123**
- [ ] Navigate to "Received Invoice" or go to: `/manager/received-invoice`
- [ ] Verify page loads without errors
- [ ] Check if items are auto-populated from today's checklist (if you created one earlier)
- [ ] If no items, click "Add Item" button
- [ ] Add a product (e.g., "Apples")
- [ ] Verify item appears in the table
- [ ] Enter a received quantity (e.g., "50")
- [ ] Add a note (e.g., "All items in good condition")
- [ ] Add general notes (e.g., "Delivery arrived on time")
- [ ] Click "Submit Invoice to RM001"
- [ ] Verify success message appears
- [ ] Verify invoice shows as "SUBMITTED" (read-only)
- [ ] Try to edit - should not be possible

## Test 2: Invoice with Discrepancies

- [ ] Create a new checklist first (if needed): `/manager/store-checklist`
- [ ] Add items and submit (e.g., "Oranges: 100")
- [ ] Go back to today's invoice: `/manager/received-invoice`
- [ ] Should see "Oranges" with ordered qty of 100
- [ ] Enter received quantity less than ordered (e.g., "85")
- [ ] Add note: "15 units damaged in transit"
- [ ] Submit invoice
- [ ] Verify submission successful

## Test 3: RM001 View (Receiving Manager)

- [ ] Logout or open incognito window
- [ ] Login as **RM001** / **123**
- [ ] Navigate to "Received Invoices" or go to: `/receiving-manager/received-invoices`
- [ ] Verify you see the submitted invoices in the list
- [ ] Check store name, date, submitted by, and submission time are correct
- [ ] Click "View Details" on the first invoice
- [ ] Verify invoice detail page loads
- [ ] Check all items are displayed correctly
- [ ] **Verify discrepancy highlighting**:
  - [ ] Items with mismatched quantities are highlighted in yellow
  - [ ] "DISCREPANCY" badge appears on mismatched items
  - [ ] Difference column shows correct calculation
  - [ ] Negative differences (shortages) appear in red
  - [ ] Positive differences (overages) appear in green
- [ ] Verify notes are displayed correctly
- [ ] Verify general notes are shown at the bottom

## Test 4: Multiple Stores

- [ ] Login as different manager: **mgr002** / **123**
- [ ] Create and submit an invoice for their store
- [ ] Login as RM001
- [ ] Verify both stores' invoices appear in the list
- [ ] Verify each invoice shows correct store name

## Test 5: Date Handling

- [ ] Login as mgr001
- [ ] Create invoice today
- [ ] Submit it
- [ ] Try to create another invoice for today
- [ ] Should load the same submitted invoice (read-only)
- [ ] Should not be able to create duplicate

## Test 6: Edge Cases

### Empty Invoice
- [ ] Login as a manager with no checklist
- [ ] Go to received invoice
- [ ] Submit without adding any items
- [ ] Should still submit successfully

### Special Characters in Notes
- [ ] Add notes with special characters: `<script>alert('test')</script>`
- [ ] Verify they are properly escaped (no XSS)

### Very Long Product Names
- [ ] Add item with long name (100+ characters)
- [ ] Verify it displays correctly
- [ ] Verify it doesn't break layout

### Pagination (RM001)
- [ ] If you have 50+ invoices, verify pagination works
- [ ] Click next/prev page buttons
- [ ] Verify page numbers are correct

## Test 7: Navigation & UI

- [ ] Verify all "Back" buttons work
- [ ] Verify navigation links are correct
- [ ] Verify styling is consistent
- [ ] Test on different screen sizes (responsive)
- [ ] Check for any console errors (F12)

## Test 8: Database Integrity

Open database and verify:
```sql
-- Check tables exist
SELECT * FROM received_invoices LIMIT 1;
SELECT * FROM received_invoice_items LIMIT 1;

-- Check constraints
-- Try to insert duplicate invoice for same store/date (should fail)
INSERT INTO received_invoices (store_id, submitted_by, invoice_date, status)
VALUES ('existing-store-id', 'existing-user-id', '2026-07-11', 'draft');
-- Should error: unique constraint violation

-- Check foreign keys work
-- Try to delete a store that has invoices (should cascade or prevent)
```

## Test 9: Integration with Checklist

- [ ] Login as mgr001
- [ ] Create a checklist with 5 items
- [ ] Submit the checklist
- [ ] Go to received invoice
- [ ] Verify all 5 items are auto-populated
- [ ] Verify quantities match the checklist
- [ ] Modify received quantities
- [ ] Submit invoice
- [ ] Login as RM001
- [ ] View the invoice
- [ ] Verify link to checklist shows (if displayed)

## Test 10: Error Handling

- [ ] Try accessing RM001 routes as a manager (should get 403)
- [ ] Try accessing manager invoice as RM001 (should get 403)
- [ ] Try accessing invoice routes without login (should redirect to login)
- [ ] Try accessing non-existent invoice ID (should show error)

## Expected Results Summary

✅ **All tests should pass without errors**

### Key Validations:
1. Invoices can be created and submitted by shop managers
2. RM001 can view all submitted invoices
3. Discrepancies are automatically detected and highlighted
4. One invoice per store per day constraint works
5. Read-only mode after submission prevents edits
6. Integration with checklists works correctly
7. Notes and timestamps are preserved
8. Pagination works for large datasets
9. Security and access control work correctly
10. UI is responsive and user-friendly

## Issues Found

Document any issues here:

| Test # | Issue Description | Severity | Status |
|--------|------------------|----------|--------|
| | | | |

## Sign-off

- [ ] All tests passed
- [ ] No critical issues found
- [ ] Documentation is accurate
- [ ] Feature is ready for use

**Tested by:** _______________  
**Date:** _______________  
**Notes:** _______________
