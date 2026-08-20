// 模块：一致性校验（consistency）—— Phase 4 实现（§10.1）
// 职责：结构性校验（伏笔逾期 → loose_thread 冲突）+ 全小说重校验入口
// 说明：逐场景的 LLM 矛盾校验已内嵌在创作流水线（writing 的 verify pass）；
//       本模块负责「结构层」兜底：联动伏笔台账检测逾期回收，落冲突台账供人工裁决。
import type { ConflictRepository } from '../../db/repositories/conflicts.js';
import type { PlotDeviceRepository } from '../../db/repositories/plotdevices.js';
import type { PlotDeviceService } from '../plotdevices/index.js';

export interface ConsistencyDeps {
  conflicts: ConflictRepository;
  plotDevices: PlotDeviceRepository;
  plotDeviceService: PlotDeviceService;
}

export interface ConsistencyCheckResult {
  checkedAt: string;
  /** 本次新标记为遗忘的伏笔 */
  forgotten: Array<{ id: string; description: string }>;
  /** 本次新创建的 loose_thread 冲突 */
  createdConflicts: Array<{ id: string; description: string }>;
  /** 当前开放冲突总数 */
  openConflictCount: number;
  /** 伏笔台账统计 */
  stats: ReturnType<PlotDeviceService['stats']>;
}

export function createConsistencyService(deps: ConsistencyDeps) {
  const { conflicts, plotDevices, plotDeviceService } = deps;

  /**
   * 结构校验：检测伏笔逾期（§10.1 loose_thread / §10.2 遗忘），
   * 对已遗忘的伏笔创建/复用 loose_thread 冲突，供人工裁决。
   */
  async function checkLooseThreads(novelId: string): Promise<ConsistencyCheckResult> {
    // ① 先跑烂尾检测：逾期伏笔 → forgotten
    const forgotten = plotDeviceService.detectForgotten(novelId);
    const newlyForgotten = forgotten.map((d) => ({ id: d.id, description: d.description }));

    // ② 为已遗忘伏笔创建 loose_thread 冲突（去重：同描述且 open 的不重复建）
    const createdConflicts: Array<{ id: string; description: string }> = [];
    const existingOpen = conflicts.listOpen(novelId);
    for (const d of forgotten) {
      const dup = existingOpen.some((c) => c.type === 'loose_thread' && c.description.includes(d.description));
      if (dup) continue;
      const conflict = conflicts.create({
        novel_id: novelId,
        type: 'loose_thread',
        description: `伏笔「${d.description}」已超过预计回收章仍未处理（预计 ${d.expected_payoff ?? '未设定'}）`,
        evidence: { plot_device_id: d.id, status: d.status },
      });
      createdConflicts.push({ id: conflict.id, description: conflict.description });
    }

    return {
      checkedAt: new Date().toISOString(),
      forgotten: newlyForgotten,
      createdConflicts,
      openConflictCount: conflicts.countOpen(novelId),
      stats: plotDeviceService.stats(novelId),
    };
  }

  /** 手动触发一次全小说结构校验（当前实现：伏笔逾期；后续可扩展时间线/事实矛盾结构扫描） */
  async function recheck(novelId: string): Promise<ConsistencyCheckResult> {
    return checkLooseThreads(novelId);
  }

  return { checkLooseThreads, recheck };
}

export type ConsistencyService = ReturnType<typeof createConsistencyService>;
