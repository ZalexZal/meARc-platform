// Puts the AI keys into Supabase Vault for the Edge Functions (7 Nov 2026).
//
//   node tools/set-ai-keys.mjs           (from noit-platform; web/node_modules has pg)
//
//   ~/keys/gemini-api-key.txt  -> Vault 'gemini_api_key'  (translate function)
//   ~/keys/hf-token.txt        -> Vault 'hf_token'        (ai3d function, photo -> model)
//
// The database URL comes from ~/keys/supabase-db-url.txt. A missing file is
// skipped. Prints nothing secret: only which keys were stored or replaced.
// Run it again with a new key to rotate.
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../web/package.json', import.meta.url));
const { Client } = require('pg');
const file = (f) => `${os.homedir()}/keys/${f}`;

const KEYS = [
  { file: 'gemini-api-key.txt', name: 'gemini_api_key', what: 'Gemini key for the translate Edge Function', shape: /^(AIza[0-9A-Za-z_-]{35}|AQ\.[0-9A-Za-z_-]{40,})$/ },  // old (39) and new (AQ., ~53) Google key formats
  { file: 'hf-token.txt', name: 'hf_token', what: 'Hugging Face token for the ai3d Edge Function', shape: /^hf_[0-9A-Za-z]{20,}$/ },
];

const db = new Client({ connectionString: fs.readFileSync(file('supabase-db-url.txt'), 'utf8').trim() });
await db.connect();
for (const k of KEYS) {
  if (!fs.existsSync(file(k.file))) { console.log(`skipped ${k.name}: no ~/keys/${k.file}`); continue; }
  const value = fs.readFileSync(file(k.file), 'utf8').replace(/\s+/g, '');
  if (!k.shape.test(value)) { console.log(`skipped ${k.name}: ~/keys/${k.file} does not look like one`); continue; }
  const { rows } = await db.query('select id from vault.secrets where name = $1', [k.name]);
  if (rows.length) {
    await db.query('select vault.update_secret($1, $2)', [rows[0].id, value]);
    console.log(`replaced ${k.name}`);
  } else {
    await db.query('select vault.create_secret($1, $2, $3)', [value, k.name, k.what]);
    console.log(`stored ${k.name}`);
  }
}
await db.end();
