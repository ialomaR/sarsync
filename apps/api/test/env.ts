// Loaded before each test file. Overrides the production .env with .env.test
// so prisma + config see the test DB / test secrets.
import 'dotenv/config';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.test'), override: true });
