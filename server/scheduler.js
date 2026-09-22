// Automated reminders, all in Eastern time (America/New_York, which handles
// the EST/EDT daylight-saving switch on its own). Enabled with
// ENABLE_AUTO_REMINDERS=true.
//
//   Morning: once per day, at a RANDOM time between 11am and 3pm, if she
//            hasn't done 40%+ of her morning meds, remind her AND tell the
//            caregiver the reminder went out. If she's already done, nobody
//            is pinged.
//   Evening: at 9pm, if the evening meds aren't done, remind her (only her).
//
// The per-minute tick is timezone-agnostic; all the time math is computed in
// Eastern inside the handler, so it's correct regardless of the server clock.
const cron = require('node-cron');
const db = require('./db');
const push = require('./push');

const TZ = 'America/New_York';
const MORNING_WINDOW_START = 11 * 60; // 11:00am
const MORNING_WINDOW_END = 15 * 60; // 3:00pm (exclusive)
const EVENING_TIME = 21 * 60; // 9:00pm
const DONE_THRESHOLD = 0.4; // matches the calendar / streak rule

// Current date (YYYY-MM-DD) and minutes-since-midnight, in Eastern time.
function etNow() {
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  let hh = 0;
  let mm = 0;
  for (const p of parts) {
    if (p.type === 'hour') hh = parseInt(p.value, 10);
    if (p.type === 'minute') mm = parseInt(p.value, 10);
  }
  if (hh === 24) hh = 0; // some ICU builds report midnight as 24
  return { date, minutes: hh * 60 + mm };
}

async function currentNames() {
  const [patient, caregiver] = await Promise.all([
    db.getSetting('patient_name', process.env.PATIENT_NAME || 'Sweetheart'),
    db.getSetting('caregiver_name', process.env.CAREGIVER_NAME || 'You'),
  ]);
  return { patient, caregiver };
}

// Is the given period (morning or evening) "done" for this date? Done means
// more than 40% of that period's meds are checked off. Returns hasMeds:false
// when there are no meds in that period (so there's nothing to remind about).
async function periodStatus(isEvening, date) {
  const meds = await db
    .prepare(`SELECT id FROM medications WHERE active = 1 AND period ${isEvening ? '=' : '!='} 'evening'`)
    .all();
  if (!meds.length) return { hasMeds: false, done: true };
  const ids = meds.map((m) => m.id);
  const placeholders = ids.map(() => '?').join(',');
  const row = await db
    .prepare(`SELECT COUNT(*) AS c FROM dose_logs WHERE date = ? AND taken = 1 AND medication_id IN (${placeholders})`)
    .get(date, ...ids);
  return { hasMeds: true, done: row.c / ids.length > DONE_THRESHOLD };
}

function randomMorningMinute() {
  return MORNING_WINDOW_START + Math.floor(Math.random() * (MORNING_WINDOW_END - MORNING_WINDOW_START));
}

async function logEvent(type, message) {
  await db.prepare('INSERT INTO events (type, message) VALUES (?, ?)').run(type, message);
}

// The whole decision, factored out so it can be driven with a simulated time
// in tests. `now` is { date, minutes } in Eastern.
async function tick(now = etNow()) {
  const { date, minutes } = now;

  // ---- Morning: random time in [11am, 3pm) ----
  let targetDate = await db.getSetting('auto_morning_target_date', '');
  let targetMin = parseInt(await db.getSetting('auto_morning_target_min', ''), 10);
  if (targetDate !== date || Number.isNaN(targetMin)) {
    // New day (or never set): pick today's random reminder time once.
    targetMin = randomMorningMinute();
    await db.setSetting('auto_morning_target_date', date);
    await db.setSetting('auto_morning_target_min', String(targetMin));
  }

  const morningResolved = await db.getSetting('auto_morning_resolved_date', '');
  if (morningResolved !== date && minutes >= targetMin) {
    const { hasMeds, done } = await periodStatus(false, date);
    if (hasMeds && !done) {
      const names = await currentNames();
      await push.sendToRole('patient', {
        title: '🌸 Morning meds reminder',
        body: 'Gentle nudge — don’t forget your morning meds 💊',
        tag: 'reminder',
      });
      await push.sendToRole('caregiver', {
        title: '📨 Morning reminder sent',
        body: `${names.patient} hadn’t done her morning meds, so I nudged her.`,
        tag: 'auto',
      });
      await logEvent('auto_morning_reminder', `Morning reminder sent to ${names.patient}; ${names.caregiver} notified`);
    }
    // Evaluated once for today, whether or not we sent anything.
    await db.setSetting('auto_morning_resolved_date', date);
  }

  // ---- Evening: 9pm ----
  const eveningResolved = await db.getSetting('auto_evening_resolved_date', '');
  if (eveningResolved !== date && minutes >= EVENING_TIME) {
    const { hasMeds, done } = await periodStatus(true, date);
    if (hasMeds && !done) {
      await push.sendToRole('patient', {
        title: '🌙 Evening meds reminder',
        body: 'Time for your nighttime meds 💊',
        tag: 'reminder',
      });
      const names = await currentNames();
      await logEvent('auto_evening_reminder', `Evening reminder sent to ${names.patient}`);
    }
    await db.setSetting('auto_evening_resolved_date', date);
  }
}

function start() {
  cron.schedule('* * * * *', () => {
    tick().catch((err) => console.error('[scheduler] tick failed:', err.message));
  });
  console.log('[scheduler] Automations on (Eastern): morning nudge 11am–3pm, evening nudge 9pm.');
}

module.exports = { start, tick, etNow };
