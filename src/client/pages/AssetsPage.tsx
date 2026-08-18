import { useCallback, useEffect, useState } from 'react';
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

  const load = useCallback(async () => {
    if (!current) return;
    setLoading(true);
    try {
      setAssets(await api.listAssets(current.id));
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
    void load();
  }, [current?.id, load]);

  const filtered = filter ? assets.filter((a) => a.type === filter) : assets;

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
    if (current) {
      setHistory(await api.assetStates(current.id, asset.id));
    }
  };

  const patchCore = async (key: string, value: string) => {
    if (!current || !selected) return;
    const core = { ...(selected.core ?? {}), [key]: value };
    const updated = await api.updateAsset(current.id, selected.id, { core });
    setSelected(updated);
    await load();
  };

  const remove = async (asset: Asset) => {
    if (!current) return;
    if (!confirm(`删除资产「${asset.name}」？`)) return;
    try {
      await api.deleteAsset(current.id, asset.id);
      if (selected?.id === asset.id) setSelected(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const grouped = (['character', 'location', 'item', 'organization', 'setting'] as AssetType[])
    .map((t) => ({ type: t, items: filtered.filter((a) => a.type === t) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="max-w-5xl">
      <h2 className="text-2xl font-semibold mb-1">资产库</h2>
      <p className="text-sm text-slate-500 mb-6">core 常驻 + extended 按需 + 版本化历史（§9）</p>

      {error && <div className="mb-4 rounded-lg bg-rose-900/40 border border-rose-800 px-4 py-3 text-sm text-rose-200">{error}</div>}

      <div className="flex items-center gap-2 mb-6">
        <div className="flex gap-1.5">
          <button
            onClick={() => setFilter('')}
            className={`rounded-lg px-3 py-1.5 text-sm ${filter === '' ? 'bg-slate-700' : 'bg-slate-900 hover:bg-slate-800'}`}
          >
            全部
          </button>
          {(Object.keys(TYPE_LABEL) as AssetType[]).map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`rounded-lg px-3 py-1.5 text-sm ${filter === t ? 'bg-slate-700' : 'bg-slate-900 hover:bg-slate-800'}`}
            >
              {TYPE_EMOJI[t]} {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        <button
          onClick={() => setCreating(true)}
          className="ml-auto rounded-lg bg-sky-600 hover:bg-sky-500 px-3 py-1.5 text-sm font-medium"
        >
          ＋ 新建资产
        </button>
      </div>

      {creating && (
        <div className="mb-6 flex items-center gap-2 rounded-lg bg-slate-900 border border-slate-800 p-3">
          <select
            className="rounded bg-slate-800 px-2 py-1.5 text-sm outline-none"
            value={newType}
            onChange={(e) => setNewType(e.target.value as AssetType)}
          >
            {(Object.keys(TYPE_LABEL) as AssetType[]).map((t) => (
              <option key={t} value={t}>{TYPE_LABEL[t]}</option>
            ))}
          </select>
          <input
            className="flex-1 rounded bg-slate-800 px-2 py-1.5 text-sm outline-none focus:ring-1 ring-slate-500"
            placeholder="名称"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            autoFocus
          />
          <button onClick={create} className="rounded bg-sky-600 hover:bg-sky-500 px-3 py-1.5 text-sm">创建</button>
          <button onClick={() => setCreating(false)} className="rounded bg-slate-700 hover:bg-slate-600 px-3 py-1.5 text-sm">取消</button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 列表 */}
        <div className="space-y-5">
          {loading ? (
            <div className="text-slate-500 text-sm">加载中…</div>
          ) : grouped.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 p-10 text-center text-slate-600 text-sm">
              暂无资产。可点击「新建资产」，或在大纲页生成「世界观/人物」自动创建。
            </div>
          ) : (
            grouped.map((g) => (
              <section key={g.type}>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  {TYPE_EMOJI[g.type]} {TYPE_LABEL[g.type]} · {g.items.length}
                </h3>
                <div className="space-y-1.5">
                  {g.items.map((a) => (
                    <div
                      key={a.id}
                      onClick={() => openDetail(a)}
                      className={`group flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 ${
                        selected?.id === a.id ? 'border-sky-700 bg-slate-800' : 'border-slate-800 bg-slate-900/70 hover:bg-slate-800'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{a.name}</div>
                        {a.summary && <div className="text-xs text-slate-500 truncate">{a.summary}</div>}
                      </div>
                      <div className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
                        <span className="rounded bg-slate-800 px-1.5 py-0.5">v{a.current_version}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            remove(a);
                          }}
                          className="opacity-0 group-hover:opacity-100 text-rose-400 hover:text-rose-300"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>

        {/* 详情 / 版本历史 */}
        <div className="lg:sticky lg:top-0 self-start">
          {!selected ? (
            <div className="rounded-xl border border-dashed border-slate-800 p-10 text-center text-slate-600 text-sm">
              点击左侧资产查看核心属性与版本历史
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold">{TYPE_EMOJI[selected.type]} {selected.name}</h3>
                <span className="text-xs text-slate-500">v{selected.current_version}</span>
              </div>

              <h4 className="text-xs font-semibold text-slate-500 mb-2">核心属性（常驻 prompt）</h4>
              <div className="space-y-2 mb-4">
                {(CORE_FIELDS[selected.type] ?? []).map((f) => (
                  <label key={f.key} className="block">
                    <span className="text-xs text-slate-500">{f.label}</span>
                    <input
                      className="mt-0.5 w-full rounded bg-slate-800 px-2 py-1.5 text-sm outline-none focus:ring-1 ring-slate-500"
                      defaultValue={String((selected.core as Record<string, unknown>)?.[f.key] ?? '')}
                      onBlur={(e) => patchCore(f.key, e.target.value)}
                    />
                  </label>
                ))}
                {selected.summary && (
                  <p className="text-xs text-slate-500">摘要：{selected.summary}</p>
                )}
              </div>

              <h4 className="text-xs font-semibold text-slate-500 mb-2">版本历史（时间旅行）</h4>
              {history.length === 0 ? (
                <p className="text-xs text-slate-600">暂无写回快照（v1 以 core 为准）。</p>
              ) : (
                <div className="space-y-2">
                  {[...history].reverse().map((s) => (
                    <div key={s.id} className="rounded bg-slate-800/70 px-3 py-2 text-xs">
                      <div className="flex items-center justify-between text-slate-400 mb-1">
                        <span className="font-medium text-slate-300">v{s.version}</span>
                        <span>{s.source_scene_id ? `来自场景 ${s.source_scene_id.slice(0, 8)}` : '手动写回'}</span>
                      </div>
                      <pre className="whitespace-pre-wrap text-slate-400">{JSON.stringify(s.state, null, 2)}</pre>
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
