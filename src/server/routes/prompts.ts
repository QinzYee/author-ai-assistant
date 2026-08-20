import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PromptsService } from '../modules/prompts/index.js';
import type { ApiResponse } from '../../shared/index.js';

export function registerPromptsRoutes(app: FastifyInstance, deps: { prompts: PromptsService }) {
  const { prompts } = deps;

  /** 全部提示词（默认值 + 当前覆盖值 + 来源） */
  app.get(
    '/api/settings/prompts',
    async (): Promise<ApiResponse<unknown>> => {
      return { ok: true, data: prompts.all() };
    }
  );

  /** 保存提示词覆盖（空字符串 = 恢复默认）；保存后热生效 */
  app.put(
    '/api/settings/prompts',
    async (req: FastifyRequest<{ Body: Record<string, string> }>, reply: FastifyReply): Promise<ApiResponse<unknown>> => {
      const body = req.body ?? {};
      if (typeof body !== 'object' || Array.isArray(body)) {
        reply.code(400);
        return { ok: false, error: '请求体必须为提示词对象' };
      }
      const result = prompts.save(body as Record<string, string>);
      return { ok: true, data: result };
    }
  );
}
