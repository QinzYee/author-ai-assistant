import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ExportService } from '../modules/export/index.js';
import type { ExportFormat } from '../modules/export/index.js';

export function registerExportRoutes(app: FastifyInstance, deps: { export: ExportService }) {
  // GET /api/novels/:novelId/export?format=md|epub|docx
  app.get(
    '/api/novels/:novelId/export',
    async (req: FastifyRequest<{ Params: { novelId: string }; Querystring: { format?: string } }>, reply: FastifyReply) => {
      const format = (req.query.format ?? 'md') as ExportFormat;
      if (!['md', 'epub', 'docx'].includes(format)) {
        reply.code(400);
        return { ok: false, error: 'format 必须为 md/epub/docx' };
      }
      try {
        const result = await deps.export.export(req.params.novelId, format);
        reply.header('Content-Type', result.mime);
        reply.header('Content-Disposition', `attachment; filename="${result.filename}"`);
        return reply.send(result.content);
      } catch (err) {
        const message = (err as Error).message;
        // pandoc 缺失/无法启动（ENOENT / EPERM / spawn 失败）→ 501；其余资源问题 → 404
        if (/pandoc|未安装|spawn|ENOENT|EPERM/.test(message)) {
          reply.code(501);
        } else {
          reply.code(404);
        }
        return { ok: false, error: message };
      }
    }
  );
}
