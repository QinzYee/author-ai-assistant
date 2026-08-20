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
    <div className="page max-w-6xl">
      <h2 className="page-title">时间线</h2>
      <p className="page-desc">资产状态时间旅行：「第 N 章时谁在哪 / 伤势如何」——可回溯任意章的状态快照</p>

      {error && <div className="alert-error mt-4">{error}</div>}

      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-[var(--text-3)]">
          <span className="spinner text-[var(--brand-500)]" /> 加载中…
        </div>
      ) : !timeline || (timeline.assets.length === 0 && timeline.assetless.length === 0) ? (
        <div className="empty mt-6">暂无资产。请先创建资产并创作场景（资产写回会生成版本快照）。</div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[260px_1fr]">
          {/* 左：章选择器 */}
          <div className="space-y-4">
            <div className="card card-pad">
              <h3 className="section-label">按章时间旅行</h3>
              {timeline.chapters.length === 0 ? (
                <p className="text-xs text-[var(--text-3)]">暂无资产状态变化</p>
              ) : (
                <div className="space-y-1">
                  {timeline.chapters.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => travel(c.id)}
                      className={`w-full rounded-lg px-3 py-1.5 text-left text-sm transition-colors ${
                        selectedChapterId === c.id
                          ? 'bg-[var(--brand-50)] font-medium text-[var(--brand-700)] ring-1 ring-[var(--brand-200)]'
                          : 'text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
                      }`}
                    >
                      <span className="mr-1.5 text-[10px] text-[var(--text-3)]">第 {c.order + 1} 章</span>
                      {c.title ?? '（未命名）'}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="card card-pad text-xs text-[var(--text-3)]">
              <div className="mb-1.5 flex items-center justify-between">
                <span>资产</span>
                <span className="text-[var(--text-2)]">{timeline.assets.length}</span>
              </div>
              <div className="mb-1.5 flex items-center justify-between">
                <span>状态快照</span>
                <span className="text-[var(--text-2)]">{totalSnapshots}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>涉及章节</span>
                <span className="text-[var(--text-2)]">{timeline.chapters.length}</span>
              </div>
            </div>
          </div>

          {/* 右：时间旅行视图 + 资产快照 */}
          <div className="space-y-6">
            {atChapter && (
              <div className="card card-pad">
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-lg">🕐</span>
                  <h3 className="text-sm font-semibold">
                    第 {atChapter.chapterOrder !== null ? atChapter.chapterOrder + 1 : '?'} 章
                    {atChapter.chapterTitle ? ` · ${atChapter.chapterTitle}` : ''} 时
                  </h3>
                  {traveling && <span className="text-xs text-[var(--brand-600)] animate-pulse">查询中…</span>}
                </div>
                {atChapter.states.length === 0 ? (
                  <p className="text-xs text-[var(--text-3)]">该章之前无资产状态快照。</p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {atChapter.states.map((s) => (
                      <div key={s.assetId} className="list-item">
                        <div className="mb-1 flex items-center gap-1.5">
                          <span>{TYPE_EMOJI[s.type]}</span>
                          <span className="text-sm font-medium">{s.name}</span>
                          <span className="badge-gray ml-auto">v{s.version}</span>
                        </div>
                        <p className="text-xs text-[var(--text-2)]">{formatState(s.state)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 资产快照全览 */}
            <div className="card card-pad">
              <h3 className="mb-3 text-sm font-semibold">资产状态快照全览（按版本）</h3>
              {sortedAssets.length === 0 ? (
                <p className="text-xs text-[var(--text-3)]">暂无状态快照。创作场景后，资产写回会自动生成版本。</p>
              ) : (
                <div className="space-y-3">
                  {sortedAssets.map((a) => (
                    <div key={a.id} className="list-item">
                      <div className="mb-2 flex items-center gap-1.5">
                        <span>{TYPE_EMOJI[a.type]}</span>
                        <span className="text-sm font-medium">{a.name}</span>
                        <span className="badge-gray">
                          {TYPE_LABEL[a.type]} · v{a.currentVersion}
                        </span>
                      </div>
                      {a.snapshots.length === 0 ? (
                        <p className="text-xs text-[var(--text-3)]">（无写回快照）</p>
                      ) : (
                        <div className="space-y-1.5">
                          {[...a.snapshots].reverse().map((s) => {
                            const chIdx = s.chapterId ? chapterIndex.get(s.chapterId) : undefined;
                            return (
                              <div key={s.id} className="code-block text-xs">
                                <div className="mb-0.5 flex items-center gap-2 text-[var(--text-3)]">
                                  <span className="font-medium text-[var(--text-2)]">v{s.version}</span>
                                  {chIdx !== undefined && (
                                    <span className="badge-brand">第 {chIdx + 1} 章</span>
                                  )}
                                  {s.sceneTitle && <span>· {s.sceneTitle}</span>}
                                  <span className="ml-auto text-[10px] text-[var(--text-3)]">{s.created_at.slice(0, 10)}</span>
                                </div>
                                <p className="text-[var(--text-2)]">{formatState(s.state)}</p>
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
                <details className="mt-3 text-xs text-[var(--text-3)]">
                  <summary className="cursor-pointer select-none">
                    仅建档、暂无快照（{timeline.assetless.length}）
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {timeline.assetless.map((a) => (
                      <span key={a.id} className="badge-gray">
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
