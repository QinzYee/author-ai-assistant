// 模块：应用设置（settings）—— 前端可配置 LLM 密钥/地址/模型，并测试连接（覆盖 .env，热生效）
// 优先级：DB 设置（前端保存，非空） > 环境变量
import type { SettingsRepository } from '../../db/repositories/settings.js';
import type { GatewayConfig } from '../../llm/index.js';
import { loadGatewayConfigFromEnv, isAnthropicBaseUrl } from '../../llm/index.js';

export interface SettingsDeps {
  repo: SettingsRepository;
  env?: NodeJS.ProcessEnv;
}

/** 前端可编辑的 LLM 设置项（空字符串 = 清除该设置，回退 env） */
export interface LlmSettingsPayload {
  // 聊天供应商选择（generate/extract 用哪家）
  chatProvider?: string;
  // DeepSeek
  deepseekApiKey?: string;
  deepseekBaseUrl?: string;
  deepseekModel?: string;
  extractModel?: string;
  // MiniMax
  minimaxApiKey?: string;
  minimaxBaseUrl?: string;
  minimaxModel?: string;
  // OpenAI（直连）
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  // Ollama 本地聊天
  ollamaChatModel?: string;
  // Embedding 提供方选择 + 各供应商
  embedProvider?: string;
  siliconflowApiKey?: string;
  siliconflowBaseUrl?: string;
  embedModel?: string;
  ollamaBaseUrl?: string;
  // 网关模式（mock）
  gatewayMode?: string;
}

const DB_KEY: Record<keyof LlmSettingsPayload, string> = {
  chatProvider: 'CHAT_PROVIDER',
  deepseekApiKey: 'DEEPSEEK_API_KEY',
  deepseekBaseUrl: 'DEEPSEEK_BASE_URL',
  deepseekModel: 'DEEPSEEK_MODEL',
  extractModel: 'EXTRACT_MODEL',
  minimaxApiKey: 'MINIMAX_API_KEY',
  minimaxBaseUrl: 'MINIMAX_BASE_URL',
  minimaxModel: 'MINIMAX_MODEL',
  openaiApiKey: 'OPENAI_API_KEY',
  openaiBaseUrl: 'OPENAI_BASE_URL',
  openaiModel: 'OPENAI_MODEL',
  ollamaChatModel: 'OLLAMA_CHAT_MODEL',
  embedProvider: 'EMBED_PROVIDER',
  siliconflowApiKey: 'SILICONFLOW_API_KEY',
  siliconflowBaseUrl: 'SILICONFLOW_BASE_URL',
  embedModel: 'EMBED_MODEL',
  ollamaBaseUrl: 'OLLAMA_BASE_URL',
  gatewayMode: 'GATEWAY_MODE',
};

/**
 * 把前端传来的 key 归一化为 DB key。
 * 前端设置面板发送的是 DB key（如 DEEPSEEK_API_KEY、CHAT_PROVIDER）；
 * 兼容文档约定的 camelCase 字段名（如 deepseekApiKey、chatProvider），二者皆可。
 */
function resolveDbKey(field: string): string | null {
  const mapped = DB_KEY[field as keyof LlmSettingsPayload];
  if (mapped) return mapped;
  return (Object.values(DB_KEY) as string[]).includes(field) ? field : null;
}

/** 返回给前端的设置（密钥脱敏） */
export interface PublicSettings {
  /** 各字段当前生效值（来源优先 DB，其次 env） */
  values: Record<string, string>;
  /** 每个字段的来源：db | env */
  sources: Record<string, 'db' | 'env'>;
  /** 当前网关模式 */
  gatewayMode: string;
}

export interface TestConnectionResult {
  ok: boolean;
  tier: 'generate' | 'extract' | 'embed';
  provider: string;
  model: string;
  baseUrl: string;
  latencyMs: number;
  error?: string;
}

/** 脱敏：sk-abc123xyz → sk-***xyz（保留前 3 与后 4）；短密钥全掩 */
export function maskSecret(key: string | null | undefined): string {
  const k = (key ?? '').trim();
  if (!k) return '';
  if (k.length <= 8) return '***';
  return `${k.slice(0, 3)}***${k.slice(-4)}`;
}

export function createSettingsService(deps: SettingsDeps) {
  const { repo } = deps;
  const env = deps.env ?? process.env;

  /**
   * 当前生效的完整网关配置（DB 非空覆盖 env）。
   * overrides：键为 DB key 或 camelCase 字段名，仅本次生效（用于“测试当前屏幕配置”，不落库）。
   */
  function getConfig(overrides: Record<string, string> = {}): GatewayConfig {
    const base = loadGatewayConfigFromEnv(env);
    const db = repo.getAll();
    const pick = (key: string): string | undefined => {
      if (Object.prototype.hasOwnProperty.call(overrides, key)) {
        const v = overrides[key];
        return v !== undefined && v !== '' ? v : undefined;
      }
      const v = db[key];
      return v !== undefined && v !== '' ? v : undefined;
    };

    // 当前聊天供应商：DB CHAT_PROVIDER > env CHAT_PROVIDER > 默认 deepseek
    const chatProvider = (pick('CHAT_PROVIDER') ?? env.CHAT_PROVIDER ?? base.generate.provider) as string;
    const provider = chatProvider === 'mock' ? 'mock' : chatProvider;

    // 按聊天供应商从 DB/env 取对应配置
    const chatConfig = (): { apiKey?: string; baseUrl: string; model: string } => {
      switch (provider) {
        case 'minimax':
          return {
            apiKey: pick('MINIMAX_API_KEY') ?? env.MINIMAX_API_KEY,
            baseUrl: pick('MINIMAX_BASE_URL') ?? env.MINIMAX_BASE_URL ?? 'https://api.minimaxi.com/v1',
            model: pick('MINIMAX_MODEL') ?? env.MINIMAX_MODEL ?? 'MiniMax-Text-01',
          };
        case 'openai':
          return {
            apiKey: pick('OPENAI_API_KEY') ?? env.OPENAI_API_KEY,
            baseUrl: pick('OPENAI_BASE_URL') ?? env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
            model: pick('OPENAI_MODEL') ?? env.OPENAI_MODEL ?? 'gpt-4o-mini',
          };
        case 'ollama':
          return {
            baseUrl: pick('OLLAMA_BASE_URL') ?? env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
            model: pick('OLLAMA_CHAT_MODEL') ?? env.OLLAMA_CHAT_MODEL ?? 'qwen2.5',
          };
        case 'deepseek':
        default:
          return {
            apiKey: pick('DEEPSEEK_API_KEY') ?? env.DEEPSEEK_API_KEY,
            baseUrl: pick('DEEPSEEK_BASE_URL') ?? env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
            model: pick('DEEPSEEK_MODEL') ?? env.DEEPSEEK_MODEL ?? 'deepseek-chat',
          };
      }
    };
    const chat = chatConfig();

    // embed 提供方：DB EMBED_PROVIDER > env（默认 siliconflow）
    const embedProvider = (pick('EMBED_PROVIDER') ?? env.EMBED_PROVIDER ?? base.embed.provider) as string;
    const isEmbedOllama = embedProvider === 'ollama';

    return {
      generate: {
        provider: provider as never,
        ...chat,
      },
      extract: {
        provider: provider as never,
        ...chat,
        model: pick('EXTRACT_MODEL') ?? env.EXTRACT_MODEL ?? chat.model,
      },
      embed: {
        provider: embedProvider as never,
        apiKey: isEmbedOllama ? undefined : (pick('SILICONFLOW_API_KEY') ?? env.SILICONFLOW_API_KEY),
        baseUrl: isEmbedOllama
          ? pick('OLLAMA_BASE_URL') ?? env.OLLAMA_BASE_URL ?? 'http://localhost:11434'
          : pick('SILICONFLOW_BASE_URL') ?? env.SILICONFLOW_BASE_URL ?? 'https://api.siliconflow.cn/v1',
        model: pick('EMBED_MODEL') ?? env.EMBED_MODEL ?? (isEmbedOllama ? 'bge-m3' : 'BAAI/bge-m3'),
      },
    };
  }

  /** 保存前端设置（空字符串清除对应 DB 项，回退 env）；返回保存后的公开设置 */
  function save(payload: Record<string, string>): PublicSettings {
    const toSet: Record<string, string> = {};
    const toClear: string[] = [];
    for (const [field, value] of Object.entries(payload)) {
      const key = resolveDbKey(field);
      if (!key) continue;
      const v = (value ?? '').trim();
      if (v === '') {
        toClear.push(key);
      } else {
        toSet[key] = v;
      }
    }
    if (Object.keys(toSet).length > 0) repo.setMany(toSet);
    if (toClear.length > 0) repo.remove(toClear);
    return publicSettings();
  }

  /** 前端可读的设置（脱敏） */
  function publicSettings(): PublicSettings {
    const db = repo.getAll();
    const values: Record<string, string> = {};
    const sources: Record<string, 'db' | 'env'> = {};
    const secretKeys = new Set(['DEEPSEEK_API_KEY', 'SILICONFLOW_API_KEY', 'MINIMAX_API_KEY', 'OPENAI_API_KEY']);

    for (const key of Object.values(DB_KEY)) {
      const fromDb = db[key] && db[key] !== '';
      const envVal = env[key] ?? '';
      const val = fromDb ? db[key] : envVal;
      sources[key] = fromDb ? 'db' : 'env';
      values[key] = secretKeys.has(key) ? maskSecret(val) : val;
    }
    return { values, sources, gatewayMode: db['GATEWAY_MODE'] ?? env['GATEWAY_MODE'] ?? '' };
  }

  /**
   * 测试连接有效性：对 generate/extract/embed 各发一个最小请求。
   * rawOverrides：前端当前屏幕上的配置（含未保存草稿），仅本次测试生效、不落库。
   */
  async function testConnection(rawOverrides: Record<string, string> = {}): Promise<TestConnectionResult[]> {
    // 归一化 override 的 key（兼容 DB key 与 camelCase 字段名）
    const overrides: Record<string, string> = {};
    for (const [field, value] of Object.entries(rawOverrides)) {
      const key = resolveDbKey(field);
      if (key && value !== undefined) overrides[key] = value;
    }
    const cfg = getConfig(overrides);
    const results: TestConnectionResult[] = [];

    const pushMock = (tier: 'generate' | 'extract' | 'embed'): void => {
      results.push({ ok: true, tier, provider: 'mock', model: 'mock', baseUrl: 'mock', latencyMs: 0 });
    };

    const testChat = async (tier: 'generate' | 'extract', pc: GatewayConfig['generate']): Promise<void> => {
      if (pc.provider === 'mock') {
        pushMock(tier);
        return;
      }
      const baseUrl = (pc.baseUrl ?? '').replace(/\/+$/, '');
      const started = Date.now();
      try {
        if (!pc.apiKey) throw new Error('未配置 API Key');
        const anthropic = isAnthropicBaseUrl(pc.baseUrl);
        const headers: Record<string, string> = anthropic
          ? { 'Content-Type': 'application/json', 'x-api-key': pc.apiKey, 'anthropic-version': '2023-06-01' }
          : { 'Content-Type': 'application/json', Authorization: `Bearer ${pc.apiKey}` };
        const body = anthropic
          ? { model: pc.model, max_tokens: 8, messages: [{ role: 'user', content: 'ping' }] }
          : { model: pc.model, messages: [{ role: 'user', content: 'ping' }], stream: false, max_tokens: 1 };
        const res = await fetch(anthropic ? `${baseUrl}/v1/messages` : `${baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30000),
        });
        const latencyMs = Date.now() - started;
        if (!res.ok) {
          const text = (await res.text()).slice(0, 300);
          throw new Error(`HTTP ${res.status}: ${text}`);
        }
        results.push({ ok: true, tier, provider: pc.provider, model: pc.model, baseUrl, latencyMs });
      } catch (err) {
        results.push({
          ok: false,
          tier,
          provider: pc.provider,
          model: pc.model,
          baseUrl,
          latencyMs: Date.now() - started,
          error: (err as Error).message,
        });
      }
    };

    const testEmbed = async (): Promise<void> => {
      const pc = cfg.embed;
      if (pc.provider === 'mock') {
        pushMock('embed');
        return;
      }
      const baseUrl = (pc.baseUrl ?? '').replace(/\/+$/, '');
      const started = Date.now();
      const isOllama = pc.provider === 'ollama';
      try {
        let res: Response;
        if (isOllama) {
          // Ollama 本地 embedding：无需 API Key
          res = await fetch(`${baseUrl}/api/embed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: pc.model, input: ['ping'] }),
            signal: AbortSignal.timeout(30000),
          });
        } else {
          if (!pc.apiKey) throw new Error('未配置 API Key');
          res = await fetch(`${baseUrl}/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pc.apiKey}` },
            body: JSON.stringify({ model: pc.model, input: ['ping'] }),
            signal: AbortSignal.timeout(30000),
          });
        }
        const latencyMs = Date.now() - started;
        if (!res.ok) {
          const text = (await res.text()).slice(0, 300);
          throw new Error(`HTTP ${res.status}: ${text}`);
        }
        results.push({ ok: true, tier: 'embed', provider: pc.provider, model: pc.model, baseUrl, latencyMs });
      } catch (err) {
        results.push({
          ok: false,
          tier: 'embed',
          provider: pc.provider,
          model: pc.model,
          baseUrl,
          latencyMs: Date.now() - started,
          error: (err as Error).message,
        });
      }
    };

    await testChat('generate', cfg.generate);
    await testChat('extract', cfg.extract);
    await testEmbed();
    return results;
  }

  return { getConfig, save, publicSettings, testConnection, maskSecret };
}

export type SettingsService = ReturnType<typeof createSettingsService>;
