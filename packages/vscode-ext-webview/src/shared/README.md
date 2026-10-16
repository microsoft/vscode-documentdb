# shared

Side-agnostic contracts shared by the extension host and the webview. This code
runs in both Node and the browser, so it imports neither `vscode` nor `react`.

Import path (package root):

```ts
import { ... } from '@microsoft/vscode-ext-webview';
```

Contents:

- `wireProtocol.ts`: the `postMessage` message types (the host and webview
  contract).
- `TypedEventSink.ts`: bridges push events from the host into a tRPC
  subscription.
- `BaseRouterContext.ts`: the tRPC context contract (`signal`, `telemetry`).
- `initWebviewTrpc.ts`: typed tRPC root (`router`, `publicProcedure`,
  `createCallerFactory`) bound to your context type.

Rule for contributors and agents: do not import `vscode` or `react` here. A
symbol that needs either belongs in `host/` or `react/`.
