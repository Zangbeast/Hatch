# Meds & Stars 💖

A tiny two-person web app for staying on top of medication:

- **Calendar** — check off each dose as it's taken, day by day, and earn a gold star ⭐ for every dose (plus a streak 🔥 for full days in a row).
- **Ping button** — the caregiver taps one button to send a cute push notification reminding the other person to take their meds.
- **Confirmation** — when a dose is checked off (in the app, or via the "I took it ✓" button right on the reminder notification), the caregiver gets a sweet push notification back.
- **Activity log** — a simple timeline of reminders sent and doses taken.

No accounts, no passwords, no PINs — you just tap which one of you a device belongs to, once, and it remembers. Data lives in a small local database; push notifications use the browser's built-in Web Push, so nothing needs a third-party account.

## Get it running online (no coding required)

You need somewhere for the app to live so it works from your phones anywhere, not just on one computer. This uses [Render](https://render.com), which is free to start.

**1. Click this button:**

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Zangbeast/Hatch)

(If the button doesn't work, go to render.com, sign up, then choose **New +** → **Blueprint**, and point it at this GitHub repo.)

**2. Sign in with GitHub** if it asks — that's the account this code lives in.

**3. Click "Apply" / "Create"** on the page Render shows you. Everything needed is already filled in — you don't have to type or paste anything. Render will build and start the app, which takes a couple of minutes.

**4. Open your app.** When it's done, Render shows you a web address like `https://meds-and-stars.onrender.com`. That's your app.

**5. Install it like an app, on both phones:**
- Open that address in your phone's browser
- iPhone: tap the Share icon → **Add to Home Screen**
- Android: tap the ⋮ menu → **Add to Home screen** / **Install app**
- Open it from the new home screen icon — that's what lets it actually deliver notifications, opening it in a regular browser tab won't.

**6. On each phone, tap who that phone belongs to** ("I'm taking meds" or "I'm checking in") and allow notifications when asked. That's it — no PIN, no password. It remembers the choice on that device from then on.

**7. Optional — set your real names.** Open the **Settings** tab in the app and type your names in. This updates what shows up in the app and in notifications right away.

A couple of things worth knowing:
- Anyone with your app's link can open it and pick either role — there's no password gate. Just don't post the link publicly; treat it like you would a shared photo album link.
- The free Render plan "falls asleep" after a while if unused, so the first open after a quiet stretch can take ~30 seconds to wake up. That's normal.
- If you ever click "redeploy" on Render (not something you'd normally need to do), it starts from a clean slate — your medication list and history reset. Day-to-day use (opening the app, it sleeping and waking back up) does **not** lose anything.

## Running it on your own computer (for developers)

```bash
npm install
npm start
```

Visit `http://localhost:3000`. See `.env.example` for optional settings (custom session secret, starting names, etc.) — none of them are required to try it out.

## Project layout

```
render.yaml      One-click Render deployment config
server/
  index.js      Express app: role picker, medications, doses, push, settings, activity log
  db.js         SQLite schema + settings key/value store
  push.js       Web Push (VAPID) sending — auto-generates its own keys on first run
  scheduler.js  Optional per-minute cron check for auto-reminders
public/
  index.html, css/, js/app.js   Frontend (no build step)
  js/sw.js       Service worker: shows push notifications, handles the
                 "I took it" action button
  manifest.json  PWA install metadata
```
