# ARCHITECTURE.md

## System Overview
简述系统如何工作。

## Major Components
- Component A: 职责、输入、输出
- Component B: 职责、输入、输出
- Component C: 职责、输入、输出

## Architecture Boundaries
### Allowed Dependencies
- UI -> Application
- Application -> Domain
- Domain -> Interfaces
- Infrastructure -> Domain abstractions only

### Forbidden Dependencies
- UI must not call persistence directly
- Domain must not depend on framework-specific code
- Business rules must not live in controllers/routes

## Data Flow
描述关键数据流：
1. 用户请求进入
2. 应用编排
3. 领域逻辑处理
4. 持久化/外部服务
5. 响应输出

## Key Directories
- `src/...`: ...
- `tests/...`: ...
- `docs/...`: ...
- `scripts/...`: ...

## Runtime Constraints
- latency budget:
- throughput assumptions:
- consistency model:
- retry policy:
- idempotency requirements:

## Change Impact Checklist
When changing architecture-significant code, also check:
- `docs/generated/api-surface.md`
- `docs/generated/routes-map.md`
- `docs/operations/reliability.md`
- `docs/security/threat-model.md`

## Open Questions
- question 1
- question 2