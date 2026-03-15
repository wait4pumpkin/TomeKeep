---
title: "Testing Standards"
owner: "engineering"
status: active
last_reviewed: 2026-03-14
review_cycle_days: 30
---

# Testing Standards

## Required Coverage Expectations
- New business logic must include unit tests
- Changed integration boundaries require integration or contract tests
- Failure paths must be tested for non-trivial flows
- Bug fixes should include regression tests where practical

## Test Design Rules
- Prefer deterministic tests
- Avoid unnecessary mocking
- Test behavior, not implementation details
- Keep fixtures minimal and explicit

## Pre-merge Expectations
- lint passes
- type checks pass
- unit tests pass
- integration tests pass where relevant

## Documentation Coupling
When changing:
- API behavior -> update `docs/generated/api-surface.md`
- route behavior -> update `docs/generated/routes-map.md`
- operational behavior -> update runbooks or reliability docs