# `src/webviews/_integration/observability/`

DocumentDB's opt-in observability sinks for the
[`@microsoft/vscode-ext-webview`](../../../../packages/vscode-ext-webview/README.md)
package. The framework ships quiet, generic defaults (a console dispatch logger,
an isolated observer-error handler that logs to `console.error`); the files here
are the DocumentDB-specific adapters that elevate those defaults into this
extension's telemetry and error pipelines.

They live in their own folder because they are cross-cutting plumbing (one host
side, one webview side) rather than part of the router/transport wiring in the
parent folder. Group new logging, telemetry-adapter, or error-reporting sinks
here.

## Files

| File                            | Side    | Purpose                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rpcConcurrencyLogger.ts`       | host    | The `ProcedureLogger` passed to `openAppWebview`. Delegates to the framework console logger, then feeds each dispatch entry's `concurrent` count into an accumulating-telemetry distribution (`concurrentRpcOps`) so peak / average in-flight RPC concurrency is observable across the fleet (R766-S04).                                                         |
| `reportObserverError.ts`        | webview | The `ObserverErrorHandler` passed to `WithWebviewContext`'s `onObserverError`. Keeps the framework's structured `console.error` and additionally elevates a throwing RPC event observer to the browser global error stream via `reportError()`, without re-entering the tRPC channel (R766-N05).                                                                 |
| `resizeObserverLoopDetector.ts` | webview | **Dev-only.** Detects a _sustained_ ResizeObserver feedback loop by rate. Vite's overlay reports build errors, not runtime ResizeObserver warnings. This passive `window` 'error' listener `console.warn`s once per burst above a per-second threshold. Installed behind `process.env.NODE_ENV !== 'production'`, so it is dead-code-eliminated from production. |
| `viewLoadTelemetry.ts`          | host    | `ViewLoadTracker`: reports `documentDB.webview.viewLoaded` once per Collection View, Document View (opened documents) and Cluster Dashboard panel. Created by `openAppWebview` when a factory passes `viewLoad`; the webview sends milestones through `common.reportViewLoad` (`../useViewLoadTelemetry.ts`). See [View load time](#view-load-time).             |
| `rpcConcurrencyLogger.test.ts`  | host    | Unit tests for the concurrency logger (console delegation + gauge sampling, and that non-dispatch entries are ignored).                                                                                                                                                                                                                                          |
| `reportObserverError.test.ts`   | webview | Unit tests for the observer-error sink (structured console line + guarded `reportError()` elevation).                                                                                                                                                                                                                                                            |
| `viewLoadTelemetry.test.ts`     | host    | Unit tests for the once-only report, the outcome timings, timer cleanup and the event's properties.                                                                                                                                                                                                                                                              |

## Wiring

- `rpcConcurrencyLogger` is wired in [`../openAppWebview.ts`](../openAppWebview.ts)
  as the `logger` option, so every DocumentDB panel samples RPC concurrency.
- `reportObserverError` is wired in [`../../index.tsx`](../../index.tsx) on
  `WithWebviewContext`, so every DocumentDB webview surfaces event-observer
  failures instead of only isolating them.
- `installResizeObserverLoopDetector` is called in
  [`../../index.tsx`](../../index.tsx) behind a `process.env.NODE_ENV` guard, so
  only development builds watch for a sustained ResizeObserver loop.
- `ViewLoadTracker` is created by [`../openAppWebview.ts`](../openAppWebview.ts) only
  when a panel factory passes `viewLoad`, and is handed to procedures as `ctx.viewLoad`.

## View load time

`documentDB.webview.viewLoaded` answers how long a user waits for a view's first data, which
per-RPC events and the concurrency gauge cannot. One event per panel instance, emitted by the
host with `callWithTelemetryAndErrorHandling` when the first of these happens: the webview
reports its first load settled, the panel closes, or 120 s pass. A reveal of an open Cluster
Dashboard is not a new panel and sends nothing; a new document in the Document View
(`mode = add`) has nothing to load and sends nothing.

Timing starts on the host when `openAppWebview` is called, immediately before the panel is
created (`timingStart = panelCreated`). Milestones are timed with the host clock on arrival.

| Name                   | Kind        | Meaning                                                                                                                                                                             |
| ---------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `viewKind`             | property    | `collectionView`, `documentView` or `clusterDashboard`.                                                                                                                             |
| `loadOutcome`          | property    | `dataShown`, `empty` (no documents, a deleted document, no databases), `failed`, `closedBeforeData`, `timeout`.                                                                     |
| `timingStart`          | property    | Always `panelCreated`.                                                                                                                                                              |
| `webviewReady`         | property    | `true` when the webview mounted before the outcome. `false` with `closedBeforeData` or `timeout` means the bundle never ran.                                                        |
| `timeToWebviewReadyMs` | measurement | Panel creation to the webview's React mount (bundle load and render cost). Absent when it never mounted.                                                                            |
| `timeToFirstDataMs`    | measurement | Panel creation to the first load settling. Only for `dataShown`, `empty` and `failed`.                                                                                              |
| `timeToOutcomeMs`      | measurement | Panel creation to the outcome, for every outcome.                                                                                                                                   |
| `firstDataRpcMs`       | measurement | Webview-measured time of the request chain behind the first data: Collection View `runFindQuery` plus the page fetch, Document View `getDocumentById`, dashboard `getStorageStats`. |

Correlation and context: Collection View `collectionSessionId`, `viewId`, `initialTab` and
`journeyCorrelationId` when the opening command had one; Document View `viewId` and `documentMode`
(`view` or `edit`); Cluster Dashboard `viewId`, `dashboardSessionId` and `journeyCorrelationId`.
No names, query text or document contents are sent.
