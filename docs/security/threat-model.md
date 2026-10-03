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
