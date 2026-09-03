const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const db = require('./db');

const KEYS_PATH = process.env.VAPID_KEYS_PATH || path.join(__dirname, '..', 'vapid-keys.json');
const CONTACT = process.env.VAPID_CONTACT_EMAIL || 'mailto:meds-and-stars@example.com';

// Web Push needs a real VAPID keypair (not just any random string). Rather
// than making the person deploying this generate and paste one, we make one
// automatically the first time the server starts and reuse it after that —
// so push notifications work with zero configuration.
function loadOrCreateKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  try {
    const saved = JSON.parse(fs.readFileSync(KEYS_PATH, 'utf8'));
    if (saved.publicKey && saved.privateKey) return saved;
  } catch (err) {
    // no saved keys yet — fall through and generate some
  }
  const generated = webpush.generateVAPIDKeys();
  try {
    fs.writeFileSync(KEYS_PATH, JSON.stringify(generated));
  } catch (err) {
    console.warn('[push] could not save generated VAPID keys to disk:', err.message);
  }
  return generated;
}

const { publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY } = loadOrCreateKeys();
webpush.setVapidDetails(CONTACT, PUBLIC_KEY, PRIVATE_KEY);
const configured = true;

function subscriptionsFor(role) {
  return db.prepare('SELECT * FROM push_subscriptions WHERE role = ?').all(role);
}

async function sendToRole(role, payload) {
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
