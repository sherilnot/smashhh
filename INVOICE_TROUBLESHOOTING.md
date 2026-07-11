# Received Invoice System - Troubleshooting Guide

## Common Issues & Solutions

### 🔴 Setup Issues

#### Issue: "Docker is not running"
**Error**: `failed to connect to the docker API`

**Solution**:
1. Open Docker Desktop application
2. Wait for it to fully start (green indicator)
3. Run `docker ps` to verify it's working
4. Try the setup script again

#### Issue: "PostgreSQL container not found"
**Error**: `smash-postgres-1 not found`

**Solution**:
```bash
# Check running containers
docker ps

# If not running, start them
docker-compose up -d

# Wait 10 seconds for database to initialize
sleep 10

# Try setup again
./scripts/setup-received-invoices.sh
```

#### Issue: "Database migration fails"
**Error**: `relation "received_invoices" already exists`

**Solution**: This means the tables already exist (migration already ran). This is fine - you can skip this step.

To verify:
```bash
docker exec -it smash-postgres-1 psql -U smash_user -d smash_db -c "\dt received*"
```

Should show:
- received_invoices
- received_invoice_items

#### Issue: "Permission denied on setup script"
**Error**: `permission denied: ./scripts/setup-received-invoices.sh`

**Solution**:
```bash
chmod +x ./scripts/setup-received-invoices.sh
./scripts/setup-received-invoices.sh
```

---

### 🔴 Login Issues

#### Issue: "Invalid credentials"
**Problem**: Can't log in

**Solution**:
- Check you're using the right credentials:
  - **Manager**: mgr001 / 123
  - **RM001**: RM001 / 123
- Note: user IDs are case-sensitive
- Clear browser cookies if previously logged in as different user

#### Issue: "Redirected to login page"
**Problem**: Keep getting redirected to /login

**Solution**:
- Session might have expired (8 hour timeout)
- Clear cookies and log in again
- Make sure cookies are enabled in your browser

---

### 🔴 Invoice Creation Issues

#### Issue: "No store assignment exists"
**Problem**: Can't create invoice

**Solution**:
- Check that the manager is assigned to a store
- Verify in database:
```sql
SELECT * FROM store_manager_assignments WHERE manager_id = 'USER_ID';
```
- If no assignment, create one in the database

#### Issue: "Invoice has no items"
**Problem**: Invoice page is empty

**Solution**: Two options:
1. **Create a checklist first**:
   - Go to `/manager/store-checklist`
   - Add items and submit
   - Go back to `/manager/received-invoice`
   - Items should auto-populate

2. **Add items manually**:
   - Click "Add Item" button
   - Enter product name
   - Submit

#### Issue: "Can't edit invoice"
**Problem**: Form fields are disabled

**Solution**: Invoice was already submitted (status = 'submitted')
- Submitted invoices are read-only
- This is intentional to maintain data integrity
- Create a new invoice for a different date

#### Issue: "Can't submit invoice"
**Problem**: Submit button doesn't work

**Troubleshooting**:
1. Check browser console (F12) for JavaScript errors
2. Verify at least one item exists
3. Check network tab for failed requests
4. Ensure you're logged in as a manager (not RM001)

---

### 🔴 RM001 Viewing Issues

#### Issue: "No invoices found"
**Problem**: RM001 sees empty list

**Solution**:
- No invoices have been submitted yet
- Have a manager create and submit an invoice first
- Verify invoices exist in database:
```sql
SELECT * FROM received_invoices WHERE status = 'submitted';
```

#### Issue: "404 - Invoice not found"
**Problem**: Can't view invoice detail

**Solution**:
- Invoice ID in URL might be wrong
- Invoice might have been deleted
- Try going back to list and clicking "View Details" again
- Check database:
```sql
SELECT id FROM received_invoices WHERE id = 'INVOICE_ID';
```

#### Issue: "403 Forbidden"
**Problem**: Access denied

**Solution**:
- You might be logged in as the wrong user
- Managers can only access `/manager/*` routes
- RM001 can only access `/receiving-manager/*` routes
- Log out and log in as the correct user

---

### 🔴 Discrepancy Display Issues

#### Issue: "Discrepancies not highlighted"
**Problem**: Differences not showing in color

**Solution**:
- Check that both ordered and received quantities are numbers
- Verify quantities are different (0 difference = no highlight)
- Clear browser cache (Ctrl+F5 or Cmd+Shift+R)
- Check browser console for CSS errors

#### Issue: "Difference calculation wrong"
**Problem**: Math doesn't add up

**Solution**:
- Difference = Received - Ordered
- Example: Ordered 50, Received 45 = -5 (shortage)
- Example: Ordered 50, Received 55 = +5 (overage)
- If quantities are non-numeric, difference will show "-"

---

### 🔴 Database Issues

#### Issue: "Duplicate entry error"
**Error**: `duplicate key value violates unique constraint`

**Cause**: Trying to create second invoice for same store on same day

**Solution**: This is correct behavior - only one invoice per store per day
- Load existing invoice instead
- System automatically does this when you visit `/manager/received-invoice`

#### Issue: "Foreign key constraint violation"
**Error**: `violates foreign key constraint`

**Solution**:
- Store ID doesn't exist
- User ID doesn't exist
- Checklist ID doesn't exist (if referenced)
- Verify referenced records exist in database

#### Issue: "Connection timeout"
**Error**: `Connection to database failed`

**Solution**:
```bash
# Check if PostgreSQL is running
docker ps | grep postgres

# Check if it's accepting connections
docker exec -it smash-postgres-1 pg_isready

# Restart if needed
docker-compose restart postgres
```

---

### 🔴 UI/Display Issues

#### Issue: "Page looks broken"
**Problem**: CSS not loading

**Solution**:
- Clear browser cache
- Check that `public/css/theme.css` exists
- Verify Express static middleware is configured
- Check browser console for 404 errors

#### Issue: "Submit button missing"
**Problem**: Can't find submit button

**Solution**:
- Scroll down - might be below the fold
- If invoice is already submitted, button won't appear
- Check that status is 'draft' not 'submitted'

#### Issue: "Pagination not working"
**Problem**: Can't navigate pages

**Solution**:
- You might not have enough invoices (need 51+ for page 2)
- Check that URL parameters are correct (?page=2)
- Verify JavaScript is enabled

---

### 🔴 Performance Issues

#### Issue: "Page loads slowly"
**Problem**: Takes long time to load

**Solution**:
- Check database indexes exist:
```sql
\di received*
```
- Should show indexes on:
  - `idx_ri_store`
  - `idx_ri_status`
  - `idx_ri_date`
  - `idx_rii_invoice`
- If missing, re-run migration

#### Issue: "Pagination slow"
**Problem**: Moving between pages is slow

**Solution**:
- Check LIMIT/OFFSET queries are using indexes
- Verify you don't have millions of records
- Consider adding more indexes if needed

---

### 🔴 Data Issues

#### Issue: "Wrong store name displayed"
**Problem**: Showing incorrect store

**Solution**:
- Check store_manager_assignments table
- Verify manager is assigned to correct store
- Check foreign key references

#### Issue: "Submitted by wrong person"
**Problem**: Invoice shows wrong submitter

**Solution**:
- Check you're logged in as correct user
- Verify req.user.userId is correct
- Check sessions table for correct user_id

#### Issue: "Notes not saving"
**Problem**: Notes disappear after submit

**Solution**:
- Check that notes are being sent in POST request
- Verify database column allows TEXT (not VARCHAR)
- Check for SQL errors in server logs
- Verify form field name matches backend

---

### 🔴 Integration Issues

#### Issue: "Checklist items not auto-populating"
**Problem**: Invoice doesn't populate from checklist

**Solution**:
- Checklist must be submitted first (status = 'submitted' or 'reviewed')
- Checklist must be for same store and same date
- Check query in `getOrCreateTodayInvoice` function
- Verify checklist_id is being set correctly

#### Issue: "Can't find checklist"
**Problem**: System can't locate today's checklist

**Solution**:
```sql
-- Check if checklist exists
SELECT * FROM store_checklists 
WHERE store_id = 'YOUR_STORE_ID' 
AND check_date = CURRENT_DATE
AND status IN ('submitted', 'reviewed');
```

---

## 🔍 Debugging Tools

### Check User Session
```sql
SELECT * FROM sessions WHERE user_id = 'YOUR_USER_ID';
```

### Check User Role
```sql
SELECT user_id, role, is_active FROM users WHERE user_id = 'mgr001';
```

### Check Store Assignment
```sql
SELECT u.user_id, s.name as store_name
FROM users u
JOIN store_manager_assignments sma ON sma.manager_id = u.id
JOIN stores s ON s.id = sma.store_id
WHERE u.user_id = 'mgr001';
```

### Check Today's Invoices
```sql
SELECT ri.id, s.name, ri.status, ri.invoice_date
FROM received_invoices ri
JOIN stores s ON s.id = ri.store_id
WHERE ri.invoice_date = CURRENT_DATE;
```

### Check Invoice Items
```sql
SELECT * FROM received_invoice_items 
WHERE invoice_id = 'YOUR_INVOICE_ID'
ORDER BY sort_order;
```

### Check Submitted Invoices
```sql
SELECT 
  ri.invoice_date,
  s.name as store_name,
  u.user_id as submitted_by,
  COUNT(rii.id) as item_count
FROM received_invoices ri
JOIN stores s ON s.id = ri.store_id
JOIN users u ON u.id = ri.submitted_by
LEFT JOIN received_invoice_items rii ON rii.invoice_id = ri.id
WHERE ri.status = 'submitted'
GROUP BY ri.id, s.name, u.user_id, ri.invoice_date
ORDER BY ri.invoice_date DESC;
```

---

## 🛠️ Quick Fixes

### Reset Everything
```bash
# Stop containers
docker-compose down

# Remove volumes (WARNING: deletes all data!)
docker-compose down -v

# Start fresh
docker-compose up -d
npm run init-db
npm run seed-data

# Run invoice migration
./scripts/setup-received-invoices.sh
```

### Clear Browser Data
1. Open DevTools (F12)
2. Application tab → Storage → Clear site data
3. Hard refresh (Ctrl+F5 or Cmd+Shift+R)

### Check Server Logs
```bash
# If running with npm start
# Logs appear in terminal

# If running with docker-compose
docker-compose logs -f app

# Check specific service
docker-compose logs -f postgres
```

### Restart Application
```bash
# If running locally
# Ctrl+C then npm start

# If running with docker
docker-compose restart
```

---

## 📞 Still Having Issues?

If you've tried everything above:

1. **Check server logs**: Look for error messages
2. **Check browser console**: Press F12, look for red errors
3. **Verify database**: Use SQL queries above to check data
4. **Test with fresh user**: Try mgr002 instead of mgr001
5. **Review implementation**: Check `RECEIVED_INVOICE_IMPLEMENTATION.md`
6. **Run test checklist**: Follow `INVOICE_TEST_CHECKLIST.md`

---

## 🐛 Reporting Issues

If you find a bug, document:
- What you were trying to do
- What happened instead
- Steps to reproduce
- Error messages (server logs + browser console)
- User account used
- URL accessed
- Browser and version

---

## ✅ Health Check

Run this to verify system is healthy:

```bash
# 1. Docker running?
docker ps

# 2. Database accessible?
docker exec -it smash-postgres-1 pg_isready

# 3. Tables exist?
docker exec -it smash-postgres-1 psql -U smash_user -d smash_db -c "\dt received*"

# 4. App running?
curl http://localhost:3000/login

# 5. Can authenticate?
curl -c cookies.txt -d "userId=mgr001&password=123" http://localhost:3000/auth/login

# 6. Can access invoice page?
curl -b cookies.txt http://localhost:3000/manager/received-invoice
```

All should return success (no errors).
