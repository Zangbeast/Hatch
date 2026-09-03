const path = require('path');
const { createClient } = require('@libsql/client');

// In production (Render) this points at a Turso database via env vars, so the
// data survives restarts. With no env vars set it falls back to a local file,
// which is what `npm start` on your own computer uses.
const url =
  process.env.TURSO_DATABASE_URL ||
  'file:' + (process.env.DB_PATH || path.join(__dirname, '..', 'data.db'));
const authToken = process.env.TURSO_AUTH_TOKEN;

const client = createClient(authToken ? { url, authToken } : { url });

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS medications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    dosage TEXT DEFAULT '',
    time_of_day TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS dose_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    medication_id INTEGER NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    taken INTEGER NOT NULL DEFAULT 0,
    taken_at TEXT,
    UNIQUE(medication_id, date)
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    subscription_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

async function init() {
  await client.executeMultiple(SCHEMA);
}

// Named args come through as a single plain object (e.g. { role, endpoint,
// json } matching @name placeholders); everything else is positional.
function normalizeArgs(args) {
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    return args[0];
  }
  return args;
}

// A thin async stand-in for better-sqlite3's prepare().get/all/run so the rest
// of the app reads almost the same — just with `await` in front of each call.
function prepare(sql) {
  return {
    async get(...args) {
      const result = await client.execute({ sql, args: normalizeArgs(args) });
      return result.rows[0];
    },
    async all(...args) {
      const result = await client.execute({ sql, args: normalizeArgs(args) });
      return result.rows;
    },
    async run(...args) {
      const result = await client.execute({ sql, args: normalizeArgs(args) });
      return {
        lastInsertRowid: result.lastInsertRowid != null ? Number(result.lastInsertRowid) : undefined,
        changes: result.rowsAffected,
      };
    },
  };
}

async function getSetting(key, fallback) {
  const row = (await client.execute({ sql: 'SELECT value FROM settings WHERE key = ?', args: [key] })).rows[0];
  return row ? row.value : fallback;
}

async function setSetting(key, value) {
  await client.execute({
    sql: 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    args: [key, value],
  });
}

module.exports = { prepare, init, getSetting, setSetting, client };
