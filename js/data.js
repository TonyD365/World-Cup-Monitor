// js/data.js — frontend data orchestration (pure static, no server proxy).
// Strategy (defensive):
//   1. Fetch sources directly from the browser: ESPN (live) + openfootball
//      (schedule). FIFA official is attempted only if enabled (usually blocked
//      by CORS in the browser, hence off by default).
//   2. If everything is empty/unreachable, fall back to mock DEMO data.
import { CONFIG } from './config.js';
import { mergeMatches, effectiveAuthority } from '../shared/core.js';
import { fetchEspn, fetchFifa, fetchEspnSummary, fetchEspnPredictor, fetchOpenfootballStandings, fetchOpenfootballBracket } from '../shared/sources.js';
import { mockMatches, mockDetail } from '../shared/mock.js';

// Resolve a real player photo by name, trying several keyless, CORS-friendly
// sources in turn. Cached per session ('' = looked up, none found).
const _photoCache = new Map();
const _photoPending = new Map();
const _pnorm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

// 1) TheSportsDB (free key 123) — soccer player cutouts/thumbs.
async function photoFromSportsDB(name) {
  try {
    const res = await fetch(`https://www.thesportsdb.com/api/v1/json/123/searchplayers.php?p=${encodeURIComponent(name)}`);
    if (res.ok) {
      const j = await res.json();
      const pl = j && Array.isArray(j.player) && j.player[0];
      if (pl) return pl.strCutout || pl.strThumb || '';
    }
  } catch (_) { /* ignore */ }
  return '';
}

// 2) Wikipedia page image (action API with origin=* for CORS). Broad coverage.
async function photoFromWikipedia(name) {
  for (const q of [`${name} (footballer)`, name]) {
    try {
      const u = `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1&prop=pageimages&piprop=thumbnail&pithumbsize=200&titles=${encodeURIComponent(q)}`;
      const res = await fetch(u);
      if (!res.ok) continue;
      const j = await res.json();
      const pages = j && j.query && j.query.pages;
      if (pages) {
        for (const id of Object.keys(pages)) {
          const th = pages[id] && pages[id].thumbnail && pages[id].thumbnail.source;
          if (th) return th;
        }
      }
    } catch (_) { /* ignore */ }
  }
  return '';
}

export async function resolvePlayerPhoto(name) {
  const k = _pnorm(name);
  if (!k) return '';
  if (_photoCache.has(k)) return _photoCache.get(k);
  if (_photoPending.has(k)) return _photoPending.get(k);
  const p = (async () => {
    let url = await photoFromSportsDB(name);
    if (!url) url = await photoFromWikipedia(name);
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
  if (_standings && now - _standingsAt < 5 * 60 * 1000) { health.openfootball = 'up'; return _standings; }
  const g = await fetchOpenfootballStandings(fetch).catch(() => null);
  if (g && g.length) { _standings = g; _standingsAt = now; health.openfootball = 'up'; }
  return _standings || [];
}

// Knockout bracket from openfootball, cached.
let _bracket = null;
let _bracketAt = 0;
export async function loadBracket() {
  const now = Date.now();
  if (_bracket && now - _bracketAt < 5 * 60 * 1000) { if (_bracket.length) health.openfootball = 'up'; return _bracket; }
  const b = await fetchOpenfootballBracket(fetch).catch(() => null);
  if (b) { _bracket = b; _bracketAt = now; if (b.length) health.openfootball = 'up'; }
  return _bracket || [];
}

// Health of each source for the status LEDs.
export const health = { fifa: 'down', espn: 'down', openfootball: 'down', mock: 'down' };

async function tryDirect() {
  // ESPN is the sole live match source. openfootball is intentionally NOT
  // merged into the timeline anymore — its team naming diverged from ESPN's
  // (e.g. "DR Congo" vs "Congo DR") and produced duplicate cards. It is still
  // used, separately, for the group standings and the knockout bracket
  // (loadStandings / loadBracket), which drive its health LED.
  const tasks = [fetchEspn(fetch).catch(() => [])];
  // FIFA official is CORS-blocked in the browser for most users; opt-in only.
  tasks.push(CONFIG.TRY_FIFA_DIRECT ? fetchFifa(fetch).catch(() => []) : Promise.resolve([]));
  const [espn, fifa] = await Promise.all(tasks);

  health.espn = espn.length ? 'up' : 'down';
  health.fifa = fifa.length ? 'up' : 'down';

  const inputs = [
    { source: 'fifa', matches: fifa },
    { source: 'espn', matches: espn },
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

// Load full detail for a match: { events, lineups, stats, table } from ESPN's
// summary endpoint (keyed by the ESPN numeric id). Returns null if none.
export async function loadDetail(match) {
  if (!match) return null;
  if (match.sources.includes('mock')) return mockDetail(match);
  const eid = match.espnId || (/^\d+$/.test(String(match.id)) ? String(match.id) : null);
  if (!eid) return null;
  const [detail, pred] = await Promise.all([
    fetchEspnSummary(fetch, eid).catch(() => null),
    cachedPredictor(eid), // real win probability (ESPN core predictor)
  ]);
  if (!detail) return null;
  if (pred) detail.predictor = pred; // prefer the dedicated predictor endpoint
  return detail;
}

// Win probability cached briefly (changes slowly).
const _predCache = new Map(); // eid -> { at, data }
async function cachedPredictor(eid) {
  const now = Date.now();
  const c = _predCache.get(eid);
  if (c && now - c.at < 20000) return c.data;
  const d = await fetchEspnPredictor(fetch, eid).catch(() => null);
  _predCache.set(eid, { at: now, data: d });
  return d;
}
