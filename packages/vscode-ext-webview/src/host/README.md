# host

Extension-host code. Runs in the VS Code extension process (Node) and may import
`vscode`. It is never bundled into the webview.

Import path:

```ts
import { ... } from '@microsoft/vscode-ext-webview/host';
```

Contents:

- `openWebview.ts`: the factory. The simplest way to open a panel; returns a
  `WebviewController`.
- `WebviewController.ts`: the class the factory returns. Extend it for stateful
  or method-rich panels.
- `attachTrpc.ts`: bring-your-own-panel. Attaches the tRPC dispatcher to a
  `vscode.WebviewPanel` you already created.
- `middleware/`: optional logging and telemetry middleware bodies (see its
  README).

Rule for contributors and agents: webview or browser code must never import from
this folder.
