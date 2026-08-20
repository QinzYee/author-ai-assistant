import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SettingsService } from '../modules/settings/index.js';
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

  /** 保存设置（key 为 DB key 或 camelCase 字段名；空字符串清除该项，回退 env）；保存后网关热生效 */
  app.put(
    '/api/settings',
    async (req: FastifyRequest<{ Body: Record<string, string> }>, reply: FastifyReply): Promise<ApiResponse<unknown>> => {
      const body = req.body ?? {};
      if (typeof body !== 'object' || Array.isArray(body)) {
        reply.code(400);
        return { ok: false, error: '请求体必须为设置对象' };
      }
      const result = settings.save(body as Record<string, string>);
      return { ok: true, data: result };
    }
  );

  /** 测试连接有效性：对 generate/extract/embed 各发最小请求。
   * 请求体可携带 `payload`（当前屏幕上的配置，含未保存草稿）——仅本次测试生效、不落库；
   * 不带 payload 则测试当前已生效配置。 */
  app.post(
    '/api/settings/test',
    async (req: FastifyRequest<{ Body?: { payload?: Record<string, string> } }>): Promise<ApiResponse<unknown>> => {
      const payload = req.body?.payload ?? {};
      if (typeof payload !== 'object' || Array.isArray(payload)) {
        return { ok: false, error: 'payload 必须为设置对象' };
      }
      const result = await settings.testConnection(payload as Record<string, string>);
      return { ok: true, data: result };
    }
  );
}
