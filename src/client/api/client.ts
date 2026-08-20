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
  RegenerateOutlineRequest,
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
  api<{ kind: 'nodes'; nodes: OutlineNode[]; skipped?: number } | { kind: 'assets'; count: number; names: string[]; batchLabel?: string; skipped?: number }>(
    `/novels/${novelId}/outline/generate`,
    { method: 'POST', body: JSON.stringify(input) }
  );
export const regenerateOutlineNode = (novelId: string, id: string, opinion: string) =>
  api<OutlineNode>(`/novels/${novelId}/outline/${id}/regenerate`, {
    method: 'POST',
    body: JSON.stringify({ opinion } as RegenerateOutlineRequest),
  });

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
export const listAllFacts = (novelId: string) => api<FactCard[]>(`/novels/${novelId}/facts/all`);
export const listSummaries = (novelId: string) => api<Summary[]>(`/novels/${novelId}/summaries`);
export const listChunks = (novelId: string) => api<ContentChunk[]>(`/novels/${novelId}/chunks`);
export const listConflicts = (novelId: string) => api<Conflict[]>(`/novels/${novelId}/conflicts`);
export const listPlotDevices = (novelId: string) => api<PlotDevice[]>(`/novels/${novelId}/plotdevices`);

/** SSE 流式生成场景 */
export function generateSceneStream(
  novelId: string,
  outlineNodeId: string,
  onEvent: (ev: { type: string; [k: string]: unknown }) => void,
  onError?: (err: Error) => void,
  opts?: { opinion?: string }
): () => void {
  const controller = new AbortController();
  (async () => {
    try {
      const res = await fetch(`/api/novels/${novelId}/writing/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outline_node_id: outlineNodeId, opinion: opts?.opinion ?? '' }),
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

// ---------- 质量闭环（Phase 4） ----------
export const resolveConflict = (novelId: string, id: string, status: Conflict['status'], resolution?: string) =>
  api<Conflict>(`/novels/${novelId}/conflicts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, resolution: resolution ?? '' }),
  });
export const updatePlotDevice = (novelId: string, id: string, status: PlotDevice['status']) =>
  api<PlotDevice>(`/novels/${novelId}/plotdevices/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
export const plotDeviceStats = (novelId: string) =>
  api<{ planted: number; developing: number; paid_off: number; abandoned: number; forgotten: number; total: number; due: number; chaptersWritten: number }>(
    `/novels/${novelId}/plotdevices/stats`
  );
export const detectForgottenPlotDevices = (novelId: string) =>
  api<{ forgotten: PlotDevice[] }>(`/novels/${novelId}/plotdevices/detect-forgotten`, { method: 'POST' });
export const runConsistencyCheck = (novelId: string) =>
  api<{
    checkedAt: string;
    forgotten: Array<{ id: string; description: string }>;
    createdConflicts: Array<{ id: string; description: string }>;
    openConflictCount: number;
    stats: PlotDeviceStats;
  }>(`/novels/${novelId}/consistency/check`, { method: 'POST' });
export const updateFactStatus = (novelId: string, id: string, status: FactCard['status']) =>
  api<FactCard>(`/novels/${novelId}/facts/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });

// 导出下载：直接构造下载链接（非 JSON 响应）
export function exportUrl(novelId: string, format: 'md' | 'epub' | 'docx'): string {
  return `/api/novels/${novelId}/export?format=${format}`;
}

/** 导出并触发浏览器下载；pandoc 缺失等错误会以 Error 抛出（fetch 后可读 JSON 错误） */
export async function exportNovel(novelId: string, format: 'md' | 'epub' | 'docx'): Promise<void> {
  const res = await fetch(exportUrl(novelId, format));
  if (!res.ok) {
    let message = `导出失败（${res.status}）`;
    try {
      const body = (await res.json()) as ApiEnvelope<unknown>;
      if (body.error) message = body.error;
    } catch {
      /* 非 JSON 错误体，保留状态码信息 */
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? `novel.${format}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface PlotDeviceStats {
  planted: number;
  developing: number;
  paid_off: number;
  abandoned: number;
  forgotten: number;
  total: number;
  due: number;
  chaptersWritten: number;
}

// ---------- 时间线（Phase 3 遗留：§9.2/§9.3 资产状态时间旅行） ----------
export interface TimelineSnapshot extends AssetState {
  sceneTitle: string | null;
  chapterId: string | null;
  chapterTitle: string | null;
  chapterOrder: number | null;
}

export interface NovelTimeline {
  chapters: Array<{ id: string; title: string | null; order: number }>;
  assets: Array<{
    id: string;
    name: string;
    type: Asset['type'];
    currentVersion: number;
    snapshots: TimelineSnapshot[];
  }>;
  assetless: Array<{ id: string; name: string; type: Asset['type']; currentVersion: number }>;
}

export interface ChapterStateView {
  chapterId: string | null;
  chapterTitle: string | null;
  chapterOrder: number | null;
  states: Array<{
    assetId: string;
    name: string;
    type: Asset['type'];
    version: number;
    state: Record<string, unknown>;
    sourceSceneId: string | null;
  }>;
}

export const getTimeline = (novelId: string) => api<NovelTimeline>(`/novels/${novelId}/timeline`);
export const getStateAtChapter = (novelId: string, chapterRef: { id?: string; order?: number }) => {
  const q = new URLSearchParams();
  if (chapterRef.id) q.set('chapter', chapterRef.id);
  if (chapterRef.order !== undefined) q.set('order', String(chapterRef.order));
  return api<ChapterStateView>(`/novels/${novelId}/timeline/at?${q.toString()}`);
};

// ---------- 设置（LLM 配置，前端可编辑 + 连接测试） ----------
export interface PublicSettings {
  values: Record<string, string>;
  sources: Record<string, 'db' | 'env'>;
  gatewayMode: string;
}

export interface TestResult {
  ok: boolean;
  tier: 'generate' | 'extract' | 'embed';
  provider: string;
  model: string;
  baseUrl: string;
  latencyMs: number;
  error?: string;
}

export const getSettings = () => api<PublicSettings>('/settings');
export const saveSettings = (payload: Record<string, string>) =>
  api<PublicSettings>('/settings', { method: 'PUT', body: JSON.stringify(payload) });
/** 测试连接：携带当前屏幕上的配置（含未保存草稿），后端仅按此测试、不落库 */
export const testSettingsConnection = (payload: Record<string, string> = {}) =>
  api<TestResult[]>('/settings/test', { method: 'POST', body: JSON.stringify({ payload }) });

// ---------- 提示词（可编辑，存 app_settings，key 前缀 PROMPT_） ----------
export interface PromptEntry {
  key: string;
  label: string;
  desc: string;
  group: string;
  hasPlaceholder?: boolean;
  value: string;
  source: 'db' | 'default';
}

export const getPrompts = () => api<PromptEntry[]>('/settings/prompts');
export const savePrompts = (payload: Record<string, string>) =>
  api<PromptEntry[]>('/settings/prompts', { method: 'PUT', body: JSON.stringify(payload) });
