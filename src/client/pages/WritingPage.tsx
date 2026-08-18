import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNovel } from '../context/NovelContext';
import * as api from '../api/client';
import type { OutlineNode, Scene, FactCard, PlotDevice } from '../types';

interface WriteEv {
  type: string;
  stage?: string;
  message?: string;
  text?: string;
  scene?: Scene;
  error?: string;
  [k: string]: unknown;
}

const STAGE_LABEL: Record<string, string> = {
  context: '组装上下文',
  generate: '生成正文',
  meta: '提取元数据',
  assets: '更新资产',
  facts: '提取事实',
  verify: '校验一致性',
  summary: '生成摘要',
  index: '分块入库',
};

export default function WritingPage() {
  const { current } = useNovel();
  const [outline, setOutline] = useState<OutlineNode[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [facts, setFacts] = useState<FactCard[]>([]);
  const [devices, setDevices] = useState<PlotDevice[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<string>('');
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [streamedText, setStreamedText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<(() => void) | null>(null);

  const load = useCallback(async () => {
    if (!current) return;
    try {
      const [o, s, f, d] = await Promise.all([
        api.listOutline(current.id),
        api.listScenes(current.id),
        api.listFacts(current.id),
        api.listPlotDevices(current.id),
      ]);
      setOutline(o);
      setScenes(s);
      setFacts(f);
      setDevices(d);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [current?.id]);

  useEffect(() => {
    setScenes([]);
    setOutline([]);
    setFacts([]);
    setDevices([]);
    setSelectedSceneId('');
    void load();
  }, [current?.id, load]);

  const sceneNodes = useMemo(() => outline.filter((n) => n.level === 'scene'), [outline]);
  const selectedScene = scenes.find((s) => s.id === selectedSceneId) ?? null;

  const beginGenerate = async (node: OutlineNode) => {
    if (!current) return;
    setGenerating(true);
    setError(null);
    setProgress(['发起生成…']);
    setStreamedText('');
    setSelectedSceneId('');

    api.generateSceneStream(
      current.id,
      node.id,
      (ev: WriteEv) => {
        if (ev.type === 'status' && ev.stage) {
          const label = STAGE_LABEL[ev.stage] ?? ev.stage;
          setProgress((p) => [...p, `${label}…`]);
        } else if (ev.type === 'text' && ev.text) {
          setStreamedText((t) => t + ev.text);
        } else if (ev.type === 'done') {
          setProgress((p) => [...p, '✅ 完成']);
          setSelectedSceneId(ev.scene?.id ?? '');
          setGenerating(false);
          void load();
        } else if (ev.type === 'error') {
          setError(ev.error ?? '生成失败');
          setGenerating(false);
        }
      },
      (err) => {
        setError(err.message);
        setGenerating(false);
      }
    );
  };

  const stopGenerate = () => {
    abortRef.current?.();
    setGenerating(false);
  };

  const saveContent = async (content: string) => {
    if (!current || !selectedScene) return;
    await api.updateScene(current.id, selectedScene.id, { content });
    setSelectedSceneId(selectedScene.id);
    void load();
  };

  return (
    <div className="max-w-6xl">
      <h2 className="text-2xl font-semibold mb-1">创作工作台</h2>
      <p className="text-sm text-slate-500 mb-6">场景级流水线：上下文组装 → 正文生成（SSE 进度）→ 资产/事实/校验/摘要 pass → 分块入库（§4.3）</p>

      {error && (
        <div className="mb-4 flex items-center justify-between rounded-lg bg-rose-900/40 border border-rose-800 px-4 py-3 text-sm text-rose-200">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-300">✕</button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        {/* 左侧：场景大纲列表 + 进度 */}
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">场景列表（待创作）</h3>
            {sceneNodes.length === 0 ? (
              <p className="text-xs text-slate-600">暂无场景大纲，请先在大纲页生成。</p>
            ) : (
              <div className="space-y-1.5">
                {sceneNodes.map((n) => {
                  const sc = scenes.find((s) => s.outline_node_id === n.id);
                  return (
                    <div
                      key={n.id}
                      className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{n.title}</div>
                          {n.summary && <div className="text-xs text-slate-500 truncate">{n.summary}</div>}
                        </div>
                        {sc ? (
                          <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-300">
                            已生成 {sc.word_count} 字
                          </span>
                        ) : (
                          <button
                            onClick={() => beginGenerate(n)}
                            disabled={generating}
                            className="shrink-0 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-40 px-2.5 py-1 text-xs font-medium"
                          >
                            生成
                          </button>
                        )}
                      </div>
                      {sc && (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <button
                            onClick={() => setSelectedSceneId(sc.id)}
                            className="text-xs text-slate-400 hover:text-white rounded bg-slate-800 px-2 py-0.5"
                          >
                            {selectedSceneId === sc.id ? '✓ 查看' : '查看'}
                          </button>
                          <button
                            onClick={() => beginGenerate(n)}
                            disabled={generating}
                            className="text-xs text-slate-400 hover:text-white rounded bg-slate-800 px-2 py-0.5 disabled:opacity-40"
                          >
                            重生成
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 进度 */}
          {progress.length > 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-300">生成进度</h3>
                {generating && (
                  <button onClick={stopGenerate} className="text-xs text-rose-400 hover:text-rose-300">
                    停止
                  </button>
                )}
              </div>
              <div className="space-y-1">
                {progress.map((p, i) => (
                  <div key={i} className={`text-xs ${p.includes('✅') ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {generating && i === progress.length - 1 ? <span className="inline-block animate-pulse">{p}</span> : p}
                  </div>
                ))}
              </div>
              {streamedText && (
                <div className="mt-3 max-h-48 overflow-auto rounded bg-slate-950 border border-slate-800 p-2 text-xs text-slate-300 whitespace-pre-wrap">
                  {streamedText}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 右侧：编辑器 + 元数据 */}
        <div className="space-y-4">
          {selectedScene ? (
            <>
              <SceneEditor scene={selectedScene} onSave={saveContent} />
              <MetadataPanel facts={facts} devices={devices} scene={selectedScene} />
            </>
          ) : (
            <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-slate-800 text-slate-600 text-sm">
              {generating ? '正在生成…' : '选择左侧场景查看/编辑，或点击「生成」创作新场景'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SceneEditor({ scene, onSave }: { scene: Scene; onSave: (c: string) => void }) {
  const [content, setContent] = useState(scene.content);
  const [saved, setSaved] = useState(false);
  useEffect(() => setContent(scene.content), [scene.id]);

  const save = () => {
    void onSave(content);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-300">场景正文 · {scene.word_count} 字 · {scene.status}</h3>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-emerald-400">已保存</span>}
          <button onClick={save} className="rounded bg-sky-600 hover:bg-sky-500 px-3 py-1 text-xs font-medium">
            保存
          </button>
        </div>
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="min-h-[320px] w-full rounded-lg bg-slate-950 border border-slate-800 p-3 text-sm leading-relaxed outline-none focus:ring-1 ring-sky-500"
        placeholder="场景正文…"
      />
    </div>
  );
}

function MetadataPanel({ facts, devices, scene }: { facts: FactCard[]; devices: PlotDevice[]; scene: Scene }) {
  const sceneFacts = facts.filter((f) => f.source_scene_id === scene.id);
  const sceneDevices = devices.filter((d) => d.planted_scene_id === scene.id);
  const meta = scene.meta ?? {};

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <h3 className="text-sm font-semibold text-slate-300 mb-3">元数据与记忆</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="text-xs font-semibold text-slate-500 mb-1.5">🃏 事实卡片（本场景）</h4>
          {sceneFacts.length === 0 ? (
            <p className="text-xs text-slate-600">无</p>
          ) : (
            <ul className="space-y-1">
              {sceneFacts.map((f) => (
                <li key={f.id} className="text-xs text-slate-400">• {f.fact}</li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 className="text-xs font-semibold text-slate-500 mb-1.5">🪝 伏笔操作</h4>
          {sceneDevices.length === 0 && !meta.foreshadowing_ops?.length ? (
            <p className="text-xs text-slate-600">无</p>
          ) : (
            <ul className="space-y-1">
              {sceneDevices.map((d) => (
                <li key={d.id} className="text-xs text-slate-400">• [{d.status}] {d.description}</li>
              ))}
              {(meta.foreshadowing_ops ?? []).map((op: { op: string; description: string }, i: number) => (
                <li key={`op-${i}`} className="text-xs text-amber-400/80">• {op.op}: {op.description}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="sm:col-span-2">
          <h4 className="text-xs font-semibold text-slate-500 mb-1.5">📝 场景元数据</h4>
          {meta.pov || meta.time ? (
            <p className="text-xs text-slate-400">POV: {meta.pov ?? '?'} ｜ 时间: {meta.time ?? '?'}</p>
          ) : (
            <p className="text-xs text-slate-600">无</p>
          )}
        </div>
      </div>
    </div>
  );
}
