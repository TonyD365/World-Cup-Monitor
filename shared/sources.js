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
  // Phase markers first so "Kick Off" / "Goal Kick" aren't mistaken for goals.
  if (
    t.includes('kick off') || t.includes('kick-off') || t.includes('kickoff') ||
    t.includes('half time') || t.includes('half-time') || t.includes('halftime') ||
    t.includes('first half') || t.includes('second half') || t.includes('end of') ||
    t.includes('full time') || t.includes('full-time') || t.includes('stoppage') ||
    t.includes('added time') || t.includes('whistle') || t.includes('match ended')
  ) return 'half';
  if (t.includes('goal kick')) return 'info';
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
  if (t.includes('half') || t.includes('whistle') || t.includes('kick-off') || t.includes('full time') || t.includes('full-time')) return 'half';
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
  const data = await getJSON(fetchImpl, `${ESPN_BASE}/scoreboard`);
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
        period: st.shortDetail || null,
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

function parseEspnEvents(data) {
  const sides = teamSides(data);
  const out = [];
  const seen = new Set();
  const add = (min, typeTxt, teamId, player, detail, assist = '') => {
    const type = espnEventType(typeTxt || detail || '');
    const key = `${min}|${type}|${player}|${(detail || '').slice(0, 40)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      min, type, team: teamLabel(sides, teamId), player, assist,
      detail: detail || typeTxt || '', source: 'espn',
    });
  };

  // keyEvents: structured goals/cards/subs (use boolean flags when present).
  for (const k of data.keyEvents || []) {
    try {
      const parts = k.participants || [];
      const player = (parts[0] && parts[0].athlete && parts[0].athlete.displayName) || '';
      // For goals, the 2nd participant is typically the assist provider; for
      // substitutions it's the player coming on.
      const assist = (parts[1] && parts[1].athlete && parts[1].athlete.displayName) || '';
      let typeTxt = (k.type && k.type.text) || '';
      if (k.scoringPlay || k.ownGoal) typeTxt = 'goal';
      else if (k.redCard) typeTxt = 'red card';
      else if (k.yellowCard) typeTxt = 'yellow card';
      else if (k.substitution) typeTxt = 'substitution';
      add(clockToMin(k.clock), typeTxt, k.team && k.team.id, player, k.text || (k.type && k.type.text) || '', assist);
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
      add(clockToMin(c.time || play.clock), typeTxt, teamId, '', c.text || (play.type && play.type.text) || '');
    } catch (_) {
      /* skip */
    }
  }

  out.sort((a, b) => (a.min || 0) - (b.min || 0));
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
