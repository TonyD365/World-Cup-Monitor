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
} from './render.js';

const state = {
  matches: [],
  selectedId: null,
  shownKeys: new Set(), // event log de-dup keys
  detail: null, // last loaded { events, lineups, stats, table }
  activeTab: 'timeline',
  startedAt: Date.now(),
  nextPollAt: 0,
  clockSyncedAt: Date.now(), // when the selected match's minute was last refreshed
};

// Build the match-clock string shown above the score.
// States: NOT STARTED / HALF TIME / COOLING BREAK / 45:00 (+x) / 90:00 (+x) / FULL TIME
function clockText(m) {
  if (!m) return '';
  if (m.status === 'pre') return 'NOT STARTED';
  if (m.status === 'ft') return 'FULL TIME';
  const period = String(m.period || '');
  const p = period.toLowerCase();
  // Half-time (HT, no running minute).
  if (/\bht\b|half[\s-]?time/.test(p) && !/\d/.test(p)) return 'HALF TIME';
  // Cooling / water break.
  if (/cool|water|drink|break/.test(p)) return 'COOLING BREAK';
  // Stoppage / added time: period like "45'+2'" or "90'+3'".
  const stop = /(\d+)\s*'?\s*\+\s*(\d+)/.exec(period);
  if (stop) {
    const base = parseInt(stop[1], 10);
    const anchor = base >= 46 ? 90 : 45;
    return `${anchor}:00 (+${stop[2]})`;
  }
  // Normal live: tick MM:SS.
  let total;
  if (m.minute != null) {
    // Anchor to ESPN's reported minute, interpolate seconds since last poll.
    const secs = Math.floor((Date.now() - state.clockSyncedAt) / 1000);
    total = m.minute * 60 + Math.max(0, Math.min(secs, 120));
    const cap = m.minute < 45 ? 45 * 60 : m.minute < 90 ? 90 * 60 : (m.minute + 1) * 60;
    if (total > cap) total = cap;
  } else {
    // No minute from the feed (e.g. just kicked off): derive from kickoff time.
    const ko = Date.parse(m.kickoff);
    if (isNaN(ko)) return 'LIVE';
    total = Math.max(0, Math.floor((Date.now() - ko) / 1000));
    if (total > 45 * 60) total = 45 * 60; // don't overrun into 2nd half blindly
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
  // Only touch the DOM when the value changes (avoids needless mutations).
  if (elc.textContent !== txt) elc.textContent = txt;
  const cls = 'sb-clock' + (m && m.status === 'live' ? ' live' : '');
  if (elc.className !== cls) elc.className = cls;
}

function selectedMatch() {
  return state.matches.find((m) => m.id === state.selectedId) || null;
}

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
  // timeline is rendered incrementally via renderEventLog
}

async function poll() {
  try {
    const { matches, authority, demo } = await loadMatches();
    state.matches = matches;
    setDemoBanner(demo);
    renderAuthority(authority);
    renderHealth(health);

    const newSelected = renderMatchStrip(matches, state.selectedId);
    if (newSelected !== state.selectedId) {
      state.selectedId = newSelected;
      state.shownKeys.clear();
      clearEventLog();
    }

    const m = selectedMatch();
    // Best-effort richer detail (events / lineups / stats / table) for selection.
    if (m) {
      const detail = await loadDetail(m);
      state.detail = detail;
      // The summary commentary is the full timeline (goals, cards, subs, fouls,
      // corners, throw-ins, …) — use it as the base when available; otherwise
      // keep the scoreboard's (goals-only) events.
      if (detail && detail.events && detail.events.length) {
        m.events = detail.events;
      }
    } else {
      state.detail = null;
    }

    state.clockSyncedAt = Date.now();
    renderScoreboard(m);
    renderClock();
    renderTeamSummary(m, state.detail);
    renderEventLog(m, state.shownKeys);
    renderActiveTab();
    setLastPoll(new Date());
    refreshFlash();
  } catch (err) {
    // Never let the loop die.
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

  renderClock(); // tick the match clock between polls
}

function init() {
  document.getElementById('match-strip').addEventListener('click', (e) => {
    const box = e.target.closest('.match-box');
    if (!box) return;
    state.selectedId = box.dataset.id;
    state.shownKeys.clear();
    state.detail = null;
    state.clockSyncedAt = Date.now();
    clearEventLog();
    renderMatchStrip(state.matches, state.selectedId);
    renderScoreboard(selectedMatch());
    renderClock();
    renderTeamSummary(selectedMatch(), state.detail);
    renderEventLog(selectedMatch(), state.shownKeys);
    renderActiveTab();
    poll(); // fetch detail for the newly selected match right away
  });

  for (const btn of document.querySelectorAll('.tab')) {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  }

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
