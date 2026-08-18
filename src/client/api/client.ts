// API 客户端（Phase 1）
import type {
  Novel,
  Asset,
  AssetState,
  AssetInput,
  AssetWriteBack,
  OutlineNode,
  OutlineNodeInput,
  GenerateOutlineRequest,
  TrendResearch,
  HealthInfo,
  Scene,
  FactCard,
  Summary,
  ContentChunk,
  Conflict,
  PlotDevice,
} from '../types';

export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined && init?.body !== null;
  const res = await fetch(`/api${path}`, {
    headers: hasBody ? { 'Content-Type': 'application/json' } : {},
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

// ---------- 通用 ----------
export const getHealth = (): Promise<HealthInfo> => api('/health');

// ---------- 项目 ----------
export const listNovels = () => api<Novel[]>('/novels');
export const createNovel = (input: { title: string; genre?: string; target_audience?: string; selling_points?: string }) =>
  api<Novel>('/novels', { method: 'POST', body: JSON.stringify(input) });
export const deleteNovel = (id: string) => api<boolean>(`/novels/${id}`, { method: 'DELETE' });

// ---------- 资产 ----------
export const listAssets = (novelId: string, type?: string) =>
  api<Asset[]>(`/novels/${novelId}/assets${type ? `?type=${encodeURIComponent(type)}` : ''}`);
export const createAsset = (novelId: string, input: AssetInput) =>
  api<Asset>(`/novels/${novelId}/assets`, { method: 'POST', body: JSON.stringify(input) });
export const updateAsset = (novelId: string, id: string, patch: Partial<AssetInput>) =>
  api<Asset>(`/novels/${novelId}/assets/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
export const deleteAsset = (novelId: string, id: string) =>
  api<boolean>(`/novels/${novelId}/assets/${id}`, { method: 'DELETE' });
export const assetStates = (novelId: string, id: string) =>
  api<AssetState[]>(`/novels/${novelId}/assets/${id}/states`);
export const assetWriteBack = (novelId: string, id: string, input: AssetWriteBack) =>
  api<Asset>(`/novels/${novelId}/assets/${id}/writeback`, { method: 'POST', body: JSON.stringify(input) });

// ---------- 大纲 ----------
export const listOutline = (novelId: string) => api<OutlineNode[]>(`/novels/${novelId}/outline`);
export const createOutlineNode = (novelId: string, input: OutlineNodeInput) =>
  api<OutlineNode>(`/novels/${novelId}/outline`, { method: 'POST', body: JSON.stringify(input) });
export const updateOutlineNode = (novelId: string, id: string, patch: Partial<OutlineNodeInput>) =>
  api<OutlineNode>(`/novels/${novelId}/outline/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
export const deleteOutlineNode = (novelId: string, id: string) =>
  api<boolean>(`/novels/${novelId}/outline/${id}`, { method: 'DELETE' });
export const generateOutlineLayer = (novelId: string, input: GenerateOutlineRequest) =>
  api<{ kind: 'nodes'; nodes: OutlineNode[] } | { kind: 'assets'; count: number; names: string[] }>(
    `/novels/${novelId}/outline/generate`,
    { method: 'POST', body: JSON.stringify(input) }
  );

// ---------- 调研 ----------
export const getResearch = (novelId: string) => api<TrendResearch | null>(`/novels/${novelId}/research`);
export const runResearch = (novelId: string, query?: string) =>
  api<TrendResearch>(`/novels/${novelId}/research`, { method: 'POST', body: JSON.stringify({ query: query ?? '' }) });

// ---------- 创作 ----------
export const listScenes = (novelId: string) => api<Scene[]>(`/novels/${novelId}/scenes`);
export const getScene = (novelId: string, id: string) => api<Scene>(`/novels/${novelId}/scenes/${id}`);
export const updateScene = (novelId: string, id: string, patch: { content?: string; status?: Scene['status'] }) =>
  api<Scene>(`/novels/${novelId}/scenes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
export const deleteScene = (novelId: string, id: string) => api<boolean>(`/novels/${novelId}/scenes/${id}`, { method: 'DELETE' });
export const listFacts = (novelId: string) => api<FactCard[]>(`/novels/${novelId}/facts`);
export const listSummaries = (novelId: string) => api<Summary[]>(`/novels/${novelId}/summaries`);
export const listChunks = (novelId: string) => api<ContentChunk[]>(`/novels/${novelId}/chunks`);
export const listConflicts = (novelId: string) => api<Conflict[]>(`/novels/${novelId}/conflicts`);
export const listPlotDevices = (novelId: string) => api<PlotDevice[]>(`/novels/${novelId}/plotdevices`);

/** SSE 流式生成场景 */
export function generateSceneStream(
  novelId: string,
  outlineNodeId: string,
  onEvent: (ev: { type: string; [k: string]: unknown }) => void,
  onError?: (err: Error) => void
): () => void {
  const controller = new AbortController();
  (async () => {
    try {
      const res = await fetch(`/api/novels/${novelId}/writing/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outline_node_id: outlineNodeId }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const text = await res.text();
        throw new Error(`SSE ${res.status}: ${text}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
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
          try {
            onEvent(JSON.parse(payload));
          } catch {
            /* ignore */
          }
        }
      }
    } catch (err) {
      onError?.(err as Error);
    }
  })();
  return () => controller.abort();
}
