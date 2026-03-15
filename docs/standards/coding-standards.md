---
title: "Coding Standards"
owner: "engineering"
status: active
last_reviewed: 2026-03-14
review_cycle_days: 30
---

# Coding Standards

## Purpose
Define enforceable engineering conventions.

## General Rules
- Prefer small, composable units
- Prefer explicit naming over abbreviations
- Keep business rules out of transport/UI layers
- Avoid hidden side effects
- Favor deterministic behavior where possible

## File and Module Rules
- One module should have one primary responsibility
- Public entry points must be documented
- Shared utilities must not contain business-specific logic

## Error Handling
- Do not swallow errors silently
- Use structured error types where possible
- Log errors with enough context for debugging
- Do not log secrets or sensitive user data

## Configuration
- New environment variables must be documented in `docs/generated/env-vars.md`
- Default values must be explicit
- Unsafe defaults are forbidden

## Review Checklist
- [ ] naming is clear
- [ ] boundaries are respected
- [ ] errors are handled explicitly
- [ ] tests cover important behavior
- [ ] docs updated if needed