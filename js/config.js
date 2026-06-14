// js/config.js — frontend runtime configuration.
export const CONFIG = {
  // Refresh cadence for the match list / selected match.
  POLL_INTERVAL: 1000,

  // Pure static deploy: data is fetched directly from the browser. ESPN and
  // openfootball send permissive CORS headers; FIFA official usually does not,
  // so it's opt-in (most browsers will block it).
  TRY_FIFA_DIRECT: false,

  // Authoritative source label shown in the footer (highest available source).
  OFFICIAL_LABEL: 'ESPN',
};
