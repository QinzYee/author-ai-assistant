// 三级记忆（§7）—— L2 摘要树滚动维护 + compact（物化优先，§7.2）
import type { LlmGateway } from '../../llm/index.js';
import type { SummaryRepository } from '../../db/repositories/summaries.js';
import type { SceneRepository } from '../../db/repositories/scenes.js';
import type { OutlineRepository } from '../../db/repositories/outline.js';
import type { FactCardRepository } from '../../db/repositories/facts.js';
import type { PlotDeviceRepository } from '../../db/repositories/plotdevices.js';
import type { AssetRepository } from '../../db/repositories/assets.js';
import type { KnowledgeService } from '../knowledge/index.js';
import type { PromptsService } from '../prompts/index.js';
import type { OutlineNode, SummaryLevel } from '../../../shared/index.js';

export interface MemoryDeps {
  summaries: SummaryRepository;
  scenes: SceneRepository;
  outline: OutlineRepository;
  facts: FactCardRepository;
  plotDevices: PlotDeviceRepository;
  assets: AssetRepository;
  knowledge: KnowledgeService;
  gateway: LlmGateway;
  prompts: PromptsService;
}

/** L1 工作记忆预算（§7.1，≈16K token） */
export const L1_BUDGET_TOKENS = 16000;
/** 触发 compact 的占用阈值（§7.2：>85%） */
export const L1_COMPACT_THRESHOLD = 0.85;

export function createMemoryService(deps: MemoryDeps) {
  const { summaries, scenes, outline, facts, plotDevices, assets, knowledge, gateway, prompts } = deps;

  /** 摘要提示词（{kind} 占位 → 场景正文/本章各场景摘要/卷各章摘要） */
  function summaryPrompt(kind: string): string {
    return prompts.get('PROMPT_MEMORY_SUMMARY', { kind });
  }

  /** 估算某小说当前 L1 工作记忆占用（未 compact 场景正文的 token 总量，§7.1） */
  function workingMemoryTokens(novelId: string): number {
    const uncompacted = scenes.listForNovel(novelId).filter((s) => !s.compacted);
    return uncompacted.reduce((acc, s) => acc + knowledge.estimateTokens(s.content), 0);
  }

  /** 生成场景摘要并写入 L2（§4.3 pass 6） */
  async function summarizeScene(sceneId: string): Promise<string> {
    const scene = scenes.get(sceneId);
    if (!scene) return '';
    const out = (await gateway.extract({
      system: summaryPrompt('场景正文'),
      user: scene.content.slice(0, 3000),
    })).json as { summary?: string };
    const summary = typeof out.summary === 'string' ? out.summary : scene.content.slice(0, 100);
    summaries.save({ novel_id: scene.novel_id, level: 'scene', ref_id: scene.id, content: summary });
    return summary;
  }

  /**
   * compact 物化优先（§7.2）：取最旧的未 compact 场景，三步：
   *  ① 物化（Materialize）：事实卡片 + 资产写回 + 伏笔操作 → L3（细节不依赖原文）
   *  ② 摘要（Summarize）：折叠为场景摘要 → L2
   *  ③ 裁剪（Trim）：标记 compacted（原文仍在 L3 chunk，后续 RAG 取回）
   */
  async function compact(novelId: string, count = 3): Promise<{ compacted: string[]; workingTokens: number }> {
    const candidates = scenes.listOldestUncompacted(novelId, count);
    const compacted: string[] = [];

    for (const scene of candidates) {
      // ① 物化：事实卡片（去重）
      const factsOut = (await gateway.extract({
        system: prompts.get('PROMPT_MEMORY_FACTS'),
        user: scene.content.slice(0, 4000),
      })).json as { facts?: Array<{ fact: string; entities?: string[] }> };
      for (const f of factsOut.facts ?? []) {
        if (!f?.fact || facts.findDuplicate(novelId, f.fact)) continue;
        facts.create({ novel_id: novelId, fact: f.fact, entities: f.entities ?? [], source_scene_id: scene.id });
      }

      // ① 物化：资产状态变更（写回 asset_states，版本+1）
      const assetsOut = (await gateway.extract({
        system: prompts.get('PROMPT_MEMORY_ASSETS'),
        user: scene.content.slice(0, 4000),
      })).json as { changes?: Array<{ name: string; state: Record<string, unknown> }> };
      for (const change of assetsOut.changes ?? []) {
        const asset = assets.list(novelId).find((a) => a.name === change.name || a.name.includes(change.name));
        if (asset) assets.writeBack(asset.id, { state: change.state }, scene.id);
      }

      // ① 物化：伏笔操作
      const plotOut = (await gateway.extract({
        system: prompts.get('PROMPT_MEMORY_PLOT'),
        user: scene.content.slice(0, 4000),
      })).json as { ops?: Array<{ op: string; description: string; type?: string }> };
      for (const op of plotOut.ops ?? []) {
        if (!op?.description) continue;
        if (op.op === 'plant') {
          if (!plotDevices.findSimilar(novelId, op.description)) {
            plotDevices.create({
              novel_id: novelId,
              type: (op.type as never) ?? 'event',
              description: op.description,
              status: 'planted',
              planted_scene_id: scene.id,
            });
          }
        } else {
          const dev = plotDevices.findSimilar(novelId, op.description);
          if (dev) {
            plotDevices.updateStatus(dev.id, op.op === 'payoff' ? 'paid_off' : 'developing');
          }
        }
      }

      // ② 摘要（若缺失）
      const existing = summaries.latestForRef(scene.id, 'scene');
      if (!existing) {
        await summarizeScene(scene.id);
      }

      // ③ 裁剪标记（原文保留在 L3，不再进 L1）
      scenes.markCompacted(scene.id, true);
      compacted.push(scene.id);
    }

    return { compacted, workingTokens: workingMemoryTokens(novelId) };
  }

  /** §7.2 触发判断：占用 > 85% 即需 compact */
  function needsCompact(novelId: string): boolean {
    return workingMemoryTokens(novelId) / L1_BUDGET_TOKENS > L1_COMPACT_THRESHOLD;
  }

  /** 场景完成时：若工作记忆超阈值，自动触发 compact（§7.2 触发条件） */
  async function maybeAutoCompact(novelId: string, count = 3): Promise<{ did: boolean; compacted: string[] }> {
    if (!needsCompact(novelId)) return { did: false, compacted: [] };
    const result = await compact(novelId, count);
    return { did: true, compacted: result.compacted };
  }

  /** 场景完成时：若本章全部场景已生成 → 触发章摘要更新（§7.3） */
  async function maybeRollupChapter(chapterNode: OutlineNode): Promise<boolean> {
    const chapterId = chapterNode.id;
    const novelId = chapterNode.novel_id;
    const sceneNodes = outline.listForNovel(novelId).filter((n) => n.level === 'scene' && n.parent_id === chapterId);
    const sceneSummaries = summaries
      .listForNovel(novelId)
      .filter((s) => s.level === 'scene' && sceneNodes.some((n) => n.id === s.ref_id));

    // 只有全部场景都有摘要才升级章摘要
    if (sceneNodes.length > 0 && sceneSummaries.length >= sceneNodes.length) {
      const input = sceneNodes
        .map((n) => {
          const s = summaries.latestForRef(n.id, 'scene');
          return `- ${n.title ?? ''}：${s?.content ?? ''}`;
        })
        .join('\n');
      const out = (await gateway.extract({
        system: summaryPrompt('本章各场景摘要'),
        user: input,
      })).json as { summary?: string };
      const chapterSummary = typeof out.summary === 'string' ? out.summary : input.slice(0, 100);
      summaries.save({ novel_id: novelId, level: 'chapter', ref_id: chapterId, content: chapterSummary });
      return true;
    }
    return false;
  }

  /** 卷摘要更新：本卷所有章摘要齐备时触发 */
  async function maybeRollupVolume(volumeNode: OutlineNode): Promise<boolean> {
    const novelId = volumeNode.novel_id;
    const chapterNodes = outline.listForNovel(novelId).filter((n) => n.level === 'chapter' && n.parent_id === volumeNode.id);
    const chapterSummaries = summaries
      .listForNovel(novelId)
      .filter((s) => s.level === 'chapter' && chapterNodes.some((n) => n.id === s.ref_id));
    if (chapterNodes.length > 0 && chapterSummaries.length >= chapterNodes.length) {
      const input = chapterNodes
        .map((n) => {
          const s = summaries.latestForRef(n.id, 'chapter');
          return `- ${n.title ?? ''}：${s?.content ?? ''}`;
        })
        .join('\n');
      const out = (await gateway.extract({
        system: summaryPrompt('本章卷各章摘要'),
        user: input,
      })).json as { summary?: string };
      const volumeSummary = typeof out.summary === 'string' ? out.summary : input.slice(0, 100);
      summaries.save({ novel_id: novelId, level: 'volume', ref_id: volumeNode.id, content: volumeSummary });
      return true;
    }
    return false;
  }

  /** 场景生成后维护摘要树（§7.3） */
  async function rollupAfterScene(sceneNode: OutlineNode): Promise<Array<{ level: SummaryLevel; refId: string }>> {
    const updated: Array<{ level: SummaryLevel; refId: string }> = [];
    const chapterId = sceneNode.parent_id;
    if (!chapterId) return updated;
    const chapter = outline.get(chapterId);
    if (!chapter) return updated;
    if (await maybeRollupChapter(chapter)) {
      updated.push({ level: 'chapter', refId: chapter.id });
      if (chapter.parent_id) {
        const volume = outline.get(chapter.parent_id);
        if (volume && (await maybeRollupVolume(volume))) {
          updated.push({ level: 'volume', refId: volume.id });
        }
      }
    }
    return updated;
  }

  return {
    compact,
    needsCompact,
    maybeAutoCompact,
    workingMemoryTokens,
    summarizeScene,
    rollupAfterScene,
    listSummaries(novelId: string) {
      return summaries.listForNovel(novelId);
    },
    getSceneSummary(sceneId: string) {
      return summaries.latestForRef(sceneId, 'scene');
    },
    memoryStatus(novelId: string) {
      const tokens = workingMemoryTokens(novelId);
      return {
        workingTokens: tokens,
        budget: L1_BUDGET_TOKENS,
        usageRatio: tokens / L1_BUDGET_TOKENS,
        needsCompact: needsCompact(novelId),
        compactedCount: scenes.listCompacted(novelId).length,
        totalScenes: scenes.listForNovel(novelId).length,
      };
    },
  };
}

export type MemoryService = ReturnType<typeof createMemoryService>;
