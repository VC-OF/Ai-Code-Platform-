---
name: workflow-skill-creator
description: Distills a completed user workflow, debugging interaction, or development routine into a reusable agent skill. Use when standardizing repetitive workflows.
---

# Workflow-to-Skill Creator

Use this skill when capturing a successful pair programming session or deployment process into a repeatable skill.

## Procedure

1. **Analyze the Interaction**:
   - Identify the user's objective, inputs, tools invoked, and final output.
   - Separate one-time project specifics from generic reusable procedural patterns.

2. **Structure the Skill**:
   - Create `skills/<skill_name>/SKILL.md`.
   - Include YAML frontmatter with `name` and a concise `description` stating when to activate the skill.
   - Structure sections into Prerequisites, Step-by-Step Execution, Edge Cases, and Verification.

3. **Verify Skill Parsing**:
   - Verify frontmatter syntax and markdown formatting.
   - Test that the agent correctly parses instructions without syntax errors.
