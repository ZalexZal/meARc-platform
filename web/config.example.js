// Copy this file to config.local.js and fill in your own values.
// config.local.js is gitignored.
//
// Both values come from the Supabase dashboard: Project Settings -> API.
// The anon key is meant to be public and shipped in clients; RLS is what
// protects the data. Never put the service_role key in here.

window.AR_TRAIL_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT-REF.supabase.co",
  SUPABASE_ANON_KEY: "eyJ...",

  // The world to insert markers into. A trail's id: the id column of the worlds table.
  WORLD_ID: "PASTE-THE-WORLD-UUID-HERE",

  // Where the map opens. Yambol town centre.
  START_LAT: 42.4842,
  START_LNG: 26.5035,
  START_ZOOM: 16
};
