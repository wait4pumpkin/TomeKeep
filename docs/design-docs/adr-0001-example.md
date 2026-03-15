---
title: "ADR-0001: Separate domain logic from transport layer"
status: accepted
date: 2026-03-14
deciders:
  - platform-team
---

# ADR-0001: Separate domain logic from transport layer

## Context
The codebase currently mixes HTTP request handling with business rules.

## Decision
Business logic will move into domain/application services. Transport handlers will only parse requests and format responses.

## Alternatives Considered
- Keep logic in controllers
- Move only some logic to services
- Full layered separation

## Consequences
### Positive
- easier testing
- clearer boundaries
- easier AI navigation

### Negative
- short-term refactor cost
- more files and abstractions