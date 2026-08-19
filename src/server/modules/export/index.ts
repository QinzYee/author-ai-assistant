// 导出模块（§11.1）：Markdown 直出 + pandoc 可选转 EPUB/DOCX
import { spawn } from 'node:child_process';
import type { NovelRepository } from '../../db/repositories/novels.js';
import type { OutlineRepository } from '../../db/repositories/outline.js';
import type { SceneRepository } from '../../db/repositories/scenes.js';
import type { FactCardRepository } from '../../db/repositories/facts.js';
import type { PlotDeviceRepository } from '../../db/repositories/plotdevices.js';

export interface ExportDeps {
  novels: NovelRepository;
  outline: OutlineRepository;
  scenes: SceneRepository;
  facts: FactCardRepository;
  plotDevices: PlotDeviceRepository;
}

export type ExportFormat = 'md' | 'epub' | 'docx';

const LEVEL_HEADING: Record<string, string> = {
  volume: '##',
  chapter: '###',
  scene: '####',
};

/** 组装整部小说的 Markdown（卷→章→场景 + 正文 + 元数据附录） */
export function toMarkdown(deps: ExportDeps, novelId: string): string {
  const novel = deps.novels.get(novelId);
  if (!novel) throw new Error('小说不存在');

  const lines: string[] = [];
  lines.push(`# ${novel.title}`);
  lines.push('');
  if (novel.genre) lines.push(`> 题材：${novel.genre}`);
  if (novel.target_audience) lines.push(`> 目标读者：${novel.target_audience}`);
  if (novel.selling_points) lines.push(`> 卖点：${novel.selling_points}`);
  lines.push('');
  lines.push(`> 状态：${novel.status} ｜ 导出时间：${new Date().toISOString().slice(0, 10)}`);
  lines.push('');

  const nodes = deps.outline.listForNovel(novelId);
  const scenes = deps.scenes.listForNovel(novelId);

  // 顶层：idea/synopsis/volume
  const roots = nodes.filter((n) => !n.parent_id);

  for (const root of roots) {
    lines.push(`## ${root.level === 'idea' ? '核心创意' : root.level === 'synopsis' ? '主线梗概' : '大纲'}：${root.title ?? ''}`);
    lines.push('');
    if (root.summary) {
      lines.push(root.summary);
      lines.push('');
    }
    if (root.content) {
      const c = root.content as Record<string, unknown>;
      if (typeof c.logline === 'string') lines.push(`**一句话梗概**：${c.logline}`);
      if (Array.isArray(c.selling_points)) {
        lines.push('');
        lines.push('**卖点**：');
        for (const s of c.selling_points) lines.push(`- ${String(s)}`);
      }
      if (Array.isArray(c.three_acts)) {
        lines.push('');
        lines.push('**三幕结构**：');
        for (const s of c.three_acts) lines.push(`- ${String(s)}`);
      }
      lines.push('');
    }

    // 该根下的卷/章/场景
    const children = nodes.filter((n) => n.parent_id === root.id);
    for (const volume of children) {
      lines.push(`${LEVEL_HEADING.volume} ${volume.title ?? ''}`);
      if (volume.summary) {
        lines.push('');
        lines.push(volume.summary);
      }
      lines.push('');

      const chapters = nodes.filter((n) => n.parent_id === volume.id);
      for (const chapter of chapters) {
        lines.push(`${LEVEL_HEADING.chapter} ${chapter.title ?? ''}`);
        if (chapter.summary) {
          lines.push('');
          lines.push(chapter.summary);
        }
        lines.push('');

        const sceneNodes = nodes.filter((n) => n.parent_id === chapter.id);
        for (const sceneNode of sceneNodes) {
          const scene = scenes.find((s) => s.outline_node_id === sceneNode.id);
          lines.push(`${LEVEL_HEADING.scene} ${sceneNode.title ?? sceneNode.id}`);
          if (sceneNode.summary) {
            lines.push('');
            lines.push(`*${sceneNode.summary}*`);
          }
          lines.push('');
          if (scene) {
            lines.push(scene.content);
            lines.push('');
            if (scene.meta?.pov || scene.meta?.time) {
              lines.push(`*（POV：${scene.meta.pov ?? '?'} ｜ 时间：${scene.meta.time ?? '?'}）*`);
              lines.push('');
            }
          } else {
            lines.push('*（尚未创作正文）*');
            lines.push('');
          }
        }
      }
    }
  }

  // 附录：事实卡片 + 伏笔台账
  lines.push('---');
  lines.push('## 附录 A：事实卡片');
  lines.push('');
  const facts = deps.facts.listActive(novelId);
  if (facts.length === 0) {
    lines.push('（无）');
  } else {
    for (const f of facts) lines.push(`- ${f.fact}`);
  }
  lines.push('');
  lines.push('## 附录 B：伏笔台账');
  lines.push('');
  const devices = deps.plotDevices.list(novelId);
  if (devices.length === 0) {
    lines.push('（无）');
  } else {
    for (const d of devices) {
      lines.push(`- [${d.status}] ${d.description}${d.expected_payoff ? `（预计回收：${d.expected_payoff}）` : ''}`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

/** 用 pandoc 转 EPUB/DOCX（pandoc 未安装则抛错提示） */
export function toPandoc(markdown: string, format: 'epub' | 'docx'): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pandoc = spawn('pandoc', ['-f', 'markdown', '-t', format], { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    pandoc.stdout.on('data', (c: Buffer) => chunks.push(c));
    let stderr = '';
    pandoc.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
    pandoc.on('error', (err) => {
      const message = (err as NodeJS.ErrnoException).code === 'ENOENT'
        ? '未安装 pandoc，无法转换 EPUB/DOCX。请安装 pandoc 或使用 markdown 格式导出。'
        : err.message;
      reject(new Error(message));
    });
    pandoc.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`pandoc 失败（exit ${code}）：${stderr.slice(0, 200)}`));
      }
    });
    pandoc.stdin.end(markdown);
  });
}

export function createExportService(deps: ExportDeps) {
  return {
    toMarkdown(novelId: string) {
      return toMarkdown(deps, novelId);
    },
    async export(novelId: string, format: ExportFormat): Promise<{ content: string | Buffer; mime: string; filename: string }> {
      const markdown = toMarkdown(deps, novelId);
      const novel = deps.novels.get(novelId);
      const base = (novel?.title ?? 'novel').replace(/[\\/:*?"<>|]/g, '_');

      if (format === 'md') {
        return { content: markdown, mime: 'text/markdown; charset=utf-8', filename: `${base}.md` };
      }
      const buf = await toPandoc(markdown, format);
      const ext = format === 'epub' ? 'epub' : 'docx';
      return {
        content: buf,
        mime: format === 'epub' ? 'application/epub+zip' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename: `${base}.${ext}`,
      };
    },
  };
}

export type ExportService = ReturnType<typeof createExportService>;
