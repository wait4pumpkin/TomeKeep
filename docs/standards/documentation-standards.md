---
title: "Documentation Standards"
owner: "engineering"
status: active
last_reviewed: 2026-03-14
review_cycle_days: 30
---

# Documentation Standards

## Documentation Principles
- Prefer source-of-truth docs in the repository
- Prefer concise and navigable docs over long narrative docs
- Every non-trivial document must have an owner
- Every long-lived document should have a review date

## Required Metadata
All durable docs should include:
- title
- owner
- status
- last_reviewed
- review_cycle_days

## When Docs Must Be Updated
Update docs for:
- new features
- changes to behavior
- changed APIs
- changed configuration
- changed data models
- changed security or permission behavior
- changed operational procedures

## AI-Friendliness Rules
- Use explicit headings
- Avoid unexplained internal jargon
- Link related documents
- Separate goals, constraints, and decisions clearly
- Record non-goals explicitly
- Prefer checklists where useful

## Staleness Rules
A document is stale if:
- it conflicts with current code behavior
- it has passed its review cycle
- it references removed modules/APIs
- it lacks a current owner