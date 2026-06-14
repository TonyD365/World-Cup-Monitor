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
  const id = new URL(request.url).searchParams.get('id');
  if (!id || !/^\d+$/.test(id)) {
    return new Response(JSON.stringify({ events: [] }), { headers: CORS });
  }
  const events = (await fetchEspnSummary(fetch, id).catch(() => null)) || [];
  return new Response(JSON.stringify({ events }), { headers: CORS });
}
