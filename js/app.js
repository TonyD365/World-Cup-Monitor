// js/app.js — controller: polling loop, selector wiring, state.
import { CONFIG } from './config.js';
import { loadMatches, loadSummaryEvents, health } from './data.js';
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
} from './render.js';

const state = {
  matches: [],
  selectedId: null,
  shownKeys: new Set(), // event log de-dup keys
  startedAt: Date.now(),
  nextPollAt: 0,
};

function selectedMatch() {
  return state.matches.find((m) => m.id === state.selectedId) || null;
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
    // Best-effort richer events for the selected match.
    if (m) {
      const extra = await loadSummaryEvents(m);
      if (extra && extra.length) {
        const seen = new Set(m.events.map((e) => `${e.min}|${e.type}|${e.player}`));
        for (const e of extra) {
          const k = `${e.min}|${e.type}|${e.player}`;
          if (!seen.has(k)) m.events.push(e);
        }
      }
    }

    renderScoreboard(m);
    renderEventLog(m, state.shownKeys);
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
    clearEventLog();
    renderScoreboard(selectedMatch());
    renderEventLog(selectedMatch(), state.shownKeys);
  });

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
