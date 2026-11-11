// Applies supabase/migrations/0072_public_instant.sql in one transaction.
// Prints "applied", or the error (and the transaction is rolled back).
//   node tools/apply-0072.mjs        (from noit-platform; web/node_modules has pg)
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../web/package.json'));
const pg = require('pg');
const DBURL = fs.readFileSync(`${process.env.HOME}/keys/supabase-db-url.txt`, 'utf8').trim();
const file = fs.readFileSync(path.join(here, '../supabase/migrations/0072_public_instant.sql'), 'utf8');

const c = new pg.Client({ connectionString: DBURL });
let ok = false;
try {
  await c.connect();
  // The file carries its own begin/commit; one multi-statement query is a
  // single implicit transaction, so a failure anywhere undoes everything.
  await c.query(file);
  ok = true;
} catch (e) {
  try { await c.query('rollback'); } catch { /* connection may be gone */ }
  console.log(`error: ${e.message}${e.code ? ` (${e.code})` : ''}`);
} finally {
  await c.end().catch(() => {});
}
if (ok) console.log('applied');
process.exit(ok ? 0 : 1);
