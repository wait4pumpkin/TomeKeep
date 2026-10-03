---
title: "Apple Native Client Unification"
owner: engineering
status: active
last_reviewed: 2026-10-01
review_cycle_days: 14
---

# Apple 原生客户端统一执行计划

## 当前进度（2026-09-25）

- Phase 0 进行中：功能矩阵、架构、产品规格和首轮 API 消费/安全审计已建立。
- 已关闭首轮问题：跨账户 ReadingState 引用、畸形 JWT 500、元数据错误泄露、默认档案 ReadingState 重复。
- 已删除仓库静态扫描确认零消费者的三个接口；Electron/PWA 仍使用的兼容接口全部保留。
- `apple/` 双 App Target 与共享 Swift Package 骨架已建立，旧 Electron/PWA 未移动或删除。
- iOS 已通过远程 Xcode 构建，并在远程模拟器完成启动与可访问性树检查。
- 共享 Swift Package 的领域、ISBN 与书库仓储测试 5 组通过，iOS 真机契约测试 3/3 通过；原有 TypeScript 测试、PWA typecheck/build 均通过。
- `0004_reading_state_default_uniqueness.sql` 已在隔离 SQLite 中验证去重、partial unique index 和空 profile upsert。
- macOS Target 已使用本机 Xcode 26.3、macOS destination 完成 Debug 构建；Limrun CLI 固定传入 `platform=iOS Simulator` 的远程工具问题不再阻塞源码验收。
- USB iPhone 13 Pro 已识别，开发者模式开启；使用 Team `L2BT252BF2` 完成真机签名构建、安装并启动 `com.tomekeep.app.nativepreview`。
- 原生双端已不再显示纯迁移占位页；首个可验收垂直切片已提供本机书库列表、手工/ISBN 录入、ISBN-10/13 校验与标准化、标题/作者/ISBN 搜索、编辑和软删除。
- 首个切片使用共享 `BookRepository` 与 SwiftData 存储，iOS/macOS 复用同一领域和持久化实现；仓储测试覆盖新增、编辑、重复 ISBN 拒绝和软删除。
- macOS 功能版已完成本机构建、启动和录入表单可访问性检查；iOS 功能版已完成签名构建、重新安装、启动和真机 XCTest。
- Electron 本地数据只读导入器已完成，并对当前真实数据执行成功：366 本藏书、219 项愿望、2 个档案、279 条原始阅读状态（10 条完全重复规范化为 269 条）、25 条价格缓存、585 张有效关联封面。导入生成逐记录与逐封面 SHA-256 报告，重复执行保持幂等，源 `db.json` 哈希不变。
- 原生仓储已覆盖愿望单 CRUD/原子移入书库、多档案、阅读三态/完成日期和价格缓存读写；SwiftData 已切换到 `1.0.0` 版本化 Schema 和显式迁移计划；Swift Testing 当前 48 项、10 个测试套件通过（3 项外部集成探测默认跳过并已分别单独通过），含 10,000 本书库性能基线（本机约 2.2 秒完成写入、读取与检索）。
- macOS 已加入书库封面网格/详细视图、8–20 列调节与偏好恢复、多标签 AND/阅读状态筛选、完成日期升降序、阅读徽标/进度、ISBN 语义复制、愿望单、阅读档案、价格历史及数据迁移界面。
- ISBN 元数据已实现客户端直连豆瓣 → OpenLibrary → isbnsearch 的瀑布流与本地封面缓存；OpenLibrary 已迁移到当前 Search API，书名/作者可直连豆瓣搜索并选择候选关联；真实 OpenLibrary ISBN 与豆瓣标题搜索探测通过，不会调用 TomeKeep 服务端元数据代理。应用内网站登录/验证码恢复已实现，真实验证码会话仍需人工触发验收。
- iOS 已加入原生 Tab 信息架构和 AVFoundation 单次/连续 ISBN 扫描入口；连续模式保持相机运行、实时标记识别范围、抑制重复结果、串行补全元数据并显示最近三条导入状态，查询失败仍保存 ISBN 占位记录。模拟器和签名真机构建、覆盖安装、启动均通过，实体书连续实扫待人工验收。
- 原生认证已接入 Bearer Token 与系统 Keychain；支持会话恢复、退出，以及启动、回到前台、登录成功和显式手动同步。本地书库、愿望、阅读状态、档案、封面与价格变更会请求自动同步；应用级协调器将并发请求串行化并合并为至多一个后续周期，设置页显示同步中、最近结果和失败原因。共享同步引擎已覆盖 250 条稳定分页（并兼容旧数组响应）、inclusive cursor、档案 outbox/tombstone、书库/愿望单 tombstone、阅读状态、封面上传下载和本机较新记录保护。
- 管理员登录后可在原生设置页分页读取、创建及删除未使用的邀请码；删除前使用原生确认对话框。
- 原生双端已支持邀请码注册、注册后 Keychain 会话保存；服务端注册改为 D1 条件事务批次，避免并发重复消费邀请码。
- macOS 愿望单新增时会并发查询京东、当当和中图网，使用本机 Ollama HTTP 匹配与 bigram 回退；真实 `qwen2.5:3b` 调用已验证并修正提示词，避免模型照抄示例索引；可见 `WKWebView` 支持手工采价，Cookie 留在应用网站数据存储中，登录/验证码窗口关闭后自动重试；价格历史支持识别并清除手工来源标记。三渠道实时公开端点探测通过，动态 DOM 仍需持续跟随网站变化回归。
- 真实 App Sandbox 数据落点已完成校正：容器库通过 `integrity_check`，包含 366 本藏书、219 项愿望、2 个档案、269 条阅读状态、25 个价格缓存和 585 张封面；被替换的空库及 WAL/SHM 已保留为 `preimport-20260924` 可恢复备份。
- macOS 真实界面巡检已读取到 366 本藏书、219 项愿望、95/366 当前档案阅读进度、25 组价格历史和迁移封面；侧栏、深色模式、无障碍树与“前往”快捷菜单正常。
- 服务端 `0005_profile_tombstones.sql` 已应用到本地 D1；档案软删除与阅读状态清理使用原子 batch，并拒绝删除最后一个活动档案。封面上传/导入改为文件魔数校验。
- `0006_price_cache_sync.sql` 与 `0007_price_cache_backfill.sql` 已应用到本地 D1；旧价格行会补齐原生读取字段，macOS 生成的渠道报价通过 owner-scoped、HTTPS-only、LWW 接口分页同步，iOS 只读取合并结果，不执行零售商抓取或上传。
- SwiftUI 界面已建立简体中文源语言与英文资源：311 个静态及运行时界面键全部有中英文翻译；独立 `Runtime.strings` 表保证 SwiftPM 与 Xcode 使用相同结果。资源与格式化测试、双端 Bundle 检查以及 macOS 书库、愿望单、阅读档案、价格历史、设置和采价面板的英文界面巡检均已通过。
- macOS 愿望单已补齐详细/封面双视图、8–20 列偏好、作者排序和升降序；书库与愿望单都可再次打开保存的豆瓣/元数据关联页面。浅色/深色、⌘1–⌘4 导航、新建窗口与迁移数据可访问性树均已完成真实界面巡检。
- 用户验收发现原生版在标签直达、标签颜色、高密度卡片布局、编辑预填和滚动流畅度上弱于旧版，macOS 状态已退回继续开发。首轮修正已恢复一键彩色标签条，将封面网格收敛为固定比例封面与书名，移除悬停缩放/重阴影，加入封面缓存，并用携带记录的 Sheet 路由修复编辑空表单；完整复审见 `docs/design-docs/mac-native-ui-review.md`。
- 第二轮信息架构修正将 macOS 侧边栏恢复为 64 pt 窄图标结构：书库、愿望单置顶，阅读档案与设置置底，所有按钮使用一致的 40×40 pt 居中命中区；价格记录改为愿望单上下文面板，数据迁移移入设置。排序与阅读状态改回持续可见的一键图标组，并按用途分别成组，不再依赖菜单。标签条移除会拦截点击的横向滚动容器。封面改为在固定画布内完整缩放且卡片裁切到网格列，已用《白痴》《天朝的崩溃》《寂寞的游戏》针对性巡检。
- 第三轮旧版体验对齐恢复了侧边栏语言与外观入口，并统一书本、星标、云朵、人物等既有图标语义；“详细视图”由单行列表恢复为自适应信息卡片网格，“简要视图”保留高密度封面网格。搜索、阅读状态、排序和视图切换已按旧版任务层级拆分到内容控制栏，避免挤占窗口标题栏；应用内语言切换的搜索占位文本二次本地化问题同步修复。
- 第四轮旧版体验对齐为按添加/完成时间排序的详细、简要视图恢复年/月分组；标签改为中性未选中、类别色填充选中，同时消除 BGG 与大宝撞色。侧边栏固定为不可隐藏的 80 pt 宽度，人物入口收敛为用户切换，不再展示额外阅读状态页；封面网格恢复独立大图预览，“跟随系统”不再残留强制配色，原生双端开始复用旧版 App 图标。
- 第五轮细节优化从根布局移除可折叠侧边栏能力及系统隐藏入口，扩大排序和视图分组按钮的完整命中区域，去掉标签选中态的冗余勾号，并将阅读状态由高饱和投影徽标收敛为浅色、小尺寸、无阴影的辅助标记。
- 第六轮稳定性优化让书库与愿望单在标签筛选无结果时继续占满内容画布，确保搜索、筛选、排序和视图按钮保持置顶；设置页补齐与其他一级页面一致的工具栏高度，并显式使用应用内语言标题。
- 第七轮详细视图对齐为顶部图标控制补充即时悬停说明；详细书籍卡片移除整卡编辑手势，恢复右上角阅读状态循环、ISBN 语言/地区解析、书名复制与删除按钮，并采用卡片内嵌的书名、作者、出版社、ISBN 和标签编辑，新增流程与 iOS 编辑流程仍保留完整表单。
- 第八轮详细卡片优化恢复旧版标签的原位新增与删除，并统一阅读状态、关联、复制、编辑和删除操作的即时悬停说明及高亮；删除图标仅在悬停时使用红色，卡片封面、元数据、标签与底栏间距进一步收紧。
- 第九轮详细卡片结构对齐移除底栏关联按钮，改为点击书名打开来源页面；编辑提示统一为“编辑”，编辑态不再重复提供标签字段。卡片上半区固定为封面等高的 112 pt，右侧书目信息垂直居中，下半区专注 ISBN、完成日期与复制、编辑、删除操作。
- 标签原位新增补充 macOS 点击外部失焦处理：点击输入框以外的窗口区域会结束本次输入，非空内容按原规则规范化并保存，空内容直接关闭，不再遗留悬空的输入控件。
- 详细与简要视图统一恢复封面悬停放大入口；大图不再创建独立 Sheet/窗口，而是在当前页面遮罩中只显示封面，点击背景或按 Escape 关闭。简要视图改回老版的行内展开模型：点击封面展开详细卡片并在其中编辑，书名保持来源链接语义。
- 简要视图移除封面上的阅读状态叠层；展开卡片增加点击外部自动收起，并以 200 ms 强缓出曲线完成透明度与轻微比例过渡。切换目标可从当前动画状态继续，系统启用减少动态效果时退化为纯淡入淡出。
- 心愿单首轮旧版交互回归恢复全部/待购买与无标签筛选、详细卡片待购切换/最低价/移入书库/比价/标签维护/内嵌编辑/删除，并让简要视图与书库共用原位展开和外部点击收起模型；软删除新增 5 秒撤销入口，价格历史与优先级等原生新增能力继续保留。
- 本地 Pages API 集成测试已使用 `admin/admin` 与 `mushroom/mushroom` 验证管理员/普通用户登录、`/auth/me` 会话恢复及邀请码读取；未改写用户的远端生产数据。
- 京东、当当和中图网实时直连探测已逐渠道运行并返回受支持结果；京东可见登录页已在内嵌浏览器呈现，零售商 WebView 增加加载中 URL 与失败提示。本轮未写入或覆盖用户价格数据。
- 最终回归基线已通过：macOS Debug、macOS `arm64 + x86_64` Release、iOS Simulator Debug、Swift 49 项测试、TypeScript 102 项测试，以及 PWA typecheck/production build。Swift 新增同步协调器的重复请求合并、失败可见性与账户状态测试。本机 Developer Mode 启用后，签名的 macOS XCTest UI runner 已通过迁移书库摘要、愿望单、封面网格、阅读档案和 ⌘1 导航自动化验证。
- iOS 可验收化已启动：移除“阅读档案/价格记录”对主标签栏的占用并收纳到设置，书库补充 PWA 已验证的彩色标签快速筛选、封面/详细视图切换、自适应封面网格、年月分组、下拉刷新、滑动切换阅读状态与删除；iOS 同时开放 Files 迁移入口和设备工具预置迁移包的幂等自动导入。iOS Simulator 与签名真机构建均通过，iPhone 13 Pro 数据写入与实机体验验收进行中。
- iPhone 13 Pro 已完成真实迁移包导入并回读迁移报告：目标端包含 366 本藏书、219 项愿望、2 个档案、269 条规范化阅读状态、25 条价格缓存和 585 张有效封面；随后覆盖安装连续扫码版本，应用容器数据保持不变。
- iOS 愿望单已按 PWA/Mac 的高频交互补齐详细/封面双视图、标签与购买状态筛选、下拉刷新、滑动切换待购买、移入书库、删除以及 5 秒撤销；最新版已重新签名、覆盖安装并启动在 iPhone 13 Pro。
- 修复 iPhone 原生呈现基线：Target 现在生成 `UILaunchScreen` 并声明双设备族方向，消除无启动屏导致的上下黑边与兼容缩放；iOS App Icon 改为 1024×1024、无透明且未预裁圆角的全幅资源。为清除 iOS 启动画布/图标缓存已执行一次干净重装，重装前完整备份 135 MB `Library` 容器并通过 SQLite `integrity_check`，恢复后回读确认仍为 366/219/2/269/25 条核心记录。
- 自动同步协调器版本已重新签名、覆盖安装并在 iPhone 13 Pro 启动；应用数据容器 UUID 保持不变。启动同步后只读导出的 SwiftData 主库通过 `integrity_check`，仍包含 366 本藏书、219 项愿望、2 个档案、269 条阅读状态、25 条价格缓存和 585 张封面，三类可写同步记录的 pending 数均为 0。
- iOS 愿望单新增表单已与书库统一为中/大两档原生 Sheet，并移除仅适合 macOS 的 480 pt 最小宽度；书库、愿望单和设置的 iOS 一级标题统一为紧凑显示，减少顶部空白。原生双端新增剪贴板导入，识别豆瓣详情 URL、ISBN 与书名；macOS 保留新增时自动解析豆瓣 URL，iOS 根据系统粘贴隐私采用明确点击后读取。
- iOS 书库与愿望单顶部信息层级继续收敛：一级标题改用更清晰的 `title3 semibold`，常驻搜索栏替换为左上角搜索按钮；点击后在标签条上方展开 38 pt 紧凑搜索框，关闭时清空隐藏筛选并完整归还列表空间。展开/收起支持连续反向操作，并在“减少动态效果”下使用淡入淡出。
- 原生双端多端同步能力复核完成：iOS/macOS 共用同一 `NativeSyncEngine`，在启动、前台、登录、本地变更和手动操作时重放 SwiftData pending 数据；默认生产 API 在线，但完整原生协议仍需随本地服务端改动和 0004—0007 D1 迁移正式发布。参考 bushbaby 加入两台已配对 iPhone 的统一签名/覆盖安装脚本，以及 launchd 到期前 48 小时自动重签和多时段重试；后台构建使用 Application Support 私有快照，避免 Documents 权限阻塞。
- 双机真实部署已使用同一签名构建覆盖安装到 iPhone 16 Pro 与 iPhone 13 Pro，两个既有数据容器均保持不变。Xcode Accounts 重新登录后，强制刷新已生成有效至 2026-10-10 18:38（Asia/Shanghai）的双设备描述文件并更新 launchd 私有快照，自动续签链路闭环。
- 原生客户端继续采用离线优先启动：钥匙串已有 TomeKeep Token 时直接恢复并自动同步，没有 Token 时只写入本机。为避免状态歧义，iOS/macOS 主界面新增持续可见的“未登录：数据仅保存在本机”提示及设置入口；401 会清除失效 Token 并回到该状态。Xcode/Apple ID 登录不参与业务数据同步。

下一里程碑：完成 iOS 实体书连续扫码、真实数据下的滚动/封面/编辑体验验收，并继续对照 PWA 补齐愿望单和设置细节；macOS 剩余体验问题随后继续优化。

## 1. 目标

使用 SwiftUI 重写 TomeKeep 的 macOS 与 iOS 客户端，在一个 Xcode 工程中维护两个 App Target，并通过共享 Swift Package 统一领域模型、本地持久化、元数据查询、同步和大部分功能状态。

完整交付后：

- macOS 与 iOS 均为原生 SwiftUI 应用。
- 两端均采用本地优先数据流，并直接访问豆瓣、OpenLibrary、isbnsearch 等第三方元数据来源。
- Cloudflare 服务端仅承担认证、业务数据同步、封面存储、价格结果同步及运维能力。
- Electron 和 PWA 从运行时产品与源码中移除。
- Electron 数据导入器、旧数据样例、迁移文档和 Git 历史继续保留。

## 2. 强制约束

1. 原生双端验收完成前不得删除或破坏 Electron、PWA 及其部署流程。
2. 已有本地数据、云端数据、封面、档案、阅读状态、愿望单和价格信息必须无损迁移。
3. 功能行为保持一致；界面和交互允许按 Apple 平台规范重新设计。
4. iOS 不通过 TomeKeep 服务端代理访问第三方元数据或封面。
5. 服务端公开接口必须完成安全审计；确认无调用方的接口才能删除。
6. 删除接口、数据库字段或旧客户端前必须有显式的消费矩阵、回归测试和迁移验证结果。
7. 不引入未记录的环境变量或未经评审的第三方运行时依赖。

## 3. 范围

### 3.1 包含

- SwiftUI macOS 客户端。
- SwiftUI iOS 客户端。
- 共享 Swift 领域、持久化、网络、同步、元数据、功能和设计模块。
- Electron `db.json` 与本地封面的幂等导入。
- 原生端管理员与邀请码管理替代能力。
- 服务端安全审计、边界整理和同步协议加固。
- 原生客户端、服务端与迁移器测试。
- 文档、CI、发布和运维更新。
- 验收完成后的 Electron/PWA 清理。

### 3.2 不包含

- 非 Apple 平台客户端。
- 通过 WebView 包装现有 PWA。
- 使用 TomeKeep 服务端代理原生端的第三方元数据请求。
- 在未验证现有功能前重新设计业务规则。
- 在迁移期让 Electron 与原生 Mac 应用共同写入同一个本地数据目录。

## 4. 目标仓库结构

迁移期新增 `apple/` 与独立 `server/`，旧 `packages/` 保持可构建。最终目录见 [Apple 原生架构设计](../../design-docs/apple-native-architecture.md)。

核心结构：

```text
TomeKeep/
  apple/        # Xcode 工程、iOS/macOS App Target、共享 Swift Package
  server/       # Cloudflare Worker、D1/R2、服务端测试
  contracts/    # OpenAPI、JSON Schema、跨语言契约样例
  migration/    # Electron 数据导入器和旧数据 Fixture
  docs/
  scripts/
```

## 5. 目标数据流

### 5.1 本地业务写入

```text
SwiftUI action
  -> local repository transaction
  -> SwiftData record + durable outbox entry
  -> UI updates from local state
  -> sync engine pushes when authenticated and online
```

网络失败不得回滚已经成功的本地业务操作。失败的 outbox 项必须可在启动、登录、回到前台、后续本地写入和手动同步时重放；同步失败需要在设置页可见，而不能静默丢弃。

### 5.2 第三方元数据

```text
ISBN/title/author
  -> DoubanProvider
  -> OpenLibraryProvider
  -> ISBNsearchProvider
  -> local cover validation/cache
  -> optional R2 file upload
```

豆瓣和 isbnsearch 的登录或验证码通过原生应用内持久化 `WKWebView` 完成。iOS/macOS 共用解析、错误和瀑布流规则，平台层只负责窗口、权限和网站会话呈现。

### 5.3 云同步

原生 macOS 与 iOS 使用同一同步引擎和协议。同步协议必须支持：

- 服务端生成的不透明游标或单调 revision。
- tombstone。
- 幂等写入键。
- 分页拉取。
- 逐条成功、冲突和拒绝结果。
- Books、Wishlist、Profiles、ReadingStates，以及确认需要跨端共享的价格数据。

迁移期保留旧接口供 Electron/PWA 使用；新协议只能以向后兼容方式加入。

## 6. 阶段与退出条件

### Phase 0：基线、文档与安全审计

任务：

- 保存本执行计划、产品规格和目标架构。
- 建立 Electron、PWA、服务端接口与脚本的功能/消费矩阵。
- 建立数据字段、默认值、时间格式、删除语义和错误语义基线。
- 审计认证、授权、IDOR、限流、SSRＦ、上传、日志和数据库并发。
- 为现有接口补充安全负向测试。
- 分类所有接口为保留、加固、迁移后删除或立即删除。

退出条件：

- 当前功能与数据基线可自动验证。
- 高风险安全问题有修复和回归测试。
- 未删除仍被 Electron、PWA 或脚本使用的接口。

### Phase 1：高风险技术验证

建立最小原生工程并验证：

- macOS/iOS 共用 Swift 模块可构建。
- SwiftData Schema、版本和迁移测试可运行。
- 两端直接访问豆瓣、OpenLibrary 和 isbnsearch。
- `WKWebsiteDataStore` 登录状态可跨启动持久化。
- 验证码完成后可以恢复原请求。
- iOS ISBN 单次和连续扫码。
- macOS 三个零售商抓取、可见验证窗口和 Ollama 筛选。
- 旧 Electron `db.json` 与 covers 的只读导入。
- 本地 API 登录、封面上传和离线重放。

退出条件：

- 真机 iOS 与真实 macOS 环境均验证关键链路。
- 无能力被静默替换为服务端元数据代理。
- 无法等价实现的功能形成明确决策记录并由用户确认。

### Phase 2：共享 Swift Core

实现一个本地 Swift Package，包含多个职责明确的 Target：

- `TomeKeepDomain`
- `TomeKeepPersistence`
- `TomeKeepNetworking`
- `TomeKeepSync`
- `TomeKeepMetadata`
- `TomeKeepFeatures`
- `TomeKeepDesignSystem`

约束：

- 领域类型优先使用 `struct`/`enum`。
- Swift 6 严格并发检查。
- App/UI 模块采用 main-actor-by-default；通用库显式保持可由调用方决定隔离。
- 共享可变同步状态放入明确的 actor，不使用 `@unchecked Sendable` 消除警告。
- 新业务测试使用 Swift Testing；UI 自动化使用 XCTest。

### Phase 3：iOS 原生客户端

- 登录、注册和账户恢复。
- 书库、愿望单、档案、阅读状态。
- 搜索、排序、标签、详细/紧凑视图。
- 手输、粘贴、单次扫码和连续扫码。
- 豆瓣搜索、候选关联、详情 URL、登录和验证码。
- 本地封面、R2 上传和重新获取。
- 离线 CRUD、outbox、前台修复和手动同步。
- 管理员和邀请码必要能力。
- Dynamic Type、VoiceOver、深浅色、Reduce Motion/Transparency。

### Phase 4：macOS SwiftUI 客户端

- 完成 Phase 3 的共享业务能力。
- 原生菜单、快捷键、多窗口和高密度管理界面。
- 三渠道自动与手动价格抓取。
- Ollama 匹配与回退算法。
- 第三方登录/验证码窗口。
- 局域网伴侣服务在迁移期保持兼容。
- Electron 本地数据与封面导入入口。

### Phase 5：服务端收敛

- 将 Hono API 从 PWA 工程迁移为独立 Cloudflare Worker。
- 路由、应用服务和仓储边界分离。
- 原生同步协议投入使用。
- 原生客户端只使用 Bearer Token；PWA 存续期继续支持 Cookie。
- 完成安全审计遗留项和全量接口契约测试。
- 在 PWA 删除前保留其元数据与封面代理接口。

### Phase 6：迁移与双轨验收

- 旧 Electron 和新 Mac 应用使用不同 Bundle ID 与数据目录并行安装。
- 迁移前自动创建只读快照和 manifest。
- 对记录数、ID、ISBN、字段、封面 hash 和同步状态进行逐项验证。
- 验证 10,000 本规模下的启动、搜索、滚动和同步性能。
- 验证弱网、断网、Token 失效、服务端冲突和应用强制退出。
- 运行 Electron、PWA、iOS、macOS 和服务端完整回归。

退出条件：

- 已有数据无损。
- 功能对照矩阵无未决缺口。
- 原生双端连续使用无数据丢失或同步阻塞。
- 具备明确回滚路径。

### Phase 7：切换与旧实现清理

仅在 Phase 6 通过后：

- 原生 macOS 接管正式产品身份。
- 下线 PWA 静态站点和 Web 管理界面。
- 删除 Electron、React、PWA、IPC、lowdb 运行时代码及旧构建流程。
- 删除仅服务旧客户端且确认无调用方的服务端接口。
- 保留迁移器、旧数据 fixtures、迁移文档、Git tag 和历史发布信息。
- 更新 README、ARCHITECTURE 和所有 generated 文档为最终结构。

## 7. 数据迁移保证

Electron 导入器必须：

- 只读旧目录。
- 导入前生成 manifest 和备份提示。
- 校验输入 Schema，并显式报告未知字段。
- 在新数据库事务中导入。
- 失败时丢弃未完成的新库，不修改旧库。
- 使用稳定 ID，重复运行不产生重复数据。
- 保留未同步状态和删除语义。
- 校验每个封面的长度和 hash。
- 生成用户可查看的迁移报告。

## 8. 服务端安全审计清单

- JWT header/algorithm/payload/expiration/exception validation。
- Token 生命周期、撤销与设备退出。
- Cookie/Bearer 双认证身份优先级。
- 登录、注册、邀请、管理员初始化限流与并发原子性。
- 每个资源的 owner 授权和跨用户 IDOR 测试。
- JSON、multipart、分页和字段长度上限。
- 图片 magic bytes、尺寸、解码和压缩炸弹防护。
- 外部 URL allowlist、协议、端口、重定向、超时和响应大小。
- 参数化 SQL、事务、幂等和竞态。
- 日志隐私、错误响应脱敏和 correlation ID。
- 未使用接口和部署绑定清理。

## 9. 验证命令与证据

每个阶段应记录实际可运行的命令和产物。最低要求：

- Swift Package 单元测试。
- macOS/iOS Build。
- iOS/macOS UI 自动化。
- 服务端 typecheck、unit、integration 和 security tests。
- 旧 Electron/PWA 在迁移期的 build/typecheck/test。
- 真机截图或视频、迁移报告、安全审计结果。

本轮已执行：

- `pnpm test`：通过（desktop 1、shared 73、web 28，共 102 项）。
- `pnpm --filter @tomekeep/web typecheck`：通过。
- `pnpm --filter @tomekeep/web build`：通过，证明迁移期 PWA 仍可构建。
- `lim xcode build apple --scheme TomeKeepIOS --configuration Debug`：通过（Xcode 26.4）。
- `lim xcode test apple --scheme TomeKeepIOS --configuration Debug`：通过（3/3）。
- `xcodebuild -project apple/TomeKeep.xcodeproj -scheme TomeKeepMac -destination 'platform=macOS' build`：通过（本机 Xcode 26.3）。
- `xcodebuild ... -scheme TomeKeepMac -configuration Release ... build`：通过。
- `swift test`：通过（42 项、9 个套件；实时零售商、元数据和本地 API 集成探测默认跳过）。
- `TOMEKEEP_RUN_LIVE_RETAILER_TESTS=1 swift test --filter liveRetailerEndpointsReturnARecognizedOutcome`：通过（三渠道公开端点，无数据写入）。
- `TOMEKEEP_RUN_LIVE_METADATA_TESTS=1 swift test --filter liveMetadataLookupAndDoubanSearchReturnUsableResults`：通过（OpenLibrary ISBN 与豆瓣标题/作者直连）。
- `TOMEKEEP_LOCAL_API_BASE_URL=http://127.0.0.1:8788/api/ swift test --filter localAPIAuthenticatesAdminAndUserAndRestoresSessions`：通过（管理员/普通用户登录、会话恢复与邀请码读取）。
- 本机 Ollama `qwen2.5:3b` 真实匹配：通过；返回正确候选索引。
- macOS 可访问性驱动巡检：通过浅色/深色、愿望单双视图、作者与方向排序、⌘1–⌘4 导航及新建多窗口。启用本机 Developer Mode 后，签名 XCTest UI runner 也已通过迁移书库摘要、愿望单、封面网格、阅读档案与快捷键自动化。
- 本轮旧版体验对齐后的 macOS 实机巡检：通过完成日期年/月分组、标签选中/未选中语义、80 pt 固定侧栏、仅含档案选择的用户弹窗，以及深色切回跟随系统后整窗恢复系统浅色；旧版 1024×1024 图标与原生 AppIcon 源文件 SHA-1 一致。更新后的 UI 测试源码可构建，但两次 XCTest 运行均在用例执行前因系统 automation mode 初始化超时退出；该环境问题未覆盖上述可访问性驱动巡检结果。
- `xcodebuild ... -scheme TomeKeepIOS -destination 'generic/platform=iOS Simulator' ... build`：通过。
- `xcodebuild ... -scheme TomeKeepIOS -destination 'id=<device>' ... build`：通过；development provisioning profile 自动生成，USB 真机安装成功。
- 远程 iOS 模拟器启动 `com.tomekeep.app.nativepreview`：通过；关键中文文案可由辅助功能读取。
- 隔离 SQLite 依次应用 0001—0004：通过；两个重复默认状态归并为最新一条，随后 upsert 行数保持 1。本地 D1 已继续应用 0005 档案 tombstone。
- `pnpm lint`：未通过，原因是迁移前已存在的 desktop 12 个 error/16 个 warning；本阶段未扩大范围修改旧 UI lint 债务。

## 10. 清理门禁

以下任一条件未满足时不得删除旧实现：

- 数据迁移验证失败或无法回滚。
- 任一现有功能未实现且未得到明确豁免。
- PWA/旧 Electron 仍有活跃迁移依赖。
- 服务端接口消费矩阵不完整。
- 原生客户端发布、签名或更新链路未验证。
- 安全高风险问题未关闭。

## 11. 相关文档

- [Apple 原生客户端产品规格](../../product-specs/apple-native-clients.md)
- [Apple 原生架构设计](../../design-docs/apple-native-architecture.md)
- [Apple 原生功能对照矩阵](../../design-docs/apple-native-feature-matrix.md)
- [Book Management](../../product-specs/book-management.md)
- [API Surface](../../generated/api-surface.md)
- [Threat Model](../../security/threat-model.md)
