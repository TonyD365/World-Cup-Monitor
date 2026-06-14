// js/config.js — frontend runtime configuration.
export const CONFIG = {
  // Refresh cadence for the selected match / match list.
  POLL_INTERVAL: 5000,

  // Proxy endpoints served by the Cloudflare Pages Functions (functions/api/*).
  // Tried first; if they 404 (pure static host / local file), we fall back to
  // direct client-side fetches.
  API_MATCHES: '/api/matches',
  API_SUMMARY: '/api/summary',

  // Direct client-side fallback endpoints (no key). CORS is not guaranteed for
  // all of these in the browser; the proxy is the reliable path.
  ESPN_SCOREBOARD:
    'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard',
  ESPN_SUMMARY:
    'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=',

  // Authority order, mirrored from shared/core.js for display purposes.
  OFFICIAL_LABEL: 'FIFA',
};
