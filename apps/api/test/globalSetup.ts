// Runs ONCE before any test file. Applies prisma migrations to the test DB.
// Assumes the test database (sarsync_test) already exists — create it once with:
//   docker exec sarsync-postgres-1 psql -U sarsync -d postgres -c 'CREATE DATABASE sarsync_test'
// or via your local psql client.

import { execSync } from 'node:child_process';
import dotenv from 'dotenv';
import path from 'node:path';

export async function setup() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.test'), override: true });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('TEST DATABASE_URL not set');

  try {
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: url },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not prepare test database. Did you create it?\n` +
      `  docker exec sarsync-postgres-1 psql -U sarsync -d postgres -c "CREATE DATABASE sarsync_test"\n\n` +
      `Original error: ${msg}`
    );
  }
}
