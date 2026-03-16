---
title: "Dependency Policy"
owner: "engineering"
status: active
last_reviewed: 2026-03-16
review_cycle_days: 30
---

# Dependency Policy

## Purpose
为 TomeKeep 增加/升级依赖提供可执行的约束，降低供应链、安全、体积与维护风险。

## Policy
### Allowed
- 为满足明确的产品需求或工程质量需求（测试、构建、类型）引入依赖
- 优先使用平台/标准库能力（Electron/Chromium/Web APIs、Node APIs）

### Forbidden
- 引入与需求无关、仅为“方便”而增加的重型依赖
- 引入需要常驻后台服务、额外环境变量或外部密钥的依赖（除非有对应 spec/plan 与安全评审）

## Requirements (Add/Upgrade)
- 明确动机：新增依赖要写清楚“解决什么问题、为什么内置能力不够”
- 最小化：优先选择依赖少、维护活跃、生态成熟的方案
- 安全：不得引入明显存在高危漏洞或长期无人维护的包
- 许可：必须与项目许可兼容（MIT 兼容为优先）
- 影响评估：
  - 运行时依赖 vs 开发依赖（优先 devDependency）
  - 包体积与启动性能影响（Electron 应用仍需关注）
  - 是否引入原生编译依赖（macOS CI/本地环境复杂度）

## Process
- 更新 `package.json`（尽量仅新增 devDependency）
- 记录变更：
  - 在相关计划/规格中补充依赖决策（为何选择/替代方案）
  - 必要时更新 `docs/generated/dependency-graph.md`（如文件存在且受影响）

## Review Triggers
- 引入新运行时依赖
- 引入涉及网络、加密、解析用户输入的大型依赖
- 引入需要原生编译的依赖
