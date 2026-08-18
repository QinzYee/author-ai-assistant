import type {
  LlmGateway,
  GatewayConfig,
  ProviderConfig,
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
  return {
    generate: {
      provider: 'deepseek',
      model: env.DEEPSEEK_MODEL ?? 'deepseek-chat',
      apiKey: env.DEEPSEEK_API_KEY,
      baseUrl: env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    },
    extract: {
      provider: 'deepseek',
      model: env.EXTRACT_MODEL ?? env.DEEPSEEK_MODEL ?? 'deepseek-chat',
      apiKey: env.DEEPSEEK_API_KEY,
      baseUrl: env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    },
    embed: {
      provider: 'siliconflow',
      model: env.EMBED_MODEL ?? 'BAAI/bge-m3',
      apiKey: env.SILICONFLOW_API_KEY,
      baseUrl: env.SILICONFLOW_BASE_URL ?? 'https://api.siliconflow.cn/v1',
    },
  };
}

function createProvider(cfg: ProviderConfig): Pick<LlmGateway, 'generate' | 'extract' | 'embed'> {
  switch (cfg.provider) {
    case 'mock':
      return createMockGateway(cfg);
    case 'ollama':
      return createOllamaGateway(cfg);
    case 'deepseek':
    case 'openai':
    case 'siliconflow':
      return createOpenAICompatGateway(cfg);
    default:
      throw new Error(`未知 provider：${(cfg as ProviderConfig).provider}`);
  }
}

/** 组装完整网关：按分级配置分别实例化生成/提取/向量 provider */
export function createGateway(config: GatewayConfig): LlmGateway {
  const gen = createProvider(config.generate);
  const ext = createProvider(config.extract);
  const emb = createProvider(config.embed);

  return {
    generate(req: GenerateRequest) {
      return gen.generate(req);
    },
    extract(req: ExtractRequest) {
      return ext.extract(req);
    },
    embed(texts: string[], model?: string) {
      return emb.embed(texts, model);
    },
  };
}
