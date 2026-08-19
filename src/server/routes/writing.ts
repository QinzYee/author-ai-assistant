import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WritingService } from '../modules/writing/index.js';
import type { MemoryService } from '../modules/memory/index.js';
import type { ApiResponse } from '../../shared/index.js';

export interface WritingDataDeps {
  facts: ReturnType<typeof import('../db/index.js').createFactCardRepository>;
  summaries: ReturnType<typeof import('../db/index.js').createSummaryRepository>;
  chunks: ReturnType<typeof import('../db/index.js').createChunkRepository>;
  conflicts: ReturnType<typeof import('../db/index.js').createConflictRepository>;
  plotDevices: ReturnType<typeof import('../db/index.js').createPlotDeviceRepository>;
}

export function registerWritingRoutes(app: FastifyInstance, deps: { writing: WritingService; data: WritingDataDeps; memory: MemoryService }) {
  const { writing, data, memory } = deps;

  // 场景列表
  app.get(
    '/api/novels/:novelId/scenes',
    async (req: FastifyRequest<{ Params: { novelId: string } }>): Promise<ApiResponse<unknown[]>> => {
      return { ok: true, data: writing.listScenes(req.params.novelId) };
    }
  );

  app.get(
    '/api/novels/:novelId/scenes/:id',
    async (req: FastifyRequest<{ Params: { novelId: string; id: string } }>, reply: FastifyReply): Promise<ApiResponse<unknown>> => {
      const scene = writing.getScene(req.params.id);
      if (!scene) {
        reply.code(404);
        return { ok: false, error: 'scene not found' };
      }
      return { ok: true, data: scene };
    }
  );

  app.patch(
    '/api/novels/:novelId/scenes/:id',
    async (req: FastifyRequest<{ Params: { novelId: string; id: string }; Body: { content?: string; status?: 'draft' | 'revised' | 'approved' } }>, reply: FastifyReply): Promise<ApiResponse<unknown>> => {
      const scene = writing.updateScene(req.params.id, req.body);
      if (!scene) {
        reply.code(404);
        return { ok: false, error: 'scene not found' };
      }
      return { ok: true, data: scene };
    }
  );

  app.delete(
    '/api/novels/:novelId/scenes/:id',
    async (req: FastifyRequest<{ Params: { novelId: string; id: string } }>, reply: FastifyReply): Promise<ApiResponse<boolean>> => {
      if (!writing.removeScene(req.params.id)) {
        reply.code(404);
        return { ok: false, error: 'scene not found' };
      }
      return { ok: true, data: true };
    }
  );

  // 场景生成 —— SSE 流式（§12.2 进度反馈必须做）
  app.post(
    '/api/novels/:novelId/writing/generate',
    async (req: FastifyRequest<{ Params: { novelId: string }; Body: { outline_node_id: string; override_body?: string } }>, reply: FastifyReply) => {
      const { novelId } = req.params;
      const { outline_node_id: outlineNodeId, override_body: overrideBody } = req.body ?? {};
      if (!outlineNodeId) {
        reply.code(400);
        return { ok: false, error: 'outline_node_id 必填' };
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const sse = (ev: unknown) => {
        reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
      };

      try {
        await writing.generateScene(novelId, outlineNodeId, {
          overrideBody,
          onEvent: (ev) => sse(ev),
        });
      } catch (err) {
        sse({ type: 'error', error: (err as Error).message });
      } finally {
        reply.raw.end();
      }
    }
  );

  // ---- 创作数据只读接口 ----
  app.get('/api/novels/:novelId/facts', async (req: FastifyRequest<{ Params: { novelId: string } }>): Promise<ApiResponse<unknown[]>> => {
    return { ok: true, data: data.facts.listActive(req.params.novelId) };
  });
  app.get('/api/novels/:novelId/summaries', async (req: FastifyRequest<{ Params: { novelId: string } }>): Promise<ApiResponse<unknown[]>> => {
    return { ok: true, data: data.summaries.listForNovel(req.params.novelId) };
  });
  app.get('/api/novels/:novelId/chunks', async (req: FastifyRequest<{ Params: { novelId: string } }>): Promise<ApiResponse<unknown[]>> => {
    return { ok: true, data: data.chunks.listByNovel(req.params.novelId) };
  });
  app.get('/api/novels/:novelId/conflicts', async (req: FastifyRequest<{ Params: { novelId: string } }>): Promise<ApiResponse<unknown[]>> => {
    return { ok: true, data: data.conflicts.listForNovel(req.params.novelId) };
  });
  app.get('/api/novels/:novelId/plotdevices', async (req: FastifyRequest<{ Params: { novelId: string } }>): Promise<ApiResponse<unknown[]>> => {
    return { ok: true, data: data.plotDevices.list(req.params.novelId) };
  });

  // 冲突人工裁决（§10.1 处置层）：resolved / ignored
  app.patch(
    '/api/novels/:novelId/conflicts/:id',
    async (req: FastifyRequest<{ Params: { novelId: string; id: string }; Body: { status: 'open' | 'auto_fixed' | 'resolved' | 'ignored'; resolution?: string } }>, reply: FastifyReply): Promise<ApiResponse<unknown>> => {
      if (!req.body?.status) {
        reply.code(400);
        return { ok: false, error: 'status 必填' };
      }
      const conflict = data.conflicts.updateStatus(req.params.id, req.body.status, req.body.resolution ?? null);
      if (!conflict) {
        reply.code(404);
        return { ok: false, error: 'conflict not found' };
      }
      return { ok: true, data: conflict };
    }
  );

  // 伏笔状态推进（§10.2）：develop / payoff / abandoned
  app.patch(
    '/api/novels/:novelId/plotdevices/:id',
    async (req: FastifyRequest<{ Params: { novelId: string; id: string }; Body: { status: 'planted' | 'developing' | 'paid_off' | 'abandoned' | 'forgotten' } }>, reply: FastifyReply): Promise<ApiResponse<unknown>> => {
      if (!req.body?.status) {
        reply.code(400);
        return { ok: false, error: 'status 必填' };
      }
      const device = data.plotDevices.updateStatus(req.params.id, req.body.status);
      if (!device) {
        reply.code(404);
        return { ok: false, error: 'plot device not found' };
      }
      return { ok: true, data: device };
    }
  );

  // ---- 记忆（§7） ----
  app.get('/api/novels/:novelId/memory', async (req: FastifyRequest<{ Params: { novelId: string } }>): Promise<ApiResponse<unknown>> => {
    return { ok: true, data: memory.memoryStatus(req.params.novelId) };
  });
  // 手动触发 compact（§7.2 物化优先）
  app.post('/api/novels/:novelId/memory/compact', async (req: FastifyRequest<{ Params: { novelId: string }; Body?: { count?: number } }>): Promise<ApiResponse<unknown>> => {
    const result = await memory.compact(req.params.novelId, req.body?.count ?? 3);
    return { ok: true, data: result };
  });
}
