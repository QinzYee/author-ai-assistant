// ====================================================================
// 共享类型（前后端共用）—— 与架构文档 §5 SQLite Schema 一一对应
// ====================================================================

// ---------- 项目 ----------
export type NovelStatus = 'research' | 'outline' | 'writing' | 'finished';

export interface Novel {
  id: string;
  title: string;
  genre: string | null;
  status: NovelStatus;
  target_audience: string | null;
  selling_points: string | null;
  created_at: string;
}

export type NewNovel = Pick<Novel, 'title'> &
  Partial<Pick<Novel, 'genre' | 'target_audience' | 'selling_points'>>;

// ---------- 资产 ----------
export type AssetType = 'character' | 'location' | 'item' | 'organization' | 'setting';

export interface Asset {
  id: string;
  novel_id: string;
  type: AssetType;
  name: string;
  core: Record<string, unknown>;
  extended: Record<string, unknown> | null;
  summary: string | null;
  current_version: number;
  created_at: string;
  updated_at: string;
}

export interface AssetState {
  id: string;
  asset_id: string;
  version: number;
  state: Record<string, unknown>;
  source_scene_id: string | null;
  created_at: string;
}

export interface AssetRelation {
  id: string;
  novel_id: string;
  from_asset: string;
  to_asset: string;
  relation_type: string;
  description: string | null;
}

// ---------- 大纲树（创意→梗概→卷→章→场景） ----------
export type OutlineLevel = 'idea' | 'synopsis' | 'volume' | 'chapter' | 'scene';
export type OutlineStatus = 'planned' | 'confirmed' | 'writing' | 'done';

/** 场景大纲结构（§4.2），chars 即「实体驱动确定性检索」的入口 */
export interface SceneOutline {
  scene?: string;
  time?: string;
  location?: string;
  characters?: string[];
  goal?: string;
  conflict?: string;
  result?: string;
  info_revealed?: string[];
  foreshadowing?: string[];
  continuity_notes?: string;
  [key: string]: unknown;
}

export interface OutlineNode {
  id: string;
  novel_id: string;
  parent_id: string | null;
  level: OutlineLevel;
  title: string | null;
  summary: string | null;
  content: SceneOutline | null;
  sort_order: number;
  status: OutlineStatus;
}

// ---------- 正文 ----------
export type SceneStatus = 'draft' | 'revised' | 'approved';

/** 场景生成元数据（§4.3 主调用输出） */
export interface ForeshadowingOp {
  op: 'plant' | 'develop' | 'payoff';
  description: string;
  type?: string;
}

export interface SceneMeta {
  new_facts?: string[];
  asset_changes?: Record<string, unknown>;
  foreshadowing?: string[];
  foreshadowing_ops?: ForeshadowingOp[];
  pov?: string;
  time?: string;
  [key: string]: unknown;
}

export interface Scene {
  id: string;
  novel_id: string;
  outline_node_id: string | null;
  content: string;
  word_count: number;
  meta: SceneMeta | null;
  status: SceneStatus;
  created_at: string;
  updated_at: string;
}

// ---------- 事实卡片 ----------
export type FactCardStatus = 'active' | 'superseded' | 'retracted';

export interface FactCard {
  id: string;
  novel_id: string;
  fact: string;
  entities: string[];
  source_scene_id: string | null;
  confidence: number;
  status: FactCardStatus;
  created_at: string;
}

// ---------- 摘要树（L2） ----------
export type SummaryLevel = 'scene' | 'chapter' | 'volume';

export interface Summary {
  id: string;
  novel_id: string;
  level: SummaryLevel;
  ref_id: string;
  content: string;
  created_at: string;
}

// ---------- 正文分块 + 向量（L3） ----------
export interface ContentChunk {
  id: string;
  novel_id: string;
  scene_id: string | null;
  chunk_index: number;
  content: string;
  embedding: ArrayBuffer | null;
}

// ---------- 伏笔台账 ----------
export type PlotDeviceType = 'identity' | 'item' | 'event' | 'prophecy' | 'location';
export type PlotDeviceStatus = 'planted' | 'developing' | 'paid_off' | 'abandoned' | 'forgotten';

export interface PlotDevice {
  id: string;
  novel_id: string;
  type: PlotDeviceType;
  description: string;
  status: PlotDeviceStatus;
  planted_scene_id: string | null;
  expected_payoff: string | null;
  related_entities: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ---------- 一致性冲突 ----------
export type ConflictType = 'contradiction' | 'missing_detail' | 'timeline_issue' | 'loose_thread';
export type ConflictStatus = 'open' | 'auto_fixed' | 'resolved' | 'ignored';

export interface Conflict {
  id: string;
  novel_id: string;
  type: ConflictType;
  description: string;
  evidence: unknown;
  status: ConflictStatus;
  resolution: string | null;
  created_at: string;
  updated_at: string;
}

// ---------- 调研 / 生成日志 ----------
export interface TrendResearch {
  id: string;
  novel_id: string;
  query: string;
  results: unknown;
  conclusion: string | null;
  created_at: string;
}

export interface GenerationLog {
  id: string;
  novel_id: string;
  scene_id: string | null;
  pass_type: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
}

// ---------- 资产：输入 / 写回 ----------
export interface AssetInput {
  type: AssetType;
  name: string;
  core?: Record<string, unknown>;
  extended?: Record<string, unknown> | null;
  summary?: string | null;
}

export interface AssetWriteBack {
  /** 新状态（作为该版本完整快照写入 asset_states） */
  state: Record<string, unknown>;
  source_scene_id?: string | null;
  /** 可选：随写回一起更新 core/extended/summary */
  patch?: Partial<Pick<Asset, 'core' | 'extended' | 'summary'>>;
}

export interface AssetRelationInput {
  from_asset: string;
  to_asset: string;
  relation_type: string;
  description?: string | null;
}

// ---------- 大纲：层级 / 生成 ----------
export type OutlineNodeInput = {
  parent_id?: string | null;
  level: OutlineLevel;
  title?: string | null;
  summary?: string | null;
  content?: SceneOutline | null;
  sort_order?: number;
  status?: OutlineStatus;
};

/** 分层生成的层级（§4.2 自顶向下链） */
export type OutlineLayer = 'idea' | 'worldview' | 'synopsis' | 'character' | 'volume' | 'chapter' | 'scene';

export interface GenerateOutlineRequest {
  layer: OutlineLayer;
  /** 子层生成时所属的父节点（chapter 生成时传 volume id，scene 生成时传 chapter id） */
  parent_id?: string | null;
  count?: number;
}

/** 大纲分层生成的产出（LLM 结构化结果） */
export interface CoreIdea {
  high_concept: string;
  target_reader: string;
  selling_points: string[];
  logline: string;
}

export interface WorldviewItem {
  name: string;
  rule: string;
  extended?: string;
}

export interface CharacterBio {
  name: string;
  role: '主角' | '配角' | '反派' | '其他';
  identity: string;
  personality: string;
  goal: string;
  motivation: string;
  arc: string;
  state?: string;
  location?: string;
  appearance?: string;
}

export interface Synopsis {
  title: string;
  three_acts: string[];
  theme: string;
}

export interface VolumeOutlineItem {
  title: string;
  goal: string;
  turning_point: string;
  suspense: string;
  ending_hook: string;
}

export interface ChapterOutlineItem {
  title: string;
  pov: string;
  goal: string;
  conflict: string;
  ending_hook: string;
  characters?: string[];
}

// ---------- 调研 ----------
export interface ResearchHeatRank {
  genre: string;
  trend: string;
}

export interface ResearchReport {
  heat_ranking: ResearchHeatRank[];
  reader_profiles: string[];
  core_pleasure_points: string[];
  blue_ocean_ideas: string[];
  golden_three_chapters: string[];
  recommendation: string;
}

export interface SearchHit {
  title: string;
  url: string;
  content: string;
}

// ---------- API 统一响应 ----------
export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export type HealthInfo = {
  ok: boolean;
  db: boolean;
  schemaVersion: number;
  time: string;
};
