// 模块：应用设置（settings）—— 前端可配置 LLM 密钥/地址/模型，并测试连接（覆盖 .env，热生效）
// 优先级：DB 设置（前端保存，非空） > 环境变量
import type { SettingsRepository } from '../../db/repositories/settings.js';
import type { GatewayConfig } from '../../llm/index.js';
import { loadGatewayConfigFromEnv } from '../../llm/index.js';

export interface SettingsDeps {
  repo: SettingsRepository;
  env?: NodeJS.ProcessEnv;
}

/** 前端可编辑的 LLM 设置项（空字符串 = 清除该设置，回退 env） */
export interface LlmSettingsPayload {
  deepseekApiKey?: string;
  deepseekBaseUrl?: string;
  deepseekModel?: string;
  extractModel?: string;
  siliconflowApiKey?: string;
  siliconflowBaseUrl?: string;
  embedModel?: string;
  ollamaBaseUrl?: string;
  gatewayMode?: string;
}

const DB_KEY: Record<keyof LlmSettingsPayload, string> = {
  deepseekApiKey: 'DEEPSEEK_API_KEY',
  deepseekBaseUrl: 'DEEPSEEK_BASE_URL',
  deepseekModel: 'DEEPSEEK_MODEL',
  extractModel: 'EXTRACT_MODEL',
  siliconflowApiKey: 'SILICONFLOW_API_KEY',
  siliconflowBaseUrl: 'SILICONFLOW_BASE_URL',
  embedModel: 'EMBED_MODEL',
  ollamaBaseUrl: 'OLLAMA_BASE_URL',
  gatewayMode: 'GATEWAY_MODE',
};

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

  /** 当前生效的完整网关配置（DB 非空覆盖 env） */
  function getConfig(): GatewayConfig {
    const base = loadGatewayConfigFromEnv(env);
    const db = repo.getAll();
    const pick = (key: string): string | undefined => {
      const v = db[key];
      return v !== undefined && v !== '' ? v : undefined;
    };

    return {
      generate: {
        ...base.generate,
        provider: (pick('GATEWAY_MODE') as never) ?? base.generate.provider,
        apiKey: pick('DEEPSEEK_API_KEY') ?? base.generate.apiKey,
        baseUrl: pick('DEEPSEEK_BASE_URL') ?? base.generate.baseUrl,
        model: pick('DEEPSEEK_MODEL') ?? base.generate.model,
      },
      extract: {
        ...base.extract,
        provider: (pick('GATEWAY_MODE') as never) ?? base.extract.provider,
        apiKey: pick('DEEPSEEK_API_KEY') ?? base.extract.apiKey,
        baseUrl: pick('DEEPSEEK_BASE_URL') ?? base.extract.baseUrl,
        model: pick('EXTRACT_MODEL') ?? pick('DEEPSEEK_MODEL') ?? base.extract.model,
      },
      embed: {
        ...base.embed,
        provider: base.embed.provider, // embedding 的 provider 仍由 env 决定（默认硅基流动）
        apiKey: pick('SILICONFLOW_API_KEY') ?? base.embed.apiKey,
        baseUrl: pick('SILICONFLOW_BASE_URL') ?? base.embed.baseUrl,
        model: pick('EMBED_MODEL') ?? base.embed.model,
      },
    };
  }

  /** 保存前端设置（空字符串清除对应 DB 项，回退 env） */
  function save(payload: LlmSettingsPayload): PublicSettings {
    const toSet: Record<string, string> = {};
    const toClear: string[] = [];
    for (const [field, value] of Object.entries(payload)) {
      const key = DB_KEY[field as keyof LlmSettingsPayload];
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
    const secretKeys = new Set(['DEEPSEEK_API_KEY', 'SILICONFLOW_API_KEY']);

    for (const key of Object.values(DB_KEY)) {
      const fromDb = db[key] && db[key] !== '';
      const envVal = env[key] ?? '';
      const val = fromDb ? db[key] : envVal;
      sources[key] = fromDb ? 'db' : 'env';
      values[key] = secretKeys.has(key) ? maskSecret(val) : val;
    }
    return { values, sources, gatewayMode: db['GATEWAY_MODE'] ?? env['GATEWAY_MODE'] ?? '' };
  }

  /** 测试连接有效性：对 generate/extract/embed 各发一个最小请求 */
  async function testConnection(): Promise<TestConnectionResult[]> {
    const cfg = getConfig();
    const results: TestConnectionResult[] = [];

    const testChat = async (tier: 'generate' | 'extract', pc: GatewayConfig['generate']): Promise<void> => {
      const baseUrl = (pc.baseUrl ?? '').replace(/\/+$/, '');
      const started = Date.now();
      try {
        if (!pc.apiKey) throw new Error('未配置 API Key');
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pc.apiKey}` },
          body: JSON.stringify({
            model: pc.model,
            messages: [{ role: 'user', content: 'ping' }],
            stream: false,
            max_tokens: 1,
          }),
          signal: AbortSignal.timeout(15000),
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
      const baseUrl = (pc.baseUrl ?? '').replace(/\/+$/, '');
      const started = Date.now();
      try {
        if (!pc.apiKey) throw new Error('未配置 API Key');
        const res = await fetch(`${baseUrl}/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pc.apiKey}` },
          body: JSON.stringify({ model: pc.model, input: ['ping'] }),
          signal: AbortSignal.timeout(15000),
        });
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

    // mock 模式：直接返回「可用」（无需网络）
    if ((env['GATEWAY_MODE'] ?? cfg.generate.provider) === 'mock') {
      return ['generate', 'extract', 'embed'].map((tier) => ({
        ok: true,
        tier: tier as 'generate' | 'extract' | 'embed',
        provider: 'mock',
        model: 'mock',
        baseUrl: 'mock',
        latencyMs: 0,
      }));
    }

    await testChat('generate', cfg.generate);
    await testChat('extract', cfg.extract);
    await testEmbed();
    return results;
  }

  return { getConfig, save, publicSettings, testConnection, maskSecret };
}

export type SettingsService = ReturnType<typeof createSettingsService>;
