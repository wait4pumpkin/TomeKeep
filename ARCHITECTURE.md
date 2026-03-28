# ARCHITECTURE.md

## System Overview

TomeKeep 是一个 macOS 桌面应用，基于 Electron + React 19 + TypeScript + Vite + Tailwind CSS v4 构建，使用 lowdb（JSON 文件）作为本地持久化层。主进程（Node.js）与渲染进程（浏览器环境）之间通过 IPC 严格隔离。

## Major Components

### Renderer Process (`src/`)
- **`src/pages/Inventory.tsx`**: 书库页面，包含书籍列表、手动添加表单、编辑面板、封面重取、紧凑视图列数滑块
- **`src/pages/Wishlist.tsx`**: 愿望单页面，逻辑结构与 Inventory 类似
- **`src/components/`**: 可复用 UI 组件（CoverCropModal、LightboxModal 等）
- **`src/lib/`**: 纯渲染层工具库（无 IPC、无文件系统访问）
  - `isbn.ts` — ISBN 解析/校验/语义推断
  - `author.ts` — 作者名标准化
  - `isbnSearch.ts` — isbnsearch.org HTML 解析 + 占位封面 URL 检测
  - `douban.ts` — 豆瓣 HTML 解析
  - `openLibrary.ts` — OpenLibrary API 响应解析；定义 `BookMetadata` 类型
  - `i18n.ts` — 中/英双语翻译系统
  - `theme.ts` — Light/Dark/Auto 主题管理

### Main Process (`electron/`)
- **`electron/main.ts`**: 应用入口；注册 `app://` 自定义协议；注册所有 IPC handler；创建主窗口
- **`electron/db.ts`**: 数据持久化（lowdb）；实现所有 `db:*` IPC handler；启动时运行数据迁移
- **`electron/metadata.ts`**: 书籍元数据获取；实现所有 `meta:*` IPC handler；管理 `persist:douban` 和 `persist:isbnsearch` Electron 会话分区
- **`electron/covers.ts`**: 封面图本地化；实现 `covers:*` IPC handler；下载远程图片到 `userData/covers/`；拒绝 GIF 和已知 MD5 占位图
- **`electron/pricing.ts`**: 价格比较；实现 `pricing:*` IPC handler
- **`electron/stores.ts`**: 零售商 Cookie/Session 管理
- **`electron/companion-server.ts`**: LAN HTTPS 伴随服务器，用于手机 ISBN 扫码
- **`electron/preload.ts`**: 上下文桥接；将安全 API 暴露给渲染进程（`window.db`、`window.meta`、`window.covers`、`window.pricing`、`window.stores`、`window.app`、`window.companion`）

## Architecture Boundaries

### Allowed Dependencies
- 渲染进程 → 仅通过 `window.*` preload API 访问主进程功能
- 主进程 → Node.js 内置模块、electron API、lowdb
- `src/lib/` → 纯函数，无副作用，无 IPC，可被渲染进程和测试直接引用
- `electron/` 中的元数据解析逻辑（如 HTML 解析）应委托给 `src/lib/` 中对应的纯函数库

### Forbidden Dependencies
- 渲染进程不可直接访问 `file://` 路径或 Node.js 模块（由 Electron contextIsolation 强制）
- 渲染进程不可直接读写 lowdb（必须通过 `window.db` IPC）
- `src/lib/` 不可 `import` 任何 `electron/` 模块
- 不可绕过 IPC 边界直接在渲染进程中访问持久化层

## Data Flow

### 书籍入库（手动添加）
1. 用户在 `Inventory.tsx` 填写表单，触发 `commitBook`
2. 若 `coverUrl` 为远程 URL，调用 `window.covers.saveCover(id, url)` → `covers:save-cover` IPC → `electron/covers.ts` 下载并校验图片 → 返回 `app://covers/<id>.jpg` 或 `undefined`
3. 调用 `window.db.addBook(book)` → `db:add-book` IPC → `electron/db.ts` 写入 `db.json`；幂等：若 id 已存在则跳过
4. 渲染进程更新本地 React 状态

### 元数据获取（瀑布流）
1. 用户触发 "ISBN Fill" → `window.meta.lookupWaterfall(isbn13)` → `meta:lookup-isbn-waterfall` IPC
2. `electron/metadata.ts` 依次尝试：Douban HTML（`persist:douban` 会话）→ OpenLibrary API → isbnsearch HTML（`persist:isbnsearch` 会话）
3. 若 isbnsearch 遇到验证码，返回 `{ ok: false, error: 'captcha' }`；渲染进程调用 `window.meta.resolveCaptcha(isbn13)` 弹出验证码窗口
4. 解析结果以 `BookMetadata` 对象返回渲染进程，由 `Inventory.tsx` 填充表单字段

### 封面图访问
- 本地封面：渲染进程使用 `app://covers/<id>.jpg` URL → Electron 自定义协议拦截 → 映射到 `userData/covers/<id>.jpg` 文件
- 旧数据/远程封面：直接使用远程 URL（fallback，依赖网络）

## Key Directories

| 路径 | 说明 |
|---|---|
| `electron/` | 主进程代码；所有 Node.js / Electron API 调用都在此 |
| `src/pages/` | 页面级 React 组件（Inventory、Wishlist、Settings 等）|
| `src/components/` | 可复用 UI 组件 |
| `src/lib/` | 纯渲染层工具库（无副作用，可直接单元测试）|
| `docs/product-specs/` | 产品需求规格（功能需求来源）|
| `docs/exec-plans/` | 执行计划（active = 进行中，archived = 已完成）|
| `docs/generated/` | 从代码维护的技术文档（API surface 等）|
| `docs/standards/` | 工程规范（编码、依赖、测试、提交等）|
| `public/` | 静态资源（手机扫码页 HTML、vendor JS 等）|

## Runtime Constraints

- **幂等性**: `db:add-book` 在同一 id 已存在时跳过插入，保证重复调用安全
- **占位封面拒绝**: `covers:save-cover` 在保存前校验图片——拒绝 GIF 文件（`GIF89a` magic bytes）及已知占位 JPEG（按 MD5 校验），返回 `undefined` 而非保存无效封面
- **验证码防重弹**: `handleRefetchCover` 通过 `captchaAlreadyAttempted` 标志确保同一 ISBN 的瀑布流调用中最多弹出一次验证码窗口
- **IPC 跨边界类型**: `saveCover` 返回 `Promise<string | undefined>`；调用方须处理 `undefined`（保留旧 coverUrl 或不更新）
- **Electron 会话分区**: Douban 请求使用 `persist:douban`（持久化 Cookie，与登录窗口共享）；isbnsearch 使用 `persist:isbnsearch`（持久化 Cookie，跨验证码会话）

## Change Impact Checklist

When changing architecture-significant code, also check:
- `docs/generated/api-surface.md`
- `docs/operations/reliability.md`
- `docs/security/threat-model.md`
