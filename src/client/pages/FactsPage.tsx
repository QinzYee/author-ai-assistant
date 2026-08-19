import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNovel } from '../context/NovelContext';
import * as api from '../api/client';
import type { FactCard } from '../types';

const STATUS_LABEL: Record<FactCard['status'], string> = {
  active: '有效',
  superseded: '已作废',
  retracted: '已撤回',
};

const STATUS_COLOR: Record<FactCard['status'], string> = {
  active: 'bg-emerald-900/40 text-emerald-300',
  superseded: 'bg-amber-900/40 text-amber-300',
  retracted: 'bg-rose-900/40 text-rose-300',
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
    <div className="max-w-5xl">
      <h2 className="text-2xl font-semibold mb-1">事实卡片</h2>
      <p className="text-sm text-slate-500 mb-6">L3 长期知识库：原子事实，永不删除，可作废/撤回（§8）</p>

      {error && (
        <div className="mb-4 flex items-center justify-between rounded-lg bg-rose-900/40 border border-rose-800 px-4 py-3 text-sm text-rose-200">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-300">✕</button>
        </div>
      )}

      <div className="mb-6 flex items-center gap-3">
        <input
          className="flex-1 rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-sm outline-none focus:ring-1 ring-sky-500"
          placeholder="搜索事实 / 实体…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          onClick={() => setShowAll((v) => !v)}
          className={`rounded-lg px-3 py-2 text-sm ${showAll ? 'bg-slate-700' : 'bg-slate-900 hover:bg-slate-800 border border-slate-800'}`}
        >
          {showAll ? '含归档' : '仅有效'}
        </button>
        <span className="text-xs text-slate-500 whitespace-nowrap">有效 {activeCount} / 共 {facts.length}</span>
      </div>

      {loading ? (
        <div className="text-slate-500 text-sm">加载中…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 p-10 text-center text-slate-600 text-sm">
          暂无事实卡片。创作场景后会自动提取事实入库。
        </div>
      ) : (
        <div className="grid gap-2">
          {filtered.map((f) => (
            <div key={f.id} className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] rounded px-1.5 py-0.5 ${STATUS_COLOR[f.status]}`}>{STATUS_LABEL[f.status]}</span>
                  <span className="text-[10px] text-slate-600">置信度 {Math.round((f.confidence ?? 0.8) * 100)}%</span>
                  {f.source_scene_id && <span className="text-[10px] text-slate-600">来自场景 {f.source_scene_id.slice(0, 8)}</span>}
                </div>
                <p className="text-sm text-slate-200">{f.fact}</p>
                {f.entities.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {f.entities.map((e) => (
                      <button
                        key={e}
                        onClick={() => setQuery(e)}
                        className="text-[10px] rounded bg-slate-800 px-1.5 py-0.5 text-sky-300 hover:bg-slate-700"
                      >
                        #{e}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                {f.status === 'active' && (
                  <button
                    onClick={() => setStatus(f, 'superseded')}
                    className="rounded bg-amber-600/20 text-amber-300 hover:bg-amber-600/30 px-2 py-1 text-[11px]"
                  >
                    作废
                  </button>
                )}
                {(f.status === 'superseded' || f.status === 'retracted') && (
                  <button
                    onClick={() => setStatus(f, 'active')}
                    className="rounded bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30 px-2 py-1 text-[11px]"
                  >
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
