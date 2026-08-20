import { useCallback, useEffect, useState } from 'react';
import { useNovel } from '../context/NovelContext';
import * as api from '../api/client';
import type { Conflict, PlotDevice, PlotDeviceStatus, PlotDeviceType } from '../types';

const TYPE_LABEL: Record<string, string> = {
  contradiction: '矛盾',
  missing_detail: '遗漏',
  timeline_issue: '时间线',
  loose_thread: '漏线索',
};

const TYPE_EMOJI: Record<string, string> = {
  contradiction: '⚔️',
  missing_detail: '🔍',
  timeline_issue: '🕐',
  loose_thread: '🪝',
};

const STATUS_LABEL: Record<string, string> = {
  open: '待裁决',
  auto_fixed: '自动修复',
  resolved: '已解决',
  ignored: '已忽略',
};

const STATUS_BADGE: Record<string, string> = {
  open: 'badge-amber',
  auto_fixed: 'badge-blue',
  resolved: 'badge-green',
  ignored: 'badge-gray',
};

const DEVICE_TYPE_LABEL: Record<PlotDeviceType, string> = {
  identity: '身份',
  item: '物品',
  event: '事件',
  prophecy: '预言',
  location: '地点',
};

const DEVICE_STATUS_LABEL: Record<PlotDeviceStatus, string> = {
  planted: '已埋设',
  developing: '发展中',
  paid_off: '已回收',
  abandoned: '已放弃',
  forgotten: '⚠ 遗忘',
};

const DEVICE_STATUS_BADGE: Record<PlotDeviceStatus, string> = {
  planted: 'badge-gray',
  developing: 'badge-blue',
  paid_off: 'badge-green',
  abandoned: 'badge-gray',
  forgotten: 'badge-red',
};

export default function ConflictsPage() {
  const { current } = useNovel();
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [devices, setDevices] = useState<PlotDevice[]>([]);
  const [stats, setStats] = useState<api.PlotDeviceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resolutionDraft, setResolutionDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!current) return;
    setLoading(true);
    setError(null);
    try {
      const [c, d, s] = await Promise.all([
        api.listConflicts(current.id),
        api.listPlotDevices(current.id),
        api.plotDeviceStats(current.id).catch(() => null),
      ]);
      setConflicts(c);
      setDevices(d);
      setStats(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [current?.id]);

  useEffect(() => {
    setConflicts([]);
    setDevices([]);
    setStats(null);
    void load();
  }, [current?.id, load]);

  const adjudicate = async (conflict: Conflict, status: 'resolved' | 'ignored') => {
    if (!current) return;
    try {
      const resolution = (resolutionDraft[conflict.id] ?? '').trim();
      const updated = await api.resolveConflict(current.id, conflict.id, status, resolution || undefined);
      setConflicts((cs) => cs.map((c) => (c.id === updated.id ? updated : c)));
      setResolutionDraft((d) => ({ ...d, [conflict.id]: '' }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const advanceDevice = async (device: PlotDevice, status: PlotDeviceStatus) => {
    if (!current) return;
    try {
      const updated = await api.updatePlotDevice(current.id, device.id, status);
      setDevices((ds) => ds.map((d) => (d.id === updated.id ? updated : d)));
      setStats((s) => {
        if (!s) return s;
        const next = { ...s };
        const from = device.status as keyof typeof next;
        const to = status as keyof typeof next;
        if (typeof next[to] === 'number') next[to] = (next[to] as number) + 1;
        if (typeof next[from] === 'number') next[from] = (next[from] as number) - 1;
        return next;
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const runCheck = async () => {
    if (!current) return;
    setChecking(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.runConsistencyCheck(current.id);
      const parts: string[] = [];
      if (result.forgotten.length > 0) parts.push(`标记 ${result.forgotten.length} 条伏笔遗忘`);
      if (result.createdConflicts.length > 0) parts.push(`新增 ${result.createdConflicts.length} 条漏线索冲突`);
      if (parts.length === 0) parts.push('未发现新问题');
      setNotice(`校验完成：${parts.join('；')}`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const openConflicts = conflicts.filter((c) => c.status === 'open');
  const openDevices = devices.filter((d) => d.status === 'planted' || d.status === 'developing' || d.status === 'forgotten');

  return (
    <div className="page max-w-6xl">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="page-title">冲突台</h2>
          <p className="page-desc">一致性校验结果：矛盾 / 时间线 / 漏线索，人工裁决 + 伏笔台账烂尾提醒</p>
        </div>
        <button onClick={runCheck} disabled={checking} className="btn-secondary btn-sm shrink-0">
          {checking ? '校验中…' : '⟳ 重新校验'}
        </button>
      </div>

      {notice && <div className="alert-success mt-4">{notice}</div>}
      {error && <div className="alert-error mt-4">{error}</div>}

      {stats && (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: '待裁决冲突', value: openConflicts.length, tone: 'text-[var(--warning)]' },
            { label: '待处理伏笔', value: stats.due, tone: 'text-[var(--info)]' },
            { label: '已回收伏笔', value: stats.paid_off, tone: 'text-[var(--success)]' },
            { label: '烂尾风险', value: devices.filter((d) => d.status === 'forgotten').length, tone: 'text-[var(--danger)]' },
          ].map((s) => (
            <div key={s.label} className="card card-pad text-center">
              <div className={`text-2xl font-bold ${s.tone}`}>{s.value}</div>
              <div className="mt-0.5 text-xs text-[var(--text-3)]">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* 冲突列表 */}
        <section className="card card-pad">
          <h3 className="mb-3 text-sm font-semibold">一致性冲突（{conflicts.length}）</h3>
          {loading ? (
            <p className="flex items-center gap-1.5 text-xs text-[var(--text-3)]">
              <span className="spinner" /> 加载中…
            </p>
          ) : conflicts.length === 0 ? (
            <div className="empty">暂无冲突记录</div>
          ) : (
            <div className="space-y-3">
              {conflicts.map((c) => (
                <div
                  key={c.id}
                  className={`rounded-lg border p-3 ${
                    c.status === 'open' ? 'border-amber-200 bg-[var(--warning-bg)]' : 'list-item'
                  }`}
                >
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="text-sm">{TYPE_EMOJI[c.type] ?? '❓'}</span>
                    <span className="badge-gray">{TYPE_LABEL[c.type] ?? c.type}</span>
                    <span className={STATUS_BADGE[c.status] ?? 'badge-gray'}>{STATUS_LABEL[c.status]}</span>
                    <span className="ml-auto text-[10px] text-[var(--text-3)]">{c.created_at.slice(0, 10)}</span>
                  </div>
                  <p className="break-words text-sm">{c.description}</p>
                  {c.evidence ? (
                    <pre className="code-block mt-2 text-[11px]">
                      {typeof c.evidence === 'string' ? c.evidence : JSON.stringify(c.evidence, null, 2)}
                    </pre>
                  ) : null}
                  {c.resolution && <p className="mt-2 text-xs text-[var(--success)]">裁决：{c.resolution}</p>}
                  {c.status === 'open' && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <input
                        className="input text-xs min-w-0 flex-1"
                        placeholder="裁决说明（可选）"
                        value={resolutionDraft[c.id] ?? ''}
                        onChange={(e) => setResolutionDraft((d) => ({ ...d, [c.id]: e.target.value }))}
                      />
                      <button onClick={() => adjudicate(c, 'resolved')} className="btn-primary btn-sm shrink-0">
                        解决
                      </button>
                      <button onClick={() => adjudicate(c, 'ignored')} className="btn-secondary btn-sm shrink-0">
                        忽略
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 伏笔台账 */}
        <section className="card card-pad">
          <h3 className="mb-3 text-sm font-semibold">伏笔台账 · 烂尾提醒（{openDevices.length}）</h3>
          {loading ? (
            <p className="flex items-center gap-1.5 text-xs text-[var(--text-3)]">
              <span className="spinner" /> 加载中…
            </p>
          ) : devices.length === 0 ? (
            <div className="empty">暂无伏笔记录</div>
          ) : (
            <div className="space-y-3">
              {openDevices.map((d) => (
                <div
                  key={d.id}
                  className={`rounded-lg border p-3 ${
                    d.status === 'forgotten' ? 'border-red-200 bg-[var(--danger-bg)]' : 'list-item'
                  }`}
                >
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className={DEVICE_STATUS_BADGE[d.status]}>{DEVICE_STATUS_LABEL[d.status]}</span>
                    <span className="text-xs text-[var(--text-3)]">{DEVICE_TYPE_LABEL[d.type] ?? d.type}</span>
                    {d.expected_payoff && (
                      <span className="text-[10px] text-[var(--text-3)]">预计回收：{d.expected_payoff}</span>
                    )}
                  </div>
                  <p className="text-sm">{d.description}</p>
                  {d.related_entities.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {d.related_entities.map((e) => (
                        <span key={e} className="badge-gray">{e}</span>
                      ))}
                    </div>
                  )}
                  <div className="mt-2.5 flex items-center gap-1.5">
                    {d.status === 'planted' && (
                      <button onClick={() => advanceDevice(d, 'developing')} className="btn-secondary btn-sm">→ 发展</button>
                    )}
                    {(d.status === 'planted' || d.status === 'developing' || d.status === 'forgotten') && (
                      <button onClick={() => advanceDevice(d, 'paid_off')} className="btn-primary btn-sm">✓ 回收</button>
                    )}
                    {(d.status === 'planted' || d.status === 'developing' || d.status === 'forgotten') && (
                      <button onClick={() => advanceDevice(d, 'abandoned')} className="btn-secondary btn-sm">放弃</button>
                    )}
                    {(d.status === 'forgotten' || d.status === 'paid_off' || d.status === 'abandoned') && (
                      <button onClick={() => advanceDevice(d, 'developing')} className="btn-secondary btn-sm">恢复</button>
                    )}
                  </div>
                </div>
              ))}
              {devices.filter((d) => d.status === 'paid_off' || d.status === 'abandoned').length > 0 && (
                <details className="text-xs text-[var(--text-3)]">
                  <summary className="cursor-pointer select-none">
                    已回收 / 已放弃（{devices.filter((d) => d.status === 'paid_off' || d.status === 'abandoned').length}）
                  </summary>
                  <div className="mt-2 space-y-1.5">
                    {devices.filter((d) => d.status === 'paid_off' || d.status === 'abandoned').map((d) => (
                      <div key={d.id} className="flex items-center gap-2 rounded-lg bg-[var(--surface-2)] px-2 py-1">
                        <span className={DEVICE_STATUS_BADGE[d.status]}>{DEVICE_STATUS_LABEL[d.status]}</span>
                        <span className="truncate text-[var(--text-3)]">{d.description}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
