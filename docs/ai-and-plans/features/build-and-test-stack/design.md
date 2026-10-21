---
feature: build-and-test-stack
kind: design
status: active
created: 2026-10-14
verified: 2026-10-14
code:
  - vite.config.ext.mjs
  - vite.config.views.mjs
  - vitest.config.ts
  - main.ts
  - src/documentdb/playground/tsPluginStub.ts
  - test/vitest/setup.ts
  - build/vite/**
  - build/verification/**
---

# Build and test stack design

This document names the invariants that future changes must preserve. The implementation details
and commands live in the [Vite rationale](../../../../build/vite/README.md) and
[verification guide](../../../../build/verification/README.md). The configs and tests remain the
source of truth for behavior.

## Design boundaries

- Vite builds both the extension host and the webviews into `dist/`.
- Vitest runs extension tests and the tests for all seven workspace packages.
- Production bundle reports bind packaged JavaScript to its source graph and support L1 inspection.
- Development scenarios, packaged-browser checks, and installed-VSIX activation answer different
  questions. None substitutes for the others.
- The VSIX ships no `node_modules` dependency tree. Host runtime requests must be provided by VS
  Code or Node, or be an intentional external path.

## Invariants

### One `bson` implementation per entry graph

`bson` exposes separate CommonJS and ESM implementations. Mixing them creates distinct constructors
and breaks identity-sensitive behavior such as `instanceof`.

| Enforcement                                                                                                                           | Guard                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`vite.config.ext.mjs`](../../../../vite.config.ext.mjs) aliases bare `bson` to the CommonJS entry used by the DocumentDB API driver. | L1 requires exactly one implementation in the `main` and playground-worker graphs.                                                                                                           |
| [`vite.config.views.mjs`](../../../../vite.config.views.mjs) aliases bare `bson` to the browser ESM entry.                            | L1 permits zero or one implementation in each webview graph, never two.                                                                                                                      |
| [`vitest.config.ts`](../../../../vitest.config.ts) aliases ESM importers to the CommonJS entry used by CommonJS dependencies.         | The [`bson-identity` probe](../../../../build/verification/bson-identity/) exercises driver, ESM, dynamic-import, source-like, and shell-parser routes. Its alias-removed control must fail. |

Do not treat a resolution change as a size-only optimization. Re-run the identity probe whenever a
build alias, package export, or dependency route can change which `bson` entry loads.

### `views.js` exports `render`

The production webview template imports `render` by name. Vite's application default may remove
entry exports, leaving every panel blank.

[`vite.config.views.mjs`](../../../../vite.config.views.mjs) sets
`preserveEntrySignatures: 'strict'` and emits the stable `views.js` entry. L1 parses the packaged
entry and requires the named export. The packaged L2 harness then calls the same production boot
path and requires all five views to settle.

### CSS is part of `views.js`

The webview HTML contains one module script and no stylesheet link. The views build therefore emits
one stylesheet with `cssCodeSplit: false`, and
[`inline-css.mjs`](../../../../build/vite/inline-css.mjs) removes that asset and appends a marked
runtime style insertion to `views.js`.

The CSP does not allow `data:` in `font-src`. `assetsInlineLimit: 0` keeps fonts as files, and the
CSS plugin rewrites their URLs relative to `import.meta.url`. L1 checks literal asset targets. L2
checks computed styles, font requests, CSP errors, and a control page where the marked bundle CSS is
removed.

### Resource URLs are chunk-relative

`base: './'` makes chunks, preloads, workers, and assets resolve against the importing module's
resource URL. A root-relative base would resolve against the `vscode-webview://` document and miss
packaged resources.

L1 resolves packaged literal imports and `new URL(..., import.meta.url)` targets. Packaged L2 serves
under a non-root prefix so root-relative mistakes fail instead of being hidden by the harness.

### Code-splitting groups run from most shared to least shared

The views entry loads React and Fluent UI. Monaco and SlickGrid must remain behind the lazy views that
use them. Rolldown recursively captures dependencies of a named group, so group priority is part of
the architecture:

1. `preload-helper`
2. `react`
3. `fluentui`
4. `slickgrid`
5. `monaco`

There is no catch-all vendor group. A group shared by the entry and a lazy view could hoist that
view's dependencies into the entry graph. L1 binds every registry-backed lazy chunk and requires
Local Quick Start and Atlas Credentials to exclude Monaco and SlickGrid. L2 records the chunks that
each settled view fetched.

### The extension host is ESM with a thin loader

The manifest declares `"type": "module"` and `"main": "./main.mjs"`.
[`main.ts`](../../../../main.ts) starts activation timing, uses top-level
`await import('./src/extension')`, then delegates `activate` and `deactivate`. VS Code cannot call the
exports until that import has evaluated, and the dynamic boundary keeps `mainFileLoad` meaningful.

The host build uses ESM output and `preserveEntrySignatures: 'strict'`. L1 requires the extension
implementation facade to be the loader's direct dynamic child and keeps the Kubernetes SDK outside
the startup static closure. L3 activates an installed VSIX, checks late command registration, and
checks extension logs. It is not a complete workflow test.

### The TypeScript server plugin remains CommonJS

TypeScript loads plugins with `require()` and expects the module itself to be a callable factory.
The host config therefore builds `playgroundTsPlugin.cjs` in a separate Vite environment with
`exports: 'default'`.

VS Code resolves the declared plugin name under `node_modules`, but vsce does not ship that tree.
[`tsPluginStub.ts`](../../../../src/documentdb/playground/tsPluginStub.ts) creates a runtime package
with `type: commonjs` and an `index.cjs` forwarding to the root bundle. L1 requires the root `.cjs`
asset and rejects `import.meta` in CommonJS. Completions and hover still require a real TypeScript
server check.

### Host names are preserved

Host code and dependencies read `constructor.name` for behavior and telemetry. The host and plugin
outputs set `keepNames: true`; the views intentionally do not.

L1 requires a runtime class named `UserCancelledError` in the `main` graph. The
`keepnames-class-name-lost` control rewrites that class as a minifier would and must be rejected.

### Externals are explicit and optional paths stay optional

The host config bundles dependencies by default. `isExternal` allows `vscode`, Node built-ins, and a
reviewed set of optional native, compression, authentication, proxy, certificate, and diagnostic
requests. This preserves guarded loading instead of manufacturing empty bundler stubs.

Do not mark a type-only module external. Do not add a normal dependency merely because a build can
leave it unresolved. L1 validates graph ownership and packaged imports, while L3 covers normal
activation. Optional authentication and proxy behavior need focused installed-VSIX checks.

### CommonJS dependencies receive the same `vscode` mock

Vite's alias reaches transformed ESM, but CommonJS dependencies call `require('vscode')` through
Node. [`test/vitest/setup.ts`](../../../../test/vitest/setup.ts) hooks `Module._load` and returns the
same mock object used by ESM importers.

[`vitest.config.ts`](../../../../vitest.config.ts) pins forked, isolated test files so the loader hook
and require cache are process-local. `src/vscodeMockIdentity.test.ts` guards shared identity and the
known split created by a test-level factory mock.

### Workspace packages ship ESM only

[Decision 0001](./decisions.md#0001-workspace-packages-ship-esm-only) rejects dual ESM and CommonJS
builds. CommonJS consumers can use Node's supported `require(esm)` when the graph has no top-level
await. An unbundled CommonJS VS Code extension loading `@microsoft/vscode-ext-webview/host` must use
`await import()` because VS Code's asynchronous `vscode` loader hook can deadlock synchronous
`require(esm)`.

Packed-package checks scan for top-level await, test both `require()` and `import()`, and make
representative calls through every public entry point. The real-VS-Code unbundled-host probe requires
CommonJS `await import()` and ESM loading to pass, and records synchronous CommonJS `require()` as the
known unsupported case.

### Post-release version bumps are root-only, idempotent, and reviewed

The release-bump workflow checks out `main`, not the release tag or the manually selected ref.
Automatic runs ignore GitHub prereleases and tags that do not match `main`'s package version.
Both automatic and manual runs propose only the next patch's `alpha.0`; they never increment an
existing development version to `alpha.1`. The root manifest and both root lockfile versions must
agree before and after npm runs. Workspace package and dependency versions stay unchanged.

The workflow pushes a version-specific branch and creates or updates an assigned reminder issue
using `GITHUB_TOKEN`, with only contents and issues write permissions. A version marker identifies
the reminder independently of its title or state; closed reminders are reopened on a retry.
REST pagination avoids search-index delays causing duplicate issues. Matching branches are reused
without rewriting commits. Branches with conflicting version content or unrelated changes fail
explicitly instead of being overwritten.

The issue and workflow summary include a formatted old/new version table and prefilled PR link.
A maintainer submits the PR manually and normal PR CI runs; there is no bot PR or automatic CI
dispatch. The prepared branch and link are summarized before the issue API call so they remain
available if issue creation fails, without treating that failure as success. No release is
published or tag modified. The development alpha must be replaced with a numeric release version
before publication. [Decision 0016](./decisions.md#0016-prepare-a-version-branch-and-an-assigned-issue-instead-of-a-bot-pr)
records the policy constraint and operator's approved alternative.

## Change discipline

Change a config and the relevant rationale together. Package before claiming a bundle change works,
then run the checks that discriminate the changed boundary. Never weaken CSP, graph ownership,
identity checks, or an import budget merely to make a build pass. When a new invariant is necessary,
add both the positive check and a negative control that proves the check can fail.
