# Webview-ext migration manual (internal)

Status: internal working note. Not linked from any index, README, or design doc.
It records the before/after of moving `@microsoft/vscode-ext-react-webview` to
`@microsoft/vscode-ext-webview`, both as a record for our team and as a template
for the parallel vscode-cosmosdb adoption PR.

Reviewed and current as of 2026-07-06, verified against the merged code. Two
host-wiring details settled after the first draft and are reflected below: the
options bag now takes the whole `trpc` instance (from `initWebviewTrpc<...>()`)
instead of a standalone `createCallerFactory` (which is retained but
`@deprecated`), and it requires an `isBundled: boolean` flag to pick the bundle
vs tsc source layout. `WithTelemetry` is now a generic helper exported by the
package rather than a locally-defined type.

This is a DocumentDB extension that speaks the MongoDB-compatible wire protocol;
references below to "DocumentDB" mean the database service, and "MongoDB API"
means the wire protocol / query language.

---

## 1. What changed, in one paragraph

The old package shipped two entry points (`.` mixing the webview client and
React, and `./server` for the host) and bound its own telemetry model into the
tRPC middleware. The new package splits into four side-aware subpaths
(`.` shared, `./host`, `./webview`, `./react`), exposes the host wiring as
composable primitives (`attachTrpc`, `openWebview`, the options-bag
`WebviewController`), turns telemetry into a small adapter you provide
(`telemetryMiddlewareBody` + a `TelemetryRunner`), and splits the React hook into
a client hook (`useTrpcClient`) and an events hook (`useRpcEvents`).

---

## 2. Rename map (old to new)

### Package and folder

| Old                                   | New                             |
| ------------------------------------- | ------------------------------- |
| `@microsoft/vscode-ext-react-webview` | `@microsoft/vscode-ext-webview` |
| version `0.8.0-preview`               | version `0.9.0-preview`         |
| `packages/vscode-ext-react-webview/`  | `packages/vscode-ext-webview/`  |

### Subpaths (2 to 4)

| Old subpath                         | New subpath(s)                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| `.` (webview client + React, mixed) | `.` (shared, no `vscode` / no `react`), `./webview` (client), `./react` (hooks) |
| `./server` (host)                   | `./host`                                                                        |

Import-side rules the split enforces:

- `.` imports no `vscode` and no `react`.
- `./webview` imports no `react`.
- `./react` is the only entry that pulls in React.
- `./host` is the only entry that pulls in `vscode`.

### Symbols

| Old (`@microsoft/vscode-ext-react-webview...`)                  | New                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/server`: `publicProcedure`, `router`                          | `.`: `initWebviewTrpc()` returns `{ router, publicProcedure, createCallerFactory, middleware }`; `publicProcedure`, `router` also re-exported from `.`                                                                                                                                      |
| `/server`: `BaseRouterContext`                                  | `.`: `BaseRouterContext`                                                                                                                                                                                                                                                                    |
| `/server`: `createMiddleware`                                   | RETIRED. Use `telemetryMiddlewareBody` / `loggingMiddlewareBody` from `./host` via `publicProcedure.use(...)`                                                                                                                                                                               |
| `/server`: `TelemetryContext`                                   | RETIRED. Use `ProcedureTelemetry` + `TelemetryRunner` + `ProcedureLogger` from `./host`                                                                                                                                                                                                     |
| `/server`: `WebviewController` (bespoke constructor)            | `./host`: `WebviewController` (single options-bag constructor) and the `openWebview(extensionContext, options)` factory. The options bag takes `trpc` (the `initWebviewTrpc<...>()` result) and a required `isBundled: boolean`; `createCallerFactory` is still accepted but `@deprecated`. |
| `.`: `vscodeLink`, `errorLink`, `createEventChannel`            | `./webview`: `vscodeLink`, `errorLink`, `createEventChannel` / `RpcEventChannel`; plus new `connectTrpc`                                                                                                                                                                                    |
| `.`: `useTrpcClient` (tuple return)                             | `./react`: `useTrpcClient()` returns the client directly; new `useRpcEvents()` returns the event channel                                                                                                                                                                                    |
| `.`: `UseTrpcClientOptions`                                     | RETIRED                                                                                                                                                                                                                                                                                     |
| `.`: `useConfiguration`, `WebviewContext`, `WithWebviewContext` | `./react`: same names                                                                                                                                                                                                                                                                       |

New primitives that had no old equivalent:

- `./host`: `WithTelemetry<T, TTelemetry>` — a generic helper that re-types the
  `telemetry` slot on a context to a richer telemetry type (consumers alias it,
  e.g. `WithTelemetry<T, ITelemetryContext>`).
- `./host`: `getInvocationSignal(ctx)` — reads the per-operation `AbortSignal`
  off a router context (used to leave aborted calls classified as `Canceled`).
- `./host`: `attachTrpc(panel, context, router, callerFactory?, logger?)` returns
  `{ disposable, activeOperations, activeSubscriptions }` (bring-your-own-panel).
- `./host`: `consoleProcedureLogger`, `ProcedureLogger`, `TelemetryRunner`,
  `ProcedureTelemetry`, `ProcedureInvocation`, `MiddlewareResultLike`.
- `./webview`: `connectTrpc(vscodeApi, options?)` returns `{ client, events }`.
- `.`: `TypedEventSink`, `DiscriminatedEvent`, `EventOfType`, `StopOperation`.

---

## 3. Telemetry model migration

The old `createMiddleware` produced a telemetry middleware that wrapped
`callWithTelemetryAndErrorHandling` itself and, as a side effect of tRPC's
inference, statically widened `ctx.telemetry` to non-optional inside procedures.

The new model inverts this: the package ships only the middleware body
(`telemetryMiddlewareBody`) and a runner contract (`TelemetryRunner`); the
consumer supplies the adapter that wraps `callWithTelemetryAndErrorHandling`, so
the event-name semantics stay entirely in consumer hands.

DocumentDB's adapter lives in `src/webviews/_integration/trpc.ts`. `WithTelemetry`
is the package's generic helper aliased to `ITelemetryContext`, and the runner
adds DocumentDB-specific error enrichment on top of the body's generic timing /
`Canceled` / `Failed` recording:

```typescript
import { initWebviewTrpc, type BaseRouterContext } from '@microsoft/vscode-ext-webview';
import {
  getInvocationSignal,
  telemetryMiddlewareBody,
  type WithTelemetry as FrameworkWithTelemetry,
  type ProcedureTelemetry,
  type TelemetryRunner,
} from '@microsoft/vscode-ext-webview/host';
import { callWithTelemetryAndErrorHandling, parseError, type ITelemetryContext } from '@microsoft/vscode-azext-utils';

const trpc = initWebviewTrpc<BaseRouterContext>();
const { publicProcedure, router, createCallerFactory } = trpc;

// The package types `ctx.telemetry` minimally; alias its generic helper to the
// richer ITelemetryContext so procedures can read suppressAll / suppressIfSuccessful.
export type WithTelemetry<T extends { telemetry?: unknown }> = FrameworkWithTelemetry<T, ITelemetryContext>;

const documentDbTelemetryRunner: TelemetryRunner = {
  async run(invocation, execute) {
    const result = await callWithTelemetryAndErrorHandling(
      `${WEBVIEW_CONFIG.telemetry.rpcEventPrefix}.${invocation.type}.${invocation.path}`,
      async (context) => {
        context.errorHandling.suppressDisplay = true;
        // ITelemetryContext is structurally wider than ProcedureTelemetry; the
        // runtime value is the real ITelemetryContext, so this round-trips.
        const result = await execute(context.telemetry as unknown as ProcedureTelemetry);

        // Leave aborted calls as the body's 'Canceled' classification; only
        // enrich real failures with parseError-derived fields (R766-C02).
        const aborted = getInvocationSignal(invocation.ctx)?.aborted ?? false;
        if (!result.ok && result.error && !aborted) {
          const parsed = parseError(result.error);
          context.telemetry.properties.error = parsed.errorType;
          context.telemetry.properties.errorMessage = parsed.message;
          context.telemetry.properties.errorStack = (result.error as { stack?: string }).stack ?? '';
          if (result.error.cause) {
            context.telemetry.properties.errorCause = parseError(result.error.cause).message;
          }
        }
        return result;
      },
    );
    if (!result) {
      throw new Error(`No result returned from tRPC call for ${invocation.type} ${invocation.path}`);
    }
    return result;
  },
};

export const publicProcedureWithTelemetry = publicProcedure.use((opts) =>
  telemetryMiddlewareBody(opts, documentDbTelemetryRunner),
);

// The tRPC instance is re-exported so panel factories can hand `trpc` to the
// controller (the caller factory rides along and cannot be mismatched, R766-N02).
export { createCallerFactory, publicProcedure, router, trpc };
```

Two consequences worth calling out:

1. `publicProcedureWithTelemetry` is now a CONSUMER export (in `trpc.ts`), not a
   package export. It is built once and re-exported through `appRouter.ts`.
2. `telemetryMiddlewareBody` returns plain `TResult`, so tRPC does NOT widen
   `ctx.telemetry` to non-optional the way the retired `createMiddleware` did.
   Procedures that read telemetry must narrow the context themselves:

```typescript
getData: publicProcedureWithTelemetry.input(z.object({ id: z.string() })).query(async ({ ctx }) => {
  const myCtx = ctx as WithTelemetry<RouterContext>;
  myCtx.telemetry.properties.somethingUseful = 'value';
  // ...
});
```

This `myCtx` narrowing is the single most common edit when porting routers.

---

## 4. Hook split (before / after)

The old hook returned a tuple-like object and bundled an optional error observer.
The new split is two single-purpose hooks.

Before:

```tsx
import { useTrpcClient } from '../_integration/useTrpcClient';
import { useConfiguration } from '@microsoft/vscode-ext-react-webview';

const { trpcClient } = useTrpcClient();
const config = useConfiguration<MyConfig>();
```

After:

```tsx
import { useTrpcClient } from '../_integration/useTrpcClient';
import { useConfiguration } from '@microsoft/vscode-ext-webview/react';

const trpcClient = useTrpcClient(); // client directly, no destructuring
const config = useConfiguration<MyConfig>();

// Only if you need the success / error / aborted stream:
import { useRpcEvents } from '@microsoft/vscode-ext-webview/react';
const events = useRpcEvents();
```

DocumentDB kept a thin `src/webviews/_integration/useTrpcClient.ts` wrapper that
pins the generic to `AppRouter`:

```typescript
import { useTrpcClient as useFrameworkTrpcClient, type TrpcClient } from '@microsoft/vscode-ext-webview/react';
import { type AppRouter } from './appRouter';

export function useTrpcClient(): TrpcClient<AppRouter> {
  return useFrameworkTrpcClient<AppRouter>();
}
```

---

## 5. Two migration paths for a panel-owning consumer

Both paths assume the consumer has a tRPC root router (`appRouter`), its `trpc`
instance (from `initWebviewTrpc<...>()`), a `BaseRouterContext`-derived context
type, and a bundle / dev-server layout (`sourceLayout`, `devServerHost`,
`isBundled`).

### Path A (class): extend the new `WebviewController`

Lowest churn. Keeps stateful or method-rich controllers as classes. This is the
options-bag constructor; everything the framework needs is one object.

Before (old package):

```typescript
import { WebviewController } from '@microsoft/vscode-ext-react-webview/server';

export class MyViewController extends WebviewController {
  constructor(initialData: MyConfig) {
    super(ext.context, title, 'myView', initialData);
    this.setupTrpc({ dbExperience: API.DocumentDB, webviewName: 'myView' /* ... */ });
  }
}
```

After (new package, options-bag):

```typescript
import { WebviewController } from '@microsoft/vscode-ext-webview/host';
import { appRouter, type AppRouter, type BaseRouterContext } from '../../_integration/appRouter';
import { trpc } from '../../_integration/trpc';
import { WEBVIEW_CONFIG } from '../../_integration/configuration';
import { ext } from '../../../extensionVariables';

export class MyViewController extends WebviewController<AppRouter, MyConfig, BaseRouterContext> {
  constructor(initialData: MyConfig) {
    const context: BaseRouterContext = { dbExperience: API.DocumentDB, webviewName: 'myView' /* ... */ };
    super({
      extensionContext: ext.context,
      title,
      viewType: 'myView',
      router: appRouter,
      trpc, // the caller factory is read off the instance, so it can never be mismatched
      context,
      config: initialData,
      sourceLayout: WEBVIEW_CONFIG.bundle,
      devServerHost: WEBVIEW_CONFIG.devServerHost,
      isBundled: !!ext.isBundle, // required: selects the bundle vs tsc layout
      icon,
    });
  }
}
```

DocumentDB used a shared `WebviewControllerBase` to capture this options-bag
`super(...)` call once (WI-E1), then removed it when every panel moved to Path B.

### Path B (factory): `openWebview` via a consumer preset

Best for construction-only panels (a single constructor, no instance state, and
call sites that only touch the returned handle). First wrap `openWebview` in a
small consumer preset so each panel factory stays short:

```typescript
// src/webviews/_integration/openAppWebview.ts
import { openWebview, type WebviewController } from '@microsoft/vscode-ext-webview/host';

export type AppWebviewController<TConfiguration> = WebviewController<AppRouter, TConfiguration, BaseRouterContext>;

export function openAppWebview<TConfiguration>(options: {
  title: string;
  webviewName: WebviewName;
  config: TConfiguration;
  context: BaseRouterContext;
  viewColumn?: vscode.ViewColumn;
  icon?: vscode.Uri | { light: vscode.Uri; dark: vscode.Uri };
}): AppWebviewController<TConfiguration> {
  return openWebview<AppRouter, TConfiguration, BaseRouterContext>(ext.context, {
    title: options.title,
    viewType: options.webviewName,
    router: appRouter,
    trpc,
    context: options.context,
    config: options.config,
    sourceLayout: WEBVIEW_CONFIG.bundle,
    devServerHost: WEBVIEW_CONFIG.devServerHost,
    isBundled: !!ext.isBundle,
    logger: rpcConcurrencyLogger, // optional dispatch-level logger
    icon: options.icon,
    viewColumn: options.viewColumn,
  });
}
```

Then each panel becomes a factory function:

```typescript
export function openMyViewPanel(initialData: MyConfig): AppWebviewController<MyConfig> {
  const context: BaseRouterContext = { dbExperience: API.DocumentDB, webviewName: 'myView' /* ... */ };
  return openAppWebview({ title, webviewName: 'myView', config: initialData, context });
}
```

Call-site change (the returned handle preserves the lifecycle methods):

```typescript
// before
const view = new MyViewController(initialData);
view.onDisposed(() => cleanup());
view.revealToForeground();

// after
const view = openMyViewPanel(initialData);
view.onDisposed(() => cleanup());
view.revealToForeground();
```

The handle exposes `panel`, `onDisposed`, `revealToForeground`, `isDisposed`,
and `dispose`. If the router context needs the panel before the handle exists
(for example a title setter), assign through a small holder so the closure reads
it at call time:

```typescript
const handle: { controller?: AppWebviewController<MyConfig> } = {};
const context: BaseRouterContext = {
  /* ... */
  viewPanelTitleSetter: (title) => {
    if (handle.controller) {
      handle.controller.panel.title = title;
    }
  },
};
handle.controller = openAppWebview({ title, webviewName: 'myView', config: initialData, context });
return handle.controller;
```

### Choosing and sequencing A vs B

- Construction-only panel (no instance state, no externally-called methods beyond
  the handle): go to Path B.
- Stateful or method-rich controller (other code calls its methods, or it holds
  instance fields): stay on Path A. This is a supported end state, not a
  shortcoming.
- A and B can be SEQUENCED: land Path A first for a safe, minimal diff that just
  points at the new package, then convert construction-only controllers to Path B
  in a follow-up (this is what the DocumentDB migration did across WI-E1 and
  WI-E4). Or do both in one step if the panel is obviously construction-only.

---

## 6. Embedders: bring-your-own-panel with `attachTrpc`

Consumers that already own a `vscode.WebviewPanel` (for example vscode-cosmosdb,
which forked the transport before this package existed) do not need
`WebviewController` or `openWebview` at all. Wire tRPC onto the existing panel
with `attachTrpc` from `./host`:

```typescript
import { attachTrpc } from '@microsoft/vscode-ext-webview/host';

const { disposable, activeOperations, activeSubscriptions } = attachTrpc(
  panel, // an existing vscode.WebviewPanel you own
  context, // your BaseRouterContext-derived context
  appRouter, // your tRPC root router
  createCallerFactory, // optional; defaults to the package's caller factory
  consoleProcedureLogger, // optional dispatch-level logger
);

context.subscriptions.push(disposable);
```

`attachTrpc` returns the disposable to register with the panel lifecycle plus the
live maps of in-flight operations and subscriptions (useful for diagnostics or
custom cancellation). The webview side connects with `connectTrpc(vscodeApi)`
from `./webview`, which returns `{ client, events }` with no React dependency.

When navigating the package itself, each folder under
`packages/vscode-ext-webview/src/` (`shared`, `host`, `host/middleware`,
`webview`, `react`) carries a short README describing its side, import path, and
contents. Start there for an at-a-glance map.

---

## 7. Quick checklist for porting one consumer

1. Swap the dependency name in `package.json` and update imports to the four new
   subpaths (`.`, `./host`, `./webview`, `./react`).
2. Replace `createMiddleware` with a `TelemetryRunner` adapter and a
   `publicProcedure.use((opts) => telemetryMiddlewareBody(opts, runner))` export.
3. Narrow telemetry reads in procedures with a `WithTelemetry<...>` cast.
4. Change `const { trpcClient } = useTrpcClient()` to `const trpcClient = useTrpcClient()`.
5. Pick Path A or Path B per panel (construction-only goes to B). Wire the options
   bag with `trpc` (not the deprecated `createCallerFactory`) and pass the required
   `isBundled` flag.
6. Run the full gate: lint, tests, build, and a manual webview smoke (open each
   view and round-trip one tRPC call).
