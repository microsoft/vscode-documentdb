# Release Notes Format Reference

This document defines the format and style for release notes files.

## File Location

`/docs/release-notes/{major}.{minor}.md`

Examples:

- `0.6.md` for versions 0.6.0, 0.6.1, 0.6.2, etc.
- `1.0.md` for versions 1.0.0, 1.0.1, etc.

## Document Structure

### Header (Required for all release notes files)

```markdown
> **Release Notes** — [Back to Release Notes](../index.md#release-notes)

---
```

### Main Release Section (X.Y.0)

```markdown
# DocumentDB for VS Code Extension vX.Y

Opening paragraph expressing excitement about the release. Summarize 2-3 key highlights. Mention the extension name and target audience (developers working with DocumentDB/MongoDB).

## What's New in vX.Y

### ⭐ Feature Name

Description of the feature. Explain WHAT it does, WHY it's valuable, and HOW users benefit.

<p align="center"><img src="./images/X.Y.0_feature_name.png" alt="Description" width="800" style="max-width:100%;height:auto;"></p>

[Optional sub-sections for complex features]

### ⭐ Another Feature

...

## Key Fixes and Improvements

- **Fix/Improvement Title**
  - Description of what was fixed or improved.

## Changelog

See the full changelog entry for this release:
➡️ [CHANGELOG.md#XYZ](https://github.com/microsoft/vscode-documentdb/blob/main/CHANGELOG.md#XYZ)
```

### Patch Release Section (X.Y.Z where Z > 0)

Append to existing file after a horizontal rule:

```markdown
---

## Patch Release vX.Y.Z

Brief 1-sentence summary of what this patch addresses.

### What's Changed in vX.Y.Z

#### 💠 **Change Title** ([#issue](link), [#pr](link))

Detailed description of the change. Explain the problem that was solved or improvement made. Be specific about user impact.

#### 💠 **Another Change** ([#issue](link))

Description...

### Changelog

See the full changelog entry for this release:
➡️ [CHANGELOG.md#XYZ](https://github.com/microsoft/vscode-documentdb/blob/main/CHANGELOG.md#XYZ)
```

## Writing Style

### Opening Paragraph Patterns

**For Major Features:**

```markdown
We are excited to announce the release of **DocumentDB for VS Code Extension vX.Y**. This is a landmark update for our DocumentDB and MongoDB GUI, focused on [theme]. It introduces [major feature], enhances [improvement area], and improves [another area] for developers working with DocumentDB and MongoDB API databases.
```

**For Incremental Updates:**

```markdown
We are excited to announce the release of **DocumentDB for VS Code Extension vX.Y**. This update significantly enhances [area] with [improvement], introduces [feature], and delivers several key bug fixes to improve stability and user experience.
```

**For Initial/Foundation Releases:**

```markdown
We're happy to announce the **public release of the DocumentDB for VS Code Extension (vX.Y)**, a dedicated VS Code extension designed specifically for developers working with **DocumentDB** and **MongoDB** databases.
```

### Feature Description Patterns

**For Complex Features (multi-stage or multi-part):**

```markdown
### ⭐ Feature Name

We are introducing a major new feature: **Feature Name**. This powerful tool helps you [benefit] directly within VS Code. When you [action], a new **"Tab Name"** appears, providing [what it shows].

- **Stage/Part 1: Name**
  Description of first part and what it provides.

- **Stage/Part 2: Name**
  Description of second part.

- **Stage/Part 3: Name**
  Description of third part.

The **"Feature Name"** feature helps [solve problem] and educates users on [topic] for DocumentDB and MongoDB API databases.
```

**For Simple Features:**

```markdown
### ⭐ Feature Name

We've [enhanced/added/introduced] [what] to [benefit]. Previously, [limitation]. Now, [new capability], enabling [user benefit] without leaving VS Code.
```

**For Integration Features:**

```markdown
### ⭐ Feature Name ([#issue](link))

This release improves the user experience for developers in the [ecosystem] by [how]. The [component] now [capability].

- **Benefit 1**: Description.
- **Benefit 2**: Description.
- **Benefit 3**: Description.
```

### Fix Description Patterns

**In "Key Fixes and Improvements" section:**

```markdown
- **UI Element Visibility**
  - Fixed an issue where [component] could be hidden behind other UI elements.
  - Corrected a problem where [another component] was sometimes displayed incorrectly.
```

**In Patch Release section:**

```markdown
#### 💠 **Fix Title** ([#issue](link), [#pr](link))

We've resolved [issue type] that affected [who/what]. Previously, [problem description]. This update [solution], ensuring [benefit].

[Optional: For a complete guide, see our documentation on [Topic](link).]
```

## Emojis Usage

| Emoji    | Usage                                               |
| -------- | --------------------------------------------------- |
| ⭐       | Major features in main release (What's New section) |
| 💠       | Individual items in patch releases                  |
| 🚀       | Key Features heading (initial release only)         |
| 1️⃣ 2️⃣ 3️⃣ | Numbered features (alternative to ⭐)               |
| 🐛       | Bug fixes (optional, in Key Fixes section)          |
| 🛠️       | Technical improvements                              |
| ✅       | Fix items in bullet lists                           |

## Image References

```markdown
<p align="center"><img src="./images/X.Y.Z_feature_name.png" alt="Alt text description" width="800" style="max-width:100%;height:auto;"></p>
```

**Image naming convention:** `{version}_{feature_name}.png`

- Example: `0.6.0_query_insights.png`
- Example: `0.4.0_azure_resources.png`

**Width guidelines:**

- Full-width screenshots: `width="800"`
- Dialog/panel screenshots: `width="360"` to `width="600"`
- Logos/icons: `style="width:40%; min-width:180px; max-width:320px;"`

## Changelog Link Format

```markdown
## Changelog

See the full changelog entry for this release:
➡️ [CHANGELOG.md#XYZ](https://github.com/microsoft/vscode-documentdb/blob/main/CHANGELOG.md#XYZ)
```

**Anchor format:** `#XYZ` where X.Y.Z version becomes `XYZ` (no dots)

- `0.6.0` → `#060`
- `0.6.1` → `#061`
- `1.0.0` → `#100`

## Complete Examples

### Major Release Example

See [EXAMPLES-MAJOR-RELEASE.md](./EXAMPLES-MAJOR-RELEASE.md) for a complete template.

### Patch Release Example

See [EXAMPLES-PATCH-RELEASE.md](./EXAMPLES-PATCH-RELEASE.md) for a complete template.

## Anti-Patterns to Avoid

❌ **Generic opening**

```markdown
This release includes some updates.
```

✅ **Specific and enthusiastic**

```markdown
We are excited to announce the release of **DocumentDB for VS Code Extension v0.7**. This landmark update introduces AI-powered query optimization, bringing intelligent performance insights directly to your development workflow.
```

---

❌ **Technical jargon without context**

```markdown
Added executionStats parsing for explain output aggregation.
```

✅ **User-focused benefit**

```markdown
The Query Insights feature now reuses execution statistics from the analysis stage, making AI recommendations faster and ensuring the insights are based on the exact same metrics you see in the UI.
```

---

❌ **Missing links and context**

```markdown
Fixed a bug with tenant filtering.
```

✅ **Complete with context and links**

```markdown
#### 💠 **Improved Azure Tenant Filtering** ([#391](https://github.com/microsoft/vscode-documentdb/issues/391), [#415](https://github.com/microsoft/vscode-documentdb/pull/415))

We've resolved a key issue that affected users managing numerous Azure tenants. The filtering wizard now works correctly when deselecting tenants, ensuring a reliable experience in enterprise environments.
```
