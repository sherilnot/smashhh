require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const client = new Client({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

let sql = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');

// Remove psql-specific commands that don't work in Node.js
sql = sql.replace(/^\\c\s+\S+;?\s*$/gm, '');
sql = sql.replace(/^CREATE DATABASE.+;$/gm, '');

client.connect()
  .then(() => client.query(sql))
  .then(() => { console.log('✅ Database initialized'); client.end(); })
  .catch(err => { console.error('❌ Error:', err.message); client.end(); });