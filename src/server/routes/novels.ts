import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { NovelRepository } from '../db/repositories/novels.js';
import type { NewNovel, ApiResponse } from '../../shared/index.js';

export function registerNovelRoutes(app: FastifyInstance, deps: { novels: NovelRepository }) {
  app.get(
    '/api/novels',
    async (): Promise<ApiResponse<unknown[]>> => {
      return { ok: true, data: deps.novels.list() };
    }
  );

  app.get(
    '/api/novels/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<ApiResponse<unknown>> => {
      const novel = deps.novels.get(req.params.id);
      if (!novel) {
        reply.code(404);
        return { ok: false, error: 'novel not found' };
      }
      return { ok: true, data: novel };
    }
  );

  app.post(
    '/api/novels',
    async (req: FastifyRequest<{ Body: NewNovel }>, reply: FastifyReply): Promise<ApiResponse<unknown>> => {
      if (!req.body?.title?.trim()) {
        reply.code(400);
        return { ok: false, error: 'title 不能为空' };
      }
      const novel = deps.novels.create({ ...req.body, title: req.body.title.trim() });
      reply.code(201);
      return { ok: true, data: novel };
    }
  );

  app.delete(
    '/api/novels/:id',
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<ApiResponse<boolean>> => {
      const removed = deps.novels.remove(req.params.id);
      if (!removed) {
        reply.code(404);
        return { ok: false, error: 'novel not found' };
      }
      return { ok: true, data: true };
    }
  );
}
