import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { OutlineNode, OutlineNodeInput, OutlineStatus } from '../../../shared/index.js';

interface OutlineRow {
  id: string;
  novel_id: string;
  parent_id: string | null;
  level: OutlineNode['level'];
  title: string | null;
  summary: string | null;
  content: string | null;
  sort_order: number;
  status: OutlineStatus;
}

function toNode(row: OutlineRow): OutlineNode {
  return {
    id: row.id,
    novel_id: row.novel_id,
    parent_id: row.parent_id,
    level: row.level,
    title: row.title,
    summary: row.summary,
    content: row.content ? JSON.parse(row.content) : null,
    sort_order: row.sort_order,
    status: row.status,
  };
}

export interface OutlineRepository {
  listForNovel(novelId: string): OutlineNode[];
  get(id: string): OutlineNode | null;
  getChildren(novelId: string, parentId: string | null): OutlineNode[];
  create(input: OutlineNodeInput & { novel_id: string }): OutlineNode;
  update(id: string, patch: Partial<OutlineNodeInput>): OutlineNode | null;
  /** 删除节点及其全部后代 */
  remove(id: string): boolean;
  nextSortOrder(novelId: string, parentId: string | null): number;
}

export function createOutlineRepository(db: Database.Database): OutlineRepository {
  const stmtList = db.prepare('SELECT * FROM outline_nodes WHERE novel_id = ? ORDER BY sort_order ASC, id ASC');
  const stmtGet = db.prepare('SELECT * FROM outline_nodes WHERE id = ?');
  const stmtChildren = db.prepare(
    'SELECT * FROM outline_nodes WHERE novel_id = ? AND parent_id IS ? ORDER BY sort_order ASC, id ASC'
  );
  const stmtInsert = db.prepare(
    `INSERT INTO outline_nodes (id, novel_id, parent_id, level, title, summary, content, sort_order, status)
     VALUES (@id, @novel_id, @parent_id, @level, @title, @summary, @content, @sort_order, @status)`
  );
  const stmtUpdate = db.prepare(
    `UPDATE outline_nodes SET
       parent_id = COALESCE(@parent_id, parent_id),
       level = COALESCE(@level, level),
       title = COALESCE(@title, title),
       summary = COALESCE(@summary, summary),
       content = COALESCE(@content, content),
       sort_order = COALESCE(@sort_order, sort_order),
       status = COALESCE(@status, status)
     WHERE id = @id`
  );
  const stmtMaxOrder = db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) AS m FROM outline_nodes WHERE novel_id = ? AND parent_id IS ?'
  );
  const stmtRemove = db.prepare(
    `WITH RECURSIVE sub(id) AS (
       SELECT id FROM outline_nodes WHERE id = ?
       UNION ALL
       SELECT o.id FROM outline_nodes o JOIN sub s ON o.parent_id = s.id
     )
     DELETE FROM outline_nodes WHERE id IN (SELECT id FROM sub)`
  );

  return {
    listForNovel(novelId) {
      return (stmtList.all(novelId) as OutlineRow[]).map(toNode);
    },
    get(id) {
      const row = stmtGet.get(id) as OutlineRow | undefined;
      return row ? toNode(row) : null;
    },
    getChildren(novelId, parentId) {
      return (stmtChildren.all(novelId, parentId) as OutlineRow[]).map(toNode);
    },
    create(input) {
      const sortOrder = input.sort_order ?? this.nextSortOrder(input.novel_id, input.parent_id ?? null);
      const node: OutlineRow = {
        id: randomUUID(),
        novel_id: input.novel_id,
        parent_id: input.parent_id ?? null,
        level: input.level,
        title: input.title ?? null,
        summary: input.summary ?? null,
        content: input.content ? JSON.stringify(input.content) : null,
        sort_order: sortOrder,
        status: input.status ?? 'planned',
      };
      stmtInsert.run(node);
      return toNode(node);
    },
    update(id, patch) {
      const current = stmtGet.get(id) as OutlineRow | undefined;
      if (!current) return null;
      const merged: Record<string, unknown> = {
        id,
        parent_id: patch.parent_id !== undefined ? patch.parent_id : current.parent_id,
        level: patch.level ?? current.level,
        title: patch.title !== undefined ? patch.title : current.title,
        summary: patch.summary !== undefined ? patch.summary : current.summary,
        content: patch.content !== undefined ? (patch.content ? JSON.stringify(patch.content) : null) : current.content,
        sort_order: patch.sort_order ?? current.sort_order,
        status: patch.status ?? current.status,
      };
      stmtUpdate.run(merged);
      return this.get(id);
    },
    remove(id) {
      return stmtRemove.run(id).changes > 0;
    },
    nextSortOrder(novelId, parentId) {
      const row = stmtMaxOrder.get(novelId, parentId) as { m: number };
      return row.m + 1;
    },
  };
}
