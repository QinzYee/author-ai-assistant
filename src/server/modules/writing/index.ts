import type { LlmGateway } from '../../llm/index.js';
import type { NovelRepository } from '../../db/repositories/novels.js';
import type { OutlineRepository } from '../../db/repositories/outline.js';
import type { SceneRepository } from '../../db/repositories/scenes.js';
import type { AssetService } from '../assets/index.js';
import type { FactCardRepository } from '../../db/repositories/facts.js';
import type { ConflictRepository } from '../../db/repositories/conflicts.js';
import type { PlotDeviceRepository } from '../../db/repositories/plotdevices.js';
import type { KnowledgeService } from '../knowledge/index.js';
import type { MemoryService } from '../memory/index.js';
import type { ContextAssembler } from './contextAssembler.js';
import type { PromptsService } from '../prompts/index.js';
import type { SceneMeta, Scene, OutlineNode, PlotDeviceStatus } from '../../../shared/index.js';

export interface WritingDeps {
  novels: NovelRepository;
  outline: OutlineRepository;
  scenes: SceneRepository;
  assets: AssetService;
  facts: FactCardRepository;
  conflicts: ConflictRepository;
  plotDevices: PlotDeviceRepository;
  knowledge: KnowledgeService;
  memory: MemoryService;
  assembler: ContextAssembler;
  gateway: LlmGateway;
  prompts: PromptsService;
}

export type WriteEvent =
  | { type: 'status'; stage: string; message: string }
  | { type: 'text'; text: string }
  | { type: 'done'; scene: Scene }
  | { type: 'error'; error: string };

export interface GenerateSceneOptions {
  /** SSE 事件推送（可缺省，用于非流式调用） */
  onEvent?: (ev: WriteEvent) => void;
  /** 覆盖正文（调试/测试用） */
  overrideBody?: string;
  /** 作者意见/修改要求（重生成时注入上下文，让 LLM 按意见改写正文） */
  opinion?: string;
}

function emit(onEvent: ((ev: WriteEvent) => void) | undefined, ev: WriteEvent): void {
  onEvent?.(ev);
}

/** 把正文切分为流式片段 */
function chunkBody(body: string, size = 120): string[] {
  const chars = Array.from(body);
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += size) out.push(chars.slice(i, i + size).join(''));
  return out;
}

export function createWritingService(deps: WritingDeps) {
  const { novels, outline, scenes, assets, facts, conflicts, plotDevices, knowledge, memory, assembler, gateway, prompts } = deps;

  /** 主流水线：一个场景的完整创作（§4.3） */
  async function generateScene(novelId: string, outlineNodeId: string, opts: GenerateSceneOptions = {}): Promise<Scene> {
    const onEvent = opts.onEvent;
    const novel = novels.get(novelId);
    if (!novel) throw new Error('小说不存在');
    const sceneNode = outline.get(outlineNodeId);
    if (!sceneNode || sceneNode.level !== 'scene') throw new Error('请选择一个场景大纲节点');

    emit(onEvent, { type: 'status', stage: 'context', message: '组装上下文…' });

    // ① 上下文组装（§6）
    const ctx = await assembler.assemble(novel, sceneNode);

    // ② 正文生成（主调用，流式）
    emit(onEvent, { type: 'status', stage: 'generate', message: '正在生成正文…' });
    const messages =
      opts.opinion && opts.opinion.trim()
        ? [...ctx.messages, { role: 'user' as const, content: `作者对本次写作的意见与修改要求，请严格遵照并据此重写本场景：\n${opts.opinion.trim()}` }]
        : ctx.messages;
    let body = '';
    if (opts.overrideBody) {
      body = opts.overrideBody;
      for (const piece of chunkBody(body)) emit(onEvent, { type: 'text', text: piece });
    } else {
      for await (const chunk of gateway.generate({ messages })) {
        if (chunk.type === 'text' && chunk.text) {
          body += chunk.text;
          emit(onEvent, { type: 'text', text: chunk.text });
        }
      }
    }
    const cleanBody = body.trim();
    if (!cleanBody) throw new Error('正文生成为空');

    // 保存正文（先存，后续 pass 更新 meta）
    let scene = scenes.create({
      novel_id: novelId,
      outline_node_id: sceneNode.id,
      content: cleanBody,
      status: 'draft',
    });

    // ③ 元数据提取 pass（便宜模型）
    emit(onEvent, { type: 'status', stage: 'meta', message: '提取元数据…' });
    const meta = (await gateway.extract({
      system: prompts.get('PROMPT_EXTRACT_META'),
      user: cleanBody.slice(0, 4000),
    })).json as SceneMeta;
    scene = scenes.update(scene.id, { meta }) ?? scene;

    // ④ 资产更新 pass（写回，版本+1，§9.2）
    emit(onEvent, { type: 'status', stage: 'assets', message: '更新资产…' });
    await runAssetUpdatePass(novelId, sceneNode, meta, cleanBody);

    // ⑤ 事实提取 pass
    emit(onEvent, { type: 'status', stage: 'facts', message: '提取事实卡片…' });
    const newFacts = await runFactExtractPass(novelId, scene, meta, cleanBody);

    // ⑥ 一致性校验 pass
    emit(onEvent, { type: 'status', stage: 'verify', message: '校验一致性…' });
    await runVerifyPass(novelId, scene, newFacts, meta);

    // ⑦ 伏笔台账联动（foreshadowing_ops → plot_devices）
    await runPlotDevicePass(novelId, scene, meta);

    // ⑧ 摘要 pass → L2 摘要树滚动
    emit(onEvent, { type: 'status', stage: 'summary', message: '生成摘要…' });
    await memory.summarizeScene(scene.id);
    await memory.rollupAfterScene(sceneNode);

    // ⑨ 分块入库（纯计算 + embedding，§8.1）
    emit(onEvent, { type: 'status', stage: 'index', message: '分块入库…' });
    const chunkCount = await knowledge.indexScene(scene.id);

    // ⑩ compact 自动触发（§7.2：L1 工作记忆占用 > 85% 时物化最旧场景）
    const autoCompact = await memory.maybeAutoCompact(novelId, 3);
    if (autoCompact.did) {
      emit(onEvent, { type: 'status', stage: 'compact', message: `compact 物化 ${autoCompact.compacted.length} 个场景` });
    }

    // 完成
    scene = scenes.get(scene.id) ?? scene;
    emit(onEvent, { type: 'done', scene });
    return scene;
  }

  async function runAssetUpdatePass(novelId: string, sceneNode: OutlineNode, meta: SceneMeta | null, body: string): Promise<void> {
    const entities = (sceneNode.content?.characters ?? []).map((c: string) => c.split('(')[0].trim());
    const out = (await gateway.extract({
      system: prompts.get('PROMPT_ASSET_UPDATE'),
      user: `场景：${sceneNode.title ?? ''}\n出场人物：${entities.join('、')}\n正文：\n${body.slice(0, 4000)}`,
    })).json as { changes?: Array<{ name: string; state: Record<string, unknown>; relations?: unknown[] }> };

    for (const change of out.changes ?? []) {
      const asset = assets.list(novelId).find((a) => a.name === change.name || a.name.includes(change.name));
      if (asset) {
        assets.writeBack(asset.id, { state: change.state, source_scene_id: sceneNode.id });
      }
    }
    // 若 LLM 未给出 asset_changes 但 meta 中有，也应用
    if (meta?.asset_changes) {
      for (const [name, spec] of Object.entries(meta.asset_changes)) {
        const s = spec as { state?: Record<string, unknown> };
        if (!s.state) continue;
        const asset = assets.list(novelId).find((a) => a.name === name || a.name.includes(name));
        if (asset) assets.writeBack(asset.id, { state: s.state, source_scene_id: sceneNode.id });
      }
    }
  }

  async function runFactExtractPass(novelId: string, scene: Scene, meta: SceneMeta | null, body: string): Promise<string[]> {
    const out = (await gateway.extract({
      system: prompts.get('PROMPT_FACT_EXTRACT'),
      user: body.slice(0, 4000),
    })).json as { facts?: Array<{ fact: string; entities?: string[] }> };

    const added: string[] = [];
    const candidates = out.facts ?? [];
    for (const f of candidates) {
      if (!f?.fact) continue;
      if (facts.findDuplicate(novelId, f.fact)) continue;
      facts.create({
        novel_id: novelId,
        fact: f.fact,
        entities: f.entities ?? [],
        source_scene_id: scene.id,
      });
      added.push(f.fact);
    }
    // 补充 meta.new_facts
    for (const fact of meta?.new_facts ?? []) {
      if (facts.findDuplicate(novelId, fact)) continue;
      facts.create({ novel_id: novelId, fact, entities: [], source_scene_id: scene.id });
      added.push(fact);
    }
    return added;
  }

  async function runVerifyPass(novelId: string, scene: Scene, newFacts: string[], meta: SceneMeta | null): Promise<void> {
    if (newFacts.length === 0) return;
    const existing = facts.listActive(novelId).slice(0, 30);
    const out = (await gateway.extract({
      system: prompts.get('PROMPT_VERIFY'),
      user: `既有事实/资产：\n${existing.map((f) => `- ${f.fact}`).join('\n') || '（无）'}\n\n新事实：\n${newFacts.map((f) => `- ${f}`).join('\n')}`,
    })).json as { conflicts?: Array<{ type: 'contradiction' | 'missing_detail' | 'timeline_issue'; description: string; evidence?: string }> };

    for (const c of out.conflicts ?? []) {
      conflicts.create({
        novel_id: novelId,
        type: c.type ?? 'contradiction',
        description: c.description ?? '未命名冲突',
        evidence: { scene_id: scene.id, evidence: c.evidence },
      });
    }
  }

  async function runPlotDevicePass(novelId: string, scene: Scene, meta: SceneMeta | null): Promise<void> {
    const ops = meta?.foreshadowing_ops ?? [];
    const sceneNode = scene.id;
    for (const op of ops) {
      if (!op?.description) continue;
      if (op.op === 'plant') {
        if (plotDevices.findSimilar(novelId, op.description)) continue;
        plotDevices.create({
          novel_id: novelId,
          type: (op.type as never) ?? 'event',
          description: op.description,
          status: 'planted',
          planted_scene_id: sceneNode,
        });
      } else {
        const device = plotDevices.findSimilar(novelId, op.description);
        if (device) {
          const statusMap: Record<string, PlotDeviceStatus> = { develop: 'developing', payoff: 'paid_off' };
          plotDevices.updateStatus(device.id, statusMap[op.op] ?? device.status);
        }
      }
    }
  }

  return {
    generateScene,
    listScenes(novelId: string) {
      return scenes.listForNovel(novelId);
    },
    listScenesForNode(outlineNodeId: string) {
      return scenes.listForOutlineNode(outlineNodeId);
    },
    getScene(id: string) {
      return scenes.get(id);
    },
    updateScene(id: string, patch: Partial<Pick<Scene, 'content' | 'status' | 'meta'>>) {
      return scenes.update(id, patch);
    },
    removeScene(id: string) {
      return scenes.remove(id);
    },
  };
}

export type WritingService = ReturnType<typeof createWritingService>;
