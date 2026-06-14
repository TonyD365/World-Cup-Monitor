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
  const home = mockLineup('home', match.home);
  const away = mockLineup('away', match.away);
  // Craft events that reference real lineup names so annotations show in DEMO.
  const hs = home.starters;
  const as = away.starters;
  const events = [
    { min: 0, type: 'half', team: '', player: '', detail: 'Kick Off', source: 'mock' },
    { min: 12, type: 'goal', team: match.home.abbr, player: hs[9].name, assist: hs[7].name, detail: 'Goal', source: 'mock' },
    { min: 23, type: 'yellow', team: match.away.abbr, player: as[5].name, detail: 'Yellow Card', source: 'mock' },
    { min: 31, type: 'corner', team: match.home.abbr, player: '', detail: 'Corner', source: 'mock' },
    { min: 45, type: 'half', team: '', player: '', detail: 'Half Time', source: 'mock' },
    { min: 58, type: 'sub', team: match.home.abbr, player: hs[10].name, assist: home.subs[2].name, detail: 'Substitution', source: 'mock' },
    { min: 66, type: 'goal', team: match.away.abbr, player: as[10].name, assist: as[8].name, detail: 'Goal', source: 'mock' },
    { min: 74, type: 'red', team: match.away.abbr, player: as[3].name, detail: 'Red Card', source: 'mock' },
    { min: 80, type: 'foul', team: match.home.abbr, player: '', detail: 'Foul', source: 'mock' },
  ].filter((e) => e.min <= (match.minute || 90) || e.type === 'half');
  return {
    events,
    lineups: [home, away],
    stats: [
      { label: 'Possession %', home: `${s.possessionHome ?? 50}%`, away: `${s.possessionAway ?? 50}%` },
      { label: 'Shots', home: s.shotsHome ?? 0, away: s.shotsAway ?? 0 },
      { label: 'Shots on Target', home: Math.ceil((s.shotsHome ?? 0) / 2), away: Math.ceil((s.shotsAway ?? 0) / 2) },
      { label: 'Corners', home: 4, away: 3 },
      { label: 'Fouls', home: 8, away: 11 },
    ],
    predictor: { home: 48, draw: 27, away: 25 },
    info: {
      venue: match.venue || 'Demo Stadium',
      city: 'Demo City',
      attendance: 68000,
      referee: 'A. Referee',
      weather: '22° Clear',
    },
    table: [
      {
        name: 'Group X (DEMO)',
        rows: [
          { rank: 1, team: match.home.name, abbr: match.home.abbr, mp: 2, w: 1, d: 1, l: 0, gf: 4, ga: 2, gd: '+2', pts: 4 },
          { rank: 2, team: match.away.name, abbr: match.away.abbr, mp: 2, w: 1, d: 0, l: 1, gf: 3, ga: 3, gd: '0', pts: 3 },
          { rank: 3, team: 'Group Rival A', abbr: 'GRA', mp: 2, w: 1, d: 0, l: 1, gf: 2, ga: 3, gd: '-1', pts: 3 },
          { rank: 4, team: 'Group Rival B', abbr: 'GRB', mp: 2, w: 0, d: 1, l: 1, gf: 1, ga: 2, gd: '-1', pts: 1 },
        ],
      },
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
