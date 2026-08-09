---
name: error-translation
description: How infrastructure-caused database failures are turned into messages users can act on, via ConnectionDiagnosticsService. Use when adding a discovery plugin, a connection source, a reachability provider, a new tree view or webview surface, when a user reports a confusing or raw driver error, or when asked to improve error messages for Docker, Kubernetes, Atlas, Azure or any other infrastructure-backed connection.
---

# Error Translation

A connection can fail for reasons that have nothing to do with the database: a container was
stopped, a port-forward tunnel died, a service closed the TLS handshake. The driver reports these
as `ECONNREFUSED`, a server-selection timeout, or an OpenSSL alert, none of which tell the user
what to do.

`ConnectionDiagnosticsService` lets the source that owns the infrastructure explain the failure in
its own words.

## The one rule

> **Providers translate. They never show UI and never recover.**

No dialogs, no notifications, no progress bars, no starting or restarting anything, no retries, no
prompts. A provider receives an error and returns text.

This is not a style preference. One user action often runs several database commands, several
actions can fail at the same time, and many calls happen on background paths that show nothing. A
provider that showed UI or repaired state would produce duplicate dialogs, dialogs nobody asked
for, and errors that are already obsolete by the time they appear.

Anything with a side effect belongs at the call site, which alone knows whether the user is
watching, whether the operation was a read or a write, and which surface is right.

## Adding a provider

Implement `ConnectionDiagnosticsProvider` and register it in
[ClustersExtension.registerDiscoveryServices](../../../src/documentdb/ClustersExtension.ts),
next to the existing ones.

```ts
export class MyDiagnosticsProvider implements ConnectionDiagnosticsProvider {
    public readonly id = 'my-source';

    public async explain({ clusterId, error }: ConnectionDiagnosticsRequest): Promise<string | undefined> {
        if (!isMine(clusterId)) {
            return undefined; // not ours: the caller shows the original error
        }
        if (!looksLikeMyFailure(error)) {
            return undefined; // ours, but nothing wrong on our side
        }
        return l10n.t('...');
    }
}
```

`undefined` is always the safe answer: it means "show the original error".

A provider may answer without inspecting the error at all. Cancellations are therefore filtered
centrally: `explain()` returns `undefined` for a `UserCancelledError` before any provider is asked,
so a wizard the user escaped is never reported as an infrastructure failure.

### Answer the cheap question first

`explain()` runs on every foreground failure across the whole extension, so the common case must
cost almost nothing. Order the checks so the fastest rejection happens first.

- `QuickStartDiagnosticsProvider` scans an in-memory list of managed instances before touching Docker.
- `AtlasDiagnosticsProvider` tests the error message shape before looking up any credentials.
- `KubernetesDiagnosticsProvider` checks its in-memory map before importing the tunnel machinery.

### Do not cache verdicts

`explain()` runs once per user-initiated failure, so caching buys nothing and costs correctness: a
memoized "not running" would still be reported right after the user starts the container and
retries. Probe fresh every time.

If a provider ever does become expensive enough to matter, share in-flight work rather than
caching results, so a repeat attempt still sees the current state.

### Knowing whether a cluster is yours

`clusterId` is the only identity that reaches every call site. Stored connection properties do not
travel past the tree item, so a webview, the shell and the playground cannot read them. Pick
whichever of these fits your source:

| Approach | Example | When |
| --- | --- | --- |
| Look it up in state you already keep | Quick Start reads `listStatuses()` | Your source has a live registry |
| Inspect the connection string | Atlas checks the `mongodb.net` host suffix | The endpoint identifies the source |
| Record it while preparing the connection | Kubernetes remembers `clusterId` in `ensureReachable` | Only the stored properties identify the source |

The third case is why `ConnectionReachabilityProvider.ensureReachable` takes an optional
`clusterId`: that call is the one moment where both halves are known.

## Never touch the error

`explain()` returns text. It does not modify, replace, or attach properties to the error, and
neither should you. A lot of code here inspects errors by identity rather than by text:

- `instanceof UserCancelledError` decides failure versus cancellation, in roughly 25 places;
- `instanceof QueryError`, `MongoBulkWriteError` and `SettingsHintError` change how a failure is handled;
- `error.code` is read for server codes (115, 235) and socket codes (`ECONNRESET`, `ENOTFOUND`);
- `errorCodeExtractor.ts` reads `error.cause.cause.code` at a **fixed depth**, so an extra wrapper level breaks Collection view error-code detection;
- `extractErrorCode()` parses a `[CODE-12345]` prefix from the **start** of a message, so prepending text breaks the shell and the playground;
- the tRPC boundary rebuilds errors as `{ code, name, message, stack, cause }`, so a custom property never reaches a webview anyway.

Leave the error alone and none of this can break.

## Adding a call site

Call `explain()` where you are about to **render** a failure, then show its message instead of the
raw one and keep the raw text as detail. Rethrow the original error unchanged so telemetry and
every downstream check keep working.

```ts
const diagnosis = await ConnectionDiagnosticsService.explain({ clusterId, error });
void vscode.window.showErrorMessage(diagnosis?.message ?? l10n.t('Failed to load ...'), {
    modal: true,
    detail: error instanceof Error ? error.message : String(error),
});
```

Existing call sites:

| Surface | File |
| --- | --- |
| Every tree view, below a cluster | [BaseExtendedTreeDataProvider.ts](../../../src/tree/BaseExtendedTreeDataProvider.ts) |
| Cluster connect and list databases | [ClusterItemBase.ts](../../../src/tree/documentdb/ClusterItemBase.ts) |
| Shell connect banner | [DocumentDBShellPty.ts](../../../src/documentdb/shell/DocumentDBShellPty.ts) |
| Query playground | [executePlaygroundCode.ts](../../../src/commands/playground/executePlaygroundCode.ts) |
| Tree-node commands (create, drop, …) | [commandErrorHandling.ts](../../../src/utils/commandErrorHandling.ts) |
| Any webview, via `common.explainOperationFailure` | [appRouter.ts](../../../src/webviews/_integration/appRouter.ts) |

Tree views need no per-view wiring: `wrapGetChildrenWithErrorAndStateHandling` translates on the way
out, so any provider built on the base class is covered. Commands registered with
`registerCommandWithTreeNodeUnwrappingAndModalErrors` are covered the same way, via the tree node
they receive.

### Do not call it from background paths

Background work shows nothing, so translating there costs I/O for no benefit. Leave these alone:
collection and document count badges, index count badges, the Collection view document count, and
the Query Insights stage 1 prefetch. They already swallow their errors on purpose.

### Webviews

An explanation cannot ride along on an error across the tRPC boundary, so a webview asks for one:

```tsx
.catch(async (error) => {
    const cause = error instanceof Error ? error.message : String(error);
    const explained = await trpcClient.common.explainOperationFailure.query({ message: cause });
    void trpcClient.common.displayErrorMessage.mutate({
        message: explained ?? l10n.t('Error while running the query'),
        modal: true,
        cause,
    });
});
```

`explainOperationFailure` reads the `clusterId` from the webview's tRPC context and returns `null`
when nothing applies. Only the error MESSAGE crosses the boundary, so a provider that needs an
error's class or `code` cannot be served this way. Never wrap an error to smuggle text through.

## Writing the message

- Do not assert what happened. Say "we cannot find", "very likely", "does not appear to be".
- "We" is fine and is the established voice.
- Say what the user can do next, and where.
- No em dashes or en dashes.
- Wrap every string in `l10n.t()` and run `npm run l10n`.

```ts
// Good
l10n.t('We cannot find the DocumentDB Local container. It was very likely removed outside VS Code. You can recreate it from the Connections view, which reuses the existing data volume.')

// Bad: asserts a cause, and offers no next step
l10n.t('The container was removed outside VS Code.')
```

## Related

- [connectionDiagnosticsService.ts](../../../src/services/connectionDiagnosticsService.ts)
- [connectionReachabilityService.ts](../../../src/services/connectionReachabilityService.ts) prepares a connection *before* connecting; this service explains a failure *afterwards*
- [tree-cluster-architecture](../tree-cluster-architecture/SKILL.md) for `clusterId` versus `treeId`
- [telemetry-instrumentation](../telemetry-instrumentation/SKILL.md)
