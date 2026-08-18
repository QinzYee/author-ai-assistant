import path from 'node:path';
import fs from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import type Database from 'better-sqlite3';
import type { LlmGateway } from './llm/index.js';
import { createNovelRepository } from './db/repositories/novels.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerNovelRoutes } from './routes/novels.js';

export interface AppDeps {
  db: Database.Database;
  gateway: LlmGateway;
}

/** 构建 Fastify 应用（不含 listen） */
export function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  // 依赖注入：repositories
  const novels = createNovelRepository(deps.db);

  // 路由
  registerHealthRoutes(app, { db: deps.db });
  registerNovelRoutes(app, { novels });

  // 生产环境托管前端构建产物（dist/client）
  const clientDist = path.resolve(process.cwd(), 'dist', 'client');
  if (fs.existsSync(clientDist)) {
    app.register(fastifyStatic, { root: clientDist });
  }

  return app;
}
