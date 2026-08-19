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
  createSceneRepository,
  createSummaryRepository,
  createFactCardRepository,
  createConflictRepository,
  createPlotDeviceRepository,
  createChunkRepository,
} from './db/index.js';
import type { SettingsService } from './modules/settings/index.js';
import { createAssetService } from './modules/assets/index.js';
import { createOutlineService } from './modules/outline/index.js';
import { createResearchService } from './modules/research/index.js';
import { createKnowledgeService } from './modules/knowledge/index.js';
import { createMemoryService } from './modules/memory/index.js';
import { createContextAssembler } from './modules/writing/contextAssembler.js';
import { createWritingService } from './modules/writing/index.js';
import { createExportService } from './modules/export/index.js';
import { createPlotDeviceService } from './modules/plotdevices/index.js';
import { createConsistencyService } from './modules/consistency/index.js';
import { createTimelineService } from './modules/timeline/index.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerNovelRoutes } from './routes/novels.js';
import { registerAssetRoutes } from './routes/assets.js';
import { registerOutlineRoutes } from './routes/outline.js';
import { registerResearchRoutes } from './routes/research.js';
import { registerWritingRoutes } from './routes/writing.js';
import { registerExportRoutes } from './routes/export.js';
import { registerQualityRoutes } from './routes/quality.js';
import { registerTimelineRoutes } from './routes/timeline.js';
import { registerSettingsRoutes } from './routes/settings.js';

export interface AppDeps {
  db: Database.Database;
  gateway: LlmGateway;
  settings: SettingsService;
}

/** 构建 Fastify 应用（不含 listen） */
export function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  // 依赖注入：repositories
  const db = deps.db;
  const novels = createNovelRepository(db);
  const assetRepo = createAssetRepository(db);
  const outlineRepo = createOutlineRepository(db);
  const sceneRepo = createSceneRepository(db);
  const summaryRepo = createSummaryRepository(db);
  const factRepo = createFactCardRepository(db);
  const conflictRepo = createConflictRepository(db);
  const plotRepo = createPlotDeviceRepository(db);
  const chunkRepo = createChunkRepository(db);

  // services
  const assets = createAssetService({ repo: assetRepo });
  const knowledge = createKnowledgeService({
    chunks: chunkRepo,
    scenes: sceneRepo,
    outline: outlineRepo,
    assets: assetRepo,
    facts: factRepo,
    gateway: deps.gateway,
  });
  const memory = createMemoryService({
    summaries: summaryRepo,
    scenes: sceneRepo,
    outline: outlineRepo,
    facts: factRepo,
    plotDevices: plotRepo,
    assets: assetRepo,
    knowledge,
    gateway: deps.gateway,
  });
  const outline = createOutlineService({
    repo: outlineRepo,
    assets: assetRepo,
    novels,
    gateway: deps.gateway,
  });
  const research = createResearchService({
    repo: createResearchRepository(db),
    novels,
    gateway: deps.gateway,
    tavilyApiKey: process.env.TAVILY_API_KEY,
  });
  const assembler = createContextAssembler({
    outline: outlineRepo,
    assets: assetRepo,
    summaries: summaryRepo,
    facts: factRepo,
    plotDevices: plotRepo,
    knowledge,
    gateway: deps.gateway,
  });
  const writing = createWritingService({
    novels,
    outline: outlineRepo,
    scenes: sceneRepo,
    assets,
    facts: factRepo,
    conflicts: conflictRepo,
    plotDevices: plotRepo,
    knowledge,
    memory,
    assembler,
    gateway: deps.gateway,
  });
  const exportService = createExportService({
    novels,
    outline: outlineRepo,
    scenes: sceneRepo,
    facts: factRepo,
    plotDevices: plotRepo,
  });
  const plotDeviceService = createPlotDeviceService({
    repo: plotRepo,
    outline: outlineRepo,
    scenes: sceneRepo,
  });
  const consistency = createConsistencyService({
    conflicts: conflictRepo,
    plotDevices: plotRepo,
    plotDeviceService,
  });
  const timeline = createTimelineService({
    assets: assetRepo,
    outline: outlineRepo,
  });

  // 路由
  registerHealthRoutes(app, { db });
  registerSettingsRoutes(app, { settings: deps.settings });
  registerNovelRoutes(app, { novels });
  registerAssetRoutes(app, { assets });
  registerOutlineRoutes(app, { outline });
  registerResearchRoutes(app, { research });
  registerWritingRoutes(app, {
    writing,
    memory,
    data: {
      facts: factRepo,
      summaries: summaryRepo,
      chunks: chunkRepo,
      conflicts: conflictRepo,
      plotDevices: plotRepo,
    },
  });
  registerExportRoutes(app, { export: exportService });
  registerQualityRoutes(app, { consistency, plotDevices: plotDeviceService, facts: factRepo });
  registerTimelineRoutes(app, { timeline });

  // 生产环境托管前端构建产物（dist/client）
  const clientDist = path.resolve(process.cwd(), 'dist', 'client');
  if (fs.existsSync(clientDist)) {
    app.register(fastifyStatic, { root: clientDist });
  }

  return app;
}
