#!/bin/bash

# Setup script for Received Invoice feature
# This script runs the database migration for the invoice system

echo "======================================"
echo "Setting up Received Invoice System"
echo "======================================"
echo ""

# Check if Docker is running
if ! docker ps > /dev/null 2>&1; then
    echo "❌ Error: Docker is not running!"
    echo "Please start Docker Desktop and try again."
    exit 1
fi

echo "✓ Docker is running"
echo ""

# Check if PostgreSQL container is running
if ! docker ps --format '{{.Names}}' | grep -q "postgres"; then
    echo "❌ Error: PostgreSQL container is not running!"
    echo "Starting containers with docker-compose..."
    docker-compose up -d
    echo "Waiting for database to be ready..."
    sleep 5
fi

echo "✓ PostgreSQL container is running"
echo ""

# Run the migration
echo "Running database migration..."
cat db/15-received-invoices.sql | docker exec -i $(docker ps --format '{{.Names}}' | grep postgres) psql -U smash_user -d smash_db

if [ $? -eq 0 ]; then
    echo ""
    echo "======================================"
    echo "✓ Setup completed successfully!"
    echo "======================================"
    echo ""
    echo "The Received Invoice system is now ready to use."
    echo ""
    echo "Manager access:"
    echo "  URL: http://localhost:3000/manager/received-invoice"
    echo "  Login: mgr001 / 123"
    echo ""
    echo "RM001 access:"
    echo "  URL: http://localhost:3000/receiving-manager/received-invoices"
    echo "  Login: RM001 / 123"
    echo ""
else
    echo ""
    echo "❌ Migration failed!"
    echo "Please check the error messages above."
    exit 1
fi
