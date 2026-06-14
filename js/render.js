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
      <div class="sb-score" translate="no"><span class="flip-num" id="score-h">${m.home.score ?? '-'}</span><span class="sb-dash">:</span><span class="flip-num" id="score-a">${m.away.score ?? '-'}</span></div>
      <div class="sb-team away">
        <div class="sb-flag" translate="no">${m.away.flag && m.away.flag.length <= 4 ? m.away.flag : ''}</div>
        <div class="sb-name">${esc(m.away.name || m.away.abbr)}</div>
      </div>
    </div>
    <div class="sb-venue">${m.venue ? '@ ' + esc(m.venue) : ''}</div>
    <div class="sb-summary" id="sb-summary" translate="no"></div>
    <div class="sb-extra" id="sb-extra"></div>
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

// Win-probability bar + match info (referee / attendance / weather), below score.
export function renderMatchExtra(m, detail) {
  const box = el('sb-extra');
  if (!box) return;
  if (!m || !detail) { if (box.innerHTML) box.innerHTML = ''; return; }
  let html = '';
  const p = detail.predictor;
  if (p && (p.home || p.away)) {
    html += `<div class="wp">
      <div class="wp-head">WIN PROBABILITY</div>
      <div class="wp-bar"><div class="wp-h" style="width:${p.home}%"></div><div class="wp-d" style="width:${p.draw}%"></div><div class="wp-a" style="width:${p.away}%"></div></div>
      <div class="wp-legend" translate="no"><span class="wp-lh">${esc(m.home.abbr || m.home.name)} ${p.home}%</span><span class="wp-ld">Draw ${p.draw}%</span><span class="wp-la">${esc(m.away.abbr || m.away.name)} ${p.away}%</span></div>
    </div>`;
  }
  const i = detail.info;
  if (i && (i.referee || i.attendance || i.weather || i.city)) {
    const bits = [];
    if (i.referee) bits.push(`REF: <span translate="no">${esc(i.referee)}</span>`);
    if (i.attendance) bits.push(`ATT: <span translate="no">${esc(Number(i.attendance).toLocaleString())}</span>`);
    if (i.weather) bits.push(`WX: <span translate="no">${esc(i.weather)}</span>`);
    if (i.city) bits.push(`<span translate="no">${esc(i.city)}</span>`);
    html += `<div class="minfo">${bits.join(' · ')}</div>`;
  }
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

// Diacritic-insensitive, lowercased name key (so "Türkiye"/"Curaçao" players
// in events match their roster entries).
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

// Build a name -> {goals, assists, yellow, red, sub} map from the timeline.
function buildPlayerMarks(events) {
  const map = new Map();
  const get = (name) => {
    const key = norm(name);
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
  const key = norm(name);
  if (map.has(key)) return map.get(key);
  const last = key.split(/\s+/).pop();
  for (const [k, v] of map) if (k.split(/\s+/).pop() === last) return v;
  return null;
}
function markIcons(mk) {
  if (!mk) return '';
  let s = '';
  if (mk.g) s += '⚽'.repeat(Math.min(mk.g, 4));
  if (mk.a) s += `🅰${mk.a > 1 ? mk.a : ''}`;
  if (mk.y) s += '🟨';
  if (mk.r) s += '🟥';
  if (mk.s) s += '⇄';
  return s;
}

// "Joshua Kimmich" -> "J. Kimmich"
function shortName(name) {
  const parts = (name || '').trim().split(/\s+/);
  if (parts.length < 2) return name || '';
  return `${parts[0][0]}. ${parts[parts.length - 1]}`;
}

// Rows of a formation: GK + the formation lines, e.g. "4-2-3-1" -> [1,4,2,3,1].
function formationRows(f) {
  const nums = (f || '').split(/[^0-9]+/).filter(Boolean).map(Number).filter((n) => n > 0);
  return nums.length ? [1, ...nums] : [1, 4, 3, 3]; // default if unknown
}

// Place a team's starters as absolutely-positioned tokens on the pitch.
// home: GK at top, lines descending toward the centre; away: mirrored.
function teamTokens(lineup, side, marks) {
  const starters = (lineup && lineup.starters) || [];
  if (!starters.length) return '';
  const rows = formationRows(lineup.formation);
  const R = rows.length;
  const out = [];
  let idx = 0;
  for (let r = 0; r < R; r++) {
    const t = R > 1 ? r / (R - 1) : 0;
    const y = side === 'home' ? 5 + t * 41 : 95 - t * 41; // 5..46 / 95..54
    const count = rows[r];
    for (let k = 0; k < count && idx < starters.length; k++, idx++) {
      const p = starters[idx];
      const x = ((k + 1) / (count + 1)) * 100;
      const ic = markIcons(marksFor(marks, p.name));
      const photo = p.photo
        ? `<img class="pt-photo" src="${esc(p.photo)}" alt="" loading="lazy" onerror="this.remove()">`
        : '';
      out.push(`<div class="ptok ${side}" style="left:${x}%;top:${y}%">
        <span class="pt-dot" translate="no"><span class="pt-num">${esc(p.num)}</span>${photo}${ic ? `<span class="pt-badge">${ic}</span>` : ''}</span>
        <span class="pt-name" translate="no">${esc(p.num)} ${esc(shortName(p.name))}</span>
      </div>`);
    }
  }
  return out.join('');
}

function renderPitch(home, away, marks) {
  const ht = teamTokens(home, 'home', marks);
  const at = teamTokens(away, 'away', marks);
  if (!ht && !at) return '';
  const label = (lu, cls) =>
    lu ? `<div class="pitch-label ${cls}" translate="no">${esc(lu.team)}${lu.formation ? ' · ' + esc(lu.formation) : ''}</div>` : '';
  return `<div class="pitch">
    <div class="pbox top"></div><div class="pbox bot"></div>
    <div class="pitch-mid"></div><div class="pitch-circle"></div>
    ${label(home, 'top')}${label(away, 'bot')}
    ${ht}${at}
  </div>`;
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
  const home = lineups.find((l) => l.side === 'home') || lineups[0];
  const away = lineups.find((l) => l.side === 'away') || lineups[1];

  const playerRow = (p, dim) => {
    const ic = markIcons(marksFor(marks, p.name));
    const photo = p.photo
      ? `<img class="lineup-photo" src="${esc(p.photo)}" alt="" loading="lazy" onerror="this.remove()">`
      : '';
    return `<div class="lineup-row${dim ? ' dim' : ''}">${photo}<span class="num" translate="no">${esc(p.num)}</span> <span class="pname" translate="no">${esc(p.name)}</span> <span class="pos">${esc(p.pos)}</span>${ic ? ` <span class="lineup-marks" translate="no">${ic}</span>` : ''}</div>`;
  };
  const col = (lu) => `
    <div class="lineup-col">
      <div class="lineup-head"><span translate="no">${esc(lu.team)}</span> ${lu.formation ? '· ' + esc(lu.formation) : ''}</div>
      <div class="lineup-sub-label">STARTING XI</div>
      ${lu.starters.map((p) => playerRow(p, false)).join('')}
      ${lu.subs.length ? `<div class="lineup-sub-label">SUBS</div>${lu.subs.map((p) => playerRow(p, true)).join('')}` : ''}
    </div>`;

  const html = renderPitch(home, away, marks) + `<div class="lineups">${lineups.map(col).join('')}</div>`;
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
  const groups = (detail && detail.table) || [];
  if (!groups.length) {
    v.innerHTML = '<div class="empty">// NO TABLE DATA</div>';
    sig.table = '';
    return;
  }
  const names = m ? [m.home.name, m.away.name] : [];
  const td = (x) => `<td translate="no">${esc(x)}</td>`;
  const group = (g) => `
    <div class="sg">
      <div class="sg-title">${esc((g.name || 'GROUP').toUpperCase())}</div>
      <table class="standings">
        <thead><tr><th class="r">#</th><th class="l">TEAM</th><th>MP</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>PTS</th></tr></thead>
        <tbody>${g.rows
          .map(
            (r) => `<tr class="${names.includes(r.team) ? 'hl' : ''}">
            <td class="r" translate="no">${esc(r.rank)}</td>
            <td class="l" translate="no">${esc(r.abbr || r.team)}</td>
            ${td(r.mp)}${td(r.w)}${td(r.d)}${td(r.l)}${td(r.gf)}${td(r.ga)}${td(r.gd)}<td class="pts" translate="no">${esc(r.pts)}</td></tr>`
          )
          .join('')}</tbody>
      </table>
    </div>`;
  const html = groups.map(group).join('');
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
