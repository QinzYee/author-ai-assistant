import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SettingsService, LlmSettingsPayload } from '../modules/settings/index.js';
import type { ApiResponse } from '../../shared/index.js';

export function registerSettingsRoutes(app: FastifyInstance, deps: { settings: SettingsService }) {
  const { settings } = deps;

  /** 当前生效的 LLM 设置（密钥脱敏）+ 来源 */
  app.get(
    '/api/settings',
    async (): Promise<ApiResponse<unknown>> => {
      return { ok: true, data: settings.publicSettings() };
    }
  );

  /** 保存设置（空字符串清除该项，回退 env）；保存后网关热生效 */
  app.put(
    '/api/settings',
    async (req: FastifyRequest<{ Body: Partial<LlmSettingsPayload> }>, reply: FastifyReply): Promise<ApiResponse<unknown>> => {
      const body = req.body ?? {};
      if (typeof body !== 'object' || Array.isArray(body)) {
        reply.code(400);
        return { ok: false, error: '请求体必须为设置对象' };
      }
      const result = settings.save(body as LlmSettingsPayload);
      return { ok: true, data: result };
    }
  );

  /** 测试连接有效性：对 generate/extract/embed 各发最小请求 */
  app.post(
    '/api/settings/test',
    async (req: FastifyRequest<{ Body?: { payload?: Partial<LlmSettingsPayload> } }>): Promise<ApiResponse<unknown>> => {
      // 若附带 payload，先临时保存再测试（测试失败不保留）？—— 简单起见：仅测试当前生效配置
      // 前端「测试」先调用 PUT 保存，再调用本接口，即可测到最新配置
      const result = await settings.testConnection();
      return { ok: true, data: result };
    }
  );
}
