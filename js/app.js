// js/app.js — controller: polling loop, selector wiring, state.
import { CONFIG } from './config.js';
import { loadMatches, loadDetail, loadStandings, loadBracket, resolvePlayerPhoto, health } from './data.js';
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
  renderBracket,
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
  pollTimer: null,
  pollInterval: CONFIG.POLL_INTERVAL,
  favorites: loadFavorites(), // Set of normalized team names
  bestThirds: null, // Set of normalized names of the 8 best third-placed teams
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
  const pn = m.periodNum; // 1=1H, 2=2H, 3=ET1, 4=ET2, 5=penalties
  // Are we in extra time? Trust ESPN's numeric period, fall back to the text or
  // a clock past 90'.
  const inET = pn >= 3 || /extra|\bet\b|a\.?e\.?t/.test(p) || (m.minute != null && m.minute > 90);
  // Penalty shootout (live): the score line carries the running tally.
  if (pn === 5 || /penalt|shoot[\s-]?out|\bpso\b|spot[\s-]?kick/.test(p)) return 'PENALTIES';
  // Half time — distinguish the break inside extra time.
  if (/\bht\b|half[\s-]?time|halftime/.test(p) && !/\d/.test(p)) return inET ? 'HALF TIME (ET)' : 'HALF TIME';
  // Hydration/drinks break (from commentary), or a status that flags it.
  if (inHydrationBreak(m) || /hydration|cooling|drinks? break/.test(p)) return 'HYDRATION BREAK';
  const stop = /(\d+)\s*'?\s*\+\s*(\d+)/.exec(period);
  if (stop) {
    // Stoppage time with ticking seconds, e.g. "45:00 (+2:34)" or, in extra
    // time, "105:00 (+1:20)". Seed the elapsed from the announced added minutes,
    // then tick continuously. The base is the nominal end of the current half:
    // 45 (1H), 90 (2H), 105 (ET1), 120 (ET2).
    const at = parseInt(stop[1], 10);
    const base = at >= 106 ? 120 : at >= 91 ? 105 : at >= 46 ? 90 : 45;
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
    // ESPN's minute is 1-based ("1'" during the first minute = 0:xx elapsed), so
    // show (minute-1):SS — kickoff starts at 00:00, 2nd half ("46'") at 45:00.
    total = Math.max(0, minute - 1) * 60 + secs;
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

// Pick the standings group for the selected match's teams (group stage only).
function groupsForMatch(groups, m) {
  const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  const hn = norm(m.home.name);
  const an = norm(m.away.name);
  const has = (g, n) => g.rows.some((r) => norm(r.team) === n);
  const homeG = groups.find((g) => has(g, hn));
  const awayG = groups.find((g) => has(g, an));
  if (homeG && awayG) return homeG === awayG ? [homeG] : []; // same group, or knockout → none
  if (homeG) return [homeG]; // away name mismatched across sources; both share home's group
  if (awayG) return [awayG];
  return [];
}

// The expanded 2026 format takes the top two of each group plus the eight best
// third-placed teams. Collect every group's rank-3 row, rank them by points,
// goal difference, then goals for, and return the top eight as a normalized-name
// Set so the table can mark exactly those rows (and no other thirds).
function computeBestThirds(groups, n = 8) {
  const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  const thirds = [];
  for (const g of groups || []) {
    const row = (g.rows || []).find((r) => Number(r.rank) === 3);
    if (row) thirds.push(row);
  }
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  thirds.sort((a, b) => num(b.pts) - num(a.pts) || num(b.gd) - num(a.gd) || num(b.gf) - num(a.gf));
  return new Set(thirds.slice(0, n).map((r) => norm(r.team)));
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
  return state.audioCtx;
}

function playBeep() {
  const c = state.audioCtx;
  if (!c) return;
  const now = c.currentTime;
  const dur = 0.55; // one clear sustained "beeep"
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.value = 880;
  o.connect(g); g.connect(c.destination);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.5, now + 0.02); // quick attack
  g.gain.setValueAtTime(0.5, now + dur - 0.08); // hold
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur); // gentle release
  o.start(now);
  o.stop(now + dur + 0.02);
}

// iOS suspends the AudioContext when idle/backgrounded, so resume FIRST and play
// only once it's running (resume() is async — playing on a suspended context is
// silent). That's why the goal beep didn't sound.
function beep() {
  const c = ensureAudio();
  if (!c) return;
  if (c.state === 'suspended') c.resume().then(playBeep).catch(() => {});
  else playBeep();
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
  else if (state.activeTab === 'table') renderTable(state.detail, m, state.bestThirds);
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
  renderScoreboard(m, state.favorites);
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

    // Prefer a favorite match (live first) when nothing is selected yet.
    if (!state.selectedId) {
      const fav = matches.find((mm) => mm.status === 'live' && isFavMatch(mm)) || matches.find(isFavMatch);
      if (fav) state.selectedId = fav.id;
    }
    const newSelected = renderMatchStrip(matches, state.selectedId, state.favorites);
    if (newSelected !== state.selectedId) {
      state.selectedId = newSelected;
      state.shownKeys.clear();
      clearEventLog();
    }
    if (state.selectedId) { try { history.replaceState(null, '', `#${encodeURIComponent(state.selectedId)}`); } catch (_) { /* ignore */ } }

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
        if (L.periodNum != null) m.periodNum = L.periodNum;
        if (L.homeScore != null) m.home.score = L.homeScore;
        if (L.awayScore != null) m.away.score = L.awayScore;
        m.homeShootout = L.homeShootout; // null clears once the shootout is over
        m.awayShootout = L.awayShootout;
      }
      // Group table: ESPN summary rarely includes it, so fall back to the table
      // computed from openfootball results, filtered to this match's group.
      if (!detail.table || !detail.table.length) {
        const groups = await loadStandings().catch(() => []);
        if (groups.length) {
          detail.table = groupsForMatch(groups, m);
          state.bestThirds = computeBestThirds(groups, 8);
        }
      }
      state.detail = detail;
    } else {
      state.detail = null;
    }

    renderSelected(m);
    setLastPoll(new Date());
    refreshFlash();
    loadBracket().then(renderBracket).catch(() => {}); // knockout bracket (cached)
  } catch (err) {
    console.error('poll error', err);
  } finally {
    scheduleNextPoll();
  }
}

// Adaptive polling: fast (1s) while a match is live, slow (5s) otherwise, and
// fully paused while the tab is hidden — saves requests/battery.
function scheduleNextPoll() {
  clearTimeout(state.pollTimer);
  if (document.hidden) { state.nextPollAt = 0; return; }
  const hasLive = state.matches.some((m) => m.status === 'live');
  state.pollInterval = hasLive ? CONFIG.POLL_INTERVAL : CONFIG.IDLE_INTERVAL;
  state.nextPollAt = Date.now() + state.pollInterval;
  state.pollTimer = setTimeout(poll, state.pollInterval);
}

function tickUptime() {
  if (document.hidden) return;
  const s = Math.floor((Date.now() - state.startedAt) / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  const up = document.getElementById('uptime');
  if (up) up.textContent = `${hh}:${mm}:${ss}`;

  const interval = state.pollInterval || CONFIG.POLL_INTERVAL;
  const remain = Math.max(0, state.nextPollAt - Date.now());
  const pct = 100 * (1 - remain / interval);
  const bar = document.getElementById('poll-progress');
  if (bar) bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  const cd = document.getElementById('next-poll');
  if (cd) cd.textContent = `${(remain / 1000).toFixed(1)}s`;

  renderClock();
  renderNextMatch();
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
    try { history.replaceState(null, '', `#${encodeURIComponent(state.selectedId)}`); } catch (_) { /* ignore */ }
    renderMatchStrip(state.matches, state.selectedId, state.favorites);
    // Immediate scoreboard feedback; the event log + tabs are filled by poll()
    // once detail (lineups → jersey numbers, etc.) has loaded.
    renderScoreboard(selectedMatch(), state.favorites);
    renderClock();
    poll(); // fetch detail for the newly selected match right away
  });

  for (const btn of document.querySelectorAll('.tab')) {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  }

  const cl = document.getElementById('copy-link');
  if (cl) cl.addEventListener('click', async () => {
    const url = location.href; // includes #matchId for the selected match
    try { await navigator.clipboard.writeText(url); } catch (_) { try { window.prompt('Copy this match link:', url); } catch (__) { /* ignore */ } return; }
    cl.textContent = '🔗 COPIED!';
    setTimeout(() => { cl.textContent = '🔗 COPY LINK'; }, 1500);
  });

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

  // Deep link: restore the selected match from the URL hash.
  const h = decodeURIComponent((location.hash || '').slice(1));
  if (h) state.selectedId = h;

  // Favorite-team star toggles (delegated on the scoreboard).
  const sb = document.getElementById('scoreboard');
  if (sb) sb.addEventListener('click', (e) => {
    const star = e.target.closest('.fav-star');
    if (!star) return;
    toggleFavorite(star.dataset.team);
    renderScoreboard(selectedMatch(), state.favorites);
    renderMatchStrip(state.matches, state.selectedId, state.favorites);
  });

  // Pause polling when hidden; resume immediately when visible.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearTimeout(state.pollTimer); }
    else { if (state.alertsOn) ensureAudio(); poll(); } // re-warm audio on return
  });

  // We no longer use a service worker (it caused stale code). Proactively
  // unregister any previously-installed one so users always get fresh code.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
    if (window.caches && caches.keys) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
  }

  poll(); // first poll schedules the next via scheduleNextPoll()
  setInterval(tickUptime, 100);
}

// ---- favorites + next-match countdown -------------------------------------
const favNorm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
function loadFavorites() {
  try { return new Set(JSON.parse(localStorage.getItem('wc_fav') || '[]')); } catch (_) { return new Set(); }
}
function toggleFavorite(team) {
  const k = favNorm(team);
  if (!k) return;
  if (state.favorites.has(k)) state.favorites.delete(k); else state.favorites.add(k);
  try { localStorage.setItem('wc_fav', JSON.stringify([...state.favorites])); } catch (_) { /* ignore */ }
}
function isFavMatch(m) {
  return state.favorites.has(favNorm(m.home.name)) || state.favorites.has(favNorm(m.away.name)) ||
    state.favorites.has(favNorm(m.home.abbr)) || state.favorites.has(favNorm(m.away.abbr));
}

function renderNextMatch() {
  const el2 = document.getElementById('next-match');
  if (!el2) return;
  const now = Date.now();
  const upcoming = state.matches
    .filter((m) => m.status === 'pre' && Date.parse(m.kickoff) > now)
    .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff))[0];
  if (!upcoming) { el2.textContent = ''; return; }
  const diff = Math.max(0, Date.parse(upcoming.kickoff) - now);
  const hh = String(Math.floor(diff / 3600000)).padStart(2, '0');
  const mm = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
  const ss = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
  const a = upcoming.home.abbr || upcoming.home.name;
  const b = upcoming.away.abbr || upcoming.away.name;
  el2.textContent = `NEXT: ${a} v ${b} · ${hh}:${mm}:${ss}`;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
