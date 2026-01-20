# Changelog Format Reference

This document defines the format and style for `CHANGELOG.md` entries.

## File Location

`/CHANGELOG.md` (repository root)

## Structure

```markdown
# Change Log

## X.Y.Z

### Category

- **Feature Name**: Brief description. [#issue](link), [#pr](link)

## X.Y.Z-1

### Category

...
```

## Categories

Use these categories in order of priority:

1. `### New Features` - Major new functionality
2. `### New Features & Improvements` - Combined features and improvements
3. `### Improvements` - Enhancements to existing features
4. `### Fixes` - Bug fixes
5. `### Security` - Security-related updates

## Entry Format

```markdown
- **Short Title**: One to two sentence description of the change. [#123](https://github.com/microsoft/vscode-documentdb/issues/123), [#456](https://github.com/microsoft/vscode-documentdb/pull/456)
```

### Rules

1. **Bold title** summarizing the change (2-5 words)
2. **Description** in 1-2 sentences, factual and technical
3. **Links** to issues and PRs at the end
4. Use present tense ("Adds", "Fixes", "Updates")
5. No trailing period after links

## Examples

### Feature Entry

```markdown
- **Query Insights**: The Query Insights feature has been updated to use the available `executionStats` instead of running the analysis in the AI context, improving performance and reliability. [#404](https://github.com/microsoft/vscode-documentdb/issues/404), [#423](https://github.com/microsoft/vscode-documentdb/pull/423)
```

### Fix Entry

```markdown
- **Azure Tenant Filtering in Service Discovery**: Resolved an issue where users could not deselect tenants when filtering from a large number of available tenants. [#391](https://github.com/microsoft/vscode-documentdb/issues/391), [#415](https://github.com/microsoft/vscode-documentdb/pull/415)
```

### Improvement Entry

```markdown
- **Dependency Upgrades**: Upgraded to React 19 and SlickGrid 9, enhancing UI performance and modernizing the webview components. [#406](https://github.com/microsoft/vscode-documentdb/issues/406), [#407](https://github.com/microsoft/vscode-documentdb/pull/407)
```

### Security Entry

```markdown
- **Dependency Security Update**: Updated `tRPC` dependencies to address a security vulnerability. [#430](https://github.com/microsoft/vscode-documentdb/issues/430), [#431](https://github.com/microsoft/vscode-documentdb/pull/431)
```

## Version Section Template

### For Major/Minor Release (X.Y.0)

```markdown
## X.Y.0

### New Features & Improvements

- **Feature One**: Description of the feature and its benefits. [#issue](link), [#pr](link)
- **Feature Two**: Description of another feature. [#issue](link)

### Fixes

- **Bug Title**: Description of what was fixed. [#issue](link), [#pr](link)
```

### For Patch Release (X.Y.Z)

```markdown
## X.Y.Z

### Improvements

- **Improvement Title**: Brief description. [#issue](link), [#pr](link)

### Fixes

- **Fix Title**: Brief description. [#issue](link), [#pr](link)
```

## Anti-Patterns to Avoid

❌ **Too verbose**

```markdown
- **Feature**: This is a very long description that goes into extreme detail about every aspect of the feature and how it works internally and why we made certain decisions...
```

✅ **Concise**

```markdown
- **Feature**: Adds support for X, improving Y workflow. [#123](link)
```

---

❌ **Missing links**

```markdown
- **Feature**: Added new capability.
```

✅ **With links**

```markdown
- **Feature**: Added new capability. [#123](link), [#124](link)
```

---

❌ **Inconsistent formatting**

```markdown
- Feature: description
- **Another Feature** - description
- **Third Feature**: Description.
```

✅ **Consistent formatting**

```markdown
- **Feature One**: Description. [#1](link)
- **Feature Two**: Description. [#2](link)
- **Feature Three**: Description. [#3](link)
```
