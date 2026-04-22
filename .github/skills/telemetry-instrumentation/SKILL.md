---
name: telemetry-instrumentation
description: Instrumentation patterns for telemetry in the vscode-documentdb extension. Use when adding telemetry to a feature, enriching existing telemetry with properties or measurements, linking related events with correlation IDs, instrumenting commands or tree views, suppressing noisy events, or deciding what data points to capture. Also use when asked to "add telemetry" or "improve telemetry" for any feature.
---

# Telemetry Instrumentation

How to instrument code in vscode-documentdb to produce actionable telemetry.

## What the Framework Gives You for Free

The `@microsoft/vscode-azext-utils` library **automatically captures** these — never add them manually:

| Auto-captured           | Details                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| **Duration**            | `measurements.duration` — wall-clock ms from callback start to end |
| **Result**              | `properties.result` — `"Succeeded"`, `"Failed"`, or `"Canceled"`   |
| **Error info**          | `properties.error` (name), `properties.errorMessage` (message)     |
| **Cancel detection**    | `UserCancelledError` sets result to `"Canceled"` automatically     |
| **Machine/session IDs** | `VSCodeMachineId`, `VSCodeSessionId` — always present              |
| **Extension metadata**  | Extension name, version, VS Code version                           |

**Do not** re-measure duration, set `result`, or catch errors just for telemetry — the wrapper handles it.

## Core API

### `callWithTelemetryAndErrorHandling(eventId, callback)`

The primary wrapper. Creates a telemetry event, runs the callback, reports result + duration + errors. The callback's return value is passed through, so you can wrap any function call directly:

```typescript
import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';

// Simple — wrap logic, telemetry is automatic
await callWithTelemetryAndErrorHandling('myFeature.doSomething', async (context) => {
  context.telemetry.properties.someProperty = 'value';
  context.telemetry.measurements.itemCount = items.length;
  // ... your logic — errors are caught and reported automatically
});

// With return value — no need for intermediate variables
const result = await callWithTelemetryAndErrorHandling('myFeature.query', async (context) => {
  context.telemetry.properties.queryType = 'find';
  return doWork(); // return value passes through to the caller
});
```

**Event name convention**: use dot-separated hierarchy: `connect`, `connect.getmetadata`, `connect.promptForCredentials`.

### Command Registration (auto-telemetry)

Every registered command gets a telemetry event automatically. Prefer the correlation-wrapped variants:

```typescript
import { registerCommandWithTreeNodeUnwrapping } from '@microsoft/vscode-azext-utils';
import { withTreeNodeCommandCorrelation, withCommandCorrelation } from '../../utils/commandTelemetry';

// Tree node commands — unwraps tree item + tracks journeyCorrelationId
registerCommandWithTreeNodeUnwrapping(
  'vscode-documentdb.command.connectionsView.myCommand',
  withTreeNodeCommandCorrelation(myCommandHandler),
);

// Plain commands — tracks journeyCorrelationId
registerCommand('vscode-documentdb.command.myCommand', withCommandCorrelation(myCommandHandler));
```

For critical commands where errors need modal dialogs:

```typescript
import { registerCommandWithTreeNodeUnwrappingAndModalErrors } from '../../utils/commandErrorHandling';
```

### tRPC Procedures (auto-telemetry)

Webview tRPC calls get telemetry automatically via `publicProcedureWithTelemetry`. Each call emits `documentDB.rpc.{type}.{path}` with result, error, abort tracking. The telemetry context is available in the procedure via `ctx.telemetry`:

```typescript
myProcedure: publicProcedureWithTelemetry.input(schema).query(async ({ ctx, input }) => {
    ctx.telemetry.properties.someDetail = 'value';
    ctx.telemetry.measurements.resultCount = results.length;
    return results;
}),
```

## Naming Conventions

### Property & measurement names

- **Default**: use **camelCase** — `authMethod`, `connectionMode`, `discoveryProviderId`
- **Namespaced metadata**: when spreading a flat metadata object into telemetry (e.g., cluster metadata collected once and reused), use **prefix_camelCase** — `domainInfo_isAzure`, `serverInfo_version`. The prefix acts as a namespace. This pattern exists in `getClusterMetadata.ts` and is matched by dashboard queries.
- **Never mix** within one prefix: `task_initializationCompleted` (mixed snake + camelCase) is wrong — use `task_initializationCompleted` → `taskInitializationCompleted` or `task_initialization_completed` consistently.
- **Correlation IDs**: always use camelCase — `journeyCorrelationId`, `connectionCorrelationId`.

### Boolean properties

**Always use the ternary pattern** — it makes the intent explicit:

```typescript
// ✅ Correct — clear intent, consistent
context.telemetry.properties.hasFolders = totalFolders > 0 ? 'true' : 'false';
context.telemetry.properties.isFirstConnection = isFirst ? 'true' : 'false';

// ❌ Avoid — works but less readable, can accidentally stringify non-booleans
context.telemetry.properties.isWindows = isWindows.toString();
```

### Numbers: property or measurement?

**Rule: if you'd ever want to compute P50, average, sum, or max over it, use a measurement.** Numbers stored as string properties can't be aggregated in analytics without casting.

```typescript
// ✅ Measurement — enables P50(pageNumber), avg(itemCount)
context.telemetry.measurements.pageNumber = input.pageNumber;
context.telemetry.measurements.itemCount = items.length;

// ❌ Wrong — forces dashboard to todouble(Properties.pageNumber)
context.telemetry.properties.pageNumber = input.pageNumber.toString();
```

**Exception**: numeric values used purely as categories (e.g., an error code used for grouping, not aggregation) can be properties.

## Properties vs Measurements

| Use                       | Type                                 | Example                                          |
| ------------------------- | ------------------------------------ | ------------------------------------------------ |
| **Properties** (string)   | Categorical data, flags, identifiers | `serverType`, `view`, `authMethod`, `hasFolders` |
| **Measurements** (number) | Counts, sizes, durations, rates      | `itemCount`, `loadTimeMs`, `retryAttempts`       |

### Properties — what to capture

```typescript
// Feature context — what variant/mode is being used
context.telemetry.properties.view = 'connectionsView';
context.telemetry.properties.experience = node.experience.api; // 'vCore' | 'RU'
context.telemetry.properties.authMethod = 'connectionString';

// Boolean flags — always use 'true'/'false' strings
context.telemetry.properties.hasFolders = totalFolders > 0 ? 'true' : 'false';
context.telemetry.properties.isFirstConnection = isFirst ? 'true' : 'false';

// Classification of inputs or results
context.telemetry.properties.connectionMode = 'documentdb'; // what was selected
context.telemetry.properties.terminalType = 'PowerShell'; // what environment

// Error classification beyond the auto-captured error
context.telemetry.properties.connectionErrorType = 'auth'; // error category
context.telemetry.properties.parseError = 'SyntaxError'; // specific error type

// View identification — set for user-initiated or view-specific operations
// Skip for background tasks, activation events, or cross-cutting concerns
context.telemetry.properties.view = Views.ConnectionsView;
```

### Measurements — what to capture

```typescript
// Counts — how many items were involved
context.telemetry.measurements.itemCount = results.length;
context.telemetry.measurements.totalConnections = connections.length;
context.telemetry.measurements.savedConnections = rootItems.length;

// Requested vs returned — reveals pagination, limits, empty results
context.telemetry.measurements.pageSize = input.pageSize;
context.telemetry.measurements.documentCount = docs.length;

// Sub-durations — where time is spent (the total is auto-captured)
context.telemetry.measurements.loadTimeMs = Date.now() - startTime;
context.telemetry.measurements.mainFileLoad = (loadEnd - loadStart) / 1000;

// Attempts/retries
context.telemetry.measurements.connectionViewActivationAttempts = attempt + 1;
context.telemetry.measurements.cleanupIterations = iteration;

// Breakdown counts — for multi-category results
context.telemetry.measurements.createRecommendationCount = createCount;
context.telemetry.measurements.dropRecommendationCount = dropCount;

// Structural complexity — depth, nesting
context.telemetry.measurements.maxFolderDepth = maxDepth;
```

### Dynamic property/measurement names

When the set of categories is data-driven, use a prefix:

```typescript
context.telemetry.measurements[`${zonePrefix}_Connections`] = connectionsInZone;
context.telemetry.measurements[`${zonePrefix}_Folders`] = foldersInZone;
```

## Sub-step Telemetry

Use nested `callWithTelemetryAndErrorHandling` inside a parent event to get fine-grained timing and success/failure per step:

```typescript
await callWithTelemetryAndErrorHandling('connect', async (context) => {
  context.telemetry.properties.view = 'discoveryView';

  // Sub-step: prompting — gets its own duration, result, errors
  await callWithTelemetryAndErrorHandling('connect.promptForCredentials', async (subCtx) => {
    subCtx.errorHandling.rethrow = true; // let parent see failures
    await wizard.prompt();
  });

  // Sub-step: metadata collection (fire-and-forget, non-blocking)
  void callWithTelemetryAndErrorHandling('connect.getmetadata', async (metaCtx) => {
    const metadata = await collectMetadata();
    metaCtx.telemetry.properties = { ...metaCtx.telemetry.properties, ...metadata };
  });
});
```

**When to use sub-steps**:

- Operation has distinct phases (prompt → connect → collect metadata)
- You need per-phase duration/success data
- A sub-step can fail independently without failing the parent

**Naming**: use parent event as prefix: `connect.promptForCredentials`, `connect.getmetadata`, `connect.staticmetadata`.

## Correlation IDs — Linking Related Events

### journeyCorrelationId — user journey across commands

Links a chain of user actions that form a logical journey (e.g., discover → select → connect → browse). Generated once at the start and propagated through tree items:

```typescript
// Generate at the journey start (e.g., when a discovery tree root is created)
this.journeyCorrelationId = randomUUID();

// Tree items carry it to children
new MongoRUResourceItem(this, account, this.journeyCorrelationId);

// Commands pick it up automatically via withTreeNodeCommandCorrelation/withCommandCorrelation
// OR manually in a callWithTelemetryAndErrorHandling:
if (this.journeyCorrelationId) {
  context.telemetry.properties.journeyCorrelationId = this.journeyCorrelationId;
}
```

**Use `journeyCorrelationId` when**: a user flow spans multiple command invocations that should be analyzed together (discovery → connect → browse, folder operations in sequence).

### connectionCorrelationId — linking connection sub-events

Links the `connect`, `connect.staticmetadata`, and `connect.getmetadata` events for a single connection attempt:

```typescript
this.connectionCorrelationId = randomUUID();

void callWithTelemetryAndErrorHandling('connect.staticmetadata', async (context) => {
  context.telemetry.properties.connectionCorrelationId = this.connectionCorrelationId;
  // ...domain metadata
});

void callWithTelemetryAndErrorHandling('connect.getmetadata', async (context) => {
  context.telemetry.properties.connectionCorrelationId = this.connectionCorrelationId;
  // ...server metadata
});
```

**Use `connectionCorrelationId` when**: an operation emits multiple independent events that must be joined for analysis (especially fire-and-forget sub-events).

### Session-scoped correlation — ongoing sessions

For features where a user session produces many events (e.g., shell, REPL, interactive query editing), generate a session-scoped correlation ID and attach it to every event in that session. This enables aggregation (total commands per session, session duration as max-min timestamps):

```typescript
const sessionId = randomUUID();

// Each action within the session carries the same ID
context.telemetry.properties.shellSessionId = sessionId;
context.telemetry.measurements.commandIndex = commandCount++;
```

## Controlling Telemetry Behavior

### Suppressing noisy events

```typescript
// High-frequency events (keystroke handlers, document change listeners)
context.telemetry.suppressIfSuccessful = true; // only emit on error/cancel

// Fully silent (internal bookkeeping)
context.telemetry.suppressAll = true;
```

### Error handling control

```typescript
// Don't show error notification to user (background/internal operations)
context.errorHandling.suppressDisplay = true;

// Re-throw so the parent caller sees the error
context.errorHandling.rethrow = true;

// Don't offer "Report Issue" button
context.errorHandling.suppressReportIssue = true;
```

### Activation events

Mark startup/initialization telemetry so it can be filtered out of active-usage analysis:

```typescript
context.telemetry.properties.isActivationEvent = 'true';
```

## Common Mistakes to Avoid

### ❌ Don't measure duration manually — the framework does it

The framework auto-captures `measurements.duration` for every `callWithTelemetryAndErrorHandling` event. Never add `Date.now()` tracking for the same purpose:

```typescript
// ❌ Wrong — redundant manual timing
const startTime = Date.now();
await callWithTelemetryAndErrorHandling('myEvent', async (context) => {
  await doWork();
  context.telemetry.measurements.durationMs = Date.now() - startTime; // duplicates framework
});

// ✅ Correct — framework captures duration automatically
await callWithTelemetryAndErrorHandling('myEvent', async (context) => {
  await doWork();
  // duration is auto-captured — no manual timing needed
});
```

**Exception**: sub-durations within a single event (e.g., "time spent on init vs. time on eval") are valid because they measure a _phase_, not the total.

### ❌ Don't create separate success/failure telemetry blocks

Wrap the operation in a single `callWithTelemetryAndErrorHandling`. The framework sets `result=Succeeded` or `result=Failed` automatically:

```typescript
// ❌ Wrong — two fire-and-forget blocks, error rethrow inside void is swallowed
try {
  const result = await doWork();
  void callWithTelemetryAndErrorHandling('myEvent', async (ctx) => {
    ctx.telemetry.properties.isError = 'false';
  });
} catch (error) {
  void callWithTelemetryAndErrorHandling('myEvent', async (ctx) => {
    ctx.telemetry.properties.isError = 'true';
    throw error; // ⚠️ swallowed — void discards the promise
  });
}

// ✅ Correct — single wrapper, framework handles success/failure
await callWithTelemetryAndErrorHandling('myEvent', async (context) => {
  context.errorHandling.suppressDisplay = true;
  context.errorHandling.rethrow = true; // let caller handle display
  context.telemetry.properties.someProperty = 'value';
  const result = await doWork(); // errors auto-set result=Failed
  context.telemetry.properties.resultType = result.type;
});
```

### ❌ Don't use `suppressIfSuccessful` on events you want to measure

`suppressIfSuccessful = true` means the event is **only emitted on error**. Never use it on events where you need to count successful occurrences:

```typescript
// ❌ Wrong — successful completions are silently dropped
registerCommand('completionAccepted', (context) => {
  context.telemetry.properties.category = category;
  context.telemetry.suppressIfSuccessful = true; // BUG: won't emit on success
});

// ✅ Correct — every acceptance is tracked
registerCommand('completionAccepted', (context) => {
  context.telemetry.properties.category = category;
  // no suppress — we want to count every acceptance
});
```

**When `suppressIfSuccessful` IS correct**: high-frequency background operations where you only care about failures (e.g., keystroke handlers, document change listeners, periodic health checks).

### ❌ Don't throw errors inside `void callWithTelemetryAndErrorHandling`

When using fire-and-forget (`void`) telemetry, thrown errors are swallowed because nobody awaits the promise. The framework captures the error in telemetry properties but the throw has no effect on the calling code:

```typescript
// ❌ Wrong — throw inside void is swallowed, no effect on caller
void callWithTelemetryAndErrorHandling('myEvent', async (context) => {
  throw error; // captured in telemetry but NOT re-thrown to caller
});
// code continues here regardless

// ✅ Correct for fire-and-forget — just set properties, don't throw
void callWithTelemetryAndErrorHandling('myEvent', async (context) => {
  context.telemetry.properties.shellSessionId = sessionId;
  // fire-and-forget: no throw, no await needed
});

// ✅ Correct when you need error propagation — use await
await callWithTelemetryAndErrorHandling('myEvent', async (context) => {
  context.errorHandling.rethrow = true;
  await riskyOperation(); // error propagates to caller via rethrow
});
```

## Masking Sensitive Data

**Never let connection strings, passwords, tokens, or hostnames appear in telemetry.**

```typescript
import { maskSensitiveValuesInTelemetry } from '../../documentdb/utils/connectionStringHelpers';

// Mask all sensitive parts of a parsed connection string
maskSensitiveValuesInTelemetry(context, parsedConnectionString);

// Or mask individual values
context.valuesToMask.push(password, token);
```

## Tree View Events

Tree `getChildren` calls emit telemetry. Always set context so analytics can distinguish navigation levels:

```typescript
return callWithTelemetryAndErrorHandling('getChildren', async (context) => {
  context.telemetry.properties.parentNodeContext = element ? (await element.getTreeItem()).contextValue : 'root';
  context.telemetry.measurements.childrenCount = children.length;
  return children;
});
```

**Note**: Root-level `getChildren` fires automatically when panels become visible (passive rendering). Analytics filters these with `parentNodeContext != "root"` — always set this property.

## What Data Points to Capture — Decision Guide

When instrumenting a feature, consider these categories:

### For any operation

- **What variant/mode** was used (property) — enables segmentation
- **How many items** were involved (measurement) — reveals usage scale
- **Server/environment type** when relevant (property) — different backends behave differently

### For slow or async operations

- Sub-step durations (measurements) — total duration is auto-captured, but breakdowns show where time goes
- Retry/attempt counts (measurement) — reveals flakiness
- Timeout vs success (property) — important for polling patterns

### For operations that return results

- **Requested vs returned count** — reveals empty results, pagination patterns, limit hits
- **Result classification** — category/type breakdown of what was returned

### For multi-step flows

- **Correlation ID** — link events into a journey
- **Step identification** — which step succeeded/failed (sub-step events or `lastStep` property)
- **Cancellation point** — where the user abandoned the flow

### For session-based features (shell, REPL, interactive editors)

- **Session correlation ID** — group all events from one session
- **Command/action index** — sequence number within the session (enables count-per-session aggregation since there's typically no "session end" event)
- **Server type** — what kind of server the session targets

### For error recovery flows

- **Recovery success flag** — did the user successfully recover (e.g., `reconnected = 'true'`)
- **Error-then-recovery correlation** — link the original error to the recovery action

## When to Override `result` Manually

The wrapper auto-sets `result` to `"Succeeded"` / `"Failed"` / `"Canceled"`. Manual override is **required** in two cases:

1. **Early return on invalid state** — function returns without throwing, but the operation logically failed:

```typescript
if (!isValidFormat) {
  context.telemetry.properties.result = 'Failed';
  context.telemetry.properties.errorReason = 'invalidNodeIdFormat';
  return; // no throw → wrapper would report "Succeeded" without the override
}
```

2. **Non-throwing error signals** — e.g., tRPC returns `{ ok: false }` instead of throwing:

```typescript
if (!result.ok) {
  context.telemetry.properties.result = 'Failed';
  context.telemetry.properties.error = result.error.name;
}
```

**Do NOT** override `result` when you also `throw` — the wrapper handles that automatically.

## Common Pitfalls

- **Don't measure duration** — `callWithTelemetryAndErrorHandling` does this already
- **Don't set `result` when throwing** — the wrapper sets `"Succeeded"` / `"Failed"` / `"Canceled"` automatically from the throw. Only override `result` on early-return failures or non-throwing error paths (see above)
- **Don't catch errors just for telemetry** — the wrapper catches and records them
- **Don't log sensitive data** — use `maskSensitiveValuesInTelemetry` or `context.valuesToMask`
- **Don't create a new `callWithTelemetryAndErrorHandling` for every minor step** — only when you need separate duration/result tracking for a step
- **Don't forget `context.errorHandling.rethrow = true`** in sub-steps that should propagate failures to the parent
- **Don't use `suppressIfSuccessful`** on events you need to count — it drops successful events entirely
- **Don't store numbers as string properties** — use `measurements` for anything you'd want to aggregate (P50, sum, avg). Use `.toString()` only for numbers used as categorical grouping keys
- **Don't use `.toString()` for booleans** — use the explicit ternary: `value ? 'true' : 'false'`
