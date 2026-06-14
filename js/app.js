// js/app.js — controller: polling loop, selector wiring, state.
import { CONFIG } from './config.js';
import { loadMatches, loadDetail, health } from './data.js';
import {
  renderMatchStrip,
  renderScoreboard,
  renderEventLog,
  clearEventLog,
  renderHealth,
  renderAuthority,
  setLastPoll,
  setDemoBanner,
  refreshFlash,
  renderLineups,
  renderStats,
  renderTable,
  renderTeamSummary,
  renderMatchExtra,
} from './render.js';

const state = {
  matches: [],
  selectedId: null,
  shownKeys: new Set(), // event log de-dup keys
  detail: null, // last loaded detail object
  activeTab: 'timeline',
  startedAt: Date.now(),
  nextPollAt: 0,
  clockSyncedAt: Date.now(),
  prevScores: new Map(), // matchId -> {total,h,a} for goal detection (all matches)
  prevSel: null, // {id,h,a} for flip animation on the selected scoreboard
  alertsOn: false,
  audioCtx: null,
};

// ---- match clock -----------------------------------------------------------
// States: NOT STARTED / HALF TIME / COOLING BREAK / 45:00 (+x) / 90:00 (+x) / FULL TIME
function clockText(m) {
  if (!m) return '';
  if (m.status === 'pre') return 'NOT STARTED';
  if (m.status === 'ft') return 'FULL TIME';
  const period = String(m.period || '');
  const p = period.toLowerCase();
  if (/\bht\b|half[\s-]?time/.test(p) && !/\d/.test(p)) return 'HALF TIME';
  if (/cool|water|drink|break/.test(p)) return 'COOLING BREAK';
  const stop = /(\d+)\s*'?\s*\+\s*(\d+)/.exec(period);
  if (stop) {
    const base = parseInt(stop[1], 10);
    const anchor = base >= 46 ? 90 : 45;
    return `${anchor}:00 (+${stop[2]})`;
  }
  let total;
  if (m.minute != null) {
    const secs = Math.floor((Date.now() - state.clockSyncedAt) / 1000);
    total = m.minute * 60 + Math.max(0, Math.min(secs, 120));
    const cap = m.minute < 45 ? 45 * 60 : m.minute < 90 ? 90 * 60 : (m.minute + 1) * 60;
    if (total > cap) total = cap;
  } else {
    const ko = Date.parse(m.kickoff);
    if (isNaN(ko)) return 'LIVE';
    total = Math.max(0, Math.floor((Date.now() - ko) / 1000));
    if (total > 45 * 60) total = 45 * 60;
  }
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function renderClock() {
  const elc = document.getElementById('sb-clock');
  if (!elc) return;
  const m = selectedMatch();
  const txt = clockText(m);
  if (elc.textContent !== txt) elc.textContent = txt;
  const cls = 'sb-clock' + (m && m.status === 'live' ? ' live' : '');
  if (elc.className !== cls) elc.className = cls;
}

function selectedMatch() {
  return state.matches.find((m) => m.id === state.selectedId) || null;
}

// ---- goal alerts -----------------------------------------------------------
function matchTotal(m) {
  return (m.home.score || 0) + (m.away.score || 0);
}

// Compare each match's score to the previous poll; return goals scored.
function detectGoals(matches) {
  const goals = [];
  for (const m of matches) {
    const total = matchTotal(m);
    const prev = state.prevScores.get(m.id);
    if (prev && total > prev.total && (m.status === 'live' || m.status === 'ft')) {
      const hs = m.home.score || 0;
      const as = m.away.score || 0;
      const team = hs > prev.h ? m.home : m.away;
      goals.push({ m, team, hs, as });
    }
    state.prevScores.set(m.id, { total, h: m.home.score || 0, a: m.away.score || 0 });
  }
  return goals;
}

function ensureAudio() {
  if (!state.audioCtx) {
    try {
      state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (_) { /* unsupported */ }
  }
  if (state.audioCtx && state.audioCtx.state === 'suspended') state.audioCtx.resume();
}

function beep() {
  ensureAudio();
  const c = state.audioCtx;
  if (!c) return;
  const now = c.currentTime;
  [0, 0.18].forEach((t, i) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'square';
    o.frequency.value = i ? 880 : 620;
    o.connect(g); g.connect(c.destination);
    g.gain.setValueAtTime(0.0001, now + t);
    g.gain.exponentialRampToValueAtTime(0.22, now + t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.16);
    o.start(now + t); o.stop(now + t + 0.18);
  });
}

function notifyGoal(text) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification('⚽ GOAL', { body: text }); } catch (_) { /* ignore */ }
}

function goalFlash() {
  const s = document.getElementById('screen');
  if (!s) return;
  s.classList.remove('goal-flash');
  void s.offsetWidth;
  s.classList.add('goal-flash');
}

function setAlerts(on) {
  state.alertsOn = on;
  try { localStorage.setItem('wc_alerts', on ? '1' : '0'); } catch (_) { /* ignore */ }
  const b = document.getElementById('alert-toggle');
  if (b) { b.textContent = `🔔 ALERTS: ${on ? 'ON' : 'OFF'}`; b.classList.toggle('on', on); }
  if (on) {
    ensureAudio();
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  }
}

// ---- flip-board score animation -------------------------------------------
function flipEl(id) {
  const e = document.getElementById(id);
  if (!e) return;
  e.classList.remove('flip');
  void e.offsetWidth; // restart animation
  e.classList.add('flip');
}
function flipScoreIfChanged(m) {
  if (!m) { state.prevSel = null; return; }
  const h = m.home.score;
  const a = m.away.score;
  if (state.prevSel && state.prevSel.id === m.id) {
    if (state.prevSel.h !== h) flipEl('score-h');
    if (state.prevSel.a !== a) flipEl('score-a');
  }
  state.prevSel = { id: m.id, h, a };
}

// ---- tabs ------------------------------------------------------------------
function showTab(tab) {
  state.activeTab = tab;
  for (const btn of document.querySelectorAll('.tab')) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  }
  for (const view of document.querySelectorAll('.tab-view')) {
    view.hidden = view.id !== `view-${tab}`;
  }
  renderActiveTab();
}

function renderActiveTab() {
  const m = selectedMatch();
  if (state.activeTab === 'lineups') renderLineups(state.detail);
  else if (state.activeTab === 'stats') renderStats(state.detail);
  else if (state.activeTab === 'table') renderTable(state.detail, m);
}

// Render the selected match's scoreboard + all dependent panels.
function renderSelected(m) {
  renderScoreboard(m);
  flipScoreIfChanged(m);
  renderClock();
  renderTeamSummary(m, state.detail);
  renderMatchExtra(m, state.detail);
  renderEventLog(m, state.shownKeys);
  renderActiveTab();
}

async function poll() {
  try {
    const { matches, authority, demo } = await loadMatches();
    state.matches = matches;
    setDemoBanner(demo);
    renderAuthority(authority);
    renderHealth(health);

    // Goal detection across ALL matches (not just the selected one).
    const goals = detectGoals(matches);
    if (goals.length) {
      goalFlash();
      if (state.alertsOn) {
        beep();
        for (const g of goals) {
          notifyGoal(`${g.team.name} — ${g.m.home.abbr || g.m.home.name} ${g.hs}-${g.as} ${g.m.away.abbr || g.m.away.name}`);
        }
      }
    }

    const newSelected = renderMatchStrip(matches, state.selectedId);
    if (newSelected !== state.selectedId) {
      state.selectedId = newSelected;
      state.shownKeys.clear();
      clearEventLog();
    }

    const m = selectedMatch();
    if (m) {
      const detail = await loadDetail(m);
      state.detail = detail;
      if (detail && detail.events && detail.events.length) m.events = detail.events;
    } else {
      state.detail = null;
    }

    state.clockSyncedAt = Date.now();
    renderSelected(m);
    setLastPoll(new Date());
    refreshFlash();
  } catch (err) {
    console.error('poll error', err);
  } finally {
    state.nextPollAt = Date.now() + CONFIG.POLL_INTERVAL;
  }
}

function tickUptime() {
  const s = Math.floor((Date.now() - state.startedAt) / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  const up = document.getElementById('uptime');
  if (up) up.textContent = `${hh}:${mm}:${ss}`;

  const remain = Math.max(0, state.nextPollAt - Date.now());
  const pct = 100 * (1 - remain / CONFIG.POLL_INTERVAL);
  const bar = document.getElementById('poll-progress');
  if (bar) bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  const cd = document.getElementById('next-poll');
  if (cd) cd.textContent = `${(remain / 1000).toFixed(1)}s`;

  renderClock();
}

function init() {
  document.getElementById('match-strip').addEventListener('click', (e) => {
    const box = e.target.closest('.match-box');
    if (!box) return;
    state.selectedId = box.dataset.id;
    state.shownKeys.clear();
    state.detail = null;
    state.prevSel = null;
    state.clockSyncedAt = Date.now();
    clearEventLog();
    renderMatchStrip(state.matches, state.selectedId);
    renderSelected(selectedMatch());
    poll(); // fetch detail for the newly selected match right away
  });

  for (const btn of document.querySelectorAll('.tab')) {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  }

  const at = document.getElementById('alert-toggle');
  if (at) at.addEventListener('click', () => setAlerts(!state.alertsOn));
  try { if (localStorage.getItem('wc_alerts') === '1') setAlerts(true); } catch (_) { /* ignore */ }

  state.nextPollAt = Date.now() + CONFIG.POLL_INTERVAL;
  poll();
  setInterval(poll, CONFIG.POLL_INTERVAL);
  setInterval(tickUptime, 100);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
