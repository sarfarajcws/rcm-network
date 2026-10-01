/**
 * Recreates the test database schema from the committed Prisma migrations
 * (the same SQL `prisma migrate deploy` runs in production).
 * Set TEST_DATABASE_URL to point at a disposable database.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/rcm_test';
  if (!/test/i.test(url)) throw new Error('Refusing to reset a database whose URL does not contain "test"');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  const dir = path.resolve('prisma/migrations');
  const migrations = fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory()).sort();
  for (const m of migrations) {
    await client.query(fs.readFileSync(path.join(dir, m, 'migration.sql'), 'utf8'));
  }
  await client.end();
}
