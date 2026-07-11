#!/bin/bash

echo "🚀 Web Push Notification Setup"
echo "================================"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ .env file not found!"
    echo "📝 Creating from .env.example..."
    cp .env.example .env
    echo "✅ Created .env file"
fi

# Check if VAPID keys are in .env
if grep -q "VAPID_PUBLIC_KEY" .env; then
    echo "✅ VAPID keys already configured"
else
    echo "⚠️  VAPID keys not found in .env"
    echo "📝 Adding VAPID keys..."
    cat >> .env << EOF

# Web Push VAPID Keys (for browser push notifications)
VAPID_PUBLIC_KEY=BBeWgxHU4ecGw9ShMCSr_E1EuENetFdL_HumNC-4D9UGzl-_xV55TGI1ndgPGmTW0XNq6I35M92YaaqC6hSAhno
VAPID_PRIVATE_KEY=-bWjBQSgc74_LC3pjRvxdiJHRPawS0lYluripwMLCzs
VAPID_SUBJECT=mailto:admin@yourdomain.com
EOF
    echo "✅ VAPID keys added to .env"
fi

echo ""
echo "📊 Checking database..."

# Check if database is running
if ! command -v psql &> /dev/null; then
    echo "⚠️  PostgreSQL client (psql) not found"
    echo "Please install PostgreSQL or run migrations manually"
else
    # Load database config from .env
    export $(grep -v '^#' .env | xargs)
    
    echo "Running database migrations..."
    
    # Run web push migrations
    PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f db/13-webpush-subscriptions.sql 2>/dev/null
    
    if [ $? -eq 0 ]; then
        echo "✅ Database migrations completed"
    else
        echo "⚠️  Database migration may have failed"
        echo "   Run manually: psql -U $DB_USER -d $DB_NAME -f db/13-webpush-subscriptions.sql"
    fi
fi

echo ""
echo "✅ Setup Complete!"
echo ""
echo "📚 Next Steps:"
echo "   1. Start the server: npm start"
echo "   2. Login as an employee"
echo "   3. Visit: http://localhost:3000/employee/dashboard"
echo "   4. Click 'Enable Notifications'"
echo "   5. Grant browser permission"
echo ""
echo "🧪 To test:"
echo "   • Open browser console (F12)"
echo "   • Run: await window.webPushManager.testPushNotification()"
echo "   • Close browser and notification still arrives!"
echo ""
echo "📖 Full guide: See WEBPUSH_GUIDE.md"
echo ""
