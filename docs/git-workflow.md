# Git 分支工作流规范

> 版本：v1.0 ｜ 适用仓库：author-ai-assistant ｜ 更新：2026-08

本规范定义本项目的分支模型与发布流程，**所有成员必须遵循**。

---

## 1. 分支模型

```
main（生产/发布，稳定版）
  ↑ 仅接收 test 的合并，绝不直接提交
  ↑
test（验证/预发布，验收环境）
  ↑ 仅接收 feature 的合并，绝不允许直接改代码
  ↑
feature/*（开发分支，功能开发）
  ↑ 日常开发的唯一工作区，可自由提交
  ↑
你 fork 的仓库 / 本地分支
```

| 分支 | 用途 | 谁能改 | 生命周期 |
|---|---|---|---|
| `main` | 对外发布的稳定版本 | 仅合并者 | 常驻 |
| `test` | 功能验证/验收 | 仅合并者 | 常驻 |
| `feature/*` | 新功能/修复开发 | 开发人员 | 功能完成即合并进 test 后删除 |

---

## 2. 开发流程（Feature → Test → Main）

### 2.1 开发（feature）

```bash
# 基于最新 main 拉取新功能分支（命名：feature/<版本或功能名>）
git checkout main
git pull origin main
git checkout -b feature/my-feature
```

日常提交遵循 Conventional Commits：

```
feat: 新功能
fix: 修复
refactor: 重构
docs: 文档
chore: 杂项（构建/依赖）
test: 测试
```

### 2.2 合入 test（验证）

```bash
git checkout test
git pull origin test
git merge --no-ff feature/my-feature -m "merge: feature/my-feature → test"
git push origin test
```

合并后**必须**在 test 分支上完成验证（见第 3 节）。

### 2.3 合入 main（发布）

仅当 test 验证通过后，由负责人执行：

```bash
git checkout main
git pull origin main
git merge --no-ff test -m "release: test → main（<版本号或描述>）"
git push origin main
```

### 2.4 清理

功能分支合并进 test 并验证通过后，删除本地与远程分支：

```bash
git branch -d feature/my-feature
git push origin --delete feature/my-feature
```

---

## 3. 验收标准（test 放行条件）

合并到 main 前，test 分支必须全部满足：

- [ ] `npm run typecheck` 通过
- [ ] `npm run build` 通过
- [ ] 核心功能冒烟测试通过（`node scripts/smoke-*.mjs`）
- [ ] 关键路径人工验证：项目创建 → 大纲生成 → 场景创作 → 导出
- [ ] 无未解决的高优先级冲突（conflicts 表）

---

## 4. 紧急修复（Hotfix）

生产 bug 需要立即修复时：在 main 上拉 hotfix 分支，修完**先合 test 验证，再合 main**，流程与普通 feature 一致（禁止跳过 test 直接合 main）。

```bash
git checkout -b hotfix/critical-bug main
# 修复并提交
git checkout test && git merge --no-ff hotfix/critical-bug -m "merge: hotfix/critical-bug → test"
git push origin test
# 验证通过后
git checkout main && git merge --no-ff hotfix/critical-bug -m "release: hotfix/critical-bug → main"
git push origin main
```

---

## 5. 注意事项

- **禁止**直接向 `main` / `test` 提交代码，只能通过合并进入。
- 合并 test 使用 `--no-ff`，保留合并节点，便于回溯。
- 合并冲突：优先在 feature 分支解决并提交，再重新合并到 test。
- 网络环境无法直连 GitHub 时，通过本机代理推送（仅本次生效）：

  ```powershell
  git -c http.proxy=http://127.0.0.1:7897 push origin <分支>
  ```

- 提交前检查 `git status`，禁止将 `.env`、密钥、`data/` 数据库文件提交进仓库。

---

## 6. 常用命令速查

```powershell
# 查看全部分支
git branch -a

# 查看各分支最新提交
git log --oneline --all --graph -20

# 本地分支跟随远程
git checkout -b test origin/test

# 对比 test 与 main 差异
git log --oneline main..test

# 丢弃未提交改动（危险）
git checkout -- <文件>
```