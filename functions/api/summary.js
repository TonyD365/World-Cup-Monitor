// functions/api/summary.js — Cloudflare Pages Function.
// GET /api/summary?id=<matchId> -> richer event feed for one match.
// Currently sourced from ESPN's summary endpoint (numeric event ids).
import { fetchEspnSummary } from '../../shared/sources.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const empty = { events: [], lineups: [], stats: [], table: [] };
  if (!id || !/^\d+$/.test(id)) {
    return new Response(JSON.stringify(empty), { headers: CORS });
  }
  // Debug passthrough: ?raw=1 returns the raw ESPN summary JSON so the exact
  // upstream structure can be inspected when a tab looks wrong.
  if (url.searchParams.get('raw') === '1') {
    try {
      const res = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${encodeURIComponent(id)}`,
        { headers: { Accept: 'application/json' } }
      );
      const text = await res.text();
      return new Response(text, { headers: CORS });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { headers: CORS });
    }
  }
  const detail = (await fetchEspnSummary(fetch, id).catch(() => null)) || empty;
  return new Response(JSON.stringify(detail), { headers: CORS });
}
