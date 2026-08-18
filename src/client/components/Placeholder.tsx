export default function Placeholder({
  title,
  description,
  phase,
}: {
  title: string;
  description: string;
  phase: string;
}) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-md text-center">
        <div className="text-5xl mb-4">🚧</div>
        <h2 className="text-2xl font-semibold mb-2">{title}</h2>
        <p className="text-slate-400 text-sm mb-4">{description}</p>
        <span className="inline-block px-2.5 py-1 rounded-full bg-slate-800 text-xs text-slate-400">
          路线图 Phase {phase} 实现
        </span>
      </div>
    </div>
  );
}
