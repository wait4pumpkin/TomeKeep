# TomeKeep

<p align="center">
  <a href="https://github.com/wait4pumpkin/TomeKeep/actions/workflows/deploy-web.yml">
    <img src="https://github.com/wait4pumpkin/TomeKeep/actions/workflows/deploy-web.yml/badge.svg" alt="Deploy Web">
  </a>
  <a href="https://github.com/wait4pumpkin/TomeKeep/actions/workflows/release-desktop.yml">
    <img src="https://github.com/wait4pumpkin/TomeKeep/actions/workflows/release-desktop.yml/badge.svg" alt="Release Desktop">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License">
  </a>
</p>

<p align="center">
  <strong>个人藏书管理工具 · Personal Book Inventory Manager</strong><br>
  桌面客户端 + Web PWA，本地优先，云端同步<br>
  Desktop + Web PWA · Local-first with optional cloud sync
</p>

---

## 简介 / Introduction

**中文**

TomeKeep 是一款面向书籍爱好者的桌面应用，帮助你管理个人藏书、维护愿望清单，并自动比较各大电商平台的价格。数据默认存储在本地，通过 Cloudflare D1 + R2 实现可选的云端同步，并配套一个 PWA 网页端供移动设备访问。

**English**

TomeKeep is a desktop application for book lovers to catalog their personal library, track wishlists, and automatically compare prices across major online retailers. Data is stored locally by default, with optional cloud sync powered by Cloudflare D1 + R2, and a companion PWA for mobile access.

---

## 功能 / Features

| 功能 | Description |
|---|---|
| 书库管理 | 按 ISBN 添加书籍，自动获取豆瓣 / OpenLibrary 元数据 | Inventory management with auto metadata fetch |
| 愿望清单 | 维护想买书单，一键移入书库 | Wishlist with one-click move to inventory |
| 价格比较 | 自动抓取京东 / 当当 / 中国图书网价格 | Auto price comparison across JD / Dangdang / BooksChina |
| 手机扫码 | 局域网 HTTPS 伴侣服务器，手机扫条码直接录入 | LAN companion server for mobile barcode scanning |
| 多用户档案 | 支持多个家庭成员各自独立的阅读状态 | Multiple profiles with independent reading states |
| 云同步 | 可选 Cloudflare Pages + D1 + R2 云端同步 | Optional cloud sync via Cloudflare Pages + D1 + R2 |
| PWA | 网页端支持离线访问 | Offline-capable PWA at [books.cbbnews.top](https://books.cbbnews.top) |

---

## 技术栈 / Tech Stack

| 层 / Layer | 技术 / Technology |
|---|---|
| 桌面框架 Desktop | Electron 41 |
| UI | React 19 + Vite 6 + TypeScript |
| 样式 Styling | Tailwind CSS v4 |
| 本地存储 Local DB | lowdb (JSON file) |
| 云数据库 Cloud DB | Cloudflare D1 (SQLite at edge) |
| 云存储 Cloud Storage | Cloudflare R2 (book covers) |
| Web API | Hono 4 on Cloudflare Pages Functions |
| 桌面打包 Packaging | electron-builder |
| 包管理 Package Manager | pnpm (monorepo) |

---

## 仓库结构 / Repository Structure

```
TomeKeep/
├── packages/
│   ├── desktop/     # Electron 桌面客户端 / Electron desktop client
│   ├── web/         # Cloudflare Pages PWA + Hono API
│   └── shared/      # 两端共享的 TypeScript 工具库 / Shared TypeScript utilities
├── docs/            # 产品规格、架构、API 文档 / Specs, architecture, API docs
└── scripts/         # 一次性工具脚本（数据迁移等）/ Utility scripts (migration etc.)
```

---

## 快速开始 / Getting Started

### 环境要求 / Prerequisites

- Node.js v22+
- pnpm v10+
- （Web 端 / Web only）Cloudflare 账号 + Wrangler CLI

### 本地开发 / Local Development

```bash
# 克隆仓库 / Clone the repo
git clone https://github.com/wait4pumpkin/TomeKeep.git
cd TomeKeep

# 安装依赖 / Install dependencies
pnpm install

# 仅启动桌面端 / Start desktop only
pnpm dev

# 同时启动桌面端 + Web 端 / Start desktop + web (includes Wrangler dev server)
pnpm dev:full
```

### 构建桌面版 / Build Desktop

```bash
pnpm electron:build
# 输出 / Output: packages/desktop/release/TomeKeep-*.dmg
```

> **注意 / Note**：构建产物未经过 Apple 代码签名。macOS 用户首次打开时需要右键 → 打开 绕过 Gatekeeper。
> Build artifacts are unsigned. On macOS, right-click → Open to bypass Gatekeeper on first launch.

### Web 端部署 / Web Deployment

Web 端通过 Cloudflare Pages + D1 + R2 部署。推送到 `main` 分支后 GitHub Actions 自动完成部署。

首次部署需手动完成以下步骤 / First-time setup requires these manual steps:

```bash
# 1. 创建 D1 数据库（记录 database_id 并填入 packages/web/wrangler.toml）
#    Create D1 database (copy the database_id into packages/web/wrangler.toml)
pnpm wrangler d1 create tomekeep-db

# 2. 创建 R2 存储桶 / Create R2 bucket
pnpm wrangler r2 bucket create tomekeep-covers

# 3. 运行数据库迁移 / Apply database migrations
cd packages/web
pnpm wrangler d1 migrations apply tomekeep-db --remote

# 4. 配置 Secrets / Set secrets
pnpm wrangler secret put JWT_SECRET
pnpm wrangler secret put ADMIN_SETUP_TOKEN

# 5. 创建管理员账号 / Bootstrap admin account
#    （替换 YOUR_TOKEN 为你设置的 ADMIN_SETUP_TOKEN / replace YOUR_TOKEN）
curl -X POST https://books.cbbnews.top/api/auth/admin-setup \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-password","name":"管理员"}'
```

GitHub Actions 需在仓库 **Settings → Secrets → Actions** 中配置 / GitHub Actions requires these repository secrets:

| Secret | 说明 / Description |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 具有 Pages Edit + D1 Edit 权限 / Needs Cloudflare Pages Edit + D1 Edit permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 控制台 Account ID / Found in Cloudflare dashboard sidebar |

---

## CI/CD

| 触发 / Trigger | 动作 / Action |
|---|---|
| Push 到 `main` | 构建 Web，运行 D1 迁移，部署到 Cloudflare Pages |
| Push `v*.*.*` Tag | 构建 macOS .dmg / .zip，发布到 GitHub Releases |

---

## 文档 / Documentation

- [架构说明 / Architecture](ARCHITECTURE.md)
- [API 接口文档 / API Surface](docs/generated/api-surface.md)
- [Web API 路由表 / Routes Map](docs/generated/routes-map.md)
- [产品规格 / Product Specs](docs/product-specs/)
- [工程规范 / Engineering Standards](docs/standards/)

---

## 贡献 / Contributing

欢迎 PR 和 Issue！详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## 安全 / Security

如发现安全漏洞，请**不要**公开 Issue，详见 [SECURITY.md](SECURITY.md)。

Please **do not** open public issues for security vulnerabilities. See [SECURITY.md](SECURITY.md).

---

## 许可证 / License

[MIT](LICENSE) © 2026 TomeKeep Contributors
