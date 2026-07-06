# host/middleware

Optional, batteries-included tRPC middleware bodies. A middleware wraps every
procedure call and can do anything (logging, telemetry, auth, validation, and so
on); these are the two the package ships.

- `logging.ts`: `loggingMiddlewareBody` plus the `ProcedureLogger` sink.
  `consoleProcedureLogger` is the zero-config default.
- `telemetry.ts`: `telemetryMiddlewareBody` plus the `TelemetryRunner` adapter
  (for example, Application Insights via `@microsoft/vscode-azext-utils`).
- `types.ts`: the shared invocation and result types the bodies read.

A "body" is the unbound inner function, so it is not tied to one tRPC instance.
Wire one onto your own procedure:

```ts
publicProcedure.use((opts) => loggingMiddlewareBody(opts, myLogger));
```

You are not limited to these two. Write your own middleware the same way.
