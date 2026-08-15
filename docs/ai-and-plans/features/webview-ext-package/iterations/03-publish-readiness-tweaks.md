---
area: webview-ext-package
kind: iteration
status: historical
prs: [766, 786]
created: 2026-07-06
---

# PR #786 — `@microsoft/vscode-ext-webview` publish-readiness tweaks

**Branch:** `dev/tnaum/webview-api-tweak` → `main`
**PR:** https://github.com/microsoft/vscode-documentdb/pull/786
**Date:** 2026-07-06
**Package:** `packages/vscode-ext-webview` (`@microsoft/vscode-ext-webview`, `0.9.0-preview`)

This note records three small, low-risk improvements made to the webview API
package after it was merged in [PR #766](./02-package-redesign/).
They came out of review feedback, a follow-up question about peer
dependencies, and an external consumer's documentation bug report. No runtime
or API behaviour changes — this is packaging metadata plus documentation only.

---

## 1. Add `"sideEffects": false` to `package.json`

### What

Added a single field to `packages/vscode-ext-webview/package.json`, next to the
other module-resolution fields:

```json
"main": "dist/index.js",
"types": "dist/index.d.ts",
"sideEffects": false,
"exports": { ... }
```

### Why

`"sideEffects": false` is a contract with consumer bundlers (webpack, Rollup,
esbuild, Vite): it promises that importing any module from this package has **no
observable side effect**, so any exports the consumer does not actually use can
be safely eliminated (dead-code elimination / tree-shaking). This was the
reviewer's suggestion:

> react and vscode-webview peer deps are optional, but there's no top-level
> engines/sideEffects field. Not required, but if you want cleaner tree-shaking
> for consumers you could add `"sideEffects": false` to the package.json.

Combined with the package's existing subpath exports (`.`, `./host`,
`./webview`, `./react`), this gives consumers a clean guarantee that they only
pay for what they import.

### Why it is safe (verification of "no side effects")

The flag is only safe if the package genuinely has no module-level side effects;
otherwise a bundler could drop code a consumer implicitly relies on. Before
adding it, every non-test source file was scanned for top-level executable
statements. The only module-level code found is:

- pure `function` / `const` declarations;
- a `new WeakMap()` allocation in `src/react/connection.ts` (pure — used as a
  per-`vscodeApi` connection cache);
- `const defaultTrpc = initWebviewTrpc()` in `src/shared/initWebviewTrpc.ts`,
  which calls `initTRPC.context<TContext>().create()` — a pure tRPC builder with
  no I/O, no global mutation, and no side-effectful registration.

There are no polyfills, no global patching, and no side-effectful imports.
`"sideEffects": false` is therefore correct.

### Why `engines` was intentionally skipped

The reviewer mentioned `engines` in the same breath, but it was deliberately not
added. For a library that is consumed through a bundler, an `engines` field is
optional and can produce spurious `EBADENGINE` install warnings for consumers on
a different Node version, without adding real value. The reviewer flagged it as
"not required," so it earns its keep less than the `sideEffects` flag.

---

## 2. Clarify optional peer dependencies (README)

### What

Reconciled the README with what `package.json` already declares. Two spots were
updated in `packages/vscode-ext-webview/README.md`:

1. The **install** prose listed the peers as "react, @trpc/client, and
   @trpc/server" — omitting `vscode-webview` — and did not say which are
   optional. It now lists all four and calls out `react` and `vscode-webview` as
   optional peers.
2. The **Peer dependencies** table gained an explicit "Optional?" column and a
   sentence explaining that `react` and `vscode-webview` are declared optional
   via `peerDependenciesMeta`, so host-only / non-React consumers install
   neither and see no missing-peer warning.

### Why (and the peer-dependency reasoning behind it)

This tweak came from a follow-up question: _"should I make react optional? if my
consumer is not using the react section, they don't really need it."_

The answer is that `react` is **already** optional — the package was set up
correctly — but the docs under-described it. For the record, the peer-dependency
design of this package is:

```json
"peerDependencies": {
  "@trpc/client": "^11.0.0",
  "@trpc/server": "^11.0.0",
  "react": ">=18.0.0",
  "vscode-webview": "^1.0.0"
},
"peerDependenciesMeta": {
  "react":          { "optional": true },
  "vscode-webview": { "optional": true }
}
```

**Why peers and not regular dependencies?** A peer dependency says "the consumer
provides this, and we must share a single instance," declaring a compatible
_range_ rather than pinning a version. That matters here because:

- **`react`** — two copies of React in one bundle break hooks ("Invalid hook
  call"). The package's hooks must use the consumer's React instance, never a
  second bundled copy.
- **`@trpc/client` / `@trpc/server`** — tRPC's end-to-end type safety and link
  contracts rely on the _same_ tRPC version on both sides of the transport; a
  bundled copy could silently mismatch the consumer's router types.
- **`vscode-webview`** — webview-environment types/globals provided by the host
  runtime; duplicating them is meaningless.

If these were regular `dependencies`, consumers could end up with duplicate
React / tRPC copies — the exact "pull duplicates into your webview bundle"
problem the README warns about.

**Why `react` and `vscode-webview` are optional peers.** `peerDependenciesMeta`
`optional: true` means "required only if you use the surface that needs it, and
don't warn otherwise." Both `react` and `vscode-webview` are referenced only by
the `./react` subpath (`vscode-webview` supplies the `WebviewApi` type used in
`WithWebviewContext`; the framework-agnostic `./webview` transport defines its
own structural `VsCodeApiLike` and imports nothing from `vscode-webview`). A
consumer using `./host` or the framework-agnostic `./webview` surface therefore
installs neither and gets no missing-peer warning. `@trpc/client` /
`@trpc/server` are **not** optional because they back the core transport on both
surfaces.

A consumer does **not** have to match an exact version — they satisfy the
declared range with whatever version they already use. Modern npm (v7+)
auto-installs missing required peers and surfaces incompatible-version
mismatches as warnings/errors at install time rather than at runtime.

---

## Files changed

| File                                       | Change                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------- |
| `packages/vscode-ext-webview/package.json` | Add `"sideEffects": false`.                                                            |
| `packages/vscode-ext-webview/README.md`    | Clarify optional peer dependencies in the install prose and the peer-dependency table. |

## Commits

- `fix(package): add sideEffects flag to package.json`
- `docs(vscode-ext-webview): clarify optional peer dependencies`
- `docs(vscode-ext-webview): scope optional peers to the ./react surface` (review round 1)

## Review round 1 — Copilot reviewer

The Copilot reviewer flagged a real inconsistency in the first docs commit: the
install prose said the optional peers were needed for "the `./react` and
webview-side surfaces," implying a framework-agnostic `./webview` consumer needs
`vscode-webview`. That is wrong and contradicted the peer-dependency table note
(which correctly said a `./webview` consumer installs neither optional peer).

Verified against source: only `src/react/WebviewContext.tsx` imports from the
`vscode-webview` package; `src/webview/connectTrpc.ts` defines its own structural
`VsCodeApiLike` and imports nothing from it. So both optional peers narrow to the
`./react` surface only.

Fix: reworded the install prose and the `vscode-webview` table row to say "only
for the `./react` surface," and added a sentence explaining that the `./webview`
transport uses a structural `VsCodeApiLike` instead. No `package.json` change was
needed — the `peerDependenciesMeta` config was already correct; only the docs
were imprecise.

---

## 3. Fix `WithTelemetry` documented entry point

### What

`docs/ai-and-plans/features/webview-ext-package/migration-manual.md`
listed `WithTelemetry<T, TTelemetry>` under the `.` (shared) entry point in the
"New primitives that had no old equivalent" table. That is wrong — it is
exported from `./host`. Also added `WithTelemetry` to the `./host` row of the
"Entry points" table in `packages/vscode-ext-webview/README.md`, and made the
Observability/Telemetry section prose in that README explicitly say the helper
comes from `./host`. `ADVANCED.md` already imported it correctly from `./host`
and needed no change.

### Why

Verified against the shipped type declarations: `dist/shared/index.d.ts`
exports only `BaseRouterContext`, `initWebviewTrpc`, `publicProcedure`,
`router`, `WebviewTrpc`, `TypedEventSink` (+ related event types), and the
wire-protocol message types — it does **not** export `WithTelemetry`.
`WithTelemetry` is exported from `dist/host/index.d.ts` (re-exported from
`./middleware/telemetry`). This matches the package's own reference consumer,
which imports it as
`import { type WithTelemetry } from '@microsoft/vscode-ext-webview/host'`
(see `ADVANCED.md` and `src/webviews/_integration/trpc.ts`).

This was reported by the first external consumer of the published package —
the `vscode-webview-starter-kit`, using `@microsoft/vscode-ext-webview@0.9.0-preview`
as its first real npm consumer — who hit the mismatch trying to import
`WithTelemetry` from the shared entry point per the migration manual.

Docs-only fix; no source/exports were changed — the package's exports were
already correct.

---

## Files changed

| File                                                                                     | Change                                                                                                                                               |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/vscode-ext-webview/package.json`                                               | Add `"sideEffects": false`.                                                                                                                          |
| `packages/vscode-ext-webview/README.md`                                                  | Clarify optional peer dependencies in the install prose and the peer-dependency table; correct `WithTelemetry`'s documented entry point to `./host`. |
| `docs/ai-and-plans/features/webview-ext-package/migration-manual.md` | Correct `WithTelemetry`'s documented entry point to `./host`.                                                                                        |

## Commits

- `fix(package): add sideEffects flag to package.json`
- `docs(vscode-ext-webview): clarify optional peer dependencies`
- `docs(vscode-ext-webview): scope optional peers to the ./react surface` (review round 1)
- `docs(vscode-ext-webview): fix WithTelemetry documented entry point to ./host`

## Verification

Run from `packages/vscode-ext-webview` after `npm install` at the repo root:

- `npm run build` (tsc) — clean.
- `npx prettier --check package.json README.md` — clean.
- `npm test` (jest) — 89/89 tests pass across 11 suites.

No code or runtime behaviour changed; the package remains publish-ready.
