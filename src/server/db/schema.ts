import type Database from 'better-sqlite3';

/** 当前 schema 版本（用 PRAGMA user_version 跟踪） */
export const SCHEMA_VERSION = 3;

/**
 * 基础表 —— 对应架构文档 §5 数据模型（不含向量虚拟表，见 VEC_SQL）。
 * 全部使用 IF NOT EXISTS，幂等可重入。
 */
export const SCHEMA_SQL = `
-- ============ 项目 ============
CREATE TABLE IF NOT EXISTS novels (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  genre TEXT,
  status TEXT DEFAULT 'research',
  target_audience TEXT,
  selling_points TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ============ 资产 ============
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES novels(id),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  core JSON NOT NULL,
  extended JSON,
  summary TEXT,
  current_version INT DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assets_novel ON assets(novel_id, type);

CREATE TABLE IF NOT EXISTS asset_states (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  version INT NOT NULL,
  state JSON NOT NULL,
  source_scene_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS asset_relations (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  from_asset TEXT NOT NULL,
  to_asset TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  description TEXT
);

-- ============ 大纲树 ============
CREATE TABLE IF NOT EXISTS outline_nodes (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES novels(id),
  parent_id TEXT REFERENCES outline_nodes(id),
  level TEXT NOT NULL,
  title TEXT,
  summary TEXT,
  content JSON,
  sort_order INT DEFAULT 0,
  status TEXT DEFAULT 'planned'
);

-- ============ 正文 ============
CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES novels(id),
  outline_node_id TEXT REFERENCES outline_nodes(id),
  content TEXT NOT NULL,
  word_count INT DEFAULT 0,
  meta JSON,
  status TEXT DEFAULT 'draft',
  compacted INT DEFAULT 0,              -- 0=工作记忆(raw) 1=已物化到 L3（§7.2 裁剪标记）
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ============ 事实卡片 ============
CREATE TABLE IF NOT EXISTS fact_cards (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES novels(id),
  fact TEXT NOT NULL,
  entities JSON,
  source_scene_id TEXT,
  confidence REAL DEFAULT 0.8,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fact_entities ON fact_cards(novel_id, entities);

-- ============ 摘要树 ============
CREATE TABLE IF NOT EXISTS summaries (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES novels(id),
  level TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ============ 正文分块 ============
CREATE TABLE IF NOT EXISTS content_chunks (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES novels(id),
  scene_id TEXT REFERENCES scenes(id),
  chunk_index INT,
  content TEXT NOT NULL,
  embedding BLOB,
  UNIQUE(scene_id, chunk_index)
);

-- 全文索引（FTS5，混合检索用；trigram 以更好支持中文子串匹配）
-- id 列为 UNINDEXED 仅作回连 content_chunks 的映射
CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(id UNINDEXED, content, scene_id UNINDEXED, tokenize='trigram');

-- ============ 伏笔台账 ============
CREATE TABLE IF NOT EXISTS plot_devices (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES novels(id),
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT DEFAULT 'planted',
  planted_scene_id TEXT,
  expected_payoff TEXT,
  related_entities JSON,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ============ 一致性冲突 ============
CREATE TABLE IF NOT EXISTS conflicts (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES novels(id),
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence JSON,
  status TEXT DEFAULT 'open',
  resolution TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ============ 调研 / 生成日志 ============
CREATE TABLE IF NOT EXISTS trend_research (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES novels(id),
  query TEXT,
  results JSON,
  conclusion TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS generation_logs (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES novels(id),
  scene_id TEXT,
  pass_type TEXT,
  model TEXT,
  input_tokens INT DEFAULT 0,
  output_tokens INT DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
`;

/**
 * 向量虚拟表 —— 需要 sqlite-vec 扩展加载后才可创建。
 * 不声明主键：rowid 自动分配，与 content_chunks 的隐含 rowid 一一对应（同事务插入）。
 * 失败会抛错，由 migrate() 捕获降级（仅影响向量检索）。
 */
export const VEC_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vec USING vec0(
  embedding float[1024]
);
`;

/** 执行迁移：建表 + 版本号 */
export function migrate(db: Database.Database): { version: number; vecOk: boolean } {
  const current = db.pragma('user_version', { simple: true }) as number;

  db.exec('BEGIN');
  try {
    // v1 → v2：chunk_fts 改用 trigram tokenizer（中文检索），旧表须在建表前重建
    if (current < 2) {
      db.exec('DROP TABLE IF EXISTS chunk_fts');
    }

    db.exec(SCHEMA_SQL);

    // v2 → v3：scenes 增加 compacted 标记列（§7.2 裁剪标记）
    // 必须在 SCHEMA_SQL 建表之后执行（旧库缺列时补列；新库已在 CREATE 中带列）
    if (current < 3) {
      const cols = db.pragma("table_info('scenes')") as Array<{ name: string }>;
      const hasCol = cols.some((c) => c.name === 'compacted');
      if (!hasCol) {
        db.exec("ALTER TABLE scenes ADD COLUMN compacted INT DEFAULT 0");
      }
    }

    let vecOk = true;
    try {
      db.exec(VEC_SQL);
    } catch (err) {
      vecOk = false;
      console.warn('[db] 向量表 chunk_vec 创建失败（sqlite-vec 未就绪）：', (err as Error).message);
    }
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
    db.exec('COMMIT');
    return { version: SCHEMA_VERSION, vecOk };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
