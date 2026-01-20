# Major Release Example Template

This is a complete example of a major/minor release notes file (X.Y.0).

---

## Template

```markdown
> **Release Notes** — [Back to Release Notes](../index.md#release-notes)

---

# DocumentDB for VS Code Extension vX.Y

We are excited to announce the release of **DocumentDB for VS Code Extension vX.Y**. This is a landmark update for our DocumentDB and MongoDB GUI, focused on [primary theme]. It introduces [headline feature], enhances [secondary improvement], and improves [third improvement] for developers working with DocumentDB and MongoDB API databases.

## What's New in vX.Y

### ⭐ Headline Feature Name

We are introducing a major new feature: **Feature Name**. This powerful tool helps you [primary benefit] directly within VS Code. When you [trigger action], a new **"UI Element"** appears, providing [what it provides].

<p align="center"><img src="./images/X.Y.0_feature_screenshot.png" alt="Feature Description" width="800" style="max-width:100%;height:auto;"></p>

- **Capability 1: Name**
  Description of the first capability and its benefits.

- **Capability 2: Name**
  Description of the second capability.

- **Capability 3: Name**
  Description of the third capability.

The **"Feature Name"** feature helps [solve problem] and educates users on [topic] for DocumentDB and MongoDB API databases.

### ⭐ Second Major Feature

We've enhanced [area] to support [new capability]. Previously, [limitation]. Now, you have [new capability], enabling [benefit] without leaving VS Code.

<p align="center"><img src="./images/X.Y.0_second_feature.png" alt="Feature Description" width="800" style="max-width:100%;height:auto;"></p>

### ⭐ Third Feature

Description of the third feature. Simply [action] to [result]. This direct workflow helps you [benefit] right from the explorer.

<p align="center"><img src="./images/X.Y.0_third_feature.png" alt="Feature Description" width="360" style="max-width:100%;height:auto;"></p>

## Key Fixes and Improvements

- **Improvement Category**
  - Fixed an issue where [component] could [problem].
  - Corrected a problem where [another component] was [problem].

## Changelog

See the full changelog entry for this release:
➡️ [CHANGELOG.md#XY0](https://github.com/microsoft/vscode-documentdb/blob/main/CHANGELOG.md#XY0)
```

---

## Real Example (v0.6.0)

```markdown
> **Release Notes** — [Back to Release Notes](../index.md#release-notes)

---

# DocumentDB for VS Code Extension v0.6

We are excited to announce the release of **DocumentDB for VS Code Extension v0.6**. This is a landmark update for our DocumentDB and MongoDB GUI, focused on query optimization and developer productivity. It introduces a powerful new **Query Insights with Performance Advisor**, enhances query authoring capabilities, and improves index management for developers working with DocumentDB and MongoDB API databases.

## What's New in v0.6

### ⭐ Query Insights with Performance Advisor

We are introducing a major new feature: **Query Insights with Performance Advisor**. This powerful tool helps you understand and optimize your queries directly within VS Code. When you run a `find` query against your DocumentDB or MongoDB API database, a new **"Query Insights"** tab appears, providing a three-stage analysis of your query's performance.

<p align="center"><img src="./images/0.6.0_query_insights.png" alt="Query Insights Panel" width="800" style="max-width:100%;height:auto;"></p>

- **Stage 1: Initial Performance View**
  The first stage provides an immediate, low-cost static analysis of your query. It visualizes the query plan, showing how the database intends to execute your query.

- **Stage 2: Detailed Execution Analysis**
  For a deeper dive, the second stage runs a detailed execution analysis using `executionStats` to gather authoritative metrics.

- **Stage 3: AI-Powered Recommendations with GitHub Copilot**
  The final stage brings the power of AI to your query optimization workflow.

The **"Query Insights"** feature helps solve performance issues and educates users on query best practices for DocumentDB and MongoDB API databases.

### ⭐ Improved Query Specification

We've enhanced the query authoring experience to support more sophisticated queries. Previously, you could only specify the `filter` for a `find` query. Now, you have full control to include `projection`, `sort`, `skip`, and `limit` parameters directly in the query editor.

<p align="center"><img src="./images/0.6.0_project_sort_skip_limit.png" alt="Query Parameters" width="800" style="max-width:100%;height:auto;"></p>

### ⭐ Index Management from the Tree View

Managing your indexes is now easier and more intuitive than ever. You can now `drop`, `hide`, and `unhide` indexes directly from the Connections View.

<p align="center"><img src="./images/0.6.0_index_management.png" alt="Index Management" width="360" style="max-width:100%;height:auto;"></p>

## Key Fixes and Improvements

- **Improved UI element visibility**
  - Fixed an issue where the autocomplete list in the query area could be hidden behind other UI elements.
  - Corrected a problem where tooltips in the table and tree views were sometimes displayed underneath the selection indicator.

## Changelog

See the full changelog entry for this release:
➡️ [CHANGELOG.md#060](https://github.com/microsoft/vscode-documentdb/blob/main/CHANGELOG.md#060)
```
