import 'dotenv/config';
import { config } from './config.js';
import { prisma } from './db.js';
import { buildApp } from './buildApp.js';
import { attachSocketIO } from './realtime.js';
import { startDueSoonJob } from './jobs/dueSoon.js';

const app = await buildApp();

const shutdown = async () => {
  app.log.info('shutting down…');
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await app.listen({ port: config.PORT, host: config.HOST });
  attachSocketIO(app, config.WEB_ORIGIN);
  // Background jobs — run in this same process. Single-instance deploy so
  // no need for a separate worker yet.
  startDueSoonJob(app.log);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
