(() => {
  'use strict';

  const state = {
    role: null,
    name: '',
    otherName: '',
    viewYear: new Date().getFullYear(),
    viewMonth: new Date().getMonth(), // 0-indexed
    selectedDate: toDateStr(new Date()),
    medications: [],
    doses: {}, // `${medId}:${date}` -> taken (0/1)
  };

  const CUTE_TAKEN_MESSAGES = [
    'Yay! Gold star for you! ⭐',
    "So proud of you! 💖",
    "You're a superstar! ✨",
    'High five! 🙌 Meds taken!',
    'Look at you being amazing! 💗',
    'Sparkle status: activated ✨',
    'Way to go, cutie! 🌸',
  ];

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function toDateStr(d) {
    return d.toISOString().slice(0, 10);
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (res.status === 401) {
      showLogin();
      throw new Error('Not logged in');
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    return res.status === 204 ? null : res.json();
  }

  function starBurst(anchorEl) {
    const el = document.createElement('span');
    el.className = 'star-burst';
    el.textContent = '⭐';
    anchorEl.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (el.hidden = true), 2600);
  }

  // ---------- Login ----------
  function showLogin() {
    $('#login-view').hidden = false;
    $('#app-view').hidden = true;
  }

  function showApp() {
    $('#login-view').hidden = true;
    $('#app-view').hidden = false;
    $('#whoami').textContent = `Signed in as ${state.name}`;
    const isCaregiver = state.role === 'caregiver';
    $('#caregiver-panel').hidden = !isCaregiver;
    if (isCaregiver) {
      $('#remind-heading').textContent = `Send ${state.otherName} a reminder`;
    }
  }

  async function pickRole(role) {
    $('#login-error').hidden = true;
    try {
      const data = await api('/api/login', { method: 'POST', body: JSON.stringify({ role }) });
      state.role = data.role;
      state.name = data.name;
      await afterLogin();
    } catch (err) {
      $('#login-error').textContent = "Couldn't log in — try again.";
      $('#login-error').hidden = false;
    }
  }

  $('#login-patient').addEventListener('click', () => pickRole('patient'));
  $('#login-caregiver').addEventListener('click', () => pickRole('caregiver'));

  $('#logout-btn').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    state.role = null;
    showLogin();
  });

  $('#switch-role-btn').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    state.role = null;
    showLogin();
  });

  async function afterLogin() {
    await loadAppData();
  }

  async function loadAppData() {
    const session = await api('/api/session');
    state.role = session.role;
    state.name = session.name;
    state.otherName = session.otherName;
    showApp();
    await Promise.all([loadMedications(), loadDosesForVisibleMonth(), refreshStats()]);
    renderCalendar();
    renderMedicationList();
    selectDay(state.selectedDate);
    refreshNotificationUi().catch((err) => console.warn('Notification check skipped:', err.message));
    checkReminderPrompt();
  }

  // ---------- Reminder check-in prompt ----------
  // Only ever shown from inside the app — never actionable straight from a
  // push notification. Checked whenever the app opens and whenever it comes
  // back to the foreground, so it catches a ping whether that's how you got
  // here or you just happened to open the app afterward.
  async function checkReminderPrompt() {
    if (state.role !== 'patient') return;
    try {
      const status = await api('/api/reminder-status');
      if (status.pending) {
        $('#reminder-modal-text').textContent = `${state.otherName} checked in on you 💕`;
      }
      $('#reminder-modal').hidden = !status.pending;
    } catch (err) {
      // non-critical
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.role) checkReminderPrompt();
  });

  $('#reminder-yes-btn').addEventListener('click', async () => {
    try {
      await api('/api/doses/mark-all-today', { method: 'POST' });
      $('#reminder-modal').hidden = true;
      await Promise.all([loadDosesForVisibleMonth(), refreshStats()]);
      renderCalendar();
      renderDayDetail();
      toast(CUTE_TAKEN_MESSAGES[Math.floor(Math.random() * CUTE_TAKEN_MESSAGES.length)]);
    } catch (err) {
      toast(err.message);
    }
  });

  $('#reminder-no-btn').addEventListener('click', async () => {
    try {
      await api('/api/reminder-status/clear', { method: 'POST' });
    } catch (err) {
      // non-critical
    }
    $('#reminder-modal').hidden = true;
  });

  async function refreshStats() {
    try {
      const stats = await api('/api/stats');
      $('#stat-stars').textContent = `⭐ ${stats.totalStars}`;
      $('#stat-streak').textContent = `🔥 ${stats.streak}`;
    } catch (err) {
      // stats are a nice-to-have, never block the app on them
    }
  }

  // ---------- Tabs ----------
  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      $$('.tab-panel').forEach((p) => (p.hidden = true));
      $(`#tab-${btn.dataset.tab}`).hidden = false;
      if (btn.dataset.tab === 'activity') loadActivity();
      if (btn.dataset.tab === 'settings') loadSettingsTab();
    });
  });

  // ---------- Settings ----------
  async function loadSettingsTab() {
    const settings = await api('/api/settings');
    $('#settings-patient-name').value = settings.patientName;
    $('#settings-caregiver-name').value = settings.caregiverName;
    $('#settings-current-role').textContent = state.role === 'patient' ? 'the person taking meds 🌸' : 'the person checking in 💌';
    renderNotifStatus();
  }

  function renderNotifStatus() {
    const el = $('#settings-notif-status');
    if (!pushIsSupported()) {
      el.textContent = isIOS() && !isStandalone() ? '⚠️ Not installed to Home Screen yet' : '⚠️ Not supported in this browser';
    } else if (Notification.permission === 'granted') {
      el.textContent = '✅ Enabled';
    } else if (Notification.permission === 'denied') {
      el.textContent = '❌ Blocked — turn on in phone Settings';
    } else {
      el.textContent = '⏳ Not turned on yet';
    }
  }

  $('#test-notif-btn').addEventListener('click', async () => {
    const resultEl = $('#test-notif-result');
    resultEl.hidden = false;
    try {
      const result = await api('/api/push/test', { method: 'POST' });
      resultEl.textContent =
        result.sent > 0
          ? `Sent! Check this device in the next few seconds. (${result.sent} device${result.sent > 1 ? 's' : ''})`
          : "Nothing to send to — this device isn't subscribed yet. Tap \"Enable notifications\" on the Calendar tab first.";
    } catch (err) {
      resultEl.textContent = err.message;
    }
  });

  $('#settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({
        patientName: $('#settings-patient-name').value,
        caregiverName: $('#settings-caregiver-name').value,
      }),
    });
    const session = await api('/api/session');
    state.name = session.name;
    state.otherName = session.otherName;
    $('#whoami').textContent = `Signed in as ${state.name}`;
    if (state.role === 'caregiver') $('#remind-heading').textContent = `Send ${state.otherName} a reminder`;
    toast('Names saved 💾');
  });

  // ---------- Medications ----------
  async function loadMedications() {
    state.medications = await api('/api/medications');
  }

  function renderMedicationList() {
    const list = $('#med-list');
    list.innerHTML = '';
    if (!state.medications.length) {
      list.innerHTML = '<li class="muted">No medications yet.</li>';
      return;
    }
    for (const med of state.medications) {
      const li = document.createElement('li');
      const meta = [med.dosage, med.time_of_day].filter(Boolean).join(' · ');
      li.innerHTML = `
        <span><span class="med-name">${escapeHtml(med.name)}</span>${meta ? ` <span class="med-meta">${escapeHtml(meta)}</span>` : ''}</span>
        <button class="icon-btn" data-id="${med.id}" aria-label="Remove ${escapeHtml(med.name)}">✕</button>
      `;
      li.querySelector('.icon-btn').addEventListener('click', async () => {
        if (!confirm(`Remove ${med.name}?`)) return;
        await api(`/api/medications/${med.id}`, { method: 'DELETE' });
        await loadMedications();
        renderMedicationList();
        renderDayDetail();
      });
      list.appendChild(li);
    }
  }

  $('#med-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#med-name').value.trim();
    const dosage = $('#med-dosage').value.trim();
    const time_of_day = $('#med-time').value;
    if (!name) return;
    await api('/api/medications', { method: 'POST', body: JSON.stringify({ name, dosage, time_of_day }) });
    $('#med-form').reset();
    await loadMedications();
    renderMedicationList();
    renderDayDetail();
    toast('Medication added 🌸');
  });

  // ---------- Calendar ----------
  async function loadDosesForVisibleMonth() {
    const start = new Date(state.viewYear, state.viewMonth, 1);
    const end = new Date(state.viewYear, state.viewMonth + 1, 0);
    const rows = await api(`/api/doses?start=${toDateStr(start)}&end=${toDateStr(end)}`);
    state.doses = {};
    for (const row of rows) {
      state.doses[`${row.medication_id}:${row.date}`] = row.taken;
    }
  }

  function dayStatus(dateStr) {
    if (!state.medications.length) return null;
    let takenCount = 0;
    for (const med of state.medications) {
      if (state.doses[`${med.id}:${dateStr}`]) takenCount += 1;
    }
    if (takenCount === 0) return null;
    if (takenCount === state.medications.length) return 'full';
    return 'partial';
  }

  function renderCalendar() {
    const grid = $('#calendar-grid');
    grid.innerHTML = '';
    const monthLabel = new Date(state.viewYear, state.viewMonth, 1).toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    });
    $('#month-label').textContent = monthLabel;

    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach((d) => {
      const el = document.createElement('div');
      el.className = 'cal-dow';
      el.textContent = d;
      grid.appendChild(el);
    });

    const firstDay = new Date(state.viewYear, state.viewMonth, 1);
    const daysInMonth = new Date(state.viewYear, state.viewMonth + 1, 0).getDate();
    const startOffset = firstDay.getDay();
    const todayStr = toDateStr(new Date());

    for (let i = 0; i < startOffset; i++) {
      const el = document.createElement('div');
      el.className = 'cal-day empty';
      grid.appendChild(el);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${state.viewYear}-${pad2(state.viewMonth + 1)}-${pad2(day)}`;
      const el = document.createElement('div');
      el.className = 'cal-day';
      if (dateStr === todayStr) el.classList.add('today');
      if (dateStr === state.selectedDate) el.classList.add('selected');

      const status = dayStatus(dateStr);
      let marker = '';
      if (status === 'full') marker = '<span class="cal-star">⭐</span>';
      else if (status === 'partial') marker = '<span class="cal-dot"></span>';

      el.innerHTML = `<span>${day}</span>${marker}`;
      el.addEventListener('click', () => selectDay(dateStr));
      grid.appendChild(el);
    }
  }

  $('#prev-month').addEventListener('click', async () => {
    state.viewMonth -= 1;
    if (state.viewMonth < 0) {
      state.viewMonth = 11;
      state.viewYear -= 1;
    }
    await loadDosesForVisibleMonth();
    renderCalendar();
  });

  $('#next-month').addEventListener('click', async () => {
    state.viewMonth += 1;
    if (state.viewMonth > 11) {
      state.viewMonth = 0;
      state.viewYear += 1;
    }
    await loadDosesForVisibleMonth();
    renderCalendar();
  });

  function selectDay(dateStr) {
    state.selectedDate = dateStr;
    renderCalendar();
    renderDayDetail();
  }

  function renderDayDetail() {
    const [y, m, d] = state.selectedDate.split('-').map(Number);
    const label = new Date(y, m - 1, d).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    $('#day-detail-title').textContent = label;

    const list = $('#day-med-list');
    list.innerHTML = '';
    $('#day-empty').hidden = state.medications.length > 0;

    for (const med of state.medications) {
      const key = `${med.id}:${state.selectedDate}`;
      const taken = Boolean(state.doses[key]);
      const li = document.createElement('li');
      li.dataset.medId = med.id;
      if (taken) li.classList.add('taken');
      const meta = [med.dosage, med.time_of_day].filter(Boolean).join(' · ');
      li.innerHTML = `
        <input type="checkbox" ${taken ? 'checked' : ''} aria-label="Mark ${escapeHtml(med.name)} taken" />
        <span><span class="med-name">${escapeHtml(med.name)}</span>${meta ? ` <span class="med-meta">${escapeHtml(meta)}</span>` : ''}</span>
      `;
      li.querySelector('input').addEventListener('change', async () => {
        try {
          const result = await api('/api/doses/toggle', {
            method: 'POST',
            body: JSON.stringify({ medication_id: med.id, date: state.selectedDate }),
          });
          state.doses[key] = result.taken ? 1 : 0;
          renderDayDetail();
          renderCalendar();
          refreshStats();
          if (result.taken) {
            const freshLi = $(`#day-med-list li[data-med-id="${med.id}"]`);
            if (freshLi) starBurst(freshLi);
            toast(CUTE_TAKEN_MESSAGES[Math.floor(Math.random() * CUTE_TAKEN_MESSAGES.length)]);
          }
        } catch (err) {
          toast(err.message);
        }
      });
      list.appendChild(li);
    }
  }

  // ---------- Caregiver: send reminder ----------
  $('#remind-btn').addEventListener('click', async () => {
    const btn = $('#remind-btn');
    btn.disabled = true;
    const statusEl = $('#remind-status');
    try {
      const result = await api('/api/remind', { method: 'POST' });
      statusEl.hidden = false;
      if (result.sent > 0) {
        statusEl.textContent = `Reminder sent (${result.sent} device${result.sent > 1 ? 's' : ''}).`;
        toast('Sweet reminder sent 💌');
      } else {
        statusEl.textContent = `${state.otherName} hasn't enabled notifications on their device yet.`;
      }
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- Activity ----------
  async function loadActivity() {
    const events = await api('/api/events?limit=30');
    const list = $('#activity-list');
    list.innerHTML = '';
    if (!events.length) {
      list.innerHTML = '<li class="muted">Nothing yet.</li>';
      return;
    }
    for (const ev of events) {
      const li = document.createElement('li');
      const when = new Date(ev.created_at.replace(' ', 'T') + 'Z').toLocaleString();
      li.innerHTML = `${escapeHtml(ev.message)}<time>${escapeHtml(when)}</time>`;
      list.appendChild(li);
    }
  }

  // ---------- Push subscription ----------
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  }

  function pushIsSupported() {
    return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  // Actually registers the service worker and subscribes to push. Assumes
  // Notification permission has already been granted — call this either
  // right after Notification.requestPermission() resolves, or on later
  // visits once permission is already 'granted'.
  async function subscribeToPush() {
    const { publicKey } = await api('/api/push/vapid-public-key');
    if (!publicKey) return;
    const registration = await navigator.serviceWorker.register('/js/sw.js');
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription }) });
  }

  // Shows/hides the "enable notifications" banner and, on iPhone, explains
  // that it only works once the app is added to the Home Screen — Safari
  // won't even offer the Notification API otherwise. Never auto-prompts:
  // iOS silently ignores a permission request that isn't triggered by a
  // direct tap, so the banner's button is the only place we ask.
  async function refreshNotificationUi() {
    const banner = $('#notif-banner');
    const btn = $('#enable-notif-btn');
    const text = $('#notif-banner-text');

    if (!pushIsSupported()) {
      if (isIOS() && !isStandalone()) {
        banner.hidden = false;
        btn.hidden = true;
        text.textContent = 'On iPhone, notifications only work once this is added to your Home Screen. Tap the Share icon → Add to Home Screen, then reopen it from there.';
      } else {
        banner.hidden = true;
      }
      return;
    }

    if (Notification.permission === 'granted') {
      banner.hidden = true;
      await subscribeToPush();
      return;
    }

    if (Notification.permission === 'denied') {
      banner.hidden = false;
      btn.hidden = true;
      text.textContent = "Notifications are blocked for this app — you'll need to turn them back on in your phone's notification settings.";
      return;
    }

    banner.hidden = false;
    btn.hidden = false;
    text.textContent = 'Tap below so reminders and confirmations can reach this phone.';
  }

  $('#enable-notif-btn').addEventListener('click', async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        await subscribeToPush();
        toast('Notifications on! 🔔💗');
      }
    } catch (err) {
      toast(err.message);
    }
    refreshNotificationUi();
  });

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));
  }

  // ---------- Init ----------
  (async function init() {
    try {
      await loadAppData();
    } catch (e) {
      showLogin();
    }
  })();
})();
