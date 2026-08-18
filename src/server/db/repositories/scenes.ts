import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Scene, SceneMeta, SceneStatus } from '../../../shared/index.js';

export interface NewScene {
  novel_id: string;
  outline_node_id: string | null;
  content: string;
  meta?: SceneMeta | null;
  word_count?: number;
  status?: SceneStatus;
}

interface SceneRow {
  id: string;
  novel_id: string;
  outline_node_id: string | null;
  content: string;
  word_count: number;
  meta: string | null;
  status: SceneStatus;
  created_at: string;
  updated_at: string;
}

function toScene(row: SceneRow): Scene {
  return {
    id: row.id,
    novel_id: row.novel_id,
    outline_node_id: row.outline_node_id,
    content: row.content,
    word_count: row.word_count,
    meta: row.meta ? JSON.parse(row.meta) : null,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface SceneRepository {
  create(input: NewScene): Scene;
  get(id: string): Scene | null;
  listForNovel(novelId: string): Scene[];
  listForOutlineNode(outlineNodeId: string): Scene[];
  update(id: string, patch: Partial<Pick<Scene, 'content' | 'status' | 'meta'>>): Scene | null;
  remove(id: string): boolean;
  countWords(content: string): number;
}

export function createSceneRepository(db: Database.Database): SceneRepository {
  const stmtInsert = db.prepare(
    `INSERT INTO scenes (id, novel_id, outline_node_id, content, word_count, meta, status)
     VALUES (@id, @novel_id, @outline_node_id, @content, @word_count, @meta, @status)`
  );
  const stmtGet = db.prepare('SELECT * FROM scenes WHERE id = ?');
  const stmtListNovel = db.prepare('SELECT * FROM scenes WHERE novel_id = ? ORDER BY created_at ASC, id ASC');
  const stmtListOutline = db.prepare('SELECT * FROM scenes WHERE outline_node_id = ? ORDER BY created_at ASC, id ASC');
  const stmtUpdate = db.prepare(
    `UPDATE scenes SET content = COALESCE(@content, content), status = COALESCE(@status, status),
       meta = COALESCE(@meta, meta), updated_at = datetime('now') WHERE id = @id`
  );
  const stmtDelete = db.prepare('DELETE FROM scenes WHERE id = ?');

  function countWords(content: string): number {
    // 简单字数统计：中文字符 + 英文单词
    const cjk = (content.match(/[\u4e00-\u9fff]/g) ?? []).length;
    const latinWords = (content.match(/[a-zA-Z0-9]+/g) ?? []).length;
    return cjk + latinWords;
  }

  return {
    create(input) {
      const scene: SceneRow = {
        id: randomUUID(),
        novel_id: input.novel_id,
        outline_node_id: input.outline_node_id ?? null,
        content: input.content,
        word_count: input.word_count ?? countWords(input.content),
        meta: input.meta ? JSON.stringify(input.meta) : null,
        status: input.status ?? 'draft',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      stmtInsert.run(scene);
      return toScene(scene);
    },
    get(id) {
      const row = stmtGet.get(id) as SceneRow | undefined;
      return row ? toScene(row) : null;
    },
    listForNovel(novelId) {
      return (stmtListNovel.all(novelId) as SceneRow[]).map(toScene);
    },
    listForOutlineNode(outlineNodeId) {
      return (stmtListOutline.all(outlineNodeId) as SceneRow[]).map(toScene);
    },
    update(id, patch) {
      const current = stmtGet.get(id) as SceneRow | undefined;
      if (!current) return null;
      stmtUpdate.run({
        id,
        content: patch.content ?? null,
        status: patch.status ?? null,
        meta: patch.meta !== undefined ? (patch.meta ? JSON.stringify(patch.meta) : null) : null,
      });
      return this.get(id);
    },
    remove(id) {
      return stmtDelete.run(id).changes > 0;
    },
    countWords,
  };
}
