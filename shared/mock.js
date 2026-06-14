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

export function mockMatches() {
  return DEMO_MATCHES.map((d) => {
    const minute = liveMinute(d.seed);
    const events = [];
    let hs = 0;
    let as = 0;
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
