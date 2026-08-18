import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AssetService } from '../modules/assets/index.js';
import type { AssetInput, AssetWriteBack, ApiResponse } from '../../shared/index.js';

interface Params {
  novelId: string;
  id: string;
}

export function registerAssetRoutes(app: FastifyInstance, deps: { assets: AssetService }) {
  const { assets } = deps;

  app.get(
    '/api/novels/:novelId/assets',
    async (req: FastifyRequest<{ Params: { novelId: string }; Querystring: { type?: string } }>): Promise<ApiResponse<unknown[]>> => {
      const list = req.query.type ? assets.list(req.params.novelId, req.query.type) : assets.list(req.params.novelId);
      return { ok: true, data: list };
    }
  );

  app.get(
    '/api/novels/:novelId/assets/relations',
    async (req: FastifyRequest<{ Params: { novelId: string } }>): Promise<ApiResponse<unknown[]>> => {
      return { ok: true, data: assets.relations(req.params.novelId) };
    }
  );

  app.post(
    '/api/novels/:novelId/assets',
    async (req: FastifyRequest<{ Params: { novelId: string }; Body: AssetInput }>, reply: FastifyReply): Promise<ApiResponse<unknown>> => {
      if (!req.body?.name?.trim() || !req.body?.type) {
        reply.code(400);
        return { ok: false, error: 'name 与 type 必填' };
      }
      const asset = assets.create(req.params.novelId, req.body);
      reply.code(201);
      return { ok: true, data: asset };
    }
  );

  app.get(
    '/api/novels/:novelId/assets/:id',
    async (req: FastifyRequest<{ Params: Params }>, reply: FastifyReply): Promise<ApiResponse<unknown>> => {
      const asset = assets.get(req.params.id);
      if (!asset) {
        reply.code(404);
        return { ok: false, error: 'asset not found' };
      }
      return { ok: true, data: asset };
    }
  );

  app.patch(
    '/api/novels/:novelId/assets/:id',
    async (req: FastifyRequest<{ Params: Params; Body: Partial<AssetInput> }>, reply: FastifyReply): Promise<ApiResponse<unknown>> => {
      const asset = assets.update(req.params.id, req.body);
      if (!asset) {
        reply.code(404);
        return { ok: false, error: 'asset not found' };
      }
      return { ok: true, data: asset };
    }
  );

  /** 写回：版本 +1（§9.2） */
  app.post(
    '/api/novels/:novelId/assets/:id/writeback',
    async (req: FastifyRequest<{ Params: Params; Body: AssetWriteBack }>, reply: FastifyReply): Promise<ApiResponse<unknown>> => {
      const asset = assets.writeBack(req.params.id, req.body);
      if (!asset) {
        reply.code(404);
        return { ok: false, error: 'asset not found' };
      }
      return { ok: true, data: asset };
    }
  );

  /** 版本历史（时间旅行查询） */
  app.get(
    '/api/novels/:novelId/assets/:id/states',
    async (req: FastifyRequest<{ Params: Params }>): Promise<ApiResponse<unknown[]>> => {
      return { ok: true, data: assets.getStateHistory(req.params.id) };
    }
  );

  app.delete(
    '/api/novels/:novelId/assets/:id',
    async (req: FastifyRequest<{ Params: Params }>, reply: FastifyReply): Promise<ApiResponse<boolean>> => {
      if (!assets.remove(req.params.id)) {
        reply.code(404);
        return { ok: false, error: 'asset not found' };
      }
      return { ok: true, data: true };
    }
  );
}
