---
title: "Apple Native Architecture"
owner: engineering
status: proposed
last_reviewed: 2026-09-23
review_cycle_days: 30
---

# Apple 原生架构设计

## 1. 决策

TomeKeep 采用单仓库、单 Xcode 工程、iOS/macOS 两个 App Target、一个本地 Swift Package 的架构。Swift Package 内使用多个 Target 表达真正的编译边界，不为每个目录创建独立 Package。

Electron 与 PWA 在迁移期作为兼容实现保留，原生双端通过验收后删除。Cloudflare 服务端继续使用 TypeScript/Hono/D1/R2，但从 PWA 工程中独立出来。

## 2. 理由

- 两个 Apple 平台可以共享业务和基础设施，同时保留符合平台习惯的 UI。
- 两个 App Target 可以独立配置 entitlement、权限、Bundle ID、签名和发布。
- 一个 Swift Package 可以减少模块漂移和构建配置重复。
- 单仓库允许客户端、服务端、契约和迁移器原子演进。
- 原生实现无需保留 Chromium、Node 或 Web 运行时。

## 3. 模块边界

```text
TomeKeepIOS ─────┐
                 ├─ TomeKeepFeatures ── TomeKeepDomain
TomeKeepMac ─────┘          │                  │
                            ├─ Persistence ────┤
                            ├─ Sync ───────────┤
                            ├─ Metadata ───────┤
                            ├─ Networking ─────┤
                            └─ DesignSystem
```

### TomeKeepDomain

纯值类型和业务规则。不得依赖 SwiftUI、SwiftData、WebKit 或网络传输类型。

所有业务 ID 在领域层按不透明 `String` 保存。即使当前 Electron 通常生成 UUID，迁移器也不得通过 UUID 解析来拒绝、规范化或重写历史 ID。

### TomeKeepPersistence

SwiftData 模型、Schema 版本、本地 Repository、outbox、tombstone 和事务。持久化模型不得直接泄漏到 Feature API。

### TomeKeepNetworking

API DTO、URLSession、Keychain 会话、请求错误和契约编码。第三方元数据网络访问不放在这里。

### TomeKeepSync

同步状态机、游标、幂等、冲突、重试与修复。同步引擎消费 Domain snapshot，不直接驱动 SwiftUI。

### TomeKeepMetadata

ISBN、豆瓣、OpenLibrary、isbnsearch、封面判断和共享 fixtures。WebKit 窗口呈现留在 App Target。

### TomeKeepFeatures

可共享功能状态和复用价值明确的 SwiftUI 内容组件。导航、窗口、菜单和扫码等平台 Shell 不放入共享模块。

### TomeKeepDesignSystem

语义颜色、字体、间距、书封组件、状态组件、无障碍和动效约定。避免创建替代系统控件的自制组件库。

## 4. 平台边界

### iOS

- NavigationStack/Tab 导航。
- VisionKit/AVFoundation ISBN 扫描。
- 相机权限、声音与触觉。
- iOS 生命周期和后台刷新适配。

### macOS

- NavigationSplitView、Commands、多窗口和键盘。
- 价格抓取、零售商会话和 Ollama。
- 伴侣服务。
- Electron 数据导入。
- macOS 签名、公证和更新。

## 5. 服务端边界

最终服务端只承担：

- 账户、邀请与权限。
- 业务数据同步。
- 封面文件存储。
- 需要跨端共享的价格结果。
- 健康、审计和必要运维能力。

原生客户端直接访问第三方元数据网站。PWA 存续期间，其代理路由继续保留；PWA 删除后再删除代理、Cookie 登录适配和静态站点托管。

服务端内部边界：

```text
HTTP routes -> application services -> repositories -> D1/R2
```

路由不得直接承担跨资源业务事务，仓储不得执行授权决策。

## 6. 契约

`contracts/` 是 Swift 与 TypeScript 间的协议真源，包含 OpenAPI、JSON Schema 和固定 fixtures。公共 API 变更必须同时更新契约、Swift 测试、服务端测试和生成文档。

## 7. 并发模型

- UI 与 Feature state 在 MainActor。
- URLSession 使用 async/await；异步不等于自动离开 actor。
- 同步可变状态由单一 sync actor 管理。
- CPU 密集型图片或 HTML 处理只有在性能证据支持时使用并行执行。
- 使用结构化并发和有界 task group。
- 不使用 `Task.detached` 作为普通后台队列。

## 8. 数据迁移

原生预览版使用 `com.tomekeep.app.nativepreview` 和独立数据目录。迁移器读取旧 `~/Library/Application Support/TomeKeep`，写入新容器，并生成可验证 manifest。旧目录永不由迁移器修改。

正式 Bundle ID、Mac App Sandbox 与发布渠道在实现迁移器前形成单独 ADR，因为该选择决定是否可静默读取旧 Application Support 目录。

## 9. 最终仓库结构

```text
TomeKeep/
  apple/
    TomeKeep.xcodeproj
    apps/ios
    apps/macos
    packages/TomeKeepKit
    ui-tests
    configurations
    previews
  server/
    src
    migrations
    tests
  contracts/
  migration/
  docs/
  scripts/
  .github/workflows
```

## 10. 被拒绝的替代方案

### 保留 Electron + 单独增加 iOS

拒绝原因：长期存在双语言领域逻辑、不同元数据会话和重复 UI 维护。

### PWA/WebView 套壳

拒绝原因：无法满足本机第三方访问、原生扫描、平台交互和统一 Mac/iOS 核心的目标。

### 单一 App Target

暂不采用。macOS 独有的价格、菜单、窗口和迁移能力较多，两个 Target 更清晰。未来平台差异显著减少时可重新评估。

### 新建平行仓库

拒绝原因：客户端、服务端、契约和迁移无法原子更新，增加版本错配和文档漂移风险。

## 11. 迁移期兼容原则

- 旧客户端继续构建和运行。
- API 先扩展后收缩。
- 数据库迁移只做向后兼容变化。
- 新客户端不写旧本地目录。
- 删除旧代码必须通过执行计划中的清理门禁。
