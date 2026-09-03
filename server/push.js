const webpush = require('web-push');
const db = require('./db');

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const CONTACT = process.env.VAPID_CONTACT_EMAIL || 'mailto:admin@example.com';

const configured = Boolean(PUBLIC_KEY && PRIVATE_KEY);
if (configured) {
  webpush.setVapidDetails(CONTACT, PUBLIC_KEY, PRIVATE_KEY);
} else {
  console.warn(
    '[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — push notifications are disabled.\n' +
    '        Run `npm run generate-vapid-keys` and put the values in your .env file.'
  );
}

function subscriptionsFor(role) {
  return db.prepare('SELECT * FROM push_subscriptions WHERE role = ?').all(role);
}

async function sendToRole(role, payload) {
  if (!configured) return { sent: 0, disabled: true };
  const subs = subscriptionsFor(role);
  let sent = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub.subscription_json, JSON.stringify(payload));
        sent += 1;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
        } else {
          console.error('[push] failed to send to', role, err.message);
        }
      }
    })
  );
  return { sent, disabled: false };
}

module.exports = { sendToRole, configured, PUBLIC_KEY };
