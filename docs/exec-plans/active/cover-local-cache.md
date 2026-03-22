---
title: "Cover Image Local Cache"
owner: "engineering"
status: active
last_reviewed: 2026-03-22
review_cycle_days: 30
linked_specs:
  - "../product-specs/book-management.md"
---

# Execution Plan: Cover Image Local Cache

## Context
当前封面图以远程 URL 字符串形式存储在 db.json，每次打开应用都需要联网从第三方 CDN 拉取（OpenLibrary / Douban）。图片加载依赖网络，且第三方 URL 可能失效。

此外，Inventory 卡片封面区域使用 16:9 宽幅比例 + `object-contain`，实体书封面（接近 2:3）在此区域中存在大量留白。

## Objective
1. 入库时将封面图下载到本地 `userData/covers/` 目录，`coverUrl` 改为存储本地路径。
2. 通过 Electron 自定义协议 `app://` 将本地图片提供给渲染进程，满足 Electron 内容安全策略。
3. 将 Inventory 卡片封面区域改为书籍比例（2:3 / `padding-top: 150%`），使用 `object-cover` 消除留白。

## Non-goals
- 不对已入库的旧数据做迁移（旧记录的远程 URL 继续作为 fallback 展示）。
- 不做增量更新或封面管理 UI。
- 不修改 Wishlist 卡片的布局（Wishlist 使用缩略图，留白问题不显著）。

## Constraints
- 不引入新的 npm 运行时依赖（使用 Node 内置 `https`/`http` + `fs` 模块下载图片）。
- 遵循 Electron 内容安全策略：渲染进程不可直接读取 `file://` 路径，须通过自定义协议。
- 不改动 `Book` / `WishlistItem` 接口的字段名（`coverUrl` 继续沿用，语义扩展为"可以是远程 URL 或 app://covers/... 路径"）。
- 保持现有测试全部通过。

## Scope
### In Scope
- `electron/main.ts`：注册 `app://` 自定义协议，映射到 `userData/` 目录。
- `electron/covers.ts`（新文件）：`covers:save-cover` IPC handler，下载远程图片到 `userData/covers/<id>.jpg`，返回 `app://covers/<id>.jpg`。
- `electron/preload.ts`：暴露 `window.covers.saveCover(id, remoteUrl)`。
- `src/vite-env.d.ts`：补充 `window.covers` 类型声明。
- `src/pages/Inventory.tsx`：`handleAddBook` 中，若 `coverUrl` 为远程 URL 则先调 `saveCover`，再存入 `Book`；卡片封面比例改为 2:3 + `object-cover`。
- `src/pages/Wishlist.tsx`：`handleAdd` 中同上处理 `coverUrl`。
- `docs/generated/api-surface.md`：新增 `covers:save-cover` IPC channel 说明。

### Out of Scope
- 旧数据迁移
- 封面删除 / 替换 UI
- Wishlist 卡片布局调整

## Impacted Areas
- modules: `electron/covers.ts`（新增）、`electron/main.ts`、`electron/preload.ts`、`src/pages/Inventory.tsx`、`src/pages/Wishlist.tsx`
- APIs: 新增 IPC channel `covers:save-cover`
- database: `coverUrl` 字段语义变更（值可为 `app://` 路径）
- docs: `docs/generated/api-surface.md`

## Proposed Approach
1. 在 `electron/main.ts` 的 `app.whenReady()` 中用 `protocol.handle('app', ...)` 注册协议，将 `app://covers/<file>` 映射到 `userData/covers/<file>`，使用 `net.fetch('file://...')` 返回文件流。
2. 新建 `electron/covers.ts`，注册 `covers:save-cover` handler：接受 `{ id, url }` → 使用 Node `https`/`http` 模块下载图片字节 → 写入 `userData/covers/<id>.jpg` → 返回 `app://covers/<id>.jpg`。入参 url 为空或下载失败时返回原始 url（静默 fallback）。
3. `electron/preload.ts` 暴露 `window.covers.saveCover`。
4. `src/pages/Inventory.tsx` 和 `src/pages/Wishlist.tsx` 在 `addBook`/`addWishlistItem` 前，若 `newBook.coverUrl` 非空且非 `app://` 开头，则调 `window.covers.saveCover`，用返回值替换。
5. 卡片封面比例：`paddingTop: '56.25%'` → `paddingTop: '150%'`，`object-contain` → `object-cover`。

## Task Breakdown
- [x] 创建执行计划
- [x] electron/main.ts: 注册 app:// 协议
- [x] electron/covers.ts: save-cover IPC handler
- [x] electron/preload.ts: 暴露 window.covers
- [x] src/vite-env.d.ts: 类型声明
- [x] Inventory.tsx: saveCover + 卡片比例
- [x] Wishlist.tsx: saveCover
- [x] docs/generated/api-surface.md: 更新
- [x] 构建 + 测试 + 提交

## Validation Plan
- `pnpm run build` 零错误
- `pnpm test` 30/30 通过
- 手动验证：入库一本带封面的书，重启应用后封面仍然正常显示（不依赖网络）

## Rollout Plan
本地桌面应用，直接发布到 main 分支即可。

## Rollback Plan
回退 commit，旧数据中的远程 URL 仍可正常工作（只是重新依赖网络）。

## Decision Log
- 2026-03-22: 使用 Node 内置模块下载图片，避免引入新运行时依赖（符合 dependency-policy）
- 2026-03-22: 使用 app:// 自定义协议而非 file:// 直接路径，满足 Electron CSP 要求
- 2026-03-22: 下载失败时静默回退原始远程 URL，不中断入库流程
- 2026-03-22: protocol.registerSchemesAsPrivileged 须在 app.whenReady() 之前调用，否则渲染进程拒绝加载 app:// 图片
- 2026-03-22: 豆瓣 CDN 防盗链要求 Referer: https://book.douban.com/，下载请求须显式携带此头
- 2026-03-22: 扫码豆瓣匹配成功后直接入库，不再显示确认表单；仅匹配失败时退回手动表单

## Status Updates
- 2026-03-22: created and implementation started
- 2026-03-22: completed — all tasks done, validated manually
