// 三级记忆（§7）—— Phase 2 提供 L2 摘要树的滚动维护；
// L1 工作记忆与 compact（物化优先）在 Phase 3 实现。
import type { LlmGateway } from '../../llm/index.js';
import type { SummaryRepository } from '../../db/repositories/summaries.js';
import type { SceneRepository } from '../../db/repositories/scenes.js';
import type { OutlineRepository } from '../../db/repositories/outline.js';
import type { OutlineNode, SummaryLevel } from '../../../shared/index.js';

export interface MemoryDeps {
  summaries: SummaryRepository;
  scenes: SceneRepository;
  outline: OutlineRepository;
  gateway: LlmGateway;
}

const SUMMARY_PROMPT = (kind: string) =>
  `你是小说情节记忆整理器。将给定的${kind}内容压缩为简洁的情节摘要（保留关键事件、人物状态变化、伏笔推进），150 字以内，只输出 JSON：{"summary":"..."}`;

export function createMemoryService(deps: MemoryDeps) {
  const { summaries, scenes, outline, gateway } = deps;

  /** 生成场景摘要并写入 L2（§4.3 pass 6） */
  async function summarizeScene(sceneId: string): Promise<string> {
    const scene = scenes.get(sceneId);
    if (!scene) return '';
    const out = (await gateway.extract({
      system: SUMMARY_PROMPT('场景正文'),
      user: scene.content.slice(0, 3000),
    })).json as { summary?: string };
    const summary = typeof out.summary === 'string' ? out.summary : scene.content.slice(0, 100);
    summaries.save({ novel_id: scene.novel_id, level: 'scene', ref_id: scene.id, content: summary });
    return summary;
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
        system: SUMMARY_PROMPT('本章各场景摘要'),
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
        system: SUMMARY_PROMPT('本章卷各章摘要'),
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
    summarizeScene,
    rollupAfterScene,
    listSummaries(novelId: string) {
      return summaries.listForNovel(novelId);
    },
    getSceneSummary(sceneId: string) {
      return summaries.latestForRef(sceneId, 'scene');
    },
  };
}

export type MemoryService = ReturnType<typeof createMemoryService>;
