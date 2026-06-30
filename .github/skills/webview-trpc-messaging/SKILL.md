---
name: webview-trpc-messaging
description: Implements tRPC-based communication between VS Code extension host and React webviews. Use when creating new webview procedures (queries, mutations, subscriptions), adding a new webview router, wiring up a webview controller, using the tRPC client from React components, applying telemetry middleware (trpcToTelemetry), or supporting AbortSignal-based cancellation in webview operations.
---

# Webview tRPC Messaging

Type-safe RPC communication between the VS Code extension host (server) and React webviews (client) using tRPC.

## Architecture Overview

```
React Webview (client)                    Extension Host (server)
─────────────────────                     ──────────────────────
useTrpcClient() hook                      WebviewController
  └─ createTRPCClient                       └─ setupTrpc()
       └─ vscodeLink ──── postMessage ────►     ├─ callerFactory(appRouter)
            (send/onReceive)              ◄─────┤   └─ procedure(input)
                                                └─ abort/subscription.stop
```

**Key files** (read as needed for implementation details):

| File                                                             | Purpose                                                                                                                |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `@microsoft/vscode-ext-webview` (shared)                         | tRPC init via `initWebviewTrpc`, `publicProcedure`, `router`, `BaseRouterContext`                                      |
| `@microsoft/vscode-ext-webview/host` (telemetry)                 | `telemetryMiddlewareBody`, `ProcedureLogger`, `TelemetryRunner` (consumer builds `publicProcedureWithTelemetry`)       |
| `src/webviews/_integration/trpc.ts`                        | Consumer tRPC instance: `publicProcedureWithTelemetry`, the DocumentDB `TelemetryRunner`, `WithTelemetry`              |
| `src/webviews/_integration/appRouter.ts`                   | Root router + `publicProcedureWithTelemetry` wiring + DocumentDB `BaseRouterContext`                                   |
| `src/webviews/_integration/configuration.ts`               | Consumer-owned knobs (telemetry namespace, bundle layout, dev-server host)                                             |
| `@microsoft/vscode-ext-webview/host` (WebviewController)         | `WebviewController` + `openWebview` factory: WebviewPanel lifecycle, tRPC dispatcher (queries, mutations, subscriptions, abort) |
| `src/webviews/_integration/openAppWebview.ts`              | DocumentDB factory preset that pre-fills router + bundle layout (`openAppWebview`)                                     |
| `src/webviews/_integration/useTrpcClient.ts`               | React hook providing the tRPC client (pre-typed against `AppRouter`)                                                   |
| `@microsoft/vscode-ext-webview/webview` (vscodeLink)             | Custom tRPC link bridging `postMessage` transport                                                                      |

## Creating a New Router

Each webview maintains its own router. Follow this pattern:

### 1. Define the router context

Extend `BaseRouterContext` with view-specific fields:

```typescript
// src/webviews/documentdb/myView/myViewRouter.ts
import { type BaseRouterContext } from '../../_integration/appRouter';

export type RouterContext = BaseRouterContext & {
  clusterId: string;
  viewId: string;
  databaseName: string;
  // add view-specific fields
};
```

### 2. Define procedures

```typescript
import { z } from 'zod';
import { publicProcedureWithTelemetry, router, type WithTelemetry } from '../../_integration/appRouter';

export const myViewRouter = router({
  // Query with telemetry (preferred for operations that touch external services)
  getData: publicProcedureWithTelemetry.input(z.object({ id: z.string() })).query(async ({ input, ctx }) => {
    const myCtx = ctx as WithTelemetry<RouterContext>;
    // myCtx.telemetry is guaranteed present
    // myCtx.signal is the AbortSignal for cancellation
    return { data: 'result' };
  }),

  // Mutation without telemetry (rare, use for fire-and-forget)
  doAction: publicProcedure.input(z.string()).mutation(({ input }) => {
    // lightweight operation
  }),
});
```

### 3. Register in appRouter

```typescript
// src/webviews/_integration/appRouter.ts
import { myViewRouter } from '../../documentdb/myView/myViewRouter';

export const appRouter = router({
  common: commonRouter,
  mongoClusters: {
    documentView: documentViewRouter,
    collectionView: collectionViewRouter,
    myView: myViewRouter, // <-- add here
  },
});
```

### 4. Create the controller

Construction-only panels are opened with a factory function that builds the
config + router context and calls the `openAppWebview` preset (which pre-fills
the app router, caller factory, and bundle layout):

```typescript
// src/webviews/documentdb/myView/myViewController.ts
import * as vscode from 'vscode';
import { API } from '../../../DocumentDBExperiences';
import { type AppWebviewController, openAppWebview } from '../../_integration/openAppWebview';
import { type RouterContext } from './myViewRouter';

export function openMyViewPanel(initialData: MyViewConfig): AppWebviewController<MyViewConfig> {
  const title = `${initialData.databaseName}`;

  const trpcContext: RouterContext = {
    dbExperience: API.DocumentDB,
    webviewName: 'myView',
    clusterId: initialData.clusterId,
    viewId: initialData.viewId,
    databaseName: initialData.databaseName,
  };

  return openAppWebview({
    title,
    webviewName: 'myView',
    config: initialData,
    context: trpcContext,
  });
}
```

The returned `AppWebviewController` handle exposes `panel`, `onDisposed`,
`revealToForeground`, `isDisposed`, and `dispose`. Genuinely stateful panels may
still extend `WebviewController` from `@microsoft/vscode-ext-webview/host`
directly instead of using the factory.

> **Important:** The `webviewName` field passed to `openAppWebview` is the
> **registry key** (`viewType`, must match a key in `WebviewRegistry`, e.g.
> `collectionView`). The `webviewName` in the tRPC context is a **telemetry
> label** used in telemetry event names. These may be the same string but serve
> different purposes -- do not confuse them.

### 5. Register in WebviewRegistry

Add your React component to the registry. The key must match the `webviewName`
passed to `openAppWebview` (`viewType`). The `WebviewName` type (exported from
the same file) ensures compile-time validation of webview names.

```typescript
// src/webviews/_integration/WebviewRegistry.ts
import { MyView } from '../../documentdb/myView/MyView';

export const WebviewRegistry = {
  collectionView: CollectionView,
  documentView: DocumentView,
  myViewName: MyView, // <-- add your entry
} as const;

export type WebviewName = keyof typeof WebviewRegistry;
```

## Telemetry: `publicProcedure` vs `publicProcedureWithTelemetry`

| Base                           | When to use                                                                  | `ctx.telemetry`                             |
| ------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------- |
| `publicProcedure`              | Fire-and-forget, no external calls, telemetry reported separately            | `undefined`                                 |
| `publicProcedureWithTelemetry` | **Default choice.** Any procedure touching DB, network, or user-visible work | Guaranteed via `trpcToTelemetry` middleware |

`trpcToTelemetry` (file-local, not exported) wraps the procedure in `callWithTelemetryAndErrorHandling`, auto-generating a telemetry event named `documentDB.rpc.{type}.{path}` and recording errors, duration, and abort status.

Access telemetry safely:

```typescript
const myCtx = ctx as WithTelemetry<RouterContext>;
myCtx.telemetry.properties.myCustomProp = 'value';
myCtx.telemetry.measurements.itemCount = items.length;
```

## AbortSignal Support

Every tRPC operation (query, mutation, subscription) receives its own `AbortController`. Cancellation flows:

```
Client (React)                              Server (Extension Host)
──────────────                              ──────────────────────
// Queries/Mutations:
ac = new AbortController()
trpcClient.myProc.query(input,
  { signal: ac.signal })
ac.abort()  →  sends 'abort' msg  →  abortController.abort()
                                        → ctx.signal.aborted = true

// Subscriptions:
sub = trpcClient.mySub.subscribe(...)
sub.unsubscribe()  →  'subscription.stop'  →  abortController.abort()
```

### Using abort in procedures

```typescript
// Pass signal to APIs that accept it (MongoDB driver, fetch, etc.)
getData: publicProcedureWithTelemetry
    .input(z.object({ filter: z.record(z.unknown()) }))
    .query(async ({ input, ctx }) => {
        const myCtx = ctx as WithTelemetry<RouterContext>;

        // Option 1: Pass to driver (preferred)
        const cursor = collection.find(input.filter, { signal: myCtx.signal });

        // Option 2: Manual check in loops
        for (const item of items) {
            if (myCtx.signal?.aborted) return;
            await processItem(item);
        }
    }),
```

### Client-side abort

```tsx
const trpcClient = useTrpcClient();
const abortControllerRef = useRef<AbortController>();

const runQuery = async () => {
  abortControllerRef.current?.abort(); // cancel previous
  const ac = new AbortController();
  abortControllerRef.current = ac;

  const result = await trpcClient.mongoClusters.collectionView.myQuery.query(input, { signal: ac.signal });
};
```

When `trpcToTelemetry` detects an aborted signal, it sets `telemetry.properties.aborted = 'true'` and `result = 'Canceled'` automatically.

## Subscriptions

Subscriptions stream multiple values from server to client using async generators:

```typescript
// Server (router)
streamData: publicProcedureWithTelemetry
    .input(z.object({ batchSize: z.number() }))
    .subscription(async function* ({ input, ctx }) {
        const myCtx = ctx as WithTelemetry<RouterContext>;

        for (let i = 0; i < total; i += input.batchSize) {
            if (myCtx.signal?.aborted) return; // check before each yield
            const batch = await fetchBatch(i, input.batchSize);
            yield batch;
        }
    }),

// Client (React)
const sub = trpcClient.mongoClusters.myView.streamData.subscribe(
    { batchSize: 100 },
    {
        onData(batch) { /* handle each batch */ },
        onComplete() { /* all done */ },
        onError(err) { /* handle error */ },
    },
);

// To stop:
sub.unsubscribe();
```

## Client-Side Hook Usage

```tsx
import { useTrpcClient } from '../_integration/useTrpcClient';
import { useConfiguration } from '@microsoft/vscode-ext-webview/react';

export const MyComponent = () => {
  const trpcClient = useTrpcClient();
  const config = useConfiguration<MyViewConfig>();

  useEffect(() => {
    trpcClient.mongoClusters.myView.getData.query({ id: config.documentId }).then(setData);
  }, []);
};
```

`useConfiguration<T>()` retrieves the initial config passed to `WebviewController` constructor (serialized via `encodeURIComponent(JSON.stringify(...))`).

## Common Pitfalls

- **Never use `any`** in procedure context casts — use `WithTelemetry<RouterContext>` or `RouterContext`
- **Always prefer `publicProcedureWithTelemetry`** unless you have a specific reason not to
- **Always check `myCtx.signal?.aborted`** in long-running loops — not checking causes wasted work after client cancels
- **Do not mutate the shared `context` object** — `WebviewController` clones it per-operation already, but router code should treat `ctx` as read-only
- **Input validation uses `zod`** — always define `.input(z.object({...}))` for type safety
- **The `commonRouter`** handles cross-cutting concerns (error reporting, telemetry events, surveys, URL opening) — do not duplicate these in view-specific routers
