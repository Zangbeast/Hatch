// Optional: automatically pings the patient at each medication's scheduled
// time if that dose hasn't been marked taken yet. Enable with
// ENABLE_AUTO_REMINDERS=true in .env.
const cron = require('node-cron');
const db = require('./db');
const push = require('./push');

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function currentHHMM() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

cron.schedule('* * * * *', async () => {
  const hhmm = currentHHMM();
  const date = todayStr();
  const dueMeds = await db
    .prepare('SELECT * FROM medications WHERE active = 1 AND time_of_day = ?')
    .all(hhmm);

  for (const med of dueMeds) {
    const dose = await db.prepare('SELECT * FROM dose_logs WHERE medication_id = ? AND date = ?').get(med.id, date);
    if (dose && dose.taken) continue;
    await push.sendToRole('patient', {
      title: 'Medication reminder 💊',
      body: `Time to take ${med.name}${med.dosage ? ' (' + med.dosage + ')' : ''}. Open the app to check in.`,
      tag: 'reminder',
    });
    await db.setSetting('pending_reminder_at', new Date().toISOString());
    await db.prepare('INSERT INTO events (type, message) VALUES (?, ?)').run(
      'auto_reminder_sent',
      `Automatic reminder sent for "${med.name}"`
    );
  }
});

console.log('[scheduler] Auto-reminders enabled.');
