// js/data.js — frontend data orchestration (pure static, no server proxy).
// Strategy (defensive):
//   1. Fetch sources directly from the browser: ESPN (live) + openfootball
//      (schedule). FIFA official is attempted only if enabled (usually blocked
//      by CORS in the browser, hence off by default).
//   2. If everything is empty/unreachable, fall back to mock DEMO data.
import { CONFIG } from './config.js';
import { mergeMatches, effectiveAuthority } from '../shared/core.js';
import { fetchEspn, fetchOpenfootball, fetchFifa, fetchEspnSummary, fetchEspnPlays, fetchOpenfootballStandings } from '../shared/sources.js';
import { mockMatches, mockDetail } from '../shared/mock.js';

// Resolve a real player photo by name via TheSportsDB (free key, CORS-ok) when
// ESPN has no headshot. Cached per session; '' means "looked up, none found".
const _photoCache = new Map();
const _photoPending = new Map();
const _pnorm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

export async function resolvePlayerPhoto(name) {
  const k = _pnorm(name);
  if (!k) return '';
  if (_photoCache.has(k)) return _photoCache.get(k);
  if (_photoPending.has(k)) return _photoPending.get(k);
  const p = (async () => {
    let url = '';
    try {
      const res = await fetch(`https://www.thesportsdb.com/api/v1/json/123/searchplayers.php?p=${encodeURIComponent(name)}`);
      if (res.ok) {
        const j = await res.json();
        const pl = j && Array.isArray(j.player) && j.player[0];
        if (pl) url = pl.strCutout || pl.strThumb || '';
      }
    } catch (_) { /* CORS/network — fall back to avatar */ }
    _photoCache.set(k, url);
    _photoPending.delete(k);
    return url;
  })();
  _photoPending.set(k, p);
  return p;
}

let _standings = null;
let _standingsAt = 0;
export async function loadStandings() {
  const now = Date.now();
  if (_standings && now - _standingsAt < 5 * 60 * 1000) return _standings;
  const g = await fetchOpenfootballStandings(fetch).catch(() => null);
  if (g && g.length) { _standings = g; _standingsAt = now; }
  return _standings || [];
}

// Health of each source for the status LEDs.
export const health = { fifa: 'down', espn: 'down', openfootball: 'down', mock: 'down' };

async function tryDirect() {
  const tasks = [fetchEspn(fetch).catch(() => []), fetchOpenfootball(fetch).catch(() => [])];
  // FIFA official is CORS-blocked in the browser for most users; opt-in only.
  tasks.push(CONFIG.TRY_FIFA_DIRECT ? fetchFifa(fetch).catch(() => []) : Promise.resolve([]));
  const [espn, of, fifa] = await Promise.all(tasks);

  health.espn = espn.length ? 'up' : 'down';
  health.openfootball = of.length ? 'up' : 'down';
  health.fifa = fifa.length ? 'up' : 'down';

  const inputs = [
    { source: 'fifa', matches: fifa },
    { source: 'espn', matches: espn },
    { source: 'openfootball', matches: of },
  ].filter((i) => i.matches.length);
  if (!inputs.length) return null;
  return mergeMatches(inputs);
}

// Returns { matches, authority, demo }.
export async function loadMatches() {
  for (const k of Object.keys(health)) health[k] = 'down';

  let matches = await tryDirect();

  let demo = false;
  if (!matches || !matches.length) {
    matches = mergeMatches([{ source: 'mock', matches: mockMatches() }]);
    health.mock = 'up';
    demo = true;
  }
  return { matches, authority: effectiveAuthority(matches), demo };
}

// Short cache for the heavy plays feed so 1s polling doesn't hammer the API.
const _playsCache = new Map(); // eid -> { at, data }
async function cachedPlays(eid) {
  const now = Date.now();
  const c = _playsCache.get(eid);
  if (c && now - c.at < 2000) return c.data;
  const d = await fetchEspnPlays(fetch, eid).catch(() => null);
  _playsCache.set(eid, { at: now, data: d });
  return d;
}

// Load full detail for a match: { events, lineups, stats, table } directly from
// ESPN's summary endpoint (keyed by the ESPN numeric id). Returns null if none.
export async function loadDetail(match) {
  if (!match) return null;
  if (match.sources.includes('mock')) return mockDetail(match);
  const eid = match.espnId || (/^\d+$/.test(String(match.id)) ? String(match.id) : null);
  if (!eid) return null;
  const [detail, plays] = await Promise.all([
    fetchEspnSummary(fetch, eid).catch(() => null),
    cachedPlays(eid), // ball position + shot map (may be CORS-blocked)
  ]);
  if (!detail && !plays) return null;
  const out = detail || { events: [], lineups: [], stats: [], table: [] };
  out.plays = plays;
  return out;
}
