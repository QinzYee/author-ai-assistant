// 极简 API 客户端（Phase 0 骨架，后续按模块扩展）
export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  const body = (await res.json()) as ApiEnvelope<T>;
  if (!body.ok) {
    throw new Error(body.error ?? 'unknown api error');
  }
  return body.data as T;
}

export async function getHealth(): Promise<{ ok: boolean; db: boolean; schemaVersion: number; time: string }> {
  return api('/health');
}
