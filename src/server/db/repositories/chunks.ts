import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ContentChunk } from '../../../shared/index.js';

interface ChunkRow {
  id: string;
  novel_id: string;
  scene_id: string | null;
  chunk_index: number;
  content: string;
  embedding: Buffer | null;
}

function toChunk(row: ChunkRow): ContentChunk {
  return {
    id: row.id,
    novel_id: row.novel_id,
    scene_id: row.scene_id,
    chunk_index: row.chunk_index,
    content: row.content,
    embedding: row.embedding ? row.embedding.buffer.slice(row.embedding.byteOffset, row.embedding.byteOffset + row.embedding.byteLength) as ArrayBuffer : null,
  };
}

export interface VecHit {
  chunkId: string;
  sceneId: string | null;
  content: string;
  distance: number;
}

export interface ChunkRepository {
  /** 分块入库：content_chunks + chunk_vec（向量）+ chunk_fts（全文），事务内完成 */
  insertChunk(input: { novel_id: string; scene_id: string | null; chunk_index: number; content: string; embedding: number[] }): ContentChunk;
  /** 向量 KNN 检索（sqlite-vec） */
  searchVector(embedding: number[], k: number): VecHit[];
  /** FTS5 关键词检索（trigram，中文友好） */
  searchFts(query: string, limit: number): VecHit[];
  listByScene(sceneId: string): ContentChunk[];
  listByNovel(novelId: string): ContentChunk[];
  removeByScene(sceneId: string): void;
}

export function createChunkRepository(db: Database.Database): ChunkRepository {
  const stmtInsertChunk = db.prepare(
    `INSERT INTO content_chunks (id, novel_id, scene_id, chunk_index, content)
     VALUES (@id, @novel_id, @scene_id, @chunk_index, @content)`
  );
  const stmtInsertVec = db.prepare(
    'INSERT INTO chunk_vec (embedding) VALUES (?)'
  );
  const stmtInsertFts = db.prepare(
    'INSERT INTO chunk_fts (id, content, scene_id) VALUES (?, ?, ?)'
  );
  const stmtKnn = db.prepare(
    'SELECT rowid, distance FROM chunk_vec WHERE embedding MATCH ? AND k = ?'
  );
  const stmtChunkById = db.prepare(
    'SELECT id, novel_id, scene_id, chunk_index, content, embedding FROM content_chunks WHERE id = ?'
  );
  const stmtFts = db.prepare(
    `SELECT c.id AS chunkId, c.scene_id AS sceneId, c.content AS content, 0 AS distance
     FROM chunk_fts f JOIN content_chunks c ON c.id = f.id
     WHERE chunk_fts MATCH ? LIMIT ?`
  );
  const stmtListScene = db.prepare('SELECT * FROM content_chunks WHERE scene_id = ? ORDER BY chunk_index ASC');
  const stmtListNovel = db.prepare('SELECT * FROM content_chunks WHERE novel_id = ? ORDER BY scene_id ASC, chunk_index ASC');
  const stmtDeleteSceneChunks = db.prepare('DELETE FROM content_chunks WHERE scene_id = ?');
  const stmtDeleteVecByScene = db.prepare(
    `DELETE FROM chunk_vec WHERE rowid IN (SELECT rowid FROM content_chunks WHERE scene_id = ?)`
  );
  const stmtDeleteFtsByScene = db.prepare('DELETE FROM chunk_fts WHERE scene_id = ?');

  return {
    insertChunk(input) {
      const row: ChunkRow = {
        id: randomUUID(),
        novel_id: input.novel_id,
        scene_id: input.scene_id,
        chunk_index: input.chunk_index,
        content: input.content,
        embedding: null,
      };
      const run = db.transaction(() => {
        stmtInsertChunk.run(row);
        const vecBuf = Buffer.from(new Float32Array(input.embedding).buffer);
        stmtInsertVec.run(vecBuf);
        stmtInsertFts.run(row.id, input.content, input.scene_id ?? '');
      });
      run();
      return toChunk(row);
    },
    searchVector(embedding, k) {
      const vecBuf = Buffer.from(new Float32Array(embedding).buffer);
      const knn = stmtKnn.all(vecBuf, k) as Array<{ rowid: number; distance: number }>;
      const hits: VecHit[] = [];
      if (knn.length === 0) return hits;
      // 通过 content_chunks 的隐含 rowid 反向映射 chunk id
      const all = db.prepare('SELECT id, rowid FROM content_chunks').all() as Array<{ id: string; rowid: number }>;
      const rowidToId = new Map(all.map((r) => [r.rowid, r.id]));
      for (const hit of knn) {
        const chunkId = rowidToId.get(hit.rowid);
        if (!chunkId) continue;
        const row = stmtChunkById.get(chunkId) as ChunkRow | undefined;
        if (!row) continue;
        hits.push({ chunkId, sceneId: row.scene_id, content: row.content, distance: hit.distance });
      }
      return hits.sort((a, b) => a.distance - b.distance);
    },
    searchFts(query, limit) {
      if (!query.trim()) return [];
      const safeQuery = query.trim();
      try {
        return stmtFts.all(safeQuery, limit) as VecHit[];
      } catch {
        return [];
      }
    },
    listByScene(sceneId) {
      return (stmtListScene.all(sceneId) as ChunkRow[]).map(toChunk);
    },
    listByNovel(novelId) {
      return (stmtListNovel.all(novelId) as ChunkRow[]).map(toChunk);
    },
    removeByScene(sceneId) {
      const run = db.transaction(() => {
        stmtDeleteVecByScene.run(sceneId);
        stmtDeleteFtsByScene.run(sceneId);
        stmtDeleteSceneChunks.run(sceneId);
      });
      run();
    },
  };
}
