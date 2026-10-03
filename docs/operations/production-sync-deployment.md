---
title: "Production Sync Deployment"
owner: platform-team
status: active
last_reviewed: 2026-10-03
review_cycle_days: 30
---

# 原生多端同步生产发布

## 当前判断

iOS 和 macOS 共用 `NativeSyncEngine`。登录同一账户后，两端都会使用本机 SwiftData + durable pending 状态，并在启动、回到前台、本地写入、登录成功和手动操作时执行双向同步。本地数据库是离线工作集，不是跨设备唯一真源。

客户端不会在启动时强制展示登录页。钥匙串中已有 TomeKeep Bearer Token 时会直接恢复并同步；没有 Token 时只使用本机 SwiftData，主界面显示“未登录：数据仅保存在本机”并提供设置入口。Xcode Accounts 登录仅用于开发签名，与 TomeKeep 云账户无关。

默认 API 为 `https://tomekeep.pages.dev/api/`。2026-10-03 的只读探测确认 `/api/health` 返回 HTTP 200，未认证的 `/api/auth/me` 与 `/api/sync/status` 正确返回 HTTP 401；但原生价格同步所需 `/api/price-cache` 返回 HTTP 404。

因此线上当前只能视为“旧版核心同步服务存在”，不能视为完整原生协议已发布。原生客户端依赖的稳定分页、档案 tombstone、价格缓存同步和安全加固仍包含尚未进入远端 `main` 的代码与 `0004`—`0007` D1 迁移。完整多端同步验收前必须发布最新服务端。

## 发布门禁

1. 将待发布改动提交到受审查的分支，确认 API surface、routes map 和安全审计文档同步。
2. 运行 Web API 单测、typecheck、PWA production build 和原生 Swift 同步测试。
3. 导出或确认 D1 可恢复快照。
4. 按编号将 `packages/web/migrations/0004`—`0007` 应用到远端 `books` 数据库。
5. 部署 `packages/web/dist` 与 Pages Functions 到 `tomekeep` 项目。
6. 用非管理员验收账号验证登录、分页拉取、写入、删除 tombstone、封面和跨设备最终一致性。
7. 再用管理员账号验证邀请码权限，运行 IDOR/跨账户负向测试。

CI 使用 `.github/workflows/deploy-web.yml`，推送 `main` 后依次执行远端 D1 migration 和 Pages deploy。生产发布属于外部状态变更，不应仅因本地客户端构建成功而自动触发。

## 验收数据流

```text
iPhone / Mac local edit
  -> SwiftData record marked pending
  -> NativeSyncCoordinator
  -> HTTPS TomeKeep API
  -> D1 / R2
  -> second device foreground or manual sync
  -> LWW merge + cover download
```

网络或服务端失败时，本地写入保留为 pending；后续启动、前台、登录、本地变更或手动同步会重试。设置页必须显示最近一次同步结果或失败原因。

## 回滚

- Pages：回滚到上一成功部署。
- 客户端：API 保持向后兼容，旧 PWA/Electron 在原生验收前继续保留。
- D1：迁移以向前修复为主；发布前必须有快照，因为 SQLite schema 变更不能依赖 Pages 回滚自动撤销。
