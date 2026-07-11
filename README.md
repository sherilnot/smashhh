# smashhh

## Features

### Daily Checklist & Invoice System
- **Store Checklists**: Managers create daily checklists and send to warehouse manager
- **Received Invoices**: Shop managers report actual quantities received from warehouse to RM001
- Tracks discrepancies between ordered and received quantities
- See: [INVOICE_QUICKSTART.md](INVOICE_QUICKSTART.md) for setup and usage

### Other Features
- Employee shift booking and management
- Weekly roster and timesheet management
- Wage tracking and management
- Web push notifications
- And more...

## Quick Setup for Invoice Feature

```bash
# 1. Start Docker
docker-compose up -d

# 2. Run setup script
./scripts/setup-received-invoices.sh

# 3. Start app
npm start
```

**Access:**
- Shop Manager: http://localhost:3000/manager/received-invoice (mgr001 / 123)
- RM001: http://localhost:3000/receiving-manager/received-invoices (RM001 / 123)

For full documentation, see [RECEIVED_INVOICE_IMPLEMENTATION.md](RECEIVED_INVOICE_IMPLEMENTATION.md)
# smashtest
