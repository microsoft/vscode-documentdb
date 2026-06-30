# ADVANCED.md - the behind-the-scenes manual

This is the deep documentation behind the
[README](./README.md) quick start. The README shows the one-call front door
(`openWebview`); this file documents the primitives underneath it and the
patterns you reach for when you outgrow the front door.

Everything here references real, shipped symbols. The public surface is split
across four entry points; see [Tiers](#tiers-and-when-to-use-each) below.

## Table of contents

- [Tiers and when to use each](#tiers-and-when-to-use-each)
- [Bring your own panel: `attachTrpc`](#bring-your-own-panel-attachtrpc)
- [Your own tRPC instance and `createCallerFactory`](#your-own-trpc-instance-and-createcallerfactory)
- [Telemetry adapters](#telemetry-adapters)
- [The webview event channel](#the-webview-event-channel)
- [Framework-agnostic client: `connectTrpc`](#framework-agnostic-client-connecttrpc)
- [Push events from host to webview: `TypedEventSink`](#push-events-from-host-to-webview-typedeventsink)
- [The type-only router import rule](#the-type-only-router-import-rule)
- [FAQ](#faq)

## Tiers and when to use each

The package is three tiers stacked on a shared base. Pick the lowest tier that
solves your problem; each lower tier is more flexible and more verbose.

| Tier              | Subpath                                       | Use it when                                                                                     |
| ----------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Front door        | `openWebview` (`./host`) + `./react` hooks    | You want a panel, a router, and React hooks with the least ceremony. This is the README path.    |
| Panel primitive   | `WebviewController` / `attachTrpc` (`./host`)  | You own the `vscode.WebviewPanel` lifecycle, or you need controller subclass hooks.              |
| Transport primitive | `connectTrpc` / `vscodeLink` (`./webview`)   | You use a UI framework other than React, or you need a bespoke client with custom links.         |

The shared `.` entry (router builders, `TypedEventSink`, wire types) sits under
all three and imports neither `vscode` nor React.

## Bring your own panel: `attachTrpc`

`WebviewController` is built on a single primitive: `attachTrpc`. When you
already own a `vscode.WebviewPanel` (because another part of your extension
created it, or you need custom panel options), wire tRPC onto it directly.

```ts
import { attachTrpc } from '@microsoft/vscode-ext-webview/host';
import { appRouter, createCallerFactory } from './webviews/_integration/appRouter';

const { disposable, activeOperations, activeSubscriptions } = attachTrpc(
  panel, // your vscode.WebviewPanel
  { workspaceRoot: '/path' }, // the router context
  appRouter,
  createCallerFactory, // from your initWebviewTrpc(...) result; optional
  consoleProcedureLogger, // optional dispatch logger; omit for none
);

panel.onDidDispose(() => disposable.dispose());
```

`attachTrpc` returns:

- `disposable` - tears down the message listener; dispose it on panel disposal.
- `activeOperations` - a `Map` of in-flight query / mutation `AbortController`s.
- `activeSubscriptions` - a `Map` of open subscriptions, keyed by id.

It dispatches incoming webview messages (queries, mutations, subscriptions)
against the router, threads an `AbortSignal` into `ctx.signal`, and handles
`subscription.stop` and `abort` cancellation. If you pass a `ProcedureLogger`,
it logs one structured entry per completed call (see
[Telemetry adapters](#telemetry-adapters)).

## Your own tRPC instance and `createCallerFactory`

`initWebviewTrpc<TContext>()` returns a tRPC instance bound to your context
type. Destructure what you need:

```ts
const { router, publicProcedure, createCallerFactory, middleware } =
  initWebviewTrpc<RouterContext>();
```

- `router` builds (sub)routers.
- `publicProcedure` is the base procedure; its `ctx` is typed as `TContext`.
- `createCallerFactory` builds a server-side caller for a router. The host
  dispatcher (`attachTrpc` / `WebviewController` / `openWebview`) needs it to
  invoke procedures with full type inference. Pass it via the `createCallerFactory`
  option / argument.
- `middleware` builds reusable middleware bound to this instance (used by the
  telemetry adapters below).

If you do not pass your own `createCallerFactory`, the host falls back to the
package's shared default instance, which works only when your router is built
with the package's default `router` / `publicProcedure` (the ones exported from
`.`). When you call `initWebviewTrpc<RouterContext>()` to get a typed context,
always re-export and pass its `createCallerFactory`.

## Telemetry adapters

The package separates the telemetry policy (where data goes) from the
plumbing (how a call is timed and classified). Two middleware bodies cover the
two common policies; both are pure functions you wire onto your own procedure.

### Console logging: `loggingMiddlewareBody` + `ProcedureLogger`

`consoleProcedureLogger` is the zero-config default the panel uses out of the
box (it logs `[tRPC] <type> <path> (<ms>) <status>`). To route those entries
elsewhere, implement `ProcedureLogger`:

```ts
import { loggingMiddlewareBody, type ProcedureLogger } from '@microsoft/vscode-ext-webview/host';

const logger: ProcedureLogger = {
  log(entry) {
    // entry: { type, path, durationMs, ok, aborted, error? }
    myOutputChannel.appendLine(`${entry.type} ${entry.path} ${entry.durationMs}ms`);
  },
};

const logged = publicProcedure.use((opts) => loggingMiddlewareBody(opts, logger));
```

You can also pass a `ProcedureLogger` as the `telemetry` option to `openWebview`
/ `WebviewController` (or the last argument to `attachTrpc`) to log at the
dispatch layer without touching procedure definitions.

### Analytics: `telemetryMiddlewareBody` + `TelemetryRunner`

For real analytics (for example Application Insights via
`@microsoft/vscode-azext-utils`), implement a `TelemetryRunner` that
establishes a telemetry scope and hands the body a telemetry bag:

```ts
import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import {
  initWebviewTrpc,
  // shared entry
} from '@microsoft/vscode-ext-webview';
import { telemetryMiddlewareBody, type TelemetryRunner } from '@microsoft/vscode-ext-webview/host';

const runner: TelemetryRunner = {
  async run(invocation, execute) {
    const result = await callWithTelemetryAndErrorHandling(
      `myExt.rpc.${invocation.type}.${invocation.path}`,
      async (context) => {
        context.errorHandling.suppressDisplay = true;
        return execute(context.telemetry);
      },
    );
    if (!result) throw new Error(`No result for ${invocation.type} ${invocation.path}`);
    return result;
  },
};

const { publicProcedure } = initWebviewTrpc<RouterContext>();
export const trackedProcedure = publicProcedure.use((opts) => telemetryMiddlewareBody(opts, runner));
```

`telemetryMiddlewareBody` injects the telemetry bag into `ctx.telemetry`, times
the call, records cancellation as `Canceled` (with `aborted: 'true'`), records
failures as `Failed` with the error name and message, and returns the
procedure's result unchanged. Build your router from `trackedProcedure` instead
of the bare `publicProcedure` to instrument every call.

The dispatch logger and the middleware body are independent sinks: the logger
reports at the transport boundary, the middleware reports inside each procedure
scope. Using both does not double-count a single call into one analytics event.

## The webview event channel

By default a query or mutation that throws on the host propagates to the
call-site `.catch(...)` (or `try / catch` around `await`). That works, but it
forces every call site to remember to handle the error. When a single place
should always see webview-side outcomes (an ARIA announcer, a toaster,
telemetry), observe the event channel.

`useRpcEvents()` returns the per-webview `RpcEventChannel`:

```tsx
import { useEffect } from 'react';
import { useRpcEvents } from '@microsoft/vscode-ext-webview/react';

function ErrorAnnouncer() {
  const events = useRpcEvents();
  useEffect(() => {
    const off = events.onError((err, info) => announcer.announceError(`${info.path}: ${err.message}`));
    return off;
  }, [events]);
  return null;
}
```

The channel exposes three observe methods, each returning an unsubscribe:

- `onSuccess(handler)` - the call resolved; `handler(info, data)`.
- `onError(handler)` - the call rejected; `handler(error, info)`.
- `onAborted(handler)` - the call was canceled; `handler(info)`.

`info` is a `CallInfo` (`{ type, path }`). The channel observes; it does not
swallow. Your call-site handlers still run and still receive the error.
Subscription errors are surfaced through `onError` as well, alongside the
subscription's own `.subscribe({ onError })` hook; deduplicate at the call site
if you observe both.

The channel and the tRPC client are created together and shared per webview, so
`useTrpcClient()` and `useRpcEvents()` always see the same instance.

## Framework-agnostic client: `connectTrpc`

The React hooks are sugar over a React-free factory. `connectTrpc(vscodeApi,
options?)` from `./webview` builds the same client and event channel with no
React dependency, so you can bind another UI framework on top of the transport:

```ts
import { connectTrpc } from '@microsoft/vscode-ext-webview/webview';
import type { AppRouter } from './_integration/appRouter';

const vscodeApi = acquireVsCodeApi();
const { client, events } = connectTrpc<AppRouter>(vscodeApi, {
  onError: (err) => console.error(err),
});

const result = await client.hello.query({ name: 'world' });
events.onAborted((info) => console.debug('canceled', info.path));
```

`vscodeApi` only needs a `postMessage(message)` method (`VsCodeApiLike`). The
`onError` option is a shorthand for `events.onError((err) => onError(err))`;
aborted calls are reported via `onAborted`, not `onError`. For full control over
link order (for example composing a third-party logging link), import
`vscodeLink` (and optionally `errorLink` / the lower-level `eventLink`) and
build the client yourself with `createTRPCClient`.

## Push events from host to webview: `TypedEventSink`

tRPC subscriptions are `async function*` generators, which fit pull-style
producers (cursors, polling loops). For push-style producers (VS Code event
emitters, driver callbacks, completion notifiers) you need an adapter that the
producer can call imperatively and the subscription can iterate.

`TypedEventSink<T>` is that adapter. It implements `AsyncIterable<T>` over a
discriminated event union, with a write-only `emit(event)` (or `emit(type,
payload)`) on the producer side and `for await (const event of sink)` on the
consumer side. Single consumer per sink; events emitted before a consumer
attaches are buffered.

Define the event union and the events router:

```ts
// _integration/myViewEventsRouter.ts
import { initWebviewTrpc, type BaseRouterContext, type TypedEventSink } from '@microsoft/vscode-ext-webview';

export type MyViewEvent =
  | { type: 'progress'; percent: number }
  | { type: 'completed'; durationMs: number };

type MyViewRouterContext = BaseRouterContext & {
  eventSink: TypedEventSink<MyViewEvent>;
};

const { router, publicProcedure } = initWebviewTrpc<MyViewRouterContext>();

export const myViewEventsRouter = router({
  events: publicProcedure.subscription(async function* ({ ctx }) {
    for await (const event of ctx.eventSink) {
      if (ctx.signal?.aborted) return;
      yield event;
    }
  }),
});
```

Emit from anywhere in host code that holds the sink:

```ts
sink.emit({ type: 'progress', percent: 25 });
sink.emit('completed', { durationMs: 1500 });
```

Consume in the webview with the standard subscription API:

```tsx
useEffect(() => {
  const sub = trpcClient.myView.events.subscribe(undefined, {
    onData: (event) => {
      if (event.type === 'progress') setPercent(event.percent);
      else if (event.type === 'completed') setDoneAfter(event.durationMs);
    },
  });
  return () => sub.unsubscribe();
}, [trpcClient]);
```

Recommended convention: put push-event procedures in a sibling
`<view>EventsRouter.ts` and merge it into the view's main router. This keeps
"things the webview calls" and "things the host pushes" in separate files, so
the entire event vocabulary of a view is discoverable at a glance.

When the producer (panel, session, task) finishes for good, call `sink.close()`.
The framework already cleans up async iteration on unsubscribe and panel
disposal via `iterator.return()`, but `close()` is still the right signal
whenever the sink has no more events to ever emit: it lets late producers stop
without checking, and prevents reuse by accident.

## The type-only router import rule

The webview needs the `AppRouter` type to keep `useTrpcClient<AppRouter>()`
type-safe end to end. This is the only thing webview code should import from the
file that defines your router.

```tsx
import type { AppRouter } from '../_integration/appRouter';
import { useTrpcClient } from '@microsoft/vscode-ext-webview/react';

const trpcClient = useTrpcClient<AppRouter>();
```

A few rules of thumb keep the host / browser boundary honest:

- Use `import type { AppRouter } from '...'` (or `import { type AppRouter }`).
  Type-only imports are erased at compile time and never produce runtime
  references, so the webview bundle stays free of extension-host code even if
  the router module also imports Node-only APIs.
- Do not import runtime values (the `appRouter` constant, procedure builders,
  middleware) from webview code. Those belong to the extension-host side.
- Do not reach into procedure implementation files from the webview side.
  Router types are the only contract the webview consumes.

If your bundler ever pulls host modules into the views bundle, the most common
cause is a non-type-only import of `AppRouter`. Switching it to
`import type { ... }` resolves it without changes to the router itself.

## FAQ

### Why tRPC instead of raw `postMessage`?

Raw `postMessage` requires you to define message types manually, match
request / response pairs by hand, and serialise yourself. tRPC threads
TypeScript types end to end. Your host procedures and webview calls share the
same `AppRouter` type with zero code generation. Renaming a field on the host
shows a compile error in the webview immediately.

### Why are there four entry points?

`.` is side-agnostic (no `vscode`, no React). `./host` is the extension-host
surface and imports `fs` / `path` / `vscode`. `./webview` is the browser-side
transport with no React dependency. `./react` adds the React hooks. Splitting
them keeps Node / `vscode` out of the webview bundle, and keeps React out of a
non-React consumer's bundle.

### Can I have multiple webview panels open at the same time?

Yes. Each `WebviewController` (or `attachTrpc` call) owns its own panel and its
own tRPC caller. State is not shared between panels unless you explicitly
coordinate through the host (for example a singleton service).

### Can I cancel a long-running query or subscription?

Yes. Pass an `AbortSignal` on the client side:

```ts
const ac = new AbortController();
const result = await trpcClient.something.query(input, { signal: ac.signal });
// later
ac.abort();
```

On the host side, read `ctx.signal` inside your procedure to cooperatively stop
work. Subscriptions stop cleanly when the client unsubscribes: the framework
sends a `subscription.stop` message and the dispatcher both aborts the
per-operation `AbortController` and calls `iterator.return()` on the procedure's
async generator. The `return()` call propagates into any inner `for await` loop,
including loops over a `TypedEventSink`, releasing consumers parked on the next
event without waiting for the producer to emit or close. The same cleanup runs
when the panel is disposed.

### Can I use a UI library other than React?

Yes, on top of `./webview`. The React hooks (`useTrpcClient`, `useRpcEvents`,
`useConfiguration`, `WithWebviewContext`) are React-specific, but the underlying
transport (`connectTrpc`, `vscodeLink`) is framework-agnostic. Build a binding
for your framework on top of `connectTrpc`; the package itself does not ship one.

## License

MIT. See [LICENSE.md](../../LICENSE.md) at the repository root.
