// js/data.js — frontend data orchestration.
// Strategy (defensive, official-first):
//   1. Try the Pages Function proxy /api/matches (aggregates FIFA+ESPN+openfootball server-side).
//   2. If the proxy is absent/fails, fetch sources directly client-side.
//   3. If everything is empty/unreachable, fall back to mock DEMO data.
import { CONFIG } from './config.js';
import { mergeMatches, effectiveAuthority } from '../shared/core.js';
import { fetchEspn, fetchOpenfootball, fetchFifa, fetchEspnSummary } from '../shared/sources.js';
import { mockMatches } from '../shared/mock.js';

// Health of each source for the status LEDs.
export const health = { fifa: 'down', espn: 'down', openfootball: 'down', mock: 'down', proxy: 'down' };

async function tryProxy() {
  try {
    const res = await fetch(CONFIG.API_MATCHES, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || !Array.isArray(json.matches)) return null;
    health.proxy = 'up';
    if (json.health) Object.assign(health, json.health);
    return json.matches;
  } catch (_) {
    return null;
  }
}

async function tryDirect() {
  const [espn, of, fifa] = await Promise.all([
    fetchEspn(fetch).catch(() => []),
    fetchOpenfootball(fetch).catch(() => []),
    fetchFifa(fetch).catch(() => []), // usually CORS-blocked in browser; best-effort.
  ]);
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
  // Reset live-source flags (proxy may overwrite via health payload).
  for (const k of Object.keys(health)) health[k] = 'down';

  let matches = await tryProxy();
  if (!matches) matches = await tryDirect();

  let demo = false;
  if (!matches || !matches.length) {
    matches = mergeMatches([{ source: 'mock', matches: mockMatches() }]);
    health.mock = 'up';
    demo = true;
  }
  return { matches, authority: effectiveAuthority(matches), demo };
}

// Enrich a single match's events via summary endpoints (proxy first, then direct ESPN).
export async function loadSummaryEvents(match) {
  if (!match || match.sources.includes('mock')) return null;
  // Proxy summary.
  try {
    const res = await fetch(`${CONFIG.API_SUMMARY}?id=${encodeURIComponent(match.id)}`);
    if (res.ok) {
      const json = await res.json();
      if (json && Array.isArray(json.events)) return json.events;
    }
  } catch (_) {
    /* fall through */
  }
  // Direct ESPN summary (only meaningful for ESPN numeric ids).
  if (match.sources.includes('espn') && /^\d+$/.test(match.id)) {
    const events = await fetchEspnSummary(fetch, match.id).catch(() => null);
    if (events && events.length) return events;
  }
  return null;
}
