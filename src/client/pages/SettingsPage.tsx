import { useCallback, useEffect, useState } from 'react';
import * as api from '../api/client';

// ============ 供应商元数据 ============
interface FieldDef {
  key: string; // DB 存储 key（如 DEEPSEEK_API_KEY）
  label: string;
  placeholder: string;
  secret?: boolean;
}

interface ProviderDef {
  value: string;
  label: string;
  icon: string;
  desc: string;
  fields: FieldDef[];
}

const CHAT_PROVIDERS: ProviderDef[] = [
  {
    value: 'deepseek', label: 'DeepSeek', icon: '🔷', desc: '正文生成/提取（默认）',
    fields: [
      { key: 'DEEPSEEK_API_KEY', label: 'API Key', placeholder: 'sk-…', secret: true },
      { key: 'DEEPSEEK_BASE_URL', label: 'Base URL', placeholder: 'https://api.deepseek.com' },
      { key: 'DEEPSEEK_MODEL', label: '生成模型', placeholder: 'deepseek-chat' },
    ],
  },
  {
    value: 'minimax', label: 'MiniMax', icon: '🟣', desc: '长上下文文本模型',
    fields: [
      { key: 'MINIMAX_API_KEY', label: 'API Key', placeholder: '订阅 key', secret: true },
      { key: 'MINIMAX_BASE_URL', label: 'Base URL', placeholder: 'https://api.minimaxi.com/v1' },
      { key: 'MINIMAX_MODEL', label: '模型', placeholder: 'MiniMax-Text-01' },
    ],
  },
  {
    value: 'openai', label: 'OpenAI', icon: '🟢', desc: 'OpenAI 直连',
    fields: [
      { key: 'OPENAI_API_KEY', label: 'API Key', placeholder: 'sk-…', secret: true },
      { key: 'OPENAI_BASE_URL', label: 'Base URL', placeholder: 'https://api.openai.com/v1' },
      { key: 'OPENAI_MODEL', label: '模型', placeholder: 'gpt-4o-mini' },
    ],
  },
  {
    value: 'ollama', label: 'Ollama', icon: '🐳', desc: '本地免费（需装 Ollama）',
    fields: [
      { key: 'OLLAMA_BASE_URL', label: '地址', placeholder: 'http://localhost:11434' },
      { key: 'OLLAMA_CHAT_MODEL', label: '模型', placeholder: 'qwen2.5' },
    ],
  },
  {
    value: 'mock', label: 'Mock', icon: '🧪', desc: '演示数据，无需 key', fields: [],
  },
];

const EMBED_PROVIDERS: ProviderDef[] = [
  {
    value: 'siliconflow', label: '硅基流动', icon: '🧬', desc: 'BGE-M3 云端（需 key）',
    fields: [
      { key: 'SILICONFLOW_API_KEY', label: 'API Key', placeholder: 'sk-…', secret: true },
      { key: 'SILICONFLOW_BASE_URL', label: 'Base URL', placeholder: 'https://api.siliconflow.cn/v1' },
      { key: 'EMBED_MODEL', label: '模型', placeholder: 'BAAI/bge-m3' },
    ],
  },
  {
    value: 'ollama', label: 'Ollama', icon: '🐳', desc: 'BGE-M3 本地（免费）',
    fields: [
      { key: 'OLLAMA_BASE_URL', label: '地址', placeholder: 'http://localhost:11434' },
      { key: 'EMBED_MODEL', label: '模型', placeholder: 'bge-m3' },
    ],
  },
  {
    value: 'mock', label: 'Mock', icon: '🧪', desc: '演示，无向量检索', fields: [],
  },
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
  const [chatProvider, setChatProvider] = useState('deepseek');
  const [embedProvider, setEmbedProvider] = useState('siliconflow');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [results, setResults] = useState<api.TestResult[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  // 提示词编辑
  const [prompts, setPrompts] = useState<api.PromptEntry[]>([]);
  const [promptDraft, setPromptDraft] = useState<Record<string, string>>({});
  const [savingPrompts, setSavingPrompts] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await api.getSettings();
      setValues(s.values);
      setSources(s.sources);
      setDraft({});
      setChatProvider(s.values['CHAT_PROVIDER'] || 'deepseek');
      setEmbedProvider(s.values['EMBED_PROVIDER'] || 'siliconflow');
      const p = await api.getPrompts();
      setPrompts(p);
      setPromptDraft({});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const effective = (key: string) =>
    draft[key] !== undefined ? draft[key] : values[key] ?? '';

  const setDraftField = (key: string, v: string) => setDraft((d) => ({ ...d, [key]: v }));

  const isConfigured = (p: ProviderDef): boolean => {
    const needsKey = p.fields.some((f) => f.secret);
    if (needsKey) return p.fields.some((f) => f.secret && effective(f.key) !== '');
    return p.fields.some((f) => effective(f.key) !== '');
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await api.saveSettings(draft);
      setValues(updated.values);
      setSources(updated.sources);
      setChatProvider(updated.values['CHAT_PROVIDER'] || 'deepseek');
      setEmbedProvider(updated.values['EMBED_PROVIDER'] || 'siliconflow');
      setDraft({});
      setNotice(`已保存 ${Object.keys(draft).length} 项设置并热生效（无需重启）。`);
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
      // 直接把当前屏幕上的配置（含未保存草稿与所选供应商）交给后端测试，测试的就是所见配置
      const r = await api.testSettingsConnection(draft);
      setResults(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const switchChat = (v: string) => {
    setChatProvider(v);
    setDraft((d) => ({ ...d, CHAT_PROVIDER: v }));
  };
  const switchEmbed = (v: string) => {
    setEmbedProvider(v);
    setDraft((d) => ({ ...d, EMBED_PROVIDER: v }));
  };

  const savePrompts = async () => {
    setSavingPrompts(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await api.savePrompts(promptDraft);
      setPrompts(updated);
      setPromptDraft({});
      setNotice(`已保存 ${Object.keys(promptDraft).length} 条提示词并热生效（无需重启）。`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingPrompts(false);
    }
  };

  const renderProviderCard = (p: ProviderDef, kind: 'chat' | 'embed', active: boolean, onActivate: (v: string) => void) => {
    const configured = isConfigured(p);
    const isOpen = expanded === `${kind}:${p.value}`;
    return (
      <div
        key={p.value}
        className={`rounded-xl border p-4 transition-colors ${
          active ? 'border-[var(--brand-500)] bg-[var(--brand-50)]/50 ring-1 ring-[var(--brand-200)]' : 'border-[var(--border)] bg-[var(--surface)]'
        }`}
      >
        <div className="mb-1 flex items-center gap-2">
          <span className="text-xl">{p.icon}</span>
          <span className="text-sm font-semibold">{p.label}</span>
          {active && <span className="badge-brand">当前生效</span>}
          <span className={configured ? 'badge-green' : 'badge-gray'}>
            {configured ? '已配置' : '未配置'}
          </span>
        </div>
        <p className="mb-3 text-[11px] text-[var(--text-3)]">{p.desc}</p>

        {isOpen && p.fields.length > 0 && (
          <div className="mb-3 space-y-2">
            {p.fields.map((f) => (
              <label key={f.key} className="block">
                <span className="flex items-center gap-2 text-xs text-[var(--text-3)]">
                  {f.label}
                  {sources[f.key] === 'db' ? (
                    <span className="badge-brand">已设置</span>
                  ) : values[f.key] ? (
                    <span className="badge-gray">来自 .env</span>
                  ) : null}
                </span>
                <input
                  className="input mt-1"
                  placeholder={f.placeholder}
                  type={f.secret && draft[f.key] === undefined && values[f.key] ? 'password' : 'text'}
                  value={effective(f.key)}
                  onChange={(e) => setDraftField(f.key, e.target.value)}
                />
              </label>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1.5">
          {!active && (
            <button onClick={() => onActivate(p.value)} className="btn-primary btn-sm">
              设为当前
            </button>
          )}
          {p.fields.length > 0 && (
            <button onClick={() => setExpanded(isOpen ? null : `${kind}:${p.value}`)} className="btn-secondary btn-sm">
              {isOpen ? '收起' : '配置'}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="page max-w-5xl">
      <h2 className="page-title">模型配置</h2>
      <p className="page-desc">配置各家 key/模型，一键切换当前生效供应商，保存即热生效</p>

      {error && (
        <div className="alert-error mt-4 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2 shrink-0">✕</button>
        </div>
      )}
      {notice && <div className="alert-success mt-4">{notice}</div>}

      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-[var(--text-3)]">
          <span className="spinner text-[var(--brand-500)]" /> 加载中…
        </div>
      ) : (
        <div className="mt-5 space-y-6">
          {/* 当前供应商概览 */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="card card-pad">
              <div className="mb-1 text-xs text-[var(--text-3)]">✍️ 正文生成 / 提取 · 当前</div>
              <div className="text-lg font-semibold">
                {CHAT_PROVIDERS.find((p) => p.value === chatProvider)?.icon} {CHAT_PROVIDERS.find((p) => p.value === chatProvider)?.label ?? chatProvider}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {CHAT_PROVIDERS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => switchChat(p.value)}
                    className={`btn-sm rounded-lg border px-2 py-0.5 text-[11px] ${
                      p.value === chatProvider
                        ? 'border-[var(--brand-200)] bg-[var(--brand-50)] text-[var(--brand-600)]'
                        : 'border-[var(--border)] text-[var(--text-3)] hover:bg-[var(--surface-2)]'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="card card-pad">
              <div className="mb-1 text-xs text-[var(--text-3)]">🧬 Embedding · 当前</div>
              <div className="text-lg font-semibold">
                {EMBED_PROVIDERS.find((p) => p.value === embedProvider)?.icon} {EMBED_PROVIDERS.find((p) => p.value === embedProvider)?.label ?? embedProvider}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {EMBED_PROVIDERS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => switchEmbed(p.value)}
                    className={`btn-sm rounded-lg border px-2 py-0.5 text-[11px] ${
                      p.value === embedProvider
                        ? 'border-[var(--brand-200)] bg-[var(--brand-50)] text-[var(--brand-600)]'
                        : 'border-[var(--border)] text-[var(--text-3)] hover:bg-[var(--surface-2)]'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 正文供应商卡片 */}
          <div>
            <h3 className="section-label">正文 / 提取供应商</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {CHAT_PROVIDERS.map((p) =>
                renderProviderCard(p, 'chat', p.value === chatProvider, switchChat)
              )}
            </div>
          </div>

          {/* Embedding 供应商卡片 */}
          <div>
            <h3 className="section-label">Embedding 供应商</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {EMBED_PROVIDERS.map((p) =>
                renderProviderCard(p, 'embed', p.value === embedProvider, switchEmbed)
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={save} disabled={saving || Object.keys(draft).length === 0} className="btn-primary">
              {saving ? '保存中…' : '保存设置'}
            </button>
            <button onClick={test} disabled={testing} className="btn-secondary">
              {testing ? '测试中…' : '测试全部连接'}
            </button>
            {Object.keys(draft).length > 0 && (
              <span className="text-xs text-[var(--warning)]">有未保存的修改</span>
            )}
          </div>

          {results && (
            <div className="card card-pad">
              <h3 className="mb-3 text-sm font-semibold">连接测试结果</h3>
              <div className="grid gap-2">
                {results.map((r) => (
                  <div key={r.tier} className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)]/50 px-3 py-2">
                    <span>{r.ok ? '✅' : '❌'}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">{TIER_LABEL[r.tier] ?? r.tier} · {r.model}</div>
                      <div className="truncate text-[11px] text-[var(--text-3)]">
                        {r.provider} ｜ {r.baseUrl} ｜ {r.latencyMs}ms
                      </div>
                    </div>
                    {r.error && <div className="max-w-[45%] truncate text-[11px] text-[var(--danger)]" title={r.error}>{r.error}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[11px] text-[var(--text-3)]">
            提示：设置持久化在本地 data/ 数据库，密钥返回时已脱敏。留空字段回退 .env。切换供应商后立即生效。
          </p>

          {/* ===== 提示词编辑（可覆盖，热生效） ===== */}
          <div className="card card-pad">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-sm font-semibold">🤖 提示词（可编辑，保存即热生效）</h3>
              {Object.keys(promptDraft).length > 0 && (
                <span className="text-xs text-[var(--warning)]">有未保存的修改</span>
              )}
            </div>
            <p className="mb-4 text-xs text-[var(--text-3)]">
              所有 LLM 提示词集中管理，前端可直接改写风格/规则；清空某项即恢复默认。改完点下方「保存提示词」。
            </p>

            {prompts.length === 0 ? (
              <p className="text-xs text-[var(--text-3)]">加载中…</p>
            ) : (
              <div className="space-y-5">
                {[...new Set(prompts.map((p) => p.group))].map((group) => (
                  <div key={group}>
                    <h4 className="section-label">{group}</h4>
                    <div className="space-y-3">
                      {prompts
                        .filter((p) => p.group === group)
                        .map((p) => {
                          const value = promptDraft[p.key] !== undefined ? promptDraft[p.key] : p.value;
                          return (
                            <div key={p.key} className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)]/50 p-3">
                              <div className="mb-1 flex items-center justify-between">
                                <span className="text-xs font-medium">{p.label}</span>
                                <div className="flex items-center gap-2">
                                  {p.source === 'db' ? (
                                    <span className="badge-brand">已自定义</span>
                                  ) : (
                                    <span className="badge-gray">默认</span>
                                  )}
                                  {promptDraft[p.key] !== undefined && (
                                    <button
                                      onClick={() => setPromptDraft((d) => {
                                        const { [p.key]: _drop, ...rest } = d;
                                        return rest;
                                      })}
                                      className="text-[10px] text-[var(--text-3)] hover:text-[var(--text)]"
                                    >
                                      撤销改动
                                    </button>
                                  )}
                                </div>
                              </div>
                              <p className="mb-2 text-[11px] text-[var(--text-3)]">{p.desc}</p>
                              <textarea
                                value={value}
                                onChange={(e) => setPromptDraft((d) => ({ ...d, [p.key]: e.target.value }))}
                                rows={p.key.includes('MEMORY_SUMMARY') ? 2 : 5}
                                className="textarea font-mono text-xs leading-relaxed"
                              />
                            </div>
                          );
                        })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 flex items-center gap-3">
              <button onClick={savePrompts} disabled={savingPrompts || Object.keys(promptDraft).length === 0} className="btn-primary">
                {savingPrompts ? '保存中…' : '保存提示词'}
              </button>
              {Object.keys(promptDraft).length > 0 && (
                <button onClick={() => setPromptDraft({})} className="btn-ghost">
                  放弃修改
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
