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
  const t = typeTxt.toLowerCase();
  if (t.includes('goal') || t.includes('penalty - scored')) return 'goal';
  if (t.includes('red')) return 'red';
  if (t.includes('yellow')) return 'yellow';
  if (t.includes('substitution')) return 'sub';
  return 'info';
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
      const details = comp.details || [];
      const events = details.map((d) => ({
        min: d.clock && d.clock.displayValue ? parseInt(d.clock.displayValue, 10) || null : null,
        type: espnEventType((d.type && d.type.text) || ''),
        team: (d.team && d.team.id) || '',
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
        minute: st.displayClock ? parseInt(st.displayClock, 10) || null : null,
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
  };
}

function parseEspnEvents(data) {
  const events = [];
  const keyEvents = data.keyEvents || (data.commentary && data.commentary.filter((c) => c.play)) || [];
  for (const k of keyEvents) {
    try {
      events.push({
        min: k.clock && k.clock.displayValue ? parseInt(k.clock.displayValue, 10) || null : null,
        type: espnEventType((k.type && k.type.text) || ''),
        team: (k.team && k.team.id) || '',
        player:
          (k.participants && k.participants[0] && k.participants[0].athlete &&
            k.participants[0].athlete.displayName) || '',
        detail: k.text || (k.type && k.type.text) || '',
        source: 'espn',
      });
    } catch (_) {
      /* skip */
    }
  }
  return events;
}

// Lineups: [{ side:'home'|'away', team, formation, starters:[{num,name,pos}], subs:[...] }]
function parseEspnLineups(data) {
  const rosters = data.rosters || [];
  const out = [];
  for (const r of rosters) {
    try {
      const players = (r.roster || []).map((p) => ({
        num: p.jersey || (p.athlete && p.athlete.jersey) || '',
        name: (p.athlete && p.athlete.displayName) || '',
        pos: (p.position && (p.position.abbreviation || p.position.name)) || '',
        starter: !!p.starter,
      }));
      out.push({
        side: r.homeAway === 'away' ? 'away' : 'home',
        team: (r.team && (r.team.displayName || r.team.abbreviation)) || '',
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

// Stats: [{ label, home, away }] aligned across both teams.
function parseEspnStats(data) {
  const teams = (data.boxscore && data.boxscore.teams) || [];
  if (teams.length < 2) return [];
  const home = teams.find((t) => t.homeAway === 'home') || teams[0];
  const away = teams.find((t) => t.homeAway === 'away') || teams[1];
  const byLabel = {};
  const order = [];
  const ingest = (t, key) => {
    for (const s of (t && t.statistics) || []) {
      const label = s.label || s.name || '';
      if (!label) continue;
      if (!byLabel[label]) {
        byLabel[label] = { label, home: '', away: '' };
        order.push(label);
      }
      byLabel[label][key] = s.displayValue != null ? s.displayValue : s.value;
    }
  };
  ingest(home, 'home');
  ingest(away, 'away');
  return order.map((l) => byLabel[l]);
}

// Group table from the summary's standings block, if present.
// [{ team, abbr, p, w, d, l, gd, pts, highlight }]
function parseEspnTable(data) {
  const st = data.standings;
  const groups = (st && st.groups) || (st && [st]) || [];
  const rows = [];
  for (const g of groups) {
    const entries = (g && g.standings && g.standings.entries) || (g && g.entries) || [];
    for (const e of entries) {
      try {
        const stats = {};
        for (const s of e.stats || []) stats[s.name || s.type] = s.displayValue != null ? s.displayValue : s.value;
        rows.push({
          team: (e.team && (e.team.displayName || e.team.name)) || '',
          abbr: (e.team && e.team.abbreviation) || '',
          p: stats.gamesPlayed ?? stats.games ?? '',
          w: stats.wins ?? '',
          d: stats.ties ?? stats.draws ?? '',
          l: stats.losses ?? '',
          gd: stats.pointDifferential ?? stats.goalDifference ?? '',
          pts: stats.points ?? '',
        });
      } catch (_) {
        /* skip */
      }
    }
  }
  return rows;
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
      // openfootball's `time` can carry a timezone suffix ("12:00 UTC-5:00");
      // extract just HH:MM and treat the date as the calendar day.
      let kickoff = null;
      if (m.date) {
        const hm = /(\d{1,2}):(\d{2})/.exec(m.time || '');
        const time = hm ? `${hm[1].padStart(2, '0')}:${hm[2]}` : '00:00';
        kickoff = `${m.date}T${time}:00Z`;
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
