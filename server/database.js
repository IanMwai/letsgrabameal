const Database = require('better-sqlite3');
const path = require('path');

// Use DATABASE_URL if provided (for Fly.io persistence), otherwise default to local file
const dbPath = process.env.DATABASE_URL || path.resolve(__dirname, 'database.db');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT,
    email TEXT,
    birthday TEXT,
    frequency_days INTEGER NOT NULL DEFAULT 30,
    tags TEXT,
    preferred_contact_method TEXT,
    preferred_meeting_method TEXT,
    last_contact_date TEXT,
    last_notified_at TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS interactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    date TEXT NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
  );
`);

module.exports = db;
