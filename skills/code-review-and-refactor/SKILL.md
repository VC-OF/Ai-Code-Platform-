---
name: code-review-and-refactor
description: Comprehensive guidelines for code reviews, architectural audits, defensive coding practices, and non-destructive refactoring.
---

# Code Review & Refactoring Standards

## Review Checkpoints

1. **Correctness & Edge Cases**:
   - Check handling of null/undefined inputs, empty collections, and network failures.
   - Verify proper error handling with typed errors.

2. **Security & Boundaries**:
   - Validate input sanitization on all endpoints.
   - Verify sandbox boundaries and credential leak prevention.

3. **Performance & Clean Architecture**:
   - Avoid redundant database queries and memory leaks.
   - Decouple business logic from UI components.
   - Use non-breaking, incremental refactoring steps verified with tests.
