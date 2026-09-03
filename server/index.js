require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const db = require('./db');
const push = require('./push');

const PORT = process.env.PORT || 3000;
const PATIENT_PIN = process.env.PATIENT_PIN || '1234';
const CAREGIVER_PIN = process.env.CAREGIVER_PIN || '5678';
const PATIENT_NAME = process.env.PATIENT_NAME || 'Patient';
const CAREGIVER_NAME = process.env.CAREGIVER_NAME || 'Caregiver';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-please';

const NAMES = { patient: PATIENT_NAME, caregiver: CAREGIVER_NAME };

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
      maxAge: 1000 * 60 * 60 * 24 * 90, // 90 days
    },
  })
);

function requireAuth(req, res, next) {
  if (!req.session.role) return res.status(401).json({ error: 'Not logged in' });
  next();
}

function requireCaregiver(req, res, next) {
  if (req.session.role !== 'caregiver') return res.status(403).json({ error: 'Caregiver only' });
  next();
}

function logEvent(type, message) {
  db.prepare('INSERT INTO events (type, message) VALUES (?, ?)').run(type, message);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ---- Auth ----
app.post('/api/login', (req, res) => {
  const { role, pin } = req.body || {};
  if (role === 'patient' && pin === PATIENT_PIN) {
    req.session.role = 'patient';
  } else if (role === 'caregiver' && pin === CAREGIVER_PIN) {
    req.session.role = 'caregiver';
  } else {
    return res.status(401).json({ error: 'Wrong role or PIN' });
  }
  res.json({ role: req.session.role, name: NAMES[req.session.role] });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/session', (req, res) => {
  if (!req.session.role) return res.status(401).json({ error: 'Not logged in' });
  res.json({
    role: req.session.role,
    name: NAMES[req.session.role],
    otherName: req.session.role === 'patient' ? CAREGIVER_NAME : PATIENT_NAME,
  });
});

// ---- Push ----
app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: push.PUBLIC_KEY || null, enabled: push.configured });
});

app.post('/api/push/subscribe', requireAuth, (req, res) => {
  const { subscription } = req.body || {};
  if (!subscription || !subscription.endpoint) return res.status(400).json({ error: 'Missing subscription' });
  db.prepare(
    `INSERT INTO push_subscriptions (role, endpoint, subscription_json)
     VALUES (@role, @endpoint, @json)
     ON CONFLICT(endpoint) DO UPDATE SET role = excluded.role, subscription_json = excluded.subscription_json`
  ).run({ role: req.session.role, endpoint: subscription.endpoint, json: JSON.stringify(subscription) });
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', requireAuth, (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  res.json({ ok: true });
});

// ---- Medications ----
app.get('/api/medications', requireAuth, (req, res) => {
  const meds = db.prepare('SELECT * FROM medications WHERE active = 1 ORDER BY time_of_day, name').all();
  res.json(meds);
});

app.post('/api/medications', requireAuth, (req, res) => {
  const { name, dosage, time_of_day } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  const info = db
    .prepare('INSERT INTO medications (name, dosage, time_of_day) VALUES (?, ?, ?)')
    .run(name.trim(), (dosage || '').trim(), (time_of_day || '').trim());
  logEvent('medication_added', `${NAMES[req.session.role]} added medication "${name.trim()}"`);
  res.json(db.prepare('SELECT * FROM medications WHERE id = ?').get(info.lastInsertRowid));
});

app.delete('/api/medications/:id', requireAuth, (req, res) => {
  db.prepare('UPDATE medications SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Doses / calendar ----
app.get('/api/doses', requireAuth, (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start and end query params required (YYYY-MM-DD)' });
  const rows = db
    .prepare('SELECT * FROM dose_logs WHERE date >= ? AND date <= ?')
    .all(start, end);
  res.json(rows);
});

app.post('/api/doses/toggle', requireAuth, (req, res) => {
  const { medication_id, date } = req.body || {};
  if (!medication_id || !date) return res.status(400).json({ error: 'medication_id and date are required' });

  const med = db.prepare('SELECT * FROM medications WHERE id = ?').get(medication_id);
  if (!med) return res.status(404).json({ error: 'Medication not found' });

  const existing = db
    .prepare('SELECT * FROM dose_logs WHERE medication_id = ? AND date = ?')
    .get(medication_id, date);

  let nowTaken;
  if (existing) {
    nowTaken = existing.taken ? 0 : 1;
    db.prepare('UPDATE dose_logs SET taken = ?, taken_at = ? WHERE id = ?').run(
      nowTaken,
      nowTaken ? new Date().toISOString() : null,
      existing.id
    );
  } else {
    nowTaken = 1;
    db.prepare('INSERT INTO dose_logs (medication_id, date, taken, taken_at) VALUES (?, ?, 1, ?)').run(
      medication_id,
      date,
      new Date().toISOString()
    );
  }

  if (nowTaken) {
    const actor = NAMES[req.session.role];
    logEvent('dose_taken', `${actor} marked "${med.name}" as taken`);
    if (req.session.role === 'patient') {
      push.sendToRole('caregiver', {
        title: `${PATIENT_NAME} took their meds ✓`,
        body: `${med.name}${med.dosage ? ' (' + med.dosage + ')' : ''} marked as taken.`,
        tag: 'confirmation',
      });
    }
  }

  res.json({ medication_id: Number(medication_id), date, taken: Boolean(nowTaken) });
});

// Marks every not-yet-taken active medication for today as taken.
// Used by the "I took it" action button on the reminder push notification,
// so the patient can confirm without opening the app.
app.post('/api/doses/mark-all-today', requireAuth, (req, res) => {
  const date = todayStr();
  const meds = db.prepare('SELECT * FROM medications WHERE active = 1').all();
  const takenNow = [];
  for (const med of meds) {
    const existing = db.prepare('SELECT * FROM dose_logs WHERE medication_id = ? AND date = ?').get(med.id, date);
    if (existing && existing.taken) continue;
    if (existing) {
      db.prepare('UPDATE dose_logs SET taken = 1, taken_at = ? WHERE id = ?').run(new Date().toISOString(), existing.id);
    } else {
      db.prepare('INSERT INTO dose_logs (medication_id, date, taken, taken_at) VALUES (?, ?, 1, ?)').run(
        med.id,
        date,
        new Date().toISOString()
      );
    }
    takenNow.push(med.name);
  }
  if (takenNow.length) {
    logEvent('dose_taken', `${NAMES[req.session.role]} confirmed meds taken: ${takenNow.join(', ')}`);
    push.sendToRole('caregiver', {
      title: `${PATIENT_NAME} took their meds ✓`,
      body: takenNow.join(', '),
      tag: 'confirmation',
    });
  }
  res.json({ ok: true, taken: takenNow });
});

// ---- Reminder ping ----
app.post('/api/remind', requireAuth, requireCaregiver, async (req, res) => {
  const result = await push.sendToRole('patient', {
    title: 'Medication reminder 💊',
    body: `${CAREGIVER_NAME} is checking in — time to take your meds!`,
    tag: 'reminder',
    actions: [{ action: 'taken', title: "I took it ✓" }],
  });
  logEvent('reminder_sent', `${CAREGIVER_NAME} sent a reminder ping`);
  res.json(result);
});

// ---- Activity log ----
app.get('/api/events', requireAuth, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const rows = db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?').all(limit);
  res.json(rows);
});

// ---- Static frontend ----
app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  console.log(`Meds reminder app listening on http://localhost:${PORT}`);
  if (!push.configured) {
    console.log('Push notifications disabled — run `npm run generate-vapid-keys` to enable them.');
  }
});

if (process.env.ENABLE_AUTO_REMINDERS === 'true') {
  require('./scheduler');
}
