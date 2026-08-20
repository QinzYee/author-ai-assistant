// 模块：伏笔台账（plotdevices）—— Phase 4 实现（§10.2）
// 职责：埋设/发展/回收/遗忘全生命周期跟踪 + 烂尾风险（forgotten）自动检测 + 台账统计
import type { PlotDeviceRepository } from '../../db/repositories/plotdevices.js';
import type { OutlineRepository } from '../../db/repositories/outline.js';
import type { SceneRepository } from '../../db/repositories/scenes.js';
import type { PlotDevice, PlotDeviceStatus } from '../../../shared/index.js';

export interface PlotDeviceDeps {
  repo: PlotDeviceRepository;
  outline: OutlineRepository;
  scenes: SceneRepository;
}

export interface PlotDeviceStats {
  planted: number;
  developing: number;
  paid_off: number;
  abandoned: number;
  forgotten: number;
  total: number;
  /** 待处理（planted/developing）数量 */
  due: number;
  /** 当前已完成的章数（用于判断回收是否逾期） */
  chaptersWritten: number;
}

/** 从「预计回收」文本中解析章号（如"第5章"、"第10章结束前" → 5/10）；解析不到返回 null */
export function parseExpectedChapter(expectedPayoff: string | null): number | null {
  if (!expectedPayoff) return null;
  const m = expectedPayoff.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** 宽容度：预计回收章 + tolerance 章仍未回收 → 判定遗忘（§10.2） */
const FORGOTTEN_TOLERANCE = 2;

export function createPlotDeviceService(deps: PlotDeviceDeps) {
  const { repo, outline, scenes } = deps;

  /** 统计某部小说的伏笔台账（按状态分组） */
  function stats(novelId: string): PlotDeviceStats {
    const all = repo.list(novelId);
    const count = (status: PlotDeviceStatus) => all.filter((d) => d.status === status).length;
    const chaptersWritten = countChaptersWritten(novelId);
    return {
      planted: count('planted'),
      developing: count('developing'),
      paid_off: count('paid_off'),
      abandoned: count('abandoned'),
      forgotten: count('forgotten'),
      total: all.length,
      due: count('planted') + count('developing'),
      chaptersWritten,
    };
  }

  /** 当前已写正文的章数：章的任一场景有正文即计 1 */
  function countChaptersWritten(novelId: string): number {
    const nodes = outline.listForNovel(novelId);
    const chapters = nodes.filter((n) => n.level === 'chapter');
    if (chapters.length === 0) return 0;
    const sceneNodes = nodes.filter((n) => n.level === 'scene');
    const writtenSceneNodeIds = new Set(
      scenes.listForNovel(novelId).map((s) => s.outline_node_id).filter(Boolean) as string[]
    );
    let written = 0;
    for (const ch of chapters) {
      const hasWritten = sceneNodes.some((s) => s.parent_id === ch.id && writtenSceneNodeIds.has(s.id));
      if (hasWritten) written++;
    }
    return written;
  }

  /**
   * 烂尾风险检测（§10.2 遗忘）：planted/developing 的伏笔若
   * 「当前已写章数 ≥ 预计回收章 + tolerance」则标记为 forgotten。
   * 返回本次新标记遗忘的设备列表。
   */
  function detectForgotten(novelId: string, tolerance = FORGOTTEN_TOLERANCE): PlotDevice[] {
    const chaptersWritten = countChaptersWritten(novelId);
    const due = repo.listDue(novelId);
    const newlyForgotten: PlotDevice[] = [];
    for (const d of due) {
      const expected = parseExpectedChapter(d.expected_payoff);
      if (expected === null) continue; // 未设定回收章，不判定
      if (chaptersWritten >= expected + tolerance) {
        const updated = repo.updateStatus(d.id, 'forgotten');
        if (updated) newlyForgotten.push(updated);
      }
    }
    return newlyForgotten;
  }

  /** 按状态推进（供 UI 人工操作） */
  function advance(novelId: string, id: string, status: PlotDeviceStatus): PlotDevice | null {
    return repo.updateStatus(id, status);
  }

  return { stats, detectForgotten, advance, countChaptersWritten, parseExpectedChapter };
}

export type PlotDeviceService = ReturnType<typeof createPlotDeviceService>;
