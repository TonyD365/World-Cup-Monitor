// js/app.js — controller: polling loop, selector wiring, state.
import { CONFIG } from './config.js';
import { loadMatches, loadDetail, loadStandings, resolvePlayerPhoto, health } from './data.js';
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
  clockAnchor: { id: null, minute: null, at: 0 }, // anchor for second-by-second interpolation
  stopAnchor: { id: null, base: null, at: 0 }, // anchor for stoppage-time seconds
  prevScores: new Map(), // matchId -> {total,h,a} for goal detection (all matches)
  prevSel: null, // {id,h,a} for flip animation on the selected scoreboard
  alertsOn: false,
  audioCtx: null,
};

// ---- match clock -----------------------------------------------------------
// States: NOT STARTED / HALF TIME / HYDRATION BREAK / 45:00 (+x) / 90:00 (+x) / FULL TIME
// ESPN reports drinks/cooling breaks only in the commentary text, e.g.
// "Delay in match for a drinks break" (start) and "Delay over. They are ready
// to continue." / "End Delay" (end). We're in a break if a start has occurred
// with no matching end after it.
function inHydrationBreak(m) {
  let start = -1;
  let end = -1;
  for (const e of m.events || []) {
    const d = (e.detail || '').toLowerCase();
    const mn = e.min == null ? 999 : e.min;
    if (/drinks? break|cooling break|hydration break/.test(d)) start = Math.max(start, mn);
    else if (/delay over|ready to continue|\bend delay\b/.test(d)) end = Math.max(end, mn);
  }
  return start >= 0 && (end < 0 || end < start);
}

function clockText(m) {
  if (!m) return '';
  if (m.status === 'pre') return 'NOT STARTED';
  if (m.status === 'ft') return 'FULL TIME';
  const period = String(m.period || '');
  const p = period.toLowerCase();
  if (/\bht\b|half[\s-]?time/.test(p) && !/\d/.test(p)) return 'HALF TIME';
  // Hydration/drinks break (from commentary), or a status that flags it.
  if (inHydrationBreak(m) || /hydration|cooling|drinks? break/.test(p)) return 'HYDRATION BREAK';
  const stop = /(\d+)\s*'?\s*\+\s*(\d+)/.exec(period);
  if (stop) {
    // Stoppage time with ticking seconds, e.g. "45:00 (+2:34)". Seed the elapsed
    // from the announced added minutes, then tick continuously.
    const base = parseInt(stop[1], 10) >= 46 ? 90 : 45;
    const n = parseInt(stop[2], 10) || 0;
    const sa = state.stopAnchor;
    if (sa.id !== m.id || sa.base !== base) {
      state.stopAnchor = { id: m.id, base, at: Date.now() - Math.max(0, n - 1) * 60000 };
    }
    const elapsed = Math.max(0, Math.floor((Date.now() - state.stopAnchor.at) / 1000));
    return `${base}:00 (+${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')})`;
  }
  let total;
  let minute = m.minute;
  const a = state.clockAnchor;
  // Keep the last known minute if the feed momentarily drops it (avoids a flash
  // to the kickoff fallback, which caps at 45:00 — the "45 flash" in 2nd half).
  if (minute == null && a.id === m.id && a.minute != null) minute = a.minute;
  if (minute == null) {
    // Truly unknown (e.g. just kicked off): derive from kickoff time.
    const ko = Date.parse(m.kickoff);
    if (isNaN(ko)) return 'LIVE';
    total = Math.max(0, Math.floor((Date.now() - ko) / 1000));
    if (total > 45 * 60) total = 45 * 60;
  } else {
    // Minutes only increase within a live match — ignore transient backward dips.
    if (a.id === m.id && a.minute != null && minute < a.minute) minute = a.minute;
    if (a.id !== m.id || a.minute !== minute) {
      state.clockAnchor = { id: m.id, minute, at: Date.now() };
    }
    const secs = Math.min(59, Math.floor((Date.now() - state.clockAnchor.at) / 1000));
    total = minute * 60 + secs;
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

// Show only the single group that contains BOTH teams (group stage). If there
// isn't one (e.g. a knockout match), show no table.
function groupsForMatch(groups, m) {
  const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  const hn = norm(m.home.name);
  const an = norm(m.away.name);
  const teams = (g) => g.rows.map((r) => norm(r.team));
  const hit = groups.find((g) => { const t = teams(g); return t.includes(hn) && t.includes(an); });
  return hit ? [hit] : [];
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
  // Three rising notes, louder, so a goal is clearly audible.
  [620, 820, 1040].forEach((f, i) => {
    const t = i * 0.16;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'square';
    o.frequency.value = f;
    o.connect(g); g.connect(c.destination);
    g.gain.setValueAtTime(0.0001, now + t);
    g.gain.exponentialRampToValueAtTime(0.5, now + t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.15);
    o.start(now + t); o.stop(now + t + 0.16);
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
    beep(); // confirmation tone (also unlocks audio within this user gesture)
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
  if (state.activeTab === 'lineups') { renderLineups(state.detail); upgradeLineupPhotos(); }
  else if (state.activeTab === 'stats') renderStats(state.detail);
  else if (state.activeTab === 'table') renderTable(state.detail, m);
}

// Upgrade players still showing an initials avatar to a real photo (TheSportsDB).
async function upgradeLineupPhotos() {
  const imgs = document.querySelectorAll('#view-lineups img[data-pname]');
  for (const img of imgs) {
    const cur = img.getAttribute('src') || '';
    if (!cur.includes('ui-avatars.com')) continue; // already a real photo
    if (img.dataset.tried === '1') continue;
    img.dataset.tried = '1';
    const url = await resolvePlayerPhoto(img.dataset.pname); // sequential = gentle on rate limits
    if (url && (img.getAttribute('src') || '').includes('ui-avatars.com')) img.src = url;
  }
}

// Render the selected match's scoreboard + all dependent panels.
function renderSelected(m) {
  renderScoreboard(m);
  flipScoreIfChanged(m);
  renderClock();
  renderTeamSummary(m, state.detail);
  renderMatchExtra(m, state.detail);
  renderEventLog(m, state.shownKeys, state.detail);
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
      const detail = (await loadDetail(m)) || {};
      if (detail.events && detail.events.length) m.events = detail.events;
      // The summary header is the most current per-match state — override the
      // (possibly stale) scoreboard/merge values for the selected match.
      const L = detail.live;
      if (L) {
        if (L.status) m.status = L.status;
        if (L.minute != null) m.minute = L.minute; // don't clobber with null
        if (L.period) m.period = L.period;
        if (L.homeScore != null) m.home.score = L.homeScore;
        if (L.awayScore != null) m.away.score = L.awayScore;
      }
      // Group table: ESPN summary rarely includes it, so fall back to the table
      // computed from openfootball results, filtered to this match's group.
      if (!detail.table || !detail.table.length) {
        const groups = await loadStandings().catch(() => []);
        if (groups.length) detail.table = groupsForMatch(groups, m);
      }
      state.detail = detail;
    } else {
      state.detail = null;
    }

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
    state.clockAnchor = { id: null, minute: null, at: 0 };
    state.stopAnchor = { id: null, base: null, at: 0 };
    clearEventLog();
    renderMatchStrip(state.matches, state.selectedId);
    // Immediate scoreboard feedback; the event log + tabs are filled by poll()
    // once detail (lineups → jersey numbers, etc.) has loaded.
    renderScoreboard(selectedMatch());
    renderClock();
    poll(); // fetch detail for the newly selected match right away
  });

  for (const btn of document.querySelectorAll('.tab')) {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  }

  const at = document.getElementById('alert-toggle');
  if (at) at.addEventListener('click', () => setAlerts(!state.alertsOn));
  // Unlock WebAudio on the first user interaction (iOS requires a gesture).
  const unlock = () => { ensureAudio(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('touchend', unlock); };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('touchend', unlock);
  // Restore persisted preference without auto-beeping (no gesture yet).
  try {
    if (localStorage.getItem('wc_alerts') === '1') {
      state.alertsOn = true;
      const b = document.getElementById('alert-toggle');
      if (b) { b.textContent = '🔔 ALERTS: ON'; b.classList.add('on'); }
    }
  } catch (_) { /* ignore */ }

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
