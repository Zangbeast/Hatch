# Meds Reminder

A tiny two-person web app for staying on top of medication:

- **Calendar** — check off each dose as it's taken, day by day.
- **Ping button** — the caregiver taps one button to send a push notification reminding the other person to take their meds.
- **Confirmation** — when a dose is checked off (in the app, or via the "I took it ✓" button right on the reminder notification), the caregiver gets a push notification back letting them know.
- **Activity log** — a simple timeline of reminders sent and doses taken.
- Optional **automatic reminders** at each medication's scheduled time, if that dose hasn't been marked taken yet.

It's a small self-hosted app — no accounts, ads, or third-party services beyond the browser's built-in push notifications. Just two shared PINs: one for the person taking meds, one for the person checking in on them.

## How it works

It's an installable [PWA](https://web.dev/progressive-web-apps/) (Progressive Web App) built with a small Node/Express backend and vanilla JS frontend — no build step. Data is stored in a local SQLite file. Push notifications use the Web Push standard (VAPID), so no Firebase/APNs account is needed and it works on both Android and iOS (iOS 16.4+, after adding the site to the home screen).

## Setup

```bash
npm install
cp .env.example .env
npm run generate-vapid-keys   # paste the output into .env
```

Edit `.env`:

| Variable | What it's for |
| --- | --- |
| `PATIENT_PIN` / `CAREGIVER_PIN` | PINs the two of you use to log in. Pick anything you like. |
| `PATIENT_NAME` / `CAREGIVER_NAME` | Display names shown in the UI and notifications. |
| `SESSION_SECRET` | Random string for signing session cookies (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | From `npm run generate-vapid-keys`. Without these, everything still works except push notifications. |
| `VAPID_CONTACT_EMAIL` | Any `mailto:` address; required by the Web Push spec, not shown to anyone. |
| `ENABLE_AUTO_REMINDERS` | Set to `true` to also auto-send a reminder at each medication's scheduled time if it's still unchecked. |

Then run it:

```bash
npm start
```

Visit `http://localhost:3000`.

## Using it day to day

1. Both people open the site and log in with their own PIN ("I'm taking meds" vs. "I'm checking in"), then add the site to their phone's home screen so it behaves like a real app and can receive push notifications.
2. Add each medication once, with an optional dosage and reminder time, in the **Medications** tab.
3. Each day, check off doses on the **Calendar** tab as they're taken — a green dot marks fully-completed days, yellow means partially done.
4. The caregiver can hit **🔔 Ping now** any time to send a reminder — it arrives as a push notification with a one-tap **"I took it ✓"** action, so confirming doesn't require opening the app.
5. Whenever a dose is checked off — from the app or from that notification button — the caregiver gets a push notification back.

## Deploying so it works outside your home network

Push notifications and installable PWAs both require **HTTPS** (plain `http://localhost` is fine for testing, but nothing else). The simplest options:

- A small always-on host with a free TLS cert, e.g. [Render](https://render.com), [Railway](https://railway.app), or [Fly.io](https://fly.io) — deploy this repo as a Node web service, set the environment variables from `.env`, and attach a persistent volume (or accept an ephemeral one) for `data.db`.
- Your own VPS behind a reverse proxy (Caddy or nginx) with Let's Encrypt.

Whichever you choose, keep `SESSION_SECRET` and the PINs private, and don't commit your real `.env` file (it's already git-ignored).

## Project layout

```
server/
  index.js      Express app: auth, medications, doses, push, activity log
  db.js         SQLite schema
  push.js       Web Push (VAPID) sending, with dead-subscription cleanup
  scheduler.js  Optional per-minute cron check for auto-reminders
public/
  index.html, css/, js/app.js   Frontend (no build step)
  js/sw.js       Service worker: shows push notifications, handles the
                 "I took it" action button
  manifest.json  PWA install metadata
```
