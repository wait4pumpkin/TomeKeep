---
title: "比价改造：渠道跳转 + 用户手动选品采价回写"
owner: "assistant"
status: draft
last_reviewed: 2026-03-19
review_cycle_days: 14
linked_specs:
  - docs/product-specs/book-management.md
  - .trae/documents/plan-wishlist-price-compare.md
---

# Execution Plan: 比价改造（渠道跳转 + 用户手动选品采价回写）

## Context
现有比价实现以“自动抓取”为主：主进程通过 `session.fetch` 拉取搜索页/价格接口，并在必要时用隐藏 `BrowserWindow` 渲染 JD 搜索页提取 SKU。由于渠道风控、验证码、登录态差异等现实约束，自动抓取经常失败，导致“比价”对用户而言不稳定。

用户提出一种更稳健的路径：当用户点击某本书的某个渠道时，应用自动打开渠道页面（搜索结果列表或首页且填充搜索框），由用户自行选择某个商品；应用记录该商品的价格与详情页 URL，并把结果写回应用（同时关闭渠道窗口/回到应用）。

该方案本质是把“决定商品 & 触发页面渲染”交给真实浏览器 + 用户行为，从而绕开大部分反爬对自动抓取的限制；应用只做“用户选择后的信息采集与存储”，并把它作为比价的可信来源之一。

同时用户问到：是否可以直接使用“系统浏览器”完成这一流程。答案是可以打开，但要区分两种层级：
- 仅“跳转到系统浏览器”：应用无法在系统浏览器页面里注入脚本，因此无法自动读出价格/URL；需要用户复制粘贴（或手动录入）。
- 若希望“自动回写”（一键记录并返回应用）：要么在应用内用 BrowserWindow（可控 preload），要么让用户安装/使用 bookmarklet/浏览器扩展这类“页面内脚本载体”（可作为后续增强）。

## Objective
- 当自动抓价处于 `blocked/needs_login/not_found/error` 时，提供“手动选品采价”路径，保证用户仍然能完成购买决策。
- 支持两种手动路径：
  - 应用内渠道窗口（推荐）：复用 `persist:bookstores` 分区，支持“一键回写并自动返回”
  - 系统浏览器（备选/MVP 可先做）：打开搜索页/商品页，用户复制 URL 与价格后回到应用粘贴保存

## Non-goals
- 不做自动下单、加购、支付等任何交易能力。
- 不追求完全自动化匹配（用户选品为主），也不保证所有渠道 DOM 结构长期稳定。
- 不向任意外部页面暴露应用敏感能力；不读取/写出 Cookie 明文；不记录敏感日志。

## Key Constraints (must follow)
- 复用现有安全边界：仅允许白名单域名在“渠道窗口”中打开（当前白名单在 `electron/stores.ts`）。
- 渠道窗口必须保持 `contextIsolation: true`，禁用 Node 集成；仅注入最小的采集能力，且只在白名单域名生效。
- 写入价格缓存遵循既有数据模型：`electron/db.ts` 的 `priceCache`；如需扩展字段，必须同步更新 `docs/generated/api-surface.md`（如 IPC 发生变化）。
- 不新增依赖，除非按 `docs/standards/dependency-policy.md` 走决策记录。

## Approaches (choose 1 for MVP; others can follow)
### Approach A (Recommended): 应用内渠道窗口 + 一键采价回写
- 优点：可以注入受控 preload，从页面读取 URL/价格并自动回写；不依赖用户复制粘贴；更像“功能闭环”。
- 缺点：实现复杂度更高；需要维护少量渠道 DOM 解析与 UI 注入逻辑；仍需严格域名白名单与安全隔离。

### Approach B (Low-risk MVP): 系统浏览器打开 + 应用内“粘贴保存”
- 形态：点击渠道 → 系统浏览器打开搜索页/商品页；用户在页面复制“商品链接”和“价格文本”；回到应用点“粘贴并保存”，应用从剪贴板/输入框解析 URL 与价格并写入缓存。
- 优点：实现快、几乎不受渠道 DOM 变化影响；不涉及对第三方页面注入脚本。
- 缺点：不能自动“从系统浏览器回写并返回”；用户操作多一步；登录态/Cookie 由系统浏览器管理（与应用内抓价的 `persist:bookstores` 不共享）。

### Approach C (Optional later): 系统浏览器 + bookmarklet/自定义协议回跳
- 形态：提供一个 bookmarklet（用户手动添加到浏览器书签栏）。在商品页点击后运行脚本：抓取 URL/价格（或弹窗让用户确认）→ 打开 `tomekeep://capture?...` 回到应用。
- 优点：仍用系统浏览器，但能实现“一键回写并回跳”体验。
- 缺点：需要注册自定义协议、兼容不同浏览器的限制、用户需要一次性安装配置；安全审计面更大。

### Approach D (Chrome-only): Chrome 扩展一键采价 + 与 App 通讯
前提：可以接受“只支持 Chrome”，并愿意增加一个轻量的 companion extension。

可行的通讯方式（从易到难、从 MVP 到增强）：
- D1（最易/MVP）：扩展采集 → 打开自定义协议 `tomekeep://capture?...`
  - 扩展在商品页注入 content script，读取 `url + 价格文本`（或让用户在弹窗里确认/编辑），然后通过打开自定义协议把 payload 交给应用。
  - 应用注册协议处理（Electron 支持），收到后校验域名白名单与数值合法性，写入 `priceCache`，并弹出应用内提示。
  - 限制：payload 大小受 URL 长度限制；协议打开可能触发浏览器提示；其它网页理论上也能触发协议，需要校验来源与增加防滥用措施。
- D2（更强/更稳）：扩展采集 → POST 到 `http://127.0.0.1:<port>/capture`（App 本地服务）
  - 应用启动本地 loopback 服务并生成随机 token；扩展用 token 授权后直接发请求，App 同步返回写入结果。
  - 限制：需要引入本地服务生命周期/端口管理与 token 配对；属于“运维行为”，需补充 ops/security 文档。
- D3（最强/最重）：Chrome Native Messaging
  - 扩展通过 Native Messaging 与本机应用直接通讯（无需本地端口），安全性与体验最好。
  - 限制：需要安装 Native Messaging host manifest（随应用安装/更新），打包与分发流程复杂度更高。

推荐取舍：
- 若优先“最少工程量 + 体验接近一键回写”：D1
- 若优先“稳定 + 有回包 + 不依赖协议弹窗”：D2

## UX Flow
### Entry
- Wishlist 每本书的每个渠道行新增按钮：
  - “打开渠道”= 仅打开页面（复用现有 `stores:open-page`）
  - “手动选品”= 打开“采价模式”的渠道窗口（Approach A）
  - “系统浏览器”= 用系统默认浏览器打开（Approach B）
- 自动抓价失败时（blocked/needs_login/not_found/error），在渠道状态文案旁优先提示“手动选品”入口。

### In-channel (采价窗口)
- 打开渠道“搜索结果页”优先（可直接通过 URL query 拼接），否则打开首页并提示用户手动搜索。
- 用户完成验证码/登录后继续浏览。
- 当用户进入商品详情页时，页面右下角出现一个“保存到 TomeKeep”浮层按钮：
  - 点击后尝试从当前 DOM 提取价格（失败则允许用户手动输入价格）
  - 展示确认面板：渠道、当前 URL、价格、时间
  - 用户确认后：写回应用并自动关闭窗口，应用内该书的该渠道报价立即更新。

### Return
- 采价成功：Wishlist 该条渠道报价更新为“手动采集”，展示更新时间与详情页链接。
- 采价失败/用户关闭窗口：不写入缓存，回到原状态。

### Return (系统浏览器路径)
- 用户从系统浏览器复制后，在 Wishlist 里打开“粘贴保存”小面板：
  - 输入框/剪贴板解析：提取第一个 `https://...` 作为 url；从剩余文本中提取形如 `¥12.34` 或 `12.34` 的数字作为 price
  - 用户确认后保存；不要求自动回跳（因为用户本就已在应用内）

## Technical Design
### 0) 系统浏览器路径实现要点（Approach B）
- 复用现有 `app:open-external` 打开系统浏览器（当前已存在）。
- 新增一个 IPC：`pricing:save-manual`（input：`{ key, channel, url, priceCny }`），主进程做校验并写入 `priceCache`。
- 渲染层提供一个最小表单（含“从剪贴板粘贴”按钮；如果不引入新依赖，解析逻辑用正则即可）。

### 1) IPC 形态
新增一个“打开采价窗口并等待结果”的 IPC（主进程 handle，渲染端 invoke）：
- `stores:open-capture`（input：`{ channel, key, title, isbn? }`；output：`{ ok: true, quote } | { ok: false, error }`）

设计要点：
- 主进程创建 BrowserWindow，并为该窗口绑定一次性的 “capture promise”。
- preload 注入后，通过 `ipcRenderer.send` 把采集结果回传主进程（仅允许一个固定 channel 名）。
- 主进程校验 payload（channel/price/url/time），写入 `db.data.priceCache[key]`，然后 resolve promise 并销毁窗口。

### 2) 渠道窗口与 preload
新增一个专用 preload（与主窗口 preload 分离）：
- 仅暴露一个最小 bridge：`capture(payload)` / `close()`，并在页面注入浮层 UI。
- 注入逻辑：
  - 监听 URL 变化（SPA/跳转）与 `DOMContentLoaded`
  - 当 URL 命中“可能是商品页”的规则时显示按钮（如 JD `item.jd.com/*`，当当 `product.dangdang.com/*`，中图网 `bookschina.com/*`）

安全要点：
- 在 `electron/stores.ts` 的域名白名单基础上，进一步限制 preload 只对明确的 host 生效；其它 host 不注入任何 UI。
- 禁止浮层读取除价格/标题等页面公开信息外的任何内容。

### 3) 价格提取策略（手动优先兜底）
为每个渠道实现“尽量稳定”的提取：
- JD：优先从常见价格节点/脚本变量取值；失败则引导用户手动输入。
- Dangdang / BooksChina：同上。

实现形态：
- 在主进程或共享库中定义 `extractors[channel]`：输入为页面 HTML/DOM query 结果，输出 `priceCny | null`。
- 不保证 100% 成功，因此 UI 需要可编辑价格输入框作为最终兜底。

### 4) 数据落库与展示
现有 `PriceQuote` 结构用于自动抓价。为区分来源，建议扩展（最小增量）：
- `source?: 'auto' | 'manual'`
- `capturedAt?: string`（ISO）

写入策略：
- 手动采价成功后，更新该 `key` 的 `quotes` 中对应渠道项：
  - 若已有渠道 quote：覆盖 `priceCny/url/fetchedAt/status/message` 并标记 `source:'manual'`
  - 若不存在：追加新 quote
- `expiresAt` 仍可沿用 TTL；但当来源是 manual 时，UI 可选择弱化“过期”提示（或保留一致策略）。

### 5) 与现有自动抓价的关系
- 不替换自动抓价；作为失败时的稳定 fallback。
- 可选增强：当手动采价存在时，自动刷新仅在用户强制刷新时覆盖 `source:'manual'`（默认保留手动结果）。

## Impacted Areas (expected)
- 主进程：
  - `electron/stores.ts`：新增 `stores:open-capture`，以及采价窗口的创建/回传/落库
  - `electron/db.ts`：如需扩展 `PriceQuote` 字段（source/capturedAt）
  - `electron/preload*.ts`：新增专用 capture preload（避免污染主窗口 preload）
- 渲染层：
  - `src/pages/Wishlist.tsx`：新增“手动选品”入口与结果展示文案
  - `src/lib/pricing.ts`：可选新增 URL/页面类型判定工具（不引入新依赖）
- 文档：
  - `docs/references/external-constraints.md`：补充“手动选品采价回写”作为官方应对策略
  - `docs/generated/api-surface.md`：如新增 IPC，需要更新

## Task Breakdown
- [ ] 选择 MVP 路径并实现（A：应用内采价窗口 / B：系统浏览器粘贴保存）
- [ ] 实现手动结果写入 priceCache（含来源标记与覆盖策略）
- [ ] 更新 Wishlist UI（入口、状态提示、结果展示）
- [ ] 补齐测试与文档更新

## Validation Plan
- 手工验证（最重要）：
  - JD/Dangdang/BooksChina：从 Wishlist 打开采价窗口 → 搜索 → 进入商品页 → 点击“保存到 TomeKeep” → 回到 Wishlist 更新成功
  - 命中验证码/登录：用户完成后仍可继续并采集成功
  - 用户关闭窗口/取消：不写入缓存
- 单元测试（Vitest）：
  - 采集 payload 校验与落库覆盖策略（纯函数化后测试）
  - extractor：给定 DOM 片段或字符串，能解析出价格或返回 null（不要求全覆盖）

## Rollout / Rollback
- Rollout：默认作为自动抓价失败时的引导入口；不改变现有自动抓价路径的默认行为。
- Rollback：保留“打开渠道”能力，移除 `stores:open-capture` 与专用 preload 即可；db 新增字段保持向后兼容（可选字段）。

## Open Questions (decisions to confirm before implementation)
- MVP 先走哪条路径？
  - A：应用内采价窗口（一键回写）
  - B：系统浏览器 + 粘贴保存（更轻量）
  - D：Chrome 扩展一键采价（更像“系统浏览器版一键回写”）
- 手动采价是否允许用户直接在搜索列表页选择（无需进详情页）？（MVP 建议只支持详情页，降低 DOM 兼容成本）
- 手动结果是否应默认优先于自动结果（直到用户强制刷新）？
- 价格字段是否只存 CNY（当前为 CNY），以及是否需要记录运费/券后价等扩展字段（MVP 不做）。
