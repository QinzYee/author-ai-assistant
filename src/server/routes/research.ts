import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ResearchService } from '../modules/research/index.js';
import type { ApiResponse } from '../../shared/index.js';

export function registerResearchRoutes(app: FastifyInstance, deps: { research: ResearchService }) {
  const { research } = deps;

  app.get(
    '/api/novels/:novelId/research',
    async (req: FastifyRequest<{ Params: { novelId: string } }>): Promise<ApiResponse<unknown>> => {
      return { ok: true, data: research.latest(req.params.novelId) };
    }
  );

  app.get(
    '/api/novels/:novelId/research/history',
    async (req: FastifyRequest<{ Params: { novelId: string } }>): Promise<ApiResponse<unknown[]>> => {
      return { ok: true, data: research.list(req.params.novelId) };
    }
  );

  app.post(
    '/api/novels/:novelId/research',
    async (req: FastifyRequest<{ Params: { novelId: string }; Body: { query?: string } }>, reply: FastifyReply): Promise<ApiResponse<unknown>> => {
      try {
        const result = await research.runResearch(req.params.novelId, req.body?.query ?? '');
        return { ok: true, data: result };
      } catch (err) {
        const message = (err as Error).message;
        if (/未配置|API Key|tavily/i.test(message)) {
          reply.code(503);
        }
        return { ok: false, error: message };
      }
    }
  );
}
