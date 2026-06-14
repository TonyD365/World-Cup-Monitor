// shared/mock.js
// Demo match generator so the monitor is never blank (used when every live
// source is unreachable, e.g. local file:// open or sandboxed network).
// Produces normalized Match[] with a clock that advances by wall time and a
// deterministic-ish set of events, so the UI is fully exercisable offline.

const DEMO_MATCHES = [
  {
    id: 'demo-1',
    home: { name: 'Brazil', abbr: 'BRA', flag: '🇧🇷' },
    away: { name: 'Argentina', abbr: 'ARG', flag: '🇦🇷' },
    venue: 'MetLife Stadium, New Jersey',
    seed: 7,
  },
  {
    id: 'demo-2',
    home: { name: 'France', abbr: 'FRA', flag: '🇫🇷' },
    away: { name: 'Spain', abbr: 'ESP', flag: '🇪🇸' },
    venue: 'Estadio Azteca, Mexico City',
    seed: 3,
  },
  {
    id: 'demo-3',
    home: { name: 'England', abbr: 'ENG', flag: '🏴' },
    away: { name: 'Germany', abbr: 'GER', flag: '🇩🇪' },
    venue: 'BC Place, Vancouver',
    seed: 11,
  },
];

const EVENT_POOL = [
  { type: 'goal', detail: 'Goal' },
  { type: 'yellow', detail: 'Yellow Card' },
  { type: 'sub', detail: 'Substitution' },
  { type: 'red', detail: 'Red Card' },
];
const PLAYERS = ['10. Silva', '9. Martins', '7. Dubois', '4. Romero', '11. Walker', '8. Kruger'];

// Minute derived from wall clock so it ticks while the page is open.
function liveMinute(seed) {
  const base = Math.floor((Date.now() / 1000 / 6 + seed * 13) % 95);
  return Math.max(1, base);
}

const MOCK_NAMES = ['Keeper', 'Back', 'Stopper', 'Sweeper', 'Wing', 'Mid', 'Maestro', 'Engine', 'Winger', 'Striker', 'Poacher'];
const POS = ['GK', 'RB', 'CB', 'CB', 'LB', 'CM', 'CM', 'RM', 'LM', 'ST', 'ST'];

function mockLineup(side, team) {
  return {
    side,
    team,
    formation: '4-4-2',
    starters: MOCK_NAMES.map((n, i) => ({ num: i + 1, name: `${team.abbr} ${n}`, pos: POS[i], starter: true })),
    subs: [
      { num: 12, name: `${team.abbr} Sub-GK`, pos: 'GK', starter: false },
      { num: 14, name: `${team.abbr} Sub-MF`, pos: 'CM', starter: false },
      { num: 19, name: `${team.abbr} Sub-FW`, pos: 'ST', starter: false },
    ],
  };
}

// Mock detail for the new Timeline/Lineups/Stats/Table tabs in DEMO mode.
export function mockDetail(match) {
  const s = match.stats || {};
  return {
    events: match.events || [],
    lineups: [mockLineup('home', match.home), mockLineup('away', match.away)],
    stats: [
      { label: 'Possession %', home: `${s.possessionHome ?? 50}%`, away: `${s.possessionAway ?? 50}%` },
      { label: 'Shots', home: s.shotsHome ?? 0, away: s.shotsAway ?? 0 },
      { label: 'Shots on Target', home: Math.ceil((s.shotsHome ?? 0) / 2), away: Math.ceil((s.shotsAway ?? 0) / 2) },
      { label: 'Corners', home: 4, away: 3 },
      { label: 'Fouls', home: 8, away: 11 },
    ],
    table: [
      { team: match.home.name, abbr: match.home.abbr, p: 2, w: 1, d: 1, l: 0, gd: '+2', pts: 4 },
      { team: match.away.name, abbr: match.away.abbr, p: 2, w: 1, d: 0, l: 1, gd: '0', pts: 3 },
      { team: 'Group Rival A', abbr: 'GRA', p: 2, w: 1, d: 0, l: 1, gd: '-1', pts: 3 },
      { team: 'Group Rival B', abbr: 'GRB', p: 2, w: 0, d: 1, l: 1, gd: '-1', pts: 1 },
    ],
  };
}

export function mockMatches() {
  return DEMO_MATCHES.map((d) => {
    const minute = liveMinute(d.seed);
    const events = [];
    let hs = 0;
    let as = 0;
    events.push({ min: 0, type: 'half', team: '', player: '', detail: 'Kick Off', source: 'mock' });
    // Replay events up to the current minute, deterministic by seed.
    for (let m = 3; m <= minute; m += 1) {
      const r = (m * 9301 + d.seed * 49297) % 233280;
      if (r % 17 === 0) {
        const ev = EVENT_POOL[(r >> 3) % EVENT_POOL.length];
        const home = (r >> 5) % 2 === 0;
        if (ev.type === 'goal') home ? (hs += 1) : (as += 1);
        events.push({
          min: m,
          type: ev.type,
          team: home ? d.home.abbr : d.away.abbr,
          player: PLAYERS[(r >> 7) % PLAYERS.length],
          detail: ev.detail,
          source: 'mock',
        });
      }
    }
    if (minute >= 45) events.push({ min: 45, type: 'half', team: '', player: '', detail: 'Half Time', source: 'mock' });
    if (minute >= 90) events.push({ min: 90, type: 'half', team: '', player: '', detail: 'Full Time', source: 'mock' });
    return {
      id: d.id,
      comp: 'FIFA World Cup (DEMO)',
      home: { ...d.home, score: hs },
      away: { ...d.away, score: as },
      status: 'live',
      minute,
      period: minute > 45 ? '2H' : '1H',
      venue: d.venue,
      kickoff: new Date().toISOString(),
      events,
      stats: {
        possessionHome: 40 + ((d.seed * 7) % 20),
        possessionAway: 60 - ((d.seed * 7) % 20),
        shotsHome: 5 + (d.seed % 8),
        shotsAway: 4 + ((d.seed + 3) % 8),
      },
    };
  });
}
