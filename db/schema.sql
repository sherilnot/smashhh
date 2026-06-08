-- Run this in psql or pgAdmin

CREATE DATABASE fashionshop;

\c fashionshop;

-- ==============================================================================
-- EMPLOYEE MANAGEMENT SYSTEM SCHEMA
-- ==============================================================================

-- Table 1: Users
-- Stores all system users (employees, store managers, warehouse managers)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(100) UNIQUE NOT NULL,
  password_hash CHAR(60) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('employee', 'store_manager', 'warehouse_manager')),
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone_number VARCHAR(20),
  hourly_wage NUMERIC(10, 2) CHECK (hourly_wage > 0),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT true
);

-- Indexes for users table
CREATE INDEX idx_users_user_id ON users(user_id);
CREATE INDEX idx_users_role ON users(role);


-- Table 2: Sessions
-- Manages user authentication sessions
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  is_active BOOLEAN DEFAULT true,
  CONSTRAINT check_session_expiry CHECK (expires_at > created_at)
);

-- Indexes for sessions table
CREATE INDEX idx_sessions_token ON sessions(session_token);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at) WHERE is_active = true;


-- Table 3: Shifts
-- Defines available work shifts
CREATE TABLE shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  store_location VARCHAR(100) NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT check_shift_times CHECK (end_time > start_time)
);

-- Indexes for shifts table
CREATE INDEX idx_shifts_time_range ON shifts(start_time, end_time);
CREATE INDEX idx_shifts_location ON shifts(store_location);


-- Table 4: Shift Bookings
-- Records employee shift bookings
CREATE TABLE shift_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_status VARCHAR(20) NOT NULL CHECK (booking_status IN ('confirmed', 'completed', 'cancelled', 'no_show')),
  booked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TIMESTAMP
);

-- Unique constraint to prevent duplicate confirmed bookings
CREATE UNIQUE INDEX idx_unique_confirmed_booking 
  ON shift_bookings(shift_id, employee_id) 
  WHERE booking_status = 'confirmed';

-- Indexes for shift_bookings table
CREATE INDEX idx_bookings_shift ON shift_bookings(shift_id);
CREATE INDEX idx_bookings_employee ON shift_bookings(employee_id);
CREATE INDEX idx_bookings_status ON shift_bookings(booking_status);


-- Table 5: Products
-- Product catalog for inventory tracking
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name VARCHAR(200) NOT NULL,
  product_code VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for products table
CREATE INDEX idx_products_code ON products(product_code);


-- Table 6: Expected Deliveries
-- Tracks expected inventory deliveries
CREATE TABLE expected_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  expected_date DATE NOT NULL,
  expected_quantity INTEGER NOT NULL CHECK (expected_quantity > 0),
  warehouse_manager_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for expected_deliveries table
CREATE INDEX idx_deliveries_date ON expected_deliveries(expected_date);
CREATE INDEX idx_deliveries_product ON expected_deliveries(product_id);
CREATE INDEX idx_deliveries_manager ON expected_deliveries(warehouse_manager_id);


-- Table 7: Inventory Checklists
-- Daily checklists for warehouse managers
CREATE TABLE inventory_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_date DATE NOT NULL,
  warehouse_manager_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed')),
  CONSTRAINT unique_checklist_per_manager_date UNIQUE(check_date, warehouse_manager_id)
);

-- Indexes for inventory_checklists table
CREATE INDEX idx_checklists_date ON inventory_checklists(check_date);
CREATE INDEX idx_checklists_manager ON inventory_checklists(warehouse_manager_id);
CREATE INDEX idx_checklists_status ON inventory_checklists(status);


-- Table 8: Checklist Items
-- Individual items in inventory checklists
CREATE TABLE checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id UUID NOT NULL REFERENCES inventory_checklists(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  expected_quantity INTEGER NOT NULL CHECK (expected_quantity > 0),
  actual_quantity INTEGER CHECK (actual_quantity >= 0),
  status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'arrived', 'missing', 'partial')),
  notes TEXT,
  checked_at TIMESTAMP,
  CONSTRAINT unique_checklist_product UNIQUE(checklist_id, product_id)
);

-- Indexes for checklist_items table
CREATE INDEX idx_items_checklist ON checklist_items(checklist_id);
CREATE INDEX idx_items_product ON checklist_items(product_id);
CREATE INDEX idx_items_status ON checklist_items(status);


-- ==============================================================================
-- RETAIL SHOP SCHEMA (EXISTING)
-- ==============================================================================

CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  image_url TEXT
);

-- Note: Products table already exists above for EMS
-- This is the retail shop products table with different structure
CREATE TABLE shop_products (
  id SERIAL PRIMARY KEY,
  category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  price NUMERIC(10, 2) NOT NULL,
  image_url TEXT,
  sizes TEXT DEFAULT 'S, M, L, XL'
);

-- Seed categories
INSERT INTO categories (name, description, image_url) VALUES
  ('Tops', 'Casual and formal tops for every occasion', 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=600&q=80'),
  ('Bottoms', 'Trousers, jeans, and skirts', 'https://images.unsplash.com/photo-1542272604-787c3835535d?w=600&q=80'),
  ('Outerwear', 'Jackets, coats, and layers', 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=600&q=80'),
  ('Accessories', 'Complete your look', 'https://images.unsplash.com/photo-1606760227091-3dd870d97f1d?w=600&q=80');

-- Seed products
INSERT INTO shop_products (category_id, name, description, price, image_url, sizes) VALUES
  (1, 'Linen Boxy Tee', 'Relaxed fit linen tee with dropped shoulders. Breathable and perfect for summer.', 29.99, 'https://images.unsplash.com/photo-1581655353564-df123a1eb820?w=600&q=80', 'XS, S, M, L, XL'),
  (1, 'Ribbed Crop Top', 'Slim ribbed crop top in soft cotton blend. Versatile and minimal.', 24.99, 'https://images.unsplash.com/photo-1564257631407-4deb1f99d992?w=600&q=80', 'XS, S, M, L'),
  (1, 'Oversized Stripe Shirt', 'Classic wide-stripe oversized shirt. Can be worn open or buttoned.', 45.00, 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=600&q=80', 'S, M, L, XL'),

  (2, 'Wide Leg Linen Trousers', 'High-waisted wide leg linen trousers. Effortlessly elegant.', 59.99, 'https://images.unsplash.com/photo-1551854838-212c9a5f8b58?w=600&q=80', 'XS, S, M, L, XL'),
  (2, 'Slim Fit Chinos', 'Clean tailored chinos in stretch cotton. Smart casual staple.', 54.99, 'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=600&q=80', 'S, M, L, XL'),
  (2, 'Denim Straight Jeans', 'Classic straight cut jeans in medium wash. Timeless silhouette.', 69.00, 'https://images.unsplash.com/photo-1582552938357-32b906df40cb?w=600&q=80', 'S, M, L, XL'),

  (3, 'Structured Blazer', 'Sharp single-button blazer in crepe fabric. Office to evening.', 110.00, 'https://images.unsplash.com/photo-1617137968427-85924c800a22?w=600&q=80', 'XS, S, M, L, XL'),
  (3, 'Trench Coat', 'Classic double-breasted trench in water-resistant cotton. A forever piece.', 179.00, 'https://images.unsflash.com/photo-1520975916090-3105956dac38?w=600&q=80', 'S, M, L'),

  (4, 'Canvas Tote', 'Heavy canvas tote with interior pocket. Minimal logo detail.', 35.00, 'https://images.unsplash.com/photo-1591561954557-26941169b49e?w=600&q=80', 'One Size'),
  (4, 'Leather Belt', 'Full grain leather belt with brushed silver buckle.', 49.99, 'https://images.unsplash.com/photo-1624222247344-550fb60583dc?w=600&q=80', 'S, M, L'),
  (4, 'Wool Scarf', 'Soft merino wool scarf in natural undyed tones.', 39.99, 'https://images.unsplash.com/photo-1520903920243-00d872a2d1c9?w=600&q=80', 'One Size');
