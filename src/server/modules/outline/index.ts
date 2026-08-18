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

export interface OutlineServiceDeps {
  repo: OutlineRepository;
  assets: AssetRepository;
  novels: NovelRepository;
  gateway: LlmGateway;
}

export type GenerateResult =
  | { kind: 'nodes'; nodes: OutlineNode[] }
  | { kind: 'assets'; count: number; names: string[] };

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

export function createOutlineService(deps: OutlineServiceDeps) {
  const { repo, assets, novels, gateway } = deps;

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

    return {
      novel,
      parent,
      idea,
      synopsis,
      volumes,
      chapters,
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
    const system = `你是资深网文策划。为一部新小说生成「核心创意」。只输出 JSON，结构：
{"high_concept":"高概念一句话","target_reader":"目标读者","selling_points":["卖点1"],"logline":"一句话梗概"}
要求：差异化、可落地、符合长篇小说一致性要求。`;
    const user = `小说信息：标题=${ctx.novel?.title ?? '未命名'}，题材=${ctx.novel?.genre ?? '未定'}，受众=${ctx.novel?.target_audience ?? '未知'}，卖点=${ctx.novel?.selling_points ?? '未知'}
${research ? `已有创意：${research.summary ?? ''}` : ''}
请给出核心创意。`;
    const out = extractJson(await gateway.extract({ system, user }));
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
    const system = `你是资深网文结构师。基于核心创意生成「主线梗概」（三幕结构）。只输出 JSON：
{"title":"小说标题","three_acts":["第一幕：...","第二幕：...","第三幕：..."],"theme":"主题"}
要求：与核心创意一致，三幕起承转合完整，结尾留钩子。`;
    const user = `核心创意：${ideaNode.summary ?? ''}
${JSON.stringify(ideaNode.content)}`;
    const out = extractJson(await gateway.extract({ system, user }));
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

  async function genWorldview(novelId: string): Promise<GenerateResult> {
    const ctx = buildContext(novelId, null);
    const ideaNode = ctx.idea;
    const system = `你是世界观架构师。为小说生成核心「设定/规则」（powers/rules），每条小而稳（§9.1：核心属性 50~100 token）。只输出 JSON 数组：
[{"name":"规则名","rule":"一句话规则","extended":"细则/边界案例"}]
条数 3~5。`;
    const user = `核心创意：${ideaNode?.summary ?? ''}
${ideaNode ? JSON.stringify(ideaNode.content) : ''}`;
    const out = extractJson(await gateway.extract({ system, user }));
    const items = asArray(out).length > 0 ? (asArray(out) as WorldviewItem[]) : (asArray(out.items ?? []) as WorldviewItem[]);
    const names: string[] = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const name = String((item as WorldviewItem).name ?? '').trim();
      if (!name) continue;
      assets.create({
        novel_id: novelId,
        type: 'setting',
        name,
        core: { rule: String((item as WorldviewItem).rule ?? '') },
        extended: (item as WorldviewItem).extended ? { detail: (item as WorldviewItem).extended } : null,
        summary: String((item as WorldviewItem).rule ?? '').slice(0, 50),
      });
      names.push(name);
    }
    return { kind: 'assets', count: names.length, names };
  }

  async function genCharacters(novelId: string): Promise<GenerateResult> {
    const ctx = buildContext(novelId, null);
    const system = `你是人物设定师。基于核心创意与世界观生成「人物小传」。只输出 JSON 数组：
[{"name":"姓名","role":"主角|配角|反派|其他","identity":"身份","personality":"一句话性格","goal":"当前目标","motivation":"动机","arc":"成长弧光","state":"当前状态(伤势/位置)","location":"当前位置"}]
主角1名、反派1名、配角1~2名。`;
    const user = `核心创意：${ctx.idea?.summary ?? ''}
世界观：${ctx.settingsText}`;
    const out = extractJson(await gateway.extract({ system, user }));
    const items = (asArray(out.items ?? out) as CharacterBio[]);
    const names: string[] = [];
    for (const item of items) {
      if (!item || typeof item !== 'object' || !item.name) continue;
      assets.create({
        novel_id: novelId,
        type: 'character',
        name: item.name,
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
      });
      names.push(item.name);
    }
    return { kind: 'assets', count: names.length, names };
  }

  async function genVolumes(novelId: string, parentId: string | null): Promise<GenerateResult> {
    const ctx = buildContext(novelId, parentId);
    const system = `你是长篇小说结构师。基于主线梗概生成「卷大纲」。只输出 JSON 数组：
[{"title":"卷名","goal":"本卷目标","turning_point":"转折","suspense":"悬念","ending_hook":"结尾钩子"}]
要求：每卷结尾至少推进或回收一个伏笔（§10.2），卷数 2~4。`;
    const user = `主线梗概：${ctx.synopsis?.summary ?? ''}
主题：${(ctx.synopsis?.content as unknown as Synopsis | undefined)?.theme ?? ''}`;
    const out = extractJson(await gateway.extract({ system, user }));
    const items = (asArray(out.items ?? out) as VolumeOutlineItem[]);
    const nodes: OutlineNode[] = [];
    for (const item of items) {
      if (!item || typeof item !== 'object' || !item.title) continue;
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
    return { kind: 'nodes', nodes };
  }

  async function genChapters(novelId: string, parentId: string | null): Promise<GenerateResult> {
    const ctx = buildContext(novelId, parentId);
    const volume = ctx.parent;
    if (!volume) throw new Error('请先选择所属卷（volume）');
    const system = `你是章回体作者。基于卷大纲生成「章大纲」。只输出 JSON 数组：
[{"title":"章名","pov":"视角人物","goal":"本章目标","conflict":"冲突","ending_hook":"结尾钩子","characters":["出场人物"]}]
要求：与卷目标一致，人物取自可用角色，每章结尾有钩子。`;
    const user = `卷大纲：${volume.summary ?? ''}
${JSON.stringify(volume.content ?? {})}
可用角色：${ctx.charactersText}
世界观：${ctx.settingsText}`;
    const out = extractJson(await gateway.extract({ system, user }));
    const items = (asArray(out.items ?? out) as ChapterOutlineItem[]);
    const nodes: OutlineNode[] = [];
    for (const item of items) {
      if (!item || typeof item !== 'object' || !item.title) continue;
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
    return { kind: 'nodes', nodes };
  }

  async function genScenes(novelId: string, parentId: string | null): Promise<GenerateResult> {
    const ctx = buildContext(novelId, parentId);
    const chapter = ctx.parent;
    if (!chapter) throw new Error('请先选择所属章（chapter）');
    const system = `你是场景分镜师。基于章大纲生成「场景大纲」（创作单元，§4.2）。只输出 JSON 数组，每个元素：
{"scene":"场景名","time":"主线第X天 时刻","location":"地点","characters":["人物(角色)"],"goal":"场景目标","conflict":"冲突","result":"结果","info_revealed":["揭示的信息"],"foreshadowing":["埋设/发展/回收伏笔"],"continuity_notes":"与前文的一致性提醒"}
要求：characters 必须来自可用角色；每个场景是记忆与资产更新的最小单元；result 明确状态变更；若有伏笔操作需注明。`;
    const user = `章大纲：${chapter.summary ?? ''}
${JSON.stringify(chapter.content ?? {})}
可用角色：${ctx.charactersText}
可回收获的伏笔提示：${ctx.synopsis?.summary ?? '（暂无）'}`;
    const out = extractJson(await gateway.extract({ system, user }));
    const items = (asArray(out.items ?? out) as SceneOutline[]);
    const nodes: OutlineNode[] = [];
    for (const item of items) {
      if (!item || typeof item !== 'object' || !item.scene) continue;
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
    return { kind: 'nodes', nodes };
  }

  async function generateLayer(novelId: string, req: GenerateOutlineRequest): Promise<GenerateResult> {
    const parentId = req.parent_id ?? null;
    switch (req.layer) {
      case 'idea':
        return genIdea(novelId);
      case 'synopsis':
        return genSynopsis(novelId);
      case 'worldview':
        return genWorldview(novelId);
      case 'character':
        return genCharacters(novelId);
      case 'volume':
        return genVolumes(novelId, parentId);
      case 'chapter':
        return genChapters(novelId, parentId);
      case 'scene':
        return genScenes(novelId, parentId);
      default:
        throw new Error(`未知大纲层级：${req.layer as string}`);
    }
  }

  return {
    generateLayer,
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
