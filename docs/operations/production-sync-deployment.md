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

正式客户端使用认证门禁。钥匙串中已有 TomeKeep Bearer Token 时，启动页调用 `/auth/me` 恢复并验证会话；验证通过后进入业务界面并自动同步。没有 Token 或服务端返回 401 时只能使用登录/邀请码注册页，书库、愿望、设置和本机数据均不展示。服务暂时不可达时，曾登录设备仍可离线进入，待网络恢复后重试同步。Xcode Accounts 登录仅用于开发签名，与 TomeKeep 云账户无关。

默认 API 为 `https://tomekeep.pages.dev/api/`。2026-10-03，提交 `3533a1c` 触发的 [GitHub Actions 第 24 次部署](https://github.com/wait4pumpkin/TomeKeep/actions/runs/37117354224) 已成功完成 Web 构建、生产 D1 `0004`—`0007` 迁移和 Cloudflare Pages 发布。发布后的只读冒烟检查确认：PWA 首页和 `/api/health` 返回 HTTP 200，未认证的 `/api/auth/me`、`/api/books` 与原生 `/api/price-cache` 均正确返回 HTTP 401；后者在发布前为 HTTP 404。

这表示完整原生同步协议已经部署。生产账号的双端最终一致性仍需在 iOS 与 macOS 分别登录同一个 TomeKeep 账户后进行有认证验收；未登录设备停留在认证门禁，不能进入业务界面。

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
