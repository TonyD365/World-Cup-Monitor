// shared/core.js
// Shared, dependency-free ES module used by BOTH the browser frontend
// (imported as ../shared/core.js) and the Cloudflare Pages Functions
// (imported as ../../shared/core.js). Keep it framework-free.
//
// It defines:
//   - SOURCE_PRIORITY        : authority order (higher index = more authoritative)
//   - the normalized Match shape (documented below)
//   - mergeMatches()         : multi-source, field-by-field, official-first merge
//   - small helpers for identity + normalization

// Higher number == higher authority. FIFA official wins over everything.
export const SOURCE_PRIORITY = {
  mock: 0,
  openfootball: 1,
  espn: 2,
  fifa: 3,
};

// Normalized Match shape (all sources adapt to this):
// Match {
//   id: string,                // stable-ish id (source id or synthesized identity)
//   comp: string,              // competition label
//   home: { name, abbr, flag, score },
//   away: { name, abbr, flag, score },
//   status: 'pre' | 'live' | 'ft',
//   minute: number|null,       // clock minute when live
//   period: string|null,       // e.g. '1H','2H','HT','ET'
//   venue: string|null,
//   kickoff: string|null,      // ISO date
//   events: [{ min, type, team, player, detail, source }],
//   stats: { possessionHome, possessionAway, shotsHome, shotsAway, ... },
//   sources: string[],         // which sources contributed
//   fieldSources: {},          // field -> winning source
//   conflicts: [{ field, chosen, chosenSource, others:[{source,value}] }],
// }

export function emptyTeam() {
  return { name: '', abbr: '', flag: '', score: null };
}

export function normalizeAbbr(s) {
  return (s || '').toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
}

// Build a stable identity for a match so the same fixture from different
// sources lines up: sorted team abbreviations + kickoff calendar day.
export function matchIdentity(m) {
  // Prefer the full team NAME (more consistent across sources) over the
  // abbreviation, which differs per source (e.g. ESPN "CUW" vs FIFA "Curaçao").
  const a = normalizeAbbr(m.home && m.home.name) || normalizeAbbr(m.home && m.home.abbr);
  const b = normalizeAbbr(m.away && m.away.name) || normalizeAbbr(m.away && m.away.abbr);
  const teams = [a, b].sort().join('-');
  let day = '';
  if (m.kickoff) {
    const d = new Date(m.kickoff);
    if (!isNaN(d)) day = d.toISOString().slice(0, 10);
  }
  return `${teams}@${day}`;
}

function priority(source) {
  return SOURCE_PRIORITY[source] != null ? SOURCE_PRIORITY[source] : -1;
}

// Pick the value for one field from a list of {source, value} candidates,
// choosing the highest-priority source that actually has a non-empty value.
// Records a conflict when sources genuinely disagree.
function pickField(field, candidates, conflicts, fieldSources) {
  const present = candidates.filter(
    (c) => c.value !== null && c.value !== undefined && c.value !== ''
  );
  if (!present.length) return undefined;

  present.sort((x, y) => priority(y.source) - priority(x.source));
  const winner = present[0];
  fieldSources[field] = winner.source;

  const disagreeing = present.filter(
    (c) => c.source !== winner.source && String(c.value) !== String(winner.value)
  );
  if (disagreeing.length) {
    conflicts.push({
      field,
      chosen: winner.value,
      chosenSource: winner.source,
      others: disagreeing.map((c) => ({ source: c.source, value: c.value })),
    });
  }
  return winner.value;
}

function mergeTeam(field, group, conflicts, fieldSources) {
  const team = emptyTeam();
  for (const key of ['name', 'abbr', 'flag', 'score']) {
    const v = pickField(
      `${field}.${key}`,
      group.map((m) => ({ source: m._source, value: m[field] ? m[field][key] : undefined })),
      conflicts,
      fieldSources
    );
    if (v !== undefined) team[key] = v;
  }
  return team;
}

// Merge a group of normalized matches (same identity, different sources) into one.
function mergeGroup(group) {
  const conflicts = [];
  const fieldSources = {};
  const out = {
    id: '',
    comp: '',
    home: emptyTeam(),
    away: emptyTeam(),
    status: 'pre',
    minute: null,
    period: null,
    venue: null,
    kickoff: null,
    events: [],
    stats: {},
    sources: [],
    fieldSources,
    conflicts,
  };

  out.sources = [...new Set(group.map((m) => m._source))];

  // id: prefer the most authoritative source's id, fall back to identity.
  const idPick = pickField(
    'id',
    group.map((m) => ({ source: m._source, value: m.id })),
    [],
    {}
  );
  out.id = idPick || matchIdentity(group[0]);

  // Keep the ESPN numeric id separately: ESPN's summary endpoint (lineups,
  // stats, full commentary, table) is keyed by it. When FIFA wins the primary
  // `id` (a GUID), we'd otherwise lose the ability to fetch match detail.
  const espn = group.find((m) => m._source === 'espn');
  out.espnId = espn && /^\d+$/.test(String(espn.id || '')) ? String(espn.id) : null;

  for (const f of ['comp', 'status', 'minute', 'period', 'venue', 'kickoff']) {
    const v = pickField(
      f,
      group.map((m) => ({ source: m._source, value: m[f] })),
      conflicts,
      fieldSources
    );
    if (v !== undefined && v !== null) out[f] = v;
  }

  out.home = mergeTeam('home', group, conflicts, fieldSources);
  out.away = mergeTeam('away', group, conflicts, fieldSources);

  // Stats: take the whole stats object from the highest-priority source that has any.
  const withStats = group
    .filter((m) => m.stats && Object.keys(m.stats).length)
    .sort((x, y) => priority(y._source) - priority(x._source));
  if (withStats.length) {
    out.stats = withStats[0].stats;
    fieldSources.stats = withStats[0]._source;
  }

  // Events: union across all sources, de-duplicated by (min|type|player).
  const seen = new Set();
  const events = [];
  for (const m of group.sort((x, y) => priority(y._source) - priority(x._source))) {
    for (const ev of m.events || []) {
      const key = `${ev.min}|${ev.type}|${normalizeAbbr(ev.player || '')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({ ...ev, source: ev.source || m._source });
    }
  }
  events.sort((a, b) => (a.min || 0) - (b.min || 0));
  out.events = events;

  return out;
}

// Public API: merge several arrays of normalized matches, each tagged with its
// source name, into one official-first list.
// inputs: [{ source: 'espn', matches: Match[] }, ...]
export function mergeMatches(inputs) {
  const groups = new Map();
  for (const { source, matches } of inputs) {
    for (const m of matches || []) {
      const tagged = { ...m, _source: source };
      const key = matchIdentity(tagged);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(tagged);
    }
  }
  const merged = [...groups.values()].map(mergeGroup);
  // Live first, then by kickoff.
  const rank = { live: 0, pre: 1, ft: 2 };
  merged.sort((a, b) => {
    const r = (rank[a.status] ?? 3) - (rank[b.status] ?? 3);
    if (r) return r;
    return String(a.kickoff || '').localeCompare(String(b.kickoff || ''));
  });
  return merged;
}

// ---- selection helpers (shared by the frontend) ---------------------------
export function isLive(m) {
  return m.status === 'live';
}
export function hasScore(m) {
  return (m.home && m.home.score != null) || (m.away && m.away.score != null);
}
function kickoffTime(m) {
  const t = m.kickoff ? Date.parse(m.kickoff) : NaN;
  return isNaN(t) ? 0 : t;
}

// Build the match list AND choose a sensible default. Always keeps finished
// matches visible alongside live + upcoming (the strip is sorted by kick-off).
// Categorize by STATUS, not by score: ESPN reports scheduled matches as 0-0,
// so a score-based check wrongly treated upcoming games as finished results.
// Default selection: live > most recent finished > next upcoming.
export function buildSelector(matches) {
  const live = matches.filter((m) => m.status === 'live').sort((a, b) => kickoffTime(b) - kickoffTime(a));
  const results = matches.filter((m) => m.status === 'ft').sort((a, b) => kickoffTime(b) - kickoffTime(a));
  const upcoming = matches.filter((m) => m.status !== 'live' && m.status !== 'ft').sort((a, b) => kickoffTime(a) - kickoffTime(b));

  const seen = new Set();
  const list = [];
  for (const m of [...results.slice(0, 30), ...live, ...upcoming.slice(0, 30)]) {
    if (!seen.has(m.id)) { seen.add(m.id); list.push(m); }
  }
  const final = list.length ? list : matches;
  const defaultId = (live[0] && live[0].id) || (results[0] && results[0].id) ||
    (upcoming[0] && upcoming[0].id) || (final[0] && final[0].id) || null;
  return { list: final, defaultId };
}

// Which source is currently the authoritative one across a merged list.
export function effectiveAuthority(merged) {
  const present = new Set();
  for (const m of merged) for (const s of m.sources) present.add(s);
  let best = null;
  for (const s of present) {
    if (best === null || priority(s) > priority(best)) best = s;
  }
  return best || 'mock';
}
