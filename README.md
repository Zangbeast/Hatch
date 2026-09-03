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

**5. Install it like an app, on both phones.** This step is what makes it a real app instead of just a website — it gets its own icon on your home screen, opens full-screen with no browser bar, and (this is the important part) is what lets it deliver notifications at all:
- Open that address in your phone's browser
- **iPhone:** tap the **Share** icon (the square with an arrow) → **Add to Home Screen** → **Add**
- **Android:** tap the **⋮** menu → **Add to Home screen** / **Install app**
- Now close Safari/Chrome and open the app from its new icon on your home screen instead. Opening it as a normal browser tab won't deliver notifications — it has to be the installed icon.

**6. On each phone, tap who that phone belongs to** ("I'm taking meds" or "I'm checking in"). No PIN, no password — it remembers the choice on that device from then on.

**7. Tap "Enable notifications"** on the pink banner that appears, then **Allow** when your phone asks. That's the step that actually turns notifications on for that device.

**8. Optional — set your real names.** Open the **Settings** tab in the app and type your names in. This updates what shows up in the app and in notifications right away.

### About iPhone specifically

iPhones only allow notifications from web apps that have been added to the Home Screen (step 5) — Apple added this in 2023, and it's the same mechanism behind every "app" here, no App Store needed. If the notification prompt never shows up on iPhone, it's almost always one of these:
- You opened it in Safari instead of tapping the home screen icon — go back and open it from the icon.
- You tapped "Enable notifications" before finishing step 5 — add it to the Home Screen first, then reopen it from there.
- You (or iOS) previously said no — go to iPhone **Settings → Notifications → Meds & Stars** and make sure they're allowed.

A couple of things worth knowing:
- Anyone with your app's link can open it and pick either role — there's no password gate. Just don't post the link publicly; treat it like you would a shared photo album link.
- The free Render plan "falls asleep" after a while if unused, so the first open after a quiet stretch can take ~30 seconds to wake up. That's normal — nothing is lost.
- **The free Render plan has no permanent storage.** Every time the app gets redeployed — which happens automatically on any code update, not just a manual click — it starts from a clean slate: medications, calendar history, gold stars/streak, and everyone's "enable notifications" setup are all wiped and need to be redone. Day-to-day use (just opening the app, it sleeping and waking back up) does **not** trigger this — only an actual redeploy does. If that becomes annoying, the fix is upgrading Render to a paid instance with a persistent disk (a few dollars a month) — ask and it can be set up.

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
  js/sw.js       Service worker: shows push notifications, opens/focuses
                 the app on tap (confirming "taken" happens in-app only)
  manifest.json  PWA install metadata
```
