import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { FactCard, FactCardStatus } from '../../../shared/index.js';

export interface NewFactCard {
  novel_id: string;
  fact: string;
  entities: string[];
  source_scene_id?: string | null;
  confidence?: number;
}

interface FactRow {
  id: string;
  novel_id: string;
  fact: string;
  entities: string;
  source_scene_id: string | null;
  confidence: number;
  status: FactCardStatus;
  created_at: string;
}

function toCard(row: FactRow): FactCard {
  return {
    id: row.id,
    novel_id: row.novel_id,
    fact: row.fact,
    entities: row.entities ? JSON.parse(row.entities) : [],
    source_scene_id: row.source_scene_id,
    confidence: row.confidence,
    status: row.status,
    created_at: row.created_at,
  };
}

export interface FactCardRepository {
  create(input: NewFactCard): FactCard;
  /** 按事实文本精确查重（同文本视为重复） */
  findDuplicate(novelId: string, fact: string): FactCard | null;
  listActive(novelId: string): FactCard[];
  listByEntities(novelId: string, entities: string[]): FactCard[];
  markSuperseded(id: string): FactCard | null;
  listAll(novelId: string): FactCard[];
}

export function createFactCardRepository(db: Database.Database): FactCardRepository {
  const stmtInsert = db.prepare(
    `INSERT INTO fact_cards (id, novel_id, fact, entities, source_scene_id, confidence, status)
     VALUES (@id, @novel_id, @fact, @entities, @source_scene_id, @confidence, 'active')`
  );
  const stmtGet = db.prepare('SELECT * FROM fact_cards WHERE id = ?');
  const stmtDup = db.prepare('SELECT * FROM fact_cards WHERE novel_id = ? AND fact = ? LIMIT 1');
  const stmtActive = db.prepare("SELECT * FROM fact_cards WHERE novel_id = ? AND status = 'active' ORDER BY created_at DESC");
  const stmtByEntities = db.prepare(
    "SELECT * FROM fact_cards WHERE novel_id = ? AND status = 'active' AND (" +
      '  entities LIKE ? OR entities LIKE ? OR entities LIKE ?' +
      ') ORDER BY confidence DESC LIMIT 50'
  );
  const stmtAll = db.prepare('SELECT * FROM fact_cards WHERE novel_id = ? ORDER BY created_at DESC');
  const stmtSupersede = db.prepare("UPDATE fact_cards SET status = 'superseded' WHERE id = ?");

  return {
    create(input) {
      const row: FactRow = {
        id: randomUUID(),
        novel_id: input.novel_id,
        fact: input.fact,
        entities: JSON.stringify(input.entities ?? []),
        source_scene_id: input.source_scene_id ?? null,
        confidence: input.confidence ?? 0.8,
        status: 'active',
        created_at: new Date().toISOString(),
      };
      stmtInsert.run(row);
      return toCard(row);
    },
    findDuplicate(novelId, fact) {
      const row = stmtDup.get(novelId, fact) as FactRow | undefined;
      return row ? toCard(row) : null;
    },
    listActive(novelId) {
      return (stmtActive.all(novelId) as FactRow[]).map(toCard);
    },
    listByEntities(novelId, entities) {
      if (entities.length === 0) return [];
      const patterns = entities.map((e) => `%${e}%`);
      // 依次尝试每个实体，合并结果去重
      const seen = new Set<string>();
      const out: FactCard[] = [];
      for (const e of entities) {
        const rows = stmtByEntities.all(novelId, `%${e}%`, `%${e}%`, `%${e}%`) as FactRow[];
        for (const r of rows) {
          if (!seen.has(r.id)) {
            seen.add(r.id);
            out.push(toCard(r));
          }
        }
      }
      return out;
    },
    markSuperseded(id) {
      stmtSupersede.run(id);
      const row = stmtGet.get(id) as FactRow | undefined;
      return row ? toCard(row) : null;
    },
    listAll(novelId) {
      return (stmtAll.all(novelId) as FactRow[]).map(toCard);
    },
  };
}
