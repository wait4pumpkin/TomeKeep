---
title: "Cross-Platform Sync"
status: active
created: 2026-04-02
owner: engineering
---

# 跨平台同步执行计划

## 1. 概述

### 1.1 目标

将 TomeKeep 从 macOS 单机应用扩展为支持多端同步的跨平台应用，优先覆盖 iOS，同时兼容所有现代浏览器，无需苹果开发者账号或 App Store 上架。

### 1.2 技术方案

| 层级 | 选型 | 理由 |
|------|------|------|
| 移动端形态 | PWA (Progressive Web App) | 无需苹果开发者账号；可添加到 iOS 主屏幕；复用现有 React 代码 |
| 前端框架 | Vite + React 19 + react-router v7 | 与现有桌面端完全同技术栈，代码复用率最高 |
| 后端框架 | Hono | 原生支持 Cloudflare Workers，零 Node.js 依赖，极小体积 (~14KB) |
| 数据库 | Cloudflare D1 (SQLite at edge) | 原生 Workers 绑定，5 GB 免费，标准 SQLite 可迁移 |
| 文件存储 | Cloudflare R2 | 出口流量完全免费，私有 bucket + 签名 URL 访问 |
| 认证 | 用户名 + 密码 + 邀请码注册，JWT 鉴权 | 轻量，无第三方依赖，适合 <10 人小范围使用 |
| 同步策略 | 智能同步（写后同步 + 焦点同步 + 下拉刷新） | 无需 WebSocket，书籍管理场景延迟可接受 |
| 部署 | Cloudflare Pages | 免费，全球 CDN，Pages Functions 自动识别 Hono |
| 代码管理 | Monorepo (pnpm workspaces) | 共享 src/lib/ 纯函数，避免代码重复 |

**为什么选 Hono 而非 Next.js**：见 [附录 A：框架选型分析](#附录-a框架选型分析)。

### 1.3 成本

| 服务 | 用途 | 免费额度 | 预计用量 |
|------|------|----------|---------|
| Cloudflare Pages | PWA 托管 + API | 无限制 | < 1% |
| Cloudflare D1 | 数据库 | 5 GB + 5M 行读/天 | < 0.1% |
| Cloudflare R2 | 封面图存储 | 10 GB + 出口免费 | < 1% |
| 域名（可选） | 自定义域名 | — | ~¥50/年（可用免费 .pages.dev） |

**总成本：0 元**（不含可选域名）

### 1.4 适用范围

- 用户规模：< 10 人，邀请码注册，非公开服务
- 主要场景：iOS Safari 添加到主屏幕使用

---

## 2. 架构设计

### 2.1 系统架构

```
+--------------------+          +-------------------------------------+
|   Electron App     |          |   Cloudflare Pages                  |
|   (Mac 桌面端)      |          |                                     |
|                    |          |   +-----------------------------+   |
|  lowdb (本地缓存)   |  REST    |   |  React SPA (PWA)            |   |
|  本地封面缓存       |<-------->|   |  Vite + react-router v7     |   |
|  桌面独有功能       |  HTTPS   |   |  + Service Worker           |   |
|  (价格比较/LLM/    |          |   |  + manifest.json            |   |
|   豆瓣 session)    |          |   +----------+------------------+   |
+--------------------+          |   +----------+------------------+   |
                                |   |  Hono API (Pages Functions) |   |
                                |   |  /api/auth/*                |   |
                                |   |  /api/books/*               |   |
                                |   |  /api/wishlist/*            |   |
                                |   |  /api/reading-states/*      |   |
                                |   |  /api/covers/*              |   |
                                |   |  /api/metadata/douban       |   |
                                |   |  /api/metadata/openlib      |   |
                                |   |  /api/prices/*              |   |
                                |   |  /api/sync/status           |   |
                                |   +------+----------+-----------+   |
                                +----------+----------+---------------+
                                           |          |
                                     +-----+----+ +---+-----+
                                     |  D1      | |   R2    |
                                     | (SQLite) | | (封面图) |
                                     +----------+ +---------+
```

### 2.2 Monorepo 代码组织

```
TomeKeep/                              <- workspace root
  package.json                         <- workspace 声明，根级脚本
  pnpm-workspace.yaml                  <- packages/* glob

  packages/
    shared/                            <- @tomekeep/shared
      package.json
      tsconfig.json
      src/
        types.ts                       <- 所有共享类型定义
        isbn.ts                        <- 迁自 src/lib/isbn.ts
        douban.ts                      <- 迁自 src/lib/douban.ts
        openLibrary.ts                 <- 迁自 src/lib/openLibrary.ts
        author.ts                      <- 迁自 src/lib/author.ts
        bookMetadataMerge.ts           <- 迁自 src/lib/bookMetadataMerge.ts
        pricing.ts                     <- 迁自 src/lib/pricing.ts
        isbnSearch.ts                  <- 迁自 src/lib/isbnSearch.ts
        hanzi.ts                       <- 迁自 src/lib/hanzi.ts
        i18n.ts                        <- 迁自 src/lib/i18n.ts
        tagColor.ts                    <- 迁自 src/lib/tagColor.ts
        theme.ts                       <- 迁自 src/lib/theme.ts
        weather.ts                     <- 迁自 src/lib/weather.ts
        index.ts                       <- 统一 re-export

    desktop/                           <- @tomekeep/desktop（现有代码迁入）
      package.json
      index.html
      vite.config.ts
      tsconfig.json
      tsconfig.node.json
      vitest.config.ts
      eslint.config.js
      electron/                        <- 主进程（原样保留）
        main.ts
        db.ts
        sync.ts                        <- 新增 Phase 3：与 API 同步层
        preload.ts
        metadata.ts
        covers.ts
        pricing.ts
        ollama.ts
        stores.ts
        companion-server.ts
        capture-preload.ts
        preloadPath.ts
      src/                             <- 渲染进程（原样保留，import 路径更新）
        main.tsx
        App.tsx
        App.css
        index.css
        pages/
        components/
        lib/                           <- 仅保留桌面端特有（coverOcr.ts）
      public/
      build/
      scripts/
        migrate-to-cloud.ts            <- 新增：一次性数据迁移脚本

    web/                               <- @tomekeep/web（新增）
      package.json
      vite.config.ts                   <- Vite + React + Tailwind + vite-plugin-pwa
      tsconfig.json
      wrangler.toml                    <- D1 + R2 bindings 配置

      src/                             <- React SPA（与桌面端结构高度一致）
        main.tsx
        App.tsx                        <- BrowserRouter
        index.css
        pages/
          Login.tsx                    <- 普通用户登录；拒绝 is_admin 账号
          Register.tsx                 <- 注册（?invite= 预填邀请码；注册成功直接登录）
          AdminLogin.tsx               <- 管理员登录（写入 tk_admin）
          Admin.tsx                    <- 邀请码管理（分页列表、生成、复制、分享、删除）
          Inventory.tsx                <- 大量复用桌面端 UI
          Wishlist.tsx
        components/
          Layout.tsx                   <- 普通用户 Shell（底部导航，无管理员入口）
          AdminLayout.tsx              <- 管理员独立 Shell（独立主题/语言/登出）
          BookCard.tsx
          AddFormCard.tsx
          IsbnScanner.tsx              <- Web Camera + ZXing
          PosterRecognizer.tsx         <- QR 码解码 + OCR 降级
          PriceDisplay.tsx             <- 只读价格展示 + 跳转
          PullToRefresh.tsx
          InstallPrompt.tsx            <- iOS 添加到主屏幕引导
        lib/
          api.ts                       <- fetch wrapper（替代 window.db IPC）
          auth.ts                      <- 双会话管理（tk_user / tk_admin）
          sync.ts                      <- 智能同步逻辑
          offlineQueue.ts              <- 离线写操作队列（IndexedDB）
          db-cache.ts                  <- IndexedDB 缓存层
        public/
          manifest.json
          icons/
            icon-192.png
            icon-512.png

      api/                             <- Hono 后端
        index.ts                       <- Hono app，注册所有路由
        routes/
          auth.ts
          books.ts
          wishlist.ts
          readingStates.ts
          covers.ts
          metadata.ts
          prices.ts
          sync.ts
        middleware/
          auth.ts                      <- JWT 验证中间件
        lib/
          db.ts                        <- D1 操作封装
          r2.ts                        <- R2 操作封装（上传/签名URL）
          password.ts                  <- 密码哈希（Web Crypto API）
          image.ts                     <- 图片压缩转 WebP

      functions/
        api/
          [[route]].ts                 <- Cloudflare Pages Functions 入口，挂载 Hono app
        [[catchall]].ts                <- SPA 回退路由代理（将非 /api/* 请求转发给 Vite）

      migrations/
        0001_initial_schema.sql        <- 初始表结构
        0002_add_admin.sql             <- ALTER TABLE users ADD COLUMN is_admin INTEGER

      public/
        _routes.json                   <- Pages Functions 路由规则（生产环境）
        favicon.svg
```

---

## 3. 数据库设计（Cloudflare D1 / SQLite）

### 3.1 表结构

```sql
-- 用户表
CREATE TABLE users (
  id            TEXT PRIMARY KEY,                      -- UUID v4
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,                         -- PBKDF2-SHA256 (Web Crypto)
  name          TEXT NOT NULL,
  language      TEXT NOT NULL DEFAULT 'zh',            -- zh | en
  ui_prefs      TEXT NOT NULL DEFAULT '{}',            -- JSON: 排序键、视图模式等
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 邀请码表
CREATE TABLE invite_codes (
  code        TEXT PRIMARY KEY,
  created_by  TEXT NOT NULL REFERENCES users(id),
  used_by     TEXT REFERENCES users(id),
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 书籍表
CREATE TABLE books (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  author      TEXT NOT NULL DEFAULT '',
  isbn        TEXT,
  publisher   TEXT,
  cover_key   TEXT,                                    -- R2 object key，非直接 URL
  detail_url  TEXT,
  tags        TEXT NOT NULL DEFAULT '[]',              -- JSON array
  added_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_books_owner   ON books(owner_id);
CREATE INDEX idx_books_updated ON books(updated_at);
CREATE INDEX idx_books_isbn    ON books(isbn);

-- 心愿单表
CREATE TABLE wishlist (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  author      TEXT NOT NULL DEFAULT '',
  isbn        TEXT,
  publisher   TEXT,
  cover_key   TEXT,
  detail_url  TEXT,
  tags        TEXT NOT NULL DEFAULT '[]',
  priority    TEXT NOT NULL DEFAULT 'medium',          -- high | medium | low
  pending_buy INTEGER NOT NULL DEFAULT 0,              -- boolean
  added_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_wishlist_owner   ON wishlist(owner_id);
CREATE INDEX idx_wishlist_updated ON wishlist(updated_at);

-- 阅读状态表
CREATE TABLE reading_states (
  user_id      TEXT NOT NULL REFERENCES users(id),
  book_id      TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'unread',         -- unread | reading | read
  completed_at TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, book_id)
);
CREATE INDEX idx_reading_states_updated ON reading_states(updated_at);

-- 价格缓存表（桌面端写入，PWA 端只读）
CREATE TABLE price_cache (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id),
  book_isbn   TEXT NOT NULL,
  channel     TEXT NOT NULL,                           -- jd | dangdang | bookschina
  status      TEXT NOT NULL,                           -- ok | not_found | error
  price_cny   REAL,
  url         TEXT,
  product_id  TEXT,
  source      TEXT DEFAULT 'auto',                     -- manual | auto
  fetched_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_price_isbn ON price_cache(book_isbn);
```

### 3.2 数据迁移（lowdb → D1）

提供一次性迁移脚本 `packages/desktop/scripts/migrate-to-cloud.ts`：

1. 读取本地 `{userData}/db.json`
2. 为无 `updated_at` 的记录补填 `addedAt` 值
3. 将本地封面图批量上传到 R2（`covers/{owner_id}/{id}.webp`）
4. 通过 API 批量写入 D1（分批，每批 100 条）
5. 输出迁移报告，验证数据完整性

---

## 4. API 设计

所有 API 路由前缀为 `/api`，需要 JWT 认证（除 `/api/auth/*`）。

### 4.1 认证 API

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| POST | `/api/auth/admin-setup` | 一次性（`ADMIN_SETUP_TOKEN`） | 创建唯一管理员账号；需 `Authorization: Bearer <ADMIN_SETUP_TOKEN>` header；已存在管理员时返回 409 |
| POST | `/api/auth/register` | 公开（需邀请码） | 注册普通用户；成功后设置 httpOnly cookie，直接登录 |
| POST | `/api/auth/login` | 公开 | 登录（返回 JWT via httpOnly cookie）；管理员账号可通过此端点登录 |
| POST | `/api/auth/logout` | 已登录 | 登出（清除 cookie） |
| GET  | `/api/auth/me` | 已登录 | 获取当前用户信息（含 `is_admin` 字段） |
| POST | `/api/auth/invite` | 管理员 | 生成邀请码（仅管理员可调用） |
| GET  | `/api/auth/invites` | 管理员 | 分页列出所有邀请码（10 条/页，含 `used_by` 用户名 JOIN）；`?page=1` |
| DELETE | `/api/auth/invites/:code` | 管理员 | 删除未使用的邀请码 |

**注册请求体**：
```json
{ "username": "alice", "password": "...", "name": "Alice", "inviteCode": "XXXX" }
```

**注册响应**：成功注册后与登录行为一致，设置 httpOnly cookie 并返回用户信息，无需二次登录。

**JWT 存储**：`httpOnly` cookie（PWA），Electron 侧使用 `Authorization: Bearer <token>` header。

**JWT Payload**：
```json
{ "sub": "<user-id>", "username": "alice", "is_admin": false, "iat": 0, "exp": 86400 }
```

**密码安全**：使用 PBKDF2-SHA256（Web Crypto API 原生支持，无需额外依赖，Workers 环境兼容）。

### 4.2 书籍 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET    | `/api/books?since=<ISO>` | 列表（支持增量，`since` 为上次同步时间） |
| POST   | `/api/books` | 创建 |
| PUT    | `/api/books/:id` | 更新（含 `updated_at` 冲突检测） |
| DELETE | `/api/books/:id` | 删除 |

所有写入操作自动更新 `updated_at`。

### 4.3 心愿单 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET    | `/api/wishlist?since=<ISO>` | 列表 |
| POST   | `/api/wishlist` | 创建 |
| PUT    | `/api/wishlist/:id` | 更新 |
| DELETE | `/api/wishlist/:id` | 删除 |
| POST   | `/api/wishlist/:id/move-to-inventory` | 心愿 → 书库（原子操作） |

### 4.4 阅读状态 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/reading-states?since=<ISO>` | 获取当前用户阅读状态 |
| PUT | `/api/reading-states` | Upsert 阅读状态 |

### 4.5 封面图 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/covers/upload` | 上传封面（multipart/form-data），压缩为 WebP 后存入 R2 |
| GET  | `/api/covers/:key` | 获取封面（验证归属 → 生成签名 URL → 302 重定向） |

**上传流程**：
1. 接收图片
2. 压缩 + 转 WebP（300px 宽缩略图）
3. 存入 R2：`covers/{owner_id}/{uuid}.webp`
4. 返回 `{ coverKey: "covers/..." }`

**访问安全**：R2 bucket 私有，所有访问通过签名 URL（有效期 1 小时），响应头 `Cache-Control: private, max-age=3600`。

### 4.6 元数据代理 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/metadata/douban` | 代理豆瓣页面，复用 `@tomekeep/shared/douban` 解析逻辑 |
| POST | `/api/metadata/openlib` | OpenLibrary 查询 |

**豆瓣代理请求体**：`{ "url": "https://book.douban.com/subject/12345/" }`

**响应**：`{ title, author, isbn, publisher, coverUrl, source: "douban" }`

**反爬注意**：服务端 fetch 豆瓣时携带合理 User-Agent；如遇封禁返回 `{ error: "blocked" }`，客户端降级提示。

### 4.7 价格数据 API（只读）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/prices/:isbn` | 获取某 ISBN 的价格缓存（按价格升序） |

PWA 端展示价格，每个渠道提供「去购买」按钮跳转到 `url` 字段的商品页。

### 4.8 同步状态 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/sync/status` | 返回各表最新 `updated_at`，用于客户端判断是否需要拉取 |

**响应示例**：
```json
{
  "books": "2026-04-01T10:00:00Z",
  "wishlist": "2026-04-01T09:00:00Z",
  "readingStates": "2026-03-30T15:00:00Z"
}
```

---

## 5. 同步策略

### 5.1 同步模型

采用 **Last-Write-Wins（LWW）** 策略，基于 `updated_at` 时间戳。<10 人场景下同一记录并发编辑概率极低，LWW 足够。

**写入流程**：
1. 本地缓存立即更新（UI 即时响应）
2. 设置 `updated_at = now()`
3. 异步 POST/PUT 到 `/api/*`
4. 失败 → 加入 `pendingQueue`（IndexedDB / lowdb）
5. 网络恢复 → 自动重放 `pendingQueue`

**读取流程（智能同步）触发时机**：
- a. 页面/App 初次加载
- b. `visibilitychange`（从后台唤醒，PWA）
- c. 用户主动下拉刷新
- d. 可选：前台活跃时每 60s 轮询一次

**执行步骤**：
1. `GET /api/sync/status` → 获取各表最新 `updated_at`
2. 与本地 cursor 比较，无差异则跳过
3. 有差异 → `GET /api/{table}?since={local_cursor}`
4. 合并：`updated_at` 较新者优先
5. 更新本地 cursor

### 5.2 桌面端同步（Electron）

- 新增 `electron/sync.ts`，负责与云端 API 通信
- lowdb schema 增加 `updatedAt` 和 `syncStatus: 'synced' | 'pending'` 字段
- 启动时执行一次全量 cursor 检查 + 增量拉取
- 每次 lowdb 写入后异步推送到 API
- 首次使用需登录（新增设置页登录界面），token 存储在 Electron `safeStorage`

### 5.3 PWA 端同步

- 在线时直接读写 API，IndexedDB 作为读缓存
- 离线时从 IndexedDB 读取，写操作排入 `offlineQueue`
- Service Worker 监听 `sync` 事件（Background Sync API），触发队列重放
- iOS 不支持 Background Sync 时，在 `visibilitychange` 时重放

---

## 6. 安全方案

### 6.1 认证与授权

| 项目 | 方案 |
|------|------|
| 密码哈希 | PBKDF2-SHA256（Web Crypto API 原生，Workers 无需额外依赖） |
| JWT 签名 | HMAC-SHA256，密钥存储在 `wrangler secret put JWT_SECRET` |
| Token 有效期 | 24 小时，到期重新登录（小范围使用不需要 refresh token） |
| Cookie 安全 | `httpOnly; Secure; SameSite=Strict` |
| 数据隔离 | 所有查询强制 `WHERE owner_id = :uid`，API 层统一校验 |

### 6.2 R2 图片安全

- Bucket 设为私有（不启用公开访问）
- `/api/covers/:key` 在生成签名 URL 前校验：JWT 有效 + `cover_key` 归属当前用户
- 签名 URL 有效期 1 小时，`Cache-Control: private, max-age=3600`

### 6.3 注册控制

- 注册入口仅接受有效邀请码
- 邀请码一次性使用（使用后记录 `used_by` + `used_at`）
- 邀请码仅管理员可生成（`POST /api/auth/invite`）；普通用户无法生成邀请码
- 初始管理员账号通过 `POST /api/auth/admin-setup`（一次性 token 鉴权）创建；系统中只允许存在一个管理员账号
- 管理员 token（`ADMIN_SETUP_TOKEN`）通过 `wrangler secret put ADMIN_SETUP_TOKEN` 配置，不写入代码或 `.dev.vars` 以外的文件

### 6.4 管理员/用户会话隔离

管理员后台与普通用户前台完全隔离，防止跨角色越权访问：

| 维度 | 普通用户 | 管理员 |
|------|---------|--------|
| 登录入口 | `/login` | `/admin/login` |
| 主页 | `/` | `/admin` |
| localStorage key | `tk_user` | `tk_admin` |
| 读取函数 | `getStoredUser()` | `getStoredAdmin()` |
| 路由守卫 | `RequireAuth`（使用 `getStoredUser`） | `RequireAdmin`（使用 `getStoredAdmin`） |
| 布局组件 | `Layout` | `AdminLayout` |

**安全守卫规则**：
- `getStoredUser()` 若 localStorage 中存储的值含 `is_admin: true`，返回 `null`（防止管理员账号绕过 `RequireAuth` 访问用户页）
- `getStoredAdmin()` 若存储值含 `is_admin: false`，返回 `null`（防止普通用户绕过 `RequireAdmin`）
- `/login` 页面检测到 `is_admin: true` 的登录响应时，拒绝登录并显示错误，不重定向到 `/admin`

### 6.5 豆瓣代理防滥用

- 代理端点需要 JWT 认证（非公开接口）
- 对同一用户限速（10 次/分钟）
- 遇封禁时返回明确错误，不重试

---

## 7. PWA 特性

### 7.1 manifest.json

```json
{
  "name": "TomeKeep",
  "short_name": "TomeKeep",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#1a1a2e",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

### 7.2 Service Worker 缓存策略（vite-plugin-pwa / Workbox）

| 资源类型 | 策略 | 说明 |
|----------|------|------|
| HTML / JS / CSS | Cache First + 版本更新时失效 | App Shell 离线可用 |
| `/api/*` | Network First，降级到 IndexedDB | 数据请求，优先新鲜数据 |
| `/api/covers/*` | Cache First，签名 URL 到期时重新获取 | 封面图变化少 |

### 7.3 iOS PWA 已知限制

| 限制 | 影响 | 缓解 |
|------|------|------|
| IndexedDB 上限约 50 MB | 不能缓存大量封面图 | 封面图走 R2，本地只缓存元数据 |
| iOS < 16.4 不支持推送通知 | 无后台提醒 | 书籍管理场景不需要推送 |
| Background Sync 支持有限 | 离线写操作需主动触发 | visibilitychange 时重放队列 |

---

## 8. 海报图识别（豆瓣分享图）

### 8.1 使用场景

用户从微信/社交媒体保存了豆瓣书籍分享海报图，想快速添加到书架，无需手动输入。

### 8.2 识别流程

```
用户上传海报图（相册选择或拍照）
           |
           v
[客户端] ZXing 解码 QR 码（纯客户端，已有 zxing-library）
           |
  +--------+--------------------------------------------------+
  | 成功：拿到豆瓣 URL                    失败：无 QR 码        |
  v                                                           v
POST /api/metadata/douban             [客户端] tesseract.js OCR
（后端代理，无 CORS 限制）                  提取书名、作者
  |                                        |
  v                                        v
返回完整元数据 + 封面 URL             搜索 OpenLibrary API（CORS 友好）
  |                                        |
  +------------------+--------------------+
                     v
             自动填充添加书籍表单，用户确认后保存
```

### 8.3 OCR 资源管理

- `chi_sim.traineddata`（~15 MB）按需加载，首次使用时从 CDN 下载
- 下载后缓存到 IndexedDB，不重复下载
- 显示加载进度条；OCR 为可选路径，失败时提示手动输入

### 8.4 纯客户端备选路径

当后端代理不可用时（网络离线、豆瓣被封）：
1. QR 码解码成功 → 显示豆瓣链接，引导用户在系统浏览器中打开
2. OCR 成功 → 用书名/作者搜索 OpenLibrary（直连，无 CORS 问题）
3. 以上均失败 → 提示手动输入

---

## 9. 功能可用性矩阵

| 功能 | 桌面端 | PWA | 说明 |
|------|:------:|:---:|------|
| 书籍 CRUD | Y | Y | |
| 心愿单管理 | Y | Y | |
| 心愿 -> 书库 | Y | Y | |
| 阅读状态跟踪 | Y | Y | |
| 标签管理 & AND 筛选 | Y | Y | |
| 搜索 & 排序 | Y | Y | |
| Detail / Compact 视图 | Y | Y | |
| 多用户 | Y 本地切换 | Y 登录切换 | |
| 深色/浅色/自动主题 | Y | Y | |
| 中英双语 | Y | Y | |
| ISBN 扫码 | Y 摄像头 | Y Web Camera + ZXing | |
| 豆瓣元数据（URL 输入） | Y 本地直连 | Y 后端代理 | |
| OpenLibrary 元数据 | Y | Y 直连 | |
| isbnsearch 元数据 | Y | N 需 CAPTCHA | |
| 豆瓣海报图识别 | Y | Y QR + OCR | |
| 封面图展示 | Y 本地 app:// | Y R2 签名 URL | |
| 封面拍照上传 | Y + 透视校正 | Y 基础拍照 | 透视校正暂不移植 |
| 价格数据展示 | Y | Y 只读 + 跳转 | |
| 价格比较（自动爬取） | Y | N | 需无头浏览器，仅桌面端 |
| 价格比较（手动录入） | Y | N | 需 Electron session |
| LLM 标题匹配 | Y 本地 ollama | N | |
| 豆瓣登录 session | Y | N | 需 Electron session |
| LAN 手机扫码服务器 | Y | 不需要 | PWA 本身在手机上 |
| 天气品牌图标 | Y | Y | Web API 通用 |
| 离线浏览 | Y 本地 | Y Service Worker | |
| 数据双向同步 | Y | Y | |

---

## 10. 实施计划

### Phase 0：代码重组（Monorepo 迁移）— 约 1-2 天

**目标**：建立 pnpm workspace，提取共享代码，确保桌面端功能不受影响。

| # | 任务 |
|---|------|
| 0.1 | 创建根 `pnpm-workspace.yaml` 和根 `package.json`（workspace 模式） |
| 0.2 | 创建 `packages/shared/`，初始化 `package.json`（`@tomekeep/shared`）和 `tsconfig.json` |
| 0.3 | 将 `src/lib/` 全部文件迁移到 `packages/shared/src/`，创建统一 `index.ts` re-export |
| 0.4 | 创建 `packages/desktop/`，将现有根目录代码迁入 |
| 0.5 | 更新 `packages/desktop` 中对 `src/lib/*` 的所有 import → `@tomekeep/shared` |
| 0.6 | 验证：`pnpm --filter @tomekeep/desktop dev` 正常启动 |
| 0.7 | 验证：`pnpm --filter @tomekeep/desktop test` 所有测试通过 |
| 0.8 | 验证：`pnpm --filter @tomekeep/desktop electron:build` 构建成功 |

**验收标准**：桌面端全功能正常，所有现有测试通过，无任何行为变化。

### Phase 1：搭建后端 API — 约 2-3 天

**目标**：可用的 Hono API，部署到 Cloudflare Pages Functions，D1 + R2 配置完成。

| # | 任务 |
|---|------|
| 1.1 | 初始化 `packages/web/`，配置 `wrangler.toml`（D1 binding: `DB`，R2 binding: `COVERS`） |
| 1.2 | 创建 D1 schema SQL（`packages/web/schema.sql`），执行 `wrangler d1 execute` 初始化 |
| 1.3 | 实现 `api/middleware/auth.ts`（JWT 验证，PBKDF2 密码哈希） |
| 1.4 | 实现 `api/routes/auth.ts`（注册/登录/邀请码） |
| 1.5 | 实现 `api/routes/books.ts`（CRUD + `?since` 增量参数） |
| 1.6 | 实现 `api/routes/wishlist.ts`（CRUD + `move-to-inventory`） |
| 1.7 | 实现 `api/routes/readingStates.ts` |
| 1.8 | 实现 `api/lib/r2.ts` + `api/routes/covers.ts`（上传压缩/签名URL） |
| 1.9 | 实现 `api/routes/metadata.ts`（豆瓣代理 + OpenLibrary，复用 `@tomekeep/shared`） |
| 1.10 | 实现 `api/routes/prices.ts`（只读） |
| 1.11 | 实现 `api/routes/sync.ts`（各表最新 `updated_at`） |
| 1.12 | 配置 `functions/api/[[route]].ts` 挂载 Hono app |
| 1.13 | 本地 `wrangler dev` 联调测试所有端点 |
| 1.14 | 部署到 Cloudflare Pages，验证线上 API 可用 |
| 1.15 | 创建初始管理员账号（D1 Console 直接插入） |

**验收标准**：所有 API 端点可通过 curl 正常访问；认证、数据隔离、R2 签名 URL 工作正常。

### Phase 2：构建 PWA 前端 — 约 5-7 天

**目标**：可在 iOS Safari 添加到主屏幕并正常使用的 PWA。

| # | 任务 |
|---|------|
| 2.1 | 初始化 `src/`（Vite + React + react-router v7 + Tailwind v4） |
| 2.2 | 实现 `lib/api.ts`（fetch wrapper，统一处理认证/错误/重试） |
| 2.3 | 实现 `lib/auth.ts`（token 管理，登录状态） |
| 2.4 | 实现登录/注册页面 |
| 2.5 | 实现主布局（侧边栏、主题切换、语言切换） |
| 2.6 | 实现书库页面（大量复用桌面端 UI 代码） |
| 2.7 | 实现心愿单页面 |
| 2.8 | 实现书籍添加表单（ISBN/豆瓣URL/手动输入 + 元数据自动填充） |
| 2.9 | 实现封面图展示（R2 签名 URL + 缓存策略） |
| 2.10 | 实现价格只读展示（最低价高亮 + 跳转按钮） |
| 2.11 | 实现 `lib/sync.ts`（同步状态 + visibilitychange 触发） |
| 2.12 | 实现 `lib/db-cache.ts`（IndexedDB 缓存层） |
| 2.13 | 配置 `vite-plugin-pwa`（manifest + Service Worker + Workbox 缓存策略） |
| 2.14 | 实现下拉刷新 |
| 2.15 | 实现 iOS 添加到主屏幕引导 |
| 2.16 | 响应式样式适配（iOS Safari safe area insets） |
| 2.17 | 测试：iOS Safari 添加到主屏幕，离线浏览，同步 |

**验收标准**：PWA 可在 iOS Safari 添加到主屏幕；核心功能全部可用；离线时可浏览缓存数据；联网后自动同步。

### Phase 3：桌面端集成同步 — 约 3-4 天（可与 Phase 2 并行）

**目标**：桌面端数据与云端双向同步，封面图上传到 R2。

| # | 任务 |
|---|------|
| 3.1 | 实现 `electron/sync.ts`（API client，增量拉取，冲突解决） |
| 3.2 | 更新 `electron/db.ts`：lowdb schema 增加 `updatedAt`、`syncStatus` 字段 |
| 3.3 | 实现启动同步流程（拉取 → 合并 → 更新 cursor） |
| 3.4 | 实现写入同步流程（本地写入 → 异步推送 → 失败重试） |
| 3.5 | 实现封面图上传（`covers:save-cover` 成功后异步上传到 R2） |
| 3.6 | 实现价格缓存同步（桌面端抓取的价格写入 D1） |
| 3.7 | 新增设置页登录界面（用户名/密码，token 存入 `safeStorage`） |
| 3.8 | 实现数据迁移脚本 `scripts/migrate-to-cloud.ts` |
| 3.9 | 多端同步测试（Mac 修改 → PWA 端验证，反之亦然） |

**验收标准**：Mac 端添加书籍后，PWA 端拉取可见；PWA 端操作后，Mac 端启动/唤醒时同步。

### Phase 4：增强功能 — 约 2-3 天

**目标**：补全 PWA 的便捷输入方式和离线写入能力。

| # | 任务 |
|---|------|
| 4.1 | 实现 PWA ISBN 扫码（Web Camera API + ZXing） |
| 4.2 | 实现豆瓣海报图识别（QR 解码 + OCR 降级） |
| 4.3 | 实现封面拍照上传（相册选择 / 摄像头拍照 → 压缩 → 上传 R2） |
| 4.4 | 实现离线写操作队列（IndexedDB pending queue + 重放） |
| 4.5 | 覆盖 Background Sync 兼容处理（iOS 降级到 visibilitychange） |

**验收标准**：海报图 QR 码识别可正确获取元数据；ISBN 扫码在 iOS Safari 中正常工作；离线写操作在联网后自动同步。

### 总时间线

```
Week 1:  Phase 0 (Monorepo) + Phase 1 开始 (后端 API)
Week 2:  Phase 1 完成 + Phase 2 开始 (PWA 前端) + Phase 3 并行 (桌面同步)
Week 3:  Phase 2 完成 + Phase 3 完成
Week 4:  Phase 4 (增强功能) + 全端联调测试

预计总工期：13-19 天
```

---

## 11. 部署流程

### 11.1 首次部署

```bash
# 1. 创建 Cloudflare 资源
npx wrangler d1 create tomekeep-db
npx wrangler r2 bucket create tomekeep-covers

# 2. 更新 wrangler.toml 中的 database_id

# 3. 初始化数据库表结构（按序执行所有 migrations）
npx wrangler d1 migrations apply tomekeep-db

# 4. 设置密钥
npx wrangler secret put JWT_SECRET          # JWT 签名密钥（随机强密钥）
npx wrangler secret put ADMIN_SETUP_TOKEN   # 管理员初始化 token（一次性使用后可删除）

# 5. 构建并部署
pnpm --filter @tomekeep/web build
npx wrangler pages deploy packages/web/dist

# 6. 创建初始管理员账号（仅限首次，之后接口自动拒绝）
curl -X POST https://<your-domain>/api/auth/admin-setup \
  -H "Authorization: Bearer <ADMIN_SETUP_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<strong-password>","name":"Admin"}'

# 7. 删除 ADMIN_SETUP_TOKEN secret（可选，admin-setup 接口在管理员存在后自动返回 409）
npx wrangler secret delete ADMIN_SETUP_TOKEN
```

### 11.2 日常更新

```bash
pnpm --filter @tomekeep/web build && npx wrangler pages deploy packages/web/dist
```

### 11.3 数据库 Schema 变更

变更文件放在 `packages/web/migrations/` 目录，按序号命名（如 `0001_add_cover_key.sql`）：

```bash
npx wrangler d1 migrations apply tomekeep-db
```

---

## 12. 风险与缓解措施

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 豆瓣反爬封禁后端代理 | 元数据获取失败 | 自动降级到 OpenLibrary；客户端 OCR 备选路径 |
| Cloudflare D1/R2 免费层变更 | 可能产生费用 | 当前用量远低于额度；可迁移到自建 PocketBase |
| iOS PWA 存储被系统清除 | 缓存丢失 | 核心数据在 D1，本地仅为缓存，重新同步即可恢复 |
| Workers CPU 时间（免费层 10ms） | 图片压缩可能超时 | 客户端预处理限制尺寸；超时降级不压缩直接存储 |
| 桌面端与 PWA 端时钟不同步 | LWW 冲突解决错误 | 使用服务端 `updated_at`（D1 datetime('now')）作为权威时间戳 |

---

## 13. 文档更新计划

本计划实施过程中，需同步更新以下文档：

- `ARCHITECTURE.md` — 增加 Monorepo 结构、Web 端架构、同步层描述
- `docs/generated/api-surface.md` — 增加所有 Hono API 端点和请求/响应格式
- `docs/standards/dependency-policy.md` — 记录新增依赖（Hono、vite-plugin-pwa、wrangler 等）的决策
- `docs/security/threat-model.md` — 增加云端部署、JWT 认证、R2 访问控制的威胁分析
- `docs/operations/reliability.md` — 增加同步失败、API 不可用时的降级行为

---

## 附录 A：框架选型分析

### Hono + Vite SPA vs Next.js

TomeKeep 是需要登录的私有应用，<10 人使用，没有 SEO 需求，核心形态是 PWA。

| 维度 | Hono + Vite SPA | Next.js |
|------|:---------------:|:-------:|
| Cloudflare Workers 原生支持 | 高（原生设计） | 低（需适配层） |
| D1/R2 binding 访问 | 直接（`c.env.DB`） | 间接（`getRequestContext()`） |
| 与现有代码复用率 | 高（同 Vite + react-router） | 低（文件系统路由、RSC 范式不同） |
| PWA 配置复杂度 | 低（vite-plugin-pwa 成熟） | 中（SSR + Service Worker 交互复杂） |
| Workers CPU 消耗 | 极低（< 1ms） | 中高（SSR 渲染 5-15ms，触及免费层限制） |
| SSR / SEO 能力 | 无 | 有（本场景不需要） |
| 首屏渲染速度 | 中（SPA loading + Service Worker 缓存后改善） | 高（但本场景影响很小） |

**结论**：Hono + Vite SPA 在本场景的关键维度（兼容性、代码复用、PWA 支持）全面优于 Next.js，Next.js 的优势（SSR、SEO）在私有书籍管理应用中没有用武之地。
