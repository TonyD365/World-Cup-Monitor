// js/render.js — DOM rendering for the monitor. All UI text is English.
import { buildSelector } from '../shared/core.js';

const EVENT_ICON = {
  goal: '⚽', yellow: '🟨', red: '🟥', sub: '⇄', penalty: '🥅', corner: '🚩',
  foul: '⚠', offside: '🏴', throwin: '↪', freekick: '◎', var: '📺', save: '🧤',
  shot: '🎯', half: '⏱', info: '·',
};
// Phase markers get a prominent, centered divider style.
const PHASE_TYPES = new Set(['half']);

function el(id) {
  return document.getElementById(id);
}

function statusLabel(m) {
  if (m.status === 'live') return `LIVE ${m.minute ? m.minute + "'" : ''} ${m.period ? '· ' + m.period : ''}`.trim();
  if (m.status === 'ft') return 'FULL TIME';
  return 'SCHEDULED';
}

// Render matches as a horizontal, time-sorted timeline of clickable boxes.
// Returns the id that should be selected.
export function renderMatchStrip(matches, selectedId) {
  const strip = el('match-strip');
  const { list, defaultId } = buildSelector(matches);
  const sorted = list.slice().sort((a, b) => {
    const ta = Date.parse(a.kickoff) || 0;
    const tb = Date.parse(b.kickoff) || 0;
    return ta - tb;
  });
  const sel = selectedId && list.some((m) => m.id === selectedId) ? selectedId : defaultId;

  const fmtTime = (d) => {
    if (isNaN(d)) return '--:--';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  };
  const fmtDay = (iso) => {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };
  // Estimated end ≈ kickoff + 115 min (2×45 + 15 break + ~10 stoppage).
  const timeRange = (iso) => {
    const start = new Date(iso);
    if (isNaN(start)) return '--:--';
    const end = new Date(start.getTime() + 115 * 60000);
    return `${fmtTime(start)}–${fmtTime(end)}`;
  };

  strip.innerHTML = sorted
    .map((m) => {
      const h = esc(m.home.abbr || m.home.name);
      const a = esc(m.away.abbr || m.away.name);
      const hs = m.home.score != null ? m.home.score : '-';
      const as = m.away.score != null ? m.away.score : '-';
      let tag;
      let cls;
      if (m.status === 'live') { tag = m.minute ? `${m.minute}'` : 'LIVE'; cls = 'live'; }
      else if (m.status === 'ft') { tag = 'FT'; cls = 'ft'; }
      else { tag = 'SCHED'; cls = 'pre'; }
      return `<button class="match-box ${m.id === sel ? 'active' : ''}" data-id="${esc(m.id)}">
        <div class="mb-day">${fmtDay(m.kickoff)}</div>
        <div class="mb-time">${timeRange(m.kickoff)}</div>
        <div class="mb-row"><span class="mb-team">${h}</span><span class="mb-sc">${hs}</span></div>
        <div class="mb-row"><span class="mb-team">${a}</span><span class="mb-sc">${as}</span></div>
        <div class="mb-tag ${cls}">${tag}</div>
      </button>`;
    })
    .join('') || '<span class="empty">// NO MATCHES</span>';
  return sel || null;
}

// One stat row: label centered on its own line, values on the sides, bar below.
function statItem(label, homeVal, awayVal, homeNum, awayNum) {
  const tot = (homeNum || 0) + (awayNum || 0) || 1;
  const hw = (100 * (homeNum || 0)) / tot;
  const aw = (100 * (awayNum || 0)) / tot;
  return `<div class="stat-item">
    <div class="stat-top"><span class="stat-h">${homeVal}</span><span class="stat-name">${label}</span><span class="stat-a">${awayVal}</span></div>
    <div class="stat-bar"><div class="stat-fill-h" style="width:${hw}%"></div><div class="stat-fill-a" style="width:${aw}%"></div></div>
  </div>`;
}

function bar(label, pctHome, pctAway) {
  const h = Math.max(0, Math.min(100, pctHome || 0));
  const a = Math.max(0, Math.min(100, pctAway || 0));
  return statItem(label, `${h}%`, `${a}%`, h, a);
}


export function renderScoreboard(m) {
  const panel = el('scoreboard');
  if (!m) {
    panel.innerHTML = '<div class="empty">// NO MATCH SELECTED</div>';
    return;
  }
  const stats = m.stats || {};
  const hasStats = stats.possessionHome != null || stats.shotsHome != null;
  panel.innerHTML = `
    <div class="sb-status">${statusLabel(m)} <span class="sb-comp">${m.comp || ''}</span></div>
    <div class="sb-clock" id="sb-clock"></div>
    <div class="sb-main">
      <div class="sb-team home">
        <div class="sb-flag">${m.home.flag && m.home.flag.length <= 4 ? m.home.flag : ''}</div>
        <div class="sb-name">${m.home.name || m.home.abbr}</div>
      </div>
      <div class="sb-score">${m.home.score ?? '-'} <span class="sb-dash">:</span> ${m.away.score ?? '-'}</div>
      <div class="sb-team away">
        <div class="sb-flag">${m.away.flag && m.away.flag.length <= 4 ? m.away.flag : ''}</div>
        <div class="sb-name">${m.away.name || m.away.abbr}</div>
      </div>
    </div>
    <div class="sb-venue">${m.venue ? '@ ' + m.venue : ''}</div>
    ${hasStats ? `<div class="sb-stats">
        ${stats.possessionHome != null ? bar('POSSESSION', stats.possessionHome, stats.possessionAway) : ''}
        ${stats.shotsHome != null ? bar('SHOTS', stats.shotsHome, stats.shotsAway) : ''}
      </div>` : ''}
    ${renderConflicts(m)}
  `;
}

function renderConflicts(m) {
  if (!m.conflicts || !m.conflicts.length) return '';
  const items = m.conflicts
    .slice(0, 4)
    .map(
      (c) =>
        `⚠ SOURCE CONFLICT [${c.field}] — using <b>${c.chosenSource.toUpperCase()}</b>=${c.chosen} (vs ${c.others
          .map((o) => `${o.source}=${o.value}`)
          .join(', ')})`
    )
    .join('<br>');
  return `<div class="conflicts">${items}</div>`;
}

// Append new events to the streaming log (only those not already shown).
export function renderEventLog(m, shownKeys) {
  const log = el('event-log');
  if (!m) return;
  const evs = (m.events || []).slice().sort((a, b) => (a.min || 0) - (b.min || 0));
  let appended = false;
  for (const ev of evs) {
    const key = `${m.id}|${ev.min}|${ev.type}|${ev.player}|${(ev.detail || '').slice(0, 30)}`;
    if (shownKeys.has(key)) continue;
    shownKeys.add(key);
    appended = true;
    const line = document.createElement('div');
    const ts = ev.min != null ? `${ev.min}'` : '';
    const icon = EVENT_ICON[ev.type] || '·';

    if (PHASE_TYPES.has(ev.type)) {
      // Kick-off / half-time / stoppage / full-time: prominent + centered.
      line.className = 'log-line phase flash';
      line.innerHTML = `${icon} <span class="phase-text">${esc((ev.detail || '').toUpperCase())}</span> ${ts ? `<span class="phase-min">${ts}</span>` : ''} ${icon}`;
    } else {
      line.className = `log-line type-${ev.type} flash`;
      const team = ev.team ? `<span class="log-team">[${esc(ev.team)}]</span>` : '';
      const who = ev.player ? `<span class="log-player">${esc(ev.player)}</span>` : '';
      line.innerHTML = `<span class="log-ts">${ts ? '[' + ts + ']' : ''}</span> ${icon} <span class="log-type">${esc(ev.type.toUpperCase())}</span> ${team} ${who} <span class="log-detail">${esc(ev.detail || '')}</span>`;
    }
    log.appendChild(line);
  }
  if (appended) log.scrollTop = log.scrollHeight;
}

export function clearEventLog() {
  el('event-log').innerHTML = '';
}

// ---- tab views: Lineups / Stats / Table -----------------------------------
const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function renderLineups(detail) {
  const v = el('view-lineups');
  const lineups = (detail && detail.lineups) || [];
  if (!lineups.length) {
    v.innerHTML = '<div class="empty">// NO LINEUP DATA</div>';
    return;
  }
  const col = (lu) => `
    <div class="lineup-col">
      <div class="lineup-head">${esc(lu.team)} ${lu.formation ? '· ' + esc(lu.formation) : ''}</div>
      <div class="lineup-sub-label">STARTING XI</div>
      ${lu.starters.map((p) => `<div class="lineup-row"><span class="num">${esc(p.num)}</span> ${esc(p.name)} <span class="pos">${esc(p.pos)}</span></div>`).join('')}
      ${lu.subs.length ? `<div class="lineup-sub-label">SUBS</div>${lu.subs.map((p) => `<div class="lineup-row dim"><span class="num">${esc(p.num)}</span> ${esc(p.name)} <span class="pos">${esc(p.pos)}</span></div>`).join('')}` : ''}
    </div>`;
  v.innerHTML = `<div class="lineups">${lineups.map(col).join('')}</div>`;
}

export function renderStats(detail) {
  const v = el('view-stats');
  const stats = (detail && detail.stats) || [];
  if (!stats.length) {
    v.innerHTML = '<div class="empty">// NO STATS DATA</div>';
    return;
  }
  const num = (x) => {
    const n = parseFloat(String(x).replace('%', ''));
    return isNaN(n) ? 0 : n;
  };
  v.innerHTML = stats
    .map((s) => statItem(esc(s.label), esc(s.home), esc(s.away), num(s.home), num(s.away)))
    .join('');
}

export function renderTable(detail, m) {
  const v = el('view-table');
  const rows = (detail && detail.table) || [];
  if (!rows.length) {
    v.innerHTML = '<div class="empty">// NO TABLE DATA</div>';
    return;
  }
  const names = m ? [m.home.name, m.away.name] : [];
  v.innerHTML = `<table class="standings">
    <thead><tr><th class="l">TEAM</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>PTS</th></tr></thead>
    <tbody>${rows
      .map(
        (r) => `<tr class="${names.includes(r.team) ? 'hl' : ''}">
        <td class="l">${esc(r.abbr || r.team)}</td><td>${esc(r.p)}</td><td>${esc(r.w)}</td><td>${esc(r.d)}</td><td>${esc(r.l)}</td><td>${esc(r.gd)}</td><td>${esc(r.pts)}</td></tr>`
      )
      .join('')}</tbody></table>`;
}

export function renderHealth(health) {
  for (const src of ['fifa', 'espn', 'openfootball', 'mock']) {
    const led = el(`led-${src}`);
    if (led) led.className = `led ${health[src] === 'up' ? 'on' : 'off'}`;
  }
  const px = el('led-proxy');
  if (px) px.className = `led ${health.proxy === 'up' ? 'on' : 'off'}`;
}

export function renderAuthority(authority) {
  el('authority').textContent = (authority || 'mock').toUpperCase();
}

export function setLastPoll(date) {
  el('last-poll').textContent = date.toISOString().slice(11, 19);
}

export function setDemoBanner(on) {
  el('demo-banner').style.display = on ? 'block' : 'none';
}

export function refreshFlash() {
  const scr = el('screen');
  scr.classList.remove('refresh');
  void scr.offsetWidth; // reflow to restart animation
  scr.classList.add('refresh');
}
