import { useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
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

const NAV = [
  { to: '/research', label: '调研', icon: '🔍', phase: 'P1' },
  { to: '/outline', label: '大纲', icon: '🗂️', phase: 'P1' },
  { to: '/writing', label: '创作台', icon: '✍️', phase: 'P2' },
  { to: '/assets', label: '资产库', icon: '📚', phase: 'P1' },
  { to: '/timeline', label: '时间线', icon: '🕐', phase: 'P3' },
  { to: '/facts', label: '事实卡', icon: '🃏', phase: 'P4' },
  { to: '/conflicts', label: '冲突台', icon: '⚠️', phase: 'P4' },
  { to: '/settings', label: '设置', icon: '⚙️', phase: 'SYS' },
];

function ProjectSelector() {
  const { novels, current, select, create } = useNovel();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('');

  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">项目</span>
        <button
          onClick={() => setCreating(true)}
          className="ml-auto text-xs text-slate-400 hover:text-white px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700"
        >
          + 新建
        </button>
      </div>

      {creating ? (
        <form
          className="flex flex-col gap-1.5 rounded-lg bg-slate-800/70 p-2"
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
          <input
            className="rounded bg-slate-900 px-2 py-1 text-sm outline-none focus:ring-1 ring-slate-500"
            placeholder="书名"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
          <input
            className="rounded bg-slate-900 px-2 py-1 text-sm outline-none focus:ring-1 ring-slate-500"
            placeholder="题材（可选）"
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
          />
          <div className="flex gap-1.5 mt-1">
            <button type="submit" className="flex-1 text-xs rounded bg-sky-600 hover:bg-sky-500 py-1">
              创建
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="flex-1 text-xs rounded bg-slate-700 hover:bg-slate-600 py-1"
            >
              取消
            </button>
          </div>
        </form>
      ) : (
        <select
          className="w-full rounded bg-slate-800 px-2 py-1.5 text-sm text-slate-200 outline-none focus:ring-1 ring-slate-500"
          value={current?.id ?? ''}
          onChange={(e) => select(e.target.value)}
        >
          {novels.length === 0 && <option value="">（还没有项目）</option>}
          {novels.map((n) => (
            <option key={n.id} value={n.id}>
              {n.title}
            </option>
          ))}
        </select>
      )}
      {current?.genre && <p className="text-[11px] text-slate-500 mt-1">{current.genre} · {current.status}</p>}
    </div>
  );
}

function Shell() {
  const { current, loading } = useNovel();

  return (
    <div className="flex h-screen">
      <aside className="w-60 shrink-0 border-r border-slate-800 bg-slate-900/60 p-4 flex flex-col gap-1">
        <div className="mb-3">
          <h1 className="text-xl font-bold tracking-tight">Author AI</h1>
          <p className="text-xs text-slate-500 mt-0.5">AI 小说创作助手</p>
        </div>
        <ProjectSelector />
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
              }`
            }
          >
            <span className="text-base">{item.icon}</span>
            <span className="flex-1">{item.label}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-500">{item.phase}</span>
          </NavLink>
        ))}

        {current && <ExportSection novelId={current.id} />}
      </aside>

      <main className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex h-full items-center justify-center text-slate-500">加载中…</div>
        ) : !current ? (
          <NoProject />
        ) : (
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
        )}
      </main>
    </div>
  );
}

function NoProject() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-md text-center">
        <div className="text-5xl mb-4">📖</div>
        <h2 className="text-2xl font-semibold mb-2">还没有项目</h2>
        <p className="text-slate-400 text-sm mb-4">在左侧「项目」新建一本书，然后开始调研题材、生成大纲。</p>
      </div>
    </div>
  );
}

function ExportSection({ novelId }: { novelId: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const doExport = async (format: 'md' | 'epub' | 'docx') => {
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

  const btnClass = (format: 'md' | 'epub' | 'docx') =>
    `flex-1 rounded px-1.5 py-1 text-[11px] transition-colors ${
      state === 'busy' ? 'opacity-40 pointer-events-none' : ''
    } ${format === 'md' ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : ''}${
      format === 'epub' ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : ''
    }${format === 'docx' ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : ''}`;

  return (
    <div className="mt-auto pt-4">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">导出（P4）</span>
      </div>
      <div className="flex gap-1">
        <button onClick={() => doExport('md')} disabled={state === 'busy'} className={btnClass('md')}>MD</button>
        <button onClick={() => doExport('epub')} disabled={state === 'busy'} className={btnClass('epub')}>EPUB</button>
        <button onClick={() => doExport('docx')} disabled={state === 'busy'} className={btnClass('docx')}>DOCX</button>
      </div>
      {message && <div className="mt-1.5 text-[10px] text-rose-400">{message}</div>}
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
