import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNovel } from '../context/NovelContext';
import * as api from '../api/client';
import type { AssetType } from '../types';

const TYPE_EMOJI: Record<AssetType, string> = {
  character: '👤',
  location: '📍',
  item: '📦',
  organization: '🏛️',
  setting: '📜',
};

const TYPE_LABEL: Record<AssetType, string> = {
  character: '人物',
  location: '地点',
  item: '物品',
  organization: '组织',
  setting: '设定',
};

/** 从状态快照里挑出最可读的关键字段（优先 location/hp/status/state，其余扁平输出） */
function formatState(state: Record<string, unknown>): string {
  const keys = Object.keys(state ?? {});
  if (keys.length === 0) return '（无状态变更记录）';
  const priority = ['location', 'hp', 'status', 'state', 'position', '伤势', '位置', '状态'];
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const k of priority) {
    if (k in state && !seen.has(k)) {
      seen.add(k);
      parts.push(`${k}: ${String(state[k])}`);
    }
  }
  for (const k of keys) {
    if (!seen.has(k)) parts.push(`${k}: ${String(state[k])}`);
  }
  return parts.join(' ｜ ');
}

export default function TimelinePage() {
  const { current } = useNovel();
  const [timeline, setTimeline] = useState<api.NovelTimeline | null>(null);
  const [atChapter, setAtChapter] = useState<api.ChapterStateView | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [traveling, setTraveling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!current) return;
    setLoading(true);
    setError(null);
    try {
      const t = await api.getTimeline(current.id);
      setTimeline(t);
      // 默认选中第一个有状态变化的章
      if (t.chapters.length > 0) {
        setSelectedChapterId(t.chapters[0].id);
        const view = await api.getStateAtChapter(current.id, { id: t.chapters[0].id });
        setAtChapter(view);
      } else {
        setSelectedChapterId(null);
        setAtChapter(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [current?.id]);

  useEffect(() => {
    setTimeline(null);
    setAtChapter(null);
    setSelectedChapterId(null);
    void load();
  }, [current?.id, load]);

  const travel = async (chapterId: string) => {
    if (!current) return;
    setSelectedChapterId(chapterId);
    setTraveling(true);
    setError(null);
    try {
      const view = await api.getStateAtChapter(current.id, { id: chapterId });
      setAtChapter(view);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTraveling(false);
    }
  };

  const chapterIndex = useMemo(() => {
    if (!timeline) return new Map<string, number>();
    return new Map(timeline.chapters.map((c, i) => [c.id, i]));
  }, [timeline]);

  const sortedAssets = useMemo(() => {
    if (!timeline) return [];
    return [...timeline.assets].sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  }, [timeline]);

  const totalSnapshots = useMemo(
    () => (timeline ? timeline.assets.reduce((acc, a) => acc + a.snapshots.length, 0) : 0),
    [timeline]
  );

  return (
    <div className="max-w-6xl">
      <h2 className="text-2xl font-semibold mb-1">时间线</h2>
      <p className="text-sm text-slate-500 mb-6">
        资产状态时间旅行（§9.2/§9.3）：「第 N 章时谁在哪 / 伤势如何」——资产写回版本随章节滚动，可回溯任意章的状态快照
      </p>

      {error && (
        <div className="mb-4 flex items-center justify-between rounded-lg bg-rose-900/40 border border-rose-800 px-4 py-3 text-sm text-rose-200">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-300">✕</button>
        </div>
      )}

      {loading ? (
        <div className="text-slate-500 text-sm">加载中…</div>
      ) : !timeline || (timeline.assets.length === 0 && timeline.assetless.length === 0) ? (
        <div className="rounded-xl border border-dashed border-slate-800 p-10 text-center text-slate-600 text-sm">
          暂无资产。请先创建资产并创作场景（资产写回会生成版本快照）。
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
          {/* 左：章选择器 */}
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">按章时间旅行</h3>
              {timeline.chapters.length === 0 ? (
                <p className="text-xs text-slate-600">暂无资产状态变化</p>
              ) : (
                <div className="space-y-1">
                  {timeline.chapters.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => travel(c.id)}
                      className={`w-full rounded-lg px-3 py-1.5 text-left text-sm transition-colors ${
                        selectedChapterId === c.id
                          ? 'bg-sky-600/20 text-sky-200 ring-1 ring-sky-600/50'
                          : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                      }`}
                    >
                      <span className="text-[10px] text-slate-500 mr-1.5">第 {c.order + 1} 章</span>
                      {c.title ?? '（未命名）'}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-xs text-slate-500">
              <div className="flex items-center justify-between mb-1.5">
                <span>资产</span>
                <span className="text-slate-400">{timeline.assets.length}</span>
              </div>
              <div className="flex items-center justify-between mb-1.5">
                <span>状态快照</span>
                <span className="text-slate-400">{totalSnapshots}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>涉及章节</span>
                <span className="text-slate-400">{timeline.chapters.length}</span>
              </div>
            </div>
          </div>

          {/* 右：时间旅行视图 + 资产快照 */}
          <div className="space-y-6">
            {/* 时间旅行视图 */}
            {atChapter && (
              <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">🕐</span>
                  <h3 className="text-sm font-semibold text-slate-200">
                    第 {atChapter.chapterOrder !== null ? atChapter.chapterOrder + 1 : '?'} 章
                    {atChapter.chapterTitle ? ` · ${atChapter.chapterTitle}` : ''} 时
                  </h3>
                  {traveling && <span className="text-xs text-sky-400 animate-pulse">查询中…</span>}
                </div>
                {atChapter.states.length === 0 ? (
                  <p className="text-xs text-slate-600">该章之前无资产状态快照。</p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {atChapter.states.map((s) => (
                      <div key={s.assetId} className="rounded-lg bg-slate-950/70 border border-slate-800 px-3 py-2">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span>{TYPE_EMOJI[s.type]}</span>
                          <span className="text-sm font-medium text-slate-200">{s.name}</span>
                          <span className="ml-auto text-[10px] text-slate-600">v{s.version}</span>
                        </div>
                        <p className="text-xs text-slate-400">{formatState(s.state)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 资产快照全览 */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <h3 className="text-sm font-semibold text-slate-300 mb-3">资产状态快照全览（按版本）</h3>
              {sortedAssets.length === 0 ? (
                <p className="text-xs text-slate-600">暂无状态快照。创作场景后，资产写回会自动生成版本。</p>
              ) : (
                <div className="space-y-3">
                  {sortedAssets.map((a) => (
                    <div key={a.id} className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        <span>{TYPE_EMOJI[a.type]}</span>
                        <span className="text-sm font-medium">{a.name}</span>
                        <span className="text-[10px] text-slate-500 rounded bg-slate-800 px-1.5 py-0.5">
                          {TYPE_LABEL[a.type]} · v{a.currentVersion}
                        </span>
                      </div>
                      {a.snapshots.length === 0 ? (
                        <p className="text-xs text-slate-600">（无写回快照）</p>
                      ) : (
                        <div className="space-y-1.5">
                          {[...a.snapshots].reverse().map((s) => {
                            const chIdx = s.chapterId ? chapterIndex.get(s.chapterId) : undefined;
                            return (
                              <div key={s.id} className="rounded bg-slate-950/60 border border-slate-800/60 px-2.5 py-1.5 text-xs">
                                <div className="flex items-center gap-2 text-slate-500 mb-0.5">
                                  <span className="text-slate-400 font-medium">v{s.version}</span>
                                  {chIdx !== undefined && (
                                    <span className="rounded bg-sky-900/40 text-sky-300 px-1 py-0.5">第 {chIdx + 1} 章</span>
                                  )}
                                  {s.sceneTitle && <span className="text-slate-600">· {s.sceneTitle}</span>}
                                  <span className="ml-auto text-[10px] text-slate-700">{s.created_at.slice(0, 10)}</span>
                                </div>
                                <p className="text-slate-400">{formatState(s.state)}</p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {timeline.assetless.length > 0 && (
                <details className="mt-3 text-xs text-slate-500">
                  <summary className="cursor-pointer select-none">
                    仅建档、暂无快照（{timeline.assetless.length}）
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {timeline.assetless.map((a) => (
                      <span key={a.id} className="rounded bg-slate-800/70 px-1.5 py-0.5 text-slate-400">
                        {TYPE_EMOJI[a.type]} {a.name} · v{a.currentVersion}
                      </span>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
