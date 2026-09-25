---
name: agy-customizations
description: Guide and reference for the Antigravity Customization System. Explains how customizations work, their loading priority, and how to create skills, rules, plugins, hooks, and MCP servers.
---

# Antigravity Customization System

The Antigravity Customization System allows developers to specialize agent behavior, teach multi-step workflows, and integrate custom tools.

## Customization Primitives

1. **Skills (`skills/<name>/SKILL.md`)**:
   - On-demand procedural guidance and procedural runbooks.
   - Contains YAML frontmatter (`name`, `description`) followed by markdown instructions.
   - Discovered in `.opencode/skills/`, `.agents/skills/`, or root `skills/`.

2. **Rules (`AGENTS.md` / `GEMINI.md`)**:
   - Hierarchical guidelines enforced across all agent turns.
   - Defines language standards, build commands, test patterns, and code conventions.

3. **Plugins (`plugins/<name>/plugin.json`)**:
   - Namespaced packages combining skills, subagents, and Model Context Protocol (MCP) server definitions.

4. **MCP Servers (`mcp_config.json`)**:
   - External tool servers providing specialized API actions and live data connections.

5. **Hooks (`hooks.json`)**:
   - Automated scripts executing at specific agent lifecycle points (pre-tool, post-tool, commit).
