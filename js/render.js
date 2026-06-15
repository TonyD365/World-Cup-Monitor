// js/render.js — DOM rendering for the monitor. All UI text is English.
import { buildSelector } from '../shared/core.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const EVENT_ICON = {
  goal: '⚽', yellow: '🟨', red: '🟥', sub: '⇄', penalty: '🥅', corner: '🚩',
  foul: '⚠', offside: '🏴', throwin: '↪', freekick: '◎', var: '📺', save: '🧤',
  shot: '🎯', half: '⏱', break: '💧', addedtime: '➕', info: '·',
};
const PHASE_TYPES = new Set(['half', 'break', 'addedtime']);

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

const favKey = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
function isFav(favs, m) {
  if (!favs || !favs.size) return false;
  return favs.has(favKey(m.home.name)) || favs.has(favKey(m.away.name)) ||
    favs.has(favKey(m.home.abbr)) || favs.has(favKey(m.away.abbr));
}

// Render matches as a horizontal, time-sorted timeline of clickable boxes.
export function renderMatchStrip(matches, selectedId, favs) {
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
        const played = m.status === 'live' || m.status === 'ft'; // scheduled = 0-0 from ESPN
        const hs = played && m.home.score != null ? m.home.score : '-';
        const as = played && m.away.score != null ? m.away.score : '-';
        const cls = m.status === 'live' ? 'live' : m.status === 'ft' ? 'ft' : 'pre';
        const tag = cls === 'live' ? 'LIVE' : cls === 'ft' ? 'FT' : 'SCHED';
        const star = isFav(favs, m) ? '<span class="mb-fav">⭐</span>' : '';
        return `<button class="match-box ${m.id === sel ? 'active' : ''} ${isFav(favs, m) ? 'fav' : ''}" data-id="${esc(m.id)}">
          ${star}<div class="mb-day">${fmtDay(m.kickoff)}</div>
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

export function renderScoreboard(m, favs) {
  const panel = el('scoreboard');
  if (!m) {
    panel.innerHTML = '<div class="empty">// NO MATCH SELECTED</div>';
    sig.scoreboard = '';
    return;
  }
  const favStar = (team) => {
    const on = favs && favs.has(favKey(team));
    return `<button class="fav-star ${on ? 'on' : ''}" data-team="${esc(team)}" title="Favorite" type="button">${on ? '★' : '☆'}</button>`;
  };
  const stats = m.stats || {};
  const hasStats = stats.possessionHome != null || stats.shotsHome != null;
  const html = `
    <div class="sb-status">${statusLabel(m)} <span class="sb-comp">${esc(m.comp || '')}</span></div>
    <div class="sb-clock" id="sb-clock" translate="no"></div>
    <div class="sb-main">
      <div class="sb-team home">
        <div class="sb-flag" translate="no">${m.home.flag && m.home.flag.length <= 4 ? m.home.flag : ''}</div>
        <div class="sb-name">${esc(m.home.name || m.home.abbr)} ${favStar(m.home.name || m.home.abbr)}</div>
      </div>
      <div class="sb-score" translate="no"><span class="flip-num" id="score-h">${(m.status === 'live' || m.status === 'ft') ? (m.home.score ?? '-') : '-'}</span><span class="sb-dash">:</span><span class="flip-num" id="score-a">${(m.status === 'live' || m.status === 'ft') ? (m.away.score ?? '-') : '-'}</span></div>
      <div class="sb-team away">
        <div class="sb-flag" translate="no">${m.away.flag && m.away.flag.length <= 4 ? m.away.flag : ''}</div>
        <div class="sb-name">${esc(m.away.name || m.away.abbr)} ${favStar(m.away.name || m.away.abbr)}</div>
      </div>
    </div>
    <div class="sb-venue">${m.venue ? '@ ' + esc(m.venue) : ''}</div>
    <div class="sb-summary" id="sb-summary" translate="no"></div>
    <div class="sb-extra" id="sb-extra" translate="no"></div>
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
// Rough win-probability estimate from the live scoreline + time remaining, used
// when ESPN provides no predictor. No team ratings, so it's scoreline-driven.
function estWinProb(m) {
  const h = m.home.score || 0;
  const a = m.away.score || 0;
  const d = h - a;
  const min = Math.min(m.minute || 0, 90);
  const rem = Math.max(0, 90 - min);
  const w = d * (0.6 + 0.9 * (min / 90)); // a lead is "safer" later in the match
  const eh = Math.exp(w);
  const ea = Math.exp(-w);
  const ed = Math.exp(-Math.abs(w) * 0.7) * (0.6 + 0.8 * (rem / 90)) * (d === 0 ? 1.4 : 0.9);
  const tot = eh + ea + ed;
  const home = Math.round((eh / tot) * 100);
  const away = Math.round((ea / tot) * 100);
  return { home, away, draw: Math.max(0, 100 - home - away) };
}

export function renderMatchExtra(m, detail) {
  const box = el('sb-extra');
  if (!box) return;
  if (!m || !detail) { if (box.innerHTML) box.innerHTML = ''; return; }
  let html = '';
  let p = detail.predictor;
  let est = false;
  // ESPN often has no predictor for a match — estimate one for live games so the
  // bar still shows.
  if (!(p && (p.home || p.away)) && m.status === 'live') { p = estWinProb(m); est = true; }
  if (p && (p.home || p.away)) {
    html += `<div class="wp">
      <div class="wp-head">WIN PROBABILITY${est ? ' (EST)' : ''}</div>
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
export function renderEventLog(m, shownKeys, detail) {
  const log = el('event-log');
  if (!m) return;
  // Map player name -> jersey number (from lineups) to prefix names with #.
  const numByName = new Map();
  for (const lu of (detail && detail.lineups) || []) {
    for (const p of [...(lu.starters || []), ...(lu.subs || [])]) {
      if (p.name && p.num !== '' && p.num != null) numByName.set(norm(p.name), p.num);
    }
  }
  const withNum = (name) => {
    if (!name) return '';
    const n = numByName.get(norm(name));
    return n != null && n !== '' ? `${n} ${name}` : name;
  };
  // Already in chronological order from the source adapter — render as-is.
  const evs = m.events || [];
  let appended = false;
  for (const ev of evs) {
    // De-dupe goals to one line per minute+team (a goal can arrive from both
    // keyEvents (with scorer) and commentary (without) — keep the richer one).
    const key = ev.type === 'goal'
      ? `${m.id}|goal|${ev.min}|${ev.team}`
      : `${m.id}|${ev.min}|${ev.type}|${ev.player}|${(ev.detail || '').slice(0, 30)}`;
    if (shownKeys.has(key)) continue;
    shownKeys.add(key);
    appended = true;
    const line = document.createElement('div');
    const ts = ev.min != null ? `${ev.min}'` : '';
    const icon = EVENT_ICON[ev.type] || '·';

    if (PHASE_TYPES.has(ev.type)) {
      line.className = 'log-line phase flash';
      line.innerHTML = `${icon} <span class="phase-text">${esc((ev.detail || '').toUpperCase())}</span> ${ts ? `<span class="phase-min" translate="no">${ts}</span>` : ''} ${icon}`;
    } else if (ev.type === 'goal') {
      // ⚽ leads; assist (🅰) comes after the scorer, in parentheses.
      const team = ev.team ? `<span class="log-team" translate="no">[${esc(ev.team)}]</span>` : '';
      const who = ev.player ? ` <span class="goal-player" translate="no">${esc(withNum(ev.player))}</span>` : '';
      const assist = ev.assist ? ` <span class="goal-assist" translate="no">(🅰 ${esc(withNum(ev.assist))})</span>` : '';
      line.className = 'log-line goal-line flash';
      line.innerHTML = `<span class="goal-ball">⚽</span> <span class="goal-text">GOAL</span> ${ts ? `<span class="phase-min" translate="no">${ts}</span>` : ''} ${team}${who}${assist}`;
    } else {
      line.className = `log-line type-${ev.type} flash`;
      const team = ev.team ? `<span class="log-team" translate="no">[${esc(ev.team)}]</span>` : '';
      const who = ev.player ? `<span class="log-player" translate="no">${esc(withNum(ev.player))}</span>` : '';
      const assist = ev.assist ? ` <span class="log-assist" translate="no">🅰 ${esc(withNum(ev.assist))}</span>` : '';
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

// Initials-avatar fallback (no key, themed) when a real headshot is missing.
function avatarUrl(name) {
  const n = encodeURIComponent((name || '?').trim());
  return `https://ui-avatars.com/api/?name=${n}&background=02180c&color=2fb56a&bold=true&length=2&size=96`;
}
// <img> that tries the ESPN headshot, then falls back to the initials avatar.
// data-pname lets app.js lazily upgrade avatar-only players to a real photo.
function playerImg(p, cls) {
  const av = avatarUrl(p.name);
  const src = p.photo || av;
  return `<img class="${cls}" src="${esc(src)}" data-fb="${esc(av)}" data-pname="${esc(p.name)}" alt="" loading="lazy" onerror="this.onerror=null;this.src=this.dataset.fb">`;
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
      out.push(`<div class="ptok ${side}" style="left:${x}%;top:${y}%">
        <span class="pt-dot" translate="no"><span class="pt-num">${esc(p.num)}</span>${playerImg(p, 'pt-photo')}${ic ? `<span class="pt-badge">${ic}</span>` : ''}</span>
        <span class="pt-name" translate="no">${esc(p.num)} ${esc(shortName(p.name))}</span>
      </div>`);
    }
  }
  return out.join('');
}

function renderFormationPitch(home, away, marks) {
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
    return `<div class="lineup-row${dim ? ' dim' : ''}">${playerImg(p, 'lineup-photo')}<span class="num" translate="no">${esc(p.num)}</span> <span class="pname" translate="no">${esc(p.name)}</span> <span class="pos">${esc(p.pos)}</span>${ic ? ` <span class="lineup-marks" translate="no">${ic}</span>` : ''}</div>`;
  };
  const col = (lu) => `
    <div class="lineup-col">
      <div class="lineup-head"><span translate="no">${esc(lu.team)}</span> ${lu.formation ? '· ' + esc(lu.formation) : ''}</div>
      <div class="lineup-sub-label">STARTING XI</div>
      ${lu.starters.map((p) => playerRow(p, false)).join('')}
      ${lu.subs.length ? `<div class="lineup-sub-label">SUBS</div>${lu.subs.map((p) => playerRow(p, true)).join('')}` : ''}
    </div>`;

  const html = renderFormationPitch(home, away, marks) + `<div class="lineups">${lineups.map(col).join('')}</div>`;
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

// Live ball position + shot map on a horizontal pitch (ESPN plays data).
const SHOT_STYLE = {
  goal: { cls: 'shot-goal', label: 'Goal' },
  save: { cls: 'shot-save', label: 'Save' },
  miss: { cls: 'shot-miss', label: 'Off Target' },
  block: { cls: 'shot-block', label: 'Block' },
};
function pitchSvgMarkings() {
  return `
    <rect x="1" y="1" width="98" height="62" class="pf-line" fill="none"/>
    <line x1="50" y1="1" x2="50" y2="63" class="pf-line"/>
    <circle cx="50" cy="32" r="8" class="pf-line" fill="none"/>
    <circle cx="50" cy="32" r="0.6" class="pf-dot"/>
    <rect x="1" y="18" width="15" height="28" class="pf-line" fill="none"/>
    <rect x="84" y="18" width="15" height="28" class="pf-line" fill="none"/>
    <rect x="1" y="26" width="5" height="12" class="pf-line" fill="none"/>
    <rect x="94" y="26" width="5" height="12" class="pf-line" fill="none"/>`;
}
const PF_SCALE = (n) => (n == null ? null : Math.max(0, Math.min(1, n > 1.5 ? n / 100 : n)));
const PF_X = (n) => (PF_SCALE(n) * 98 + 1).toFixed(1);
const PF_Y = (n) => (PF_SCALE(n) * 62 + 1).toFixed(1);

// Live ball position + last play, in its own panel (live only).
export function renderBallField(detail, m) {
  const v = el('ball-field');
  const panel = el('ball-panel');
  if (!v) return;
  // Prefer the live `situation` last play (always latest); fall back to plays.
  const lp = (detail && detail.ball) || (detail && detail.plays && detail.plays.lastPlay);
  const live = m && m.status === 'live';
  if (!live || !lp || lp.x == null || lp.y == null) {
    if (v.innerHTML) v.innerHTML = '';
    if (panel) panel.hidden = true;
    return;
  }
  if (panel) panel.hidden = false;
  const trail = lp.x2 != null && lp.y2 != null
    ? `<line x1="${PF_X(lp.x2)}" y1="${PF_Y(lp.y2)}" x2="${PF_X(lp.x)}" y2="${PF_Y(lp.y)}" class="pf-trail"/><circle cx="${PF_X(lp.x2)}" cy="${PF_Y(lp.y2)}" r="1.4" class="pf-trail-dot"/>`
    : '';
  const html = `
    <div class="pf-title">LIVE BALL</div>
    <svg class="pitch-svg" viewBox="0 0 100 64" preserveAspectRatio="xMidYMid meet">
      <rect x="0" y="0" width="100" height="64" class="pf-grass"/>
      ${pitchSvgMarkings()}
      ${trail}
      <circle cx="${PF_X(lp.x)}" cy="${PF_Y(lp.y)}" r="2.2" class="pf-ball"/>
    </svg>
    <div class="pf-last"><span class="pf-last-h">LAST PLAY</span> ${lp.min ? `<span translate="no">${lp.min}'</span>` : ''} ${esc(lp.text || lp.type || '')}</div>`;
  if (v.innerHTML !== html) v.innerHTML = html;
}

// Approx shot distance to goal in yards (pitch ≈ 115 × 74 yd).
function shotDistanceYd(s) {
  const gx = s.x > 0.5 ? 1 : 0;
  return Math.round(Math.hypot((gx - s.x) * 115, (0.5 - s.y) * 74));
}

// Best-effort player name from the play text, e.g. "N. Pépé (Ivory Coast) ...".
function shotPlayer(text) {
  if (!text) return '';
  const paren = /([A-Za-zÀ-ÿ][\wÀ-ÿ.'’-]*(?:\s+[A-Za-zÀ-ÿ][\wÀ-ÿ.'’-]*){0,3})\s*\(/.exec(text);
  if (paren) return paren[1].trim();
  return text.split(/[.,]/)[0].trim().slice(0, 28);
}

// 2D goal-front view. Horizontal placement is approximated from the shot's
// lateral pitch position; vertical (high/low) isn't in the free feed, so it's
// inferred from the result. Off-target shots are drawn outside the frame.
function goalFrontSvg(s) {
  const result = s.result;
  const lat = (s.y != null ? s.y : 0.5) - 0.5; // -0.5..0.5 across the pitch width
  let gx = 30 + lat * 46; // map to goal mouth (12..48), can spill outside for misses
  let gy;
  if (result === 'goal') gy = 16;
  else if (result === 'save') gy = 15;
  else if (result === 'block') gy = 24;
  else { // miss: wide of a post, or over the bar
    if (Math.abs(lat) > 0.16) { gx = lat < 0 ? 7 : 53; gy = 13; }
    else { gy = 3; gx = 30 + lat * 30; }
  }
  gx = Math.max(3, Math.min(57, gx));
  const cls = result === 'goal' ? 'shot-goal' : result === 'save' ? 'shot-save' : result === 'block' ? 'shot-block' : 'shot-miss';
  return `<svg class="goal-svg" viewBox="0 0 60 34" preserveAspectRatio="xMidYMid meet">
    <g class="goal-net">${Array.from({ length: 7 }, (_, i) => `<line x1="${13 + i * 5.6}" y1="6" x2="${13 + i * 5.6}" y2="29"/>`).join('')}
      ${Array.from({ length: 4 }, (_, i) => `<line x1="12" y1="${9 + i * 5.5}" x2="48" y2="${9 + i * 5.5}"/>`).join('')}</g>
    <path d="M12 29 L12 6 L48 6 L48 29" class="goal-frame"/>
    <line x1="2" y1="29" x2="58" y2="29" class="goal-ground"/>
    <circle cx="${gx.toFixed(1)}" cy="${gy}" r="2.4" class="${cls} goal-mark"/>
    <text x="30" y="33" class="goal-note">approx</text>
  </svg>`;
}

// Shot map with filters (All/Goal/Save/Off Target/Block) and a tappable detail
// card — closer to ESPN's. (xG/xGOT/zone aren't in the free plays feed.)
export function renderShotMap(detail, filter, sel) {
  const v = el('shot-map');
  if (!v) return;
  const shots = (detail && detail.plays && detail.plays.shots || []).filter((s) => s.x != null && s.y != null);
  if (!shots.length) {
    const empty = '<div class="empty">// NO SHOT DATA</div>';
    if (v.innerHTML !== empty) v.innerHTML = empty;
    sig.shotmap = '';
    return;
  }
  filter = filter || 'all';
  const counts = { goal: 0, save: 0, miss: 0, block: 0 };
  for (const s of shots) counts[s.result] = (counts[s.result] || 0) + 1;

  const filters = [['all', `All ${shots.length}`], ...Object.keys(SHOT_STYLE).map((k) => [k, `${SHOT_STYLE[k].label} ${counts[k] || 0}`])];
  const btns = filters
    .map(([k, label]) => `<button class="shot-filter ${filter === k ? 'on' : ''} ${k !== 'all' ? SHOT_STYLE[k].cls + '-leg' : ''}" data-f="${k}">${label}</button>`)
    .join('');

  const dots = shots
    .map((s, i) => {
      if (filter !== 'all' && s.result !== filter) return '';
      const st = SHOT_STYLE[s.result] || SHOT_STYLE.miss;
      const r = i === sel ? 3 : 1.9;
      const selRing = i === sel ? `<circle cx="${PF_X(s.x)}" cy="${PF_Y(s.y)}" r="3.4" class="shot-sel"/>` : '';
      return `${selRing}<circle cx="${PF_X(s.x)}" cy="${PF_Y(s.y)}" r="${r}" class="${st.cls} shot-dot" data-idx="${i}"><title>${esc(`${st.label} ${s.min ? s.min + "'" : ''}`)}</title></circle>`;
    })
    .join('');

  let card = '<div class="shot-card hint">Tap a shot for details</div>';
  if (sel != null && shots[sel]) {
    const s = shots[sel];
    const st = SHOT_STYLE[s.result] || SHOT_STYLE.miss;
    const idxs = shots.map((_, i) => i).filter((i) => filter === 'all' || shots[i].result === filter);
    const pos = idxs.indexOf(sel);
    const cell = (val, label) => `<div><b translate="no">${val}</b><span>${label}</span></div>`;
    card = `<div class="shot-card">
      <div class="sc-left">
        <div class="sc-res-badge ${st.cls}">${st.label}</div>
        ${goalFrontSvg(s)}
        <div class="sc-count" translate="no">${pos + 1} of ${idxs.length}</div>
      </div>
      <div class="sc-right">
        <div class="sc-phead">
          <div class="sc-player" translate="no">${esc(shotPlayer(s.text) || '—')}</div>
          <div class="sc-min" translate="no">${s.min ? s.min + "'" : ''}</div>
        </div>
        <div class="sc-grid">
          ${cell('—', 'xG')}${cell('—', 'xGOT')}${cell(`${shotDistanceYd(s)} yd`, 'Distance')}
          ${cell('—', 'Situation')}${cell('—', 'Shot Type')}${cell('—', 'Goal Zone')}
        </div>
        <div class="sc-nav"><button class="shot-nav" data-d="-1" type="button">◀ Prev</button><button class="shot-nav" data-d="1" type="button">Next ▶</button></div>
      </div>
    </div>`;
  }

  const html = `
    <div class="shot-filters">${btns}</div>
    <svg class="pitch-svg" viewBox="0 0 100 64" preserveAspectRatio="xMidYMid meet">
      <rect x="0" y="0" width="100" height="64" class="pf-grass"/>
      ${pitchSvgMarkings()}
      ${dots}
    </svg>
    ${card}`;
  const s = `${filter}|${sel}|${html}`;
  if (sig.shotmap !== s) { v.innerHTML = html; sig.shotmap = s; }
}

// Knockout bracket: one column per round, each a list of ties.
export function renderBracket(bracket) {
  const v = el('bracket');
  const panel = el('bracket-panel');
  if (!v) return;
  const rounds = (bracket || []).filter((r) => r.matches && r.matches.length);
  if (!rounds.length) { if (panel) panel.hidden = true; sig.bracket = ''; return; }
  const tie = (t) => {
    const sc = t.s1 != null && t.s2 != null;
    const w1 = sc && t.s1 > t.s2;
    const w2 = sc && t.s2 > t.s1;
    return `<div class="bk-tie">
      <div class="bk-row ${w1 ? 'bk-win' : ''}"><span class="bk-team">${esc(t.team1)}</span><span class="bk-sc">${t.s1 != null ? t.s1 : ''}</span></div>
      <div class="bk-row ${w2 ? 'bk-win' : ''}"><span class="bk-team">${esc(t.team2)}</span><span class="bk-sc">${t.s2 != null ? t.s2 : ''}</span></div>
    </div>`;
  };
  const html = `<div class="bracket-cols">${rounds
    .map((r) => `<div class="bk-col"><div class="bk-round">${esc(r.name)}</div>${r.matches.map(tie).join('')}</div>`)
    .join('')}</div>`;
  if (sig.bracket !== html) { v.innerHTML = html; sig.bracket = html; }
  if (panel) panel.hidden = false;
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
