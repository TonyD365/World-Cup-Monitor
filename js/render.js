// js/render.js — DOM rendering for the monitor. All UI text is English.
const EVENT_ICON = { goal: '⚽', yellow: '🟨', red: '🟥', sub: '⇄', info: '›' };

function el(id) {
  return document.getElementById(id);
}

function statusLabel(m) {
  if (m.status === 'live') return `LIVE ${m.minute ? m.minute + "'" : ''} ${m.period ? '· ' + m.period : ''}`.trim();
  if (m.status === 'ft') return 'FULL TIME';
  return 'SCHEDULED';
}

// Populate the live-match dropdown, preserving the current selection if possible.
export function renderSelector(matches, selectedId) {
  const sel = el('match-select');
  const live = matches.filter((m) => m.status === 'live');
  const list = live.length ? live : matches; // if none live, show all so UI isn't empty
  const prev = selectedId || sel.value;
  sel.innerHTML = '';
  for (const m of list) {
    const o = document.createElement('option');
    o.value = m.id;
    const clk = m.status === 'live' && m.minute ? ` · ${m.minute}'` : '';
    o.textContent = `${m.home.abbr || m.home.name} v ${m.away.abbr || m.away.name}${clk}`;
    sel.appendChild(o);
  }
  if (list.some((m) => m.id === prev)) sel.value = prev;
  return sel.value || (list[0] && list[0].id) || null;
}

function bar(label, pctHome, pctAway) {
  const h = Math.max(0, Math.min(100, pctHome || 0));
  const a = Math.max(0, Math.min(100, pctAway || 0));
  return `<div class="stat-row"><span class="stat-h">${h}%</span>
    <div class="stat-bar"><div class="stat-fill-h" style="width:${h}%"></div><div class="stat-fill-a" style="width:${a}%"></div></div>
    <span class="stat-a">${a}%</span><span class="stat-label">${label}</span></div>`;
}

function srcTag(m, field) {
  const s = m.fieldSources && m.fieldSources[field];
  return s ? `<sup class="src src-${s}">${s}</sup>` : '';
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
    <div class="sb-main">
      <div class="sb-team home">
        <div class="sb-flag">${m.home.flag && m.home.flag.length <= 4 ? m.home.flag : ''}</div>
        <div class="sb-name">${m.home.name || m.home.abbr}${srcTag(m, 'home.name')}</div>
      </div>
      <div class="sb-score">${m.home.score ?? '-'} <span class="sb-dash">:</span> ${m.away.score ?? '-'}${srcTag(m, 'home.score')}</div>
      <div class="sb-team away">
        <div class="sb-flag">${m.away.flag && m.away.flag.length <= 4 ? m.away.flag : ''}</div>
        <div class="sb-name">${m.away.name || m.away.abbr}${srcTag(m, 'away.name')}</div>
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
    const key = `${m.id}|${ev.min}|${ev.type}|${ev.player}`;
    if (shownKeys.has(key)) continue;
    shownKeys.add(key);
    appended = true;
    const line = document.createElement('div');
    line.className = `log-line type-${ev.type} flash`;
    const ts = String(ev.min ?? '--').padStart(2, '0');
    line.innerHTML = `<span class="log-ts">[${ts}']</span> ${EVENT_ICON[ev.type] || '›'} <span class="log-type">${ev.type.toUpperCase()}</span> <span class="log-team">${ev.team || ''}</span> ${ev.player || ''} <span class="log-detail">${ev.detail || ''}</span> <span class="src src-${ev.source}">${ev.source}</span>`;
    log.appendChild(line);
  }
  if (appended) log.scrollTop = log.scrollHeight;
}

export function clearEventLog() {
  el('event-log').innerHTML = '';
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
