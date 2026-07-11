# Data Reset Guide

## Quick Reset Command

To delete all roster, timesheet, and shift data:

```bash
npm run db:reset-data
```

## What Gets Deleted

This command removes all data from the following tables:

1. ✅ **weekly_submissions** - Employee booking confirmations
2. ✅ **timesheet_wage_overrides** - Manager wage adjustments
3. ✅ **timesheet_entries** - Individual shift records in timesheets
4. ✅ **timesheets** - Weekly timesheet submissions
5. ✅ **shift_bookings** - Employee shift reservations
6. ✅ **shifts** - Available shift slots

## What Stays Intact

- ✓ Users (employees, managers)
- ✓ Stores
- ✓ Products
- ✓ Store assignments
- ✓ All other system data

## When To Use

- 🔄 Starting a new roster cycle
- 🧹 Clearing test data
- 🐛 Resetting after testing
- 🆕 Starting fresh with roster management

## Manual SQL Reset

If you prefer to run SQL directly:

```bash
psql -h localhost -U your_user -d your_database -f db/reset-all-data.sql
```

Or connect to your database and run:

```sql
-- See db/reset-all-data.sql for the complete script
```

## Verification

After reset, all table counts should be **0**. The script automatically verifies this.

## Next Steps After Reset

1. **Create new shifts** (Manager creates roster for upcoming week)
2. **Employees book shifts** (Wednesday-Saturday booking window)
3. **Manager finalizes** (Manager confirms bookings)
4. **Timesheets auto-generated** (After shifts complete)

---

**⚠️ Warning**: This operation cannot be undone. Always backup production data before resetting!
