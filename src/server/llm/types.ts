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
export type ProviderKind = 'deepseek' | 'openai' | 'siliconflow' | 'ollama';

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
