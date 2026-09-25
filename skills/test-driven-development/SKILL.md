---
name: test-driven-development
description: Methodology and standards for automated unit, integration, and security testing using Vitest, Jest, and verification harnesses.
---

# Test-Driven Development & Verification

Ensure all modifications are validated with automated tests and rigorous assertion checks.

## Guidelines

1. **Narrowest Test First**:
   - Before implementing complex changes, create or inspect unit tests covering boundary conditions.
   - Run tests targeting the specific module before full suite runs.

2. **Defense Against Regressions**:
   - For any reported bug, author a reproducing test case first.
   - Implement the fix and confirm the test transitions from failing to passing.

3. **Security Testing**:
   - Test for malicious inputs, path traversal (`../`, URL-encoded paths), null bytes, and unauthorized command execution.
