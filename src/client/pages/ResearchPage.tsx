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
    <div className="page max-w-3xl">
      <h2 className="page-title">题材调研</h2>
      <p className="page-desc">平台榜单采集（Tavily）+ LLM 分析报告 → 人机确认题材方向</p>

      <div className="mt-5 flex gap-2">
        <input
          className="input"
          placeholder="调研问题，如：2025 都市克苏鲁 网文 热门题材"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && trigger()}
        />
        <button onClick={trigger} disabled={loading} className="btn-primary shrink-0">
          {loading ? '分析中…' : '开始调研'}
        </button>
      </div>

      {error && <div className="alert-error mt-4">{error}</div>}
      {note && (
        <div className="alert-warn mt-4">
          <span className="mr-1">⚠️</span>{note}
        </div>
      )}

      {!rep && !loading && !error && (
        <div className="empty mt-6">尚未调研。填写问题后点击「开始调研」，或将问题留空使用小说默认题材。</div>
      )}

      {rep && (
        <div className="mt-6 space-y-6">
          <section className="card card-pad">
            <h3 className="section-label">🔥 热度榜单</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {rep.heat_ranking.map((h, i) => (
                <div
                  key={i}
                  className="animate-fade-in-up card-hover rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
                  style={{ animationDelay: i * 40 + 'ms' }}
                >
                  <div className="text-sm font-medium">{h.genre}</div>
                  <div className="mt-0.5 text-xs text-[var(--text-3)]">{h.trend}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="card card-pad">
            <h3 className="section-label">🎯 差异化建议（蓝海组合）</h3>
            <ul className="space-y-1.5">
              {rep.blue_ocean_ideas.map((b, i) => (
                <li
                  key={i}
                  className="animate-fade-in-up rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                  style={{ animationDelay: i * 50 + 'ms' }}
                >
                  {b}
                </li>
              ))}
            </ul>
          </section>

          <section className="card card-pad">
            <h3 className="section-label">📖 黄金三章要素</h3>
            <ol className="space-y-1.5 list-decimal list-inside">
              {rep.golden_three_chapters.map((g, i) => (
                <li key={i} className="animate-fade-in-up text-sm text-[var(--text-2)]" style={{ animationDelay: i * 60 + 'ms' }}>{g}</li>
              ))}
            </ol>
          </section>

          <section className="card card-pad border-l-2 border-l-[var(--brand-500)]">
            <h3 className="text-sm font-semibold text-[var(--brand-600)]">💡 最终建议</h3>
            <p className="mt-1 text-sm">{rep.recommendation || '（无）'}</p>
          </section>
        </div>
      )}
    </div>
  );
}
