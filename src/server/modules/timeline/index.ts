// 模块：时间线（timeline）—— Phase 3 遗留「时间线」功能（§9.2 时间旅行 / §9.3 时间轴可视化）
// 职责：把资产状态快照（asset_states）映射到小说内章节顺序，形成「第 N 章时谁在哪/伤势如何」的可视化时间线；
//       并提供按章时间旅行查询（写第 30 章时，林晚在第 20 章是什么状态）。
import type { AssetRepository } from '../../db/repositories/assets.js';
import type { OutlineRepository } from '../../db/repositories/outline.js';
import type { Asset, AssetState, AssetType, OutlineNode } from '../../../shared/index.js';

export interface TimelineDeps {
  assets: AssetRepository;
  outline: OutlineRepository;
}

/** 单个状态快照 + 其所在场景/章的定位信息 */
export interface TimelineSnapshot extends AssetState {
  sceneTitle: string | null;
  chapterId: string | null;
  chapterTitle: string | null;
  chapterOrder: number | null;
}

/** 一部小说的资产时间线 */
export interface NovelTimeline {
  /** 按 sort_order 排序的章列表（有资产状态变化的章） */
  chapters: Array<{ id: string; title: string | null; order: number }>;
  /** 每个资产的快照序列（按 version 升序） */
  assets: Array<{
    id: string;
    name: string;
    type: AssetType;
    currentVersion: number;
    snapshots: TimelineSnapshot[];
  }>;
  /** 无任何快照的资产（仅建档，便于完整展示） */
  assetless: Array<{ id: string; name: string; type: AssetType; currentVersion: number }>;
}

/** 按章时间旅行查询结果 */
export interface ChapterStateView {
  chapterId: string | null;
  chapterTitle: string | null;
  chapterOrder: number | null;
  /** 每个资产在该章（含此前）的最新状态 */
  states: Array<{
    assetId: string;
    name: string;
    type: AssetType;
    version: number;
    state: Record<string, unknown>;
    sourceSceneId: string | null;
  }>;
}

export function createTimelineService(deps: TimelineDeps) {
  const { assets, outline } = deps;

  /** 解析资产状态快照所在场景/章 */
  function locateSnapshot(snapshot: AssetState): TimelineSnapshot {
    let sceneTitle: string | null = null;
    let chapterId: string | null = null;
    let chapterTitle: string | null = null;
    let chapterOrder: number | null = null;

    if (snapshot.source_scene_id) {
      const sceneNode = outline.get(snapshot.source_scene_id);
      if (sceneNode) {
        sceneTitle = sceneNode.title;
        if (sceneNode.parent_id) {
          const chapter = outline.get(sceneNode.parent_id);
          if (chapter) {
            chapterId = chapter.id;
            chapterTitle = chapter.title;
            chapterOrder = chapter.sort_order;
          }
        }
      }
    }
    return { ...snapshot, sceneTitle, chapterId, chapterTitle, chapterOrder };
  }

  /** 构建整部小说的资产时间线 */
  function build(novelId: string): NovelTimeline {
    const allAssets = assets.list(novelId);
    const timelineAssets: NovelTimeline['assets'] = [];
    const assetless: NovelTimeline['assetless'] = [];
    const chapterMap = new Map<string, { id: string; title: string | null; order: number }>();

    for (const a of allAssets) {
      const states = assets.getStateHistory(a.id);
      const snapshots = states.map(locateSnapshot);
      // 收集涉及的章
      for (const s of snapshots) {
        if (s.chapterId && !chapterMap.has(s.chapterId)) {
          chapterMap.set(s.chapterId, {
            id: s.chapterId,
            title: s.chapterTitle,
            order: s.chapterOrder ?? 0,
          });
        }
      }
      if (snapshots.length > 0) {
        timelineAssets.push({
          id: a.id,
          name: a.name,
          type: a.type,
          currentVersion: a.current_version,
          snapshots,
        });
      } else {
        assetless.push({ id: a.id, name: a.name, type: a.type, currentVersion: a.current_version });
      }
    }

    const chapters = [...chapterMap.values()].sort((x, y) => x.order - y.order);
    return { chapters, assets: timelineAssets, assetless };
  }

  /**
   * 按章时间旅行查询（§9.2）：给定一个章 id（或章序号），返回每个资产在该章（含此前）的最新状态。
   * - 通过章 id 或 order 定位目标章
   * - 对每个资产：取其全部快照，筛选 source_scene 所在章 order <= 目标章 order 的，取 version 最大者
   */
  function stateAtChapter(novelId: string, chapterRef: { id?: string; order?: number }): ChapterStateView | null {
    const nodes = outline.listForNovel(novelId);
    const chapters = nodes.filter((n) => n.level === 'chapter').sort((a, b) => a.sort_order - b.sort_order);
    let target: OutlineNode | undefined;
    if (chapterRef.id) {
      target = chapters.find((c) => c.id === chapterRef.id);
    } else if (chapterRef.order !== undefined) {
      target = chapters.find((c) => c.sort_order === chapterRef.order);
    }
    if (!target) return null;

    const targetOrder = target.sort_order;
    const allAssets = assets.list(novelId);
    const states: ChapterStateView['states'] = [];

    for (const a of allAssets) {
      const history = assets.getStateHistory(a.id);
      let best: (AssetState & { chapterOrder?: number | null }) | null = null;
      let anyLocatable = false; // 是否存在能定位到章的快照
      let unlocatable: AssetState | null = null; // 无法定位章的快照（手动写回），取其中最新一版

      for (const s of history) {
        let chapterOrder: number | null = null;
        if (s.source_scene_id) {
          const sceneNode = outline.get(s.source_scene_id);
          if (sceneNode?.parent_id) {
            const chapter = outline.get(sceneNode.parent_id);
            if (chapter) chapterOrder = chapter.sort_order;
          }
        }
        if (chapterOrder !== null) {
          anyLocatable = true;
          // 快照发生在目标章及以前 → 候选（取 version 最大）
          if (chapterOrder <= targetOrder) {
            if (!best || s.version > best.version) best = { ...s, chapterOrder };
          }
        } else {
          // 无章信息（手动写回）：记录最新一版作为兜底
          if (!unlocatable || s.version > unlocatable.version) unlocatable = s;
        }
      }

      // 兜底：仅当资产没有可定位到章的快照（纯手动写回）时，用最新一版作为该章的状态
      if (!best && !anyLocatable && unlocatable) {
        best = { ...unlocatable, chapterOrder: null };
      }
      if (best) {
        states.push({
          assetId: a.id,
          name: a.name,
          type: a.type,
          version: best.version,
          state: best.state as Record<string, unknown>,
          sourceSceneId: best.source_scene_id,
        });
      }
    }

    return {
      chapterId: target.id,
      chapterTitle: target.title,
      chapterOrder: targetOrder,
      states,
    };
  }

  return { build, stateAtChapter };
}

export type TimelineService = ReturnType<typeof createTimelineService>;
