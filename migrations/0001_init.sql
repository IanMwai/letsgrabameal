CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT,
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

CREATE INDEX IF NOT EXISTS idx_interactions_contact_date
  ON interactions(contact_id, date DESC);

CREATE TABLE IF NOT EXISTS notification_runs (
  run_date TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL
);
