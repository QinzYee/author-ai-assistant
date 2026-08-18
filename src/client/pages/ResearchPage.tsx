import { useCallback, useEffect, useState } from 'react';
import { useNovel } from '../context/NovelContext';
import * as api from '../api/client';
import type { ResearchReport, TrendResearch } from '../types';

export default function ResearchPage() {
  const { current } = useNovel();
  const [query, setQuery] = useState('');
  const [report, setReport] = useState<TrendResearch | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!current) return;
    try {
      const r = await api.getResearch(current.id);
      setReport(r);
    } catch {
      /* 暂无调研 */
    }
  }, [current?.id]);

  useEffect(() => {
    setReport(null);
    void load();
  }, [current?.id, load]);

  const trigger = async () => {
    if (!current) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.runResearch(current.id, query);
      setReport(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const rep = (report?.results as { report?: ResearchReport } | null)?.report;
  const note = (report?.results as { note?: string } | null)?.note;

  return (
    <div className="max-w-3xl">
      <h2 className="text-2xl font-semibold mb-1">题材调研</h2>
      <p className="text-sm text-slate-500 mb-6">平台榜单采集（Tavily）+ LLM 分析报告 → 人机确认题材方向（§4.1）</p>

      <div className="flex gap-2 mb-6">
        <input
          className="flex-1 rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-sm outline-none focus:ring-1 ring-sky-500"
          placeholder="调研问题，如：2025 都市克苏鲁 网文 热门题材"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && trigger()}
        />
        <button
          onClick={trigger}
          disabled={loading}
          className="rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 px-4 py-2 text-sm font-medium"
        >
          {loading ? '分析中…' : '开始调研'}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-rose-900/40 border border-rose-800 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}
      {note && (
        <div className="mb-4 rounded-lg bg-amber-900/30 border border-amber-800 px-4 py-2 text-xs text-amber-200">
          {note}
        </div>
      )}

      {!rep && !loading && !error && (
        <div className="rounded-xl border border-dashed border-slate-800 p-10 text-center text-slate-600 text-sm">
          尚未调研。填写问题后点击「开始调研」，或将问题留空使用小说默认题材。
        </div>
      )}

      {rep && (
        <div className="space-y-5">
          <section>
            <h3 className="text-sm font-semibold text-slate-300 mb-2">🔥 热度榜单</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {rep.heat_ranking.map((h, i) => (
                <div key={i} className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-2">
                  <div className="text-sm font-medium">{h.genre}</div>
                  <div className="text-xs text-slate-500">{h.trend}</div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-slate-300 mb-2">🎯 差异化建议（蓝海组合）</h3>
            <ul className="space-y-1.5">
              {rep.blue_ocean_ideas.map((b, i) => (
                <li key={i} className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-sm">
                  {b}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-slate-300 mb-2">📖 黄金三章要素</h3>
            <ol className="space-y-1.5 list-decimal list-inside">
              {rep.golden_three_chapters.map((g, i) => (
                <li key={i} className="text-sm text-slate-300">{g}</li>
              ))}
            </ol>
          </section>

          <section className="rounded-lg bg-slate-900 border border-slate-800 p-4">
            <h3 className="text-sm font-semibold text-sky-300 mb-1">💡 最终建议</h3>
            <p className="text-sm">{rep.recommendation || '（无）'}</p>
          </section>
        </div>
      )}
    </div>
  );
}
