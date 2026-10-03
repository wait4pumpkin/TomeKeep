---
title: "Apple Native Feature Parity Matrix"
owner: product-engineering
status: active
last_reviewed: 2026-10-01
review_cycle_days: 14
---

# Apple 原生功能对照矩阵

本表是 Electron/PWA 清理门禁的产品依据。`Required` 功能必须实现并通过验证，除非形成明确豁免记录。

| 领域 | 当前能力 | iOS 目标 | macOS 目标 | 要求 | 验证 |
|---|---|---|---|---|---|
| 认证 | 用户名密码、邀请注册、会话恢复 | 原生 Keychain 会话 | 原生 Keychain 会话 | Required | 原生登录、邀请码注册、失效恢复与退出已实现；本地 API 已验证管理员/普通用户登录及会话恢复，注册 UI 的真实服务验收待完成 |
| 管理 | 管理员登录、生成/查看/删除邀请码 | 基础管理 | 完整管理 | Required | 原生双端已接入管理员邀请码查看、创建和删除；本地管理员邀请码读取与服务端权限负向测试已通过，创建/删除 UI 验收待完成 |
| 书库 | 增删改查、软删除 | 完整 | 完整 | Required | 本地 CRUD/软删除首个切片已实现；同步待验收 |
| 愿望单 | 优先级、待购买、移入书库 | 完整 | 完整 | Required | 原生 CRUD、原子移动与重复 ISBN 仓储测试已通过；iOS 已补充详细/封面双视图、彩色标签快捷筛选、下拉刷新、滑动切换待购买/移入书库/删除及 5 秒撤销；macOS 列表/封面网格和迁移后 219 项真实数据巡检通过 |
| 搜索 | 标题、作者、ISBN | 完整 | 完整 | Required | 本地三字段搜索已实现；10,000 本 SwiftData 写入、读取与检索基线测试通过（本机约 2.3 秒） |
| 排序 | 录入、完成、标题、作者、优先级 | 完整 | 完整 | Required | macOS 书库覆盖录入/完成/标题/作者，愿望单覆盖录入/标题/作者/优先级/待购买，均支持升降序；菜单真实巡检通过 |
| 标签 | 编辑、多标签 AND 筛选 | 完整 | 完整 | Required | 双端均保留页面内一键彩色标签条与多标签 AND 筛选；iOS 标签条可横向滚动，避免窄屏截断；状态持久化已实现，体验回归进行中 |
| 视图 | 详细与紧凑模式 | 手机自适应列表/网格 | 高密度可调网格 | Required | iOS 已提供自适应封面网格与按年月分组的详细列表，并保留搜索、排序、阅读筛选及下拉刷新；macOS 书库与愿望单均有详细/封面视图和 8–20 列调节 |
| 阅读进度 | 多档案、三态、完成日期、进度条 | 完整 | 完整 | Required | macOS 已实现档案切换、三态封面徽标、完成日期、筛选后阅读进度和完成排序；同步与 UI 验收待完成 |
| ISBN 输入 | 手输、粘贴、校验、ISBN-10 转换 | 完整 | 完整 | Required | 双端录入、校验、ISBN-13 标准化及“从剪贴板导入”已实现；剪贴板内容可识别豆瓣详情 URL、ISBN 或书名。macOS 新增表单会自动解析豆瓣 URL，iOS 遵循系统粘贴隐私，仅在用户点击导入后读取；Golden Fixture 待扩充 |
| ISBN 扫描 | 单次、连续、框选、提示音 | 原生相机 | 支持相机或伴侣输入 | Required | iOS 已实现单次与书库级连续 AVFoundation 扫码、实时条码框、重复抑制、触觉反馈和串行批量入库；元数据失败时保留 ISBN 占位记录。模拟器与签名真机构建/安装通过，实体书连续实扫待人工验收 |
| 豆瓣关联 | ISBN、标题作者搜索、详情 URL、登录 | 本机直连 | 本机直连 | Required | ISBN 直连、标题/作者搜索、候选选择、详情解析、剪贴板详情 URL 导入及关联页面重开已实现；在线搜索质量探测通过，真实登录会话重启待完成 |
| OpenLibrary | ISBN 回退 | 本机直连 | 本机直连 | Required | 已改用当前 Search API，解析单测与在线 ISBN 冒烟通过 |
| isbnsearch | 回退、验证码恢复 | 本机直连 | 本机直连 | Required | 直连、占位封面拒绝和验证识别已实现；应用内验证恢复待完成 |
| 封面 | 下载、占位拒绝、本地缓存、R2 | 完整 | 完整 | Required | 迁移封面 hash、本地缓存、上传前压缩、R2 上传与跨端下载已实现；损坏内容会拒绝并在后续同步重试 |
| 价格 | 京东/当当/中图网抓取 | 只读跨端结果 | 自动与手动抓取 | Required | macOS 三渠道并发查询、可见网页手工采价、验证后自动重试、缓存与手工来源标记已实现；价格行经 owner-scoped LWW 接口同步到 iOS 只读展示；三渠道实时探测已确认均返回受支持结果，网页加载失败会显式提示；动态 DOM 商品价仍需持续跟随站点变化回归 |
| 价格匹配 | Ollama + bigram 回退 | 不执行 | 完整 | Required(macOS) | 本机 Ollama HTTP API 与 bigram 回退均已覆盖单测；真实 `qwen2.5:3b` 匹配通过，并已防止模型照抄提示词示例索引 |
| 登录墙/验证码 | 可见浏览器解决后恢复 | 元数据网站 | 元数据与零售商 | Required | 超时、关闭、恢复 |
| 离线 | PWA IndexedDB、Electron lowdb | SwiftData + outbox | SwiftData + outbox | Required | 本地 SwiftData CRUD 与持久化 pending 状态已实现；飞行模式、重启和完整 outbox 验收待完成 |
| 同步 | 写后推送、前台拉取、启动修复 | 共享 SyncEngine | 共享 SyncEngine | Required | Keychain 登录、登录后立即恢复、启动/前台同步、本地写入后合并触发、可见状态与手动重试已实现；共享引擎覆盖 250 条分页、旧数组响应兼容、inclusive cursor、LWW、三类 tombstone、封面与账户隔离档案 outbox。协调器的串行和重复请求合并已有 Swift Testing 回归 |
| 本地化 | 中文/英文 | 完整 | 完整 | Required | 简体中文源语言与英文资源已完成；364 个运行时键在中英文表中保持对称，独立 Runtime 表消除了 SwiftPM/Xcode 解析差异；资源/格式化单测、双端 Bundle 检查及 macOS 英文界面巡检通过 |
| 主题 | Light/Dark/Auto | 系统原生 | 系统原生 | Required | macOS 深色与浅色真实截图巡检均通过 |
| 无障碍 | Web/桌面基础支持 | VoiceOver、Dynamic Type | VoiceOver、键盘 | Required | macOS 核心页面可访问性树与键盘巡检通过；签名 XCTest UI runner 已验证迁移书库摘要、愿望单封面网格、阅读档案和 ⌘1 导航 |
| 快捷键 | Electron 菜单/键盘 | 不适用 | 原生 Commands | Required(macOS) | 原生菜单与 ⌘1–⌘4 页面导航真实巡检通过 |
| 多窗口 | Electron BrowserWindow 辅助窗口 | Sheet/scene | 原生 Window/WindowGroup | Required(macOS) | “新建窗口”已实际创建独立 `WindowGroup` 场景并读取完整迁移数据 |
| 伴侣服务 | 局域网手机扫码 | 原生扫码替代 | 迁移期保留 | Transitional | 旧客户端回归 |
| PWA 安装/离线壳 | Service Worker、manifest | 不适用 | 不适用 | Remove after cutover | 清理清单 |
| Electron 数据 | `db.json` + covers | Files/预置迁移包幂等导入 | 幂等导入 | Required | 双端复用同一只读导入器、SHA-256 与逐记录报告；iPhone 13 Pro 已实际导入 366 藏书、219 愿望、2 档案、279 条源阅读状态（规范化为 269 条）、25 价格缓存和 585 张有效封面，报告与 SwiftData 文件均已从设备回读确认 |

## 允许重新设计的界面

- 导航、页面布局、工具栏、表单组织和视觉层级。
- iOS 的 Tab、NavigationStack、Sheet、上下文菜单和滑动操作。
- macOS 的 NavigationSplitView、Commands、多窗口和键盘工作流。
- 动效、系统材质、空状态和即时反馈。

重新设计不能改变数据含义、删除业务入口、降低键盘/VoiceOver 可用性，或让离线状态下无法执行现有核心操作。

## 明确移除项

这些能力只在原生双端通过验收后移除：

- PWA 安装提示、manifest、Service Worker 和 IndexedDB 缓存。
- React/Tailwind 桌面与 Web UI。
- Electron IPC、preload、BrowserWindow 和 lowdb 运行时。
- PWA 专用元数据与封面代理。
- 旧客户端专用同步接口。

Electron 数据导入器、旧格式 fixtures 和迁移文档不属于可移除项。
