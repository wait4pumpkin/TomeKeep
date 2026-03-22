---
title: "扫码支持图书元信息填充"
owner: "engineering"
status: active
last_reviewed: 2026-03-16
review_cycle_days: 14
linked_specs:
  - "../../docs/product-specs/book-management.md"
---

# Execution Plan: 扫码支持图书元信息填充

## Context
当前应用已支持在添加图书时扫码填充 ISBN，但仍需要用户手动输入 Title/Author（必填）。产品规格中提到“系统尽可能自动获取元信息”，本计划将把该能力落地到 MVP 的加书流程中：用户扫码后自动拉取并填充图书元信息（至少 Title/Author；可选 Cover/Publisher）。

## Objective
- 用户在 Inventory → Add Book 中扫码获得 ISBN 后，系统自动查询公开数据源并尽可能填充：
  - Title（必填字段）
  - Author（必填字段）
  - 可选：Cover URL、Publisher
- 提供清晰的加载/失败状态与可控的降级路径（仍可手动编辑/保存）。
- 保持隐私与安全：仅在用户显式触发（扫码或点击获取）时发起查询；不上传任何图像；仅发送 ISBN 作为查询条件。

## Non-goals
- 不做“根据标题/作者模糊搜索再让用户选择”的完整检索 UI。
- 不做多供应商比对、去重、合并规则的复杂编排。
- 不做持久化缓存与离线元数据包。
- 不引入需要 API Key 的服务或新增环境变量。

## Constraints
- 架构边界：UI 只发起“按 ISBN 查询元数据”的应用能力调用；网络请求与供应商选择封装在单一模块中，避免散落在页面组件。
- 可靠性：必须设置超时与错误分支，避免查询卡死影响加书流程。
- 安全与隐私：
  - 查询只发生在用户显式动作之后
  - 不记录/上报 ISBN 或响应内容到日志
  - 不存储摄像头画面
- 依赖策略：优先零新增依赖；如确需新增，必须遵守 `docs/standards/dependency-policy.md`。
- 公共接口文档：若新增/变更 `window.*` 暴露能力，需要更新 `docs/generated/api-surface.md`。

## Scope
### In Scope
- 新增“按 ISBN 获取元信息”的能力（模块化，带超时/错误类型）。
- Inventory Add Book 流程自动触发元信息填充：
  - 扫码成功回填 ISBN 后自动触发一次查询
  - 手动输入 ISBN 后提供显式按钮触发查询（作为降级与可发现性）
- 将返回的元信息合并到表单状态（不覆盖用户已输入的 Title/Author，除非为空）。
- 基础测试：解析与合并规则的单元测试。
- 文档更新：产品 spec、安全/外部约束、API surface（如有接口变化）。

### Out of Scope
- Wishlist 的元信息填充（可复用能力，但本次不改 UI）。
- 图书条目合并、重复检测、自动分类、封面下载缓存。

## Impacted Areas
- modules:
  - `src/pages/Inventory.tsx`（触发查询与表单合并）
  - `src/lib/*`（新增元信息查询与解析模块）
  - `electron/*` + `src/vite-env.d.ts`（如需要通过 IPC 进行网络请求）
- docs:
  - `docs/product-specs/book-management.md`
  - `docs/security/threat-model.md`
  - `docs/references/external-constraints.md`
  - `docs/generated/api-surface.md`（若新增 window 暴露接口）

## Proposed Approach
### 1) 数据源选择（无需 API Key）
- 主要数据源：Open Library Books API（按 ISBN 查询，返回 title/authors/cover/publishers 等）。
- 可选备用：当主源无数据时，使用第二公开源（仅在确认无需 key 且 CORS/可用性满足时启用；否则只保留主源）。

### 2) 网络请求位置：Renderer vs Main
优先方案（推荐）：在 Electron main 进程中完成 fetch，通过 IPC 暴露给 renderer。
- 好处：绕开潜在 CORS 限制；集中处理超时与失败；更利于未来加速/缓存/重试策略。
- 实现方式：
  - main：新增 `ipcMain.handle('meta:lookup-isbn', ...)`
  - preload：`window.meta.lookupIsbn(isbn)`（带类型定义）
  - renderer：Inventory 调用并更新表单

降级方案：若确认目标 API 提供稳定 CORS 且无需额外权限，可直接在 renderer fetch，并保持模块封装。

### 3) 元信息模型与合并规则
- 定义 `BookMetadata`（最小字段集）：
  - isbn13（回显用）
  - title
  - author（单一字符串：优先第一个作者；多作者用逗号拼接）
  - coverUrl（可选）
  - publisher（可选）
- 合并到表单时：
  - `title` 仅在当前为空时写入
  - `author` 仅在当前为空时写入
  - `publisher/coverUrl` 仅在当前为空时写入
  - 将“最后一次填充来源/时间”仅保留在 UI state（不持久化）

### 4) UI 行为
- 在 ISBN 行增加：
  - “Scan”（已存在）
  - “Fill”（新按钮）：当 ISBN 看起来有效（或通过校验）时可点击
- 自动触发：
  - 扫码成功后，若 ISBN 规范化成功，立刻触发一次填充
- 状态展示：
  - loading：显示“正在获取元信息…”
  - success：可选显示“已填充 Title/Author”
  - failure：显示简短错误信息，并保留手动输入路径

### 5) 超时与错误处理
- 对每次查询设置固定超时（例如 5s-8s），并将错误映射为用户可理解的消息：
  - 网络不可用/超时
  - 未找到对应 ISBN
  - 响应格式异常

## Task Breakdown
- [ ] 新增“按 ISBN 查询元信息”的模块（含超时与解析）
- [ ] 选择并接入 Open Library 数据源（必要时通过 IPC 封装）
- [ ] 在 Inventory Add Book 中接入自动填充与“Fill”按钮
- [ ] 为解析与表单合并规则补充单元测试（Vitest）
- [ ] 更新文档（产品 spec、安全、外部约束、API surface 如需）

## Validation Plan
- 单元测试：
  - 解析 Open Library 响应（含缺字段/多作者）
  - 合并规则：不覆盖用户已填写的 Title/Author
- 手动验证：
  - 扫码一本常见 ISBN：Title/Author 自动填充，仍可编辑，保存成功
  - ISBN 无结果：提示“未找到”，表单仍可手动填写并保存
  - 断网/超时：提示错误，且不会阻塞 UI
- 工程质量：
  - `pnpm test`、`pnpm lint`、`pnpm build` 通过

## Rollout Plan
- MVP 内作为加书流程增强默认启用；
- 仅在用户显式动作（扫码/点击 Fill）时触发网络请求，避免后台行为与权限困扰。

## Rollback Plan
- 保留 ISBN 扫码与手动输入能力；
- 如外部数据源不稳定，可快速禁用自动填充入口，仅保留手动录入。

## Decision Log
- 2026-03-16: 首选 Open Library 作为无 key 的 ISBN 元信息来源；网络逻辑优先集中在 main+IPC（避免 CORS 并便于治理）

## Status Updates
- 2026-03-16: created
