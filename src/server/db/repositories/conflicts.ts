import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Conflict, ConflictType, ConflictStatus } from '../../../shared/index.js';

export interface NewConflict {
  novel_id: string;
  type: ConflictType;
  description: string;
  evidence?: unknown;
  status?: ConflictStatus;
}

interface ConflictRow {
  id: string;
  novel_id: string;
  type: ConflictType;
  description: string;
  evidence: string | null;
  status: ConflictStatus;
  resolution: string | null;
  created_at: string;
  updated_at: string;
}

function toConflict(row: ConflictRow): Conflict {
  return {
    id: row.id,
    novel_id: row.novel_id,
    type: row.type,
    description: row.description,
    evidence: row.evidence ? JSON.parse(row.evidence) : null,
    status: row.status,
    resolution: row.resolution,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface ConflictRepository {
  create(input: NewConflict): Conflict;
  listForNovel(novelId: string): Conflict[];
  listOpen(novelId: string): Conflict[];
  resolve(id: string, resolution: string): Conflict | null;
  countOpen(novelId: string): number;
}

export function createConflictRepository(db: Database.Database): ConflictRepository {
  const stmtInsert = db.prepare(
    `INSERT INTO conflicts (id, novel_id, type, description, evidence, status)
     VALUES (@id, @novel_id, @type, @description, @evidence, @status)`
  );
  const stmtGet = db.prepare('SELECT * FROM conflicts WHERE id = ?');
  const stmtList = db.prepare('SELECT * FROM conflicts WHERE novel_id = ? ORDER BY created_at DESC');
  const stmtOpen = db.prepare("SELECT * FROM conflicts WHERE novel_id = ? AND status = 'open' ORDER BY created_at DESC");
  const stmtResolve = db.prepare(
    "UPDATE conflicts SET status = 'resolved', resolution = @resolution, updated_at = datetime('now') WHERE id = @id"
  );
  const stmtCountOpen = db.prepare("SELECT COUNT(*) AS c FROM conflicts WHERE novel_id = ? AND status = 'open'");

  return {
    create(input) {
      const row: ConflictRow = {
        id: randomUUID(),
        novel_id: input.novel_id,
        type: input.type,
        description: input.description,
        evidence: input.evidence ? JSON.stringify(input.evidence) : null,
        status: input.status ?? 'open',
        resolution: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      stmtInsert.run(row);
      return toConflict(row);
    },
    listForNovel(novelId) {
      return (stmtList.all(novelId) as ConflictRow[]).map(toConflict);
    },
    listOpen(novelId) {
      return (stmtOpen.all(novelId) as ConflictRow[]).map(toConflict);
    },
    resolve(id, resolution) {
      const current = stmtGet.get(id) as ConflictRow | undefined;
      if (!current) return null;
      stmtResolve.run({ id, resolution });
      const row = stmtGet.get(id) as ConflictRow;
      return toConflict(row);
    },
    countOpen(novelId) {
      return (stmtCountOpen.get(novelId) as { c: number }).c;
    },
  };
}
