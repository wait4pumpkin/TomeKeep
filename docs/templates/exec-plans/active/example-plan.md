---
title: "Refactor notification delivery pipeline"
owner: "platform-team"
status: active
last_reviewed: 2026-03-14
review_cycle_days: 14
linked_specs:
  - "../../product-specs/features/example-feature.md"
---

# Execution Plan: Refactor notification delivery pipeline

## Context
The current delivery pipeline has duplicate retry behavior and poor observability.

## Objective
Improve delivery reliability and simplify retry handling.

## Non-goals
- Redesigning notification templates
- Changing user-facing notification preferences

## Constraints
- Must preserve current external API behavior
- Must not drop queued messages during rollout
- Must preserve audit logging

## Scope
### In Scope
- retry orchestration
- job idempotency
- queue error handling
- observability improvements

### Out of Scope
- message template redesign
- cross-channel routing strategy

## Impacted Areas
- job workers
- queue adapters
- delivery service
- metrics and logs
- runbooks

## Proposed Approach
1. Introduce a single retry coordinator
2. Standardize error classification
3. Add structured logs and metrics
4. Update runbook and generated job inventory

## Task Breakdown
- [ ] map current retry paths
- [ ] introduce retry coordinator
- [ ] add tests for transient and permanent failures
- [ ] update observability
- [ ] update docs

## Validation Plan
- test duplicate delivery prevention
- test retry backoff behavior
- verify metrics emitted
- verify runbook completeness

## Rollout Plan
- ship behind feature flag
- enable for 5% traffic
- observe metrics
- roll out gradually

## Rollback Plan
- disable feature flag
- revert worker route to old path

## Decision Log
- 2026-03-14: keep external API unchanged