// 提示词管理模块 —— 所有 LLM 提示词集中在此，支持前端覆盖（存 app_settings，key 前缀 PROMPT_）
// 读取优先级：DB 覆盖（非空） > 内置默认值
// 占位符：PROMPT_MEMORY_SUMMARY 含 {kind}，读取时按需替换
import type { SettingsRepository } from '../../db/repositories/settings.js';

/** 提示词元信息：key、中文名、说明、是否长文本、分组 */
export interface PromptDef {
  key: string;
  label: string;
  desc: string;
  group: string;
  /** 含占位符 {kind}（摘要模板用），编辑时提示勿删 */
  hasPlaceholder?: boolean;
}

export interface PromptEntry extends PromptDef {
  /** 当前生效值（DB 覆盖 ?? 默认） */
  value: string;
  /** 来源：db | default */
  source: 'db' | 'default';
}

export interface PromptsDeps {
  repo: SettingsRepository;
}

/** 内置默认提示词（迁移自各模块的历史常量） */
const DEFAULT_PROMPTS: Record<string, string> = {
  // ---- 正文生成（§4.3 pass ②）----
  PROMPT_WRITING_BASE: `你是一位资深的中文网文作者，擅长快餐爽文的节奏与爽感，行文流畅、情绪密度高。请严格遵循：
1. 只创作当前场景的正文，不写章、不写卷、不写说明；
2. 最高优先级是「爽」：每一段都要有情绪价值，爽点连续不断，读感优先于一切；
3. 正文控制在 1200~2000 字，节奏明快、冲突推进、信息揭示及时；宁可短而爽，不可长而闷；
4. 设定不必求新，传统套路写扎实就是好文；逻辑做到自洽、别让读者明显出戏即可，不要为严谨而束手束脚，也不必刻意压制主角能力；
5. 不剧透尚未揭晓的设定，不违背既有事实卡片；
6. 输出纯粹的小说正文（不加标题、不加引号包裹）。`,

  PROMPT_WRITING_RULES: `【爽点指南】
围绕以下现代读者买账的爽点展开（不必全用，选贴合本场景的 1~3 个写透）：
- 人前显圣：在关键场合展露实力/才华/魅力，收割惊叹与认同；刻画人物弧光与魅力，而非刻意扮猪吃虎或低级打脸；
- 升级养成：突出「从无到有、从少到多」的成长快感——名气、作品、财富、境界、人脉的累积与兑现；
- 情感拉扯：克制的暧昧推拉（甜中带旖旎），或张力十足的修罗场三角拉扯；拒绝狗血误会与降智操作；
- 危机翻转：把主角逼到绝境再漂亮翻盘，先抑后扬，制造痛快感。

【节奏要求】
- 每隔一小段就制造一个情绪小高潮或新钩子，保证「爽点不断」；
- 行文流畅、对白鲜活有张力，避免大段说教与无意义铺垫；
- 结束时留下明确的钩子，勾着读者想看下一幕。

【一致性（次要保障，不是创作枷锁）】
- 时间线、地点、人物基本状态与大纲一致，避免前后矛盾让读者出戏；
- 未回收伏笔可在本场景埋设/发展/回收，但不得遗忘；
- 涉及资产状态时与已有设定相符，如需变化请自然带出。`,

  PROMPT_WRITING_PROHIBIT: `【禁止剧透】
- 不得泄露尚未通过正文揭示的世界观秘密；
- 不得让角色知道他不该知道的信息。`,

  // ---- 场景流水线提取/校验（§4.3 pass ③~⑥）----
  PROMPT_EXTRACT_META: `你是小说创作流水线的元数据提取器。根据场景正文提取结构化元数据。只输出 JSON：
{
  "new_facts": ["原子事实，如：林晚左臂在第二章被划伤，尚未痊愈"],
  "asset_changes": {"人物名": {"state": {"hp": "当前状态", "location": "当前位置"}, "relations": []}},
  "foreshadowing_ops": [{"op": "plant|develop|payoff", "description": "伏笔描述", "type": "identity|item|event|prophecy|location"}],
  "pov": "视角人物",
  "time": "主线时间"
}`,

  PROMPT_ASSET_UPDATE: `你是资产更新器。根据场景正文与该场景涉及的旧资产状态，输出资产变更。只输出 JSON：
{"changes": [{"name": "人物/物品名", "state": {"hp": "...", "location": "..."}, "relations": []}]}
要求：只列状态真正发生变化的资产；状态要具体、可版本化。`,

  PROMPT_FACT_EXTRACT: `你是事实卡片提取器。将场景正文中的持久事实提取为原子事实卡片。只输出 JSON：
{"facts": [{"fact": "原子事实描述", "entities": ["相关实体"]}]}
要求：提取的是不会随上下文变化的持久事实；去除临时感受。`,

  PROMPT_VERIFY: `你是长篇小说一致性校验器。对比「新事实」与「既有事实/资产状态」，找出矛盾或遗漏。只输出 JSON：
{"conflicts": [{"type": "contradiction|missing_detail|timeline_issue", "description": "问题描述", "evidence": "双方证据"}]}
没有冲突则返回 {"conflicts": []}。`,

  // ---- 大纲分层生成（§4.2）----
  PROMPT_OUTLINE_IDEA: `你是资深网文策划。为一部新小说生成「核心创意」。只输出 JSON，结构：
{"high_concept":"高概念一句话","target_reader":"目标读者","selling_points":["卖点1"],"logline":"一句话梗概"}
要求：差异化、可落地、符合长篇小说一致性要求。`,

  PROMPT_OUTLINE_SYNOPSIS: `你是资深网文结构师。基于核心创意生成「主线梗概」（三幕结构）。只输出 JSON：
{"title":"小说标题","three_acts":["第一幕：...","第二幕：...","第三幕：..."],"theme":"主题"}
要求：与核心创意一致，三幕起承转合完整，结尾留钩子。`,

  PROMPT_OUTLINE_WORLDVIEW: `你是世界观架构师。为小说生成核心「设定/规则」（powers/rules），每条小而稳（§9.1：核心属性 50~100 token）。只输出 JSON 数组：
[{"name":"规则名","rule":"一句话规则","extended":"细则/边界案例"}]
条数 3~5。`,

  PROMPT_OUTLINE_CHARACTER: `你是人物设定师。基于核心创意与世界观生成「人物小传」。只输出 JSON 数组：
[{"name":"姓名","role":"主角|配角|反派|其他","identity":"身份","personality":"一句话性格","goal":"当前目标","motivation":"动机","arc":"成长弧光","state":"当前状态(伤势/位置)","location":"当前位置"}]
主角1名、反派1名、配角1~2名。`,

  PROMPT_OUTLINE_VOLUME: `你是长篇小说结构师。基于主线梗概生成「卷大纲」。只输出 JSON 数组：
[{"title":"卷名","goal":"本卷目标","turning_point":"转折","suspense":"悬念","ending_hook":"结尾钩子"}]
要求：每卷结尾至少推进或回收一个伏笔（§10.2），卷数 2~4。`,

  PROMPT_OUTLINE_CHAPTER: `你是章回体作者。基于卷大纲生成「章大纲」。只输出 JSON 数组：
[{"title":"章名","pov":"视角人物","goal":"本章目标","conflict":"冲突","ending_hook":"结尾钩子","characters":["出场人物"]}]
要求：与卷目标一致，人物取自可用角色，每章结尾有钩子。`,

  PROMPT_OUTLINE_SCENE: `你是场景分镜师。基于章大纲生成「场景大纲」（创作单元，§4.2）。只输出 JSON 数组，每个元素：
{"scene":"场景名","time":"主线第X天 时刻","location":"地点","characters":["人物(角色)"],"goal":"场景目标","conflict":"冲突","result":"结果","info_revealed":["揭示的信息"],"foreshadowing":["埋设/发展/回收伏笔"],"continuity_notes":"与前文的一致性提醒"}
要求：characters 必须来自可用角色；每个场景是记忆与资产更新的最小单元；result 明确状态变更；若有伏笔操作需注明。`,

  // ---- 题材调研（§4.1）----
  PROMPT_RESEARCH_ANALYSIS: `你是网文题材分析师。基于搜索材料与模型知识，输出结构化调研报告。只输出 JSON：
{
  "heat_ranking": [{"genre":"题材/流派","trend":"趋势方向"}],
  "reader_profiles": ["读者画像"],
  "core_pleasure_points": ["核心爽点：升级感/悬念/情感/世界观新奇度"],
  "blue_ocean_ideas": ["蓝海组合建议"],
  "golden_three_chapters": ["黄金三章要素清单"],
  "recommendation": "最终题材方向建议"
}`,

  // ---- 记忆（§7 摘要 + compact 物化）----
  PROMPT_MEMORY_SUMMARY: `你是小说情节记忆整理器。将给定的{kind}内容压缩为简洁的情节摘要（保留关键事件、人物状态变化、伏笔推进），150 字以内，只输出 JSON：{"summary":"..."}`,

  PROMPT_MEMORY_FACTS: `你是事实卡片提取器。将场景正文中的持久事实提取为原子事实卡片。只输出 JSON：
{"facts":[{"fact":"原子事实描述","entities":["相关实体"]}]}`,

  PROMPT_MEMORY_ASSETS: `你是资产更新器。根据场景正文提取资产状态变更。只输出 JSON：
{"changes":[{"name":"人物/物品名","state":{"hp":"...","location":"..."},"relations":[]}]}`,

  PROMPT_MEMORY_PLOT: `你是伏笔台账整理器。提取正文中的伏笔操作。只输出 JSON：
{"ops":[{"op":"plant|develop|payoff","description":"伏笔描述","type":"identity|item|event|prophecy|location"}]}`,
};

const PROMPT_DEFS: PromptDef[] = [
  { key: 'PROMPT_WRITING_BASE', label: '正文生成 · 基础规则', desc: '快餐爽文总纲：爽点优先、字数、输出要求', group: '正文生成' },
  { key: 'PROMPT_WRITING_RULES', label: '正文生成 · 爽点指南', desc: '人前显圣/升级养成/情感拉扯/危机翻转 + 节奏 + 一致性', group: '正文生成' },
  { key: 'PROMPT_WRITING_PROHIBIT', label: '正文生成 · 禁止项', desc: '剧透/越权信息限制', group: '正文生成' },
  { key: 'PROMPT_EXTRACT_META', label: '场景 · 元数据提取', desc: '新事实/资产变化/伏笔操作/POV/时间', group: '场景流水线' },
  { key: 'PROMPT_ASSET_UPDATE', label: '场景 · 资产更新', desc: '场景内资产状态变更写回', group: '场景流水线' },
  { key: 'PROMPT_FACT_EXTRACT', label: '场景 · 事实提取', desc: '持久事实 → 事实卡片', group: '场景流水线' },
  { key: 'PROMPT_VERIFY', label: '场景 · 一致性校验', desc: '新旧事实/资产对比找矛盾', group: '场景流水线' },
  { key: 'PROMPT_OUTLINE_IDEA', label: '大纲 · 核心创意', desc: '高概念/目标读者/卖点/一句话梗概', group: '大纲生成' },
  { key: 'PROMPT_OUTLINE_SYNOPSIS', label: '大纲 · 主线梗概', desc: '三幕结构 + 标题 + 主题', group: '大纲生成' },
  { key: 'PROMPT_OUTLINE_WORLDVIEW', label: '大纲 · 世界观设定', desc: '核心规则/设定 → settings 资产', group: '大纲生成' },
  { key: 'PROMPT_OUTLINE_CHARACTER', label: '大纲 · 人物小传', desc: '主角/反派/配角 → character 资产', group: '大纲生成' },
  { key: 'PROMPT_OUTLINE_VOLUME', label: '大纲 · 卷大纲', desc: '卷目标/转折/悬念/结尾钩子', group: '大纲生成' },
  { key: 'PROMPT_OUTLINE_CHAPTER', label: '大纲 · 章大纲', desc: '章目标/冲突/POV/结尾钩子', group: '大纲生成' },
  { key: 'PROMPT_OUTLINE_SCENE', label: '大纲 · 场景大纲', desc: '场景名/时间/地点/人物/目标/结果', group: '大纲生成' },
  { key: 'PROMPT_RESEARCH_ANALYSIS', label: '题材调研 · 分析报告', desc: '热度榜单/读者画像/爽点/蓝海建议', group: '题材调研' },
  { key: 'PROMPT_MEMORY_SUMMARY', label: '记忆 · 情节摘要', desc: '场景/章/卷摘要压缩（含 {kind} 占位，勿删）', group: '记忆', hasPlaceholder: true },
  { key: 'PROMPT_MEMORY_FACTS', label: '记忆 · 物化事实', desc: 'compact 时提取事实卡片', group: '记忆' },
  { key: 'PROMPT_MEMORY_ASSETS', label: '记忆 · 物化资产', desc: 'compact 时提取资产状态', group: '记忆' },
  { key: 'PROMPT_MEMORY_PLOT', label: '记忆 · 物化伏笔', desc: 'compact 时提取伏笔操作', group: '记忆' },
];

export function createPromptsService(deps: PromptsDeps) {
  const { repo } = deps;

  /** 读取提示词：DB 覆盖 ?? 默认；缺省 key 回退默认值（兼容旧库） */
  function get(key: string, replace?: Record<string, string>): string {
    const def = DEFAULT_PROMPTS[key] ?? '';
    const db = repo.get(key);
    let value = db && db !== '' ? db : def;
    if (replace) {
      for (const [k, v] of Object.entries(replace)) value = value.split(`{${k}}`).join(v);
    }
    return value;
  }

  /** 全部提示词（含默认值 + 当前覆盖值），供前端编辑 UI */
  function all(): PromptEntry[] {
    return PROMPT_DEFS.map((d) => {
      const db = repo.get(d.key);
      const fromDb = db && db !== '';
      return {
        ...d,
        value: fromDb ? (db as string) : (DEFAULT_PROMPTS[d.key] ?? ''),
        source: fromDb ? 'db' : 'default',
      };
    });
  }

  /** 保存提示词覆盖（空字符串 = 恢复默认） */
  function save(payload: Record<string, string>): PromptEntry[] {
    const toSet: Record<string, string> = {};
    const toClear: string[] = [];
    for (const [key, value] of Object.entries(payload)) {
      if (!PROMPT_DEFS.some((d) => d.key === key)) continue; // 只接受已知 key
      const v = (value ?? '').trim();
      if (v === '') toClear.push(key);
      else toSet[key] = v;
    }
    if (Object.keys(toSet).length > 0) repo.setMany(toSet);
    if (toClear.length > 0) repo.remove(toClear);
    return all();
  }

  return { get, all, save, defs: PROMPT_DEFS, keys: PROMPT_DEFS.map((d) => d.key) };
}

export type PromptsService = ReturnType<typeof createPromptsService>;
