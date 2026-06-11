'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function dataDir() {
  return process.env.SKILLSCOPE_DIR || path.join(os.homedir(), '.skillscope');
}

function dbPath() {
  return path.join(dataDir(), 'skillscope.db');
}

function claudeDir() {
  return process.env.SKILLSCOPE_CLAUDE_DIR || path.join(os.homedir(), '.claude');
}

function settingsPath() {
  return process.env.SKILLSCOPE_SETTINGS || path.join(claudeDir(), 'settings.json');
}

const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  session_id TEXT,
  event_type TEXT NOT NULL,
  skill_name TEXT,
  tool_name TEXT,
  cwd TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_skill_name ON events(skill_name);
CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
CREATE TABLE IF NOT EXISTS skills (
  name TEXT PRIMARY KEY,
  description TEXT,
  path TEXT,
  scope TEXT,
  skill_md_chars INTEGER,
  metadata_chars INTEGER,
  first_seen INTEGER,
  last_scanned INTEGER
);
`;

function openDb() {
  const Database = require('better-sqlite3');
  fs.mkdirSync(dataDir(), { recursive: true });
  const db = new Database(dbPath());
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 2000');
  db.exec(MIGRATIONS);
  return db;
}

module.exports = { dataDir, dbPath, claudeDir, settingsPath, openDb };
