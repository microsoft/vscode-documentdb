# `src/webviews/api/`

Local integration layer between the DocumentDB extension and
[`@microsoft/vscode-ext-react-webview`](../../../packages/vscode-ext-react-webview/README.md).

> This folder is **not** the extension's public API. It is the
> consumer-owned glue that wires the framework package (tRPC transport +
> base `WebviewController`) into this extension's bundle layout, telemetry
> pipeline, and webview registry.

## Files

| File                   | Owns                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `appRouter.ts`         | Root tRPC router, `BaseRouterContext`, common procedures (telemetry/survey helpers) |
| `trpc.ts`              | DocumentDB telemetry middleware, `publicProcedureWithTelemetry`, `WithTelemetry`    |
| `useTrpcClient.ts`     | React hook pre-bound to `AppRouter` (browser-side glue)                             |
| `WebviewController.ts` | DocumentDB controller base class; pre-fills bundle layout and dev-server host       |
| `WebviewRegistry.ts`   | Webview name to React component map; source of the `WebviewName` union              |

Per-view router files (`collectionViewRouter.ts`, `documentsViewRouter.ts`)
live next to their views, not here. See "Per-view router convention" below.

## When you want to X, edit Y

| Task                                                  | Edit                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| Add a new webview                                     | `WebviewRegistry.ts` (and register the controller command) |
| Add a tRPC procedure to an existing view              | `<view>Router.ts` next to the view                         |
| Bundle a new per-view router into the app router tree | `appRouter.ts`                                             |
| Change the telemetry sink or RPC event namespace      | `trpc.ts`                                                  |
| Add a field to the per-procedure context              | `BaseRouterContext` in `appRouter.ts`                      |
| Change the bundle layout or dev-server host           | `WebviewController.ts`                                     |

## Data flow

1. **Extension host:** a view controller extends
   `WebviewController` (this folder) and is constructed in response to a
   user command. The framework wires `appRouter` to the webview panel.
2. **Transport:** `vscodeLink` (from the framework package) marshals
   tRPC calls over `postMessage` between host and webview.
3. **Webview (browser):** React components call `useTrpcClient()` (this
   folder) to get an `AppRouter`-typed client and invoke procedures.

## Per-view router convention

Per-view routers live in the same folder as the view they serve, for
example:

- `src/webviews/documentdb/collectionView/collectionViewRouter.ts`
- `src/webviews/documentdb/documentView/documentsViewRouter.ts`

Each per-view router:

- Defines a `RouterContext` type that extends `BaseRouterContext` with
  view-specific fields (e.g. cluster id, collection name).
- Imports `publicProcedureWithTelemetry` and `router` from `../../api/trpc`.
- Imports `BaseRouterContext` from `../../api/appRouter` when extending
  the context.
- Is wired into the root tRPC tree in `appRouter.ts` so it is reachable
  from the webview client.

When the surface in this folder is reshaped (planned for beta), the README
will be updated in lock step.
