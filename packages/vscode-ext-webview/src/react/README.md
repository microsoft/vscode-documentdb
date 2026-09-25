# react

React bindings for the webview. This is the only folder that imports `react`,
and it builds on `webview/`.

Import path:

```ts
import { ... } from '@microsoft/vscode-ext-webview/react';
```

Contents:

- `WebviewContext.tsx`: `WithWebviewContext`, the provider you wrap your app in
  once.
- `useTrpcClient.ts`: returns the tRPC client.
- `useRpcEvents.ts`: returns the shared event channel.
- `useConfiguration.ts`: reads the initial configuration passed at panel
  creation.
- `connection.ts`: internal wiring that gives the hooks one shared client and
  event channel per webview.

If you do not use React, use `./webview` directly.
