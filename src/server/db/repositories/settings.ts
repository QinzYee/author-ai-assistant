import type Database from 'better-sqlite3';

/** app_settings 表：key-value 应用设置（LLM 配置等，持久化于 data/*.db） */
export interface SettingsRepository {
  get(key: string): string | null;
  getAll(): Record<string, string>;
  /** 批量写入（upsert），返回受影响 key 数 */
  setMany(entries: Record<string, string>): number;
  /** 删除指定 key */
  remove(keys: string[]): number;
}

interface SettingRow {
  key: string;
  value: string;
}

export function createSettingsRepository(db: Database.Database): SettingsRepository {
  const stmtGet = db.prepare('SELECT value FROM app_settings WHERE key = ?');
  const stmtAll = db.prepare('SELECT key, value FROM app_settings');
  const stmtUpsert = db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (@key, @value, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = @value, updated_at = datetime('now')`
  );
  const stmtDelete = db.prepare('DELETE FROM app_settings WHERE key = ?');

  return {
    get(key) {
      const row = stmtGet.get(key) as SettingRow | undefined;
      return row ? row.value : null;
    },
    getAll() {
      const rows = stmtAll.all() as SettingRow[];
      const out: Record<string, string> = {};
      for (const r of rows) out[r.key] = r.value;
      return out;
    },
    setMany(entries) {
      const tx = db.transaction(() => {
        for (const [key, value] of Object.entries(entries)) {
          stmtUpsert.run({ key, value });
        }
      });
      tx();
      return Object.keys(entries).length;
    },
    remove(keys) {
      const tx = db.transaction(() => {
        for (const k of keys) stmtDelete.run(k);
      });
      tx();
      return keys.length;
    },
  };
}
