#!/usr/bin/env node

import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
let Database;

try {
  Database = require('better-sqlite3');
} catch {
  Database = serverRequire('better-sqlite3');
}

const [, , inputPath = 'server/database.db', outputPath = 'migrations/import-data.sql'] = process.argv;
const sourcePath = resolve(inputPath);
const targetPath = resolve(outputPath);
const db = new Database(sourcePath, { readonly: true });

const contacts = db
  .prepare(`
    SELECT
      id,
      first_name,
      last_name,
      birthday,
      frequency_days,
      tags,
      preferred_contact_method,
      preferred_meeting_method,
      last_contact_date,
      last_notified_at,
      created_at
    FROM contacts
    ORDER BY id
  `)
  .all();

const interactions = db
  .prepare(`
    SELECT
      id,
      contact_id,
      type,
      date,
      notes,
      created_at
    FROM interactions
    ORDER BY id
  `)
  .all();

const lines = [
  ...contacts.map((row) => insertStatement('contacts', row)),
  ...interactions.map((row) => insertStatement('interactions', row)),
  '',
];

mkdirSync(dirname(targetPath), { recursive: true });
writeFileSync(targetPath, lines.join('\n'));

console.log(`Exported ${contacts.length} contacts and ${interactions.length} interactions to ${targetPath}`);

function insertStatement(table, row) {
  const columns = Object.keys(row);
  const values = columns.map((column) => sqlValue(row[column]));

  return `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')});`;
}

function sqlValue(value) {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return `'${String(value).replace(/'/g, "''")}'`;
}
