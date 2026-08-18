import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type Database from 'better-sqlite3';
import type { HealthInfo } from '../../shared/index.js';

export function registerHealthRoutes(app: FastifyInstance, deps: { db: Database.Database }) {
  app.get('/api/health', async (_req: FastifyRequest, _reply: FastifyReply): Promise<HealthInfo> => {
    let dbOk = true;
    let schemaVersion = 0;
    try {
      schemaVersion = deps.db.pragma('user_version', { simple: true }) as number;
    } catch {
      dbOk = false;
    }
    return { ok: true, db: dbOk, schemaVersion, time: new Date().toISOString() };
  });
}
