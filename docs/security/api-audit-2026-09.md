---
title: "API Security and Consumer Audit — 2026-09"
owner: engineering
status: active
last_reviewed: 2026-09-24
review_cycle_days: 14
---

# API 安全与消费审计

## 1. 范围

审计当前 `packages/web/api` 暴露的 Hono API，以及 Electron、PWA、迁移脚本和计划中的原生客户端调用关系。

## 2. 消费矩阵

| 接口组 | Electron | PWA | 脚本 | 原生目标 | 处置 |
|---|---:|---:|---:|---:|---|
| `/auth/login` | 是 | 是 | 是 | 是 | 保留并加固 |
| `/auth/logout` | 否 | 是 | 否 | 可选 | PWA 退出前保留 |
| `/auth/me` | 否 | 是 | 否 | 是 | 保留 |
| `/auth/register` | 否 | 是 | 否 | 是 | 保留并加固 |
| `/auth/invite*` | 否 | 管理端 | 否 | 是 | 保留并迁移管理 UI |
| `/auth/admin-setup` | 运维 | 运维 | 运维 | 运维 | 保留并限制 |
| `/books*` | 是 | 是 | 是 | 是 | 保留并纳入同步 v2 |
| `/wishlist*` | 是 | 是 | 是 | 是 | 保留并纳入同步 v2 |
| `/profiles*` | 是 | 是 | 否 | 是 | 保留并纳入同步 v2 |
| `/reading-states*` | 是 | 是 | 是 | 是 | 保留并修复所有权校验 |
| `/covers/upload` | 是 | 是 | 是 | 是 | 保留并加固文件校验 |
| `/covers/import` | 否 | 是 | 否 | 否 | PWA 退出前保留 |
| `/covers/:key` | 否 | 本地开发 | 否 | 待定 | PWA 退出前保留 |
| `/price-cache*` | 否 | 否 | 否 | 是 | macOS 写入、iOS/macOS 分页读取；保留并执行 owner/LWW 校验 |
| `/metadata/isbn` | 否 | 是 | 否 | 否 | PWA 退出前保留 |
| `/metadata/douban` | 否 | 否 | 否 | 否 | 已删除 |
| `/metadata/openlib` | 否 | 否 | 否 | 否 | 已删除 |
| `/prices/:isbn` | 否 | 否 | 否 | 否 | 已删除；未来价格同步重新设计 |
| `/sync/status` | 是 | 是 | 否 | 否 | 旧客户端退出前保留 |
| `/health` | 运维 | 运维 | 运维 | 运维 | 保留 |

本矩阵基于仓库静态调用扫描。部署切换前仍需结合生产访问日志复核。

## 3. 已确认问题

### SEC-001：阅读状态可引用其他账户书籍

- 严重度：高。
- 原因：写入接口验证了 profile 所有权，但未验证 `book_id` 所有权。
- 影响：认证用户可创建指向其他账户书籍的 reading state 关系。
- 处置：写入前按 `book_id + owner_id + deleted_at IS NULL` 验证；不存在和非本账户统一返回 `book_not_found`。

### SEC-002：JWT 解析异常可产生 500

- 严重度：中。
- 原因：Base64 和 JSON 解析未捕获，且未显式验证 `alg`/`typ` 和字段类型。
- 处置：限制 Token 长度；捕获所有畸形输入；要求 HS256/JWT；验证 `sub`、`username`、`iat`、`exp` 和时间关系。

### SEC-003：服务端错误细节暴露

- 严重度：低到中。
- 原因：元数据代理把内部异常文本返回给客户端。
- 处置：对外只返回稳定错误码；内部细节仅进入隐私安全的结构化日志。

### SEC-004：默认档案阅读状态可重复

- 严重度：中。
- 原因：SQLite 复合主键中的 `NULL` 不参与相等判断，`profile_id IS NULL` 的旧式阅读状态不能由 `(user_id, book_id, profile_id)` 主键去重。
- 影响：同一本书可能出现多个默认阅读状态，导致同步顺序和最终显示不确定。
- 处置：迁移时保留每组最新记录并添加 partial unique index；空 profile 写入使用匹配该索引的 upsert conflict target。
- 验证：在隔离 SQLite 中依次应用 0001—0003，构造同一用户/书籍的两条 `profile_id IS NULL` 记录，再应用 0004；只保留 `updated_at` 最新记录，partial unique index 存在，后续 conflict upsert 行数保持 1。

### SEC-005：邀请码注册并发消费非原子

- 严重度：中。
- 原因：旧实现先读取邀请码，再分别插入用户和更新邀请码；并发请求可能同时通过预检查。
- 处置：改为 D1 事务批次；用户插入由 `invite_codes.used_by IS NULL` 条件驱动，邀请码更新再次使用 compare-and-set 条件。未赢得邀请码竞争的请求不会创建用户或签发 Token。
- 验证：TypeScript 类型检查与服务端测试通过；仍需在 D1 集成环境补充并发请求压力测试。

### SEC-006：封面上传信任调用方 MIME

- 严重度：中。
- 原因：multipart 和上游响应的 `Content-Type` 可由调用方控制，非图片内容可能以图片类型进入 R2。
- 处置：上传与远程导入均按 JPEG/PNG/GIF/WebP 文件魔数识别；无法识别的内容在持久化前拒绝。
- 验证：覆盖四种允许格式与伪装成图片的 SVG/HTML 负向测试。

### SEC-007：档案硬删除缺少跨设备 tombstone

- 严重度：中（数据一致性）。
- 原因：设备 A 删除档案后，设备 B 的旧本地副本会再次 upsert，从而复活已删除档案。
- 处置：`0005_profile_tombstones.sql` 增加 `deleted_at`；原生同步显式请求 tombstone，服务端以 D1 batch 原子删除阅读状态并软删除档案，且拒绝删除最后一个活动档案。
- 验证：服务端覆盖兼容查询、原子删除与最后档案保护；原生端以账户隔离的持久 outbox 重放新增、重命名和删除。

## 4. 待处理问题

- Worker 内存 Map 限流无法覆盖多实例和冷启动。
- 长期 JWT 登出后无法撤销。
- JSON body、字段长度、分页和批量大小缺少统一限制。
- 远程封面在缺少 Content-Length 时仍会先缓冲再执行 2 MiB 上限检查；后续应改为流式中止。
- 资源接口对“其他用户拥有”和“不存在”使用不同响应，可能泄露对象存在性。
- 同步仍使用秒级 `updated_at`，但原生端每次显式同步都会重读 inclusive cursor 边界，并按 `(updated_at, id)` 分页；LWW 合并吸收重复记录，避免同秒写入被 `MAX(updated_at)` 优化跳过。
- Profiles 未包含在旧 `/sync/status` 响应中。
- cover CDN 的公开访问模型与“封面非敏感”假设需要重新确认。

## 5. 删除记录

2026-09-23 删除三个仓库内零消费者接口：

- `POST /api/metadata/douban`
- `POST /api/metadata/openlib`
- `GET /api/prices/:isbn`

保留 `price_cache` 数据表，直到原生价格同步模型和已有数据迁移完成，避免提前删除数据。

## 6. 后续验证

- 为每个授权资源添加用户 A/用户 B 负向集成测试。
- 对 JWT、URL、图片和 JSON 输入做畸形与大小边界测试。
- 在生产访问日志中确认删除接口没有外部调用。
- 原生同步 v2 上线前完成游标、幂等和冲突模型威胁分析。
