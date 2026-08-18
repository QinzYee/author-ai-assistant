# AI 小说创作工具 — 架构设计文档

> 版本：v1.0 ｜ 定位：本地 Web 应用（个人创作工具）｜ 技术栈：Node/TypeScript 全栈 + DeepSeek/OpenAI API

---

## 目录

1. [产品定位与核心价值](#1-产品定位与核心价值)
2. [原设计评审与三项关键优化](#2-原设计评审与三项关键优化)
3. [总体架构](#3-总体架构)
4. [核心模块设计](#4-核心模块设计)
5. [数据模型（SQLite Schema）](#5-数据模型sqlite-schema)
6. [创作一个场景的完整时序](#6-创作一个场景的完整时序)
7. [记忆系统详解（三级 + Compact 物化）](#7-记忆系统详解三级--compact-物化)
8. [知识库 RAG 与主动检索](#8-知识库-rag-与主动检索)
9. [资产系统详解](#9-资产系统详解)
10. [一致性保障与伏笔管理](#10-一致性保障与伏笔管理)
11. [技术选型与工程结构](#11-技术选型与工程结构)
12. [成本与性能预算](#12-成本与性能预算)
13. [实施路线图](#13-实施路线图)
14. [风险与对策](#14-风险与对策)

---

## 1. 产品定位与核心价值

**一句话定位**：帮助作者从"今天写什么题材"到"成书导出"的全流程 AI 创作助手，重点解决长篇小说最大的痛点——**长篇一致性**（人物不崩、设定不崩、伏笔不漏）。

| 用户旅程 | 工具介入 |
|---|---|
| 不知道写什么 | 热点题材/流派调研 → 差异化建议 |
| 有了想法 | 世界观、人物、大纲分层生成 |
| 开写 | 场景级流水线创作，人机协同 |
| 写长了 | 三级记忆 + 知识库，细节不丢、前后不矛盾 |
| 写完了 | 一致性校验、伏笔台账、导出 |

**人机协同原则**：AI 生成，人类裁决。关键节点（题材、大纲、人物设定、矛盾冲突处理）必须设置人工确认检查点，不追求"全自动写完整本书"。

---

## 2. 原设计评审与三项关键优化

你的原始设计有四个很好的点，予以保留并强化：

- ✅ 热点题材/流派搜索 → 大纲生成（调研驱动创作，正确）
- ✅ 基于大纲自顶向下创作（分层约束，正确且必要）
- ✅ compact + 已创作内容 chunk 入库 + 主动搜索（方向正确）
- ✅ 人物/资产索引 + 快速查阅（方向正确）

但存在三个工程上会致命的薄弱点，本设计的核心优化就在于此：

### 优化一：compact 不是"压缩丢细节"，而是"物化优先"

**你的顾虑是对的**：compact 一定会丢细节。但解决方式不是"尽量压缩得聪明一点"，而是改变 compact 的职责——

> **compact 的产出不只是摘要，而是把细节"物化"为结构化数据后，摘要才允许压缩原文。**

具体拆成三步（详见 [第 7 节](#7-记忆系统详解三级--compact-物化)）：

1. **物化（Materialize）**：从即将压缩的窗口里提取**事实卡片**（原子事实）和**资产状态变更**，结构化写入长期库——这些是"不会丢的细节"；
2. **摘要（Summarize）**：窗口折叠为场景摘要，写入分层摘要树；
3. **裁剪（Trim）**：删除原文，保留摘要 + 事实卡片指针，后续按需 RAG 取回。

这样 compact 之后，细节存在于三处：**结构化事实卡片（精确）、资产表（版本化）、向量 chunk（可检索）**，而不是消失在摘要里。

### 优化二："主动搜索"从玄学变成确定性机制

你原设计里"遇到语焉不详的上下文与记忆时主动搜索"——如果靠"感觉上下文模糊了就去搜"，在工程上无法实现（LLM 不会告诉你它哪里没记住）。本设计把主动检索拆成**三层确定性触发**，其中第一层是免费午餐：

1. **实体驱动（确定性，主路径）**：因为大纲是自顶向下的，**每个场景大纲本身就声明了出场人物/地点/道具清单**。生成前直接拿这份清单去资产表 O(1) 直查核心属性——根本不需要 NER 实体识别，也不依赖"感觉模糊"，每次生成前必然带上所需细节。
2. **语义预检索（RAG 主路径）**：以场景大纲 + 相邻摘要为 query，对正文 chunk 库做混合检索（向量 + 关键词 + 实体过滤），把相关历史内容取回上下文。
3. **生成后校验（兜底）**：生成完成后做一致性校验 pass，发现与既有知识冲突或缺失的细节 → 触发补检索 → 局部重写（最多 N 次）。

### 优化三：资产不是"查得到"，而是"活得起来"

你的设计只说了"建立索引、快速查阅"——但**只读的资产库会在第 10 章之后全面过期**（人物受伤了、关系变了、秘密揭晓了，资产表还是第 1 章的）。补充三个机制：

1. **写回（Write-back）**：每个场景生成后跑一个"资产更新 pass"，把正文中的状态变化提取为结构化 JSON 写回资产表；
2. **版本化（Versioning）**：资产状态 append-only 存历史，支持"第 30 章时林晚的伤势如何"这类时间旅行查询；
3. **资产分级**：核心属性（每次生成必进 prompt）与扩展属性（按需检索）分离，控制 token 预算。

另外补一个你没提但小说创作刚需的模块：**伏笔管理（Plot Device 台账）**——埋设/发展/回收全生命周期跟踪，这是长篇创作"不烂尾"的关键。

---

## 3. 总体架构

```
┌─────────────────────────────────────────────────────────┐
│                    Web UI (React + Vite)                 │
│   调研面板 │ 大纲编辑器 │ 创作工作台 │ 资产库 │ 时间线 │ 冲突台 │
└─────────────────────────┬───────────────────────────────┘
                          │ REST + SSE（生成进度流）
┌─────────────────────────▼───────────────────────────────┐
│                    Backend (Fastify, Node/TS)            │
│                                                          │
│  ┌──────────┐   ┌──────────┐   ┌──────────────────────┐  │
│  │ 调研模块   │   │ 大纲模块   │   │  创作引擎（核心流水线）  │  │
│  └──────────┘   └──────────┘   └──────────┬───────────┘  │
│  ┌──────────────────────┐   ┌────────────▼───────────┐  │
│  │ 记忆管理器（三级+compact）│   │ 上下文组装器（Context   │  │
│  └──────────────────────┘   │   Assembler）            │  │
│  ┌──────────────────────┐   └────────────┬───────────┘  │
│  │ 知识库 RAG（混合检索）  │                │              │
│  └──────────────────────┘                │              │
│  ┌──────────┐ ┌──────────┐ ┌────────────▼───────────┐  │
│  │ 资产管理器 │ │ 伏笔台账  │ │ 一致性校验 / 矛盾处理       │  │
│  └──────────┘ └──────────┘ └────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │          LLM 网关（模型抽象层，可切换/分级）          │  │
│  │  生成级：DeepSeek-V3 ｜ 提取级：DeepSeek-chat       │  │
│  │  Embedding：BGE-M3（硅基流动）或 text-embedding-3   │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────┬───────────────────────────────┘
                          │
        ┌─────────────────┴──────────────────┐
        │        SQLite（单文件，零部署）         │
        │  better-sqlite3 + sqlite-vec + FTS5  │
        │  资产 / 大纲树 / 正文 / 摘要树 / 事实卡片  │
        │  伏笔 / 冲突 / 调研 / 向量 / 全文索引     │
        └────────────────────────────────────┘
```

设计要点：
- **单进程、单文件数据库**——本地工具就该这样，备份 = 拷贝一个文件；
- **向量检索用 sqlite-vec**——和结构化数据同库同事务，不需要单独部署向量数据库；
- **SSE 流式推送生成进度**——长任务（一次场景生成要跑 5~7 个 LLM pass）必须有进度反馈；
- **LLM 网关统一抽象**——所有模块只面向 `LlmGateway` 接口，模型可配置、可分级、可替换。

---

## 4. 核心模块设计

### 4.1 题材调研模块（research）

```
触发：新项目创建 或 用户主动"再调研"
流程：
 1. 采集：调用搜索 API（Tavily/SerpAPI）抓取
    - 平台榜单（起点/番茄/晋江 热榜标题+简介，仅作统计，不抓正文）
    - 关键词趋势（如"系统流""克苏鲁+修仙"组合热度）
    - 近期爆款作品的题材、标签、风格特征
 2. 分析（LLM）：输出结构化调研报告
    - 热度榜单（题材/流派 × 趋势方向）
    - 读者画像与核心爽点（升级感/悬念/情感/世界观新奇度）
    - 差异化建议：蓝海组合（如"中式克苏鲁+都市职场"）
    - 黄金三章要素清单
 3. 人机确认：用户选定题材方向 → 进入大纲模块
输出：trend_research 表 + 报告面板
```

### 4.2 大纲生成模块（outline）——自顶向下分层

每一层都是"上一层的约束 + 本层的结构化产出"，且**每层产出可人工编辑确认后再进入下一层**：

```
题材/流派（调研确认）
  └─► 核心创意（高概念一句话 + 目标读者 + 卖点）
       └─► 世界观设定（规则/地图/力量体系/时间线基准）
            └─► 主线梗概（起承转合 / 三幕 / 主题）
                 └─► 人物小传（主角/配角/反派：目标、动机、成长弧光）
                      └─► 卷大纲（每卷目标、转折、悬念、结尾钩子）
                           └─► 章大纲（每章：视角、目标、冲突、结尾钩子）
                                └─► 场景大纲（创作单元）← 从这里开始写正文
```

**场景大纲是整条链的关键节点**，它声明了创作一个场景所需的全部确定性信息：

```json
{
  "scene": "第3章-场景2：图书馆闭馆后的对峙",
  "time": "主线第3天 21:40",
  "location": "市立图书馆·古籍区",
  "characters": ["林晚(主角)", "沈砚(反派)"],
  "goal": "林晚发现沈砚在偷取禁书，双方第一次正面交锋",
  "conflict": "沈砚威胁，林晚力量不足但发现关键线索",
  "result": "沈砚逃脱，林晚获得半页残卷（伏笔：残卷来源）",
  "info_revealed": ["沈砚知道残卷的下落", "图书馆地下有密室"],
  "foreshadowing": ["埋设：残卷上的符号与林晚的身世有关"],
  "continuity_notes": "林晚左臂伤势未愈（第2章受伤），动作描写受限"
}
```

> 注意 `characters` 和 `continuity_notes`：前者是**实体驱动的确定性检索入口**（见优化二），后者是对既有状态的显式提醒——生成时这两项直接注入 prompt。

### 4.3 创作引擎（writing）——核心流水线

每个场景的生成是**一条流水线（Pipeline），而不是一次 LLM 调用**：

```
┌─ 1. 上下文组装器（Context Assembler）
│     按 token 预算分层组装 prompt（见 §6）
│
├─ 2. 正文生成（主调用，高质量模型）
│     输出：正文 + 结构化元数据
│     { new_facts: [...], asset_changes: [...], foreshadowing: [...], pov, timestamp }
│
├─ 3. 资产更新 pass（便宜模型）——写回资产表（版本+1）
├─ 4. 事实提取 pass（便宜模型）——正文 → 原子事实卡片（去重/冲突检测）
├─ 5. 一致性校验 pass（便宜模型）——新事实 vs 既有资产/卡片 → 冲突清单
├─ 6. 摘要 pass（便宜模型）——正文 → 场景摘要（写入摘要树 L2）
├─ 7. 分块入库（纯计算）——正文 → 512-token chunks → embedding → 向量库
│
└─ 8. 冲突处理
       无冲突        → 场景完成，通知前端
       可自动修复    → 局部重写冲突句（最多 2 次）
       需人工裁决    → 写入 conflicts 表，前端高亮提示用户
```

**Pass 分级策略**：只有第 2 步用高质量模型，其余提取/校验/摘要类 pass 全部用便宜模型——单场景成本大头在正文生成，后处理成本占比很低。

### 4.4 记忆系统（memory）——三级架构

详见 [第 7 节](#7-记忆系统详解三级--compact-物化)，这里给出总览：

| 层级 | 名称 | 存储 | 内容 | 更新时机 | 取回方式 |
|---|---|---|---|---|---|
| L1 | 工作记忆 | LLM 上下文 | 最近场景正文 + 摘要 + 本场景组装结果 | 每次生成 | 直接注入 |
| L2 | 情节记忆 | summaries 表（摘要树） | 场景→章→卷 分层摘要 + 卷大事记 | compact 时、场景完成时 | 按层级取回 |
| L3 | 长期知识库 | content_chunks（向量）+ fact_cards + assets + timeline | 全部正文 chunk、原子事实、资产、时间线 | 持续写入 | RAG 混合检索 / 实体直查 |

### 4.5 知识库 RAG（knowledge）

混合检索三路融合（RRF 排序）：

1. **向量检索**：场景大纲/摘要 → embedding → 与 content_chunks 余弦相似度 Top-K；
2. **全文检索**：SQLite FTS5 关键词命中（人名、地名、专有名词精确匹配，弥补向量对专名的弱点）；
3. **实体过滤**：场景大纲声明的实体清单 → 直查资产表 + 相关事实卡片（结构化，零误差）。

三路结果按 RRF（Reciprocal Rank Fusion）融合取 Top-N，控制 token 预算。

### 4.6 资产系统（assets）

详见 [第 9 节](#9-资产系统详解)。

### 4.7 一致性校验（consistency）

详见 [第 10 节](#10-一致性保障与伏笔管理)。

### 4.8 伏笔管理（plot devices）

详见 [第 10 节](#10-一致性保障与伏笔管理)。

---

## 5. 数据模型（SQLite Schema）

```sql
-- ============ 项目 ============
CREATE TABLE novels (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  genre TEXT,
  status TEXT DEFAULT 'research',      -- research|outline|writing|finished
  target_audience TEXT,
  selling_points TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ============ 资产（人物/地点/物品/组织/设定） ============
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES novels(id),
  type TEXT NOT NULL,                   -- character|location|item|organization|setting
  name TEXT NOT NULL,
  core JSON NOT NULL,                   -- 核心属性（每次生成必进 prompt，小而稳）
  extended JSON,                        -- 扩展属性（大而全，按需检索）
  summary TEXT,                         -- 一句话速览（资产索引展示用）
  current_version INT DEFAULT 1,
  created_at TEXT, updated_at TEXT
);
CREATE INDEX idx_assets_novel ON assets(novel_id, type);

-- 资产状态历史（append-only，支持时间旅行）
CREATE TABLE asset_states (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  version INT NOT NULL,
  state JSON NOT NULL,                  -- 该版本完整状态快照
  source_scene_id TEXT,                 -- 由哪个场景更新
  created_at TEXT
);

-- 资产关系（人物关系图/物品归属/组织从属）
CREATE TABLE asset_relations (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  from_asset TEXT NOT NULL,
  to_asset TEXT NOT NULL,
  relation_type TEXT NOT NULL,          -- 敌对|师徒|恋人|持有|隶属...
  description TEXT
);

-- ============ 大纲树（卷→章→场景） ============
CREATE TABLE outline_nodes (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  parent_id TEXT,                       -- null = 根（小说）
  level TEXT NOT NULL,                  -- volume|chapter|scene
  title TEXT,
  summary TEXT,
  content JSON,                         -- 场景大纲结构（含 characters/goal/conflict 等）
  sort_order INT,
  status TEXT DEFAULT 'planned'         -- planned|confirmed|writing|done
);

-- ============ 正文 ============
CREATE TABLE scenes (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  outline_node_id TEXT REFERENCES outline_nodes(id),
  content TEXT NOT NULL,                -- 正文全文
  word_count INT,
  meta JSON,                            -- 生成元数据（new_facts/asset_changes 等）
  status TEXT DEFAULT 'draft',          -- draft|revised|approved
  created_at TEXT, updated_at TEXT
);

-- ============ 事实卡片（原子事实，防矛盾的核心） ============
CREATE TABLE fact_cards (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  fact TEXT NOT NULL,                   -- "林晚左臂在第二章被划伤，尚未痊愈"
  entities JSON,                        -- ["林晚"]
  source_scene_id TEXT,
  confidence REAL DEFAULT 0.8,
  status TEXT DEFAULT 'active',         -- active|superseded|retracted
  created_at TEXT
);
CREATE INDEX idx_fact_entities ON fact_cards(novel_id, entities);

-- ============ 摘要树（L2 情节记忆） ============
CREATE TABLE summaries (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  level TEXT NOT NULL,                  -- scene|chapter|volume
  ref_id TEXT NOT NULL,                 -- 对应 scene/chapter/volume id
  content TEXT NOT NULL,
  created_at TEXT
);

-- ============ 正文分块 + 向量（L3） ============
CREATE TABLE content_chunks (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  scene_id TEXT REFERENCES scenes(id),
  chunk_index INT,
  content TEXT NOT NULL,
  embedding BLOB,                       -- sqlite-vec 向量
  UNIQUE(scene_id, chunk_index)
);
-- sqlite-vec 虚拟表
CREATE VIRTUAL TABLE chunk_vec USING vec0(
  id TEXT PRIMARY KEY, embedding float[1024]
);
-- 全文索引（混合检索用）
CREATE VIRTUAL TABLE chunk_fts USING fts5(content, scene_id);

-- ============ 伏笔台账 ============
CREATE TABLE plot_devices (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  type TEXT NOT NULL,                   -- identity|item|event|prophecy|location
  description TEXT NOT NULL,
  status TEXT DEFAULT 'planted',        -- planted|developing|paid_off|abandoned|forgotten
  planted_scene_id TEXT,
  expected_payoff TEXT,                 -- 预计回收章节/条件
  related_entities JSON,
  notes TEXT,
  created_at TEXT, updated_at TEXT
);

-- ============ 一致性冲突 ============
CREATE TABLE conflicts (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  type TEXT NOT NULL,                   -- contradiction|missing_detail|timeline_issue|loose_thread
  description TEXT NOT NULL,
  evidence JSON,                        -- 冲突双方引用
  status TEXT DEFAULT 'open',           -- open|auto_fixed|resolved|ignored
  resolution TEXT,
  created_at TEXT, updated_at TEXT
);

-- ============ 调研记录 / 生成日志 ============
CREATE TABLE trend_research (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  query TEXT, results JSON, conclusion TEXT, created_at TEXT
);

CREATE TABLE generation_logs (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  scene_id TEXT,
  pass_type TEXT,                       -- generate|extract|verify|summarize|assets
  model TEXT, input_tokens INT, output_tokens INT,
  created_at TEXT
);
```

---

## 6. 创作一个场景的完整时序

以"第 3 章-场景 2"为例，展示完整调用链（含每步 token 预算，总输入预算约 16K）：

```
用户点击【生成本场景】
  │
  ▼
┌─ Context Assembler ──────────────────────────────────────────┐
│  ① 系统提示 + 创作规则（叙事规范/文风/禁止剧透规则）   ~2K    │
│  ② 世界观核心规则（assets type=setting, 精简版）        ~1K    │
│  ③ 卷大纲 + 章大纲 + 本场景大纲（outline_nodes）         ~2K    │
│  ④ 实体核心属性（从场景大纲 characters 直查资产表）      ~2K    │
│  ⑤ 上一场景摘要 + 本章摘要 + 卷大事记（L2）              ~1K    │
│  ⑥ RAG 检索 chunks（向量+FTS+实体过滤, Top-6）          ~3K    │
│  ⑦ 相关事实卡片（按 entities 过滤, 15 条内）             ~1K    │
│  ⑧ 待回收伏笔（plot_devices status=planted/developing）  ~0.5K  │
│  ⑨ 预留（防溢出）                                       ~3.5K  │
│  （超预算时按 ②>⑦>⑥>④ 的逆优先级裁剪）                        │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─ LLM 主调用（DeepSeek-V3）───────────────────────────────────┐
│  输入：①~⑧ 组装好的 prompt                                    │
│  输出：正文（约 1500~2500 字）+ JSON 元数据                     │
│  { new_facts, asset_changes, foreshadowing_ops, pov, time }  │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─ 后处理四个 pass（全部便宜模型，可并行前两个）──────────────────┐
│  A. 资产更新 pass → 写 asset_states(version+1) + assets      │
│  B. 事实提取 pass → 写 fact_cards（与既有卡片查重/冲突）        │
│  C. 一致性校验 pass → 新事实 vs 资产/卡片 → conflicts          │
│  D. 摘要 pass → 场景摘要写入 summaries（L2）                   │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─ 分块入库（纯计算，无 LLM）───────────────────────────────────┐
│  正文 → 512-token 重叠分块 → BGE-M3 embedding → chunk_vec    │
│  + chunk_fts 全文索引                                         │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─ 冲突处理 ──────────────────────────────────────────────────┐
│  无冲突 → 完成，前端刷新场景卡片                               │
│  可自动修 → 局部重写（≤2次）                                   │
│  需裁决 → conflicts 表 open，前端冲突台高亮                   │
└─────────────────────────────────────────────────────────────┘
```

**为什么正文生成不一次写一章？** 场景是记忆和资产更新的最小合理单元——场景结束时的状态（谁在哪、知道什么、伤势如何）是确定的，可以干净地写入资产和历史。一次性写一章会导致状态快照粗粒度、资产更新 pass 输出过大、且用户难以介入。

---

## 7. 记忆系统详解（三级 + Compact 物化）

### 7.1 三级职责划分

- **L1 工作记忆**：仅存"当前正在写的内容"。预算约 16K tokens（见 §6）。写满后触发 compact。
- **L2 情节记忆（摘要树）**：场景摘要 → 章摘要 → 卷摘要，逐级压缩。生成时按需取"上一场景摘要 + 本章摘要 + 卷大事记"，永远不超过预算。
- **L3 长期知识库**：全部正文 chunk（向量+全文）、事实卡片、资产（含版本历史）、时间线。**永不删除、永不压缩**——这就是"细节不丢"的物理保证。

### 7.2 Compact 流程（物化优先）

```
触发：L1 工作记忆 token 占用 > 85%
  │
  ▼
① 物化（Materialize）——最重要的一步
   取窗口最早的 2~3 个已完成场景的正文，用便宜模型提取：
   - 事实卡片（原子事实，与现有卡片去重）
   - 资产状态变更（写回 asset_states）
   - 伏笔操作（埋设/发展/回收）
   → 细节以结构化形式进入 L3，不再依赖原文
  │
  ▼
② 摘要（Summarize）
   同一批正文折叠为场景摘要，写入 summaries（L2）
   若该场景所属章的所有场景都已完成 → 触发章摘要更新
  │
  ▼
③ 裁剪（Trim）
   从 L1 移除已物化场景的原文
   保留：摘要 + 事实卡片指针 + 资产版本号
  │
  ▼
④ 恢复（Recover）——后续生成遇到细节需求
   通过 RAG 混合检索从 L3 取回细节（见 §8）
```

**关键点**：compact 发生时正文其实早已入库（第 6 节第 7 步每次场景都做），所以 compact 的真正职责是**把"上下文里可引用的细节"换成"可检索的指针"**——丢失的是"顺手的引用"，不是"细节本身"。

### 7.3 摘要树的滚动维护

```
场景完成 → 场景摘要
场景摘要累计满 N 个 → 触发章摘要重写（输入：本章全部场景摘要 + 旧章摘要）
章摘要累计满 N 个   → 触发卷摘要重写（输入：本章全部章摘要 + 旧卷摘要）
```

摘要树是"倒金字塔"，生成任意层级内容时都能以最小 token 拿到"这层发生了什么"。

---

## 8. 知识库 RAG 与主动检索

### 8.1 入库（写入侧）

| 数据 | 去向 | 形式 |
|---|---|---|
| 正文 | content_chunks + chunk_vec + chunk_fts | 512-token 重叠分块（重叠 64） |
| 原子事实 | fact_cards | 结构化行 + entities 索引 |
| 资产状态 | assets + asset_states | 版本化 JSON |
| 时间线 | timeline（asset 特例） | 结构化行 |

### 8.2 检索（读取侧）——三层触发

| 触发 | 时机 | 方式 | 可靠性 |
|---|---|---|---|
| **实体直查** | 每次生成前 | 场景大纲 `characters/locations` → 资产表核心属性 + 相关事实卡片 | 确定性 100% |
| **语义预检索** | 每次生成前 | 场景大纲+摘要 → 混合检索（向量+FTS5+实体过滤，RRF 融合）Top-6 | 高 |
| **校验补检索** | 生成后 | 校验 pass 发现缺失/矛盾 → 补检索 → 局部重写 | 兜底 |

**设计意图**：实体直查把"该场景必然涉及的细节"变成硬保证；语义预检索把"可能相关的历史"带回来；校验补检索兜住前两者漏掉的。三者叠加后，"语焉不详"的场景基本不会发生——因为生成前上下文已经把该有的细节都装进去了。

### 8.3 混合检索实现

```
score = RRF(vector_rank) + RRF(fts_rank) + 实体命中加权
取 Top-N（默认 6，按 token 预算浮动）
```

- 向量：语义相似（"那个戴面具的人"→找到面具人相关段落）；
- FTS5：专名精确（"沈砚""残卷"），弥补向量对专名/数字/新词的弱点；
- 实体过滤：结构化直查，零误差，优先注入。

---

## 9. 资产系统详解

### 9.1 资产类型

| 类型 | 示例核心属性（core，进 prompt） | 示例扩展属性（extended，按需） |
|---|---|---|
| character 人物 | 姓名/身份/一句话性格/当前目标/当前状态（伤势、位置） | 外貌全描/生平/能力清单/关系网/黑历史/口头禅 |
| location 地点 | 名称/类型/关键特征一句话 | 布局图/历史/隐藏秘密/常驻人物 |
| item 物品 | 名称/归属/当前状态 | 来历/能力细则/限制条件 |
| organization 组织 | 名称/宗旨/实力层级 | 成员列表/历史/内部派系/据点 |
| setting 设定 | 规则名/一句话规则 | 细则/例外/边界案例 |

> **核心属性必须"小而稳"**：控制在每条 50~100 token，全部实体核心属性合计 ~2K token 预算（见 §6 ④）。高频属性（状态/位置/目标）放 core，低频细节放 extended——这就是"常用的相关属性能够快速查阅"的落地：**core 是常驻缓存，extended 是按需加载，asset_states 是历史版本**。

### 9.2 写回与版本化（资产"活"起来的关键）

```
场景生成完成
  → 资产更新 pass：输入新正文 + 涉及的资产旧状态
  → 输出变更 JSON：
    {
      "林晚": {
        "state": {"hp": "左臂受伤(第2章), 已简单包扎", "location": "图书馆地下密室"},
        "relations": [{"to": "沈砚", "type": "敌对", "note": "首次正面冲突"}]
      },
      "残卷": {"state": {"holder": "林晚"}}
    }
  → 写入 asset_states(version+1)，更新 assets.core/extended
  → 冲突检测：与既有状态矛盾（如"左臂已痊愈"）→ 报 conflicts
```

**时间旅行查询**：`WHERE asset_id=? AND version <= N ORDER BY version DESC LIMIT 1`——"写第 30 章时，林晚在第 20 章是什么状态"直接可查。

### 9.3 资产索引与快速查阅

- 资产库面板：按类型分组 + 全文搜索 + 关联关系图（asset_relations 渲染）；
- 生成时的查阅：场景大纲实体清单 → 一次 SQL 批量取回 core 属性（毫秒级）；
- 人物关系图：从 asset_relations 生成，创作时可视化"这场戏谁和谁什么关系"。

---

## 10. 一致性保障与伏笔管理

### 10.1 三层防线

```
预防层：上下文组装器保证生成前细节齐备（§6）
检测层：校验 pass 每场景比对"新事实 vs 资产/事实卡片"（§4.3-5）
处置层：
  - 无冲突 → 放行
  - 轻微矛盾 → 自动局部重写（≤2 次，重写后重新校验）
  - 结构性矛盾（人物死亡/重大设定推翻）→ 报 conflicts，人工裁决
```

冲突示例：
- `contradiction`："沈砚第5章说不知道残卷下落" vs 新正文"沈砚拿出残卷"；
- `timeline_issue`："第3天晚上" 同时出现在图书馆和码头；
- `loose_thread`：校验时发现某伏笔已超过预计回收章 N 章未处理（与伏笔台账联动）。

### 10.2 伏笔台账（Plot Device）

```
埋设：场景生成元数据 foreshadowing_ops → plot_devices(status=planted)
     记录：类型/描述/埋设场景/预计回收条件/关联实体
发展：后续场景提到 → status=developing
回收：正文揭晓 → status=paid_off
遗忘：超过预计回收章仍未处理 → 前端"烂尾风险"提醒（status=forgotten）
```

生成时的注入（§6 ⑧）：每个场景 prompt 都带"当前待回收伏笔清单"，防止作者/模型写忘了坑；卷大纲生成时也注入——保证每卷结尾至少回收或推进一个伏笔。

---

## 11. 技术选型与工程结构

### 11.1 选型表

| 层 | 选型 | 理由 |
|---|---|---|
| 前端 | React 18 + Vite + TypeScript | 轻量、本地工具不需要 SSR |
| UI | TailwindCSS + Radix UI | 快速迭代，创作台需要密集交互 |
| 富文本 | TipTap（ProseMirror） | 正文编辑、场景标注（事实/资产高亮） |
| 后端 | Fastify（Node/TS） | 高性能、插件化、类型友好 |
| 数据库 | better-sqlite3 + sqlite-vec + FTS5 | 单文件、零部署、向量同库、事务一致 |
| LLM 网关 | 自研抽象层（见下） | 模型可切换、可分级 |
| 正文生成模型 | DeepSeek-V3 / GPT-4o | 长文质量 |
| 提取/校验/摘要模型 | DeepSeek-chat / GPT-4o-mini | 便宜、够用 |
| Embedding | BGE-M3（硅基流动 API 或 Ollama 本地）| 中文效果好；**注意 DeepSeek 官方无 embedding 接口** |
| 热点调研 | Tavily Search API（或 SerpAPI） | 结构化搜索结果 |
| 任务队列 | 进程内队列 + SSE 进度推送 | 场景生成是 5~7 pass 长任务 |
| 导出 | markdown 直出 + pandoc 转 EPUB/DOCX | 通用、零依赖（pandoc 可选） |

### 11.2 LLM 网关设计

```ts
interface LlmGateway {
  generate(req: GenerateRequest): AsyncIterable<Chunk>;   // 流式
  extract(req: ExtractRequest): Promise<StructuredResult>; // JSON 模式
  embed(texts: string[]): Promise<number[][]>;
}

// 模型分级配置（可热更新）
const tierConfig = {
  generate: { provider: 'deepseek', model: 'deepseek-chat' },
  extract:  { provider: 'deepseek', model: 'deepseek-chat' },
  embed:    { provider: 'siliconflow', model: 'BAAI/bge-m3' },
};
```

所有模块只依赖接口，不依赖具体厂商——换模型、加本地 Ollama 都是配置级改动。

### 11.3 目录结构

```
read-assistant/
├── docs/
├── data/                      # 每项目一个 .db + 导出目录（gitignore）
├── src/
│   ├── shared/                # 前后端共享类型（assets/outline/scene 等）
│   ├── server/
│   │   ├── index.ts           # Fastify 入口
│   │   ├── db/                # schema + migrations + repositories
│   │   ├── llm/               # LlmGateway 实现（deepseek/openai/siliconflow）
│   │   ├── modules/
│   │   │   ├── research/      # 题材调研
│   │   │   ├── outline/       # 大纲分层生成
│   │   │   ├── writing/       # 创作引擎流水线（contextAssembler + passes）
│   │   │   ├── memory/        # 三级记忆 + compact
│   │   │   ├── knowledge/     # chunk 入库 + 混合检索 RAG
│   │   │   ├── assets/        # 资产 CRUD + 版本化 + 更新 pass
│   │   │   ├── consistency/   # 校验 + 冲突处理
│   │   │   ├── plotdevices/   # 伏笔台账
│   │   │   └── export/        # MD/EPUB 导出
│   │   └── routes/
│   └── client/
│       ├── pages/             # 调研 / 大纲 / 创作台 / 资产库 / 时间线 / 冲突台
│       └── components/
└── package.json
```

---

## 12. 成本与性能预算

### 12.1 单场景 token 消耗（估算）

| Pass | 输入 | 输出 |
|---|---|---|
| 正文生成 | ~16K | ~4K |
| 资产更新 | ~5K | ~1K |
| 事实提取 | ~5K | ~1K |
| 一致性校验 | ~6K | ~0.5K |
| 摘要 | ~3K | ~0.3K |
| **合计** | **~35K** | **~6.8K** |

按 DeepSeek 官方价（输入约 ¥1/M、输出约 ¥2/M 量级）估算，**单场景成本约 ¥0.05 左右**，一部 50 万字小说（约 300 场景）总成本约 **¥15~20**。成本可控，不需要特殊优化；但如果用 GPT-4o 级生成模型，成本约为 5~10 倍，需注意模型分级配置。

### 12.2 性能

- 检索：混合检索单次 <100ms（SQLite 本地，数据量万级 chunk 无压力）；
- 生成：单场景 5~7 pass 串行约 1~3 分钟 → **SSE 进度条必须做**（显示"正在生成正文 / 更新资产 / 校验一致性…"）；
- 后处理 pass 相互独立的部分可并行（资产更新 + 事实提取可并行）。

---

## 13. 实施路线图

```
Phase 0：工程骨架（1~2 天）
  Fastify + React 壳 + better-sqlite3 + schema 迁移 + LLM 网关 + 模型配置

Phase 1：调研 → 大纲（2~3 天）
  题材调研（Tavily + 分析 pass）→ 核心创意 → 世界观/人物/卷章大纲
  资产 CRUD + 资产库面板 + 大纲编辑器（树形、可编辑、可确认）

Phase 2：核心创作流水线（3~5 天）★ 最重要
  上下文组装器 → 正文生成（SSE 流式）→ 资产更新 pass → 摘要 pass → 分块入库
  创作工作台（场景列表 + 编辑器 + 重新生成 + 元数据展示）

Phase 3：记忆闭环（2~3 天）
  compact（物化+摘要+裁剪）→ 摘要树滚动维护 → RAG 混合检索 → 三层主动检索接入

Phase 4：质量闭环（2~3 天）
  一致性校验 + 冲突台（人工裁决 UI）→ 伏笔台账 → 事实卡片面板 → 导出（MD/EPUB）

MVP 判定线：Phase 2 完成即"能用的创作工具"；Phase 3 完成即"长篇不崩"；
Phase 4 完成即"完整产品"。
```

---

## 14. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| **DeepSeek 官方无 embedding API** | RAG 无法落地 | embedding 走硅基流动 BGE-M3 或本地 Ollama，网关层已抽象，切换是配置级 |
| 生成质量不稳定（尤其长文后期） | 烂尾/崩人设 | 大纲质量决定上限：每层人机确认；校验 pass 持续兜底 |
| 上下文组装超预算 | 生成失败/降质 | 明确 token 预算分层 + 逆优先级裁剪（§6 ⑨） |
| 资产更新纪律崩溃（跳过写回） | 资产过期 → 连锁矛盾 | 资产更新 pass 是流水线硬步骤，不可跳过；冲突检测兜底 |
| 热点调研版权风险 | 法律风险 | 只采集榜单标题/简介做统计，不抓取正文，不做逐字模仿 |
| 成本失控（用户切 GPT-4o） | 单场景成本 ×10 | 默认 DeepSeek 分级；成本面板展示每场景 token/费用 |
| 本地单文件 DB 损坏 | 数据丢失 | data/ 目录整体备份 + 每场景写入后事务提交；可选自动快照 |

---

## 附：对你原设计的最终结论

你的四点设计全部成立，本文档在此基础上做了三处关键增强：

1. **compact 从"有损压缩"改为"物化 + 压缩 + 可检索"**——细节的物理保证是 L3 知识库（事实卡片/资产版本/chunk），而不是摘要文本；
2. **主动搜索从"凭感觉"改为三层确定性触发**——场景大纲自带实体清单，实体直查是免费且 100% 可靠的；语义检索和校验补检索做增强与兜底；
3. **资产从"只读索引"改为"版本化 + 写回"的活系统**——每个场景结束后资产自动更新，支持时间旅行查询，并新增了伏笔台账这一长篇创作刚需模块。
