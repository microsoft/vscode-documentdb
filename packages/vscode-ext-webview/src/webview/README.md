# webview

Webview transport, framework-agnostic. Runs in the panel's browser context and
imports neither `vscode` nor `react`, so any UI framework (or none) can use it.

Import path:

```ts
import { ... } from '@microsoft/vscode-ext-webview/webview';
```

Contents:

- `connectTrpc.ts`: creates the tRPC client and the event channel for a webview.
- `events.ts`: `createEventChannel` and `RpcEventChannel`, to observe
  query and mutation success, error, and abort.
- `vscodeLink.ts`, `errorLink.ts`: the tRPC links the above build on.

Rule for contributors and agents: do not import `react` here. React bindings
live in `react/`.
