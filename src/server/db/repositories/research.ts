import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { TrendResearch } from '../../../shared/index.js';

interface ResearchRow {
  id: string;
  novel_id: string;
  query: string;
  results: string | null;
  conclusion: string | null;
  created_at: string;
}

function toRow(row: ResearchRow): TrendResearch {
  return {
    id: row.id,
    novel_id: row.novel_id,
    query: row.query,
    results: row.results ? JSON.parse(row.results) : null,
    conclusion: row.conclusion,
    created_at: row.created_at,
  };
}

export interface ResearchRepository {
  save(input: { novel_id: string; query: string; results: unknown; conclusion?: string | null }): TrendResearch;
  latestForNovel(novelId: string): TrendResearch | null;
  listForNovel(novelId: string): TrendResearch[];
  get(id: string): TrendResearch | null;
}

export function createResearchRepository(db: Database.Database): ResearchRepository {
  const stmtInsert = db.prepare(
    `INSERT INTO trend_research (id, novel_id, query, results, conclusion)
     VALUES (@id, @novel_id, @query, @results, @conclusion)`
  );
  const stmtLatest = db.prepare(
    'SELECT * FROM trend_research WHERE novel_id = ? ORDER BY created_at DESC, id DESC LIMIT 1'
  );
  const stmtList = db.prepare('SELECT * FROM trend_research WHERE novel_id = ? ORDER BY created_at DESC');
  const stmtGet = db.prepare('SELECT * FROM trend_research WHERE id = ?');

  return {
    save(input) {
      const row: ResearchRow = {
        id: randomUUID(),
        novel_id: input.novel_id,
        query: input.query,
        results: JSON.stringify(input.results ?? null),
        conclusion: input.conclusion ?? null,
        created_at: new Date().toISOString(),
      };
      stmtInsert.run(row);
      return toRow(row);
    },
    latestForNovel(novelId) {
      const row = stmtLatest.get(novelId) as ResearchRow | undefined;
      return row ? toRow(row) : null;
    },
    listForNovel(novelId) {
      return (stmtList.all(novelId) as ResearchRow[]).map(toRow);
    },
    get(id) {
      const row = stmtGet.get(id) as ResearchRow | undefined;
      return row ? toRow(row) : null;
    },
  };
}
