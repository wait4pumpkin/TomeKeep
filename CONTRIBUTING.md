# 贡献指南 / Contributing Guide

感谢你对 TomeKeep 的关注！本文档说明如何参与贡献。

Thank you for your interest in TomeKeep! This document explains how to contribute.

---

## 目录 / Table of Contents

- [行为准则 / Code of Conduct](#行为准则--code-of-conduct)
- [开发环境 / Development Setup](#开发环境--development-setup)
- [分支策略 / Branch Strategy](#分支策略--branch-strategy)
- [提交规范 / Commit Convention](#提交规范--commit-convention)
- [Pull Request 流程 / PR Process](#pull-request-流程--pr-process)
- [代码风格 / Code Style](#代码风格--code-style)
- [测试 / Testing](#测试--testing)

---

## 行为准则 / Code of Conduct

参与本项目即表示你同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

By participating, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## 开发环境 / Development Setup

### 依赖要求 / Requirements

- **Node.js** v22+
- **pnpm** v10+（`npm install -g pnpm`）
- **macOS**（桌面端构建仅支持 macOS / Desktop build requires macOS）
- （可选 / Optional）Cloudflare 账号 + Wrangler CLI（Web 端开发）

### 安装步骤 / Setup

```bash
# 克隆仓库 / Clone
git clone https://github.com/wait4pumpkin/TomeKeep.git
cd TomeKeep

# 安装所有包的依赖 / Install all workspace dependencies
pnpm install

# 启动桌面开发服务器 / Start desktop dev server
pnpm dev

# 同时启动桌面 + Web 开发服务器 / Start desktop + web dev servers
pnpm dev:full
```

### Web 端本地开发 / Web Local Development

Web 端需要 Wrangler 本地模拟 Cloudflare Pages 环境：

```bash
cd packages/web

# 复制并填写本地开发变量
cp .dev.vars.example .dev.vars   # 如果没有此文件，手动创建
# 填入 JWT_SECRET 和 ADMIN_SETUP_TOKEN

pnpm dev   # 启动 Vite (5173) + Wrangler Pages (8788)
```

---

## 分支策略 / Branch Strategy

| 分支 / Branch | 用途 / Purpose |
|---|---|
| `main` | 生产代码，Push 触发 Cloudflare Pages 部署 |
| `feature/<name>` | 新功能开发 |
| `fix/<name>` | Bug 修复 |
| `docs/<name>` | 文档更新 |

**不要直接向 `main` 提交代码。** 请从 `main` 创建功能分支，完成后提 PR。

Please **do not push directly to `main`**. Create a feature branch from `main` and open a PR.

---

## 提交规范 / Commit Convention

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

[optional body]
```

**类型 / Types**：

| 类型 | 含义 |
|---|---|
| `feat` | 新功能 / New feature |
| `fix` | Bug 修复 / Bug fix |
| `docs` | 文档更新 / Documentation |
| `refactor` | 重构（不影响功能）/ Refactor |
| `test` | 测试 / Tests |
| `chore` | 构建、依赖等 / Build, deps, tooling |

**示例 / Examples**：

```
feat(desktop): add batch ISBN import from clipboard
fix(web): handle D1 connection timeout in books route
docs: update deployment steps in README
```

---

## Pull Request 流程 / PR Process

1. Fork 仓库（如果你没有写权限）
2. 从 `main` 创建功能分支：`git checkout -b feature/my-feature`
3. 完成改动，确保通过以下检查：
   ```bash
   pnpm lint      # ESLint
   pnpm test      # Vitest（desktop + shared）
   pnpm build     # 确认构建无报错
   ```
4. 提交并推送分支
5. 在 GitHub 上开 PR，标题遵循提交规范，描述中说明：
   - 做了什么改动
   - 为什么这样做
   - 如何测试

**PR 合并条件 / Merge requirements**：
- CI 全部通过（lint + test + build）
- 至少一名 maintainer 审批

---

## 代码风格 / Code Style

- **TypeScript**：全量类型，避免 `any`
- **React**：函数组件 + Hooks，禁止 class 组件
- **IPC 边界**：renderer 只能通过 `window.*` preload API 访问 Node.js，禁止直接 `require` 或访问 `file://`
- **`src/lib/`**：纯函数，禁止 IPC 调用或 side effects
- **格式化**：使用 ESLint 配置，推荐配合 VSCode ESLint 插件

---

## 测试 / Testing

```bash
# 运行全部测试
pnpm test

# 仅运行桌面端测试
pnpm --filter @tomekeep/desktop test

# 仅运行 shared 测试
pnpm --filter @tomekeep/shared test
```

测试使用 [Vitest](https://vitest.dev/)。新功能请附带测试，Bug 修复请添加回归测试。

Tests use [Vitest](https://vitest.dev/). New features should include tests; bug fixes should add regression tests.

---

## 报告问题 / Reporting Issues

- **安全漏洞**：请参阅 [SECURITY.md](SECURITY.md)，**不要**公开 Issue
- **功能请求**：开 Issue，标题加 `[Feature]` 前缀
- **Bug 报告**：开 Issue，提供复现步骤、系统版本、日志截图
