# Migration guide

How to upgrade a consumer of `@microsoft/vscode-ext-webview` across breaking
changes. This package is pre-1.0, so minor/patch bumps may carry breaking
changes; each is listed here with a copyable before/after.

---

## `0.9.1` → `0.10.0`

This release makes the **telemetry middleware a thin delegator** and the
**`TelemetryRunner` generic**, renames the **logger hook**, and adds
**`mergeRouters`** plus an **`AnyRouter`** re-export. The transport, the React
hooks, `TypedEventSink`, `openWebview` / `WebviewController`, and the wire types
are unchanged.

Because it removes and reshapes public APIs, it ships as a **minor** bump
(`0.10.0`) rather than a patch: a patch such as `0.9.2` satisfies the common
`^0.9.1` caret range (`>=0.9.1 <0.10.0`) and would deliver these breaking
changes to consumers on a clean install without any manifest edit. Bumping the
minor moves the release outside that range so upgrades are opt-in.

### 1. Telemetry: generic `TelemetryRunner` + curried body (breaking)

The body no longer times the call, stamps `duration`, or classifies
`Canceled` / `Failed`, and it no longer injects a fixed `ctx.telemetry` slot.
Instead it resolves the event id and delegates to your runner, which now:

- receives `(eventId, invocation, invoke)` (was `(invocation, execute)`);
- is **generic over the context enrichment** it contributes — it calls
  `invoke(enrichment)` with any object, which the body merges into `ctx`;
- **owns outcome classification** from the returned result. Your telemetry
  backend usually records duration already (for example
  `callWithTelemetryAndErrorHandling` measures it), and the runner sees the tRPC
  result so it can record success / failure / cancellation.

The body is now **curried**: pass the runner (and options) once and hand the
result to `.use(...)`, instead of wrapping it in an arrow.

**Before (`0.9.1`):**

```ts
import { telemetryMiddlewareBody, type TelemetryRunner } from '@microsoft/vscode-ext-webview/host';

const runner: TelemetryRunner = {
  async run(invocation, execute) {
    const result = await callWithTelemetryAndErrorHandling(
      `myExt.rpc.${invocation.type}.${invocation.path}`,
      async (context) => {
        context.errorHandling.suppressDisplay = true;
        return execute(context.telemetry); // body stamps duration/Canceled/Failed into ctx.telemetry
      },
    );
    if (!result) throw new Error('no result');
    return result;
  },
};

export const tracked = publicProcedure.use((opts) => telemetryMiddlewareBody(opts, runner));

// Procedures read the injected bag:
someProcedure.query(({ ctx }) => {
  const c = ctx as WithTelemetry<RouterContext>; // WithTelemetry helper
  c.telemetry.properties.result = 'ok';
});
```

**After (`0.10.0`):**

```ts
import { getInvocationSignal, telemetryMiddlewareBody, type TelemetryRunner } from '@microsoft/vscode-ext-webview/host';
import type { IActionContext } from '@microsoft/vscode-azext-utils';

// Choose what to contribute to ctx (here the whole IActionContext).
const runner: TelemetryRunner<{ actionContext: IActionContext }> = {
  async run(eventId, invocation, invoke) {
    const result = await callWithTelemetryAndErrorHandling(eventId, async (actionContext) => {
      actionContext.errorHandling.suppressDisplay = true;
      const middlewareResult = await invoke({ actionContext }); // merged into ctx as ctx.actionContext
      const aborted = getInvocationSignal(invocation.ctx)?.aborted ?? false;
      if (aborted) {
        actionContext.telemetry.properties.result = 'Canceled';
      } else if (!middlewareResult.ok && middlewareResult.error) {
        actionContext.telemetry.properties.result = 'Failed';
        actionContext.telemetry.properties.error = middlewareResult.error.name ?? '';
      }
      return middlewareResult; // duration recorded by callWithTelemetryAndErrorHandling
    });
    if (!result) throw new Error(`no result for ${eventId}`);
    return result;
  },
};

export const tracked = publicProcedure.use(
  telemetryMiddlewareBody(runner, { buildEventId: ({ type, path }) => `myExt.rpc.${type}.${path}` }),
);

// Declare the contributed field on your context; procedures read it directly:
type RouterContext = BaseRouterContext & { actionContext: IActionContext /* + your fields */ };
someProcedure.query(({ ctx }) => {
  const c = ctx as RouterContext;
  c.actionContext.telemetry.properties.result = 'ok';
});
```

Checklist:

- [ ] `TelemetryRunner` → `TelemetryRunner<TEnrichment>`; change `run(invocation, execute)` to `run(eventId, invocation, invoke)`.
- [ ] Replace `execute(bag)` with `invoke(enrichment)`, where `enrichment` is the object you want merged into `ctx`.
- [ ] Move any duration / `Canceled` / `Failed` stamping into the runner (your backend may already record duration).
- [ ] Change `.use((opts) => telemetryMiddlewareBody(opts, runner))` to `.use(telemetryMiddlewareBody(runner, options))`.
- [ ] Move the event-id string into `options.buildEventId` (defaults to `"${type}.${path}"`).

### 2. `WithTelemetry` helper removed (breaking)

The `WithTelemetry<TContext, TTelemetry>` helper is gone. Because the runner now
chooses the field name and value it contributes, declare that field on your
router context type and read it directly:

```ts
// Before
type Tracked = WithTelemetry<RouterContext, ITelemetryContext>;
ctx.telemetry.properties.x = '1';

// After — declare the field you contribute, then read it:
type RouterContext = BaseRouterContext & { actionContext: IActionContext };
(ctx as RouterContext).actionContext.telemetry.properties.x = '1';
```

If a single tRPC instance serves several views, the root context your controller
builds does not carry the injected field (the runner adds it per call), so type
that root object as `Omit<RouterContext, 'actionContext'>`.

### 3. `ProcedureLogger.log` → `onStart?` / `onEnd?` (breaking)

The single required `log(entry)` hook is replaced by two optional hooks. Rename
`log` to `onEnd`; optionally add `onStart` for span-style start logging.

```ts
// Before
const logger: ProcedureLogger = { log: (e) => channel.appendLine(`${e.type} ${e.path}`) };

// After
const logger: ProcedureLogger = {
  onStart: (e) => channel.appendLine(`→ ${e.type} ${e.path}`), // optional
  onEnd: (e) => channel.appendLine(`${e.type} ${e.path} ${e.durationMs}ms`),
};
```

`loggingMiddlewareBody` is unchanged in shape — it still wires as
`publicProcedure.use((opts) => loggingMiddlewareBody(opts, logger))` and times
the call itself.

### 4. `mergeRouters` now exposed (additive)

`initWebviewTrpc()` returns `mergeRouters`, and the shared entry re-exports a
default-instance `mergeRouters`. Use it to compose a view's main router with its
events/subscription router instead of importing `initTRPC` / `mergeRouters` from
`@trpc/server`:

```ts
const { router, mergeRouters, publicProcedure } = initWebviewTrpc<RouterContext>();
export const appRouter = mergeRouters(queriesRouter, eventsRouter);
```

### 5. `AnyRouter` re-exported from `.` and `./react` (additive)

The `AnyRouter` type is now re-exported from the shared (`.`) and `./react`
entries (it was already on `./host`). Generic client helpers can stop importing
it from `@trpc/server`:

```ts
import { type AnyRouter } from '@microsoft/vscode-ext-webview';
```
