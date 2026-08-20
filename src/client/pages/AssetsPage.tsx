import { useCallback, useEffect, useRef, useState } from 'react';
import { useNovel } from '../context/NovelContext';
import * as api from '../api/client';
import type { Asset, AssetState, AssetType } from '../types';

const TYPE_LABEL: Record<AssetType, string> = {
  character: '人物',
  location: '地点',
  item: '物品',
  organization: '组织',
  setting: '设定',
};

const TYPE_EMOJI: Record<AssetType, string> = {
  character: '👤',
  location: '📍',
  item: '📦',
  organization: '🏛️',
  setting: '📜',
};

const CORE_FIELDS: Record<AssetType, Array<{ key: string; label: string }>> = {
  character: [
    { key: 'identity', label: '身份' },
    { key: 'personality', label: '性格' },
    { key: 'goal', label: '目标' },
    { key: 'role', label: '角色定位' },
  ],
  location: [
    { key: 'kind', label: '类型' },
    { key: 'feature', label: '关键特征' },
  ],
  item: [
    { key: 'owner', label: '归属' },
    { key: 'state', label: '当前状态' },
  ],
  organization: [
    { key: 'purpose', label: '宗旨' },
    { key: 'power', label: '实力层级' },
  ],
  setting: [{ key: 'rule', label: '一句话规则' }],
};

export default function AssetsPage() {
  const { current } = useNovel();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [filter, setFilter] = useState<AssetType | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<AssetType>('character');
  const [selected, setSelected] = useState<Asset | null>(null);
  const [history, setHistory] = useState<AssetState[]>([]);
  // 多选 / 批量删除
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState(false);
  // 详情面板核心属性草稿（受控，切资产时重置）
  const [coreDraft, setCoreDraft] = useState<Record<string, string>>({});
  const detailIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!current) return;
    setLoading(true);
    try {
      const list = await api.listAssets(current.id);
      setAssets(list);
      setSelectedIds((prev) => {
        if (prev.size === 0) return prev;
        const existing = new Set(list.map((a) => a.id));
        const next = new Set([...prev].filter((id) => existing.has(id)));
        return next.size === prev.size ? prev : next;
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [current?.id]);

  useEffect(() => {
    setAssets([]);
    setSelected(null);
    setHistory([]);
    setSelectedIds(new Set());
    setCoreDraft({});
    detailIdRef.current = null;
    void load();
  }, [current?.id, load]);

  const filtered = filter ? assets.filter((a) => a.type === filter) : assets;
  const allSelected = filtered.length > 0 && filtered.every((a) => selectedIds.has(a.id));

  const create = async () => {
    if (!current || !newName.trim()) return;
    try {
      await api.createAsset(current.id, { type: newType, name: newName.trim(), core: {} });
      setNewName('');
      setCreating(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const openDetail = async (asset: Asset) => {
    setSelected(asset);
    // 重置核心属性草稿（受控输入框跟随当前资产）
    const fields = (CORE_FIELDS[asset.type] ?? []).map((f) => f.key);
    const draft: Record<string, string> = {};
    for (const k of fields) draft[k] = String((asset.core as Record<string, unknown>)?.[k] ?? '');
    setCoreDraft(draft);
    // 异步加载版本历史：快速切换时只保留最后一次请求的结果
    if (current) {
      detailIdRef.current = asset.id;
      const id = asset.id;
      const h = await api.assetStates(current.id, asset.id);
      if (detailIdRef.current === id) setHistory(h);
    }
  };

  const patchCore = async (key: string, value: string) => {
    if (!current || !selected) return;
    const core = { ...(selected.core ?? {}), [key]: value };
    const updated = await api.updateAsset(current.id, selected.id, { core });
    setSelected(updated);
    setCoreDraft((d) => ({ ...d, [key]: value }));
    await load();
  };

  const remove = async (asset: Asset) => {
    if (!current) return;
    if (!confirm(`删除资产「${asset.name}」？`)) return;
    try {
      await api.deleteAsset(current.id, asset.id);
      if (selected?.id === asset.id) setSelected(null);
      setSelectedIds((prev) => {
        if (!prev.has(asset.id)) return prev;
        const next = new Set(prev);
        next.delete(asset.id);
        return next;
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) filtered.forEach((a) => next.delete(a.id));
      else filtered.forEach((a) => next.add(a.id));
      return next;
    });
  };

  const removeSelected = async () => {
    if (!current || selectedIds.size === 0) return;
    const names = assets.filter((a) => selectedIds.has(a.id)).map((a) => a.name);
    if (!confirm(`删除选中的 ${selectedIds.size} 项资产？\n${names.join('、')}`)) return;
    setRemoving(true);
    setError(null);
    try {
      await Promise.all([...selectedIds].map((id) => api.deleteAsset(current.id, id)));
      if (selected && selectedIds.has(selected.id)) setSelected(null);
      setSelectedIds(new Set());
      await load();
    } catch (e) {
      setError((e as Error).message);
      await load();
    } finally {
      setRemoving(false);
    }
  };

  const grouped = (['character', 'location', 'item', 'organization', 'setting'] as AssetType[])
    .map((t) => ({ type: t, items: filtered.filter((a) => a.type === t) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="page max-w-5xl">
      <h2 className="page-title">资产库</h2>
      <p className="page-desc">core 常驻 + extended 按需 + 版本化历史</p>

      {error && <div className="alert-error mt-4">{error}</div>}

      <div className="mt-5 flex items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setFilter('')}
            className={`btn-secondary btn-sm ${filter === '' ? '!bg-[var(--brand-50)] !text-[var(--brand-600)] !border-[var(--brand-200)]' : ''}`}
          >
            全部
          </button>
          {(Object.keys(TYPE_LABEL) as AssetType[]).map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`btn-secondary btn-sm ${filter === t ? '!bg-[var(--brand-50)] !text-[var(--brand-600)] !border-[var(--brand-200)]' : ''}`}
            >
              {TYPE_EMOJI[t]} {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        <button onClick={() => setCreating(true)} className="btn-primary btn-sm ml-auto">＋ 新建资产</button>
      </div>

      {assets.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-[var(--text-2)]">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="h-3.5 w-3.5 accent-[var(--brand-500)]"
            />
            全选（当前列表）
          </label>
          <span className={`text-xs ${selectedIds.size > 0 ? 'font-medium text-[var(--brand-600)]' : 'text-[var(--text-3)]'}`}>
            已选 {selectedIds.size} 项
          </span>
          {selectedIds.size > 0 && (
            <button onClick={removeSelected} disabled={removing} className="btn-danger btn-sm ml-auto">
              {removing ? '删除中…' : `🗑 删除选中 (${selectedIds.size})`}
            </button>
          )}
        </div>
      )}

      {creating && (
        <div className="card card-pad mt-4 flex items-center gap-2">
          <select
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm outline-none"
            value={newType}
            onChange={(e) => setNewType(e.target.value as AssetType)}
          >
            {(Object.keys(TYPE_LABEL) as AssetType[]).map((t) => (
              <option key={t} value={t}>{TYPE_LABEL[t]}</option>
            ))}
          </select>
          <input
            className="input flex-1"
            placeholder="名称"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            autoFocus
          />
          <button onClick={create} className="btn-primary btn-sm">创建</button>
          <button onClick={() => setCreating(false)} className="btn-secondary btn-sm">取消</button>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* 列表 */}
        <div className="space-y-5">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-[var(--text-3)]">
              <span className="spinner text-[var(--brand-500)]" /> 加载中…
            </div>
          ) : grouped.length === 0 ? (
            <div className="empty">暂无资产。可点击「新建资产」，或在大纲页生成「世界观/人物」自动创建。</div>
          ) : (
            grouped.map((g) => (
              <section key={g.type}>
                <h3 className="section-label">{TYPE_EMOJI[g.type]} {TYPE_LABEL[g.type]} · {g.items.length}</h3>
                <div className="space-y-1.5">
                  {g.items.map((a) => {
                    const isChecked = selectedIds.has(a.id);
                    return (
                    <div
                      key={a.id}
                      onClick={() => openDetail(a)}
                      className={`group flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 transition-colors ${
                        isChecked
                          ? 'border-[var(--brand-500)] bg-[var(--brand-50)] shadow-[0_0_0_1px_var(--brand-200)]'
                          : selected?.id === a.id
                          ? 'list-item-active'
                          : 'list-item card-hover'
                      }`}
                    >
                      <label
                        className="mr-2 flex shrink-0 cursor-pointer items-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelect(a.id)}
                          className="h-3.5 w-3.5 accent-[var(--brand-500)]"
                        />
                      </label>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{a.name}</div>
                        {a.summary && <div className="truncate text-xs text-[var(--text-3)]">{a.summary}</div>}
                      </div>
                      <div className="flex shrink-0 items-center gap-2 text-xs text-[var(--text-3)]">
                        {a.batch_label && <span className="badge-gray">{a.batch_label}</span>}
                        <span className="badge-gray">v{a.current_version}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            remove(a);
                          }}
                          className="opacity-0 text-[var(--danger)] transition-opacity group-hover:opacity-100 hover:opacity-100"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>

        {/* 详情 / 版本历史 */}
        <div className="self-start lg:sticky lg:top-0">
          {!selected ? (
            <div className="empty">点击左侧资产查看核心属性与版本历史</div>
          ) : (
            <div key={selected.id} className="card card-pad">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-semibold">{TYPE_EMOJI[selected.type]} {selected.name}</h3>
                <span className="flex items-center gap-2">
                  {selected.batch_label && <span className="badge-gray">{selected.batch_label}</span>}
                  <span className="badge-gray">v{selected.current_version}</span>
                </span>
              </div>

              <h4 className="section-label">核心属性（常驻 prompt）</h4>
              <div className="mb-4 space-y-2">
                {(CORE_FIELDS[selected.type] ?? []).map((f) => (
                  <label key={f.key} className="block">
                    <span className="text-xs text-[var(--text-3)]">{f.label}</span>
                    <input
                      className="input mt-0.5"
                      value={coreDraft[f.key] ?? ''}
                      onChange={(e) => setCoreDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                      onBlur={(e) => patchCore(f.key, e.target.value)}
                    />
                  </label>
                ))}
                {selected.summary && <p className="text-xs text-[var(--text-3)]">摘要：{selected.summary}</p>}
              </div>

              <h4 className="section-label">版本历史（时间旅行）</h4>
              {history.length === 0 ? (
                <p className="text-xs text-[var(--text-3)]">暂无写回快照（v1 以 core 为准）。</p>
              ) : (
                <div className="space-y-2">
                  {[...history].reverse().map((s) => (
                    <div key={s.id} className="code-block text-xs">
                      <div className="mb-1 flex items-center justify-between text-[var(--text-3)]">
                        <span className="font-medium text-[var(--text-2)]">v{s.version}</span>
                        <span>{s.source_scene_id ? `来自场景 ${s.source_scene_id.slice(0, 8)}` : '手动写回'}</span>
                      </div>
                      <pre className="whitespace-pre-wrap">{JSON.stringify(s.state, null, 2)}</pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
