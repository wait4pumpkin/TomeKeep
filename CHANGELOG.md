# Changelog / 更新日志

本文档记录 TomeKeep 各版本的变更内容，格式遵循 [Keep a Changelog](https://keepachangelog.com/)。

All notable changes to TomeKeep are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

---

## [Unreleased]

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

[Unreleased]: https://github.com/wait4pumpkin/TomeKeep/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/wait4pumpkin/TomeKeep/releases/tag/v0.1.0
