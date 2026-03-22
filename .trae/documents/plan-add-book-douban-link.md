---
title: "添加图书支持豆瓣详情页链接"
owner: "engineering"
status: active
last_reviewed: 2026-03-16
review_cycle_days: 14
linked_specs:
  - "../../docs/product-specs/book-management.md"
---

# Execution Plan: 添加图书支持豆瓣详情页链接

## Context
当前加书流程仅支持 ISBN（手动输入或扫码），并通过 Open Library 进行元信息填充。实际使用中，用户常见的“可复制来源”是豆瓣图书详情页链接（`https://book.douban.com/subject/<id>/`），希望直接粘贴链接即可完成元信息填充（至少 Title/Author；可选 Publisher/Cover/ISBN）。

## Objective
- 在 Inventory → Add Book 中新增“通过豆瓣详情页链接填充元信息”的能力：
  - 用户粘贴豆瓣图书详情页 URL（或 subject id），点击一次按钮即可拉取并填充表单字段
  - 若页面包含 ISBN，自动规范化为 ISBN-13 并回填到表单（用于后续价格比对/去重等）
- 保持隐私与安全：仅在用户显式动作（点击 Fill）后发起请求；不记录/上报链接与响应内容；请求设置超时与失败分支，不阻塞加书。

## Non-goals
- 不实现“豆瓣搜索 + 选择条目”的完整检索体验（仅支持详情页链接/subject id）。
- 不引入需要 API Key 的第三方服务或新增环境变量。
- 不实现复杂的多来源编排与冲突合并（本次只做 Douban → BookMetadata 的单次填充）。

## Constraints
- 依赖策略：不新增运行时依赖；HTML 解析使用现有平台能力与轻量字符串解析。
- 架构边界：
  - renderer 仅调用 `window.meta.*` 能力；网络请求在 main 进程完成并通过 IPC 暴露
  - 元信息解析逻辑保持为纯函数（便于 Vitest 单测）
- 安全与隐私（对齐 `docs/security/threat-model.md`）：
  - 仅在用户显式点击时向外部站点发起请求
  - 强制域名 allowlist：仅允许 `https://book.douban.com/subject/<id>/`（拒绝任意 URL fetch）
  - 超时（建议 8s）+ 明确错误映射；不输出包含 URL/HTML 的日志
- 文档规则：
  - 新增 `window.meta.*` 接口必须更新 `docs/generated/api-surface.md`
  - 新增外部集成需更新 `docs/references/external-constraints.md` 与安全威胁模型（如适用）

## Scope
### In Scope
- 新增豆瓣链接解析与 subject id 提取：
  - 兼容 `https://book.douban.com/subject/38210549/`、带查询参数、可选末尾 `/`
  - 可选兼容仅输入数字 subject id（例如 `38210549`）
- 新增“按豆瓣 subject 获取元信息”的 main 进程能力（带 timeout / 错误类型）：
  - 请求 URL：`https://book.douban.com/subject/<id>/`
  - 解析 HTML，提取：title、author、publisher、coverUrl、isbn(10/13)→isbn13
- Inventory Add Book UI：
  - 增加“豆瓣链接/ID”输入框与 “Fill” 按钮
  - 展示 loading/success/error 状态（沿用现有 metaStatus 交互风格）
  - 将返回的 `BookMetadata` 合并到表单（复用 `mergeBookDraftWithMetadata`）
- 单元测试（Vitest）：
  - subject id 提取（URL/ID/非法输入）
  - HTML 解析（最小 HTML fixture 覆盖 title/author/publisher/isbn/cover 及缺字段）
- 文档更新：
  - `docs/generated/api-surface.md`
  - `docs/references/external-constraints.md`
  - `docs/security/threat-model.md`（新增 provider 风险与控制项）

### Out of Scope
- Wishlist 页面的豆瓣链接填充（本次只改 Inventory Add Book）。
- 任何后台定时抓取、缓存、批量导入。

## Impacted Areas
- renderer:
  - `src/pages/Inventory.tsx`（新增输入与调用；状态展示）
  - `src/vite-env.d.ts`（扩展 `window.meta` 类型）
  - `src/lib/*`（新增 Douban URL/HTML 解析纯函数）
- main:
  - `electron/metadata.ts`（新增 IPC handler：`meta:lookup-douban`）
  - `electron/preload.ts`（暴露 `window.meta.lookupDouban`）
- docs:
  - `docs/generated/api-surface.md`
  - `docs/references/external-constraints.md`
  - `docs/security/threat-model.md`

## Proposed Approach
### 1) API 形态与错误模型
- 增加新方法：`window.meta.lookupDouban(input: string)`
  - `input` 允许是豆瓣详情页 URL 或纯 subject id
- 返回结构与 `lookupIsbn` 对齐（便于 UI 复用状态逻辑），但错误枚举单独定义：
  - `invalid_url`：无法解析出合法 subject id，或不在 allowlist
  - `not_found`：HTTP 404 或页面无效
  - `timeout`：请求超时
  - `network`：非 2xx/3xx 或网络异常
  - `bad_response`：HTML 结构变化导致无法解析出关键字段（至少 isbn13 或 title/author 的缺失按策略处理）
- 解析策略：允许 title/author/publisher/coverUrl 为可选，但必须能得到 isbn13（用于复用现有 `BookMetadata` 类型）；若无法提取任何 ISBN，则视为 `bad_response` 或 `not_found`（实现阶段统一为一种，避免 UI 过多分支）。

### 2) Douban URL/HTML 解析（纯函数）
- 新增 `src/lib/douban.ts`：
  - `extractDoubanSubjectId(input: string): { ok: true; value: string } | { ok: false; error: 'invalid_url' }`
  - `parseDoubanSubjectHtml(html: string): { ok: true; value: BookMetadata } | { ok: false; error: 'not_found' | 'bad_response' }`
- HTML 提取顺序（尽量稳健）：
  1. title：优先匹配 `property="v:itemreviewed"`；回退到 `og:title` 或 `<title>`（去掉站点后缀）
  2. coverUrl：优先匹配 `property="og:image"`；回退到 `#mainpic img[src]`
  3. info 区块：截取 `id="info"` 片段并提取：
     - 作者：`作者`/`作者:` 行文本（保留多个作者，使用逗号或斜杠连接）
     - 出版社：`出版社` 行文本
     - ISBN：`ISBN` 行文本（允许含 ISBN-10/13），再复用 `normalizeIsbn`/`toIsbn13` 归一为 ISBN-13
- 解析实现不引入 DOM 解析库，使用字符串切片 + 正则 + 基础 HTML entity 解码（至少处理 `&nbsp;`、`&amp;`、`&quot;`、`&#39;`）。

### 3) main 进程网络请求与 IPC
- 在 `electron/metadata.ts`：
  - 抽取共享 `fetchWithTimeout`（复用既有实现）
  - 新增 `ipcMain.handle('meta:lookup-douban', ...)`
  - handler 内：
    - `extractDoubanSubjectId(input)` → subject id
    - 组装 URL 并 fetch（加 User-Agent/Accept-Language 头，避免被目标站点直接拒绝）
    - 按 status code 映射错误（404→not_found；其它非 ok→network）
    - `res.text()` → `parseDoubanSubjectHtml`
- 在 `electron/preload.ts`：
  - `window.meta.lookupDouban = (input) => ipcRenderer.invoke('meta:lookup-douban', input)`
- 在 `src/vite-env.d.ts`：
  - 增加 `lookupDouban` 的类型定义（返回值结构与错误枚举）

### 4) Inventory UI 接入
- 在 `src/pages/Inventory.tsx`：
  - 新增 `doubanInput` state（与 ISBN state 独立）
  - 增加 `fillMetadataByDouban(input)`：
    - 设置 `metaStatus` 为 loading
    - 调用 `window.meta.lookupDouban(input)`
    - 成功：`mergeBookDraftWithMetadata` 合并并提示 success
    - 失败：映射错误为用户可读提示（invalid_url/not_found/timeout/network/bad_response）
  - UI 上增加一行输入框（“Douban URL/ID”）与 Fill 按钮，按钮 disabled 逻辑与 ISBN Fill 类似（非空即可）
- 可选增强（实现阶段决定是否纳入本次范围）：
  - 若用户在 ISBN 输入框粘贴了豆瓣链接，自动迁移到 doubanInput 并提示用户使用豆瓣 Fill（不自动发请求，仍保持“显式动作”约束）。

## Task Breakdown
- [ ] 新增 Douban URL/HTML 解析纯函数与单元测试
- [ ] 在 main 进程新增 `meta:lookup-douban` IPC 与 preload 暴露
- [ ] 在 Inventory Add Book 增加豆瓣链接填充 UI 与状态提示
- [ ] 更新文档：API surface、external constraints、threat model

## Validation Plan
- 单元测试：
  - `extractDoubanSubjectId`：合法 URL/ID、非法域名、缺 subject、非数字等
  - `parseDoubanSubjectHtml`：最小 fixture 提取 title/author/publisher/isbn/cover，及缺失字段/结构变化返回错误
- 手动验证（dev 环境）：
  - 粘贴示例 URL：能填充 title/author；ISBN 自动回填（如页面包含）并可继续用原 ISBN Fill
  - 非豆瓣 URL：提示“链接无效”，不发起网络请求
  - 断网/超时：提示错误且不影响手动保存流程
- 工程质量：
  - `pnpm test`、`pnpm lint`、`pnpm build` 通过

## Rollout Plan
- MVP 内默认启用该输入入口；仍保持“用户显式点击”才能请求外部站点。

## Rollback Plan
- 保留原 ISBN 填充能力；
- 若豆瓣页面结构/反爬导致稳定性差，可快速移除 UI 入口并保留解析/IPC 代码为后续适配基础（或整体回滚该能力）。

## Decision Log
- 2026-03-16: 采用“main 进程 fetch + IPC 暴露”以集中治理外部请求与超时，避免 renderer 直接抓取页面
- 2026-03-16: 解析实现坚持零新增依赖，采用稳健的多路径字段提取与单测夹具覆盖

## Status Updates
- 2026-03-16: created

