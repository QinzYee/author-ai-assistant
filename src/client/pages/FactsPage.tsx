import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNovel } from '../context/NovelContext';
import * as api from '../api/client';
import type { FactCard } from '../types';

const STATUS_LABEL: Record<FactCard['status'], string> = {
  active: '有效',
  superseded: '已作废',
  retracted: '已撤回',
};

const STATUS_BADGE: Record<FactCard['status'], string> = {
  active: 'badge-green',
  superseded: 'badge-amber',
  retracted: 'badge-red',
};

export default function FactsPage() {
  const { current } = useNovel();
  const [facts, setFacts] = useState<FactCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    if (!current) return;
    setLoading(true);
    setError(null);
    try {
      const list = showAll ? await api.listAllFacts(current.id) : await api.listFacts(current.id);
      setFacts(list);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [current?.id, showAll]);

  useEffect(() => {
    setFacts([]);
    void load();
  }, [current?.id, showAll, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return facts;
    return facts.filter(
      (f) =>
        f.fact.toLowerCase().includes(q) ||
        f.entities.some((e) => e.toLowerCase().includes(q))
    );
  }, [facts, query]);

  const activeCount = facts.filter((f) => f.status === 'active').length;

  const setStatus = async (fact: FactCard, status: FactCard['status']) => {
    if (!current) return;
    try {
      const updated = await api.updateFactStatus(current.id, fact.id, status);
      setFacts((fs) => fs.map((f) => (f.id === updated.id ? updated : f)));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="page max-w-5xl">
      <h2 className="page-title">事实卡片</h2>
      <p className="page-desc">L3 长期知识库：原子事实，永不删除，可作废/撤回</p>

      {error && <div className="alert-error mt-4">{error}</div>}

      <div className="mt-5 flex items-center gap-3">
        <input
          className="input flex-1"
          placeholder="搜索事实 / 实体…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          onClick={() => setShowAll((v) => !v)}
          className={`btn-secondary btn-sm shrink-0 ${showAll ? '!bg-[var(--brand-50)] !text-[var(--brand-600)]' : ''}`}
        >
          {showAll ? '含归档' : '仅有效'}
        </button>
        <span className="whitespace-nowrap text-xs text-[var(--text-3)]">有效 {activeCount} / 共 {facts.length}</span>
      </div>

      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-[var(--text-3)]">
          <span className="spinner text-[var(--brand-500)]" /> 加载中…
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty mt-6">暂无事实卡片。创作场景后会自动提取事实入库。</div>
      ) : (
        <div className="mt-5 grid gap-2">
          {filtered.map((f) => (
            <div key={f.id} className="list-item flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <span className={STATUS_BADGE[f.status]}>{STATUS_LABEL[f.status]}</span>
                  <span className="text-[10px] text-[var(--text-3)]">置信度 {Math.round((f.confidence ?? 0.8) * 100)}%</span>
                  {f.source_scene_id && <span className="text-[10px] text-[var(--text-3)]">来自场景 {f.source_scene_id.slice(0, 8)}</span>}
                </div>
                <p className="break-words text-sm">{f.fact}</p>
                {f.entities.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {f.entities.map((e) => (
                      <button
                        key={e}
                        onClick={() => setQuery(e)}
                        className="badge-brand cursor-pointer hover:opacity-80"
                      >
                        #{e}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                {f.status === 'active' && (
                  <button onClick={() => setStatus(f, 'superseded')} className="btn-secondary btn-sm">
                    作废
                  </button>
                )}
                {(f.status === 'superseded' || f.status === 'retracted') && (
                  <button onClick={() => setStatus(f, 'active')} className="btn-secondary btn-sm">
                    恢复
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
