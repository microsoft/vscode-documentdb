---
name: skill-creator
description: Guide for creating effective GitHub Copilot skills (.github/skills/) in this repository. Use when creating a new skill, updating an existing skill, or when asked about skill structure, format, or best practices for the vscode-documentdb project.
---

# Skill Creator for GitHub Copilot

Create and maintain skills in `.github/skills/` that extend GitHub Copilot's capabilities with project-specific knowledge.

## What Are Skills

Skills are SKILL.md files that provide specialized, procedural knowledge that Copilot doesn't inherently have. They turn Copilot from a general assistant into a domain expert for specific tasks in this codebase.

Skills provide:

- **Specialized workflows** — multi-step procedures for project-specific domains
- **Domain expertise** — architecture patterns, conventions, business logic
- **Bundled references** — detailed docs loaded only when needed

## Skill Anatomy

```
.github/skills/
└── skill-name/
    ├── SKILL.md              (required — frontmatter + instructions)
    └── references/           (optional — detailed docs, loaded on demand)
```

### SKILL.md Structure

```markdown
---
name: my-skill-name
description: What this skill does and WHEN to use it. Include trigger words and scenarios. This is the primary mechanism for Copilot to decide whether to load the skill body.
---

# Skill Title

Concise instructions for using this skill.

## When to Use

- Bullet list of triggering scenarios

## Core Content

(workflow, patterns, examples)
```

### Wiring the Skill

After creating the SKILL.md, register it in [.github/copilot-instructions.md](/.github/copilot-instructions.md) under the `<skills>` section:

```xml
<skill>
<name>my-skill-name</name>
<description>Same or similar description as in SKILL.md frontmatter</description>
<file>${workspaceFolder}\.github\skills\my-skill-name\SKILL.md</file>
</skill>
```

> **Note:** Replace `${workspaceFolder}` with the absolute path to the repository root on your machine (e.g. `\home\user\repos\vscode-documentdb`). VS Code resolves skill file paths at runtime and currently requires absolute paths.

Copilot reads skill metadata (name + description) to decide when to trigger. The SKILL.md body is loaded only after triggering.

## Core Principles

### 1. Concise is Key

The context window is shared with conversation history, other instructions, and user requests. Challenge each paragraph: "Does Copilot already know this?" and "Does this justify its token cost?"

- **Prefer concise examples over verbose explanations**
- **Only include what Copilot doesn't already know** — skip general TypeScript/React knowledge
- **Target under 300 lines** for SKILL.md body; split into references if larger

### 2. Progressive Disclosure

Use a three-level loading system:

1. **Metadata** (name + description) — always visible (~50 words)
2. **SKILL.md body** — loaded when skill triggers
3. **References** — loaded on demand by Copilot when deeper detail is needed

For skills with multiple variants or extensive reference material, keep the core workflow in SKILL.md and move details to `references/`:

```markdown
## Advanced Topics

- **Detailed format spec**: See [FORMAT.md](./FORMAT.md)
- **Migration patterns**: See [references/migration.md](./references/migration.md)
```

### 3. Match Freedom to Task Fragility

| Freedom Level                       | When                      | Example                      |
| ----------------------------------- | ------------------------- | ---------------------------- |
| **High** (text guidance)            | Multiple valid approaches | Architecture recommendations |
| **Medium** (patterns with examples) | Preferred pattern exists  | tRPC router creation         |
| **Low** (exact steps)               | Fragile, error-prone      | Release note formatting      |

### 4. Do NOT Include

- README.md, CHANGELOG.md, or auxiliary documentation
- Setup/installation instructions for the skill itself
- User-facing documentation — skills are for Copilot, not humans
- Information Copilot already knows (general language features, common libraries)

## Skill Creation Workflow

### Step 1: Understand the Domain

Identify concrete scenarios the skill addresses:

- What tasks trigger it?
- What does Copilot get wrong without it?
- What project-specific knowledge is needed?

### Step 2: Plan Contents

For each scenario, determine:

- What code patterns or templates are repeatedly needed?
- What reference material should be available?
- What pitfalls must be called out?

### Step 3: Write the Skill

1. **Create** `.github/skills/{skill-name}/SKILL.md`
2. **Write frontmatter**: `name` and `description` (description is the trigger — be comprehensive about when to use)
3. **Write body**: Core workflow, patterns, examples. Keep it lean.
4. **Add references** (optional): Split out detailed format specs, schemas, or variant-specific docs
5. **Register** in `.github/copilot-instructions.md`

### Step 4: Validate

- Ensure the description covers all trigger scenarios
- Verify code examples follow project conventions (see `.github/copilot-instructions.md` and `.github/instructions/`)
- Check that referenced files exist and paths are correct
- Confirm the skill doesn't duplicate information already in `.github/instructions/` files

## Existing Skills Reference

| Skill                       | Purpose                                                |
| --------------------------- | ------------------------------------------------------ |
| `writing-release-notes`     | Release notes and changelog generation                 |
| `accessibility-aria-expert` | Accessibility issues in React/Fluent UI webviews       |
| `webview-trpc-messaging`    | tRPC communication between extension host and webviews |

## Example: Minimal Skill

```markdown
---
name: my-pattern
description: Implements the XYZ pattern for this codebase. Use when creating new XYZ instances, modifying existing XYZ behavior, or debugging XYZ-related issues.
---

# XYZ Pattern

## When to Use

- Creating a new XYZ
- Modifying XYZ behavior
- Debugging XYZ issues

## Pattern

\`\`\`typescript
// core pattern example
\`\`\`

## Common Pitfalls

- Don't do X because Y
- Always do Z when W
```
