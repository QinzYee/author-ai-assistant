import { useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { NovelProvider, useNovel } from './context/NovelContext';
import * as api from './api/client';
import ResearchPage from './pages/ResearchPage';
import OutlinePage from './pages/OutlinePage';
import WritingPage from './pages/WritingPage';
import AssetsPage from './pages/AssetsPage';
import TimelinePage from './pages/TimelinePage';
import ConflictsPage from './pages/ConflictsPage';
import FactsPage from './pages/FactsPage';
import SettingsPage from './pages/SettingsPage';

/* 内联 SVG 图标（线性、1.5px 描边，避免 emoji 的"AI 味"） */
const icons = {
  research: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /><path d="M8 11h6M11 8v6" />
    </svg>
  ),
  outline: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h16M4 12h16M4 19h10" />
    </svg>
  ),
  writing: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  ),
  assets: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16v16H4z" /><path d="M4 9h16M9 9v11" />
    </svg>
  ),
  timeline: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />
    </svg>
  ),
  facts: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M8 10h8M8 14h5" />
    </svg>
  ),
  conflicts: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 2 21h20Z" /><path d="M12 10v4M12 17.5v.5" />
    </svg>
  ),
  settings: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h0a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h0a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v0a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z" />
    </svg>
  ),
};

/* 导航分组：创作流（P1-P3） / 质量闭环（P4） / 系统 */
const NAV_GROUPS: Array<{ label: string; items: Array<{ to: string; label: string; icon: React.ReactNode }> }> = [
  {
    label: '创作',
    items: [
      { to: '/research', label: '题材调研', icon: icons.research },
      { to: '/outline', label: '大纲编辑器', icon: icons.outline },
      { to: '/writing', label: '创作工作台', icon: icons.writing },
      { to: '/assets', label: '资产库', icon: icons.assets },
      { to: '/timeline', label: '时间线', icon: icons.timeline },
    ],
  },
  {
    label: '质量闭环',
    items: [
      { to: '/facts', label: '事实卡片', icon: icons.facts },
      { to: '/conflicts', label: '冲突台', icon: icons.conflicts },
    ],
  },
  {
    label: '系统',
    items: [{ to: '/settings', label: '设置', icon: icons.settings }],
  },
];

function ProjectSelector() {
  const { novels, current, select, create } = useNovel();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('');

  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">当前项目</span>
        <button
          onClick={() => setCreating(true)}
          className="rounded-md px-1.5 py-0.5 text-xs text-[var(--brand-600)] hover:bg-[var(--brand-50)]"
        >
          + 新建
        </button>
      </div>

      {creating ? (
        <form
          className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5 shadow-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            void create({ title: title.trim(), genre: genre.trim() || undefined }).then(() => {
              setTitle('');
              setGenre('');
              setCreating(false);
            });
          }}
        >
          <input className="input" placeholder="书名" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          <input className="input" placeholder="题材（可选）" value={genre} onChange={(e) => setGenre(e.target.value)} />
          <div className="flex gap-1.5">
            <button type="submit" className="btn-primary btn-sm flex-1">创建</button>
            <button type="button" onClick={() => setCreating(false)} className="btn-secondary btn-sm flex-1">取消</button>
          </div>
        </form>
      ) : (
        <select
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none transition-shadow focus:ring-2 focus:ring-[var(--brand-200)]"
          value={current?.id ?? ''}
          onChange={(e) => select(e.target.value)}
        >
          {novels.length === 0 && <option value="">（还没有项目）</option>}
          {novels.map((n) => (
            <option key={n.id} value={n.id}>{n.title}</option>
          ))}
        </select>
      )}
      {current?.genre && <p className="mt-1 text-[11px] text-[var(--text-3)]">{current.genre} · {current.status}</p>}
    </div>
  );
}

function Shell() {
  const { current, loading } = useNovel();
  const location = useLocation();
  const currentNav =
    NAV_GROUPS.flatMap((g) => g.items).find((i) => i.to === location.pathname)?.label ?? '';

  return (
    <div className="flex h-screen overflow-hidden">
      {/* 侧边栏 */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface-2)]">
        <div className="px-4 pb-3 pt-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brand-500)] text-sm font-bold text-white">
              A
            </div>
            <div>
              <h1 className="text-[15px] font-semibold leading-tight tracking-tight">Author AI</h1>
              <p className="text-[11px] text-[var(--text-3)]">小说创作助手</p>
            </div>
          </div>
        </div>

        <ProjectSelector />

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-3">
          {NAV_GROUPS.map((g) => (
            <div key={g.label}>
              <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
                {g.label}
              </div>
              <div className="space-y-0.5">
                {g.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                        isActive
                          ? 'bg-[var(--surface)] font-medium text-[var(--text)] shadow-sm ring-1 ring-[var(--border)]'
                          : 'text-[var(--text-2)] hover:bg-[var(--surface)]/60 hover:text-[var(--text)]'
                      }`
                    }
                  >
                    <span className="shrink-0 text-[var(--text-3)]">{item.icon}</span>
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-[var(--border)] p-3">
          <ExportSection novelId={current?.id} />
        </div>
      </aside>

      {/* 主区域 */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* 顶栏 */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-6">
          <div className="text-sm font-medium text-[var(--text)]">{currentNav || 'Author AI'}</div>
          <div className="flex items-center gap-2 text-xs text-[var(--text-3)]">
            {current && <span className="truncate max-w-[240px]">{current.title}</span>}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-[var(--text-3)]">
              <span className="spinner text-[var(--brand-500)]" />
              加载中…
            </div>
          ) : !current ? (
            <NoProject />
          ) : (
            <div key={location.pathname} className="animate-fade-in-up h-full">
              <Routes>
                <Route path="/research" element={<ResearchPage />} />
                <Route path="/outline" element={<OutlinePage />} />
                <Route path="/writing" element={<WritingPage />} />
                <Route path="/assets" element={<AssetsPage />} />
                <Route path="/timeline" element={<TimelinePage />} />
                <Route path="/facts" element={<FactsPage />} />
                <Route path="/conflicts" element={<ConflictsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/research" replace />} />
              </Routes>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function NoProject() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand-50)] text-2xl">
          📖
        </div>
        <h2 className="text-xl font-semibold">还没有项目</h2>
        <p className="mt-2 text-sm text-[var(--text-3)]">在左侧「当前项目」新建一本书，然后开始调研题材、生成大纲。</p>
      </div>
    </div>
  );
}

function ExportSection({ novelId }: { novelId: string | undefined }) {
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const doExport = async (format: 'md' | 'epub' | 'docx') => {
    if (!novelId) return;
    setState('busy');
    setMessage(null);
    try {
      await api.exportNovel(novelId, format);
      setState('idle');
    } catch (e) {
      setState('error');
      setMessage((e as Error).message);
      setTimeout(() => setState('idle'), 4000);
    }
  };

  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">导出</div>
      <div className="flex gap-1.5">
        {(['md', 'epub', 'docx'] as const).map((f) => (
          <button
            key={f}
            onClick={() => doExport(f)}
            disabled={state === 'busy' || !novelId}
            className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-1.5 py-1 text-[11px] font-medium text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)] disabled:opacity-40"
          >
            {f.toUpperCase()}
          </button>
        ))}
      </div>
      {message && <div className="mt-1.5 text-[11px] text-[var(--danger)]">{message}</div>}
    </div>
  );
}

export default function App() {
  return (
    <NovelProvider>
      <Shell />
    </NovelProvider>
  );
}
