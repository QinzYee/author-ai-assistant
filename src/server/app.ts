import path from 'node:path';
import fs from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import type Database from 'better-sqlite3';
import type { LlmGateway } from './llm/index.js';
import {
  createNovelRepository,
  createAssetRepository,
  createOutlineRepository,
  createResearchRepository,
} from './db/index.js';
import { createAssetService } from './modules/assets/index.js';
import { createOutlineService } from './modules/outline/index.js';
import { createResearchService } from './modules/research/index.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerNovelRoutes } from './routes/novels.js';
import { registerAssetRoutes } from './routes/assets.js';
import { registerOutlineRoutes } from './routes/outline.js';
import { registerResearchRoutes } from './routes/research.js';

export interface AppDeps {
  db: Database.Database;
  gateway: LlmGateway;
}

/** 构建 Fastify 应用（不含 listen） */
export function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  // 依赖注入：repositories → services
  const novels = createNovelRepository(deps.db);
  const assets = createAssetService({ repo: createAssetRepository(deps.db) });
  const outline = createOutlineService({
    repo: createOutlineRepository(deps.db),
    assets: createAssetRepository(deps.db),
    novels,
    gateway: deps.gateway,
  });
  const research = createResearchService({
    repo: createResearchRepository(deps.db),
    novels,
    gateway: deps.gateway,
    tavilyApiKey: process.env.TAVILY_API_KEY,
  });

  // 路由
  registerHealthRoutes(app, { db: deps.db });
  registerNovelRoutes(app, { novels });
  registerAssetRoutes(app, { assets });
  registerOutlineRoutes(app, { outline });
  registerResearchRoutes(app, { research });

  // 生产环境托管前端构建产物（dist/client）
  const clientDist = path.resolve(process.cwd(), 'dist', 'client');
  if (fs.existsSync(clientDist)) {
    app.register(fastifyStatic, { root: clientDist });
  }

  return app;
}
