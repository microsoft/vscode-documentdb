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

| File                          | Side    | Purpose                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rpcConcurrencyLogger.ts`     | host    | The `ProcedureLogger` passed to `openAppWebview`. Delegates to the framework console logger, then feeds each dispatch entry's `concurrent` count into an accumulating-telemetry distribution (`concurrentRpcOps`) so peak / average in-flight RPC concurrency is observable across the fleet (R766-S04). |
| `reportObserverError.ts`      | webview | The `ObserverErrorHandler` passed to `WithWebviewContext`'s `onObserverError`. Keeps the framework's structured `console.error` and additionally elevates a throwing RPC event observer to the browser global error stream via `reportError()`, without re-entering the tRPC channel (R766-N05).         |
| `rpcConcurrencyLogger.test.ts` | host    | Unit tests for the concurrency logger (console delegation + gauge sampling, and that non-dispatch entries are ignored).                                                                                                                                                                                     |
| `reportObserverError.test.ts` | webview | Unit tests for the observer-error sink (structured console line + guarded `reportError()` elevation).                                                                                                                                                                                                       |

## Wiring

- `rpcConcurrencyLogger` is wired in [`../openAppWebview.ts`](../openAppWebview.ts)
  as the `logger` option, so every DocumentDB panel samples RPC concurrency.
- `reportObserverError` is wired in [`../../index.tsx`](../../index.tsx) on
  `WithWebviewContext`, so every DocumentDB webview surfaces event-observer
  failures instead of only isolating them.
