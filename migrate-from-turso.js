// One-time migration: copy the medication list, dose history, names, and
// activity log out of the OLD Turso database and into this homelab's local
// database — so moving to the homelab doesn't lose any history.
//
// Run it once (see HOMELAB.md → "Restore history from the old app"), then you
// can retire Turso.
//
//   SOURCE (old app)  : TURSO_DATABASE_URL + TURSO_AUTH_TOKEN
//   DESTINATION (this) : DB_PATH (the local SQLite file, default /data/data.db)
//
// It replaces the history tables (medications, dose_logs, events) in the
// destination with the source's, preserving their IDs. It deliberately leaves
// push_subscriptions alone, so this device's notification setup keeps working.

const { createClient } = require('@libsql/client');

const SRC_URL = process.env.TURSO_DATABASE_URL;
const SRC_TOKEN = process.env.TURSO_AUTH_TOKEN;
const DEST_PATH = process.env.DB_PATH || '/data/data.db';

if (!SRC_URL) {
  console.error('Set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN) to your old database.');
  process.exit(1);
}

const src = createClient(SRC_TOKEN ? { url: SRC_URL, authToken: SRC_TOKEN } : { url: SRC_URL });
const dest = createClient({ url: 'file:' + DEST_PATH });

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS medications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, dosage TEXT DEFAULT '', time_of_day TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS dose_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    medication_id INTEGER NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
    date TEXT NOT NULL, taken INTEGER NOT NULL DEFAULT 0, taken_at TEXT,
    UNIQUE(medication_id, date)
  );
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL,
    endpoint TEXT NOT NULL UNIQUE, subscription_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

async function main() {
  await dest.executeMultiple(SCHEMA);

  const meds = (await src.execute('SELECT * FROM medications')).rows;
  const doses = (await src.execute('SELECT * FROM dose_logs')).rows;
  const settings = (await src.execute('SELECT * FROM settings')).rows;
  const events = (await src.execute('SELECT * FROM events')).rows;

  console.log(
    `Found in the old app: ${meds.length} medications, ${doses.length} dose logs, ` +
    `${settings.length} settings, ${events.length} activity entries.`
  );

  // Fresh restore of the history tables. push_subscriptions is left untouched.
  await dest.execute('DELETE FROM dose_logs');
  await dest.execute('DELETE FROM medications');
  await dest.execute('DELETE FROM events');

  for (const m of meds) {
    await dest.execute({
      sql: 'INSERT INTO medications (id, name, dosage, time_of_day, active, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: [m.id, m.name, m.dosage, m.time_of_day, m.active, m.created_at],
    });
  }
  for (const d of doses) {
    await dest.execute({
      sql: 'INSERT INTO dose_logs (id, medication_id, date, taken, taken_at) VALUES (?, ?, ?, ?, ?)',
      args: [d.id, d.medication_id, d.date, d.taken, d.taken_at],
    });
  }
  for (const s of settings) {
    await dest.execute({
      sql: 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      args: [s.key, s.value],
    });
  }
  for (const e of events) {
    await dest.execute({
      sql: 'INSERT INTO events (id, type, message, created_at) VALUES (?, ?, ?, ?)',
      args: [e.id, e.type, e.message, e.created_at],
    });
  }

  const destMeds = (await dest.execute('SELECT COUNT(*) AS c FROM medications')).rows[0].c;
  const destDoses = (await dest.execute('SELECT COUNT(*) AS c FROM dose_logs')).rows[0].c;
  console.log(`Copied into the homelab app: ${destMeds} medications, ${destDoses} dose logs.`);
  console.log('Done. Restart the app (docker compose up -d) and her history will be there.');
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
