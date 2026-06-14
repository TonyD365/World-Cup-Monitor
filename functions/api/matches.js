// functions/api/matches.js — Cloudflare Pages Function.
// GET /api/matches -> aggregates every no-key source server-side (bypassing
// browser CORS), merges official-first, and returns unified JSON.
import { mergeMatches, effectiveAuthority } from '../../shared/core.js';
import { fetchEspn, fetchFifa, fetchOpenfootball } from '../../shared/sources.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestGet() {
  const [espn, fifa, of] = await Promise.all([
    fetchEspn(fetch).catch(() => []),
    fetchFifa(fetch).catch(() => []),
    fetchOpenfootball(fetch).catch(() => []),
  ]);

  const health = {
    fifa: fifa.length ? 'up' : 'down',
    espn: espn.length ? 'up' : 'down',
    openfootball: of.length ? 'up' : 'down',
    proxy: 'up',
  };

  const inputs = [
    { source: 'fifa', matches: fifa },
    { source: 'espn', matches: espn },
    { source: 'openfootball', matches: of },
  ].filter((i) => i.matches.length);

  const matches = inputs.length ? mergeMatches(inputs) : [];
  const body = {
    matches,
    authority: matches.length ? effectiveAuthority(matches) : 'mock',
    health,
    generatedAt: new Date().toISOString(),
  };
  return new Response(JSON.stringify(body), { headers: CORS });
}
