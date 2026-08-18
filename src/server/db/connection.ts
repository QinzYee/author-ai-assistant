import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

export interface DbOptions {
  /** 数据库文件路径；缺省用 dataDir/assistant.db */
  filename?: string;
  /** 数据目录（对应 .gitignore 的 data/） */
  dataDir?: string;
}

export interface DbHandle {
  db: Database.Database;
  vecLoaded: boolean;
}

/**
 * 打开（或创建）SQLite 数据库。
 * - 单进程单文件，WAL 模式 + 外键开启
 * - 尝试加载 sqlite-vec 扩展（失败不致命，仅向量检索不可用）
 */
export function openDatabase(opts: DbOptions = {}): DbHandle {
  const dataDir = opts.dataDir ?? path.resolve(process.cwd(), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const filename = opts.filename ?? path.join(dataDir, 'assistant.db');

  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  let vecLoaded = false;
  try {
    db.loadExtension(sqliteVec.getLoadablePath());
    vecLoaded = true;
  } catch (err) {
    console.warn('[db] sqlite-vec 扩展加载失败，向量检索（chunk_vec）不可用：', (err as Error).message);
  }

  return { db, vecLoaded };
}
