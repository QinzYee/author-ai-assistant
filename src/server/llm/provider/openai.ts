// OpenAI 兼容 provider：覆盖 DeepSeek / OpenAI / 硅基流动（均为 /chat/completions + /embeddings）
// 也支持 Anthropic Messages 兼容端点（如 MiniMax https://api.minimaxi.com/anthropic → /v1/messages + x-api-key）
import type {
  GenerateRequest,
  ExtractRequest,
  StructuredResult,
  Chunk,
  ProviderConfig,
  ChatMessage,
} from '../types.js';
import { isAnthropicBaseUrl } from '../types.js';

export interface OpenAICompatGateway {
  generate(req: GenerateRequest): AsyncIterable<Chunk>;
  extract(req: ExtractRequest): Promise<StructuredResult>;
  embed(texts: string[], model?: string): Promise<number[][]>;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function parseJsonContent(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // 去掉 ```json ... ``` 围栏后重试
    const fence = '```';
    const fenceStart = trimmed.indexOf(fence);
    const fenceEnd = fenceStart !== -1 ? trimmed.indexOf(fence, fenceStart + 3) : -1;
    if (fenceStart !== -1 && fenceEnd > fenceStart) {
      const inner = trimmed.slice(fenceStart + 3, fenceEnd).trim();
      try { return JSON.parse(inner); } catch { /* fallthrough */ }
    }
    // 兜底 1：取第一个 [ 到最后一个 ] 之间的内容（数组输出，卷/章/场景大纲）
    const arrStart = trimmed.indexOf('[');
    const arrEnd = trimmed.lastIndexOf(']');
    if (arrStart !== -1 && arrEnd > arrStart) {
      try { return JSON.parse(trimmed.slice(arrStart, arrEnd + 1)); } catch { /* fallthrough */ }
    }
    // 兜底 2：取第一个 { 到最后一个 } 之间的内容（对象输出）
    const objStart = trimmed.indexOf('{');
    const objEnd = trimmed.lastIndexOf('}');
    if (objStart !== -1 && objEnd > objStart) {
      try { return JSON.parse(trimmed.slice(objStart, objEnd + 1)); } catch { /* fallthrough */ }
    }
    throw new Error(`无法从 LLM 输出解析 JSON：${content.slice(0, 200)}`);
  }
}

export function createOpenAICompatGateway(getCfg: () => ProviderConfig): OpenAICompatGateway {
  // 每次调用读取最新配置（前端设置可热生效）
  const cfg = getCfg();
  const provider = cfg.provider;

  function resolve(): ProviderConfig {
    return getCfg();
  }

  function assertKey(apiKey: string | undefined) {
    if (!apiKey) {
      throw new Error(`[llm:${provider}] 未配置 API Key，请在设置中填写（${provider}）`);
    }
  }

  async function* generate(req: GenerateRequest): AsyncIterable<Chunk> {
    const { apiKey, model, baseUrl } = resolve();
    assertKey(apiKey);
    const base = stripTrailingSlash(baseUrl ?? 'https://api.deepseek.com');
    const anthropic = isAnthropicBaseUrl(baseUrl);
    const chatUrl = anthropic ? `${base}/v1/messages` : `${base}/chat/completions`;
    const headers: Record<string, string> = anthropic
      ? { 'Content-Type': 'application/json', 'x-api-key': apiKey!, 'anthropic-version': '2023-06-01' }
      : { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
    const system = req.messages.find((m) => m.role === 'system')?.content;
    const anthropicMessages = req.messages
      .filter((m) => m.role !== 'system')
      .map((m): { role: 'user' | 'assistant'; content: string } => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      }));
    const body = anthropic
      ? {
          model,
          max_tokens: req.maxTokens ?? 2048,
          stream: true,
          ...(system ? { system } : {}),
          messages: anthropicMessages,
        }
      : {
          model,
          messages: req.messages,
          stream: true,
          temperature: req.temperature ?? 0.8,
          max_tokens: req.maxTokens,
        };
    const res = await fetch(chatUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      throw new Error(`[llm:${provider}] HTTP ${res.status}: ${await res.text()}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') {
            yield { type: 'done' };
            return;
          }
          try {
            const json = JSON.parse(payload) as {
              type?: string;
              choices?: Array<{ delta?: { content?: string } }>;
              delta?: { type?: string; text?: string };
              usage?: { prompt_tokens?: number; completion_tokens?: number };
            };
            let delta: string | undefined;
            if (anthropic) {
              if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
                delta = json.delta.text;
              }
              if (json.type === 'message_stop') {
                yield { type: 'done' };
                return;
              }
            } else {
              delta = json.choices?.[0]?.delta?.content;
            }
            if (delta) yield { type: 'text', text: delta };
          } catch {
            /* 忽略畸形行 */
          }
        }
      }
      yield { type: 'done' };
    } finally {
      reader.releaseLock();
    }
  }

  async function extract(req: ExtractRequest): Promise<StructuredResult> {
    const { apiKey, model, baseUrl } = resolve();
    assertKey(apiKey);
    const base = stripTrailingSlash(baseUrl ?? 'https://api.deepseek.com');
    const anthropic = isAnthropicBaseUrl(baseUrl);
    const chatUrl = anthropic ? `${base}/v1/messages` : `${base}/chat/completions`;
    const headers: Record<string, string> = anthropic
      ? { 'Content-Type': 'application/json', 'x-api-key': apiKey!, 'anthropic-version': '2023-06-01' }
      : { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
    const body = anthropic
      ? {
          model,
          max_tokens: 2048,
          ...(req.system ? { system: req.system } : {}),
          messages: [{ role: 'user', content: req.user }],
        }
      : {
          model,
          messages: [
            ...(req.system ? [{ role: 'system', content: req.system }] : []),
            { role: 'user', content: req.user },
          ],
          stream: false,
          temperature: 0,
          ...(req.jsonMode === 'auto' ? {} : { response_format: { type: 'json_object' } }),
        };

    const res = await fetch(chatUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`[llm:${provider}] HTTP ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as {
      content?: Array<{ text?: string }>;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
    };
    const content = anthropic ? (data.content?.[0]?.text ?? '') : (data.choices?.[0]?.message?.content ?? '');
    const json = parseJsonContent(content);
    return {
      json,
      usage: data.usage
        ? anthropic
          ? { inputTokens: data.usage.input_tokens ?? 0, outputTokens: data.usage.output_tokens ?? 0 }
          : { inputTokens: data.usage.prompt_tokens ?? 0, outputTokens: data.usage.completion_tokens ?? 0 }
        : undefined,
    };
  }

  async function embed(texts: string[], modelOverride?: string): Promise<number[][]> {
    const { apiKey, model, baseUrl } = resolve();
    assertKey(apiKey);
    const embedUrl = `${stripTrailingSlash(baseUrl ?? 'https://api.deepseek.com')}/embeddings`;
    const res = await fetch(embedUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: modelOverride ?? model, input: texts }),
    });
    if (!res.ok) {
      throw new Error(`[llm:${provider}] HTTP ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    const embeds = data.data ?? [];
    if (embeds.length !== texts.length) {
      throw new Error(`[llm:${provider}] embedding 返回数量不匹配：期望 ${texts.length}，实际 ${embeds.length}`);
    }
    return embeds.map((d) => d.embedding ?? []);
  }

  return { generate, extract, embed };
}
