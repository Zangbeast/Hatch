# Running Meds & Stars on your homelab

This is the always-on, $0-forever setup: the app runs in a Docker container on
your own server, your data lives in a file on that server (no Turso, no cloud
database), Tailscale Funnel gives it a public HTTPS address that phones can
reach with **nothing installed on them**, and a small timer auto-updates it
from GitHub — so "tell Claude to change something" still just works.

## What you'll end up with

- A container running the app, restarting itself on reboot.
- A permanent address like `https://meds.your-tailnet-name.ts.net` for the phones.
- Data (calendar, names, stars) that survives restarts, updates, and reboots.
- Automatic scheduled reminders (the app can nag on its own — always-on unlocks this).
- Auto-updates: when new code lands on GitHub, the box picks it up within a few minutes.

## Before you start

You need a Linux box (a VM, an LXC container, a Pi, whatever) with:

- **Docker + the Docker Compose plugin** installed.
- **Tailscale** installed and logged into your tailnet.
- **git** installed.

The repo is public, so you don't need any GitHub login or keys to pull it.

---

## 1. Get the code

Clone it somewhere stable. This guide assumes `/opt/meds-and-stars`:

```bash
sudo git clone -b claude/medication-reminder-app-54tu8r \
  https://github.com/Zangbeast/Hatch.git /opt/meds-and-stars
cd /opt/meds-and-stars
```

(The `-b …` picks the branch this app lives on. `git pull` later stays on it.)

## 2. Start the app

```bash
sudo docker compose up -d --build
```

Give it a minute the first time (it builds the image), then check it's alive:

```bash
curl -s localhost:3000/ | head -n 1     # should print an <!doctype html> line
```

Your data and push keys now live in a Docker volume called `meds-data` — that's
the thing that makes them permanent. You won't touch it day to day.

## 3. Put it on the internet with Tailscale Funnel

Two one-time toggles in the Tailscale **admin console** (the web dashboard):

1. **DNS** page → enable **HTTPS Certificates** (this gives your tailnet its
   `.ts.net` name and lets it get real certificates).
2. Funnel needs to be allowed for this machine. The easiest path: just run the
   command below — if Funnel isn't enabled yet, Tailscale prints a link; open
   it, click approve, and run the command again.

Then, on the server, turn Funnel on for the app's port:

```bash
sudo tailscale funnel --bg 3000
```

`--bg` means "keep doing this in the background, including after reboot." See
your public address with:

```bash
tailscale funnel status
```

It'll show something like `https://meds.your-tailnet-name.ts.net` → that's the
link the phones use. (To turn it off later: `sudo tailscale funnel reset`.)

## 4. Install on the phones

Same as before, but with your new `.ts.net` address:

- Open the address in the phone's browser.
- **iPhone:** Share → **Add to Home Screen**. **Android:** ⋮ → **Install app**.
- Open it from the new home-screen icon, tap your role, tap **Enable
  notifications** → **Allow**.

Her phone needs nothing else — Funnel makes it a normal public web link.

## 5. Turn on auto-updates

This makes the box quietly pull and rebuild whenever new code is pushed, so you
keep the "just tell Claude" workflow.

The updater script is already in the repo at `homelab/update.sh`. Install the
timer that runs it:

```bash
# If you cloned somewhere other than /opt/meds-and-stars, edit the two paths
# inside homelab/meds-autoupdate.service first.
sudo cp homelab/meds-autoupdate.service /etc/systemd/system/
sudo cp homelab/meds-autoupdate.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now meds-autoupdate.timer
```

Check it's scheduled:

```bash
systemctl list-timers meds-autoupdate.timer
```

That's it. From now on: you ask Claude for a change → Claude pushes to GitHub →
within ~3 minutes your box has it, rebuilt and restarted, no action from you.

**Prefer cron instead of systemd?** One line via `sudo crontab -e`:

```
*/3 * * * * /opt/meds-and-stars/homelab/update.sh >> /var/log/meds-update.log 2>&1
```

---

## Good-to-know

- **Backing up your data:** everything precious is in the `meds-data` volume.
  A quick snapshot:
  ```bash
  sudo docker run --rm -v meds-data:/data -v "$PWD":/backup busybox \
    tar czf /backup/meds-backup.tar.gz -C /data .
  ```
- **Update it by hand any time:** `sudo ./homelab/update.sh`
- **See logs:** `sudo docker compose logs -f`
- **Stop / start:** `sudo docker compose down` / `sudo docker compose up -d`
- **Reliability:** the app is only up when this box and your internet are up.
  For something medication-related, consider a UPS and an uptime check (e.g. a
  free Uptime Kuma or an external pinger) so you know if it goes down.
- **Optional `SESSION_SECRET`:** set one in `docker-compose.yml` (uncomment the
  line) if you want login sessions to be extra private; not required.
