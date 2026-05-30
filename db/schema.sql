-- Run this in psql or pgAdmin

CREATE DATABASE fashionshop;

\c fashionshop;

CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  image_url TEXT
);

CREATE TABLE products (
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
INSERT INTO products (category_id, name, description, price, image_url, sizes) VALUES
  (1, 'Linen Boxy Tee', 'Relaxed fit linen tee with dropped shoulders. Breathable and perfect for summer.', 29.99, 'https://images.unsplash.com/photo-1581655353564-df123a1eb820?w=600&q=80', 'XS, S, M, L, XL'),
  (1, 'Ribbed Crop Top', 'Slim ribbed crop top in soft cotton blend. Versatile and minimal.', 24.99, 'https://images.unsplash.com/photo-1564257631407-4deb1f99d992?w=600&q=80', 'XS, S, M, L'),
  (1, 'Oversized Stripe Shirt', 'Classic wide-stripe oversized shirt. Can be worn open or buttoned.', 45.00, 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=600&q=80', 'S, M, L, XL'),

  (2, 'Wide Leg Linen Trousers', 'High-waisted wide leg linen trousers. Effortlessly elegant.', 59.99, 'https://images.unsplash.com/photo-1551854838-212c9a5f8b58?w=600&q=80', 'XS, S, M, L, XL'),
  (2, 'Slim Fit Chinos', 'Clean tailored chinos in stretch cotton. Smart casual staple.', 54.99, 'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=600&q=80', 'S, M, L, XL'),
  (2, 'Denim Straight Jeans', 'Classic straight cut jeans in medium wash. Timeless silhouette.', 69.00, 'https://images.unsplash.com/photo-1582552938357-32b906df40cb?w=600&q=80', 'S, M, L, XL'),

  (3, 'Structured Blazer', 'Sharp single-button blazer in crepe fabric. Office to evening.', 110.00, 'https://images.unsplash.com/photo-1617137968427-85924c800a22?w=600&q=80', 'XS, S, M, L, XL'),
  (3, 'Trench Coat', 'Classic double-breasted trench in water-resistant cotton. A forever piece.', 179.00, 'https://images.unsplash.com/photo-1520975916090-3105956dac38?w=600&q=80', 'S, M, L'),

  (4, 'Canvas Tote', 'Heavy canvas tote with interior pocket. Minimal logo detail.', 35.00, 'https://images.unsplash.com/photo-1591561954557-26941169b49e?w=600&q=80', 'One Size'),
  (4, 'Leather Belt', 'Full grain leather belt with brushed silver buckle.', 49.99, 'https://images.unsplash.com/photo-1624222247344-550fb60583dc?w=600&q=80', 'S, M, L'),
  (4, 'Wool Scarf', 'Soft merino wool scarf in natural undyed tones.', 39.99, 'https://images.unsplash.com/photo-1520903920243-00d872a2d1c9?w=600&q=80', 'One Size');
