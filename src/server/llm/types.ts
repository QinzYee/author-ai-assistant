// ====================================================================
// LLM 网关 —— 所有模块只面向本接口（架构文档 §11.2）
// ====================================================================

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

/** 流式输出块 */
export interface Chunk {
  type: 'text' | 'done' | 'error';
  text?: string;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface ExtractRequest {
  system?: string;
  user: string;
  /** 可选：给模型的 JSON 结构说明（不强制 schema 校验，Phase 0 由模型遵守） */
  jsonSchema?: Record<string, unknown>;
  /**
   * JSON 模式：'object' 强制 json_object（只保证顶层是对象，数组类输出会冲突）；
   * 'auto' 不强制，交由模型按 prompt 输出（数组/对象均可，卷/章/场景大纲用）。
   * 默认 'object'，保持既有行为。
   */
  jsonMode?: 'object' | 'auto';
}

export interface StructuredResult {
  json: unknown;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface LlmGateway {
  /** 流式对话生成（正文主调用等） */
  generate(req: GenerateRequest): AsyncIterable<Chunk>;
  /** JSON 模式结构化提取（资产/事实/摘要 pass 用） */
  extract(req: ExtractRequest): Promise<StructuredResult>;
  /** 文本向量化 */
  embed(texts: string[], model?: string): Promise<number[][]>;
}

// ---------- 配置 ----------
export type ProviderKind = 'deepseek' | 'openai' | 'siliconflow' | 'ollama' | 'minimax' | 'mock';

export interface ProviderConfig {
  provider: ProviderKind;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

/** 模型分级配置：生成级 / 提取级 / 向量级，可热更新（§11.2） */
export interface GatewayConfig {
  generate: ProviderConfig;
  extract: ProviderConfig;
  embed: ProviderConfig;
}

/**
 * 判断 baseUrl 是否为 Anthropic Messages 兼容端点（如 MiniMax 的 https://api.minimaxi.com/anthropic）。
 * 是则走 /v1/messages + x-api-key（Anthropic 格式）；否则走 OpenAI 兼容 /chat/completions + Bearer。
 */
export function isAnthropicBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  return /anthropic/i.test(baseUrl);
}
