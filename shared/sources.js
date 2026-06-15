// shared/sources.js
// Source adapters shared by frontend and Functions. Each adapter takes a
// `fetchImpl` (so the same code runs in browser and in Workers) and returns
// normalized Match[]. Every adapter is defensive: it must never throw — on
// any failure it returns [] so one dead source can't take down the others.

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';
const FIFA_BASE = 'https://api.fifa.com/api/v3';
// openfootball publishes per-edition JSON; path may shift, so we try a few.
const OPENFOOTBALL_URLS = [
  'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json',
  'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026--brazil/cup.json',
];

const DEFAULT_TIMEOUT = 4500;

async function getJSON(fetchImpl, url, timeout = DEFAULT_TIMEOUT) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
  try {
    const res = await fetchImpl(url, {
      signal: ctrl ? ctrl.signal : undefined,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function mapEspnStatus(state) {
  if (state === 'in') return 'live';
  if (state === 'post') return 'ft';
  return 'pre';
}

function espnEventType(typeTxt = '') {
  const t = (typeTxt || '').toLowerCase();
  if (t.includes('goal kick')) return 'info';
  // Only true period boundaries are centered phase markers (NOT "added time
  // announced", which is a normal info line).
  if (/kick[\s-]?off|half[\s-]?time|full[\s-]?time|(first|second) half (begins|ends)|match (begins|ended)|end of (the )?(1st|2nd|first|second) half/.test(t)) {
    return 'half';
  }
  if (t.includes('own goal')) return 'goal';
  if (t.includes('goal') || t.includes('penalty - scored') || t.includes('scored')) return 'goal';
  if (t.includes('penalty - missed') || t.includes('penalty')) return 'penalty';
  if (t.includes('red')) return 'red';
  if (t.includes('yellow') || t.includes('booking') || t.includes('caution')) return 'yellow';
  if (t.includes('substitution') || t.includes('sub ')) return 'sub';
  if (t.includes('corner')) return 'corner';
  if (t.includes('offside')) return 'offside';
  if (t.includes('throw')) return 'throwin';
  if (t.includes('free kick') || t.includes('free-kick')) return 'freekick';
  if (t.includes('foul')) return 'foul';
  if (t.includes('var') || t.includes('video review')) return 'var';
  if (t.includes('save')) return 'save';
  if (t.includes('shot') || t.includes('attempt') || t.includes('header')) return 'shot';
  return 'info';
}

// Parse ESPN displayClock ("67'", "0'", "45'+2") to a minute. Keeps 0 (kickoff).
function espnMinute(dc) {
  if (dc == null) return null;
  const n = parseInt(String(dc), 10);
  return Number.isNaN(n) ? null : n;
}

function clockToMin(c) {
  if (!c) return null;
  const dv = typeof c === 'object' ? c.displayValue : c;
  const n = parseInt(String(dv || ''), 10);
  return isNaN(n) ? null : n;
}

// Resolve home/away team ids + abbreviations from the summary header.
function teamSides(data) {
  const comp = data.header && data.header.competitions && data.header.competitions[0];
  const cs = (comp && comp.competitors) || [];
  const r = { homeId: '', awayId: '', homeAbbr: '', awayAbbr: '' };
  for (const c of cs) {
    const id = String((c.team && c.team.id) || '');
    const ab = (c.team && (c.team.abbreviation || c.team.displayName)) || '';
    if (c.homeAway === 'home') { r.homeId = id; r.homeAbbr = ab; }
    else if (c.homeAway === 'away') { r.awayId = id; r.awayAbbr = ab; }
  }
  return r;
}
function teamLabel(sides, id) {
  const s = String(id || '');
  if (s && s === sides.homeId) return sides.homeAbbr || 'H';
  if (s && s === sides.awayId) return sides.awayAbbr || 'A';
  return '';
}

// ---- ESPN -----------------------------------------------------------------
export async function fetchEspn(fetchImpl) {
  // Default scoreboard only returns TODAY's matches, so finished matches from
  // previous days lose their ESPN id (and thus Timeline/Lineups). Request a
  // date range covering recent + upcoming days so they keep it.
  const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const now = new Date();
  const start = new Date(now); start.setUTCDate(now.getUTCDate() - 4);
  const end = new Date(now); end.setUTCDate(now.getUTCDate() + 10);
  let data = await getJSON(fetchImpl, `${ESPN_BASE}/scoreboard?dates=${ymd(start)}-${ymd(end)}`);
  if (!data || !Array.isArray(data.events) || !data.events.length) {
    data = await getJSON(fetchImpl, `${ESPN_BASE}/scoreboard`); // fallback: today only
  }
  if (!data || !Array.isArray(data.events)) return [];
  const out = [];
  for (const ev of data.events) {
    try {
      const comp = (ev.competitions && ev.competitions[0]) || {};
      const competitors = comp.competitors || [];
      const homeC = competitors.find((c) => c.homeAway === 'home') || competitors[0] || {};
      const awayC = competitors.find((c) => c.homeAway === 'away') || competitors[1] || {};
      const st = (ev.status && ev.status.type) || {};
      const team = (c) => ({
        name: (c.team && (c.team.displayName || c.team.name)) || '',
        abbr: (c.team && c.team.abbreviation) || '',
        flag: (c.team && c.team.logo) || '',
        score: c.score != null ? Number(c.score) : null,
      });
      // Map team id -> abbreviation so events show the team, not a numeric id.
      const abbrById = {};
      if (homeC.team) abbrById[String(homeC.team.id)] = homeC.team.abbreviation || homeC.team.displayName || '';
      if (awayC.team) abbrById[String(awayC.team.id)] = awayC.team.abbreviation || awayC.team.displayName || '';
      const details = comp.details || [];
      const events = details.map((d) => ({
        min: d.clock && d.clock.displayValue ? parseInt(d.clock.displayValue, 10) || null : null,
        type: espnEventType((d.type && d.type.text) || ''),
        team: abbrById[String((d.team && d.team.id) || '')] || '',
        player:
          (d.athletesInvolved && d.athletesInvolved[0] && d.athletesInvolved[0].displayName) || '',
        detail: (d.type && d.type.text) || '',
        source: 'espn',
      }));
      out.push({
        id: String(ev.id),
        comp: (ev.season && ev.season.slug) || 'FIFA World Cup',
        home: team(homeC),
        away: team(awayC),
        status: mapEspnStatus(st.state),
        minute: espnMinute(st.displayClock),
        // shortDetail carries the clock/stoppage ("45'+2'", "HT", "FT", "67'");
        // fall back to the wordier description.
        period: st.shortDetail || st.description || null,
        venue: (comp.venue && comp.venue.fullName) || null,
        kickoff: ev.date || null,
        events,
        stats: {},
      });
    } catch (_) {
      /* skip malformed event */
    }
  }
  return out;
}

// Fetch full match detail for one ESPN event: events (timeline), lineups,
// stats and the two teams' group table. Returns { events, lineups, stats, table }.
// Always defensive — any missing section just comes back empty.
export async function fetchEspnSummary(fetchImpl, eventId) {
  const data = await getJSON(fetchImpl, `${ESPN_BASE}/summary?event=${encodeURIComponent(eventId)}`);
  if (!data) return null;
  return {
    events: parseEspnEvents(data),
    lineups: parseEspnLineups(data),
    stats: parseEspnStats(data),
    table: parseEspnTable(data),
    predictor: parseEspnPredictor(data),
    info: parseEspnInfo(data),
    live: parseEspnLive(data),
  };
}

// Authoritative live status/score/clock for this match from the summary header
// (more current than the shared scoreboard list). Returns null if unavailable.
function parseEspnLive(data) {
  const comp = data.header && data.header.competitions && data.header.competitions[0];
  if (!comp) return null;
  const st = (comp.status && comp.status.type) || {};
  const cs = comp.competitors || [];
  const home = cs.find((c) => c.homeAway === 'home') || cs[0] || {};
  const away = cs.find((c) => c.homeAway === 'away') || cs[1] || {};
  const sc = (c) => (c && c.score != null && c.score !== '' ? Number(c.score) : null);
  return {
    status: mapEspnStatus(st.state),
    minute: espnMinute(comp.status && comp.status.displayClock),
    period: st.shortDetail || st.description || null,
    homeScore: sc(home),
    awayScore: sc(away),
  };
}

// Win probability {home, draw, away} as integer percentages, or null.
function parseEspnPredictor(data) {
  const p = data.predictor;
  if (!p) return null;
  const sides = teamSides(data);
  const num = (x) => {
    const n = parseFloat(String(x));
    return isNaN(n) ? null : n;
  };
  const a = p.homeTeam || {};
  const b = p.awayTeam || {};
  // ESPN labels predictor teams by id; map to actual home/away.
  let home = num(a.gameProjection);
  let away = num(b.gameProjection);
  if (String(a.id) === sides.awayId) { const t = home; home = away; away = t; }
  if (home == null || away == null) return null;
  const draw = Math.max(0, Math.round(100 - home - away));
  return { home: Math.round(home), draw, away: Math.round(away) };
}

// Match info: venue, attendance, referee, weather.
function parseEspnInfo(data) {
  const gi = data.gameInfo || {};
  const venue = gi.venue || {};
  const city = (venue.address && (venue.address.city || venue.address.country)) || '';
  const officials = gi.officials || [];
  const ref = (officials.find((o) => /referee/i.test((o.position && o.position.name) || '')) || officials[0] || {}).displayName || '';
  const w = gi.weather || {};
  const weather = w.displayValue || (w.temperature != null ? `${w.temperature}°` : '');
  return {
    venue: venue.fullName || '',
    city,
    attendance: gi.attendance != null ? gi.attendance : '',
    referee: ref,
    weather,
  };
}

// Live play-by-play with field coordinates (ESPN core API) for the ball-position
// widget and shot map. Returns { lastPlay, shots } or null. Defensive: the core
// API is $ref-heavy and may be CORS-blocked in the browser — callers handle null.
export async function fetchEspnPlays(fetchImpl, eventId) {
  const url = `https://sports.core.api.espn.com/v2/sports/soccer/leagues/fifa.world/events/${eventId}/competitions/${eventId}/plays?limit=1000&lang=en`;
  const data = await getJSON(fetchImpl, url);
  const items = data && (data.items || data.plays);
  if (!Array.isArray(items)) return null;
  const num = (v) => (typeof v === 'number' ? v : v != null && !isNaN(parseFloat(v)) ? parseFloat(v) : null);
  const teamId = (p) => {
    const r = (p.team && p.team.$ref) || '';
    const mm = /teams\/(\d+)/.exec(r);
    return mm ? mm[1] : '';
  };
  const norm = items.map((p, idx) => ({
    x: num(p.fieldPositionX), y: num(p.fieldPositionY),
    x2: num(p.fieldPosition2X), y2: num(p.fieldPosition2Y),
    type: (p.type && p.type.text) || '', text: p.text || p.shortText || '',
    min: (p.clock && parseInt(p.clock.displayValue, 10)) || null,
    team: teamId(p), scoring: !!p.scoringPlay,
    seq: num(p.sequenceNumber) != null ? num(p.sequenceNumber) : idx,
  }));

  // Latest play with coordinates = highest sequence number (order-independent).
  let lastPlay = null;
  let bestSeq = -Infinity;
  for (const p of norm) {
    if (p.x != null && p.y != null && p.seq >= bestSeq) { bestSeq = p.seq; lastPlay = p; }
  }
  if (!lastPlay && norm.length) lastPlay = norm[norm.length - 1];

  const shots = [];
  for (const p of norm) {
    if (p.x == null || p.y == null) continue;
    const t = `${p.type} ${p.text}`.toLowerCase();
    if (t.includes('goal kick')) continue;
    // Only count actual shots (avoid e.g. "Attempted tackle").
    const isShot = /\bshot\b/.test(t) ||
      /\battempt\s+(saved|missed|blocked|on goal)/.test(t) ||
      /header\s+(saved|missed|blocked|wide|over the bar|on goal)/.test(t) ||
      /penalty\s+(scored|missed|saved)/.test(t) ||
      /free kick\s+(saved|missed)/.test(t);
    let result = null;
    if (p.scoring || /\bgoal\b/.test(t)) result = 'goal';
    else if (!isShot) continue;
    else if (/saved/.test(t)) result = 'save';
    else if (/block/.test(t)) result = 'block';
    else result = 'miss';
    shots.push({ x: p.x, y: p.y, result, min: p.min, team: p.team, text: p.text });
  }

  // ESPN's coordinates are relative to the attacking direction (always toward
  // x=1), so both teams' shots pile up at the same goal. Mirror one team to the
  // opposite end so the two teams' shots split left/right like ESPN's map.
  const teams = [...new Set(shots.map((s) => s.team).filter(Boolean))];
  const mirror = teams.length > 1 ? teams[1] : null;
  if (mirror) {
    for (const s of shots) {
      if (s.team === mirror) { s.x = 1 - s.x; s.y = 1 - s.y; }
    }
  }
  return { lastPlay, shots };
}

// Fractional minute including stoppage, e.g. "45'+2'" -> 45.02, "67'" -> 67.
function clockFrac(c) {
  if (!c) return null;
  const dv = typeof c === 'object' ? c.displayValue : c;
  const mm = /(\d+)\s*'?(?:\s*\+\s*(\d+))?/.exec(String(dv || ''));
  if (!mm) return null;
  return parseInt(mm[1], 10) + (mm[2] ? parseInt(mm[2], 10) / 100 : 0);
}

// Chronological sort position. Period boundaries get synthetic minutes so they
// land correctly: kick off=0, end-of-1st/half-time=45.99, 2nd-half start=46,
// full time=last.
function eventSortPos(ev) {
  if (ev.type === 'half') {
    const d = (ev.detail || '').toLowerCase();
    if (/kick[\s-]?off|first half (begins|start)|match begins/.test(d)) return -1; // very top
    if (/second half (begins|start)|start of (the )?second half/.test(d)) return 46;
    if (/full[\s-]?time|match ended|second half ends|end of (the )?(2nd|second) half/.test(d)) return 1000;
    return 45.99; // half time / first half ends / end of first half
  }
  return ev.minF != null ? ev.minF : (ev.min != null ? ev.min : 0);
}

// Current ball / last play from ESPN's lightweight `situation` endpoint — always
// the latest, unlike the paginated plays list. Returns { x, y, x2, y2, text, min }.
export async function fetchEspnSituation(fetchImpl, eventId) {
  const url = `https://sports.core.api.espn.com/v2/sports/soccer/leagues/fifa.world/events/${eventId}/competitions/${eventId}/situation?lang=en`;
  const data = await getJSON(fetchImpl, url);
  if (!data) return null;
  let lp = data.lastPlay || data;
  // lastPlay is often a $ref to the play object.
  if (lp && lp.$ref && lp.fieldPositionX == null) {
    const d2 = await getJSON(fetchImpl, String(lp.$ref).replace(/^http:/, 'https:'));
    if (d2) lp = d2;
  }
  if (!lp) return null;
  const num = (v) => (typeof v === 'number' ? v : v != null && !isNaN(parseFloat(v)) ? parseFloat(v) : null);
  const x = num(lp.fieldPositionX);
  const y = num(lp.fieldPositionY);
  if (x == null || y == null) return null;
  return {
    x, y, x2: num(lp.fieldPosition2X), y2: num(lp.fieldPosition2Y),
    text: lp.text || (lp.type && lp.type.text) || '',
    min: (lp.clock && parseInt(lp.clock.displayValue, 10)) || null,
  };
}

function parseEspnEvents(data) {
  const sides = teamSides(data);
  const out = [];
  const seen = new Set();
  const add = (clock, typeTxt, teamId, player, detail, assist = '') => {
    let type = espnEventType(typeTxt || detail || '');
    if (/drinks? break|cooling break|hydration break/i.test(`${typeTxt || ''} ${detail || ''}`)) type = 'break';
    const min = clockToMin(clock);
    const key = `${min}|${type}|${player}|${(detail || '').slice(0, 40)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      min, minF: clockFrac(clock), type, team: teamLabel(sides, teamId), player, assist,
      detail: detail || typeTxt || '', source: 'espn',
    });
  };

  // keyEvents: structured goals/cards/subs (use boolean flags when present).
  for (const k of data.keyEvents || []) {
    try {
      const parts = k.participants || [];
      const player = (parts[0] && parts[0].athlete && parts[0].athlete.displayName) || '';
      const assist = (parts[1] && parts[1].athlete && parts[1].athlete.displayName) || '';
      let typeTxt = (k.type && k.type.text) || '';
      if (k.scoringPlay || k.ownGoal) typeTxt = 'goal';
      else if (k.redCard) typeTxt = 'red card';
      else if (k.yellowCard) typeTxt = 'yellow card';
      else if (k.substitution) typeTxt = 'substitution';
      add(k.clock, typeTxt, k.team && k.team.id, player, k.text || (k.type && k.type.text) || '', assist);
    } catch (_) {
      /* skip */
    }
  }

  // commentary: full play-by-play (fouls, corners, throw-ins, offsides, …).
  for (const c of data.commentary || []) {
    try {
      const play = c.play || {};
      const typeTxt = (play.type && play.type.text) || c.text || '';
      const teamId = (play.team && play.team.id) || '';
      add(c.time || play.clock, typeTxt, teamId, '', c.text || (play.type && play.type.text) || '');
    } catch (_) {
      /* skip */
    }
  }

  out
    .map((e, i) => ({ e, i }))
    .sort((A, B) => (eventSortPos(A.e) - eventSortPos(B.e)) || (A.i - B.i))
    .forEach((x, i) => { x.e._ord = i; });
  out.sort((a, b) => a._ord - b._ord);
  return out;
}

// Lineups: [{ side:'home'|'away', team, formation, starters:[{num,name,pos}], subs:[...] }]
function parseEspnLineups(data) {
  const sides = teamSides(data);
  const rosters = data.rosters || (data.boxscore && data.boxscore.players) || [];
  const out = [];
  for (const r of rosters) {
    try {
      const players = (r.roster || r.athletes || []).map((p) => {
        const ath = p.athlete || {};
        const photo =
          (ath.headshot && (ath.headshot.href || ath.headshot)) ||
          (ath.id ? `https://a.espncdn.com/i/headshots/soccer/players/full/${ath.id}.png` : '');
        return {
          num: p.jersey || ath.jersey || '',
          name: ath.displayName || p.displayName || '',
          pos: (p.position && (p.position.abbreviation || p.position.name)) ||
            (ath.position && ath.position.abbreviation) || '',
          photo: typeof photo === 'string' ? photo : '',
          starter: p.starter != null ? !!p.starter : true,
        };
      }).filter((p) => p.name);
      const teamId = String((r.team && r.team.id) || '');
      const side = r.homeAway === 'away' || (sides.awayId && teamId === sides.awayId) ? 'away' : 'home';
      out.push({
        side,
        team: (r.team && (r.team.displayName || r.team.shortDisplayName || r.team.name || r.team.abbreviation)) || '',
        formation: r.formation || (r.team && r.team.formation) || '',
        starters: players.filter((p) => p.starter),
        subs: players.filter((p) => !p.starter),
      });
    } catch (_) {
      /* skip */
    }
  }
  return out;
}

// Stats: [{ label, home, away }] aligned across both teams, mapped by team id.
function parseEspnStats(data) {
  const sides = teamSides(data);
  const teams = (data.boxscore && data.boxscore.teams) || [];
  if (teams.length < 2) return [];
  const byId = (t) => String((t.team && t.team.id) || '');
  let home = teams.find((t) => t.homeAway === 'home') || (sides.homeId && teams.find((t) => byId(t) === sides.homeId));
  let away = teams.find((t) => t.homeAway === 'away') || (sides.awayId && teams.find((t) => byId(t) === sides.awayId));
  if (!home || !away) { home = teams[0]; away = teams[1]; }
  const byLabel = {};
  const order = [];
  const ingest = (t, key) => {
    for (const s of (t && t.statistics) || []) {
      const label = s.label || s.displayName || s.name || '';
      if (!label) continue;
      if (!byLabel[label]) { byLabel[label] = { label, home: '', away: '' }; order.push(label); }
      byLabel[label][key] = s.displayValue != null ? s.displayValue : s.value;
    }
  };
  ingest(home, 'home');
  ingest(away, 'away');
  return order.map((l) => byLabel[l]);
}

// Read a stat value from an entry's stats[] by trying several ESPN field names.
function statBy(stats, names) {
  for (const n of names) {
    if (stats[n] != null && stats[n] !== '') return stats[n];
  }
  return '';
}

// Group table(s) from the summary's standings block. Returns
// [{ name, rows:[{rank,team,abbr,mp,w,d,l,gf,ga,gd,pts}] }]. Robustly digs out
// the entries array and the group name (ESPN nests/labels these inconsistently).
function parseEspnTable(data) {
  const found = [];
  const visit = (node, depth, name) => {
    if (!node || typeof node !== 'object' || depth > 6) return;
    const gname = node.name || node.displayName || node.header || node.groupName || node.abbreviation || name;
    if (Array.isArray(node.entries) && node.entries.some((e) => e && e.team)) {
      found.push({ name: gname || '', entries: node.entries });
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (v && typeof v === 'object') visit(v, depth + 1, gname);
    }
  };
  visit(data.standings, 0, '');

  const groups = [];
  const seenGroup = new Set();
  for (const g of found) {
    const key = (g.name || '') + '#' + g.entries.length;
    if (seenGroup.has(key)) continue;
    seenGroup.add(key);
    const rows = [];
    const seen = new Set();
    g.entries.forEach((e, i) => {
      try {
        const t = e.team || {};
        const name = t.displayName || t.shortDisplayName || t.name || t.location || t.abbreviation || '';
        const abbr = t.abbreviation || t.shortDisplayName || name;
        const id = String(t.id || name);
        if (!name || seen.has(id)) return;
        seen.add(id);
        const stats = {};
        for (const s of e.stats || []) {
          const dv = s.displayValue != null ? s.displayValue : s.value;
          if (s.name) stats[s.name] = dv;
          if (s.type) stats[s.type] = dv;
          if (s.abbreviation) stats[s.abbreviation] = dv;
        }
        rows.push({
          rank: statBy(stats, ['rank']) || i + 1,
          team: name,
          abbr,
          mp: statBy(stats, ['gamesPlayed', 'games', 'GP']),
          w: statBy(stats, ['wins', 'W']),
          d: statBy(stats, ['ties', 'draws', 'D']),
          l: statBy(stats, ['losses', 'L']),
          gf: statBy(stats, ['pointsFor', 'goalsFor', 'for', 'GF']),
          ga: statBy(stats, ['pointsAgainst', 'goalsAgainst', 'against', 'GA']),
          gd: statBy(stats, ['pointDifferential', 'goalDifference', 'GD']),
          pts: statBy(stats, ['points', 'PTS']),
        });
      } catch (_) {
        /* skip */
      }
    });
    if (rows.length) groups.push({ name: g.name, rows });
  }
  return groups;
}

// ---- FIFA official (best-effort; no key, server-side only due to CORS) -----
export async function fetchFifa(fetchImpl) {
  const data = await getJSON(fetchImpl, `${FIFA_BASE}/live/football/now`);
  if (!data || !Array.isArray(data.Results)) return [];
  const out = [];
  const pick = (loc) =>
    (Array.isArray(loc) && (loc.find((x) => x.Locale === 'en-GB') || loc[0]) || {}).Description || '';
  for (const r of data.Results) {
    try {
      const home = r.HomeTeam || r.Home || {};
      const away = r.AwayTeam || r.Away || {};
      // `live/football/now` returns ALL live football globally (incl. club
      // leagues). World Cup teams are national sides, whose FIFA picture URLs
      // use the "flags-" path; club teams use "teams-". Keep national-team
      // fixtures only so we don't pollute the monitor with random leagues.
      const pics = `${home.PictureUrl || ''} ${away.PictureUrl || ''}`;
      const compName = pick(r.CompetitionName).toLowerCase();
      const isNational = pics.includes('flags-');
      const isWorldCup = compName.includes('world cup') || String(r.IdCompetition) === '17';
      if (!isNational && !isWorldCup) continue;
      const statusMap = { 0: 'pre', 1: 'live', 2: 'ft', 3: 'ft' };
      out.push({
        id: r.IdMatch ? String(r.IdMatch) : undefined,
        comp: 'FIFA World Cup',
        home: {
          name: pick(home.TeamName) || home.ShortClubName || '',
          abbr: home.Abbreviation || '',
          flag: home.PictureUrl || '',
          score: home.Score != null ? Number(home.Score) : null,
        },
        away: {
          name: pick(away.TeamName) || away.ShortClubName || '',
          abbr: away.Abbreviation || '',
          flag: away.PictureUrl || '',
          score: away.Score != null ? Number(away.Score) : null,
        },
        status: statusMap[r.MatchStatus] || 'pre',
        minute: r.MatchTime ? parseInt(r.MatchTime, 10) || null : null,
        period: r.Period != null ? String(r.Period) : null,
        venue: r.Stadium ? pick(r.Stadium.Name) : null,
        kickoff: r.Date || null,
        events: [],
        stats: {},
      });
    } catch (_) {
      /* skip */
    }
  }
  return out;
}

// ---- openfootball (schedule / fixtures fallback; not live) -----------------
export async function fetchOpenfootball(fetchImpl) {
  let data = null;
  for (const url of OPENFOOTBALL_URLS) {
    data = await getJSON(fetchImpl, url);
    if (data && (data.rounds || data.matches)) break;
  }
  if (!data) return [];
  const rows = [];
  if (Array.isArray(data.matches)) rows.push(...data.matches);
  if (Array.isArray(data.rounds)) for (const r of data.rounds) rows.push(...(r.matches || []));
  const out = [];
  for (const m of rows) {
    try {
      const home = m.team1 || (m.home && m.home.name) || '';
      const away = m.team2 || (m.away && m.away.name) || '';
      // Skip bracket placeholders like "2A", "W73", "L101", "3A/B/C".
      if (isPlaceholderTeam(home) || isPlaceholderTeam(away)) continue;
      // openfootball's `time` carries the venue's UTC offset ("12:00 UTC-5:00").
      // Parse both the HH:MM and the offset so the instant is correct; the UI
      // then converts it to the viewer's local timezone.
      let kickoff = null;
      if (m.date) {
        const hm = /(\d{1,2}):(\d{2})/.exec(m.time || '');
        const time = hm ? `${hm[1].padStart(2, '0')}:${hm[2]}` : '00:00';
        const off = /UTC\s*([+-])(\d{1,2})(?::?(\d{2}))?/i.exec(m.time || '');
        const tz = off ? `${off[1]}${off[2].padStart(2, '0')}:${off[3] || '00'}` : 'Z';
        kickoff = `${m.date}T${time}:00${tz}`;
      }
      const sc = m.score && m.score.ft;
      out.push({
        id: undefined,
        comp: 'FIFA World Cup',
        home: { name: home, abbr: '', flag: '', score: sc ? sc[0] : null },
        away: { name: away, abbr: '', flag: '', score: sc ? sc[1] : null },
        status: sc ? 'ft' : 'pre',
        minute: null,
        period: null,
        venue: (m.stadium && m.stadium.name) || m.city || null,
        kickoff,
        events: [],
        stats: {},
      });
    } catch (_) {
      /* skip */
    }
  }
  return out;
}

// Compute group standings from openfootball results (each match carries a
// `group` and `score.ft`). Returns [{ name, rows:[{rank,team,abbr,mp,w,d,l,gf,ga,gd,pts}] }].
export async function fetchOpenfootballStandings(fetchImpl) {
  let data = null;
  for (const url of OPENFOOTBALL_URLS) {
    data = await getJSON(fetchImpl, url);
    if (data && (data.rounds || data.matches)) break;
  }
  if (!data) return [];
  const rows = [];
  if (Array.isArray(data.matches)) rows.push(...data.matches);
  if (Array.isArray(data.rounds)) for (const r of data.rounds) rows.push(...(r.matches || []));

  const groups = new Map(); // groupName -> Map(team -> stats)
  const ensureGroup = (g) => { if (!groups.has(g)) groups.set(g, new Map()); return groups.get(g); };
  const ensureTeam = (tbl, t) => {
    if (!tbl.has(t)) tbl.set(t, { team: t, mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 });
    return tbl.get(t);
  };
  for (const m of rows) {
    const g = m.group;
    if (!g || isPlaceholderTeam(m.team1) || isPlaceholderTeam(m.team2)) continue;
    const tbl = ensureGroup(g);
    // Seed both teams (so groups show with 0s before any game is played).
    ensureTeam(tbl, m.team1);
    ensureTeam(tbl, m.team2);
    const sc = m.score && m.score.ft;
    if (!sc || sc.length < 2 || sc[0] == null || sc[1] == null) continue; // not played yet
    const a = ensureTeam(tbl, m.team1);
    const b = ensureTeam(tbl, m.team2);
    const g1 = sc[0];
    const g2 = sc[1];
    a.mp += 1; b.mp += 1;
    a.gf += g1; a.ga += g2; b.gf += g2; b.ga += g1;
    if (g1 > g2) { a.w += 1; a.pts += 3; b.l += 1; }
    else if (g1 < g2) { b.w += 1; b.pts += 3; a.l += 1; }
    else { a.d += 1; b.d += 1; a.pts += 1; b.pts += 1; }
  }

  const out = [];
  for (const [name, tbl] of groups) {
    const list = [...tbl.values()].map((r) => ({ ...r, gdNum: r.gf - r.ga }));
    list.sort((x, y) => y.pts - x.pts || y.gdNum - x.gdNum || y.gf - x.gf || x.team.localeCompare(y.team));
    const rowsOut = list.map((r, i) => ({
      rank: i + 1, team: r.team, abbr: '',
      mp: r.mp, w: r.w, d: r.d, l: r.l, gf: r.gf, ga: r.ga,
      gd: (r.gdNum > 0 ? '+' : '') + r.gdNum, pts: r.pts,
    }));
    out.push({ name, rows: rowsOut });
  }
  out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return out;
}

// Knockout bracket from openfootball: matches without a `group` are knockout
// ties. Returns [{ name, matches:[{team1,team2,s1,s2}] }] ordered by round.
export async function fetchOpenfootballBracket(fetchImpl) {
  let data = null;
  for (const url of OPENFOOTBALL_URLS) {
    data = await getJSON(fetchImpl, url);
    if (data && (data.rounds || data.matches)) break;
  }
  if (!data) return [];
  const rows = [];
  if (Array.isArray(data.matches)) rows.push(...data.matches);
  if (Array.isArray(data.rounds)) for (const r of data.rounds) rows.push(...(r.matches || []));

  const ORDER = ['round of 32', 'round of 16', 'quarter', 'semi', 'third', 'final'];
  const byRound = new Map();
  for (const m of rows) {
    if (m.group || !m.round || /matchday|group/i.test(m.round)) continue; // group stage
    if (!byRound.has(m.round)) byRound.set(m.round, []);
    const sc = m.score && m.score.ft;
    byRound.get(m.round).push({
      team1: m.team1 || 'TBD', team2: m.team2 || 'TBD',
      s1: sc ? sc[0] : null, s2: sc ? sc[1] : null,
    });
  }
  const key = (r) => { const i = ORDER.findIndex((k) => r.toLowerCase().includes(k)); return i < 0 ? ORDER.length : i; };
  return [...byRound.entries()].sort((a, b) => key(a[0]) - key(b[0])).map(([name, matches]) => ({ name, matches }));
}

// A real fixture has named countries; bracket slots ("2A", "W73", "3A/B/C",
// "L101") are placeholders we don't want cluttering the monitor.
function isPlaceholderTeam(name) {
  const n = (name || '').trim();
  if (!n) return true;
  if (n.includes('/')) return true;
  if (/^[0-9]/.test(n)) return true; // "2A", "1C"
  if (/^[WL]\d/.test(n)) return true; // "W73", "L101"
  return false;
}
