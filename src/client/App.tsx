import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import ResearchPage from './pages/ResearchPage';
import OutlinePage from './pages/OutlinePage';
import WritingPage from './pages/WritingPage';
import AssetsPage from './pages/AssetsPage';
import TimelinePage from './pages/TimelinePage';
import ConflictsPage from './pages/ConflictsPage';

const NAV = [
  { to: '/research', label: '调研', icon: '🔍', phase: 'P1' },
  { to: '/outline', label: '大纲', icon: '🗂️', phase: 'P1' },
  { to: '/writing', label: '创作台', icon: '✍️', phase: 'P2' },
  { to: '/assets', label: '资产库', icon: '📚', phase: 'P1' },
  { to: '/timeline', label: '时间线', icon: '🕐', phase: 'P3' },
  { to: '/conflicts', label: '冲突台', icon: '⚠️', phase: 'P4' },
];

export default function App() {
  return (
    <div className="flex h-screen">
      <aside className="w-60 shrink-0 border-r border-slate-800 bg-slate-900/60 p-4 flex flex-col gap-1">
        <div className="mb-5">
          <h1 className="text-xl font-bold tracking-tight">Author AI</h1>
          <p className="text-xs text-slate-500 mt-0.5">AI 小说创作助手 · 骨架 v0.1</p>
        </div>
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
      </aside>

      <main className="flex-1 overflow-auto p-6">
        <Routes>
          <Route path="/research" element={<ResearchPage />} />
          <Route path="/outline" element={<OutlinePage />} />
          <Route path="/writing" element={<WritingPage />} />
          <Route path="/assets" element={<AssetsPage />} />
          <Route path="/timeline" element={<TimelinePage />} />
          <Route path="/conflicts" element={<ConflictsPage />} />
          <Route path="*" element={<Navigate to="/research" replace />} />
        </Routes>
      </main>
    </div>
  );
}
