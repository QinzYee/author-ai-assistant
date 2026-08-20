import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNovel } from '../context/NovelContext';
import * as api from '../api/client';
import type { OutlineNode, OutlineLayer, OutlineNodeInput, SceneOutline, Asset } from '../types';

const LAYERS: Array<{ key: OutlineLayer; label: string; hint: string; needsParent: boolean; defaultCount: number }> = [
  { key: 'idea', label: '① 核心创意', hint: '高概念一句话 + 目标读者 + 卖点', needsParent: false, defaultCount: 1 },
  { key: 'synopsis', label: '② 主线梗概', hint: '三幕结构 + 主题', needsParent: false, defaultCount: 1 },
  { key: 'worldview', label: '③ 世界观设定', hint: '核心规则 → settings 资产', needsParent: false, defaultCount: 4 },
  { key: 'character', label: '④ 人物小传', hint: '主角/配角/反派 → character 资产', needsParent: false, defaultCount: 4 },
  { key: 'volume', label: '⑤ 卷大纲', hint: '选择卷数生成', needsParent: false, defaultCount: 3 },
  { key: 'chapter', label: '⑥ 章大纲', hint: '选择卷后生成', needsParent: true, defaultCount: 5 },
  { key: 'scene', label: '⑦ 场景大纲', hint: '选择章后生成（创作单元）', needsParent: true, defaultCount: 5 },
];

const LEVEL_COLOR: Record<string, string> = {
  idea: 'bg-fuchsia-50 text-fuchsia-600 border-fuchsia-200',
  synopsis: 'bg-purple-50 text-purple-600 border-purple-200',
  volume: 'bg-sky-50 text-sky-600 border-sky-200',
  chapter: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  scene: 'bg-gray-100 text-gray-600 border-gray-200',
};

export default function OutlinePage() {
  const { current } = useNovel();
  const [nodes, setNodes] = useState<OutlineNode[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [parentId, setParentId] = useState<string>('');
  const [count, setCount] = useState('');
  // 行内编辑
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [editContent, setEditContent] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  // 意见 → 按意见重新生成
  const [opinion, setOpinion] = useState('');
  const [regenerating, setRegenerating] = useState(false);

  const load = useCallback(async () => {
    if (!current) return;
    setLoading(true);
    try {
      const [outline, assetList] = await Promise.all([api.listOutline(current.id), api.listAssets(current.id)]);
      setNodes(outline);
      setAssets(assetList);
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

  /** 各层已生成数量（世界观/人物按资产计数，其余按大纲节点计数） */
  const layerCounts = useMemo<Record<string, number>>(
    () => ({
      idea: nodes.filter((n) => n.level === 'idea').length,
      synopsis: nodes.filter((n) => n.level === 'synopsis').length,
      worldview: assets.filter((a) => a.type === 'setting').length,
      character: assets.filter((a) => a.type === 'character').length,
      volume: nodes.filter((n) => n.level === 'volume').length,
      chapter: nodes.filter((n) => n.level === 'chapter').length,
      scene: nodes.filter((n) => n.level === 'scene').length,
    }),
    [nodes, assets]
  );

  const generate = async (layer: OutlineLayer) => {
    if (!current) return;
    const def = LAYERS.find((l) => l.key === layer);
    const parsed = parseInt(count, 10);
    const target = !count.trim() || Number.isNaN(parsed) || parsed <= 0 ? (def?.defaultCount ?? 3) : parsed;
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.generateOutlineLayer(current.id, {
        layer,
        parent_id: parentId || null,
        count: target,
      });
      const label = LAYERS.find((l) => l.key === layer)?.label ?? layer;
      if (result.kind === 'assets') {
        // 世界观/人物生成的是「资产」，不是大纲节点——给明确反馈，否则看起来像没反应
        const names = result.names.length > 0 ? '：' + result.names.join('、') : '';
        const batch = result.batchLabel ? `（${result.batchLabel}）` : '';
        const skipped = (result.skipped ?? 0) > 0 ? `，跳过已存在 ${result.skipped} 项` : '';
        setNotice(
          result.count > 0
            ? '✅ ' + label + '已生成 ' + result.count + ' 项' + batch + names + skipped + '（已写入资产库，到「资产库」页面查看）'
            : '⚠️ ' + label + '本次未生成有效内容（可能已全部存在或 LLM 返回异常），请检查后重试'
        );
      } else if (result.kind === 'nodes') {
        const existing = layerCounts[layer] - result.nodes.length;
        if (result.nodes.length === 0) {
          setNotice(
            existing > 0
              ? '✅ ' + label + '已达目标 ' + target + ' 项（现有 ' + existing + ' 项），无需补充'
              : '⚠️ ' + label + '本次未生成任何节点，请稍后重试'
          );
        } else {
          setNotice('✅ ' + label + '已生成 ' + result.nodes.length + ' 项（目标 ' + target + '，已有 ' + existing + '，本次补充 ' + result.nodes.length + '）');
        }
      }
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

  const startEdit = (node: OutlineNode) => {
    setEditingId(node.id);
    setEditTitle(node.title ?? '');
    setEditSummary(node.summary ?? '');
    setEditContent(node.content ? JSON.stringify(node.content, null, 2) : '');
    setOpinion('');
    setError(null);
  };

  const regenerateNode = async (node: OutlineNode) => {
    if (!current || !opinion.trim()) return;
    setRegenerating(true);
    setError(null);
    try {
      const updated = await api.regenerateOutlineNode(current.id, node.id, opinion.trim());
      await load();
      // 重新打开编辑面板，展示按意见重写后的内容
      setEditingId(updated.id);
      setEditTitle(updated.title ?? '');
      setEditSummary(updated.summary ?? '');
      setEditContent(updated.content ? JSON.stringify(updated.content, null, 2) : '');
      setOpinion('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRegenerating(false);
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditTitle('');
    setEditSummary('');
    setEditContent('');
  };

  const saveEdit = async (node: OutlineNode) => {
    if (!current) return;
    setSavingEdit(true);
    setError(null);
    try {
      const patch: Partial<OutlineNodeInput> = {
        title: editTitle.trim() || null,
        summary: editSummary.trim() || null,
      };
      if (editContent.trim()) {
        try {
          patch.content = JSON.parse(editContent) as SceneOutline;
        } catch {
          setError('场景内容不是合法 JSON，请检查格式（可用 {} 或 []）。');
          setSavingEdit(false);
          return;
        }
      } else {
        patch.content = null;
      }
      await api.updateOutlineNode(current.id, node.id, patch);
      cancelEdit();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingEdit(false);
    }
  };

  const renderNode = (node: OutlineNode, depth: number) => (
    <div
      key={node.id}
      className="group rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 transition-colors hover:border-[var(--border-strong)]"
      style={{ marginLeft: depth * 16 }}
    >
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${LEVEL_COLOR[node.level] ?? ''}`}>
          {node.level}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{node.title || '（未命名）'}</div>
          {node.summary && <div className="mt-0.5 line-clamp-2 text-xs text-[var(--text-3)]">{node.summary}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {node.status === 'confirmed' ? (
            <button onClick={() => toggleConfirm(node)} title="取消确认" className="badge-green">✓ 已确认</button>
          ) : (
            <button onClick={() => toggleConfirm(node)} title="标记确认（人机协同）" className="badge-gray">确认</button>
          )}
          <button onClick={() => startEdit(node)} title="编辑标题/摘要/内容" className="badge-gray">编辑</button>
          {node.level !== 'scene' && (
            <button
              onClick={() => addChild(node, node.level === 'volume' ? 'chapter' : node.level === 'chapter' ? 'scene' : 'volume')}
              title="添加子节点"
              className="badge-gray"
            >
              ＋
            </button>
          )}
          <button onClick={() => remove(node)} title="删除（含子节点）" className="badge-red">✕</button>
        </div>
      </div>
      {editingId === node.id && (
        <div className="animate-slide-down mt-3 space-y-2 rounded-lg border border-[var(--brand-200)] bg-[var(--brand-50)]/40 p-3">
          <div>
            <label className="text-[11px] text-[var(--text-3)]">标题</label>
            <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="input mt-0.5" />
          </div>
          <div>
            <label className="text-[11px] text-[var(--text-3)]">摘要</label>
            <textarea value={editSummary} onChange={(e) => setEditSummary(e.target.value)} rows={2} className="textarea mt-0.5" />
          </div>
          <div>
            <label className="text-[11px] text-[var(--text-3)]">
              内容{node.level === 'scene' ? '（场景 JSON，可编辑）' : '（JSON）'}
            </label>
            <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={5} className="textarea mt-0.5 font-mono text-xs" />
          </div>
          <div className="rounded-lg border border-dashed border-[var(--brand-200)] bg-[var(--brand-50)]/30 p-2.5">
            <label className="flex items-center gap-1 text-[11px] font-medium text-[var(--brand-600)]">
              💬 意见 · 按意见重新生成此项
            </label>
            <textarea
              value={opinion}
              onChange={(e) => setOpinion(e.target.value)}
              rows={2}
              placeholder="输入你的修改意见，如：主角再强势一点、节奏更快、结局留个钩子…"
              className="textarea mt-1 text-xs"
            />
            <div className="mt-1.5 flex items-center gap-2">
              <button
                onClick={() => regenerateNode(node)}
                disabled={regenerating || !opinion.trim()}
                className="btn-primary btn-sm"
              >
                {regenerating ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="spinner" /> 重新生成中…
                  </span>
                ) : (
                  '↻ 按意见重新生成'
                )}
              </button>
              <span className="text-[10px] text-[var(--text-3)]">依据当前节点与你的意见重写此项内容</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => saveEdit(node)} disabled={savingEdit} className="btn-primary btn-sm">
              {savingEdit ? '保存中…' : '保存'}
            </button>
            <button onClick={cancelEdit} className="btn-ghost btn-sm">取消</button>
          </div>
        </div>
      )}
      {node.level === 'chapter' &&
        nodes.filter((n) => n.parent_id === node.id && n.level === 'scene').map((c) => renderNode(c, depth + 1))}
    </div>
  );

  return (
    <div className="page max-w-4xl">
      <h2 className="page-title">大纲编辑器</h2>
      <p className="page-desc">自顶向下分层生成，每层可人工确认后再进入下一层</p>

      {error && <div className="alert-error mt-4 animate-fade-in">{error}</div>}
      {notice && <div className="alert-success mt-4 animate-fade-in">{notice}</div>}

      {/* 生成工具栏 */}
      <div className="card card-pad mt-5">
        <div className="flex flex-wrap gap-2">
          {LAYERS.map((l) => {
            const existing = layerCounts[l.key] ?? 0;
            const needsMore = l.defaultCount > 1 && existing > 0 && existing < l.defaultCount;
            return (
              <button
                key={l.key}
                disabled={generating || (l.needsParent && !parentId)}
                title={l.hint + (l.needsParent && !parentId ? '（需先选择父节点）' : '')}
                onClick={() => generate(l.key)}
                className="btn-secondary btn-sm"
              >
                {l.label}
                <span className={`ml-1.5 rounded px-1 py-px text-[10px] ${needsMore ? 'bg-[var(--brand-50)] text-[var(--brand-600)]' : 'bg-[var(--bg-2)] text-[var(--text-3)]'}`}>
                  {existing}/{l.defaultCount}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--text-3)]">
          <span>每批数量：</span>
          <input
            type="number"
            min={0}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            placeholder="默认"
            className="w-20 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm text-[var(--text)] outline-none"
          />
          <span>子层父节点：</span>
          <select
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm text-[var(--text)] outline-none"
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
          <span className="text-[var(--text-3)]">
            卷/章/场景按「目标 − 已有」增量补充；世界观/人物按同名去重追加。
          </span>
          {generating && (
            <span className="inline-flex items-center gap-1.5 text-[var(--brand-600)]">
              <span className="spinner" /> 生成中…
            </span>
          )}
        </div>
      </div>

      {/* 树 */}
      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-[var(--text-3)]">
          <span className="spinner text-[var(--brand-500)]" /> 加载中…
        </div>
      ) : nodes.length === 0 ? (
        <div className="empty mt-6">
          暂无大纲。从上方「① 核心创意」开始逐层生成，或手动添加节点。
          <div className="mt-3">
            <button onClick={() => addChild(null, 'volume')} className="btn-secondary btn-sm">＋ 手动添加卷</button>
          </div>
        </div>
      ) : (
        <div className="mt-5 space-y-2">
          {nodes.filter((n) => !n.parent_id || n.level === 'idea' || n.level === 'synopsis').map((n) => renderNode(n, 0))}
        </div>
      )}
    </div>
  );
}
