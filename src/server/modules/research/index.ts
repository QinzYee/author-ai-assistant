import type { LlmGateway } from '../../llm/index.js';
import type { ResearchRepository } from '../../db/repositories/research.js';
import type { NovelRepository } from '../../db/repositories/novels.js';
import type { PromptsService } from '../prompts/index.js';
import type { TrendResearch, ResearchReport, SearchHit } from '../../../shared/index.js';

export interface ResearchServiceDeps {
  repo: ResearchRepository;
  novels: NovelRepository;
  gateway: LlmGateway;
  tavilyApiKey?: string;
  prompts: PromptsService;
}

/** Tavily Search API（无 SDK，直接 fetch） */
async function tavilySearch(query: string, apiKey: string): Promise<SearchHit[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      max_results: 8,
      include_answer: true,
    }),
  });
  if (!res.ok) {
    throw new Error(`[tavily] HTTP ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    answer?: string;
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  const hits: SearchHit[] = (data.results ?? []).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    content: r.content ?? '',
  }));
  if (data.answer) {
    hits.unshift({ title: 'tavily_answer', url: '', content: data.answer });
  }
  return hits;
}

export function createResearchService(deps: ResearchServiceDeps) {
  const { repo, novels, gateway, prompts } = deps;

  async function runResearch(novelId: string, query: string): Promise<TrendResearch> {
    const novel = novels.get(novelId);
    const effectiveQuery = query.trim() || `${novel?.title ?? ''} ${novel?.genre ?? '网文'} 热门题材 2025`;

    // 1. 采集（可选：未配置 Tavily 时跳过，仅用 LLM 知识）
    let hits: SearchHit[] = [];
    let searchNote = '';
    if (deps.tavilyApiKey) {
      try {
        hits = await tavilySearch(effectiveQuery, deps.tavilyApiKey);
      } catch (err) {
        searchNote = `搜索失败：${(err as Error).message}；已降级为模型知识分析。`;
        hits = [];
      }
    } else {
      searchNote = '未配置 TAVILY_API_KEY，仅基于模型知识分析（推荐配置 Tavily 以获得真实榜单）。';
    }

    // 2. 分析 pass（LLM 结构化输出）
    const material = hits.length
      ? hits.map((h) => `- [${h.title}] ${h.content.slice(0, 300)}`).join('\n')
      : '（无外部搜索数据）';
    const user = `小说：${novel?.title ?? '未命名'}，题材：${novel?.genre ?? '未定'}
调研问题：${effectiveQuery}
搜索材料：
${material}

请给出调研报告。${searchNote}`;
    const out = (await gateway.extract({ system: prompts.get('PROMPT_RESEARCH_ANALYSIS'), user })).json as Partial<ResearchReport>;
    const report: ResearchReport = {
      heat_ranking: Array.isArray(out.heat_ranking) ? out.heat_ranking : [],
      reader_profiles: Array.isArray(out.reader_profiles) ? out.reader_profiles : [],
      core_pleasure_points: Array.isArray(out.core_pleasure_points) ? out.core_pleasure_points : [],
      blue_ocean_ideas: Array.isArray(out.blue_ocean_ideas) ? out.blue_ocean_ideas : [],
      golden_three_chapters: Array.isArray(out.golden_three_chapters) ? out.golden_three_chapters : [],
      recommendation: typeof out.recommendation === 'string' ? out.recommendation : '',
    };

    // 3. 持久化
    return repo.save({
      novel_id: novelId,
      query: effectiveQuery,
      results: { hits, report, note: searchNote },
      conclusion: report.recommendation,
    });
  }

  return {
    runResearch,
    latest(novelId: string) {
      return repo.latestForNovel(novelId);
    },
    list(novelId: string) {
      return repo.listForNovel(novelId);
    },
  };
}

export type ResearchService = ReturnType<typeof createResearchService>;
