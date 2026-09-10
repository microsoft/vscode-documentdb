---
feature: deep-links
kind: notes
status: active
prs: [898]
created: 2026-08-24
code:
    - src/vscodeUriHandler.ts
---

# Deep Links

**Status:** in progress — the action switch is new; `local` is its first non-`connect` action.

> How a URL from outside VS Code reaches this extension, and why the vocabulary looks the way it
> does.

A deep link names **what it wants** in the path and supplies **arguments for it** in the query:

```
vscode://ms-azuretools.vscode-documentdb/connect?connectionString=…&database=…&collection=…
vscode://ms-azuretools.vscode-documentdb/local
vscode://ms-azuretools.vscode-documentdb/local/documentdb
vscode://ms-azuretools.vscode-documentdb?connectionString=…            ← legacy, means /connect
```

## Why this exists

Local Quick Start shipped in 0.10.0: a user can go from nothing to a running local DocumentDB in
one click — **if they already have the extension and know where the button is**. The website is
where the people who do not have it land.

A link that opens the setup wizard closes that gap, and the handler could not express it: `connect`
was the only action, and it rejects any link without a connection string. A "set up DocumentDB
Local" link has no connection string by definition, because the container does not exist yet.

## Code map

- `src/vscodeUriHandler.ts` — the whole handler: route parsing, the action allow-list, and the
  `connect` implementation
- `src/extension.ts` — registers it via `vscode.window.registerUriHandler`

## User docs

- [docs/user-manual/how-to-construct-url.md](../../../user-manual/how-to-construct-url.md) — **the
  public contract.** Any change to the vocabulary belongs there in the same PR.

## Architecture (intent — code is authoritative for behavior)

- **The path is the verb; the query is its arguments.** Putting the action in the query would mean
  every reader has to know which keys are the verb and which are its parameters, and would leave
  nowhere to namespace the discovery plugins
  ([0001](./decisions.md#0001--the-action-goes-in-the-path-not-the-query)).
- **An empty path means `connect`, permanently.** Every link published before actions existed has
  an empty path, and a link in a blog post cannot be recalled
  ([0002](./decisions.md#0002--an-empty-path-means-connect-forever)).
- **The action list is a security boundary, not a routing convenience.** It is hand-written and
  never derived from the command registry
  ([0003](./decisions.md#0003--the-action-list-is-hand-written-never-the-command-registry)).
- **An unrecognized action is refused, not defaulted.** Falling back to `connect` would make every
  typo a silent connection attempt against a connection string the user did not mean to use here.
- **Local resource types are explicit and bounded.** `/local` defaults to `documentdb`, while
  `/local/documentdb` names it explicitly. Unknown types and additional qualifiers are rejected
  rather than silently opening the DocumentDB Local wizard
  ([0006](./decisions.md#0006--local-links-model-the-resource-type)).
- **External local links require one lightweight confirmation by default.** The existing URL
  confirmation setting gates it; the wizard itself remains responsible for all provisioning
  decisions
  ([0007](./decisions.md#0007--local-links-show-one-lightweight-confirmation)).
- **Telemetry keeps the `failureStage` / `errorName` shape.** It exists because of issue #655
  ("URL handler error rate at 100%"), and every new branch fills it in.

## Timeline

| Date       | What                                                                        |
| ---------- | --------------------------------------------------------------------------- |
| —          | `connect` shipped as the only mode; dispatch read `uri.query` only          |
| 2026-08-24 | Action switch added in the path; `local` opens the DocumentDB Local wizard  |
| 2026-09-01 | `local` gained a validated resource type and one setting-gated confirmation |

## Open gaps

- **Discovery plugin actions are unimplemented.** The handler's original JSDoc anticipated that
  "other modes … will be handled by our discoverability plugins", and five discovery plugins exist
  (`service-atlas-mongodb`, `service-azure-mongo-ru`, `service-azure-mongo-vcore`,
  `service-azure-vm`, `service-kubernetes`). The shape reserved for them is `/discovery/<provider>`,
  but nothing consumes it yet and no provider-id vocabulary has been agreed.
  `DeepLinkRoute.qualifiers` exists to carry it.
- **`connect` still depends on the legacy emulator branch.** `isLegacyEmulatorMigrationComplete()`
  and `ConnectionType.Emulators` are removed by issue
  [#870](https://github.com/microsoft/vscode-documentdb/issues/870), milestone 0.11.0. That work and
  this share a file.
- **No end-to-end test of the `connect` path.** The new suite covers routing and the allow-list;
  `connect`'s storage, duplicate detection, and TLS handling remain untested.
