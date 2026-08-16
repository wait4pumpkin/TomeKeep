# Changelog / 更新日志

本文档记录 TomeKeep 各版本的变更内容，格式遵循 [Keep a Changelog](https://keepachangelog.com/)。

All notable changes to TomeKeep are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

---

## [Unreleased]

---

## [1.0.7] - 2026-08-16

### 修复 / Fixed

**桌面端 / Desktop**
- 修复新增书/心愿单封面不同步到云端的问题：封面预览的异步 R2 上传在记录插入本地库之前完成，返回的 `coverKey` 被丢弃，导致记录以 `cover_key = NULL` 推送（手机端只显示占位图）。现在 `pushBook` / `pushWishlistItem` 在推送前会自检：本地有封面但无 `coverKey` 时先上传再推送，封面随记录同步，不再依赖启动/手动同步兜底

**Web / PWA**
- 修复移动端编辑面板中设置阅读状态无效的问题：编辑面板此前把阅读状态写到账户级（`profile_id = NULL`）行，而界面上活跃 profile 的专属行优先显示，导致改动看似无效；现改为与卡片状态按钮一致，携带活跃 `profile_id` 写入

### Fixed (English summary)

- Fixed new book / wishlist covers not reaching the cloud: the async R2 cover upload in the preview path completed before the record was inserted locally, and the returned `coverKey` was silently discarded, so records were pushed with `cover_key = NULL` (mobile showed only the placeholder). `pushBook` / `pushWishlistItem` now upload the local cover first when `coverKey` is missing, so covers travel with the record and no longer depend on startup repair timing.
- Fixed reading status changes made from the book edit bottom sheet having no visible effect on mobile: the edit form wrote to the account-level (`profile_id = NULL`) row while profile-specific rows take precedence in the UI; it now sends the active `profile_id` like the card status button does

---

## [1.0.6] - 2026-08-16

### 修复 / Fixed

**桌面端 / Desktop**
- 同步修复：应用启动、登录成功及点击"立即同步"时自动重放 pending 队列（books / wishlist / reading states），失败的书不再永久滞留本地
- 封面补传：启动时自动检测"本地有封面但无 R2 coverKey"的记录并上传，修复云端封面缺失
- 修复 token 存储路径 bug：token 文件路径改为调用时计算（此前在模块加载时计算，导致 token 落在默认 userData 目录 `@tomekeep/desktop/` 而非数据目录 `TomeKeep/`）；升级后需重新登录一次（旧路径 token 不再读取）
- 修复 Dock 图标偏大：图标加透明边距（内容 99% → 84%，符合 macOS 图标规范）；`app.dock.setIcon` 仅在图标文件存在时调用（打包后 `build/icon.png` 未随包发布，此前会设置空图像）
- 修复逻辑幂等，可安全地在每次启动时运行；未登录时自动跳过

### Fixed (English summary)

- Desktop sync repair: the pending queue (books / wishlist / reading states) is automatically replayed on app launch, after login, and on manual pull, so records with failed pushes no longer stay stuck locally
- Cover backfill: records with a local cover but no R2 coverKey are uploaded at startup, fixing missing cloud covers
- Fixed token path bug: the token file path is now computed at call time (previously computed at module load, so the token landed in the default userData dir `@tomekeep/desktop/` instead of the data dir `TomeKeep/`); a one-time re-login is required after upgrading
- Fixed oversized Dock icon: added transparent margins to the icon (content 99% → 84%, matching macOS icon guidelines); `app.dock.setIcon` is now guarded to only run when the icon file exists (in packaged builds `build/icon.png` is not shipped, so an empty image was being set)
- Repair is idempotent and safely runs on every launch; skipped when not logged in

---

## [0.1.0] - 2026-04-10

### 新增 / Added

**桌面端 / Desktop**
- 书库管理：按 ISBN 添加书籍，自动从豆瓣 / OpenLibrary / isbnsearch 获取元数据（瀑布式查询）
- 愿望清单：优先级管理（高 / 中 / 低），一键移入书库
- 价格比较：自动抓取京东、当当、中国图书网价格；支持手动确认定价
- 多用户档案：支持多个家庭成员独立阅读状态（未读 / 阅读中 / 已读），记录完成时间
- 手机扫码伴侣：局域网 HTTPS 服务器，手机通过 QR 码连接后可扫条码直接录入书库
- 封面管理：自动下载并本地化封面图片，过滤 GIF 占位图和已知 MD5 占位图
- 豆瓣登录：内置豆瓣登录窗口，支持需要登录才能访问的元数据
- 双语 UI：中文 / English 切换，语言设置按用户独立保存
- 深色 / 浅色 / 自动主题切换
- 本地存储：全部数据存储在 `~/Library/Application Support/TomeKeep/db.json`

**Web 端 / Web**
- Cloudflare Pages PWA，支持离线访问
- Hono API 后端，托管在 Cloudflare Pages Functions
- Cloudflare D1（SQLite）数据库，Cloudflare R2 封面存储
- JWT 认证（httpOnly cookie + Bearer token 双模式）
- 邀请码注册机制，管理员一次性引导端点
- 增量同步 API（`?since=<ISO>` 模式，LWW 冲突解决）
- 桌面端 → 云端一键数据迁移（含封面上传）

**基础设施 / Infrastructure**
- GitHub Actions CI/CD：
  - Push `main` → 自动构建 Web 并部署到 Cloudflare Pages（含 D1 迁移）
  - Push `v*.*.*` tag → 自动构建 macOS .dmg 并发布到 GitHub Releases

### Added (English summary)

- Desktop inventory management with auto metadata from Douban / OpenLibrary / isbnsearch
- Wishlist with priority levels and atomic move-to-inventory
- Automated price comparison across JD, Dangdang, BooksChina
- Multi-profile reading states per account
- LAN companion server for mobile barcode scanning via QR code
- Local cover image management with GIF/placeholder filtering
- Bilingual UI (zh/en) with per-user language preference
- Dark / light / auto theme
- Cloudflare Pages PWA with offline support
- Hono API backend on Cloudflare Pages Functions with D1 + R2
- Invite-only user registration with admin bootstrap endpoint
- Incremental sync API with LWW conflict resolution
- One-shot local-to-cloud data migration script with cover upload
- GitHub Actions: auto Cloudflare Pages deploy on `main` push, auto macOS release on tag push

---

[Unreleased]: https://github.com/wait4pumpkin/TomeKeep/compare/v1.0.6...HEAD
[1.0.6]: https://github.com/wait4pumpkin/TomeKeep/compare/v1.0.5...v1.0.6
[0.1.0]: https://github.com/wait4pumpkin/TomeKeep/releases/tag/v0.1.0
