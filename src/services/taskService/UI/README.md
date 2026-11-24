# Task UI integration

The optional progress reporter, conflict warning, and lifecycle log observer live in the
[`@microsoft/vscode-ext-tasks/vscode` subpath](../../../../packages/vscode-ext-tasks/README.md).
The DocumentDB extension supplies localized strings and its output-channel callback in
[`extension/`](../extension/), and attaches the reporter and observer during activation.

## Tree annotations

Collection paste temporarily annotates source and target tree items through
`ext.state.runWithTemporaryDescription`. The callback waits for `whenTerminal(task)`, so the
annotation stays until the task completes, fails, or stops. See
[`ExecuteStep.ts`](../../../commands/pasteCollection/ExecuteStep.ts) for the extension-specific
implementation.
