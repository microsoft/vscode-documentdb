# @microsoft/vscode-ext-react-webview (Preview)

> ⚠️ **Preview release.** This package is published in preview while the API
> surface stabilises. Breaking changes may land between minor versions until
> a `1.0.0` release.

Webview infrastructure for VS Code extensions with type-safe tRPC RPC over
`postMessage`, React hooks for the webview side, a pluggable telemetry
middleware, and accessibility helpers.

The package was extracted from the webview stack powering the
[DocumentDB for VS Code](https://github.com/microsoft/vscode-documentdb) and
[Azure Cosmos DB for VS Code](https://github.com/microsoft/vscode-cosmosdb)
extensions, then refined against the public
[vscode-webview-starter-kit](https://github.com/tnaum-ms/vscode-webview-starter-kit)
reference repository.

---

## What's inside

- **`WebviewController`** — manages a `vscode.WebviewPanel`, dispatches
  incoming tRPC operations (queries, mutations, subscriptions), and handles
  abort / subscription cancellation lifecycle.
- **`vscodeLink`** — a custom tRPC link that bridges tRPC over
  `window.postMessage`. Type-safe end-to-end from the extension host to the
  React webview.
- **React hooks** — `useTrpcClient`, `useConfiguration`,
  `useSelectiveContextMenuPrevention`.
- **Webview context** — `WebviewContext`, `WithWebviewContext` for wiring up
  the React tree.
- **Pluggable telemetry middleware** — generic `TelemetryContext`, a
  `createMiddleware` factory, and a default `console.log` sink. Plug in your
  own instrumentation (e.g. Application Insights) by writing a custom
  middleware.
- **Accessibility helper** — `Announcer` for ARIA live-region announcements
  (WCAG 4.1.3 status messages).

## Entry points

The package has two separate entry points so bundlers do not drag Node /
VS Code APIs into the webview bundle.

```ts
// Webview (browser) side — no Node / vscode imports
import {
    useTrpcClient,
    useConfiguration,
    Announcer,
    WithWebviewContext,
} from '@microsoft/vscode-ext-react-webview';

// Extension host side — uses fs, path, vscode
import {
    WebviewController,
    router,
    publicProcedure,
    createMiddleware,
    type BaseRouterContext,
} from '@microsoft/vscode-ext-react-webview/server';
```

## Peer dependencies

| Package | Required version |
| --- | --- |
| `react` | `>=18.0.0` |
| `@trpc/client` | `^11.0.0` |
| `@trpc/server` | `^11.0.0` |
| `@vscode/l10n` | `^0.0.18` |
| `vscode-webview` | `^1.0.0` (optional — webview-side only) |

## Status

`0.8.0-preview`. Version aligns with the parent
[vscode-documentdb](https://github.com/microsoft/vscode-documentdb) extension
that currently ships it. APIs are subject to change while the package is in
preview.

## License

MIT — see [LICENSE.md](../../LICENSE.md) at the repository root.
