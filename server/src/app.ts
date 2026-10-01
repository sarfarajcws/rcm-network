import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { dashboardRouter, metaRouter } from './modules/dashboard/dashboard.routes.js';
import { importRouter } from './modules/import/import.routes.js';
import { joiningsRouter } from './modules/joinings/joinings.routes.js';
import { membersRouter } from './modules/members/members.routes.js';
import { pvRouter } from './modules/pv/pv.routes.js';
import { treeRouter } from './modules/tree/tree.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Render terminates TLS in front of the app
  app.set('query parser', 'simple');

  app.use(helmet());
  app.use(
    cors({
      origin(origin, cb) {
        // Non-browser clients (curl, health checks) send no Origin header.
        if (!origin || env.corsOrigins.includes(origin)) return cb(null, true);
        cb(null, false);
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86400,
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', async (_req, res) => {
    let db = 'ok';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'unreachable';
    }
    res.status(db === 'ok' ? 200 : 503).json({ success: db === 'ok', data: { status: 'ok', db, time: new Date().toISOString() } });
  });

  app.use('/api/auth', authRouter);

  const api = express.Router();
  api.use(requireAuth);
  api.use('/dashboard', dashboardRouter);
  api.use('/meta', metaRouter);
  api.use('/members', membersRouter);
  api.use('/tree', treeRouter);
  api.use('/pv', pvRouter);
  api.use('/joinings', joiningsRouter);
  api.use('/import', importRouter);
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
