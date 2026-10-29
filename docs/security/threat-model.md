---
title: "Threat Model"
owner: "security-team"
status: active
last_reviewed: 2026-10-29
review_cycle_days: 30
---

# Threat Model

2026-10-29 ISBN 冲突扩展：`GET /api/books/:id` 用认证用户 ID 限定查询，外账户书籍一律 404；`duplicate_isbn` 仅返回同账户现有书籍 ID。客户端冲突日志用账户 ID 的 SHA-256 摘要命名，不直接泄漏用户名，但内容含个人书目与阅读状态，存于既有本机应用数据目录，不进入日志/遥测。冲突审查只允许当前登录账户读取；异账户返回的 ID、Token、正文均不得写入错误提示。

## Assets
- user data
- secrets
- tokens
- audit logs

## Trust Boundaries
- client to API
- API to internal services
- service to third-party providers
- operator/admin access paths
- native app to third-party metadata sites
- legacy Electron data directory to native migration importer

## Key Risks
- privilege escalation
- secret leakage
- injection risks
- replay or duplicate execution
- insecure direct object references
- unintended camera access or excessive camera capture
- third-party metadata provider outage or unexpected response
- cross-user object access through sync or cover identifiers
- malicious legacy data or cover files during local migration
- token theft from native client storage

## Security Controls
- authentication
- authorization
- input validation
- secret management
- audit logging
- rate limiting
- camera access controls:
  - request permission only on explicit user action (Scan)
  - stop MediaStream tracks when scan UI closes
  - do not persist or transmit camera frames or scanned values
- metadata lookup controls:
  - only send ISBN to the provider after explicit user action (Scan/Fill)
  - for URL-based lookups, enforce strict allowlist and fetch canonical provider URLs only
  - enforce request timeouts and handle failures without blocking core flows
  - do not log ISBN or provider responses
- native client controls:
  - cover priority contains presentation IDs only; logout invalidates its session revision and prevents old downloads attaching to a later session, and cache attachment rechecks tombstone/coverKey after network suspension
  - local Mac development installation preserves the existing non-sandboxed debug baseline and Application Support directory; local ad-hoc signing is not a production sandbox or notarization strategy, and enabling a sandbox requires an explicit storage/session migration review
  - retailer rendering only navigates to approved retailer-owned HTTP(S) hosts, upgrades HTTP to HTTPS, rejects credentials in URLs and nonstandard ports, and keeps certificate/ATS validation enabled
  - dynamic retail snapshots are bounded (8 offers, 2 million UTF-16 units of product HTML with forms/scripts/headers removed, 15-second data polling within a 35-second operation timeout); cancellation must stop browser work and prevent stale price writes
  - do not log retailer cookies, form values, HTML or query-bearing URLs; diagnostic UI shows only a localized reason and bounded error domain/code
  - store API credentials in Keychain and website cookies in an app-specific persistent WebKit data store
  - do not use the TomeKeep service as a metadata or cover-fetch proxy for native clients
  - use durable idempotency identifiers for replayed sync writes
- migration controls:
  - treat legacy JSON, paths, URLs, and images as untrusted input
  - read but never mutate the legacy Electron data directory
  - validate paths remain within the selected legacy directory
  - import inside a transaction and emit a verification manifest

## Review Triggers
Review this document when:
- adding new external integrations
- changing authn/authz behavior
- storing new data classes
- changing deployment topology
