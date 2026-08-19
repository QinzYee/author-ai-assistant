import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { TimelineService } from '../modules/timeline/index.js';
import type { ApiResponse } from '../../shared/index.js';

export function registerTimelineRoutes(app: FastifyInstance, deps: { timeline: TimelineService }) {
  // 整部小说的资产状态时间线（§9.3）
  app.get(
    '/api/novels/:novelId/timeline',
    async (req: FastifyRequest<{ Params: { novelId: string } }>): Promise<ApiResponse<unknown>> => {
      return { ok: true, data: deps.timeline.build(req.params.novelId) };
    }
  );

  // 按章时间旅行查询（§9.2）：GET ?chapter=<chapterId> 或 ?order=<N>
  app.get(
    '/api/novels/:novelId/timeline/at',
    async (req: FastifyRequest<{ Params: { novelId: string }; Querystring: { chapter?: string; order?: string } }>, reply): Promise<ApiResponse<unknown>> => {
      const { chapter, order } = req.query;
      if (!chapter && order === undefined) {
        reply.code(400);
        return { ok: false, error: '需要 chapter 或 order 参数' };
      }
      const result = deps.timeline.stateAtChapter(req.params.novelId, {
        id: chapter || undefined,
        order: order !== undefined ? Number(order) : undefined,
      });
      if (!result) {
        reply.code(404);
        return { ok: false, error: '章不存在' };
      }
      return { ok: true, data: result };
    }
  );
}
