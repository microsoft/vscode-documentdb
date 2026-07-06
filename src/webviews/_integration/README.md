# `src/webviews/_integration/`

Local integration layer between the DocumentDB extension and
[`@microsoft/vscode-ext-webview`](../../../packages/vscode-ext-webview/README.md).

> This folder is **not** the extension's public API. It is the
> consumer-owned glue that wires the framework package (tRPC transport, the
> `openWebview` factory, and pluggable telemetry) into this extension's
> bundle layout, telemetry pipeline, and webview registry.

## Files

| File                 | Side                      | Purpose                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `configuration.ts`   | host                      | Single home for consumer-owned knobs: the telemetry namespace and event prefixes, the bundle-vs-dev source layout, and the dev-server host. Other files import a slice of `WEBVIEW_CONFIG` rather than hard-coding these.                                                                                                                                                                 |
| `trpc.ts`            | host                      | The extension's one tRPC instance (`initWebviewTrpc`). Exports `publicProcedure`, `router`, `createCallerFactory`, `publicProcedureWithTelemetry`, and the `WithTelemetry` helper, and owns the DocumentDB `TelemetryRunner` that reports RPC telemetry to Application Insights. Kept as a leaf module so per-view routers can import it without a circular dependency on `appRouter.ts`. |
| `appRouter.ts`       | host                      | The root tRPC router (the `common` router plus each per-view router), the DocumentDB `BaseRouterContext`, and the shared `common` procedures (report event, report error, display error, survey ping/open, open URL). Imports its primitives from `trpc.ts`.                                                                                                                              |
| `openAppWebview.ts`  | host                      | DocumentDB preset over the package `openWebview` factory. Pre-fills `appRouter`, `createCallerFactory`, the telemetry logger, and the `configuration.ts` layout, so each per-view factory only passes what is unique to its view. This is the function-shaped replacement for the former `WebviewControllerBase` class.                                                                   |
| `useTrpcClient.ts`   | webview                   | React hook pre-typed to `AppRouter`, so components call `useTrpcClient()` without repeating the router type argument.                                                                                                                                                                                                                                                                     |
| `WebviewRegistry.ts` | webview value + host type | Maps each webview name to its React root component (read by `render()` in `src/webviews/index.tsx`) and is the source of the `WebviewName` union (used host-side by `openAppWebview`). See the file's own comment for how to add an entry.                                                                                                                                                |
| `observability/`     | host + webview            | DocumentDB's opt-in observability sinks that specialize the framework's generic defaults into this extension's telemetry and error pipelines: `rpcConcurrencyLogger.ts` (host) and `reportObserverError.ts` (webview). See [`observability/README.md`](./observability/README.md).                                                                                                        |

Per-view router files (`collectionViewRouter.ts`, `documentsViewRouter.ts`)
live next to their views, not here. See "Per-view router convention" below.

## When you want to X, edit Y

| Task                                                  | Edit                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Add a new webview                                     | `WebviewRegistry.ts`, a per-view factory that calls `openAppWebview`, and the open command |
| Add a tRPC procedure to an existing view              | `<view>Router.ts` next to the view                                                         |
| Bundle a new per-view router into the app router tree | `appRouter.ts`                                                                             |
| Change the telemetry sink or RPC event namespace      | `configuration.ts` (event prefixes) + `trpc.ts` (the `TelemetryRunner` sink)               |
| Add a field to the per-procedure context              | `BaseRouterContext` in `appRouter.ts`                                                      |
| Change the bundle layout or dev-server host           | `configuration.ts`                                                                         |
| Change how RPC concurrency is logged / sampled        | `observability/rpcConcurrencyLogger.ts`                                                    |
| Change how webview event-observer errors are reported | `observability/reportObserverError.ts`                                                     |

## Data flow

1. **Extension host:** a per-view factory (e.g. `openCollectionWebview`)
   calls `openAppWebview(...)` in response to a user command. That opens the
   panel, renders its HTML, and wires `appRouter` to it through the framework's
   `openWebview` factory.
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
- Imports `publicProcedureWithTelemetry` and `router` from `../../_integration/appRouter`.
- Imports `BaseRouterContext` from `../../_integration/appRouter` when extending
  the context.
- Is wired into the root tRPC tree in `appRouter.ts` so it is reachable
  from the webview client.

This folder was reshaped for the `@microsoft/vscode-ext-webview` redesign: the
former `WebviewControllerBase` class became the `openAppWebview` factory, and
the telemetry sink moved into `trpc.ts`. The DocumentDB observability adapters
(`rpcConcurrencyLogger`, `reportObserverError`) then moved into the
`observability/` subfolder to keep this top level focused on the router and
transport wiring. Keep this README in lock step whenever the surface changes
again.
