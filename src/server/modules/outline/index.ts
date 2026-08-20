import type {
  LlmGateway,
  StructuredResult,
} from '../../llm/index.js';
import type {
  OutlineNode,
  OutlineNodeInput,
  OutlineLayer,
  GenerateOutlineRequest,
  CoreIdea,
  WorldviewItem,
  CharacterBio,
  Synopsis,
  VolumeOutlineItem,
  ChapterOutlineItem,
  SceneOutline,
} from '../../../shared/index.js';
import type { OutlineRepository } from '../../db/repositories/outline.js';
import type { AssetRepository } from '../../db/repositories/assets.js';
import type { NovelRepository } from '../../db/repositories/novels.js';
import type { PromptsService } from '../prompts/index.js';
import type { Asset } from '../../../shared/index.js';

export interface OutlineServiceDeps {
  repo: OutlineRepository;
  assets: AssetRepository;
  novels: NovelRepository;
  gateway: LlmGateway;
  prompts: PromptsService;
}

export type GenerateResult =
  | { kind: 'nodes'; nodes: OutlineNode[]; skipped?: number }
  | { kind: 'assets'; count: number; names: string[]; batchLabel?: string; skipped?: number };

/** 各层默认目标数量（未传 count 时；与提示词内置条数保持一致） */
const DEFAULT_COUNT: Partial<Record<OutlineLayer, number>> = {
  worldview: 4,
  character: 4,
  volume: 3,
  chapter: 5,
  scene: 5,
};

const LAYER_LABEL: Record<OutlineLayer, string> = {
  idea: '核心创意',
  worldview: '世界观设定',
  synopsis: '主线梗概',
  character: '人物小传',
  volume: '卷大纲',
  chapter: '章大纲',
  scene: '场景大纲',
};

function extractJson(result: StructuredResult): Record<string, unknown> {
  const j = result.json;
  if (typeof j === 'object' && j !== null) return j as Record<string, unknown>;
  throw new Error('LLM 未返回 JSON 对象');
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function stringifyContext(items: Array<{ title: string; detail: string }>): string {
  if (items.length === 0) return '（暂无）';
  return items
    .map((it) => `- ${it.title}：${it.detail}`)
    .join('\n');
}

/** 兼容「对象或数组」两种返回：数组取首项 */
function firstItem(v: unknown): unknown {
  return Array.isArray(v) ? v[0] : v;
}

/** 计算下一批批次号：扫描同前缀已有批次标签，取最大批次号 + 1（如「世界观·第3批」） */
function nextBatchLabel(items: Asset[], prefix: string): string {
  let max = 0;
  for (const it of items) {
    const label = it.batch_label ?? '';
    if (!label.startsWith(prefix)) continue;
    const m = /第(\d+)批/.exec(label);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}第${max + 1}批`;
}

/** 规范化请求数量：非法/未传时回退默认 */
function normalizeCount(layer: OutlineLayer, raw: number | undefined): number {
  const fallback = DEFAULT_COUNT[layer] ?? 5;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.round(raw) : fallback;
}

export function createOutlineService(deps: OutlineServiceDeps) {
  const { repo, assets, novels, gateway, prompts } = deps;

  /** 收集自上而下的约束上下文（§4.2：每一层都是上一层的约束 + 本层产出） */
  function buildContext(novelId: string, parentId: string | null) {
    const novel = novels.get(novelId);
    const tree = repo.listForNovel(novelId);
    const parent = parentId ? repo.get(parentId) : null;

    const settings = assets.list(novelId, 'setting');
    const characters = assets.list(novelId, 'character');
    const locations = assets.list(novelId, 'location');

    const idea = tree.find((n) => n.level === 'idea');
    const synopsis = tree.find((n) => n.level === 'synopsis');
    const volumes = tree.filter((n) => n.level === 'volume');
    const chapters = parent ? tree.filter((n) => n.parent_id === parent.id && n.level === 'chapter') : [];
    const scenes = parent ? tree.filter((n) => n.parent_id === parent.id && n.level === 'scene') : [];

    return {
      novel,
      parent,
      idea,
      synopsis,
      volumes,
      chapters,
      scenes,
      settings,
      characters,
      locations,
      // 便于 prompt 拼接
      treeText: stringifyContext(
        tree.map((n) => ({ title: n.title ?? n.level, detail: n.summary ?? JSON.stringify(n.content ?? {}).slice(0, 120) }))
      ),
      settingsText: stringifyContext(settings.map((s) => ({ title: s.name, detail: (s.core.rule as string) ?? '' }))),
      charactersText: stringifyContext(
        characters.map((c) => ({ title: c.name, detail: `${c.core.identity ?? ''}｜目标：${c.core.goal ?? ''}` }))
      ),
    };
  }

  async function genIdea(novelId: string): Promise<GenerateResult> {
    const ctx = buildContext(novelId, null);
    const research = ctx.idea; // 占位：调研结论可从 novels 或最新调研取
    const system = prompts.get('PROMPT_OUTLINE_IDEA');
    const user = `小说信息：标题=${ctx.novel?.title ?? '未命名'}，题材=${ctx.novel?.genre ?? '未定'}，受众=${ctx.novel?.target_audience ?? '未知'}，卖点=${ctx.novel?.selling_points ?? '未知'}
${research ? `已有创意：${research.summary ?? ''}` : ''}
请给出核心创意。`;
    const out = extractJson(await gateway.extract({ system, user, jsonMode: 'auto' }));
    const content: CoreIdea = {
      high_concept: String(out.high_concept ?? ''),
      target_reader: String(out.target_reader ?? ''),
      selling_points: asArray(out.selling_points).map(String),
      logline: String(out.logline ?? ''),
    };
    const node = repo.create({
      novel_id: novelId,
      parent_id: null,
      level: 'idea',
      title: content.high_concept.slice(0, 40),
      summary: content.logline,
      content: content as unknown as SceneOutline,
    });
    return { kind: 'nodes', nodes: [node] };
  }

  async function genSynopsis(novelId: string): Promise<GenerateResult> {
    const ctx = buildContext(novelId, null);
    const ideaNode = ctx.idea;
    if (!ideaNode) throw new Error('请先生成核心创意（idea）');
    const system = prompts.get('PROMPT_OUTLINE_SYNOPSIS');
    const user = `核心创意：${ideaNode.summary ?? ''}
${JSON.stringify(ideaNode.content)}`;
    const out = extractJson(await gateway.extract({ system, user, jsonMode: 'auto' }));
    const content: Synopsis = {
      title: String(out.title ?? ''),
      three_acts: asArray(out.three_acts).map(String),
      theme: String(out.theme ?? ''),
    };
    const node = repo.create({
      novel_id: novelId,
      parent_id: null,
      level: 'synopsis',
      title: content.title || '主线梗概',
      summary: content.three_acts.join('｜'),
      content: content as unknown as SceneOutline,
    });
    return { kind: 'nodes', nodes: [node] };
  }

  async function genWorldview(novelId: string, count: number): Promise<GenerateResult> {
    const ctx = buildContext(novelId, null);
    const ideaNode = ctx.idea;
    const system = prompts.get('PROMPT_OUTLINE_WORLDVIEW');
    const user = `核心创意：${ideaNode?.summary ?? ''}
${ideaNode ? JSON.stringify(ideaNode.content) : ''}
请生成 ${count} 条设定/规则。`;
    const out = extractJson(await gateway.extract({ system, user, jsonMode: 'auto' }));
    const items = asArray(out).length > 0 ? (asArray(out) as WorldviewItem[]) : (asArray(out.items ?? []) as WorldviewItem[]);
    const existingNames = new Set(ctx.settings.map((s) => s.name.trim()));
    const batchLabel = nextBatchLabel(ctx.settings, '世界观·');
    const names: string[] = [];
    let skipped = 0;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const name = String((item as WorldviewItem).name ?? '').trim();
      if (!name) continue;
      if (existingNames.has(name)) {
        skipped++; // 增量：跳过已存在的同名设定
        continue;
      }
      existingNames.add(name);
      assets.create({
        novel_id: novelId,
        type: 'setting',
        name,
        core: { rule: String((item as WorldviewItem).rule ?? '') },
        extended: (item as WorldviewItem).extended ? { detail: (item as WorldviewItem).extended } : null,
        summary: String((item as WorldviewItem).rule ?? '').slice(0, 50),
        batch_label: batchLabel,
      });
      names.push(name);
    }
    return { kind: 'assets', count: names.length, names, batchLabel, skipped };
  }

  async function genCharacters(novelId: string, count: number): Promise<GenerateResult> {
    const ctx = buildContext(novelId, null);
    const system = prompts.get('PROMPT_OUTLINE_CHARACTER');
    const user = `核心创意：${ctx.idea?.summary ?? ''}
世界观：${ctx.settingsText}
请生成 ${count} 个人物（主角/反派/配角）。`;
    const out = extractJson(await gateway.extract({ system, user, jsonMode: 'auto' }));
    const items = (asArray(out.items ?? out) as CharacterBio[]);
    const existingNames = new Set(ctx.characters.map((c) => c.name.trim()));
    const batchLabel = nextBatchLabel(ctx.characters, '人物·');
    const names: string[] = [];
    let skipped = 0;
    for (const item of items) {
      if (!item || typeof item !== 'object' || !item.name) continue;
      const name = item.name.trim();
      if (existingNames.has(name)) {
        skipped++; // 增量：跳过已存在的同名人物
        continue;
      }
      existingNames.add(name);
      assets.create({
        novel_id: novelId,
        type: 'character',
        name,
        core: {
          identity: item.identity,
          personality: item.personality,
          goal: item.goal,
          role: item.role,
        },
        extended: {
          motivation: item.motivation,
          arc: item.arc,
          appearance: item.appearance ?? null,
        },
        summary: `${item.role}｜${item.identity ?? ''}｜目标：${item.goal ?? ''}`,
        batch_label: batchLabel,
      });
      names.push(name);
    }
    return { kind: 'assets', count: names.length, names, batchLabel, skipped };
  }

  async function genVolumes(novelId: string, parentId: string | null, count: number): Promise<GenerateResult> {
    const ctx = buildContext(novelId, parentId);
    const target = count;
    const existing = ctx.volumes.length;
    const want = Math.max(target - existing, 0);
    if (want === 0) return { kind: 'nodes', nodes: [], skipped: existing };
    const system = prompts.get('PROMPT_OUTLINE_VOLUME');
    const user = `主线梗概：${ctx.synopsis?.summary ?? ''}
主题：${(ctx.synopsis?.content as unknown as Synopsis | undefined)?.theme ?? ''}
当前已有 ${existing} 卷（目标 ${target} 卷），本次只需补充生成 ${want} 卷，与已有卷衔接、不重复。`;
    const out = extractJson(await gateway.extract({ system, user, jsonMode: 'auto' }));
    const items = (asArray(out.items ?? out) as VolumeOutlineItem[]);
    const nodes: OutlineNode[] = [];
    let overflow = 0;
    for (const item of items) {
      if (!item || typeof item !== 'object' || !item.title) continue;
      if (nodes.length >= want) {
        overflow++; // 超过目标数量：截断（增量只补到目标数）
        continue;
      }
      nodes.push(
        repo.create({
          novel_id: novelId,
          parent_id: null,
          level: 'volume',
          title: String(item.title),
          summary: `${item.goal ?? ''}｜转折：${item.turning_point ?? ''}`,
          content: item as unknown as SceneOutline,
        })
      );
    }
    return { kind: 'nodes', nodes, skipped: existing + overflow };
  }

  async function genChapters(novelId: string, parentId: string | null, count: number): Promise<GenerateResult> {
    const ctx = buildContext(novelId, parentId);
    const volume = ctx.parent;
    if (!volume) throw new Error('请先选择所属卷（volume）');
    const target = count;
    const existing = ctx.chapters.length;
    const want = Math.max(target - existing, 0);
    if (want === 0) return { kind: 'nodes', nodes: [], skipped: existing };
    const system = prompts.get('PROMPT_OUTLINE_CHAPTER');
    const user = `卷大纲：${volume.summary ?? ''}
${JSON.stringify(volume.content ?? {})}
可用角色：${ctx.charactersText}
世界观：${ctx.settingsText}
本卷当前已有 ${existing} 章（目标 ${target} 章），本次只需补充生成 ${want} 章，与已有章衔接、不重复。`;
    const out = extractJson(await gateway.extract({ system, user, jsonMode: 'auto' }));
    const items = (asArray(out.items ?? out) as ChapterOutlineItem[]);
    const nodes: OutlineNode[] = [];
    let overflow = 0;
    for (const item of items) {
      if (!item || typeof item !== 'object' || !item.title) continue;
      if (nodes.length >= want) {
        overflow++;
        continue;
      }
      nodes.push(
        repo.create({
          novel_id: novelId,
          parent_id: volume.id,
          level: 'chapter',
          title: String(item.title),
          summary: `${item.goal ?? ''}｜冲突：${item.conflict ?? ''}`,
          content: item as unknown as SceneOutline,
        })
      );
    }
    return { kind: 'nodes', nodes, skipped: existing + overflow };
  }

  async function genScenes(novelId: string, parentId: string | null, count: number): Promise<GenerateResult> {
    const ctx = buildContext(novelId, parentId);
    const chapter = ctx.parent;
    if (!chapter) throw new Error('请先选择所属章（chapter）');
    const target = count;
    const existing = ctx.scenes.length;
    const want = Math.max(target - existing, 0);
    if (want === 0) return { kind: 'nodes', nodes: [], skipped: existing };
    const system = prompts.get('PROMPT_OUTLINE_SCENE');
    const user = `章大纲：${chapter.summary ?? ''}
${JSON.stringify(chapter.content ?? {})}
可用角色：${ctx.charactersText}
可回收获的伏笔提示：${ctx.synopsis?.summary ?? '（暂无）'}
本章当前已有 ${existing} 个场景（目标 ${target} 个），本次只需补充生成 ${want} 个场景，与已有场景衔接、不重复。`;
    const out = extractJson(await gateway.extract({ system, user, jsonMode: 'auto' }));
    const items = (asArray(out.items ?? out) as SceneOutline[]);
    const nodes: OutlineNode[] = [];
    let overflow = 0;
    for (const item of items) {
      if (!item || typeof item !== 'object' || !item.scene) continue;
      if (nodes.length >= want) {
        overflow++;
        continue;
      }
      nodes.push(
        repo.create({
          novel_id: novelId,
          parent_id: chapter.id,
          level: 'scene',
          title: String(item.scene).slice(0, 40),
          summary: item.goal ?? '',
          content: item,
        })
      );
    }
    return { kind: 'nodes', nodes, skipped: existing + overflow };
  }

  async function generateLayer(novelId: string, req: GenerateOutlineRequest): Promise<GenerateResult> {
    const parentId = req.parent_id ?? null;
    const count = normalizeCount(req.layer, req.count);
    switch (req.layer) {
      case 'idea':
        return genIdea(novelId);
      case 'synopsis':
        return genSynopsis(novelId);
      case 'worldview':
        return genWorldview(novelId, count);
      case 'character':
        return genCharacters(novelId, count);
      case 'volume':
        return genVolumes(novelId, parentId, count);
      case 'chapter':
        return genChapters(novelId, parentId, count);
      case 'scene':
        return genScenes(novelId, parentId, count);
      default:
        throw new Error(`未知大纲层级：${req.layer as string}`);
    }
  }

  /** 单节点按作者意见重新生成（人机协同：保留约束上下文 + 作者意见 → 重写本节点） */
  async function regenerateNode(novelId: string, nodeId: string, opinion: string): Promise<OutlineNode> {
    const node = repo.get(nodeId);
    if (!node) throw new Error('节点不存在');
    if (node.novel_id !== novelId) throw new Error('节点不属于当前项目');

    const ctx = buildContext(novelId, node.parent_id);
    const current = `${node.title ?? ''}\n${node.summary ?? ''}\n${JSON.stringify(node.content ?? {})}`;
    let patch: Partial<OutlineNodeInput> | null = null;

    switch (node.level) {
      case 'idea': {
        const system = prompts.get('PROMPT_OUTLINE_IDEA');
        const user = `当前核心创意：\n${current}\n\n作者意见：${opinion}\n请结合作者意见重新生成核心创意。只输出 JSON，结构不变。`;
        const out = extractJson(await gateway.extract({ system, user, jsonMode: 'auto' }));
        const content: CoreIdea = {
          high_concept: String(out.high_concept ?? ''),
          target_reader: String(out.target_reader ?? ''),
          selling_points: asArray(out.selling_points).map(String),
          logline: String(out.logline ?? ''),
        };
        patch = {
          title: content.high_concept.slice(0, 40) || node.title,
          summary: content.logline || null,
          content: content as unknown as SceneOutline,
        };
        break;
      }
      case 'synopsis': {
        const system = prompts.get('PROMPT_OUTLINE_SYNOPSIS');
        const user = `当前主线梗概：\n${current}\n\n作者意见：${opinion}\n请结合作者意见重新生成主线梗概。只输出 JSON，结构不变。`;
        const out = extractJson(await gateway.extract({ system, user, jsonMode: 'auto' }));
        const content: Synopsis = {
          title: String(out.title ?? ''),
          three_acts: asArray(out.three_acts).map(String),
          theme: String(out.theme ?? ''),
        };
        patch = {
          title: content.title || node.title,
          summary: content.three_acts.join('｜') || null,
          content: content as unknown as SceneOutline,
        };
        break;
      }
      case 'volume': {
        const system = prompts.get('PROMPT_OUTLINE_VOLUME');
        const user = `当前卷：\n${current}\n\n作者意见：${opinion}\n请结合作者意见重新生成这一卷。只输出该卷的 JSON 对象（非数组）：\n{"title":"卷名","goal":"本卷目标","turning_point":"转折","suspense":"悬念","ending_hook":"结尾钩子"}`;
        const raw = firstItem(extractJson(await gateway.extract({ system, user }))) as VolumeOutlineItem | undefined;
        const item = raw ?? ({} as VolumeOutlineItem);
        patch = {
          title: String(item.title ?? node.title ?? ''),
          summary: `${item.goal ?? ''}｜转折：${item.turning_point ?? ''}` || null,
          content: item as unknown as SceneOutline,
        };
        break;
      }
      case 'chapter': {
        const system = prompts.get('PROMPT_OUTLINE_CHAPTER');
        const user = `当前章：\n${current}\n\n作者意见：${opinion}\n请结合作者意见重新生成这一章。只输出该章的 JSON 对象（非数组）：\n{"title":"章名","pov":"视角人物","goal":"本章目标","conflict":"冲突","ending_hook":"结尾钩子","characters":["出场人物"]}`;
        const raw = firstItem(extractJson(await gateway.extract({ system, user }))) as ChapterOutlineItem | undefined;
        const item = raw ?? ({} as ChapterOutlineItem);
        patch = {
          title: String(item.title ?? node.title ?? ''),
          summary: `${item.goal ?? ''}｜冲突：${item.conflict ?? ''}` || null,
          content: item as unknown as SceneOutline,
        };
        break;
      }
      case 'scene': {
        const system = prompts.get('PROMPT_OUTLINE_SCENE');
        const user = `当前场景：\n${current}\n\n作者意见：${opinion}\n请结合作者意见重新生成这一场景。只输出该场景的 JSON 对象（非数组）：\n{"scene":"场景名","time":"主线第X天 时刻","location":"地点","characters":["人物(角色)"],"goal":"场景目标","conflict":"冲突","result":"结果","info_revealed":["揭示的信息"],"foreshadowing":["埋设/发展/回收伏笔"],"continuity_notes":"与前文的一致性提醒"}`;
        const raw = firstItem(extractJson(await gateway.extract({ system, user }))) as SceneOutline | undefined;
        const item = raw ?? {};
        patch = {
          title: String(item.scene ?? node.title ?? '').slice(0, 40),
          summary: String(item.goal ?? '') || null,
          content: item,
        };
        break;
      }
      default:
        throw new Error(`「${node.level}」层级暂不支持按意见重新生成`);
    }

    const updated = repo.update(nodeId, patch);
    if (!updated) throw new Error('节点更新失败');
    return updated;
  }

  return {
    generateLayer,
    regenerateNode,
    list(novelId: string) {
      return repo.listForNovel(novelId);
    },
    get(id: string) {
      return repo.get(id);
    },
    create(input: OutlineNodeInput & { novel_id: string }) {
      return repo.create(input);
    },
    update(id: string, patch: Partial<OutlineNodeInput>) {
      return repo.update(id, patch);
    },
    remove(id: string) {
      return repo.remove(id);
    },
    layerLabel(layer: OutlineLayer) {
      return LAYER_LABEL[layer];
    },
  };
}

export type OutlineService = ReturnType<typeof createOutlineService>;
