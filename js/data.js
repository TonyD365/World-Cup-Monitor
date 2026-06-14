// js/data.js — frontend data orchestration (pure static, no server proxy).
// Strategy (defensive):
//   1. Fetch sources directly from the browser: ESPN (live) + openfootball
//      (schedule). FIFA official is attempted only if enabled (usually blocked
//      by CORS in the browser, hence off by default).
//   2. If everything is empty/unreachable, fall back to mock DEMO data.
import { CONFIG } from './config.js';
import { mergeMatches, effectiveAuthority } from '../shared/core.js';
import { fetchEspn, fetchOpenfootball, fetchFifa, fetchEspnSummary } from '../shared/sources.js';
import { mockMatches, mockDetail } from '../shared/mock.js';

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

// Load full detail for a match: { events, lineups, stats, table } directly from
// ESPN's summary endpoint (keyed by the ESPN numeric id). Returns null if none.
export async function loadDetail(match) {
  if (!match) return null;
  if (match.sources.includes('mock')) return mockDetail(match);
  const eid = match.espnId || (/^\d+$/.test(String(match.id)) ? String(match.id) : null);
  if (!eid) return null;
  const detail = await fetchEspnSummary(fetch, eid).catch(() => null);
  return detail || null;
}
