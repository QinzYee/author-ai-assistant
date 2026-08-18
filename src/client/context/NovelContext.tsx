import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Novel } from '../types';
import * as api from '../api/client';

interface NovelContextValue {
  novels: Novel[];
  current: Novel | null;
  loading: boolean;
  select: (id: string) => void;
  refresh: () => Promise<void>;
  create: (input: { title: string; genre?: string; target_audience?: string }) => Promise<Novel>;
  remove: (id: string) => Promise<void>;
}

const NovelContext = createContext<NovelContextValue | null>(null);

export function NovelProvider({ children }: { children: ReactNode }) {
  const [novels, setNovels] = useState<Novel[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const list = await api.listNovels();
      setNovels(list);
      setCurrentId((prev) => {
        if (prev && list.some((n) => n.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const value = useMemo<NovelContextValue>(
    () => ({
      novels,
      current: novels.find((n) => n.id === currentId) ?? null,
      loading,
      select: setCurrentId,
      refresh,
      create: async (input) => {
        const novel = await api.createNovel(input);
        setNovels((prev) => [novel, ...prev]);
        setCurrentId(novel.id);
        return novel;
      },
      remove: async (id) => {
        await api.deleteNovel(id);
        setNovels((prev) => prev.filter((n) => n.id !== id));
        setCurrentId((prev) => (prev === id ? null : prev));
      },
    }),
    [novels, currentId, loading]
  );

  return <NovelContext.Provider value={value}>{children}</NovelContext.Provider>;
}

export function useNovel(): NovelContextValue {
  const ctx = useContext(NovelContext);
  if (!ctx) throw new Error('useNovel must be used within NovelProvider');
  return ctx;
}
