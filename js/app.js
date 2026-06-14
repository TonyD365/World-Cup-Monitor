// js/app.js — controller: polling loop, selector wiring, state.
import { CONFIG } from './config.js';
import { loadMatches, loadDetail, health } from './data.js';
import {
  renderSelector,
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
} from './render.js';

const state = {
  matches: [],
  selectedId: null,
  shownKeys: new Set(), // event log de-dup keys
  detail: null, // last loaded { events, lineups, stats, table }
  activeTab: 'timeline',
  startedAt: Date.now(),
  nextPollAt: 0,
};

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

    const newSelected = renderSelector(matches, state.selectedId);
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

    renderScoreboard(m);
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
}

function init() {
  document.getElementById('match-select').addEventListener('change', (e) => {
    state.selectedId = e.target.value;
    state.shownKeys.clear();
    state.detail = null;
    clearEventLog();
    renderScoreboard(selectedMatch());
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
