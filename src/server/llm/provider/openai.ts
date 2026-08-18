// OpenAI 兼容 provider：覆盖 DeepSeek / OpenAI / 硅基流动（均为 /chat/completions + /embeddings）
import type {
  GenerateRequest,
  ExtractRequest,
  StructuredResult,
  Chunk,
  ProviderConfig,
} from '../types.js';

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
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        /* fallthrough */
      }
    }
    // 兜底：取第一个 { 到最后一个 } 之间的内容
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error(`无法从 LLM 输出解析 JSON：${content.slice(0, 200)}`);
  }
}

export function createOpenAICompatGateway(cfg: ProviderConfig): OpenAICompatGateway {
  const provider = cfg.provider;
  const model = cfg.model;
  const baseUrl = stripTrailingSlash(cfg.baseUrl ?? 'https://api.deepseek.com');
  const apiKey = cfg.apiKey ?? '';
  const chatUrl = `${baseUrl}/chat/completions`;
  const embedUrl = `${baseUrl}/embeddings`;

  function assertKey() {
    if (!apiKey) {
      throw new Error(`[llm:${provider}] 未配置 API Key，请在 .env 中设置（${provider}）`);
    }
  }

  async function* generate(req: GenerateRequest): AsyncIterable<Chunk> {
    assertKey();
    const res = await fetch(chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: req.messages,
        stream: true,
        temperature: req.temperature ?? 0.8,
        max_tokens: req.maxTokens,
      }),
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
              choices?: Array<{ delta?: { content?: string } }>;
              usage?: { prompt_tokens?: number; completion_tokens?: number };
            };
            const delta = json.choices?.[0]?.delta?.content;
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
    assertKey();
    const messages = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    messages.push({ role: 'user', content: req.user });

    const res = await fetch(chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) {
      throw new Error(`[llm:${provider}] HTTP ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content ?? '';
    const json = parseJsonContent(content);
    return {
      json,
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens ?? 0,
            outputTokens: data.usage.completion_tokens ?? 0,
          }
        : undefined,
    };
  }

  async function embed(texts: string[], modelOverride?: string): Promise<number[][]> {
    assertKey();
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
