# @microsoft/vscode-ext-react-webview (Preview)

> ⚠️ **Preview release.** This package is published in preview while the API
> surface stabilises. Breaking changes may land between minor versions until
> a `1.0.0` release.

Webview infrastructure for VS Code extensions with type-safe tRPC RPC over
`postMessage`, React hooks for the webview side, and a pluggable telemetry
middleware.

The package was extracted from the webview stack powering the
[DocumentDB for VS Code](https://github.com/microsoft/vscode-documentdb) and
[Azure Cosmos DB for VS Code](https://github.com/microsoft/vscode-cosmosdb)
extensions, then refined against the public
[vscode-webview-starter-kit](https://github.com/tnaum-ms/vscode-webview-starter-kit)
reference repository.

---

## Architecture

`WebviewController` lives on the extension-host side and owns a
`vscode.WebviewPanel`. The webview side runs the React app inside the panel
and talks to the host through tRPC over `window.postMessage`. There is no
HTTP, no WebSocket, and no string-typed protocol to maintain by hand. tRPC
types flow from the router definition to the React component that calls
into it.

```
Extension Host (Node.js)              Webview (Browser)
┌────────────────────────────┐        ┌────────────────────────────┐
│  WebviewController         │        │  React tree                │
│  ├─ router (tRPC)          │◄──────►│  ├─ WithWebviewContext     │
│  ├─ procedures             │ post   │  ├─ useTrpcClient          │
│  ├─ createMiddleware       │ Msg    │  ├─ useConfiguration       │
│  └─ AbortSignal in ctx     │        │  └─ vscodeLink (transport) │
└────────────────────────────┘        └────────────────────────────┘
        imported from /server         imported from main entry
```

The same `AppRouter` type is shared by both sides: define the router once
on the extension host, then call it from the webview with full type
inference, auto-completion, and refactor-safety.

## Quick start

The shortest path to a working webview is four files. The example below
defines one procedure and renders a button in the webview that calls it.

> For a complete extension layout with build configuration, accessibility
> helpers, Monaco wiring, and tested-end-to-end command registration, copy
> the [vscode-webview-starter-kit](https://github.com/tnaum-ms/vscode-webview-starter-kit)
> instead of starting from these snippets. The starter kit is the canonical
> consumer reference; this section is for understanding the moving parts.

**1. Install**

```bash
npm install @microsoft/vscode-ext-react-webview
```

The package declares `react`, `@trpc/client`, and `@trpc/server` as peer
dependencies. Bring whatever versions you use yourself; the package will
not pull duplicates into your webview bundle. `react-dom` is *not* a peer
of this package — it is a transitive concern of any React DOM app shell.

**2. Define the router (extension host)**

```ts
// src/webviews/_integration/appRouter.ts
import { publicProcedure, router, type BaseRouterContext } from '@microsoft/vscode-ext-react-webview/server';
import { z } from 'zod';

export type RouterContext = BaseRouterContext & {
  // application-specific fields, e.g.:
  workspaceRoot: string;
};

export const appRouter = router({
  hello: publicProcedure
    .input(z.object({ name: z.string() }))
    .query(({ input }) => ({ greeting: `Hello, ${input.name}!` })),
});

export type AppRouter = typeof appRouter;
```

**3. Create a controller (extension host)**

```ts
// src/webviews/_integration/MyViewController.ts
import * as vscode from 'vscode';
import { WebviewController } from '@microsoft/vscode-ext-react-webview/server';
import { appRouter, type AppRouter, type RouterContext } from './appRouter';

export class MyViewController extends WebviewController<AppRouter, MyViewConfig, RouterContext> {
  constructor(extensionContext: vscode.ExtensionContext, title: string) {
    super(
      extensionContext,
      title,
      'myView', // viewType key; matches the React component registration
      { initialMessage: 'ready' } satisfies MyViewConfig,
      {
        appRouter,
        isBundled: extensionContext.extensionMode === vscode.ExtensionMode.Production,
        sourceLayout: {
          bundled: { dir: '', file: 'views.js' },
          dev: { dir: 'out/src/webviews', file: 'index.js' },
        },
        devServerHost: 'http://localhost:18080',
      },
    );

    this.setupTrpc({
      workspaceRoot: vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? '',
    } satisfies RouterContext);
  }
}

type MyViewConfig = { initialMessage: string };
```

Open the panel from a command:

```ts
// src/extension.ts
import * as vscode from 'vscode';
import { MyViewController } from './webviews/_integration/MyViewController';

export function activate(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('myExtension.openMyView', () => {
      new MyViewController(ctx, 'My View');
    }),
  );
}
```

**4. Render the view (webview / browser)**

The webview entry point exports a `render(viewType, vscodeApi)` function
that the framework's HTML scaffold calls when the panel loads. The
`viewType` argument is the key you passed to `WebviewController` (here,
`'myView'`); use it to look up the matching React component.

```tsx
// src/webviews/index.tsx
import { createRoot } from 'react-dom/client';
import { WithWebviewContext, type WebviewState } from '@microsoft/vscode-ext-react-webview';
import type { WebviewApi } from 'vscode-webview';
import { MyView } from './myView/MyView';

const registry = {
  myView: MyView,
} as const;

export function render(viewType: keyof typeof registry, vscodeApi: WebviewApi<WebviewState>) {
  const Component = registry[viewType];
  createRoot(document.getElementById('root')!).render(
    <WithWebviewContext vscodeApi={vscodeApi}>
      <Component />
    </WithWebviewContext>,
  );
}
```

```tsx
// src/webviews/myView/MyView.tsx
import { useEffect, useState } from 'react';
import { useTrpcClient, useConfiguration } from '@microsoft/vscode-ext-react-webview';
import type { AppRouter } from '../_integration/appRouter';

type MyViewConfig = { initialMessage: string };

export const MyView = () => {
  const config = useConfiguration<MyViewConfig>();
  const { trpcClient } = useTrpcClient<AppRouter>();
  const [greeting, setGreeting] = useState(config.initialMessage);

  useEffect(() => {
    void trpcClient.hello.query({ name: 'world' }).then((r) => setGreeting(r.greeting));
  }, [trpcClient]);

  return <h1>{greeting}</h1>;
};
```

That is the complete data path: the React component calls
`trpcClient.hello.query(...)`, the call travels through `vscodeLink` as a
`postMessage`, the host-side `WebviewController` dispatches it to
`appRouter.hello`, the result is `postMessage`d back, and the call promise
resolves with full type inference for `r.greeting`.

## Starter kit and reference consumers

The recommended way to start a new consumer is to copy the
[vscode-webview-starter-kit](https://github.com/tnaum-ms/vscode-webview-starter-kit)
and adapt it. The starter kit covers things the package intentionally
does not own:

- webpack / Vite build configuration for both the extension and the
  views bundle;
- accessibility helpers (an ARIA `Announcer`, a selective context-menu
  prevention hook);
- a Monaco editor integration recipe;
- a worked demo view exercising the tRPC client end to end.

A consumer-side integration layer (router + controller base + telemetry
sink + configuration knobs) typically lives in a folder like
`src/webviews/_integration/`. The underscore prefix sorts the folder
above feature folders in the file explorer, which is the conventional
"infrastructure / not feature code" signal. The
[vscode-documentdb](https://github.com/microsoft/vscode-documentdb) and
[Azure Cosmos DB for VS Code](https://github.com/microsoft/vscode-cosmosdb)
extensions are working examples of that layout against this package.

> **Note about freshness.** The package is `0.8.0-preview` and the
> starter kit may lag a release while the surface stabilises. When the
> kit is not yet on the latest preview, fall back to the README and the
> in-tree consumer in vscode-documentdb for the current shape.

## What's inside

- **`WebviewController`**: manages a `vscode.WebviewPanel`, dispatches
  incoming tRPC operations (queries, mutations, subscriptions), and handles
  abort / subscription cancellation lifecycle.
- **`TypedEventSink<T>`**: a small typed async-iterable used to bridge
  push-style domain events (event emitters, callbacks) into tRPC
  subscriptions. See [Advanced · Push events from the extension host to
  the webview](#push-events-from-the-extension-host-to-the-webview).
- **`vscodeLink`**: a custom tRPC link that bridges tRPC over
  `window.postMessage`. Type-safe end-to-end from the extension host to the
  React webview.
- **`errorLink`**: optional tRPC link that forwards query/mutation errors
  to a consumer-supplied handler (announce, toast, telemetry) without
  preventing the normal error flow. See [Advanced · Webview-side error
  observer](#webview-side-error-observer).
- **React hooks**: `useTrpcClient`, `useConfiguration`.
- **Webview context**: `WebviewContext`, `WithWebviewContext` for wiring up
  the React tree.
- **Pluggable telemetry middleware**: generic `TelemetryContext`, a
  `createMiddleware` factory, and a default `console.log` sink. Plug in
  your own instrumentation (e.g. Application Insights) by writing a custom
  middleware.

## Entry points

The package has two separate entry points so bundlers do not drag Node /
VS Code APIs into the webview bundle.

```ts
// Webview (browser) side. No Node / vscode imports.
import { useTrpcClient, useConfiguration, WithWebviewContext } from '@microsoft/vscode-ext-react-webview';

// Extension host side. Uses fs, path, vscode.
import {
  WebviewController,
  router,
  publicProcedure,
  createMiddleware,
  TypedEventSink,
  type BaseRouterContext,
} from '@microsoft/vscode-ext-react-webview/server';
```

## Peer dependencies

| Package          | Required version                       |
| ---------------- | -------------------------------------- |
| `react`          | `>=18.0.0`                             |
| `@trpc/client`   | `^11.0.0`                              |
| `@trpc/server`   | `^11.0.0`                              |
| `vscode-webview` | `^1.0.0` (optional, webview-side only) |

## Scope

This package ships **only the webview transport** (tRPC over `postMessage`)
and the minimum React glue to consume it. UI components, UX policy
(context-menu handling, focus management, etc.), accessibility helpers,
editor-specific behaviours, and other consumer concerns are out of scope
by design. Keep them in your application repository or pick dedicated
libraries for them.

## Advanced

### Sharing a single tRPC client across components

By default, every component that calls `useTrpcClient()` receives its own
client instance. The instance is stable across re-renders (via `useMemo`),
but separate components hold separate clients.

This is intentional. Each component is self-contained: a developer can open
any file, see the `useTrpcClient()` call, follow the symbol, and understand
the entire transport pipeline without tracing through a provider hierarchy.
For views with a handful of components this is the recommended approach.

If your view grows past ~10 components that each create their own client,
prefer sharing a single instance through a React context:

```tsx
// TrpcContext.tsx
import { createTRPCClient, loggerLink, type CreateTRPCClient } from '@trpc/client';
import { createContext, useContext, useMemo } from 'react';
import {
  vscodeLink,
  WebviewContext,
  type VsCodeLinkRequestMessage,
  type VsCodeLinkResponseMessage,
} from '@microsoft/vscode-ext-react-webview';
import type { AppRouter } from '../_integration/appRouter';

const TrpcContext = createContext<CreateTRPCClient<AppRouter>>({} as CreateTRPCClient<AppRouter>);

export const TrpcProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { vscodeApi } = useContext(WebviewContext);

  const trpcClient = useMemo(() => {
    const send = (m: VsCodeLinkRequestMessage) => vscodeApi.postMessage(m);
    const onReceive = (cb: (m: VsCodeLinkResponseMessage) => void) => {
      const handler = (e: MessageEvent) => {
        if ((e.data as VsCodeLinkResponseMessage).id) cb(e.data as VsCodeLinkResponseMessage);
      };
      window.addEventListener('message', handler);
      return () => window.removeEventListener('message', handler);
    };
    return createTRPCClient<AppRouter>({
      links: [loggerLink(), vscodeLink<AppRouter>({ send, onReceive })],
    });
  }, [vscodeApi]);

  return <TrpcContext.Provider value={trpcClient}>{children}</TrpcContext.Provider>;
};

export const useSharedTrpcClient = () => useContext(TrpcContext);
```

Then wrap your view tree:

```tsx
<WithWebviewContext vscodeApi={vscodeApi}>
  <TrpcProvider>
    <Component />
  </TrpcProvider>
</WithWebviewContext>
```

| Pros                                          | Cons                                               |
| --------------------------------------------- | -------------------------------------------------- |
| One client instance, one `message` listener   | Requires a provider wrapping the component tree    |
| Central place to configure or swap the client | Extra indirection: trace through the provider tree |
| Scales past a dozen components                | Provider-ordering mistakes can be hard to debug    |

For most views the per-component default is simpler and sufficient.

### Webview-side error observer

By default a query or mutation that throws on the extension host side
propagates to the call-site `.catch(...)` (or `try/catch` around `await`).
That works, but it forces every call site to remember to handle the
error.

When there is a single place that should always see webview-side errors
(an ARIA `Announcer`, a `Toaster`, telemetry), pass an `onError` callback
to `useTrpcClient`. The hook installs an `errorLink` for you:

```tsx
const { trpcClient } = useTrpcClient<AppRouter>({
  onError: (err) => announcer.announceError(err.message),
});
```

Semantics:

- The callback fires for query and mutation errors, **in addition to** the
  normal tRPC error flow. Your call-site `.catch(...)` handlers still run
  and still receive the error. The link observes, it does not swallow.
- Subscription errors are intentionally **not** forwarded to the callback.
  Subscriptions have their own per-call `.subscribe({ onError })` hook
  that gives the call site enough control; forwarding here would surface
  the error twice.
- The callback is captured into the tRPC client at memo time. Pass a
  stable reference (e.g. `useCallback`) or accept that changing the
  callback identity will rebuild the client on the next render.

If you need finer control over the link order (e.g. composing with a
third-party logging link), import `errorLink` directly and skip the
option:

```ts
import { createTRPCClient, loggerLink } from '@trpc/client';
import { errorLink, vscodeLink } from '@microsoft/vscode-ext-react-webview';

const trpcClient = createTRPCClient<AppRouter>({
  links: [
    loggerLink(),
    errorLink<AppRouter>((err) => announcer.announceError(err.message)),
    vscodeLink<AppRouter>({ send, onReceive }),
  ],
});
```

### Push events from the extension host to the webview

tRPC subscriptions are modeled as `async function*` generators. That shape
fits **pull**-style producers (cursors, polling loops). For **push**-style
producers (VS Code event emitters, driver callbacks, completion notifiers)
you need a small adapter: something the producer can call imperatively, and
that the subscription procedure can iterate.

`TypedEventSink<T>` is that adapter. It implements `AsyncIterable<T>` over
a discriminated event union, with a write-only `emit(event)` (or
`emit(type, payload)`) on the producer side and `for await (const event of
sink)` on the consumer side. Single consumer per sink; events emitted
before a consumer attaches are buffered.

Define the event union, then the events router:

```ts
// _integration/myViewEventsRouter.ts (or co-located with the view)
import { publicProcedureWithTelemetry, router } from './appRouter';
import type { TypedEventSink } from '@microsoft/vscode-ext-react-webview/server';

export type MyViewEvent = { type: 'progress'; percent: number } | { type: 'completed'; durationMs: number };

type MyViewRouterContext = BaseRouterContext & {
  eventSink: TypedEventSink<MyViewEvent>;
};

export const myViewEventsRouter = router({
  events: publicProcedureWithTelemetry.subscription(async function* ({ ctx }) {
    const sink = (ctx as MyViewRouterContext).eventSink;
    for await (const event of sink) {
      if (ctx.signal?.aborted) return;
      yield event;
    }
  }),
});
```

Emit events from anywhere in extension-host code that holds the sink:

```ts
sink.emit({ type: 'progress', percent: 25 });
sink.emit('completed', { durationMs: 1500 });
```

Consume them in the webview with the standard tRPC subscription API:

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
`<view>EventsRouter.ts` and merge it into the view's main router. This
keeps "things the webview calls" and "things the host pushes" in separate
files, which makes it easy to discover the entire event vocabulary of a
view at a glance.

When the panel is disposed, call `sink.close()` so the iterator completes
and the subscription releases cleanly.

### Importing the router type into webview code

The webview side of your application needs the `AppRouter` type to keep
`useTrpcClient<AppRouter>()` calls type-safe end to end. This is the only
thing webview code should import from the file that defines your router.

```tsx
// In a webview component
import type { AppRouter } from '../_integration/appRouter';
import { useTrpcClient } from '@microsoft/vscode-ext-react-webview';

const { trpcClient } = useTrpcClient<AppRouter>();
```

A few rules of thumb keep the host/browser boundary honest:

- Use `import type { AppRouter } from '...'` (or
  `import { type AppRouter }`). Type-only imports are erased at compile
  time and never produce runtime references, so the webview bundle stays
  free of extension-host code even if the router module also imports
  Node-only APIs.
- Do not import runtime values (the `appRouter` constant, procedure
  builders, middleware) from webview code. Those belong to the
  extension-host side.
- Do not reach into procedure implementation files from the webview side.
  Router types are the only contract the webview consumes.

If your bundler ever pulls server modules into the views bundle, the most
common cause is a non-type-only import of `AppRouter`. Switching it to
`import type { ... }` resolves it without changes to the router itself.

## FAQ

### Why tRPC instead of raw `postMessage`?

Raw `postMessage` requires you to define message types manually, match
request/response pairs by hand, and serialise yourself. tRPC threads
TypeScript types end-to-end. Your extension-host procedures and webview
calls share the same `AppRouter` type with zero code generation. Renaming a
field on the server shows a compile error in the webview immediately.

### Why are there two entry points (main and `/server`)?

The main entry is browser-safe and exports only the webview-client surface.
The `/server` subpath exports the extension-host surface, which imports
Node and `vscode`. Splitting them prevents bundlers from dragging
`fs` / `path` / `vscode` into the webview bundle when you import a hook
like `useTrpcClient`.

### How do I plug in my own telemetry sink (Application Insights, etc.)?

Build a middleware with `createMiddleware` from `/server`, wire it onto
`publicProcedure`, and export your own `publicProcedureWithTelemetry`. The
package's default middleware uses `console.log` so the package works
out-of-the-box; replace it for production. Example using
`@microsoft/vscode-azext-utils`:

```ts
import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { createMiddleware, publicProcedure } from '@microsoft/vscode-ext-react-webview/server';

const trpcToTelemetry = createMiddleware(async (opts) => {
  const result = await callWithTelemetryAndErrorHandling(
    `myExtension.rpc.${opts.type}.${opts.path}`,
    async (context) => {
      context.errorHandling.suppressDisplay = true;
      return opts.next({ ctx: { ...opts.ctx, telemetry: context.telemetry } });
    },
  );
  if (!result) throw new Error(`No result from tRPC call: ${opts.type} ${opts.path}`);
  return result;
});

export const publicProcedureWithTelemetry = publicProcedure.use(trpcToTelemetry);
```

### Can I have multiple webview panels open at the same time?

Yes. Each `WebviewController` instance owns its own panel and its own tRPC
caller. State is not shared between panels unless you explicitly coordinate
through the extension host (e.g. a singleton service).

### Can I cancel a long-running query or subscription?

Yes. Pass an `AbortSignal` on the client side:

```ts
const ac = new AbortController();
const result = await trpcClient.something.query(input, { signal: ac.signal });
// later
ac.abort();
```

On the server side, read `ctx.signal` inside your procedure to cooperatively
stop work. Subscriptions stop cleanly when the client unsubscribes. The
framework sends a `subscription.stop` message that aborts the underlying
async generator.

### Can I use a UI library other than React?

Not from the main entry. The webview-client hooks (`useTrpcClient`,
`useConfiguration`, `WithWebviewContext`) are React-specific. The underlying
transport (`vscodeLink`) is framework-agnostic, so you can build a binding
for another framework on top of it, but the package itself does not ship one.

## Status

`0.8.0-preview`. Version aligns with the parent
[vscode-documentdb](https://github.com/microsoft/vscode-documentdb) extension
that currently ships it. APIs are subject to change while the package is in
preview.

## License

MIT. See [LICENSE.md](../../LICENSE.md) at the repository root.
