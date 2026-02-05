# Patch Release Example Template

This is a complete example of a patch release section to append to an existing release notes file.

---

## Template

Append to existing `docs/release-notes/X.Y.md` file:

```markdown
---

## Patch Release vX.Y.Z

This patch release [brief 1-sentence summary of focus].

### What's Changed in vX.Y.Z

#### 💠 **Change Title** ([#issue](link), [#pr](link))

Detailed description of the change. Explain the problem that was solved or the improvement made. Be specific about user impact and benefits.

[Optional additional paragraph with more context or link to documentation.]

#### 💠 **Another Change Title** ([#issue](link), [#pr](link))

Description of another change in this patch.

### Changelog

See the full changelog entry for this release:
➡️ [CHANGELOG.md#XYZ](https://github.com/microsoft/vscode-documentdb/blob/main/CHANGELOG.md#XYZ)
```

---

## Real Examples

### Example 1: Simple Patch (v0.6.1)

```markdown
---

## Patch Release v0.6.1

This patch release introduces feedback optimization and fixes a broken link.

### What's Changed in v0.6.1

#### 💠 **Feedback Optimization** ([#392](https://github.com/microsoft/vscode-documentdb/pull/392))

Introduces privacy consent and feedback signal controls for the Query Insights feature, primarily to ensure compliance with organizational data protection requirements and user telemetry settings. It also disables survey functionality and refines the feedback dialog UI.

#### 💠 **Privacy Policy Link Update** ([#388](https://github.com/microsoft/vscode-documentdb/pull/388))

Updated the outdated privacy policy link in the README to the current Microsoft privacy statement URL.

### Changelog

See the full changelog entry for this release:
➡️ [CHANGELOG.md#061](https://github.com/microsoft/vscode-documentdb/blob/main/CHANGELOG.md#061)
```

### Example 2: Comprehensive Patch (v0.6.2)

```markdown
---

## Patch Release v0.6.2

This patch release delivers important fixes for Azure tenant management, service discovery, and accessibility. It also includes a significant set of dependency upgrades to modernize the extension's underlying architecture.

### What's Changed in v0.6.2

#### 💠 **Improved Azure Tenant and Subscription Filtering in Service Discovery** ([#391](https://github.com/microsoft/vscode-documentdb/issues/391), [#415](https://github.com/microsoft/vscode-documentdb/pull/415))

We've resolved a key issue that affected users managing numerous Azure tenants. Previously, when a user had access to a large number of tenants, and had selected all of them, the filtering wizard would fail to work correctly when attempting to deselect tenants, making it impossible to refine the resource view.

This update introduces an improved filtering mechanism that ensures a reliable experience, even for users in enterprise environments. The wizard for managing accounts, tenants, and subscriptions is now more resilient, allowing you to precisely control which resources are displayed in the Service Discovery panel.

For a complete guide on the enhanced workflow, please see our updated documentation on [Managing Azure Discovery](https://microsoft.github.io/vscode-documentdb/user-manual/managing-azure-discovery).

#### 💠 **Corrected Service Discovery Default Settings** ([#390](https://github.com/microsoft/vscode-documentdb/issues/390), [#412](https://github.com/microsoft/vscode-documentdb/pull/412))

To provide a cleaner initial experience, the Service Discovery feature no longer starts with any discovery engines enabled by default. In a previous version, the "Azure Cosmos DB for MongoDB (RU)" plugin was pre-selected by mistake, which could cause confusion.

With this fix, you now have full control over which service discovery plugins are active from the start, for a more intentional and direct setup.

#### 💠 **Accessibility Fix for Query Insights** ([#376](https://github.com/microsoft/vscode-documentdb/issues/376), [#416](https://github.com/microsoft/vscode-documentdb/pull/416))

We've addressed an accessibility issue in the "Query Insights" tab where the "AI response may be inaccurate" warning text would overlap with other UI elements when the panel was resized. The layout has been updated to be fully responsive, ensuring all content remains readable and accessible regardless of panel size.

#### 💠 **Modernized Architecture with Major Dependency Upgrades** ([#406](https://github.com/microsoft/vscode-documentdb/issues/406), [#407](https://github.com/microsoft/vscode-documentdb/pull/407), [#386](https://github.com/microsoft/vscode-documentdb/pull/386))

This release includes a significant overhaul of our dev dependencies, bringing major performance and modernization improvements:

- **Upgraded to React 19**: We've migrated our webview components to React 19, leveraging the latest features and performance enhancements from the React team.
- **Upgraded to SlickGrid 9**: The data grids used to display collection data have been updated to SlickGrid 9.
- **Other Key Updates**: We've also updated TypeScript, Webpack, the MongoDB driver, and numerous other packages to enhance security, stability, and build performance.

These upgrades ensure the extension remains fast, secure, and aligned with the latest web development best practices.

### Changelog

See the full changelog entry for this release:
➡️ [CHANGELOG.md#062](https://github.com/microsoft/vscode-documentdb/blob/main/CHANGELOG.md#062)
```

### Example 3: Single Fix Patch (v0.5.1)

```markdown
---

## Patch Release v0.5.1

This patch release addresses a critical issue with connection string parsing, ensuring more reliable connections for Azure DocumentDB and other services.

### What's Changed in v0.5.1

#### 💠 **Improved Connection String Parsing** ([#314](https://github.com/microsoft/vscode-documentdb/issues/314), [#316](https://github.com/microsoft/vscode-documentdb/pull/316))

We've resolved an issue where connection strings containing special characters (e.g., `@`) in query parameters, such as those from Azure Cosmos DB (`appName=@myaccount@`), would fail to parse. The connection string parser now properly sanitizes query parameters before parsing, ensuring reliable connections even with complex connection strings.

### Changelog

See the full changelog entry for this release:
➡️ [CHANGELOG.md#051](https://github.com/microsoft/vscode-documentdb/blob/main/CHANGELOG.md#051)
```

---

## Key Patterns

### Opening Line Patterns

| Patch Type   | Opening Pattern                                                               |
| ------------ | ----------------------------------------------------------------------------- |
| Bug fixes    | "This patch release addresses [issues] with [area]."                          |
| Improvements | "This patch release brings [improvements] to [area]."                         |
| Mixed        | "This patch release delivers [fixes] for [area] and includes [improvements]." |
| Single item  | "This patch release [single-sentence description]."                           |

### Section Title Patterns

| Content Type | Title Pattern                                          |
| ------------ | ------------------------------------------------------ |
| Fix          | "What's Fixed in vX.Y.Z" or "What's Changed in vX.Y.Z" |
| Mixed        | "What's Changed in vX.Y.Z"                             |
| Single focus | Can omit "What's Changed" and go directly to items     |

### Item Formatting

- Use `💠` emoji for each item in patch releases
- Bold the title: `#### 💠 **Title**`
- Include links immediately after title: `([#issue](link), [#pr](link))`
- Provide 1-3 paragraphs of description
- Use bullet points for sub-items when needed
