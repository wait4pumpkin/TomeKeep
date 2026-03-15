# AGENTS.md

## Project Purpose
This project provides: [一句话说明项目的目标和核心价值]

## Current Stage
- Stage: discovery / MVP / growth / scale / maintenance
- Primary focus this quarter: [当前最重要目标]

## Start Here
Before making any non-trivial change, read:

1. `README.md`
2. `ARCHITECTURE.md`
3. `docs/index.md`
4. Relevant files under `docs/product-specs/`
5. Relevant files under `docs/exec-plans/active/`
6. Relevant files under `docs/standards/`

## Source of Truth
- Product intent: `docs/product-specs/`
- Execution plans: `docs/exec-plans/`
- Engineering standards: `docs/standards/`
- Reliability and operations: `docs/operations/`
- Security constraints: `docs/security/`
- Generated technical inventory: `docs/generated/`

## Required Workflow
For non-trivial work:

1. Understand the relevant product spec and execution plan
2. If no plan exists, create or propose one
3. Confirm constraints before implementation
4. Implement the change
5. Add or update tests
6. Update impacted docs
7. Summarize:
   - what changed
   - what constraints were followed
   - how it was validated
   - which docs were updated

## Non-negotiable Constraints
- Do not introduce undocumented environment variables
- Do not change public API behavior without updating `docs/generated/api-surface.md`
- Do not add dependencies without following `docs/standards/dependency-policy.md`
- Do not bypass architecture boundaries described in `ARCHITECTURE.md`
- Do not leave operationally significant behavior undocumented

## Documentation Update Rules
Update docs when changing:
- APIs
- database schema
- background jobs
- configuration
- permissions/security behavior
- observability behavior
- user-facing behavior
- architectural boundaries

## If Unsure
Prefer:
1. existing specs
2. execution plans
3. standards
4. generated docs

If documentation conflicts with code, flag the conflict and propose a fix.