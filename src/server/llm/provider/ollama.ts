// Ollama 本地 provider（可选）：/api/chat（流式）+ /api/embed
import type {
  GenerateRequest,
  ExtractRequest,
  StructuredResult,
  Chunk,
  ProviderConfig,
} from '../types.js';

export interface OllamaGateway {
  generate(req: GenerateRequest): AsyncIterable<Chunk>;
  extract(req: ExtractRequest): Promise<StructuredResult>;
  embed(texts: string[], model?: string): Promise<number[][]>;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export function createOllamaGateway(getCfg: () => ProviderConfig): OllamaGateway {
  function resolve(): ProviderConfig {
    return getCfg();
  }

  async function* generate(req: GenerateRequest): AsyncIterable<Chunk> {
    const { model, baseUrl } = resolve();
    const url = `${stripTrailingSlash(baseUrl ?? 'http://localhost:11434')}/api/chat`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: req.messages,
        stream: true,
        options: { temperature: req.temperature ?? 0.8, num_predict: req.maxTokens },
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`[llm:ollama] HTTP ${res.status}: ${await res.text()}`);
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
          if (!trimmed) continue;
          try {
            const json = JSON.parse(trimmed) as {
              message?: { content?: string };
              done?: boolean;
            };
            const content = json.message?.content;
            if (content) yield { type: 'text', text: content };
            if (json.done) {
              yield { type: 'done' };
              return;
            }
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
    const { model, baseUrl } = resolve();
    const url = `${stripTrailingSlash(baseUrl ?? 'http://localhost:11434')}/api/chat`;
    const messages = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    messages.push({ role: 'user', content: req.user });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        format: 'json',
        options: { temperature: 0 },
      }),
    });
    if (!res.ok) throw new Error(`[llm:ollama] HTTP ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { message?: { content?: string } };
    const content = data.message?.content ?? '{}';
    // 解析出第一个 { ... } 对象
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    const json =
      start !== -1 && end > start ? JSON.parse(content.slice(start, end + 1)) : {};
    return { json };
  }

  async function embed(texts: string[], modelOverride?: string): Promise<number[][]> {
    const { model, baseUrl } = resolve();
    const url = `${stripTrailingSlash(baseUrl ?? 'http://localhost:11434')}/api/embed`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelOverride ?? model, input: texts }),
    });
    if (!res.ok) throw new Error(`[llm:ollama] HTTP ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { embeddings?: number[][] };
    return data.embeddings ?? [];
  }

  return { generate, extract, embed };
}
