# 图书管理系统 (Book Management System) Spec

## Why
用户目前拥有大量实体书，缺乏便捷的管理工具，同时有日常购书需求，需要记录代购书籍列表并自动比价。现有的工作目录包含大量 Markdown 模板文档，需要根据新系统的规范进行更新和清理。
**更新**: 应用形态确定为 **Mac App**，并需为未来跨平台（含移动端）支持预留架构空间。

## What Changes
- **核心架构**:
  - **技术栈**: Electron + React (Vite) + TypeScript。
  - **跨平台策略**: 采用 Web 技术栈构建 UI，便于未来通过 Capacitor 或 React Native 复用逻辑至移动端。
  - **数据存储**: 使用本地数据库 (SQLite 或 Lowdb) 确保离线可用性。
- **新增功能**:
  - **图书库存管理**: 实体书 CRUD，支持扫码（未来移动端）或 ISBN 输入。
  - **购书清单管理**: 待购书籍列表与优先级。
  - **自动比价引擎**: 针对主流电商平台的比价逻辑（封装为独立模块以利于复用）。
- **文档体系更新**:
  - 更新 `AGENTS.md`、`README.md`。
  - 清理/更新 `docs/templates`。

## Impact
- **Affected specs**: 新增 `docs/product-specs/book-management.md`。
- **Affected code**: 新增 `src/main/` (Electron), `src/renderer/` (React), `src/shared/` (共享逻辑)。
- **Affected docs**: `AGENTS.md`, `README.md`。

## ADDED Requirements
### Requirement: Mac 桌面应用 (Mac App)
系统必须以 macOS 本地应用形式运行。

#### Scenario: 启动应用
- **WHEN** 用户双击应用图标
- **THEN** 打开独立的桌面窗口，而非浏览器标签页

### Requirement: 图书库存管理
同前，增加本地存储支持。

### Requirement: 购书清单与比价
同前，比价逻辑需在本地运行或通过代理服务。

## MODIFIED Requirements
### Requirement: 项目文档结构
更新现有 Markdown 模板以适配图书管理系统。
