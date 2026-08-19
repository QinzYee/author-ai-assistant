import { useCallback, useEffect, useState } from 'react';
import * as api from '../api/client';

interface FieldDef {
  key: string;
  label: string;
  placeholder: string;
  secret?: boolean;
  hint?: string;
}

const DEEPSEEK_FIELDS: FieldDef[] = [
  { key: 'DEEPSEEK_API_KEY', label: 'API Key', placeholder: 'sk-…', secret: true },
  { key: 'DEEPSEEK_BASE_URL', label: 'Base URL', placeholder: 'https://api.deepseek.com' },
  { key: 'DEEPSEEK_MODEL', label: '生成模型', placeholder: 'deepseek-chat' },
  { key: 'EXTRACT_MODEL', label: '提取/校验模型', placeholder: 'deepseek-chat', hint: '元数据/资产/事实/摘要/校验等 pass 用' },
];

const SILICONFLOW_FIELDS: FieldDef[] = [
  { key: 'SILICONFLOW_API_KEY', label: 'API Key', placeholder: 'sk-…', secret: true },
  { key: 'SILICONFLOW_BASE_URL', label: 'Base URL', placeholder: 'https://api.siliconflow.cn/v1' },
  { key: 'EMBED_MODEL', label: 'Embedding 模型', placeholder: 'BAAI/bge-m3', hint: '正文分块向量化（RAG 检索用）' },
];

const MISC_FIELDS: FieldDef[] = [
  { key: 'OLLAMA_BASE_URL', label: 'Ollama 地址（可选）', placeholder: 'http://localhost:11434' },
  { key: 'GATEWAY_MODE', label: '网关模式', placeholder: '留空 = 真实 API；填 mock = 演示数据' },
];

const TIER_LABEL: Record<string, string> = {
  generate: '正文生成',
  extract: '提取/校验',
  embed: 'Embedding',
};

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<Record<string, 'db' | 'env'>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [results, setResults] = useState<api.TestResult[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await api.getSettings();
      setValues(s.values);
      setSources(s.sources);
      setDraft({});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await api.saveSettings(draft);
      setValues(updated.values);
      setSources(updated.sources);
      setDraft({});
      setNotice('已保存并热生效（无需重启）。');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setError(null);
    setResults(null);
    try {
      // 若草稿中有未保存的修改，先保存再测
      if (Object.keys(draft).length > 0) {
        await api.saveSettings(draft);
        const s = await api.getSettings();
        setValues(s.values);
        setSources(s.sources);
        setDraft({});
      }
      const r = await api.testSettingsConnection();
      setResults(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const renderField = (f: FieldDef) => {
    const effective = values[f.key] ?? '';
    const src = sources[f.key];
    const draftVal = draft[f.key];
    const showValue = draftVal !== undefined ? draftVal : effective;
    return (
      <label key={f.key} className="block">
        <span className="flex items-center gap-2 text-xs text-slate-500">
          {f.label}
          {src === 'db' ? (
            <span className="rounded bg-sky-900/50 text-sky-300 px-1 py-0.5 text-[10px]">已在前端设置</span>
          ) : effective ? (
            <span className="rounded bg-slate-800 text-slate-500 px-1 py-0.5 text-[10px]">来自 .env</span>
          ) : (
            <span className="rounded bg-rose-900/40 text-rose-300 px-1 py-0.5 text-[10px]">未配置</span>
          )}
        </span>
        <input
          className="mt-1 w-full rounded bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-sm outline-none focus:ring-1 ring-sky-500"
          placeholder={f.placeholder}
          value={showValue}
          type={f.secret && draftVal === undefined && effective ? 'password' : 'text'}
          onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
        />
        {f.hint && <span className="text-[11px] text-slate-600">{f.hint}</span>}
        {f.secret && effective && draftVal === undefined && (
          <span className="text-[11px] text-slate-600">已脱敏显示；如需更换直接输入新密钥，清空则回退 .env</span>
        )}
      </label>
    );
  };

  return (
    <div className="max-w-3xl">
      <h2 className="text-2xl font-semibold mb-1">设置</h2>
      <p className="text-sm text-slate-500 mb-6">
        LLM 模型配置：在前端填写后保存即热生效（覆盖 .env），并可测试连接有效性
      </p>

      {error && (
        <div className="mb-4 flex items-center justify-between rounded-lg bg-rose-900/40 border border-rose-800 px-4 py-3 text-sm text-rose-200">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-300">✕</button>
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-lg bg-emerald-900/30 border border-emerald-800 px-4 py-3 text-sm text-emerald-200">{notice}</div>
      )}

      {loading ? (
        <div className="text-slate-500 text-sm">加载中…</div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">🔮 正文生成 / 提取（DeepSeek，OpenAI 兼容）</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {DEEPSEEK_FIELDS.map(renderField)}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">🧬 Embedding（硅基流动 BGE-M3）</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {SILICONFLOW_FIELDS.map(renderField)}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">🖥️ 本地 / 其他</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {MISC_FIELDS.map(renderField)}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving || Object.keys(draft).length === 0}
              className="rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 px-5 py-2 text-sm font-medium"
            >
              {saving ? '保存中…' : '保存设置'}
            </button>
            <button
              onClick={test}
              disabled={testing}
              className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 px-5 py-2 text-sm font-medium"
            >
              {testing ? '测试中…' : '测试连接'}
            </button>
            {Object.keys(draft).length > 0 && (
              <span className="text-xs text-amber-300">有未保存的修改</span>
            )}
          </div>

          {results && (
            <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
              <h3 className="text-sm font-semibold text-slate-300 mb-3">连接测试结果</h3>
              <div className="grid gap-2">
                {results.map((r) => (
                  <div key={r.tier} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                    <span className={`text-lg ${r.ok ? '' : ''}`}>{r.ok ? '✅' : '❌'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-slate-200">
                        {TIER_LABEL[r.tier] ?? r.tier} · {r.model}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {r.provider} ｜ {r.baseUrl} ｜ {r.latencyMs}ms
                      </div>
                    </div>
                    {r.error && <div className="text-[11px] text-rose-400 max-w-[45%] truncate" title={r.error}>{r.error}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[11px] text-slate-600">
            提示：设置持久化在本地 data/ 数据库；密钥返回时已脱敏。留空的字段自动回退 .env 配置。切换「网关模式=mock」可无需 API Key 跑通全流程演示。
          </p>
        </div>
      )}
    </div>
  );
}
