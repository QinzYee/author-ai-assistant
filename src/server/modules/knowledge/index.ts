import type { LlmGateway } from '../../llm/index.js';
import type { ChunkRepository, VecHit } from '../../db/repositories/chunks.js';
import type { SceneRepository } from '../../db/repositories/scenes.js';
import type { OutlineRepository } from '../../db/repositories/outline.js';
import type { AssetRepository } from '../../db/repositories/assets.js';
import type { FactCardRepository } from '../../db/repositories/facts.js';

export interface KnowledgeDeps {
  chunks: ChunkRepository;
  scenes: SceneRepository;
  outline: OutlineRepository;
  assets: AssetRepository;
  facts: FactCardRepository;
  gateway: LlmGateway;
}

const CHUNK_SIZE = 512; // token 预算
const CHUNK_OVERLAP = 64;

/** 近似 token 计数（中文约 1 字≈1 token，英文按词） */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const other = text.replace(/[\u4e00-\u9fff]/g, ' ').trim();
  const words = other ? other.split(/\s+/).length : 0;
  return cjk + words;
}

/** 512-token 重叠分块（§8.1） */
export function splitChunks(content: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  if (!content) return [];
  if (estimateTokens(content) <= size) return [content];

  const chars = Array.from(content);
  const chunks: string[] = [];
  let i = 0;
  while (i < chars.length) {
    let window = chars.slice(i, i + size).join('');
    // 尽量在句号/换行处断句，避免硬切
    const boundary = Math.max(
      window.lastIndexOf('。'),
      window.lastIndexOf('\n'),
      window.lastIndexOf('！'),
      window.lastIndexOf('？')
    );
    if (boundary > size * 0.5) {
      window = window.slice(0, boundary + 1);
    }
    chunks.push(window);
    i += window.length - overlap;
    if (i < 0) break;
  }
  return chunks;
}

function rrf(rankLists: VecHit[][], k = 60): VecHit[] {
  const scores = new Map<string, { hit: VecHit; score: number }>();
  for (const list of rankLists) {
    list.forEach((hit, rank) => {
      const cur = scores.get(hit.chunkId);
      const score = 1 / (k + rank + 1);
      if (cur) {
        cur.score += score;
      } else {
        scores.set(hit.chunkId, { hit, score });
      }
    });
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .map((s) => s.hit);
}

export function createKnowledgeService(deps: KnowledgeDeps) {
  const { chunks, scenes, outline, assets, facts, gateway } = deps;

  /** §8.1 入库：正文 → 分块 → embedding → 向量 + FTS */
  async function indexScene(sceneId: string): Promise<number> {
    const scene = scenes.get(sceneId);
    if (!scene) return 0;
    chunks.removeByScene(sceneId);

    const parts = splitChunks(scene.content);
    if (parts.length === 0) return 0;

    const embeddings = await gateway.embed(parts);
    for (let i = 0; i < parts.length; i++) {
      chunks.insertChunk({
        novel_id: scene.novel_id,
        scene_id: scene.id,
        chunk_index: i,
        content: parts[i],
        embedding: embeddings[i] ?? [],
      });
    }
    return parts.length;
  }

  /** §8.3 混合检索：向量 + FTS 三路 RRF 融合 */
  async function search(novelId: string, query: string, opts: { topK?: number; entityNames?: string[] } = {}): Promise<VecHit[]> {
    const topK = opts.topK ?? 6;

    // 1. 向量检索
    let vecHits: VecHit[] = [];
    try {
      const [embedding] = await gateway.embed([query]);
      vecHits = chunks.searchVector(embedding, topK * 2);
    } catch {
      vecHits = [];
    }

    // 2. FTS 检索
    const ftsHits = chunks.searchFts(query, topK * 2);

    // 3. 实体过滤（结构化直查：场景大纲声明的实体 → 资产 + 事实卡片）
    const entityHits: VecHit[] = [];
    if (opts.entityNames?.length) {
      const entities = opts.entityNames;
      const relatedFacts = facts.listByEntities(novelId, entities);
      for (const f of relatedFacts) {
        entityHits.push({
          chunkId: `fact:${f.id}`,
          sceneId: f.source_scene_id,
          content: `【事实】${f.fact}`,
          distance: 0,
        });
      }
      // 资产核心属性作为结构化片段
      for (const name of entities) {
        const asset = assets.list(novelId).find((a) => a.name.includes(name));
        if (asset) {
          entityHits.push({
            chunkId: `asset:${asset.id}`,
            sceneId: null,
            content: `【${asset.type}·${asset.name}】${JSON.stringify(asset.core)}`,
            distance: 0,
          });
        }
      }
    }

    return rrf([vecHits, ftsHits, entityHits]).slice(0, topK);
  }

  return {
    indexScene,
    search,
    splitChunks,
    estimateTokens,
  };
}

export type KnowledgeService = ReturnType<typeof createKnowledgeService>;
