PRs, when not provided in this input file, are linked from referenced issues, loook these up. look at descriptions of linked PRs for more context.

hero features:

# Lightweight Data Migration support

https://github.com/microsoft/vscode-documentdb/issues/63

This is a big annoucement, it helps with copying / moving data between systems, collections, databases. it's very powerful and very easy to use. it's like a copy and paste for files, but for collecgtions. it's smart, it works around conflicts, it deals with RU platforms and is able to adapt to throttle on writes.

prompt: do note that the issue links to many sub issues, but the main feature issue number and link is #63 and this is enough to be referenced. same with the PR, this is the PR to link to https://github.com/microsoft/vscode-documentdb/pull/170
describe the feature in release notes.

the feature has a user-facing documentaiton descripiton, link to this file in the release notes, and use its content for more information about the feature for the release notes:
vscode-documentdb/docs/user-manual/copy-and-paste.md

# Folder Management for DocumentDB Connections View

https://github.com/microsoft/vscode-documentdb/pull/426

Users can now manage their connection list and organize connetions in folders, subfolders. introducing a huge improvement in comparison to the hisotorical / original flat list. this was an issue for many of our users who had more than a few connections.

now, a user can gropu connections in fodlers / subfoders, and move them around as they see fit.

# Accessibility

A long list of accessibility related improvements. this is big as we're looking beyond functionality but also focus conitnously on accessibility:

https://github.com/microsoft/vscode-documentdb/issues/385
Keyboard focus not visible Immediately after opening "Edit Selected Document": A11y_DocumentDB for VS Code Extension_focusOrder

https://github.com/microsoft/vscode-documentdb/issues/384
ScreenReader does not announce search results count or "No Results Found" Information: A11y_DocumentDB for VS Code Extension_Screenreader

https://github.com/microsoft/vscode-documentdb/issues/381
NVDA is announcing the grouping label for like or dislike control:A11y_DocumentDB for VS Code Extension_View Query Insights_Screenreader

https://github.com/microsoft/vscode-documentdb/issues/380
NVDA is announcing 'Document' instead of announcing visual status message 'AI is analyzing :A11y_DocumentDB for VS Code Extension_View Query Insights_Screenreader

https://github.com/microsoft/vscode-documentdb/issues/379
No visual label provided for query field and programmatic name is misaligned with field purpose: A11y_DocumentDB for VS Code Extension_View Query Insights_Lable in Name

https://github.com/microsoft/vscode-documentdb/issues/378
Name is not give for Next, Previews and Close button:A11y_DocumentDB for VS Code Extension_View Query Insights_Devtool

https://github.com/microsoft/vscode-documentdb/issues/377
No accessible name provided for Skip and Limit Spin Buttons: A11y_DocumentDB for VS Code Extension_View Query Insights_Name

https://github.com/microsoft/vscode-documentdb/issues/375
All tool tip under "query insights" tab are not accessible with keyboard :A11y_DocumentDB for VS Code Extension_View Query Insights_Keyboard

https://github.com/microsoft/vscode-documentdb/issues/374
Visual label 'Refresh' is not part of accessibility name(Programmatic name) for "Refresh" button :A11y_DocumentDB for VS Code Extension_Add a New Document_Devtools

---

## Other improvements in this release / "no hero" features

https://github.com/microsoft/vscode-documentdb/pull/170/changes/14dd6e67094221dd68fc5b3f7e86b45fda91059f
<only a link to a commit>, no dedicated issue, no dediated PR:
we added support to show an estimate count of documents for each collection in the collegtion view. this helps to quickly assess sizes of collections.

https://github.com/microsoft/vscode-documentdb/issues/457
Extension does not work with dark themes.

https://github.com/microsoft/vscode-documentdb/issues/428
Improved output formatting in AI generated responses of the "Query Insights" feature. We used unsupported markdown formatting characters resulting in malformed output in some scenarios. this has been fixed by restricting the formatting options available.

https://github.com/microsoft/vscode-documentdb/pull/436
added support for copy connection string with password

when users copy connection details to clipboard, they can now choose whether they want to have the passowrd included as well, this was not available before, it wasn't possible ot copy a password.

https://github.com/microsoft/vscode-documentdb/pull/434
