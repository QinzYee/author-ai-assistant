import type {
  LlmGateway,
  GatewayConfig,
  ProviderConfig,
  ProviderKind,
  GenerateRequest,
  ExtractRequest,
} from './types.js';
import { createOpenAICompatGateway } from './provider/openai.js';
import { createOllamaGateway } from './provider/ollama.js';
import { createMockGateway } from './provider/mock.js';

export * from './types.js';

/** 默认模型分级配置（§11.2），可用 .env 覆盖 */
export const DEFAULT_TIER_CONFIG: GatewayConfig = {
  generate: { provider: 'deepseek', model: 'deepseek-chat' },
  extract: { provider: 'deepseek', model: 'deepseek-chat' },
  embed: { provider: 'siliconflow', model: 'BAAI/bge-m3' },
};

/** 从环境变量构建分级配置 */
export function loadGatewayConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  if (env.GATEWAY_MODE === 'mock') {
    return {
      generate: { provider: 'mock', model: 'mock' },
      extract: { provider: 'mock', model: 'mock' },
      embed: { provider: 'mock', model: 'mock' },
    };
  }

  // 聊天 provider（正文/提取用哪家），默认 deepseek，可切换 minimax / openai / ollama
  const chatProvider = (env.CHAT_PROVIDER ?? 'deepseek') as ProviderKind;
  const chat = chatConfigFromEnv(env, chatProvider);

  return {
    generate: { ...chat },
    extract: { ...chat, model: env.EXTRACT_MODEL ?? chat.model },
    embed: {
      provider: 'siliconflow',
      model: env.EMBED_MODEL ?? 'BAAI/bge-m3',
      apiKey: env.SILICONFLOW_API_KEY,
      baseUrl: env.SILICONFLOW_BASE_URL ?? 'https://api.siliconflow.cn/v1',
    },
  };
}

/** 按聊天 provider 从 env 构建对应配置（含各自 key/url/model） */
function chatConfigFromEnv(env: NodeJS.ProcessEnv, provider: ProviderKind): ProviderConfig {
  switch (provider) {
    case 'minimax':
      return {
        provider: 'minimax',
        model: env.MINIMAX_MODEL ?? 'MiniMax-Text-01',
        apiKey: env.MINIMAX_API_KEY,
        baseUrl: env.MINIMAX_BASE_URL ?? 'https://api.minimaxi.com/v1',
      };
    case 'openai':
      return {
        provider: 'openai',
        model: env.OPENAI_MODEL ?? 'gpt-4o-mini',
        apiKey: env.OPENAI_API_KEY,
        baseUrl: env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
      };
    case 'ollama':
      return {
        provider: 'ollama',
        model: env.OLLAMA_CHAT_MODEL ?? 'qwen2.5',
        baseUrl: env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
      };
    case 'mock':
      return { provider: 'mock', model: 'mock' };
    case 'deepseek':
    default:
      return {
        provider: 'deepseek',
        model: env.DEEPSEEK_MODEL ?? 'deepseek-chat',
        apiKey: env.DEEPSEEK_API_KEY,
        baseUrl: env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
      };
  }
}

function createProvider(getCfg: () => ProviderConfig): Pick<LlmGateway, 'generate' | 'extract' | 'embed'> {
  const cfg = getCfg();
  switch (cfg.provider) {
    case 'mock':
      return createMockGateway(getCfg);
    case 'ollama':
      return createOllamaGateway(getCfg);
    case 'deepseek':
    case 'openai':
    case 'siliconflow':
    case 'minimax':
      return createOpenAICompatGateway(getCfg);
    default:
      throw new Error(`未知 provider：${(cfg as ProviderConfig).provider}`);
  }
}

/**
 * 组装完整网关：按分级配置分别实例化生成/提取/向量 provider。
 * 传入 `getConfig` getter（而非固定 config），使每次调用读取最新配置——
 * 前端设置保存后无需重启即可热生效（§11.2 模型分级可热更新）。
 */
export function createGateway(getConfig: () => GatewayConfig): LlmGateway {
  return {
    generate(req) {
      return createProvider(() => getConfig().generate).generate(req);
    },
    extract(req) {
      return createProvider(() => getConfig().extract).extract(req);
    },
    embed(texts: string[], model?: string) {
      return createProvider(() => getConfig().embed).embed(texts, model);
    },
  };
}
