import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Summary, SummaryLevel } from '../../../shared/index.js';

export interface NewSummary {
  novel_id: string;
  level: SummaryLevel;
  ref_id: string;
  content: string;
}

interface SummaryRow {
  id: string;
  novel_id: string;
  level: SummaryLevel;
  ref_id: string;
  content: string;
  created_at: string;
}

function toSummary(row: SummaryRow): Summary {
  return { id: row.id, novel_id: row.novel_id, level: row.level, ref_id: row.ref_id, content: row.content, created_at: row.created_at };
}

export interface SummaryRepository {
  save(input: NewSummary): Summary;
  latestForRef(refId: string, level: SummaryLevel): Summary | null;
  listForNovel(novelId: string): Summary[];
  listForLevel(novelId: string, level: SummaryLevel): Summary[];
}

export function createSummaryRepository(db: Database.Database): SummaryRepository {
  const stmtInsert = db.prepare(
    `INSERT INTO summaries (id, novel_id, level, ref_id, content) VALUES (@id, @novel_id, @level, @ref_id, @content)`
  );
  const stmtLatest = db.prepare(
    'SELECT * FROM summaries WHERE ref_id = ? AND level = ? ORDER BY created_at DESC, id DESC LIMIT 1'
  );
  const stmtList = db.prepare('SELECT * FROM summaries WHERE novel_id = ? ORDER BY created_at ASC');
  const stmtLevel = db.prepare('SELECT * FROM summaries WHERE novel_id = ? AND level = ? ORDER BY created_at ASC');

  return {
    save(input) {
      const row: SummaryRow = {
        id: randomUUID(),
        novel_id: input.novel_id,
        level: input.level,
        ref_id: input.ref_id,
        content: input.content,
        created_at: new Date().toISOString(),
      };
      stmtInsert.run(row);
      return toSummary(row);
    },
    latestForRef(refId, level) {
      const row = stmtLatest.get(refId, level) as SummaryRow | undefined;
      return row ? toSummary(row) : null;
    },
    listForNovel(novelId) {
      return (stmtList.all(novelId) as SummaryRow[]).map(toSummary);
    },
    listForLevel(novelId, level) {
      return (stmtLevel.all(novelId, level) as SummaryRow[]).map(toSummary);
    },
  };
}
