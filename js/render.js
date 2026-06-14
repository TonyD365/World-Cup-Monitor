// js/render.js — DOM rendering for the monitor. All UI text is English.
import { buildSelector } from '../shared/core.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const EVENT_ICON = {
  goal: '⚽', yellow: '🟨', red: '🟥', sub: '⇄', penalty: '🥅', corner: '🚩',
  foul: '⚠', offside: '🏴', throwin: '↪', freekick: '◎', var: '📺', save: '🧤',
  shot: '🎯', half: '⏱', info: '·',
};
const PHASE_TYPES = new Set(['half']);

// Cache of last-rendered signatures so we only touch the DOM when content
// actually changes. This avoids the Google-Translate flicker that happened when
// we rewrote identical markup every poll (Translate re-translates on mutation).
const sig = {};

function el(id) {
  return document.getElementById(id);
}

function statusLabel(m) {
  if (m.status === 'live') return 'LIVE';
  if (m.status === 'ft') return 'FULL TIME';
  return 'SCHEDULED';
}

// Render matches as a horizontal, time-sorted timeline of clickable boxes.
export function renderMatchStrip(matches, selectedId) {
  const strip = el('match-strip');
  const { list, defaultId } = buildSelector(matches);
  const sorted = list.slice().sort((a, b) => (Date.parse(a.kickoff) || 0) - (Date.parse(b.kickoff) || 0));
  const sel = selectedId && list.some((m) => m.id === selectedId) ? selectedId : defaultId;

  const fmtTime = (d) => (isNaN(d) ? '--:--' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
  const fmtDay = (iso) => {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };
  const timeRange = (iso) => {
    const start = new Date(iso);
    if (isNaN(start)) return '--:--';
    const end = new Date(start.getTime() + 115 * 60000); // ≈ 2×45 + break + stoppage
    return `${fmtTime(start)}–${fmtTime(end)}`;
  };

  // Status tags carry no live minute, so a live box doesn't rewrite every poll.
  const html =
    sorted
      .map((m) => {
        const h = esc(m.home.abbr || m.home.name);
        const a = esc(m.away.abbr || m.away.name);
        const hs = m.home.score != null ? m.home.score : '-';
        const as = m.away.score != null ? m.away.score : '-';
        const cls = m.status === 'live' ? 'live' : m.status === 'ft' ? 'ft' : 'pre';
        const tag = cls === 'live' ? 'LIVE' : cls === 'ft' ? 'FT' : 'SCHED';
        return `<button class="match-box ${m.id === sel ? 'active' : ''}" data-id="${esc(m.id)}">
          <div class="mb-day">${fmtDay(m.kickoff)}</div>
          <div class="mb-time">${timeRange(m.kickoff)}</div>
          <div class="mb-row"><span class="mb-team">${h}</span><span class="mb-sc">${hs}</span></div>
          <div class="mb-row"><span class="mb-team">${a}</span><span class="mb-sc">${as}</span></div>
          <div class="mb-tag ${cls}">${tag}</div>
        </button>`;
      })
      .join('') || '<span class="empty">// NO MATCHES</span>';

  const s = sel + '|' + html;
  if (sig.strip !== s) {
    strip.innerHTML = html;
    sig.strip = s;
  }
  return sel || null;
}

// One stat row: label centered, values on the sides, bar below.
function statItem(label, homeVal, awayVal, homeNum, awayNum) {
  const tot = (homeNum || 0) + (awayNum || 0) || 1;
  const hw = (100 * (homeNum || 0)) / tot;
  const aw = (100 * (awayNum || 0)) / tot;
  return `<div class="stat-item">
    <div class="stat-top"><span class="stat-h" translate="no">${homeVal}</span><span class="stat-name">${label}</span><span class="stat-a" translate="no">${awayVal}</span></div>
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
    sig.scoreboard = '';
    return;
  }
  const stats = m.stats || {};
  const hasStats = stats.possessionHome != null || stats.shotsHome != null;
  const html = `
    <div class="sb-status">${statusLabel(m)} <span class="sb-comp">${esc(m.comp || '')}</span></div>
    <div class="sb-clock" id="sb-clock" translate="no"></div>
    <div class="sb-main">
      <div class="sb-team home">
        <div class="sb-flag" translate="no">${m.home.flag && m.home.flag.length <= 4 ? m.home.flag : ''}</div>
        <div class="sb-name">${esc(m.home.name || m.home.abbr)}</div>
      </div>
      <div class="sb-score" translate="no">${m.home.score ?? '-'} <span class="sb-dash">:</span> ${m.away.score ?? '-'}</div>
      <div class="sb-team away">
        <div class="sb-flag" translate="no">${m.away.flag && m.away.flag.length <= 4 ? m.away.flag : ''}</div>
        <div class="sb-name">${esc(m.away.name || m.away.abbr)}</div>
      </div>
    </div>
    <div class="sb-venue">${m.venue ? '@ ' + esc(m.venue) : ''}</div>
    <div class="sb-summary" id="sb-summary" translate="no"></div>
    ${hasStats ? `<div class="sb-stats">
        ${stats.possessionHome != null ? bar('POSSESSION', stats.possessionHome, stats.possessionAway) : ''}
        ${stats.shotsHome != null ? bar('SHOTS', stats.shotsHome, stats.shotsAway) : ''}
      </div>` : ''}
  `;
  if (sig.scoreboard !== html) {
    panel.innerHTML = html;
    sig.scoreboard = html;
  }
}

// Per-team summary below the score: yellows, reds, shots, on target, subs left.
// Cards / subs are counted from the timeline; shots come from match stats.
export function renderTeamSummary(m, detail) {
  const box = el('sb-summary');
  if (!box) return;
  if (!m) { box.innerHTML = ''; return; }
  const evs = (detail && detail.events) || m.events || [];
  const ha = m.home.abbr || m.home.name;
  const aa = m.away.abbr || m.away.name;
  const count = (abbr, type) => evs.filter((e) => e.team === abbr && e.type === type).length;
  const statsArr = (detail && detail.stats) || [];
  const findStat = (re) => statsArr.find((s) => re.test((s.label || '').toLowerCase()));
  const onTarget = findStat(/on (target|goal)/);
  const totalShots = findStat(/total shots/) || findStat(/^shots$/) || findStat(/shots/);
  const SUB_LIMIT = 5;
  const subsLeft = (abbr) => Math.max(0, SUB_LIMIT - count(abbr, 'sub'));

  const row = (label, h, a) =>
    `<div class="ts-row"><span class="ts-h">${esc(h)}</span><span class="ts-label">${label}</span><span class="ts-a">${esc(a)}</span></div>`;

  const html =
    `<div class="ts-grid">` +
    row('🟨 Yellow', count(ha, 'yellow'), count(aa, 'yellow')) +
    row('🟥 Red', count(ha, 'red'), count(aa, 'red')) +
    (totalShots ? row('Shots', totalShots.home, totalShots.away) : '') +
    (onTarget ? row('On Target', onTarget.home, onTarget.away) : '') +
    row('Subs Left', subsLeft(ha), subsLeft(aa)) +
    `</div>`;
  // #sb-summary is translate="no", so rewriting it never causes Translate flicker.
  if (box.innerHTML !== html) box.innerHTML = html;
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
      line.className = 'log-line phase flash';
      line.innerHTML = `${icon} <span class="phase-text">${esc((ev.detail || '').toUpperCase())}</span> ${ts ? `<span class="phase-min" translate="no">${ts}</span>` : ''} ${icon}`;
    } else {
      line.className = `log-line type-${ev.type} flash`;
      const team = ev.team ? `<span class="log-team" translate="no">[${esc(ev.team)}]</span>` : '';
      const who = ev.player ? `<span class="log-player" translate="no">${esc(ev.player)}</span>` : '';
      const assist = ev.assist ? ` <span class="log-assist" translate="no">🅰 ${esc(ev.assist)}</span>` : '';
      line.innerHTML = `<span class="log-ts" translate="no">${ts ? '[' + ts + ']' : ''}</span> ${icon} <span class="log-type">${esc(ev.type.toUpperCase())}</span> ${team} ${who}${assist} <span class="log-detail">${esc(ev.detail || '')}</span>`;
    }
    log.appendChild(line);
  }
  if (appended) log.scrollTop = log.scrollHeight;
}

export function clearEventLog() {
  el('event-log').innerHTML = '';
}

// ---- tab views: Lineups / Stats / Table -----------------------------------

// Build a name -> {goals, assists, yellow, red, sub} map from the timeline so
// we can annotate each player in the lineup.
function buildPlayerMarks(events) {
  const map = new Map();
  const get = (name) => {
    const key = (name || '').trim().toLowerCase();
    if (!key) return null;
    if (!map.has(key)) map.set(key, { g: 0, a: 0, y: 0, r: 0, s: false });
    return map.get(key);
  };
  for (const e of events || []) {
    if (e.type === 'goal') {
      const g = get(e.player); if (g) g.g += 1;
      const a = get(e.assist); if (a) a.a += 1;
    } else if (e.type === 'yellow') { const x = get(e.player); if (x) x.y += 1; }
    else if (e.type === 'red') { const x = get(e.player); if (x) x.r += 1; }
    else if (e.type === 'sub') { const x = get(e.player); if (x) x.s = true; const y = get(e.assist); if (y) y.s = true; }
  }
  return map;
}
function marksFor(map, name) {
  const key = (name || '').trim().toLowerCase();
  if (map.has(key)) return map.get(key);
  const last = key.split(/\s+/).pop();
  for (const [k, v] of map) if (k.split(/\s+/).pop() === last) return v;
  return null;
}
function markIcons(mk) {
  if (!mk) return '';
  let s = '';
  if (mk.g) s += ' ' + '⚽'.repeat(Math.min(mk.g, 4));
  if (mk.a) s += ` 🅰${mk.a > 1 ? mk.a : ''}`;
  if (mk.y) s += ' 🟨';
  if (mk.r) s += ' 🟥';
  if (mk.s) s += ' ⇄';
  return s ? `<span class="lineup-marks" translate="no">${s}</span>` : '';
}

export function renderLineups(detail) {
  const v = el('view-lineups');
  const lineups = (detail && detail.lineups) || [];
  if (!lineups.length) {
    v.innerHTML = '<div class="empty">// NO LINEUP DATA</div>';
    sig.lineups = '';
    return;
  }
  const marks = buildPlayerMarks(detail && detail.events);
  const playerRow = (p, dim) =>
    `<div class="lineup-row${dim ? ' dim' : ''}"><span class="num" translate="no">${esc(p.num)}</span> <span class="pname" translate="no">${esc(p.name)}</span> <span class="pos">${esc(p.pos)}</span>${markIcons(marksFor(marks, p.name))}</div>`;
  const col = (lu) => `
    <div class="lineup-col">
      <div class="lineup-head"><span translate="no">${esc(lu.team)}</span> ${lu.formation ? '· ' + esc(lu.formation) : ''}</div>
      <div class="lineup-sub-label">STARTING XI</div>
      ${lu.starters.map((p) => playerRow(p, false)).join('')}
      ${lu.subs.length ? `<div class="lineup-sub-label">SUBS</div>${lu.subs.map((p) => playerRow(p, true)).join('')}` : ''}
    </div>`;
  const html = `<div class="lineups">${lineups.map(col).join('')}</div>`;
  if (sig.lineups !== html) {
    v.innerHTML = html;
    sig.lineups = html;
  }
}

export function renderStats(detail) {
  const v = el('view-stats');
  const stats = (detail && detail.stats) || [];
  if (!stats.length) {
    v.innerHTML = '<div class="empty">// NO STATS DATA</div>';
    sig.stats = '';
    return;
  }
  const num = (x) => {
    const n = parseFloat(String(x).replace('%', ''));
    return isNaN(n) ? 0 : n;
  };
  const html = stats.map((s) => statItem(esc(s.label), esc(s.home), esc(s.away), num(s.home), num(s.away))).join('');
  if (sig.stats !== html) {
    v.innerHTML = html;
    sig.stats = html;
  }
}

export function renderTable(detail, m) {
  const v = el('view-table');
  const rows = (detail && detail.table) || [];
  if (!rows.length) {
    v.innerHTML = '<div class="empty">// NO TABLE DATA</div>';
    sig.table = '';
    return;
  }
  const names = m ? [m.home.name, m.away.name] : [];
  const html = `<table class="standings">
    <thead><tr><th class="l">TEAM</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>PTS</th></tr></thead>
    <tbody>${rows
      .map(
        (r) => `<tr class="${names.includes(r.team) ? 'hl' : ''}">
        <td class="l" translate="no">${esc(r.abbr || r.team)}</td><td translate="no">${esc(r.p)}</td><td translate="no">${esc(r.w)}</td><td translate="no">${esc(r.d)}</td><td translate="no">${esc(r.l)}</td><td translate="no">${esc(r.gd)}</td><td translate="no">${esc(r.pts)}</td></tr>`
      )
      .join('')}</tbody></table>`;
  if (sig.table !== html) {
    v.innerHTML = html;
    sig.table = html;
  }
}

export function renderHealth(health) {
  for (const src of ['fifa', 'espn', 'openfootball', 'mock']) {
    const led = el(`led-${src}`);
    if (led) led.className = `led ${health[src] === 'up' ? 'on' : 'off'}`;
  }
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
