import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ConsistencyService } from '../modules/consistency/index.js';
import type { PlotDeviceService } from '../modules/plotdevices/index.js';
import type { FactCardRepository } from '../db/repositories/facts.js';
import type { ApiResponse } from '../../shared/index.js';

export interface QualityDeps {
  consistency: ConsistencyService;
  plotDevices: PlotDeviceService;
  facts: FactCardRepository;
}

export function registerQualityRoutes(app: FastifyInstance, deps: QualityDeps) {
  const { consistency, plotDevices, facts } = deps;

  /** 全小说一致性重校验（结构层：伏笔逾期 → loose_thread 冲突） */
  app.post(
    '/api/novels/:novelId/consistency/check',
    async (req: FastifyRequest<{ Params: { novelId: string } }>): Promise<ApiResponse<unknown>> => {
      const result = await consistency.recheck(req.params.novelId);
      return { ok: true, data: result };
    }
  );

  /** 伏笔台账统计 */
  app.get(
    '/api/novels/:novelId/plotdevices/stats',
    async (req: FastifyRequest<{ Params: { novelId: string } }>): Promise<ApiResponse<unknown>> => {
      return { ok: true, data: plotDevices.stats(req.params.novelId) };
    }
  );

  /** 手动触发伏笔逾期检测（标记 forgotten） */
  app.post(
    '/api/novels/:novelId/plotdevices/detect-forgotten',
    async (req: FastifyRequest<{ Params: { novelId: string } }>): Promise<ApiResponse<unknown>> => {
      const forgotten = plotDevices.detectForgotten(req.params.novelId);
      return { ok: true, data: { forgotten } };
    }
  );

  /** 事实卡片全部列表（含 superseded/retracted，供面板归档查看） */
  app.get(
    '/api/novels/:novelId/facts/all',
    async (req: FastifyRequest<{ Params: { novelId: string } }>): Promise<ApiResponse<unknown[]>> => {
      return { ok: true, data: facts.listAll(req.params.novelId) };
    }
  );

  /** 事实卡片人工处置：active（恢复）/ superseded（作废）/ retracted（撤回） */
  app.patch(
    '/api/novels/:novelId/facts/:id',
    async (req: FastifyRequest<{ Params: { novelId: string; id: string }; Body: { status: 'active' | 'superseded' | 'retracted' } }>, reply: FastifyReply): Promise<ApiResponse<unknown>> => {
      const status = req.body?.status;
      if (status !== 'active' && status !== 'superseded' && status !== 'retracted') {
        reply.code(400);
        return { ok: false, error: 'status 必须为 active / superseded / retracted' };
      }
      const updated = facts.updateStatus(req.params.id, status);
      if (!updated) {
        reply.code(404);
        return { ok: false, error: 'fact not found' };
      }
      return { ok: true, data: updated };
    }
  );
}
