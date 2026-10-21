---
name: writing-release-notes
description: Generates release notes and changelog entries for the DocumentDB extension for Visual Studio Code, and announces releases on GitHub Discussions. Use when preparing version releases, creating patch update notes, writing changelog entries, documenting new features and fixes, or posting a release or patch release announcement to Discussions. Handles both major/minor versions (new file) and patch updates (append to existing file).
---

# Writing Release Notes and Changelog

Generate professional release documentation for the DocumentDB extension for Visual Studio Code.

Product name: use **DocumentDB extension for Visual Studio Code** in titles and first mentions, then "the extension". The old name "DocumentDB for VS Code" is retired; see [Product name](../../copilot-instructions.md#product-name).

## When to Use

- Creating release notes for a new version (X.Y.0)
- Appending patch release notes (X.Y.Z where Z > 0)
- Writing changelog entries for any version
- Documenting new features, improvements, or fixes
- Announcing a release or patch release on GitHub Discussions

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

### Step 1: Confirm the Screenshot Plan

Before drafting or updating release notes, remind the operator to consider whether screenshots
would help explain the changes. Ask whether the release will include screenshots unless the
operator already answered this in the current request.

Suggested question: **Will this release include any screenshots?**

If screenshots are planned, the operator provides the raw captures. Frame them with the
[documentation-screenshots](../documentation-screenshots/SKILL.md) skill so they match the
existing release notes (brand background, consistent text size, numbered steps where needed).
Store the framed images under `docs/release-notes/images/` using `{version}_{feature_name}.png`
and reference them using the markup in [RELEASE-NOTES-FORMAT.md](./RELEASE-NOTES-FORMAT.md).
Do not add image placeholders.

### Step 2: Determine Version Type

```
Version X.Y.Z:
├── Z = 0 (major/minor release)
│   ├── Create new release notes file: docs/release-notes/X.Y.md
│   └── Add new changelog section at TOP of CHANGELOG.md
└── Z > 0 (patch release)
    ├── Append patch section to existing docs/release-notes/X.Y.md
    └── Add new changelog section at TOP of CHANGELOG.md
```

### Step 3: Generate Changelog Entry

1. Read [CHANGELOG-FORMAT.md](./CHANGELOG-FORMAT.md) for format
2. Add entry at TOP of `CHANGELOG.md` (below `# Change Log` heading)
3. Keep descriptions brief (1-2 sentences max)
4. Include issue/PR links in format: `[#123](https://github.com/microsoft/vscode-documentdb/issues/123)`

### Step 4: Generate Release Notes

1. Read [RELEASE-NOTES-FORMAT.md](./RELEASE-NOTES-FORMAT.md) for format
2. For X.Y.0: Create new file with full header and "What's New" sections
3. For X.Y.Z: Append patch section to existing X.Y.md file
4. Use exciting language for features, clear language for fixes
5. If screenshots were requested, do not mark the release notes complete until each selected image
   is stored and referenced using [RELEASE-NOTES-FORMAT.md](./RELEASE-NOTES-FORMAT.md).

### Step 5: Update Release Notes Index

1. Open `docs/index.md`
2. Find the **Release Notes** section
3. For X.Y.0: Add a new line `- [X.Y](./release-notes/X.Y)` at the top of the list
4. For X.Y.Z (patch): Append `, [X.Y.Z](./release-notes/X.Y#patch-release-vXYZ)` to the existing line for that major.minor version (where `vXYZ` uses no dots, e.g., `v071`)
5. Follow the existing pattern of other entries in the list

### Step 6: Announce on GitHub Discussions

Once the release notes are committed, post the announcement in the **Announcements** category. Follow
[ANNOUNCING-ON-DISCUSSIONS.md](./ANNOUNCING-ON-DISCUSSIONS.md) for the commands and the image handling.

Before publishing, always ask the operator: **Is there already a placeholder discussion for this
release? If so, what is its URL?** If a URL was already supplied, confirm that it is the placeholder
to update instead of asking for it again. Wait for the answer; do not create a new discussion unless
the operator confirms there is no placeholder. Reuse a confirmed placeholder by updating its title
and body.

- **X.Y.0:** one discussion (reuse the placeholder if present), titled `DocumentDB extension for Visual Studio Code vX.Y Released! <emoji>`,
  with the release notes as the body. Point `releaseNotesUrl` in `package.json` at it and pin it.
- **X.Y.Z (patch):** first create or update the dedicated discussion titled `Patch Release vX.Y.Z 📎` whose body is the
  `## Patch Release vX.Y.Z` section; then post the same text as a comment on the X.Y.0 announcement.
  A patch placeholder is for the dedicated patch discussion, not the parent X.Y.0 announcement.
  Find that announcement by title (`vX.Y Released`) and content, not through `releaseNotesUrl`: a
  patch can target an older version. If the lookup is not a single clear match, ask the operator.
  Keep this order: it puts the X.Y.0 announcement first and the patch post second in the
  recently updated Announcements list.

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
- [ ] Release notes start with the front matter header (`title`, `parent: 'Release Notes'`, `nav_order`)
- [ ] Patch releases append to existing file with `---` separator
- [ ] `docs/index.md` Release Notes section updated with link to new version
- [ ] Screenshot question was answered
- [ ] Every requested screenshot is framed with [documentation-screenshots](../documentation-screenshots/SKILL.md), saved under `docs/release-notes/images/` and referenced
- [ ] Placeholder question answered (or supplied URL confirmed), and any confirmed placeholder reused
- [ ] Announcement posted per [ANNOUNCING-ON-DISCUSSIONS.md](./ANNOUNCING-ON-DISCUSSIONS.md) (for a patch: create or update the dedicated `Patch Release vX.Y.Z 📎` discussion first, then post the same text as a comment on the X.Y.0 announcement)
