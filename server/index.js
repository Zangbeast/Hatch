require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const db = require('./db');
const push = require('./push');

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-please';

async function currentNames() {
  const [patient, caregiver] = await Promise.all([
    db.getSetting('patient_name', process.env.PATIENT_NAME || 'Sweetheart'),
    db.getSetting('caregiver_name', process.env.CAREGIVER_NAME || 'You'),
  ]);
  return { patient, caregiver };
}

const REMINDER_MESSAGES = [
  (caregiver) => `💕 ${caregiver} is thinking of you — time for your meds!`,
  () => '🌸 Little nudge: meds time! You’ve got this.',
  () => '💊✨ Reminder time, gorgeous! Don’t forget your meds.',
  (caregiver) => `🎀 ${caregiver} sent you a cuddly reminder: meds time!`,
];

const CONFIRMATION_MESSAGES = [
  (name) => `🌟 ${name} just earned a gold star for taking their meds!`,
  (name) => `💖 ${name} took their meds like a total champ!`,
  (name) => `✨ Yay! ${name} just checked off their meds.`,
  (name) => `🎀 ${name} did the thing! Meds taken, high five!`,
];

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 400, // ~13 months — no password, so no need to re-pick a role often
    },
  })
);

// Wraps an async route handler so a rejected promise becomes a clean 500
// instead of an unhandled rejection (Express 4 doesn't await handlers).
function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch((err) => {
    console.error('[api] handler error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Something went wrong' });
  });
}

function requireAuth(req, res, next) {
  if (!req.session.role) return res.status(401).json({ error: 'Not logged in' });
  next();
}

function requireCaregiver(req, res, next) {
  if (req.session.role !== 'caregiver') return res.status(403).json({ error: 'Caregiver only' });
  next();
}

async function logEvent(type, message) {
  await db.prepare('INSERT INTO events (type, message) VALUES (?, ?)').run(type, message);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ---- Auth ----
// No passwords: this is a two-person app, so "logging in" just means
// picking which of you this device belongs to.
app.post('/api/login', wrap(async (req, res) => {
  const { role } = req.body || {};
  if (role !== 'patient' && role !== 'caregiver') {
    return res.status(400).json({ error: 'role must be "patient" or "caregiver"' });
  }
  req.session.role = role;
  const names = await currentNames();
  res.json({ role, name: names[role] });
}));

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/session', wrap(async (req, res) => {
  if (!req.session.role) return res.status(401).json({ error: 'Not logged in' });
  const names = await currentNames();
  res.json({
    role: req.session.role,
    name: names[req.session.role],
    otherName: req.session.role === 'patient' ? names.caregiver : names.patient,
  });
}));

// ---- Settings (names shown in the UI and notifications) ----
app.get('/api/settings', requireAuth, wrap(async (req, res) => {
  const names = await currentNames();
  res.json({ patientName: names.patient, caregiverName: names.caregiver });
}));

app.post('/api/settings', requireAuth, wrap(async (req, res) => {
  const { patientName, caregiverName } = req.body || {};
  if (patientName && patientName.trim()) await db.setSetting('patient_name', patientName.trim());
  if (caregiverName && caregiverName.trim()) await db.setSetting('caregiver_name', caregiverName.trim());
  const names = await currentNames();
  res.json({ patientName: names.patient, caregiverName: names.caregiver });
}));

// ---- Push ----
app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: push.PUBLIC_KEY || null, enabled: push.configured });
});

app.post('/api/push/subscribe', requireAuth, wrap(async (req, res) => {
  const { subscription } = req.body || {};
  if (!subscription || !subscription.endpoint) return res.status(400).json({ error: 'Missing subscription' });
  await db.prepare(
    `INSERT INTO push_subscriptions (role, endpoint, subscription_json)
     VALUES (@role, @endpoint, @json)
     ON CONFLICT(endpoint) DO UPDATE SET role = excluded.role, subscription_json = excluded.subscription_json`
  ).run({ role: req.session.role, endpoint: subscription.endpoint, json: JSON.stringify(subscription) });
  res.json({ ok: true });
}));

app.post('/api/push/unsubscribe', requireAuth, wrap(async (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  res.json({ ok: true });
}));

// Lets someone verify push actually reaches their own device, without
// needing the other person to test it for them.
app.post('/api/push/test', requireAuth, wrap(async (req, res) => {
  const result = await push.sendToRole(req.session.role, {
    title: 'Test notification 🔔',
    body: "If you can see this, notifications are working on this device!",
    tag: 'test',
  });
  res.json(result);
}));

// ---- Medications ----
app.get('/api/medications', requireAuth, wrap(async (req, res) => {
  const meds = await db.prepare('SELECT * FROM medications WHERE active = 1 ORDER BY time_of_day, name').all();
  res.json(meds);
}));

app.post('/api/medications', requireAuth, wrap(async (req, res) => {
  const { name, dosage, time_of_day } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  const info = await db
    .prepare('INSERT INTO medications (name, dosage, time_of_day) VALUES (?, ?, ?)')
    .run(name.trim(), (dosage || '').trim(), (time_of_day || '').trim());
  const names = await currentNames();
  await logEvent('medication_added', `${names[req.session.role]} added medication "${name.trim()}"`);
  res.json(await db.prepare('SELECT * FROM medications WHERE id = ?').get(info.lastInsertRowid));
}));

app.delete('/api/medications/:id', requireAuth, wrap(async (req, res) => {
  await db.prepare('UPDATE medications SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// ---- Doses / calendar ----
app.get('/api/doses', requireAuth, wrap(async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start and end query params required (YYYY-MM-DD)' });
  const rows = await db
    .prepare('SELECT * FROM dose_logs WHERE date >= ? AND date <= ?')
    .all(start, end);
  res.json(rows);
}));

app.post('/api/doses/toggle', requireAuth, wrap(async (req, res) => {
  const { medication_id, date } = req.body || {};
  if (!medication_id || !date) return res.status(400).json({ error: 'medication_id and date are required' });

  const med = await db.prepare('SELECT * FROM medications WHERE id = ?').get(medication_id);
  if (!med) return res.status(404).json({ error: 'Medication not found' });

  const existing = await db
    .prepare('SELECT * FROM dose_logs WHERE medication_id = ? AND date = ?')
    .get(medication_id, date);

  let nowTaken;
  if (existing) {
    nowTaken = existing.taken ? 0 : 1;
    await db.prepare('UPDATE dose_logs SET taken = ?, taken_at = ? WHERE id = ?').run(
      nowTaken,
      nowTaken ? new Date().toISOString() : null,
      existing.id
    );
  } else {
    nowTaken = 1;
    await db.prepare('INSERT INTO dose_logs (medication_id, date, taken, taken_at) VALUES (?, ?, 1, ?)').run(
      medication_id,
      date,
      new Date().toISOString()
    );
  }

  if (nowTaken) {
    const names = await currentNames();
    await logEvent('dose_taken', `${names[req.session.role]} marked "${med.name}" as taken`);
    if (req.session.role === 'patient') {
      push.sendToRole('caregiver', {
        title: pickRandom(CONFIRMATION_MESSAGES)(names.patient),
        body: `${med.name}${med.dosage ? ' (' + med.dosage + ')' : ''} marked as taken.`,
        tag: 'confirmation',
      });
    }
  }

  res.json({ medication_id: Number(medication_id), date, taken: Boolean(nowTaken) });
}));

// Marks every not-yet-taken active medication for today as taken. Used by
// the in-app "Yes, I took them" button on the reminder prompt — not by the
// push notification itself, which has no action buttons on purpose (taking
// meds should be confirmed inside the app, not with one tap on a lock screen).
app.post('/api/doses/mark-all-today', requireAuth, wrap(async (req, res) => {
  const date = todayStr();
  const meds = await db.prepare('SELECT * FROM medications WHERE active = 1').all();
  const takenNow = [];
  for (const med of meds) {
    const existing = await db.prepare('SELECT * FROM dose_logs WHERE medication_id = ? AND date = ?').get(med.id, date);
    if (existing && existing.taken) continue;
    if (existing) {
      await db.prepare('UPDATE dose_logs SET taken = 1, taken_at = ? WHERE id = ?').run(new Date().toISOString(), existing.id);
    } else {
      await db.prepare('INSERT INTO dose_logs (medication_id, date, taken, taken_at) VALUES (?, ?, 1, ?)').run(
        med.id,
        date,
        new Date().toISOString()
      );
    }
    takenNow.push(med.name);
  }
  await db.setSetting('pending_reminder_at', '');
  if (takenNow.length) {
    const names = await currentNames();
    await logEvent('dose_taken', `${names[req.session.role]} confirmed meds taken: ${takenNow.join(', ')}`);
    push.sendToRole('caregiver', {
      title: pickRandom(CONFIRMATION_MESSAGES)(names.patient),
      body: takenNow.join(', '),
      tag: 'confirmation',
    });
  }
  res.json({ ok: true, taken: takenNow });
}));

// ---- Reminder ping ----
app.post('/api/remind', requireAuth, requireCaregiver, wrap(async (req, res) => {
  const names = await currentNames();
  const result = await push.sendToRole('patient', {
    title: pickRandom(REMINDER_MESSAGES)(names.caregiver),
    body: 'Open the app to check in — no need to do anything from this notification.',
    tag: 'reminder',
  });
  await db.setSetting('pending_reminder_at', new Date().toISOString());
  await logEvent('reminder_sent', `${names.caregiver} sent a reminder ping`);
  res.json(result);
}));

// The patient's app polls this on open/return-to-foreground so a ping can
// only ever be confirmed from inside the app, never straight from the
// notification itself.
app.get('/api/reminder-status', requireAuth, wrap(async (req, res) => {
  const sentAt = await db.getSetting('pending_reminder_at', '');
  res.json({ pending: Boolean(sentAt), sentAt: sentAt || null });
}));

app.post('/api/reminder-status/clear', requireAuth, wrap(async (req, res) => {
  await db.setSetting('pending_reminder_at', '');
  res.json({ ok: true });
}));

// ---- Stars & streak ----
async function isDayComplete(dateStr, medIds) {
  if (!medIds.length) return false;
  const placeholders = medIds.map(() => '?').join(',');
  const row = await db
    .prepare(`SELECT COUNT(*) AS c FROM dose_logs WHERE date = ? AND taken = 1 AND medication_id IN (${placeholders})`)
    .get(dateStr, ...medIds);
  return row.c >= medIds.length;
}

app.get('/api/stats', requireAuth, wrap(async (req, res) => {
  const totalStars = (await db.prepare('SELECT COUNT(*) AS c FROM dose_logs WHERE taken = 1').get()).c;

  const medRows = await db.prepare('SELECT id FROM medications WHERE active = 1').all();
  const medIds = medRows.map((m) => m.id);
  let streak = 0;
  const cursor = new Date();
  let isToday = true;
  for (let i = 0; i < 3650; i++) {
    const dateStr = cursor.toISOString().slice(0, 10);
    const complete = await isDayComplete(dateStr, medIds);
    if (complete) {
      streak += 1;
    } else if (!isToday) {
      break;
    }
    isToday = false;
    cursor.setDate(cursor.getDate() - 1);
  }

  res.json({ totalStars, streak });
}));

// ---- Activity log ----
app.get('/api/events', requireAuth, wrap(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const rows = await db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?').all(limit);
  res.json(rows);
}));

// ---- Static frontend ----
app.use(express.static(path.join(__dirname, '..', 'public')));

// Create tables before accepting traffic, so the first request never races
// schema creation.
db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Meds reminder app listening on http://localhost:${PORT}`);
      if (!push.configured) {
        console.log('Push notifications disabled — run `npm run generate-vapid-keys` to enable them.');
      }
    });
    if (process.env.ENABLE_AUTO_REMINDERS === 'true') {
      require('./scheduler');
    }
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
