---
title: "ADR: macOS Legacy Data Access"
owner: engineering
status: accepted
last_reviewed: 2026-09-24
review_cycle_days: 90
---

# ADR：macOS 旧数据访问

## 决策

原生 macOS 应用保持 App Sandbox，只通过系统文件选择器获得用户明确选择的旧 TomeKeep 目录或 `db.json` 的只读 security-scoped 权限。应用把解析后的记录和封面复制到独立的原生应用容器，不直接在 Electron 目录上运行。

## 原因

- 旧 Electron 数据位于用户 Library，沙盒应用不应默认获得该目录的永久访问权。
- 文件选择器提供清晰的一次性授权边界，适用于直接分发和可能的 Mac App Store 分发。
- `com.apple.security.temporary-exception.files.absolute-path.read-only` 会把用户目录布局固化到签名权限中，不适合作为正式迁移机制。
- 独立容器保证 Electron/PWA 与原生预览版不会并发写同一数据库。

## 行为约束

- entitlement 仅启用 `com.apple.security.files.user-selected.read-only`；不申请旧目录写权限。
- 每次导入先计算源数据库摘要，再复制并校验封面，最后写 SwiftData 和迁移报告。
- 重复导入按稳定 ID 与 `updatedAt` 合并，不复制重复业务记录。
- 导入失败不得修改源文件；成功后也不删除源文件。
- 正式切换后继续保留导入入口和兼容 fixture 多个版本。

## 结果

首次在沙盒版 macOS 应用中迁移时，用户需要选择一次旧数据目录。命令行审计工具可用于开发与诊断，但它写入的非沙盒应用支持目录不替代应用内导入。
