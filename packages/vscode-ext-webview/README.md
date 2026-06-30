# @microsoft/vscode-ext-webview (Preview)

> **Preview release.** This package is published in preview while the API
> surface stabilises. Breaking changes may land between minor versions until
> a `1.0.0` release.

Webview infrastructure for VS Code extensions: type-safe tRPC RPC over
`postMessage`, a one-call front door that opens a panel and wires the
transport, React hooks for the webview side, and pluggable telemetry.

The package was extracted from the webview stack powering the
[DocumentDB for VS Code](https://github.com/microsoft/vscode-documentdb) and
[Azure Cosmos DB for VS Code](https://github.com/microsoft/vscode-cosmosdb)
extensions, then refined against the public
[vscode-webview-starter-kit](https://github.com/tnaum-ms/vscode-webview-starter-kit)
reference repository.

---

## Architecture

The extension host owns a `vscode.WebviewPanel`; the webview runs your React
app inside it and talks to the host through tRPC over `window.postMessage`.
There is no HTTP, no WebSocket, and no string-typed protocol to maintain by
hand. tRPC types flow from the router definition straight to the React
component that calls into it.

```
Extension Host (Node.js)               Webview (Browser)
+----------------------------+         +----------------------------+
|  openWebview / Controller  |         |  React tree                |
|   |- router (tRPC)         | <-----> |   |- WithWebviewContext    |
|   |- attachTrpc dispatch   |  post   |   |- useTrpcClient         |
|   |- telemetry logger      |  Msg    |   |- useConfiguration      |
|   '- AbortSignal in ctx    |         |   '- vscodeLink transport  |
+----------------------------+         +----------------------------+
     import from ./host                import from ./react | ./webview
```

The same `AppRouter` type is shared by both sides: define the router once on
the extension host, then call it from the webview with full type inference,
auto-completion, and refactor-safety.

## Quick start

The shortest path to a working webview is four files: define a router, open
the panel with `openWebview`, render the React tree with `WithWebviewContext`,
and call procedures with `useTrpcClient`.

> For a complete extension layout with build configuration, accessibility
> helpers, Monaco wiring, and tested-end-to-end command registration, copy the
> [vscode-webview-starter-kit](https://github.com/tnaum-ms/vscode-webview-starter-kit)
> instead of starting from these snippets. The starter kit is the canonical
> consumer reference; this section is for understanding the moving parts.

**1. Install**

```bash
npm install @microsoft/vscode-ext-webview
```

The package declares `react`, `@trpc/client`, and `@trpc/server` as peer
dependencies. Bring whatever versions you use yourself; the package will not
pull duplicates into your webview bundle. `react-dom` is not a peer of this
package; it is a transitive concern of any React DOM app shell.

**2. Define the router (extension host)**

```ts
// src/webviews/_integration/appRouter.ts
import { initWebviewTrpc, type BaseRouterContext } from '@microsoft/vscode-ext-webview';
import { z } from 'zod';

export type RouterContext = BaseRouterContext & {
  // application-specific fields, e.g.:
  workspaceRoot: string;
};

const { router, publicProcedure, createCallerFactory } = initWebviewTrpc<RouterContext>();

export const appRouter = router({
  hello: publicProcedure
    .input(z.object({ name: z.string() }))
    .query(({ input }) => ({ greeting: `Hello, ${input.name}!` })),
});

export type AppRouter = typeof appRouter;
export { createCallerFactory };
```

`initWebviewTrpc<TContext>()` returns the tRPC builders bound to your context
type: `router`, `publicProcedure` (whose `ctx` is typed as `TContext`),
`createCallerFactory` (used by the host dispatcher), and `middleware`. Re-export
`createCallerFactory` so the host can hand it to the factory below.

**3. Open the panel (extension host)**

```ts
// src/extension.ts
import * as vscode from 'vscode';
import { openWebview } from '@microsoft/vscode-ext-webview/host';
import { appRouter, createCallerFactory, type AppRouter, type RouterContext } from './webviews/_integration/appRouter';

type MyViewConfig = { initialMessage: string };

export function activate(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('myExtension.openMyView', () => {
      openWebview<AppRouter, MyViewConfig, RouterContext>(ctx, {
        title: 'My View',
        viewType: 'myView', // matches the React component registration
        router: appRouter,
        createCallerFactory,
        context: { workspaceRoot: vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? '' },
        config: { initialMessage: 'ready' } satisfies MyViewConfig,
        sourceLayout: {
          bundled: { dir: '', file: 'views.js' },
          dev: { dir: 'out/src/webviews', file: 'index.js' },
        },
        devServerHost: 'http://localhost:18080',
      });
    }),
  );
}
```

`openWebview` returns a `WebviewController` handle exposing `panel`,
`onDisposed`, `revealToForeground`, `dispose`, and `isDisposed`. It opens the
panel, renders the HTML, and wires the tRPC dispatch pump. Procedure activity
is logged to the console out of the box; pass a `telemetry` option to route the
entries elsewhere.

**4. Render the view (webview / browser)**

The webview entry point exports a `render(viewType, vscodeApi)` function that
the framework's HTML scaffold calls when the panel loads. The `viewType`
argument is the key you passed to `openWebview` (here, `'myView'`); use it to
look up the matching React component.

```tsx
// src/webviews/index.tsx
import { createRoot } from 'react-dom/client';
import { WithWebviewContext, type WebviewState } from '@microsoft/vscode-ext-webview/react';
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
import { useConfiguration, useTrpcClient } from '@microsoft/vscode-ext-webview/react';
import type { AppRouter } from '../_integration/appRouter';

type MyViewConfig = { initialMessage: string };

export const MyView = () => {
  const config = useConfiguration<MyViewConfig>();
  const trpcClient = useTrpcClient<AppRouter>();
  const [greeting, setGreeting] = useState(config.initialMessage);

  useEffect(() => {
    void trpcClient.hello.query({ name: 'world' }).then((r) => setGreeting(r.greeting));
  }, [trpcClient]);

  return <h1>{greeting}</h1>;
};
```

That is the complete data path: the React component calls
`trpcClient.hello.query(...)`, the call travels through `vscodeLink` as a
`postMessage`, the host dispatches it to `appRouter.hello`, the result is
`postMessage`d back, and the call promise resolves with full type inference for
`r.greeting`.

`useTrpcClient<AppRouter>()` returns the client directly. The client (and the
event channel from `useRpcEvents()`) is shared per webview: every component
that calls the hook receives the same instance and the same single `message`
listener, so there is no provider tree to wire up.

## Behind the scenes (advanced, optional)

The factory is the front door, but every layer underneath it is a public,
documented primitive. Reach for these when you outgrow the one-call path. Each
is covered in depth in [ADVANCED.md](./ADVANCED.md).

- **Bring your own panel.** `attachTrpc(panel, ctx, router, callerFactory?, logger?)`
  wires the tRPC dispatch pump onto a `vscode.WebviewPanel` you already own,
  without `WebviewController`.
- **Framework-agnostic webview client.** `connectTrpc(vscodeApi, options?)` from
  `./webview` builds a typed client plus an event channel with no React
  dependency, so you can bind another UI framework on top of the transport.
- **Webview-side error and event observer.** `createEventChannel()` and the
  `errorLink` tRPC link surface success, error, and aborted events to a single
  place (an announcer, a toaster, telemetry).
- **Pluggable telemetry.** `telemetryMiddlewareBody` plus a `TelemetryRunner`
  routes per-call telemetry into your own analytics (for example Application
  Insights); `loggingMiddlewareBody` and `ProcedureLogger` cover console-style
  logging.
- **Push events from host to webview.** `TypedEventSink<T>` bridges push-style
  producers (VS Code event emitters, driver callbacks) into tRPC subscriptions.
- **The type-only router import rule.** Webview code imports only
  `import type { AppRouter }`, keeping extension-host code out of the browser
  bundle.

See [ADVANCED.md](./ADVANCED.md) for the full manual, including a single shared
client, worked telemetry adapters, the event channel, push events, and the
host/browser import boundary.

## Entry points

The package has four entry points so bundlers do not drag Node / VS Code APIs
into the webview bundle, and so a non-React consumer never pulls React in.

| Subpath     | Side                             | Imports                | Key exports                                                                                                                    |
| ----------- | -------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `.`         | shared (side-agnostic)           | no `vscode`, no React  | `initWebviewTrpc`, `BaseRouterContext`, `TypedEventSink`, wire-protocol message types                                          |
| `./host`    | extension host (Node.js)         | `fs`, `path`, `vscode` | `openWebview`, `WebviewController`, `attachTrpc`, `telemetryMiddlewareBody`, `loggingMiddlewareBody`, `consoleProcedureLogger` |
| `./webview` | webview (browser), any framework | no React               | `connectTrpc`, `createEventChannel`, `vscodeLink`, `errorLink`                                                                 |
| `./react`   | webview (browser), React         | React                  | `useTrpcClient`, `useRpcEvents`, `useConfiguration`, `WithWebviewContext`                                                      |

```ts
// Shared. Safe to import from either side.
import { initWebviewTrpc, TypedEventSink, type BaseRouterContext } from '@microsoft/vscode-ext-webview';

// Extension host side. Uses fs, path, vscode.
import { openWebview, WebviewController, attachTrpc } from '@microsoft/vscode-ext-webview/host';

// Webview, framework-agnostic. No React.
import { connectTrpc, createEventChannel, vscodeLink } from '@microsoft/vscode-ext-webview/webview';

// Webview, React hooks.
import { useTrpcClient, useConfiguration, WithWebviewContext } from '@microsoft/vscode-ext-webview/react';
```

## What's inside

- **`openWebview` / `WebviewController`**: open a `vscode.WebviewPanel`,
  dispatch incoming tRPC operations (queries, mutations, subscriptions), and
  handle abort / subscription cancellation lifecycle. The factory is sugar over
  the controller's options-bag constructor.
- **`attachTrpc`**: the dispatch primitive the controller is built on; wire tRPC
  onto a panel you already own.
- **`initWebviewTrpc`**: the typed tRPC initialiser. Returns `router`,
  `publicProcedure`, `createCallerFactory`, and `middleware` bound to your
  context type.
- **`connectTrpc` / `createEventChannel`**: the framework-agnostic webview
  client and its observable event channel.
- **`vscodeLink`**: a custom tRPC link that bridges tRPC over
  `window.postMessage`, type-safe end to end.
- **`errorLink`**: an optional tRPC link that forwards query / mutation errors
  to a consumer-supplied handler (announce, toast, telemetry) without preventing
  the normal error flow.
- **`TypedEventSink<T>`**: a small typed async-iterable that bridges push-style
  domain events into tRPC subscriptions.
- **React hooks**: `useTrpcClient`, `useRpcEvents`, `useConfiguration`, and the
  `WithWebviewContext` provider.
- **Pluggable telemetry**: `telemetryMiddlewareBody` + `TelemetryRunner` and
  `loggingMiddlewareBody` + `ProcedureLogger`, with `consoleProcedureLogger` as
  the zero-config default.

## Peer dependencies

| Package          | Required version                       |
| ---------------- | -------------------------------------- |
| `react`          | `>=18.0.0` (only for `./react`)        |
| `@trpc/client`   | `^11.0.0`                              |
| `@trpc/server`   | `^11.0.0`                              |
| `vscode-webview` | `^1.0.0` (optional, webview-side only) |

## Scope

This package ships only the webview transport (tRPC over `postMessage`), the
panel facade, and the minimum React glue to consume it. UI components, UX policy
(context-menu handling, focus management, and so on), accessibility helpers,
editor-specific behaviours, and other consumer concerns are out of scope by
design. Keep them in your application repository or pick dedicated libraries for
them.

## Starter kit and reference consumers

The recommended way to start a new consumer is to copy the
[vscode-webview-starter-kit](https://github.com/tnaum-ms/vscode-webview-starter-kit)
and adapt it. The starter kit covers things the package intentionally does not
own: webpack / Vite build configuration for both the extension and the views
bundle; accessibility helpers (an ARIA announcer, a selective context-menu
prevention hook); a Monaco editor integration recipe; and a worked demo view
exercising the tRPC client end to end.

A consumer-side integration layer (router + telemetry runner + configuration
knobs) typically lives in a folder like `src/webviews/_integration/`. The
underscore prefix sorts the folder above feature folders in the file explorer,
the conventional "infrastructure / not feature code" signal. The
[vscode-documentdb](https://github.com/microsoft/vscode-documentdb) and
[Azure Cosmos DB for VS Code](https://github.com/microsoft/vscode-cosmosdb)
extensions are working examples of that layout against this package.

## Status

`0.9.0-preview`. APIs are subject to change while the package is in preview. See
[ADVANCED.md](./ADVANCED.md) for the full set of primitives and patterns.

## License

MIT. See [LICENSE.md](../../LICENSE.md) at the repository root.
