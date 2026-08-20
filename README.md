<div align="center">

# 📖 Author AI Assistant

### 你的 AI 长篇小说创作助手 —— 人物不崩、设定不崩、伏笔不漏

一个本地运行的 AI 小说创作工具，覆盖从「今天写什么题材」到「成书导出」的全流程，核心解决长篇小说最大的痛点：**长篇一致性**。

![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6?logo=typescript&logoColor=white)
![Node](https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&logoColor=white)
![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-单文件-003b57?logo=sqlite&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)

[功能特性](#-功能特性) · [快速开始](#-快速开始) · [创作流程](#-创作流程) · [技术架构](#-技术架构) · [路线图](#-路线图)

</div>

---

## ✨ 功能特性

### 🧭 调研驱动创作
- 热点题材/流派调研 → 差异化蓝海建议 → 黄金三章要素清单
- 结构化调研报告：热度榜单 / 读者画像 / 核心爽点 / 推荐题材方向

### 🗂️ 自顶向下大纲
- 核心创意 → 世界观 → 主线梗概 → 人物小传 → 卷 → 章 → 场景，七层逐级约束生成
- **增量生成**：按「目标 − 已有」只补充缺失部分，同名资产自动去重，不重复生成
- **人机协同**：每层可人工编辑、确认，或按你的意见一键重新生成单个节点

### ✍️ 场景级创作流水线
- 一次场景生成 = 5~7 个 LLM pass 的流水线（正文 → 资产更新 → 事实提取 → 一致性校验 → 摘要 → 向量入库），SSE 实时推送进度
- 上下文组装器按 token 预算分层注入：大纲、实体核心属性、摘要树、RAG 检索结果、待回收伏笔

### 🧠 三级记忆 + 知识库 RAG（长篇不崩的关键）
- **L1 工作记忆**：当前场景上下文（~16K tokens，写满触发 compact）
- **L2 摘要树**：场景 → 章 → 卷逐级压缩，永远不超预算
- **L3 长期知识库**：全文 chunk 向量化（sqlite-vec + FTS5）永不删除
- **Compact 物化优先**：压缩前先提取事实卡片 / 资产状态 / 伏笔操作入库，细节物理存在，不是"压缩丢细节"

### 🎭 资产系统（会"活"的设定库）
- 人物 / 地点 / 物品 / 组织 / 设定五类资产，core（常驻 prompt）与 extended（按需检索）分级
- 每场景结束自动写回资产状态，**版本化 + 时间旅行**：随时可查"第 30 章时林晚是什么状态"
- 资产带 **batch_label 批次标记**，可辨识哪批生成

### 🧩 质量闭环
- 一致性校验：矛盾 / 时间线问题 / 伏笔遗忘检测，自动修复或转人工裁决
- 伏笔台账：埋设 → 发展 → 回收全生命周期跟踪，防烂尾
- 事实卡片：原子事实去重，防前后矛盾
- 导出：Markdown / EPUB / DOCX（pandoc）

### 🔌 模型自由切换
- 正文/提取：DeepSeek / MiniMax / OpenAI / Ollama 本地 / Mock
- Embedding：硅基流动 BGE-M3 / Ollama 本地
- 全部 LLM 提示词**可在线编辑**，保存即热生效

---

## 🚀 快速开始

### 环境要求

- Node.js ≥ 22
- 一个 LLM 的 API Key（DeepSeek / MiniMax / OpenAI / 硅基流动）或本地 Ollama
- （可选）pandoc，用于 EPUB / DOCX 导出

### 安装

```bash
git clone https://github.com/QinzYee/author-ai-assistant.git
cd author-ai-assistant
npm install
```

### 配置

复制 `.env.example` 为 `.env` 并填入密钥：

```bash
cp .env.example .env
```

```dotenv
# 必填：正文生成 / 提取（DeepSeek，OpenAI 兼容）
DEEPSEEK_API_KEY=sk-xxxx

# 推荐：Embedding（硅基流动 BGE-M3；DeepSeek 官方无 embedding 接口）
SILICONFLOW_API_KEY=sk-xxxx

# 可选：本地 Ollama（零成本）
# GATEWAY_MODE=mock   # 不想配 Key 时，用确定性假数据跑通全链路
```

> 没有 API Key？把 `.env` 里 `GATEWAY_MODE=mock` 打开，即可用假数据体验完整流程。

### 启动

```bash
# 开发模式（后端 + 前端 Vite 热更新）
npm run dev

# 生产模式
npm run build
npm start
```

打开 http://127.0.0.1:3000 即可使用。

### 常用命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 开发模式（server + client 并行） |
| `npm run build` | 构建生产产物（server + client） |
| `npm start` | 生产模式启动 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run db:migrate` | 数据库迁移 |

---

## 📚 创作流程

```
① 新建项目 → 题材调研 → 选定方向
② 大纲七层生成：创意 → 世界观 → 梗概 → 人物 → 卷 → 章 → 场景
   （每层可人工确认 / 按意见重新生成）
③ 选一个场景 → 一键生成正文（流水线自动更新资产/事实/摘要/向量）
④ 一致性校验 + 冲突台裁决 + 伏笔台账跟踪
⑤ 全部写完 → 导出 MD / EPUB / DOCX
```

**人机协同原则**：AI 生成，人类裁决。关键节点（题材、大纲、人物设定、矛盾处理）都保留人工确认检查点——不追求"全自动写完整本书"。

---

## 🏗️ 技术架构

```
Web UI (React + Vite)
   │  REST + SSE（生成进度流）
Backend (Fastify, Node/TS)
   ├── 调研模块 ── 大纲模块 ── 创作引擎（核心流水线）
   ├── 记忆管理器（三级 + compact）── 上下文组装器
   ├── 知识库 RAG（向量 + FTS5 + 实体过滤，RRF 融合）
   ├── 资产管理器 ── 伏笔台账 ── 一致性校验
   └── LLM 网关（模型抽象层，可切换/分级）
        │
SQLite（单文件，零部署）
   better-sqlite3 + sqlite-vec + FTS5
   资产 / 大纲树 / 正文 / 摘要树 / 事实卡片 / 伏笔 / 冲突 / 向量
```

**设计要点**

- **单进程、单文件数据库**：备份 = 拷贝一个文件
- **向量检索与结构化数据同库同事务**：不需要单独部署向量数据库
- **LLM 网关统一抽象**：所有模块只面向 `LlmGateway` 接口，换模型是配置级改动
- **场景是创作的最小单元**：场景结束时的状态是确定的，可干净写入资产和历史

### 目录结构

```
author-ai-assistant/
├── docs/                    # 架构设计文档
├── data/                    # 每项目一个 .db（gitignore）
├── src/
│   ├── shared/              # 前后端共享类型
│   ├── server/
│   │   ├── index.ts         # Fastify 入口
│   │   ├── db/              # schema + 迁移 + repositories
│   │   ├── llm/             # LLM 网关（deepseek/openai/ollama/siliconflow）
│   │   ├── modules/
│   │   │   ├── research/    # 题材调研
│   │   │   ├── outline/     # 大纲分层生成（增量 + 批次）
│   │   │   ├── writing/     # 创作引擎流水线
│   │   │   ├── memory/      # 三级记忆 + compact
│   │   │   ├── knowledge/   # chunk 入库 + RAG
│   │   │   ├── assets/      # 资产 CRUD + 版本化
│   │   │   ├── prompts/     # 提示词管理（可在线编辑）
│   │   │   ├── consistency/ # 校验 + 冲突
│   │   │   ├── plotdevices/ # 伏笔台账
│   │   │   └── export/      # MD/EPUB/DOCX
│   │   └── routes/
│   └── client/
│       └── pages/           # 调研 / 大纲 / 创作台 / 资产库 / 时间线 / 冲突台
└── package.json
```

> 完整设计文档见 [`docs/architecture-design.md`](docs/architecture-design.md)

---

## 🗺️ 路线图

- [x] **Phase 0** 工程骨架（Fastify + SQLite + LLM 网关 + React 壳）
- [x] **Phase 1** 调研 → 大纲（资产系统 + 分层生成 + 题材调研）
- [x] **Phase 2** 核心创作流水线（★ 能用的创作工具）
- [x] **Phase 3** 记忆闭环（compact 物化 + 摘要树 + RAG）
- [x] **Phase 4** 质量闭环（一致性校验 + 冲突台 + 伏笔台账 + 事实卡片 + 导出）
- [x] **增强** 模型自由切换 + 提示词在线编辑 + 大纲增量/批次生成

**MVP 判定线**：Phase 2 完成即"能用的创作工具"；Phase 3 完成即"长篇不崩"；Phase 4 完成即"完整产品"。

---

## 🤝 参与贡献

欢迎 Issue 和 PR！

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feat/my-feature`
3. 提交改动：`git commit -m 'feat: 新增 xxx'`
4. 推送：`git push origin feat/my-feature`
5. 提交 Pull Request

## 📄 License

[MIT](LICENSE)

---

<div align="center">

**如果这个项目对你有帮助，欢迎 ⭐ Star 支持！**

</div>