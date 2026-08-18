// 可独立运行的迁移脚本：npm run db:migrate
import { openDatabase } from './connection.js';
import { migrate, SCHEMA_VERSION } from './schema.js';

const dataDir = process.env.DATA_DIR;
const { db, vecLoaded } = openDatabase({ dataDir });

try {
  const result = migrate(db);
  console.log('[migrate] 完成');
  console.log('  schema version :', result.version, `(期望 ${SCHEMA_VERSION})`);
  console.log('  sqlite-vec     :', vecLoaded ? '已加载' : '未加载');
  console.log('  chunk_vec 表   :', result.vecOk ? '已创建' : '未创建（向量检索不可用）');

  // 校验表齐全
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  console.log('  数据表          :', rows.map((r) => r.name).join(', '));
} finally {
  db.close();
}
