import 'dotenv/config';
import { openDatabase } from './db/connection.js';
import { migrate } from './db/schema.js';
import { createSettingsRepository } from './db/repositories/settings.js';
import { createSettingsService } from './modules/settings/index.js';
import { createGateway } from './llm/index.js';
import { buildApp } from './app.js';

async function main() {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';
  const dataDir = process.env.DATA_DIR;

  // 数据库
  const { db, vecLoaded } = openDatabase({ dataDir });
  const migrated = migrate(db);
  console.log(
    `[db] schema v${migrated.version}，sqlite-vec ${vecLoaded ? '已加载' : '未加载'}，` +
      `chunk_vec ${migrated.vecOk ? '已就绪' : '不可用'}`
  );

  // 应用设置（前端可配置 LLM 密钥/地址/模型，DB 优先于 .env）
  const settings = createSettingsService({
    repo: createSettingsRepository(db),
    env: process.env,
  });

  // LLM 网关（每次调用动态读取配置 → 前端保存设置后热生效，无需重启）
  const gateway = createGateway(() => settings.getConfig());

  // 应用
  const app = buildApp({ db, gateway, settings });

  // 优雅退出
  const shutdown = async () => {
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port, host });
  app.log.info(`Author AI Assistant 已启动: http://${host}:${port}`);
  const cfg = settings.getConfig();
  app.log.info(`模型分级: generate=${cfg.generate.model} + embed=${cfg.embed.model}`);
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
