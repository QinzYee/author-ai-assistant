import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { OutlineService } from '../modules/outline/index.js';
import type { OutlineNodeInput, GenerateOutlineRequest, ApiResponse } from '../../shared/index.js';

interface Params {
  novelId: string;
  id: string;
}

export function registerOutlineRoutes(app: FastifyInstance, deps: { outline: OutlineService }) {
  const { outline } = deps;

  // 整棵大纲树
  app.get(
    '/api/novels/:novelId/outline',
    async (req: FastifyRequest<{ Params: { novelId: string } }>): Promise<ApiResponse<unknown[]>> => {
      return { ok: true, data: outline.list(req.params.novelId) };
    }
  );

  app.get(
    '/api/novels/:novelId/outline/:id',
    async (req: FastifyRequest<{ Params: Params }>, reply: FastifyReply): Promise<ApiResponse<unknown>> => {
      const node = outline.get(req.params.id);
      if (!node) {
        reply.code(404);
        return { ok: false, error: 'outline node not found' };
      }
      return { ok: true, data: node };
    }
  );

  app.post(
    '/api/novels/:novelId/outline',
    async (req: FastifyRequest<{ Params: { novelId: string }; Body: OutlineNodeInput }>, reply: FastifyReply): Promise<ApiResponse<unknown>> => {
      const input = { novel_id: req.params.novelId, ...req.body };
      if (!input.level) {
        reply.code(400);
        return { ok: false, error: 'level 必填' };
      }
      const node = outline.create(input);
      reply.code(201);
      return { ok: true, data: node };
    }
  );

  app.patch(
    '/api/novels/:novelId/outline/:id',
    async (req: FastifyRequest<{ Params: Params; Body: Partial<OutlineNodeInput> }>, reply: FastifyReply): Promise<ApiResponse<unknown>> => {
      const node = outline.update(req.params.id, req.body);
      if (!node) {
        reply.code(404);
        return { ok: false, error: 'outline node not found' };
      }
      return { ok: true, data: node };
    }
  );

  app.delete(
    '/api/novels/:novelId/outline/:id',
    async (req: FastifyRequest<{ Params: Params }>, reply: FastifyReply): Promise<ApiResponse<boolean>> => {
      if (!outline.remove(req.params.id)) {
        reply.code(404);
        return { ok: false, error: 'outline node not found' };
      }
      return { ok: true, data: true };
    }
  );

  // 分层生成（§4.2）
  app.post(
    '/api/novels/:novelId/outline/generate',
    async (req: FastifyRequest<{ Params: { novelId: string }; Body: GenerateOutlineRequest }>, reply: FastifyReply): Promise<ApiResponse<unknown>> => {
      if (!req.body?.layer) {
        reply.code(400);
        return { ok: false, error: 'layer 必填' };
      }
      try {
        const result = await outline.generateLayer(req.params.novelId, req.body);
        return { ok: true, data: result };
      } catch (err) {
        const message = (err as Error).message;
        if (/请先|请先选择/.test(message)) {
          reply.code(409);
        }
        return { ok: false, error: message };
      }
    }
  );
}
