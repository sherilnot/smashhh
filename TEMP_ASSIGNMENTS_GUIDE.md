# Temporary Store Assignments Feature

## Overview
Store managers can now temporarily assign employees from other stores to work single shifts at their store. This feature is fully integrated with the timesheet system and includes comprehensive validation to prevent scheduling conflicts.

## Key Features

### For Store Managers
- **Intuitive Assignment Interface**: Easy-to-use form to create temporary assignments
- **Dynamic Shift Loading**: Select a store to see available shifts with capacity information
- **Employee Selection**: View all employees from other stores organized by their home store
- **Two-way Visibility**: 
  - **Incoming**: Employees coming to work at your store
  - **Outgoing**: Your employees assigned to other stores
- **Cancellation**: Cancel assignments before shifts start
- **Notes**: Add optional notes explaining the reason for the assignment

### Timesheet Integration
- Temporary assignments automatically appear on timesheets
- Visual indicator (📥 Temp) shows which shifts were worked by temporarily assigned employees
- Tracks the actual store where work was performed
- No manual adjustments needed

## Database Changes

### New Table: `temporary_store_assignments`
```sql
- id: UUID (primary key)
- shift_booking_id: UUID (unique, references shift_bookings)
- employee_id: UUID (references users)
- from_store_id: UUID (employee's home store)
- to_store_id: UUID (store where they're temporarily working)
- assigned_by_manager_id: UUID (manager who created the assignment)
- assigned_at: TIMESTAMP
- notes: TEXT (optional)
```

### Modified Tables
- **shift_bookings**: Added `is_temporary_assignment` boolean flag
- **timesheet_entries**: Added `worked_at_store_id` to track where work was performed

## API Endpoints

### GET /manager/temporary-assignments
Main page showing the assignment interface and lists of incoming/outgoing assignments.

### POST /manager/temporary-assignments/create
Create a new temporary assignment.
- **Parameters**: `employeeId`, `shiftId`, `notes` (optional)
- **Validation**:
  - Manager must own a store
  - Shift must exist and have capacity
  - Employee must be from a different store
  - Shift cannot be in the past
  - Employee cannot already be booked for that shift

### POST /manager/temporary-assignments/cancel/:assignmentId
Cancel a temporary assignment.
- **Validation**:
  - Manager must own either source or destination store
  - Shift cannot have already started
  - Shift cannot be completed

### GET /manager/api/temporary-assignments/shifts/:storeId
Get available shifts for a specific store (used for dynamic loading).

## How to Use

### Creating a Temporary Assignment

1. **Navigate**: Click "Temp Assignments" in the manager sidebar
2. **Select Employee**: Choose an employee from another store (organized by store name)
3. **Select Store**: Pick a store to see its available shifts
4. **Select Shift**: Choose a shift with available capacity
5. **Add Notes** (optional): Explain why this assignment is needed
6. **Create**: Click "Create Assignment"

### Managing Assignments

- **View Incoming**: See all employees coming to your store (green border)
- **View Outgoing**: See your employees going to other stores (orange border)
- **Cancel**: Click "Cancel" on any assignment before the shift starts
- **Status Tracking**: See if assignments are confirmed or completed

### Timesheet Impact

When you generate your timesheet:
- Temporarily assigned employees appear in your timesheet
- Their shifts show a "📥 Temp" indicator
- Hours are counted normally for payroll
- The original store manager will NOT see these hours (they worked at your store)

## Validation & Error Prevention

The system prevents errors through:

1. **Store Exclusivity**: Can only assign employees from different stores
2. **Capacity Check**: Cannot assign to full shifts
3. **Duplicate Prevention**: Employee cannot have multiple bookings for same shift
4. **Time Validation**: Cannot assign to past shifts
5. **Permission Check**: Only managers of involved stores can cancel
6. **Status Check**: Cannot cancel completed or in-progress shifts

## Technical Details

### Services
- **temporaryAssignmentService.js**: Core business logic
  - `createTemporaryAssignment()`: Create new assignment with validation
  - `getIncomingAssignments()`: Get employees coming to manager's store
  - `getOutgoingAssignments()`: Get employees leaving manager's store
  - `cancelTemporaryAssignment()`: Cancel assignment with permissions check
  - `getAvailableEmployees()`: List employees from other stores

### Views
- **manager/temporary-assignments.ejs**: Main interface
- **manager/timesheet.ejs**: Updated to show temp assignment indicators

### Database Integration
- Automatic tracking of worked_at_store_id in timesheet entries
- Seamless integration with existing shift booking system
- Proper foreign key constraints ensure data integrity

## Benefits

1. **Flexibility**: Handle staffing shortages by borrowing from other stores
2. **No Manual Work**: Timesheets update automatically
3. **Error-Free**: Comprehensive validation prevents scheduling conflicts
4. **Transparent**: Both managers see the assignments
5. **Trackable**: Full audit trail of who assigned whom and when

## Future Enhancements (Optional)

- Employee notifications when assigned to another store
- Approval workflow (employee must accept assignment)
- Recurring temporary assignments
- Analytics on cross-store assignments
- Travel time/allowance tracking

## Files Modified

**Database**:
- `/db/26-temporary-store-assignments.sql`

**Backend**:
- `/src/services/temporaryAssignmentService.js` (new)
- `/src/services/timesheetService.js` (updated)
- `/src/routes/manager.js` (updated)

**Frontend**:
- `/src/views/manager/temporary-assignments.ejs` (new)
- `/src/views/manager/timesheet.ejs` (updated)
- `/src/views/partials/header.ejs` (updated)

## Testing Checklist

- [ ] Create a temporary assignment
- [ ] Verify it appears in incoming list
- [ ] Verify the other manager sees it in outgoing list
- [ ] Complete the shift
- [ ] Check timesheet shows temp indicator
- [ ] Verify hours are counted correctly
- [ ] Test cancellation before shift starts
- [ ] Test validation errors (duplicate booking, past shift, etc.)
- [ ] Test with shifts at capacity
- [ ] Test with employees from multiple stores
