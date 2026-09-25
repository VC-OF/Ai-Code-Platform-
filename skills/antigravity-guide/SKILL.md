---
name: antigravity-guide
description: Comprehensive guide and quick reference for Google Antigravity (AGY), covering AI-first IDE patterns, slash commands, agent loops, subagents, background tasks, and customizations.
---

# Google Antigravity (AGY) Guide & Workflows

Google Antigravity is an AI-first development platform enabling autonomous agent loops, background subagent orchestration, and developer-aligned pair programming.

## Core Capabilities & Workflows

### 1. Slash Commands
- `/plan`: Create structured implementation plans before making edits.
- `/context` (or `/ctx`, `/tokens`): Inspect real-time token utilization against the 2,000,000 token limit.
- `/compact`: Condense conversation history into a concise summary brief to recover token headroom.
- `/skills`: List all active project and global skills available to the agent.
- `/review`: Perform focused code review for regressions, edge cases, and missing tests.
- `/fix`: Diagnose and repair bugs followed by automated verification.
- `/test`: Run or author focused test suites.

### 2. Autonomous Agent Loop
- Follows the Read-Plan-Edit-Verify cycle.
- Inspects project memory in `AGENTS.md` before executing actions.
- Automatically respects verification constraints: runs tests/lints after modifying files.

### 3. Safe Execution Boundaries
- All workspace modifications happen inside isolated project folders.
- Destructive commands and unauthorized path traversals are automatically blocked.
