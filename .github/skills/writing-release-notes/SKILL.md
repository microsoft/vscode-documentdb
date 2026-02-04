---
name: writing-release-notes
description: Generates release notes and changelog entries for the DocumentDB VS Code extension. Use when preparing version releases, creating patch update notes, writing changelog entries, or documenting new features and fixes. Handles both major/minor versions (new file) and patch updates (append to existing file).
---

# Writing Release Notes and Changelog

Generate professional release documentation for the DocumentDB VS Code extension.

## When to Use

- Creating release notes for a new version (X.Y.0)
- Appending patch release notes (X.Y.Z where Z > 0)
- Writing changelog entries for any version
- Documenting new features, improvements, or fixes

## Quick Reference

| Version Type               | Release Notes Action                           | Changelog Action                  |
| -------------------------- | ---------------------------------------------- | --------------------------------- |
| Major/Minor (1.0.0, 1.1.0) | Create new `docs/release-notes/X.Y.md`         | Add new `## X.Y.0` section at top |
| Patch (1.1.1, 1.1.2)       | Append to existing `docs/release-notes/X.Y.md` | Add new `## X.Y.Z` section at top |

## Input Format

You will receive:

1. **Version number** (e.g., `0.7.0`, `0.6.4`)
2. **List of changes** with:
   - Brief description of change
   - Issue link(s) and/or PR link(s)
   - Category: Feature, Fix, Improvement, or Security

## Output Files

### Changelog (`CHANGELOG.md`)

**Location**: `/CHANGELOG.md` (repository root)

**Style**: Concise, technical, factual

For format and examples, see [CHANGELOG-FORMAT.md](./CHANGELOG-FORMAT.md)

### Release Notes (`docs/release-notes/X.Y.md`)

**Location**: `/docs/release-notes/{major}.{minor}.md`

**Style**: Enthusiastic, user-focused, marketing-oriented

For format and examples, see [RELEASE-NOTES-FORMAT.md](./RELEASE-NOTES-FORMAT.md)

## Workflow

### Step 1: Determine Version Type

```
Version X.Y.Z:
├── Z = 0 (major/minor release)
│   ├── Create new release notes file: docs/release-notes/X.Y.md
│   └── Add new changelog section at TOP of CHANGELOG.md
└── Z > 0 (patch release)
    ├── Append patch section to existing docs/release-notes/X.Y.md
    └── Add new changelog section at TOP of CHANGELOG.md
```

### Step 2: Generate Changelog Entry

1. Read [CHANGELOG-FORMAT.md](./CHANGELOG-FORMAT.md) for format
2. Add entry at TOP of `CHANGELOG.md` (below `# Change Log` heading)
3. Keep descriptions brief (1-2 sentences max)
4. Include issue/PR links in format: `[#123](https://github.com/microsoft/vscode-documentdb/issues/123)`

### Step 3: Generate Release Notes

1. Read [RELEASE-NOTES-FORMAT.md](./RELEASE-NOTES-FORMAT.md) for format
2. For X.Y.0: Create new file with full header and "What's New" sections
3. For X.Y.Z: Append patch section to existing X.Y.md file
4. Use exciting language for features, clear language for fixes
5. Include images when applicable (reference existing patterns)

## Writing Guidelines

### Changelog Tone

- Technical and factual
- No marketing language
- Focus on WHAT changed

### Release Notes Tone

- Enthusiastic and user-focused
- Highlight benefits to developers
- Use emojis sparingly (⭐ for major features, 💠 for patch items)
- Focus on WHY this helps users

### Link Format

```markdown
<!-- Issue link -->

[#123](https://github.com/microsoft/vscode-documentdb/issues/123)

<!-- PR link -->

[#456](https://github.com/microsoft/vscode-documentdb/pull/456)

<!-- Combined -->

[#123](https://github.com/microsoft/vscode-documentdb/issues/123), [#456](https://github.com/microsoft/vscode-documentdb/pull/456)
```

## Validation Checklist

Before completing:

- [ ] Changelog added at TOP of CHANGELOG.md
- [ ] All issue/PR links are correct and clickable
- [ ] Version numbers match across all files
- [ ] Categories are appropriate (Features, Fixes, Improvements)
- [ ] Release notes use proper header format
- [ ] Patch releases append to existing file with `---` separator
