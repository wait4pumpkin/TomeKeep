---
title: "Wishlist 比价（缓存 + 手动刷新 + 登录 Cookie）"
owner: "assistant"
status: active
last_reviewed: 2026-03-18
review_cycle_days: 14
linked_specs: []
---

# Execution Plan: Wishlist 比价（缓存 + 手动刷新 + 登录 Cookie）

## Context
当前 Wishlist 列表只有“Check Price”的 mock 展示。目标是把比价做成可用能力：多渠道（至少中图网、京东、以及常用渠道占位/扩展）、结果缓存、支持手动刷新；部分渠道可能需要登录，允许用户在应用内登录并持久化 Cookie 以便后续抓取价格。

## Objective
- Wishlist 列表展示每本书的多渠道比价信息（每个渠道：价格、链接、更新时间、错误/需要登录状态）。
- 比价结果可缓存（按 ISBN），有 TTL 及手动刷新（单条/全局）。
- 支持中图网、京东的可用抓取；同时提供“常用购书渠道”的可扩展框架（先实现最小可用的跳转/占位或逐步补齐解析）。
- 支持渠道登录：用户完成登录后，应用在本地持久化 Cookie，并在抓价请求中自动携带。

## Non-goals
- 不做“自动下单/加入购物车/支付”等交易流程。
- 不保证所有渠道在任何时间都可稳定抓取（反爬、验证码、地区/账号差异等属于现实约束），但要给用户清晰的状态与手动介入路径（打开登录/打开商品页）。
- 不在渲染进程暴露或导出 Cookie 明文（避免泄露）。

## Constraints
- 依赖策略：优先使用 Electron/Node 内置能力，避免新增重型 HTML 解析依赖；若必须新增依赖，需要在 Decision Log 记录原因与替代方案对比。
- 安全：Cookie 属于敏感资产，只能保存在主进程 Electron session 的持久化分区中；不写入 lowdb 的 db.json；不在日志中输出 Cookie 值。
- 稳健性：所有外部请求必须设置超时、失败不阻塞核心流程；抓取失败要可诊断（错误码/状态）但不暴露敏感信息。
- 可维护性：渠道抓取逻辑以“适配器”形式组织，新增渠道不需要改动 UI 的核心渲染结构。

## Scope
### In Scope
- 数据结构：新增价格缓存表（按 ISBN -> 多渠道报价），包含更新时间、来源链接、状态/错误。
- IPC：新增比价相关 API（获取缓存、刷新报价、打开渠道登录、清除渠道 Cookie）。
- 主进程：实现“渠道会话分区”（persist），用 session.fetch 发起带 Cookie 的请求。
- 渲染层：Wishlist 列表显示比价卡片；提供“刷新全部/刷新单条/打开渠道链接/登录/清除登录”等操作。
- 渠道适配器：
  - 中图网（bookschina/中图网）通过搜索 ISBN 定位商品页并解析价格（或使用可用的结构化数据）。
  - 京东（JD）通过搜索 ISBN 定位商品页并解析价格（必要时提示登录/验证码并引导用户在登录窗口处理）。
  - 常用渠道框架：当当、孔夫子、天猫/淘宝等先提供“搜索链接 + 状态占位”，后续可按适配器补齐解析。

### Out of Scope
- 后台定时刷新（仅按用户触发 + 可选的进入页面自动刷新过期项）。
- 复杂的价格历史趋势图（先保留最后一次报价与更新时间，历史属于后续增强）。

## Impacted Areas
- modules:
  - `src/pages/Wishlist.tsx`（UI 展示与操作）
  - `electron/` 新增/扩展：比价服务、渠道登录窗口管理、IPC 注册
  - `electron/preload.ts`（暴露新的安全 API）
  - `electron/db.ts`（扩展 schema：保存 price cache，不保存 Cookie）
- APIs:
  - `pricing:get` / `pricing:refresh`
  - `stores:open-login` / `stores:clear-cookies` / `stores:get-status`
- database:
  - lowdb 新增 `priceCache`（或单独 json 文件）用于缓存报价与刷新时间
- docs:
  - 如引入新外部集成或存储新敏感数据类别，更新 `docs/security/threat-model.md` 的 Review Trigger 对应条目（最小增补）

## Proposed Approach
### 1) 定义比价域模型与缓存策略
- 以 ISBN 为主键缓存：`isbn -> { quotes: Quote[], updatedAt, ttlMs }`。
- Quote 字段：`channel`、`priceCny`（可为空）`currency`、`url`、`inStock?`、`fetchedAt`、`status`（ok / needs_login / blocked / not_found / error）与 `message`（用户可读短文案）。
- TTL 默认 24h：进入 Wishlist 时显示缓存；对过期项显示“已过期”并提供一键刷新。

### 2) 渠道适配器架构
- 在主进程新增 `pricing/adapters/*`：每个渠道实现：
  - `search(isbn) -> productUrl | not_found | needs_login | blocked`
  - `fetchQuote(productUrl) -> Quote`
- 适配器输出统一的 Quote，UI 不理解渠道细节。
- 解析策略优先：
  1) 页面内结构化数据（JSON-LD / meta / 统一脚本变量）
  2) 明确的 DOM 片段字符串匹配（轻量、可测试）
  3) 失败则返回 `blocked` 或 `error`，同时提供 `url` 方便用户手动查看

### 3) Cookie 与登录
- 使用 Electron `session.fromPartition('persist:bookstores')`（或按渠道细分 partition）：
  - 登录窗口 `BrowserWindow` 使用同一 partition，用户登录后 Cookie 自动落盘（Electron 管理）。
  - 抓价请求使用 `session.fetch`，自动携带 Cookie。
- 提供 UI 操作：
  - “登录京东/登录中图网”打开登录窗口到对应登录页
  - “清除登录”调用主进程清理该域名 cookie
  - “登录状态”用“是否存在该域名 cookie”做启发式展示（不展示 cookie 内容）

### 4) Wishlist UI
- 列表每项新增“比价”区域：
  - 展示各渠道最新价格/状态、更新时间、打开链接
  - 支持“刷新该书”“刷新全部”
  - 若无 ISBN，展示缺失提示并引导用户补齐

### 5) 测试与回归
- 单元测试：给每个适配器的解析函数提供固定 HTML/片段样例，验证能提取价格/链接与状态。
- 缓存测试：TTL、生效与强制刷新覆盖。

## Task Breakdown
- [ ] 扩展 lowdb schema：增加比价缓存结构与读写接口
- [ ] 新增主进程比价服务：适配器接口、缓存逻辑、超时与错误映射
- [ ] 新增渠道登录与 Cookie 管理：登录窗口、清除 cookie、状态检查 IPC
- [ ] 更新 preload 与渲染端 API：安全暴露比价与登录能力
- [ ] 更新 Wishlist UI：比价展示、刷新按钮、错误/登录引导
- [ ] 为解析与缓存补充测试与样例数据

## Validation Plan
- 单元测试：
  - 解析：中图网、京东的“从 HTML 提取价格”的纯函数测试
  - 缓存：TTL 命中、强制刷新覆盖、错误结果缓存策略
- 手工验证：
  - Wishlist 展示缓存价格与更新时间
  - 手动刷新单条/全局生效且 UI 状态正确
  - 打开登录窗口登录后，刷新可携带 Cookie（可通过登录态页面行为间接验证）
  - 清除登录后抓取回到 needs_login/blocked 状态

## Rollout Plan
- 本地功能完成后直接随应用版本发布；默认不开启自动后台刷新，降低外部请求频率与被封风险。

## Rollback Plan
- 代码回滚：移除新增 IPC 与 UI 展示即可；db 中新增字段可容忍残留（读取时提供默认值）。
- 若某渠道解析不稳定：保留“打开链接/搜索链接”能力，禁用该渠道的自动解析。

## Decision Log
- 2026-03-18: 初稿：采用 Electron session 持久化 Cookie；缓存写入 lowdb，Cookie 不落库。

## Status Updates
- 2026-03-18: created
