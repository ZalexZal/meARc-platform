// One-off back-fill for the classification build.
//   node --experimental-strip-types tools/backfill-classification.ts [--dry]
// Category: freefall/ctf trails still at 'other' become 'education'.
// City: worlds with city null and at least one stop get their city from the first stop
// (lowest step, else oldest) via Nominatim, 1.1 s between trails. city_auto stays true.
// Lab-test worlds are skipped. Prints counts only, never user data.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cityAt } from '../web/src/lib/place.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../web/package.json'));
const pg = require('pg');

const dry = process.argv.includes('--dry');
const url = fs.readFileSync(`${process.env.HOME}/keys/supabase-db-url.txt`, 'utf8').trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const notLab = `not exists (select 1 from auth.users u where u.id = w.owner_id and u.email like 'lab-test-%@example.com')`;

const db = new pg.Client({ connectionString: url });
await db.connect();
try {
  const total = (await db.query('select count(*)::int n from worlds')).rows[0].n;

  // Category
  const catSql = `from worlds w where w.category = 'other' and w.mode in ('freefall','ctf') and ${notLab}`;
  let categorised: number;
  if (dry) categorised = (await db.query(`select count(*)::int n ${catSql}`)).rows[0].n;
  else categorised = (await db.query(`update worlds set category = 'education' where id in (select w.id ${catSql})`)).rowCount;

  // City
  const todo = (await db.query(`
    select w.id,
      (select extensions.st_y(m.location::extensions.geometry) from markers m where m.world_id = w.id
         order by m.step nulls last, m.created_at limit 1) lat,
      (select extensions.st_x(m.location::extensions.geometry) from markers m where m.world_id = w.id
         order by m.step nulls last, m.created_at limit 1) lng
    from worlds w
    where w.city is null and ${notLab}
      and exists (select 1 from markers m where m.world_id = w.id)`)).rows;

  let found = 0, notFound = 0;
  for (let i = 0; i < todo.length; i++) {
    const { id, lat, lng } = todo[i];
    const city = lat == null || lng == null ? null : await cityAt(lat, lng);
    if (city) {
      found++;
      if (!dry) await db.query('update worlds set city = $1::jsonb where id = $2 and city is null', [JSON.stringify(city), id]);
    } else notFound++;
    if (i < todo.length - 1) await sleep(1100);
  }

  console.log(`${dry ? 'DRY RUN. ' : ''}worlds total ${total}, with a stop and no city ${todo.length}`);
  console.log(`${categorised} categorised, ${found} cities found, ${notFound} not found`);
} finally {
  await db.end();
}
