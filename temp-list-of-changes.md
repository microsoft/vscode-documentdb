# Release notes draft

## Hero features

### Lightweight data migration support

- Issue: [#63 – Lightweight Data Migration](https://github.com/microsoft/vscode-documentdb/issues/63)  
- PR: [#170](https://github.com/microsoft/vscode-documentdb/pull/170)  
- Documentation: [Copy and paste between databases and collections](https://github.com/microsoft/vscode-documentdb/blob/main/docs/user-manual/copy-and-paste.md)

This release introduces lightweight data migration, making it easy to copy or move data between systems, databases, and collections. The experience is similar to copying and pasting files, but for collections and documents. The feature is designed to handle conflicts intelligently and to respect request unit (RU) limits by adapting to throttling on writes.

### Folder management for DocumentDB Connections view

- PR: [#426 – Folder Management for Connections](https://github.com/microsoft/vscode-documentdb/pull/426)

Users can now organize their connections in folders and subfolders in the DocumentDB Connections view. This is a significant improvement over the previous flat list, especially for users who manage many connections. Connections can be grouped logically and moved between folders as needed.

### Accessibility improvements

A series of accessibility fixes improves both keyboard and screen reader experiences across the extension, particularly in Query Insights and document editing flows:

- [#385](https://github.com/microsoft/vscode-documentdb/issues/385) – Keyboard focus is now visible immediately after opening **Edit Selected Document**.
- [#384](https://github.com/microsoft/vscode-documentdb/issues/384) – Screen readers now announce search results count and “No Results Found” where appropriate.
- [#381](https://github.com/microsoft/vscode-documentdb/issues/381) – NVDA no longer announces an incorrect grouping label for like/dislike controls in Query Insights.
- [#380](https://github.com/microsoft/vscode-documentdb/issues/380) – NVDA now announces the correct visual status message “AI is analyzing” instead of a generic “Document” label.
- [#379](https://github.com/microsoft/vscode-documentdb/issues/379) – The query field now has a proper visual label and a programmatic name aligned with its purpose.
- [#378](https://github.com/microsoft/vscode-documentdb/issues/378) – Next, Previous, and Close buttons in Query Insights now have accessible names.
- [#377](https://github.com/microsoft/vscode-documentdb/issues/377) – Skip and Limit spin buttons now expose accessible names.
- [#375](https://github.com/microsoft/vscode-documentdb/issues/375) – Tooltips under the **Query Insights** tab are now accessible via keyboard.
- [#374](https://github.com/microsoft/vscode-documentdb/issues/374) – The **Refresh** button now includes the visual label in its accessibility name.

---

## Other improvements in this release

- Approximate document count per collection  
  - Commit (via PR #170): shows an estimated count of documents for each collection in the collections view, helping users quickly assess collection sizes.

- Dark theme compatibility  
  - [#457](https://github.com/microsoft/vscode-documentdb/issues/457) – Fixed issues that prevented the extension from working correctly with dark themes.

- Improved output formatting in Query Insights  
  - [#428](https://github.com/microsoft/vscode-documentdb/issues/428) – Improved formatting of AI-generated responses from **Query Insights** by avoiding unsupported markdown constructs that previously led to malformed output.

- Option to copy connection string with password  
  - [#436](https://github.com/microsoft/vscode-documentdb/pull/436) – Added an option to copy the connection string including the password when copying connection details to the clipboard. Previously, it was not possible to copy the password.

- Additional changes  
  - [#434](https://github.com/microsoft/vscode-documentdb/pull/434)
