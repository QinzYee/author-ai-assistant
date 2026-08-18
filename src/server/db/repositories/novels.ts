import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Novel, NewNovel } from '../../../shared/index.js';

export interface NovelRepository {
  list(): Novel[];
  get(id: string): Novel | null;
  create(input: NewNovel): Novel;
  updateStatus(id: string, status: Novel['status']): Novel | null;
  remove(id: string): boolean;
}

interface NovelRow {
  id: string;
  title: string;
  genre: string | null;
  status: Novel['status'];
  target_audience: string | null;
  selling_points: string | null;
  created_at: string;
}

function toNovel(row: NovelRow): Novel {
  return {
    id: row.id,
    title: row.title,
    genre: row.genre,
    status: row.status,
    target_audience: row.target_audience,
    selling_points: row.selling_points,
    created_at: row.created_at,
  };
}

export function createNovelRepository(db: Database.Database): NovelRepository {
  const stmtList = db.prepare('SELECT * FROM novels ORDER BY created_at DESC, id DESC');
  const stmtGet = db.prepare('SELECT * FROM novels WHERE id = ?');
  const stmtInsert = db.prepare(
    `INSERT INTO novels (id, title, genre, status, target_audience, selling_points)
     VALUES (@id, @title, @genre, 'research', @target_audience, @selling_points)`
  );
  const stmtUpdateStatus = db.prepare('UPDATE novels SET status = ? WHERE id = ?');
  const stmtDelete = db.prepare('DELETE FROM novels WHERE id = ?');

  return {
    list() {
      return (stmtList.all() as NovelRow[]).map(toNovel);
    },
    get(id: string) {
      const row = stmtGet.get(id) as NovelRow | undefined;
      return row ? toNovel(row) : null;
    },
    create(input: NewNovel) {
      const novel: NovelRow = {
        id: randomUUID(),
        title: input.title,
        genre: input.genre ?? null,
        status: 'research',
        target_audience: input.target_audience ?? null,
        selling_points: input.selling_points ?? null,
        created_at: new Date().toISOString(),
      };
      stmtInsert.run(novel);
      return toNovel(novel);
    },
    updateStatus(id: string, status: Novel['status']) {
      const result = stmtUpdateStatus.run(status, id);
      if (result.changes === 0) return null;
      return this.get(id);
    },
    remove(id: string) {
      return stmtDelete.run(id).changes > 0;
    },
  };
}
