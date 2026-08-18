// 上下文组装器（§6）—— 按 token 预算分层组装生成 prompt
import type { LlmGateway, ChatMessage } from '../../llm/index.js';
import type { OutlineRepository } from '../../db/repositories/outline.js';
import type { AssetRepository } from '../../db/repositories/assets.js';
import type { SummaryRepository } from '../../db/repositories/summaries.js';
import type { FactCardRepository } from '../../db/repositories/facts.js';
import type { PlotDeviceRepository } from '../../db/repositories/plotdevices.js';
import type { KnowledgeService } from '../knowledge/index.js';
import type { Novel, OutlineNode } from '../../../shared/index.js';

export interface AssemblerDeps {
  outline: OutlineRepository;
  assets: AssetRepository;
  summaries: SummaryRepository;
  facts: FactCardRepository;
  plotDevices: PlotDeviceRepository;
  knowledge: KnowledgeService;
  gateway: LlmGateway;
}

export interface AssembledContext {
  messages: ChatMessage[];
  /** 各层实际占用 token（用于裁剪与日志） */
  usage: Record<string, number>;
  /** 组装时检索到的上下文片段 */
  ragHits: Array<{ source: string; text: string }>;
  /** 场景大纲声明的实体清单 */
  entities: string[];
}

const SYSTEM_BASE = `你是一位专业的中文网文作者，擅长长篇小说的场景创作。请严格遵循：
1. 只创作当前场景的正文，不写章、不写卷、不写说明；
2. 严格遵守「创作规则」中的人物状态、世界观限制与一致性要求（§1 人机协同原则：AI 生成，人类裁决）；
3. 正文控制在 1500~2500 字，节奏紧凑，有冲突推进与信息揭示；
4. 不剧透尚未揭晓的设定，不违背既有事实卡片；
5. 输出纯粹的小说正文（不加标题、不加引号包裹）。`;

const SYSTEM_RULES = `【创作规则】
- 文风：第三人称限知视角，跟随场景大纲声明的 POV 人物；
- 时间线与地点必须与场景大纲一致；
- 人物当前状态（伤势/位置/关系）必须与资产状态一致，不得擅自改变；
- 未回收的伏笔必须小心处理：可以在本场景埋设/发展/回收，但不得遗忘；
- 结局必须推进冲突并留下钩子。`;

const SYSTEM_PROHIBIT = `【禁止剧透】
- 不得泄露尚未通过正文揭示的世界观秘密；
- 不得让角色知道他不该知道的信息。`;

// 各层 token 预算（§6，总输入预算约 16K）
const LAYER_BUDGET: Array<{ key: string; max: number; priority: number }> = [
  { key: 'system', max: 2000, priority: 0 }, // 必须保留
  { key: 'worldview', max: 1000, priority: 1 },
  { key: 'outline', max: 2000, priority: 2 },
  { key: 'entities', max: 2000, priority: 3 },
  { key: 'summary', max: 1000, priority: 4 },
  { key: 'rag', max: 3000, priority: 5 },
  { key: 'facts', max: 1000, priority: 6 },
  { key: 'plotdevices', max: 500, priority: 7 },
  { key: 'reserve', max: 3500, priority: 8 },
];

export function createContextAssembler(deps: AssemblerDeps) {
  const { outline, assets, summaries, facts, plotDevices, knowledge, gateway } = deps;

  async function assemble(novel: Novel, sceneNode: OutlineNode): Promise<AssembledContext> {
    const novelId = novel.id;
    const usage: Record<string, number> = {};

    const sceneContent = (sceneNode.content ?? {}) as Record<string, unknown>;
    const characters = Array.isArray(sceneContent.characters) ? (sceneContent.characters as string[]).map((c) => c.split('(')[0].trim()) : [];
    const location = typeof sceneContent.location === 'string' ? sceneContent.location : '';
    const entities = [...new Set([...characters, location].filter(Boolean))];

    // ① 系统提示（必保留）
    const system = `${SYSTEM_BASE}\n\n${SYSTEM_RULES}\n\n${SYSTEM_PROHIBIT}`;
    usage.system = knowledge.estimateTokens(system);

    // ② 世界观核心规则（assets type=setting）
    const settings = assets.list(novelId, 'setting');
    const worldviewText = settings.length
      ? settings.map((s) => `- ${s.name}：${(s.core as Record<string, unknown>)?.rule ?? ''}`).join('\n')
      : '（暂无明确世界观规则）';

    // ③ 卷/章/场景大纲
    const parentId = sceneNode.parent_id;
    const chapter = parentId ? outline.get(parentId) : null;
    const volume = chapter?.parent_id ? outline.get(chapter.parent_id) : null;
    const outlineText = [
      volume ? `【卷】${volume.title}：${volume.summary ?? ''}` : '',
      chapter ? `【章】${chapter.title}：${chapter.summary ?? ''}` : '',
      `【本场景】${sceneNode.title ?? ''}：${JSON.stringify(sceneContent)}`,
    ]
      .filter(Boolean)
      .join('\n');

    // ④ 实体核心属性（场景大纲 characters → 资产表直查，确定性检索 §8.2）
    const entityLines: string[] = [];
    for (const name of characters) {
      const asset = assets.list(novelId, 'character').find((a) => a.name === name || a.name.includes(name));
      if (asset) {
        const core = asset.core as Record<string, unknown>;
        entityLines.push(`【${name}】身份:${core.identity ?? '?'}｜性格:${core.personality ?? ''}｜目标:${core.goal ?? ''}｜状态:${core.state ?? '未知'}`);
      }
    }
    const entitiesText = entityLines.length ? entityLines.join('\n') : '（场景大纲未声明实体或未建档）';

    // ⑤ 上一场景摘要 + 本章摘要 + 卷大事记（L2）
    const summaryParts: string[] = [];
    const volumeId = volume?.id ?? null;
    if (volumeId) {
      const vs = summaries.latestForRef(volumeId, 'volume');
      if (vs) summaryParts.push(`【卷大事记】${vs.content}`);
    }
    if (chapter) {
      const cs = summaries.latestForRef(chapter.id, 'chapter');
      if (cs) summaryParts.push(`【本章进展】${cs.content}`);
    }
    // 上一场景摘要：取本章下当前场景之前最近已生成场景的摘要
    const siblingScenes = outline.listForNovel(novelId).filter((n) => n.level === 'scene' && n.parent_id === sceneNode.parent_id);
    const prevIdx = siblingScenes.findIndex((n) => n.id === sceneNode.id);
    const prevScene = prevIdx > 0 ? siblingScenes[prevIdx - 1] : null;
    if (prevScene) {
      const ps = summaries.latestForRef(prevScene.id, 'scene');
      if (ps) summaryParts.push(`【上一场景】${ps.content}`);
    }
    const summaryText = summaryParts.length ? summaryParts.join('\n') : '（本章尚无摘要）';

    // ⑥ RAG 检索 chunks（§8.2 语义预检索）
    const ragQuery = `${sceneNode.title ?? ''} ${sceneNode.summary ?? ''} ${JSON.stringify(sceneContent)}`.slice(0, 200);
    const ragHits = await knowledge.search(novelId, ragQuery, { topK: 6, entityNames: characters });
    const ragHitMeta = ragHits.map((h) => ({ source: h.sceneId ?? 'rag', text: h.content }));
    const ragText = ragHits.length
      ? ragHits.map((h) => `- ${h.content.slice(0, 200)}`).join('\n')
      : '（暂无相关历史正文）';

    // ⑦ 相关事实卡片（按 entities 过滤）
    const relatedFacts = facts.listByEntities(novelId, characters);
    const factsText = relatedFacts.length
      ? relatedFacts.slice(0, 15).map((f) => `- ${f.fact}`).join('\n')
      : '（暂无相关事实卡片）';

    // ⑧ 待回收伏笔
    const dueDevices = plotDevices.listDue(novelId);
    const devicesText = dueDevices.length
      ? dueDevices.map((d) => `- [${d.type}/${d.status}] ${d.description}（预期回收：${d.expected_payoff ?? '未定'}）`).join('\n')
      : '（暂无待处理伏笔）';

    // 组装 user 消息（按优先级裁剪：超预算时逆优先级 ⑧>⑦>⑥>④ 裁剪，§6 ⑨）
    const sections: Array<{ key: string; text: string }> = [
      { key: 'worldview', text: `【世界观】\n${worldviewText}` },
      { key: 'outline', text: `【大纲】\n${outlineText}` },
      { key: 'entities', text: `【实体状态】\n${entitiesText}` },
      { key: 'summary', text: `【情节记忆】\n${summaryText}` },
      { key: 'rag', text: `【相关历史正文】\n${ragText}` },
      { key: 'facts', text: `【事实卡片】\n${factsText}` },
      { key: 'plotdevices', text: `【待回收伏笔】\n${devicesText}` },
    ];

    // 逆优先级裁剪：先裁 plotdevices(7) > facts(6) > rag(5) > entities(3)
    const priorityOrder = [7, 6, 5, 4, 3, 2, 1];
    const included = new Map(sections.map((s) => [s.key, s.text]));
    let totalUser = 0;
    for (const s of sections) {
      const t = knowledge.estimateTokens(s.text);
      usage[s.key] = t;
      totalUser += t;
    }
    const totalBudget = LAYER_BUDGET.reduce((acc, l) => acc + l.max, 0);
    const targetUser = totalBudget - usage.system - 2000 /* 预留输出与 safety */;
    if (totalUser > targetUser) {
      let overflow = totalUser - targetUser;
      for (const priority of priorityOrder) {
        if (overflow <= 0) break;
        const section = sections.find((s) => LAYER_BUDGET.find((l) => l.key === s.key)?.priority === priority);
        if (!section) continue;
        const t = knowledge.estimateTokens(section.text);
        if (t <= overflow) {
          included.delete(section.key);
          usage[section.key] = 0;
          overflow -= t;
        } else {
          // 部分截断（保留前段）
          const keep = Math.max(0, t - overflow);
          included.set(section.key, section.text.slice(0, Math.floor(keep)));
          usage[section.key] = keep;
          overflow = 0;
        }
      }
    }

    const userBody = [...included.entries()]
      .filter(([k, v]) => LAYER_BUDGET.find((l) => l.key === k)?.priority !== undefined && v)
      .map(([k, v]) => v)
      .join('\n\n');

    const user = `${userBody}\n\n请现在开始创作这个场景的正文。`;

    return {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      usage,
      ragHits: ragHitMeta,
      entities,
    };
  }

  return { assemble };
}

export type ContextAssembler = ReturnType<typeof createContextAssembler>;
