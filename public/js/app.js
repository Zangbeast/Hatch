(() => {
  'use strict';

  const state = {
    role: null,
    name: '',
    otherName: '',
    viewYear: new Date().getFullYear(),
    viewMonth: new Date().getMonth(), // 0-indexed
    selectedDate: etToday(),
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

  // "Today" in Eastern time, so the calendar's today and the dates doses are
  // stored under stay consistent with the server (and don't flip at ~8pm ET).
  function etToday() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
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
      if (btn.dataset.tab === 'period') loadPeriodTab();
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
    // Re-attempt the subscription here too — if it silently failed
    // earlier, opening Settings is a good moment to self-heal it — then
    // report what's actually true rather than just what permission says.
    await refreshNotificationUi();
    await renderNotifStatus();
  }

  async function renderNotifStatus() {
    const el = $('#settings-notif-status');
    if (!pushIsSupported()) {
      el.textContent = isIOS() && !isStandalone() ? '⚠️ Not installed to Home Screen yet' : '⚠️ Not supported in this browser';
    } else if (Notification.permission === 'denied') {
      el.textContent = '❌ Blocked — turn on in phone Settings';
    } else if (Notification.permission === 'default') {
      el.textContent = '⏳ Not turned on yet';
    } else {
      // Permission is 'granted' — but that alone doesn't mean the actual
      // subscription succeeded, so check for a real one before saying so.
      // getRegistration() resolves immediately either way, unlike `.ready`
      // (which waits for the worker to be *controlling* this page and can
      // hang if that never happens).
      try {
        const registration = await navigator.serviceWorker.getRegistration('/js/sw.js');
        const subscription = registration ? await registration.pushManager.getSubscription() : null;
        el.textContent = subscription ? '✅ Enabled' : "⚠️ Allowed, but not connected yet — tap Enable notifications on the Calendar tab";
      } catch (err) {
        el.textContent = '⚠️ Something went wrong checking this';
      }
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

  // Split the med list into morning and evening. Anything not explicitly
  // marked evening is treated as morning (older meds default to morning).
  function medsByPeriod() {
    const evening = state.medications.filter((m) => m.period === 'evening');
    const morning = state.medications.filter((m) => m.period !== 'evening');
    return { morning, evening };
  }

  function periodHeader(label) {
    const li = document.createElement('li');
    li.className = 'period-header';
    li.textContent = label;
    return li;
  }

  function renderMedicationList() {
    const list = $('#med-list');
    list.innerHTML = '';
    if (!state.medications.length) {
      list.innerHTML = '<li class="muted">No medications yet.</li>';
      return;
    }
    const { morning, evening } = medsByPeriod();
    if (morning.length) {
      list.appendChild(periodHeader('🌅 Morning'));
      morning.forEach((med) => list.appendChild(buildManageRow(med)));
    }
    if (evening.length) {
      list.appendChild(periodHeader('🌙 Evening'));
      evening.forEach((med) => list.appendChild(buildManageRow(med)));
    }
  }

  function buildManageRow(med) {
    const li = document.createElement('li');
    const meta = [med.dosage, med.time_of_day].filter(Boolean).join(' · ');
    const isEvening = med.period === 'evening';
    li.innerHTML = `
      <span><span class="med-name">${escapeHtml(med.name)}</span>${meta ? ` <span class="med-meta">${escapeHtml(meta)}</span>` : ''}</span>
      <span class="med-actions">
        <button class="period-toggle" title="Tap to move to ${isEvening ? 'morning' : 'evening'}">${isEvening ? '🌙 Evening' : '🌅 Morning'}</button>
        <button class="icon-btn" aria-label="Remove ${escapeHtml(med.name)}">✕</button>
      </span>
    `;
    li.querySelector('.period-toggle').addEventListener('click', async () => {
      const next = isEvening ? 'morning' : 'evening';
      await api(`/api/medications/${med.id}/period`, { method: 'PATCH', body: JSON.stringify({ period: next }) });
      await loadMedications();
      renderMedicationList();
      renderDayDetail();
      toast(next === 'evening' ? 'Moved to evening 🌙' : 'Moved to morning 🌅');
    });
    li.querySelector('.icon-btn').addEventListener('click', async () => {
      if (!confirm(`Remove ${med.name}?`)) return;
      await api(`/api/medications/${med.id}`, { method: 'DELETE' });
      await loadMedications();
      renderMedicationList();
      renderDayDetail();
    });
    return li;
  }

  $('#med-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#med-name').value.trim();
    const dosage = $('#med-dosage').value.trim();
    const time_of_day = $('#med-time').value;
    const period = $('#med-period').value;
    if (!name) return;
    await api('/api/medications', { method: 'POST', body: JSON.stringify({ name, dosage, time_of_day, period }) });
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

  // A period (morning or evening) counts as "done" once MORE than 40% of that
  // period's meds are checked off — she doesn't need everything every day. Keep
  // the threshold in sync with DAY_COMPLETE_THRESHOLD in server/index.js.
  const DAY_COMPLETE_THRESHOLD = 0.4;

  function periodDone(meds, dateStr) {
    if (!meds.length) return false;
    let taken = 0;
    for (const med of meds) {
      if (state.doses[`${med.id}:${dateStr}`]) taken += 1;
    }
    return taken / meds.length > DAY_COMPLETE_THRESHOLD;
  }

  function dayPeriodStatus(dateStr) {
    const { morning, evening } = medsByPeriod();
    return {
      morningDone: periodDone(morning, dateStr),
      eveningDone: periodDone(evening, dateStr),
    };
  }

  function appendWeekdayRow(grid) {
    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach((d) => {
      const el = document.createElement('div');
      el.className = 'cal-dow';
      el.textContent = d;
      grid.appendChild(el);
    });
  }

  function renderCalendar() {
    const grid = $('#calendar-grid');
    grid.innerHTML = '';
    const monthLabel = new Date(state.viewYear, state.viewMonth, 1).toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    });
    $('#month-label').textContent = monthLabel;

    appendWeekdayRow(grid);

    const firstDay = new Date(state.viewYear, state.viewMonth, 1);
    const daysInMonth = new Date(state.viewYear, state.viewMonth + 1, 0).getDate();
    const startOffset = firstDay.getDay();
    const todayStr = etToday();

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

      const { morningDone, eveningDone } = dayPeriodStatus(dateStr);
      if (morningDone) el.classList.add('m-done');
      if (eveningDone) el.classList.add('e-done');

      el.innerHTML = `<span class="cal-num">${day}</span>`;
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

    const { morning, evening } = medsByPeriod();
    if (morning.length) {
      list.appendChild(periodHeader('🌅 Morning'));
      morning.forEach((med) => list.appendChild(buildDayMedItem(med)));
    }
    if (evening.length) {
      list.appendChild(periodHeader('🌙 Evening'));
      evening.forEach((med) => list.appendChild(buildDayMedItem(med)));
    }
  }

  function buildDayMedItem(med) {
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
    return li;
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

  // ---------- Period tracking ----------
  // Its own tab and its own calendar: every day is the same pink, and the
  // days of a period are red. Two steps: tap the day it started, then (days
  // later) tap the day it ended. Until the end is marked only the start day
  // is red; once it's marked, the whole stretch fills in.
  const period = {
    list: [],
    year: Number(etToday().slice(0, 4)),
    month: Number(etToday().slice(5, 7)) - 1, // 0-indexed
  };

  function fmtDay(dateStr, opts = { month: 'short', day: 'numeric' }) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
  }

  function fmtLong(dateStr) {
    return fmtDay(dateStr, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  function daysBetween(a, b) {
    const [ay, am, ad] = a.split('-').map(Number);
    const [by, bm, bd] = b.split('-').map(Number);
    return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
  }

  function periodLength(p) {
    const n = daysBetween(p.start_date, p.end_date) + 1;
    return `${n} day${n === 1 ? '' : 's'}`;
  }

  // The period this day is shown red for (an unfinished one covers only its
  // start day until the end is marked).
  function periodOn(dateStr) {
    return period.list.find((p) => p.start_date <= dateStr && dateStr <= (p.end_date || p.start_date));
  }

  function openPeriod() {
    return period.list.find((p) => !p.end_date);
  }

  async function loadPeriodTab() {
    try {
      period.list = await api('/api/periods');
    } catch (err) {
      toast(err.message);
    }
    renderPeriodTab();
  }

  function renderPeriodTab() {
    renderPeriodPrompt();
    renderPeriodCalendar();
  }

  function renderPeriodPrompt() {
    const open = openPeriod();
    const finished = period.list.filter((p) => p.end_date);
    const last = finished[finished.length - 1];
    if (open) {
      const day = daysBetween(open.start_date, etToday()) + 1;
      $('#period-step').textContent = 'When it’s over, tap the day it ended ✔';
      $('#period-status').textContent = `Started ${fmtLong(open.start_date)}${day > 0 ? ` — today is day ${day}` : ''}.`;
    } else {
      $('#period-step').textContent = 'Tap the day your period started 🩸';
      $('#period-status').textContent = last
        ? `Last period: ${fmtDay(last.start_date)} – ${fmtDay(last.end_date)} (${periodLength(last)}).`
        : 'Nothing logged yet.';
    }
  }

  function renderPeriodCalendar() {
    const grid = $('#period-grid');
    grid.innerHTML = '';
    $('#period-month-label').textContent = new Date(period.year, period.month, 1).toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    });

    appendWeekdayRow(grid);

    const startOffset = new Date(period.year, period.month, 1).getDay();
    const daysInMonth = new Date(period.year, period.month + 1, 0).getDate();
    const todayStr = etToday();

    for (let i = 0; i < startOffset; i++) {
      const el = document.createElement('div');
      el.className = 'cal-day empty';
      grid.appendChild(el);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${period.year}-${pad2(period.month + 1)}-${pad2(day)}`;
      const el = document.createElement('div');
      el.className = 'cal-day pcal';
      if (periodOn(dateStr)) el.classList.add('bleed');
      if (dateStr === todayStr) el.classList.add('today');
      el.innerHTML = `<span class="cal-num">${day}</span>`;
      el.addEventListener('click', () => openPeriodModal(dateStr));
      grid.appendChild(el);
    }
  }

  function closePeriodModal() {
    $('#period-modal').hidden = true;
  }

  // The popup shown when a day is tapped: says what that day is and offers
  // only the actions that make sense for it.
  function openPeriodModal(d) {
    const today = etToday();
    const open = openPeriod();
    const on = period.list.find((p) => p.end_date && p.start_date <= d && d <= p.end_date);
    const actions = $('#period-modal-actions');
    actions.innerHTML = '';
    $('#period-modal-title').textContent = fmtLong(d);
    const setText = (t) => ($('#period-modal-text').textContent = t);

    const add = (label, className, onClick) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = className;
      btn.textContent = label;
      btn.addEventListener('click', () => onClick(btn));
      actions.appendChild(btn);
    };
    const save = (label, request, message) => add(label, 'primary-btn', () => savePeriod(request, message));
    const patch = (id, body) => () => api(`/api/periods/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    // Removing takes two taps so it can't happen by accident.
    const remove = (label, id, message) =>
      add(label, 'ghost-btn', (btn) => {
        if (!btn.dataset.armed) {
          btn.dataset.armed = '1';
          btn.textContent = 'Tap again to remove';
          return;
        }
        savePeriod(() => api(`/api/periods/${id}`, { method: 'DELETE' }), message);
      });

    if (d > today) {
      setText('That day hasn’t happened yet — tap it once it has 💗');
    } else if (open && d === open.start_date) {
      setText('Your period started this day. When it’s over, tap the day it ended.');
      remove('Remove this start day', open.id, 'Start day removed');
    } else if (on) {
      setText(`Period: ${fmtDay(on.start_date)} – ${fmtDay(on.end_date)} (${periodLength(on)}).`);
      if (d !== on.start_date) save('Make this the start day', patch(on.id, { start_date: d }), 'Start day changed 💗');
      if (d !== on.end_date) save('Make this the end day', patch(on.id, { end_date: d }), 'End day changed 💗');
      remove('Remove this period', on.id, 'Period removed');
    } else if (open && d > open.start_date) {
      setText(`Your period started ${fmtLong(open.start_date)}. Did it end this day?`);
      save('✔ Yes — it ended this day', patch(open.id, { end_date: d }), 'Period logged 💗');
    } else if (open) {
      // A day before the current period's start.
      setText(`Your current period is marked as starting ${fmtLong(open.start_date)}.`);
      save('🩸 It actually started this day', patch(open.id, { start_date: d }), 'Start day changed 💗');
    } else {
      setText('Did your period start this day?');
      save('🩸 Yes — it started this day', () => api('/api/periods', { method: 'POST', body: JSON.stringify({ start_date: d }) }), 'Got it — tap the day it ends later 💗');
      // Tapped a few days after the last period? Maybe it just ran longer.
      const before = period.list.filter((p) => p.end_date && p.end_date < d).pop();
      if (before && daysBetween(before.end_date, d) <= 7) {
        add(`No — the ${fmtDay(before.start_date)} period ended this day`, 'ghost-btn', () =>
          savePeriod(patch(before.id, { end_date: d }), 'End day changed 💗')
        );
      }
    }
    add(d > today ? 'OK' : 'Cancel', 'ghost-btn', closePeriodModal);
    $('#period-modal').hidden = false;
  }

  $('#period-modal').addEventListener('click', (e) => {
    if (e.target.id === 'period-modal') closePeriodModal();
  });

  async function savePeriod(request, message) {
    $$('#period-modal-actions button').forEach((b) => (b.disabled = true));
    try {
      await request();
      period.list = await api('/api/periods');
      closePeriodModal();
      renderPeriodTab();
      toast(message);
    } catch (err) {
      $$('#period-modal-actions button').forEach((b) => (b.disabled = false));
      toast(err.message);
    }
  }

  $('#period-prev-month').addEventListener('click', () => {
    period.month -= 1;
    if (period.month < 0) {
      period.month = 11;
      period.year -= 1;
    }
    renderPeriodCalendar();
  });

  $('#period-next-month').addEventListener('click', () => {
    period.month += 1;
    if (period.month > 11) {
      period.month = 0;
      period.year += 1;
    }
    renderPeriodCalendar();
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

  // Registering the service worker resolves before it's necessarily
  // *active* — subscribing too early throws "no active Service Worker".
  // Wait for activation with a bounded timeout (never `serviceWorker.ready`,
  // which waits for the worker to be controlling this page and can hang
  // indefinitely if that never happens).
  function waitForActiveServiceWorker(registration, timeoutMs = 8000) {
    if (registration.active) return Promise.resolve(registration.active);
    const worker = registration.installing || registration.waiting;
    if (!worker) return Promise.resolve(registration.active);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(registration.active), timeoutMs);
      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated') {
          clearTimeout(timer);
          resolve(registration.active);
        }
      });
    });
  }

  // Actually registers the service worker and subscribes to push. Assumes
  // Notification permission has already been granted — call this either
  // right after Notification.requestPermission() resolves, or on later
  // visits once permission is already 'granted'.
  function withTimeout(promise, ms, message) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
    ]);
  }

  // True when an existing subscription was created with a *different* server
  // key than the one currently in use. If the server's VAPID key ever
  // changes, old subscriptions stop working silently, so we must drop and
  // recreate them rather than keep re-registering a dead one.
  function subscriptionMatchesKey(subscription, expectedKeyBytes) {
    const existing = subscription.options && subscription.options.applicationServerKey;
    if (!existing) return false;
    const a = new Uint8Array(existing);
    if (a.length !== expectedKeyBytes.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== expectedKeyBytes[i]) return false;
    return true;
  }

  async function subscribeToPush() {
    const { publicKey } = await api('/api/push/vapid-public-key');
    if (!publicKey) return;
    const keyBytes = urlBase64ToUint8Array(publicKey);
    const registration = await navigator.serviceWorker.register('/js/sw.js');
    await waitForActiveServiceWorker(registration);

    let subscription = await registration.pushManager.getSubscription();
    // If a subscription exists but was made with an older server key, it's
    // dead — unsubscribe so we can make a fresh one that actually works.
    if (subscription && !subscriptionMatchesKey(subscription, keyBytes)) {
      try { await subscription.unsubscribe(); } catch (e) { /* ignore */ }
      subscription = null;
    }

    if (!subscription) {
      // The browser's own subscribe() call reaches out to its push service
      // (Apple's/Google's) — on a restrictive network that can hang rather
      // than fail, so bound it instead of leaving the UI stuck forever.
      subscription = await withTimeout(
        registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes,
        }),
        15000,
        'Turning on notifications is taking too long — check your connection and try again.'
      );
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
      try {
        await subscribeToPush();
        banner.hidden = true;
      } catch (err) {
        // Permission says yes, but the actual subscription failed (a real
        // case on iOS) — surface it instead of silently doing nothing, and
        // offer a retry button rather than leaving the person stuck.
        console.warn('Push subscribe failed:', err);
        banner.hidden = false;
        btn.hidden = false;
        text.textContent = "Notifications are allowed, but turning them on didn't finish. Tap below to try again.";
      }
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
      if (Notification.permission !== 'granted') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          refreshNotificationUi();
          return;
        }
      }
      await subscribeToPush();
      toast('Notifications on! 🔔💗');
    } catch (err) {
      toast(err.message || "Couldn't turn on notifications — try again?");
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
