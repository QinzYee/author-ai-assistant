import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNovel } from '../context/NovelContext';
import * as api from '../api/client';
import type { OutlineNode, OutlineLayer, OutlineNodeInput } from '../types';

const LAYERS: Array<{ key: OutlineLayer; label: string; hint: string; needsParent: boolean }> = [
  { key: 'idea', label: '① 核心创意', hint: '高概念一句话 + 目标读者 + 卖点', needsParent: false },
  { key: 'synopsis', label: '② 主线梗概', hint: '三幕结构 + 主题', needsParent: false },
  { key: 'worldview', label: '③ 世界观设定', hint: '核心规则 → settings 资产', needsParent: false },
  { key: 'character', label: '④ 人物小传', hint: '主角/配角/反派 → character 资产', needsParent: false },
  { key: 'volume', label: '⑤ 卷大纲', hint: '选择卷数生成', needsParent: false },
  { key: 'chapter', label: '⑥ 章大纲', hint: '选择卷后生成', needsParent: true },
  { key: 'scene', label: '⑦ 场景大纲', hint: '选择章后生成（创作单元）', needsParent: true },
];

const LEVEL_COLOR: Record<string, string> = {
  idea: 'text-fuchsia-300 border-fuchsia-800',
  synopsis: 'text-purple-300 border-purple-800',
  volume: 'text-sky-300 border-sky-800',
  chapter: 'text-emerald-300 border-emerald-800',
  scene: 'text-slate-300 border-slate-700',
};

export default function OutlinePage() {
  const { current } = useNovel();
  const [nodes, setNodes] = useState<OutlineNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parentId, setParentId] = useState<string>('');

  const load = useCallback(async () => {
    if (!current) return;
    setLoading(true);
    try {
      setNodes(await api.listOutline(current.id));
    } finally {
      setLoading(false);
    }
  }, [current?.id]);

  useEffect(() => {
    setNodes([]);
    void load();
  }, [current?.id, load]);

  const volumes = useMemo(() => nodes.filter((n) => n.level === 'volume'), [nodes]);
  const chapters = useMemo(() => nodes.filter((n) => n.level === 'chapter'), [nodes]);

  const generate = async (layer: OutlineLayer) => {
    if (!current) return;
    setGenerating(true);
    setError(null);
    try {
      await api.generateOutlineLayer(current.id, { layer, parent_id: parentId || null });
      await load();
    } catch (e) {
      setError((e as Error).message.replace(/^API [0-9]+: /, ''));
    } finally {
      setGenerating(false);
    }
  };

  const addChild = async (parent: OutlineNode | null, level: OutlineNode['level']) => {
    if (!current) return;
    const input: OutlineNodeInput = { level, title: '新节点' };
    if (parent) input.parent_id = parent.id;
    try {
      await api.createOutlineNode(current.id, input);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toggleConfirm = async (node: OutlineNode) => {
    if (!current) return;
    await api.updateOutlineNode(current.id, node.id, {
      status: node.status === 'confirmed' ? 'planned' : 'confirmed',
    });
    await load();
  };

  const remove = async (node: OutlineNode) => {
    if (!current) return;
    if (!confirm(`删除「${node.title}」及其全部子节点？`)) return;
    try {
      await api.deleteOutlineNode(current.id, node.id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const renderNode = (node: OutlineNode, depth: number) => (
    <div
      key={node.id}
      className="group rounded-lg border bg-slate-900/70 px-3 py-2"
      style={{ marginLeft: depth * 16 }}
    >
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 shrink-0 text-[10px] px-1.5 py-0.5 rounded border ${LEVEL_COLOR[node.level] ?? ''}`}>
          {node.level}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{node.title || '（未命名）'}</div>
          {node.summary && <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">{node.summary}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {node.status === 'confirmed' ? (
            <button onClick={() => toggleConfirm(node)} title="取消确认" className="text-xs text-emerald-400 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700">
              ✓ 已确认
            </button>
          ) : (
            <button onClick={() => toggleConfirm(node)} title="标记确认（人机协同）" className="text-xs text-slate-500 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700">
              确认
            </button>
          )}
          {node.level !== 'scene' && (
            <button
              onClick={() => addChild(node, node.level === 'volume' ? 'chapter' : node.level === 'chapter' ? 'scene' : 'volume')}
              title="添加子节点"
              className="text-xs text-slate-400 px-1.5 rounded bg-slate-800 hover:bg-slate-700"
            >
              ＋
            </button>
          )}
          <button onClick={() => remove(node)} title="删除（含子节点）" className="text-xs text-rose-400 px-1.5 rounded bg-slate-800 hover:bg-rose-900/60">
            ✕
          </button>
        </div>
      </div>
      {node.level === 'chapter' &&
        nodes.filter((n) => n.parent_id === node.id && n.level === 'scene').map((c) => renderNode(c, depth + 1))}
    </div>
  );

  return (
    <div className="max-w-4xl">
      <h2 className="text-2xl font-semibold mb-1">大纲编辑器</h2>
      <p className="text-sm text-slate-500 mb-6">自顶向下分层生成，每层可人工确认后再进入下一层（§4.2）</p>

      {error && (
        <div className="mb-4 rounded-lg bg-rose-900/40 border border-rose-800 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      {/* 生成工具栏 */}
      <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="flex flex-wrap gap-2">
          {LAYERS.map((l) => (
            <button
              key={l.key}
              disabled={generating || (l.needsParent && !parentId)}
              title={l.hint + (l.needsParent && !parentId ? '（需先选择父节点）' : '')}
              onClick={() => generate(l.key)}
              className="rounded-lg bg-slate-800 hover:bg-sky-700 disabled:opacity-40 disabled:hover:bg-slate-800 px-3 py-1.5 text-sm"
            >
              {l.label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
          <span>子层父节点：</span>
          <select
            className="rounded bg-slate-800 px-2 py-1 text-sm text-slate-300 outline-none"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            <option value="">（无 — 卷/章直接生成）</option>
            <optgroup label="卷">
              {volumes.map((v) => (
                <option key={v.id} value={v.id}>{v.title}</option>
              ))}
            </optgroup>
            <optgroup label="章">
              {chapters.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </optgroup>
          </select>
          {generating && <span className="text-sky-400 animate-pulse">生成中…</span>}
        </div>
      </div>

      {/* 树 */}
      {loading ? (
        <div className="text-slate-500 text-sm">加载中…</div>
      ) : nodes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 p-10 text-center text-slate-600 text-sm">
          暂无大纲。从上方「① 核心创意」开始逐层生成，或手动添加节点。
          <div className="mt-3">
            <button onClick={() => addChild(null, 'volume')} className="text-sm rounded bg-slate-800 hover:bg-slate-700 px-3 py-1.5">
              ＋ 手动添加卷
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {nodes.filter((n) => !n.parent_id || n.level === 'idea' || n.level === 'synopsis').map((n) => renderNode(n, 0))}
        </div>
      )}
    </div>
  );
}
