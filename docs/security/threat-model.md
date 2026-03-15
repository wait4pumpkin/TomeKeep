---
title: "Threat Model"
owner: "security-team"
status: active
last_reviewed: 2026-03-14
review_cycle_days: 30
---

# Threat Model

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

## Key Risks
- privilege escalation
- secret leakage
- injection risks
- replay or duplicate execution
- insecure direct object references

## Security Controls
- authentication
- authorization
- input validation
- secret management
- audit logging
- rate limiting

## Review Triggers
Review this document when:
- adding new external integrations
- changing authn/authz behavior
- storing new data classes
- changing deployment topology