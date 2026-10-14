# Packaged-artifact checks

Stage 0 tooling for the [modernization plan](../../docs/ai-and-plans/modernization/build-and-test-stack.md).
All harness files and bundle reports are excluded from the VSIX.

## Default build and dev loop

`npm run package` and `npm run package-prerelease` use `build-prod`: Vite for the extension host
(`vite.config.ext.mjs`, ES modules plus the CommonJS TS server plugin) and for the webviews.
`npm run build-dev` builds the same combination unminified with source maps, and `npm run watch:ext`
rebuilds the host on change. Vite is the only bundler for both targets; the `bson` identity
probes below also reuse the shipped Vite host environment.
See the [Vite build rationale](../vite/README.md) for why each non-obvious setting exists and which
checks guard it.

`npm run watch:views` now starts Vite on port 18080 and serves `/views.js` without an existing
`dist/views.js`. No initial views build is needed.
The `watch:views` VS Code task waits for Vite's ready line; its diagnostic pattern intentionally never matches,
because Vite reports development build errors in the browser overlay.

## CI

`.github/workflows/main.yml` runs these checks in tiers
([decision 0002](../../docs/ai-and-plans/modernization/decisions.md)). Its `plan` job picks the
tier, and the path-scoped checks from the whole PR diff (for a push, the pushed range).

| Check                                                                 | Fast (draft PR) | Standard (ready PR, push to `main` or `release/**`)                    | Full (`ci:full-requested` label) |
| --------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------- | -------------------------------- |
| L0: build, `l10n:check`, lint, Prettier, type checks, unit tests      | yes             | yes                                                                    | yes                              |
| `verify:packages`                                                     | no              | when `packages/**` changes                                             | yes                              |
| Package the VSIX, `verify:vsix` (L1) with sizes, `test:vsix` (L3)     | no              | yes                                                                    | yes                              |
| `prove:vsix`, `test:verification`, `prove:activation` (decision 0003) | no              | when `build/verification/**`, `build/vite/**` or a Vite config changes | yes                              |
| `probe:host-unbundled`                                                | no              | when `packages/vscode-ext-webview/**` changes                          | yes                              |

`package-lock.json` and `main.yml` count as changes for every path-scoped check. Any other label
runs nothing. A manual run is full with `enforce_full_run`, fast without it.

Same-repository PRs get one `<!-- ci-report -->` comment, updated in place and composed by
[`ci-report.cjs`](./ci-report.cjs): every layer with its result or the reason it was skipped, then
code quality and the [build size section](#size-report-warning-only). Adding `ci:full-requested`
starts one full run on the current commit; the workflow removes the label, and the comment keeps
the last full run's commit and result.

## L1: offline inspection

Production Vite host and views builds generate hash-bound reports in `reports/` (`host.json`
covers `main.mjs`, `playgroundWorker.mjs`, their chunks and `playgroundTsPlugin.cjs`).

After packaging:

```bash
npm run verify:vsix -- vscode-documentdb-0.11.0.vsix --manifest-report l1-manifest-report.json
npm run prove:vsix -- vscode-documentdb-0.11.0.vsix
npm run test:verification
```

Inspection reports archive file-list and per-file size drift without failing; per-graph sizes are
measured for the [size report](#size-report-warning-only), which only warns, and the host's kept class names are enforced by the
[`keepNames` invariant](#host-class-names-keepnames-review-item-f17). Hard checks cover required
package files and the resolved `package.json` main entry, exactly one owning bundle report for every packaged
`.js`, `.cjs` and `.mjs` file under `extension/` (two reports binding the same script are ambiguous; the owner decides
host-only runtime imports and the import budget), the named `render` export,
literal dynamic imports, a budget for nonliteral ones, Vite literal `new URL(..., import.meta.url)`
assets (fonts and workers), development-server strings, `import.meta` in
CommonJS bundles (including `.cjs`), and reachable BSON implementations. Reports must match the packaged JavaScript
hashes and record each compilation's `chunkFormat`. `.mjs` files are ES modules; `.cjs` files
(including `playgroundTsPlugin.cjs`) are CommonJS even in the combined host report and reject
`import.meta`, which a `require` cannot load. Host `main` and `playgroundWorker` graphs include
the entry plus all chunks reachable through both `imports` and `dynamicImports`: the thin
`main.mjs` loader dynamically imports the extension implementation. Runtime externals (Node
built-ins and `vscode`) are not packaged chunks; every other graph edge must exist in the report
and VSIX. These two graphs require exactly one BSON implementation; the TS plugin graph permits
zero or one, never duplicates. Every host graph chunk must have an `assetHashes` entry in the
host report itself; ownership by a views report cannot substitute for host provenance.
Non-Vite host and views reports fail with a regenerate message.
The union of the `main` and awaited extension implementation static closures (imports only)
must exclude `@kubernetes/client-node`, preserving its dynamic discovery boundary. The
implementation must be the unique chunk with `facadeModuleId: './src/extension.ts'` and appear
in `main`'s `dynamicImports`; a missing or changed boundary fails closed. This invariant does
not follow dynamic children of the implementation, where lazy discovery legitimately loads the
SDK. Full-VSIX negative controls cover eager SDK edges from both the loader and implementation
(the latter mutates packaged bytes and matching report edges, hashes and sizes), and a missing
implementation facade. Browser graphs allow zero because today's webviews do not bundle
BSON, but reject duplicates. Each views graph is the `views.js` entry's static import closure plus
that view's lazy chunk and its static import closure, never every dynamic child. The lazy chunk's
`facadeModuleId` must match the registry-backed map and appear in the entry's `dynamicImports`.
Local Quick Start and Atlas Credentials must always exclude Monaco and SlickGrid.

The packaged manifest's top-level icon and local file paths under `contributes` are required,
with missing paths reported alongside their JSON pointers; URLs, substitutions and codicons are excluded.
An explicit `runtimeAssets` list also requires shipped files read without manifest declarations
(shell declarations, prompts, runtime icons and Query Insights debug overrides), with a reason per file.
It also records the worker's `extensionPath`-relative `.mjs` entry and the TS plugin's `.cjs` target.
The latter is loaded through a runtime-created
`<ext>/node_modules/documentdb-playground-ts-plugin/{package.json,index.cjs}` stub pointing at
`../../playgroundTsPlugin.cjs`; the stub itself is not a packaged asset.

Literal dynamic imports of Node built-ins (`node:`-prefixed or in `module.builtinModules`) and
`vscode` are accepted only in host-report-owned `.mjs` files. Every other literal import must
resolve to a packaged file, including imports in views and CommonJS files.

A dynamic import whose specifier is not a string (`import(x)`, or a template with an expression)
cannot be resolved offline, so it needs an entry in `nonLiteralImportBudget`: a maximum count and
a reason. L1 counts these imports; it does not match code shapes. An entry names a module ID and
applies to the packaged script whose bundle report chunk lists that module in `moduleIds`, so it
follows the module across chunk renames and minifier changes. Vite builds the Monaco workers
separately and the views report records them as assets without a chunk, so their entry matches
the packaged name instead, and only for scripts without a chunk. A script's budget is the sum of
its matching entries. A nonliteral import in a script without a budget fails, and so does a count
above the budget. An unused budget does not fail by itself: a dependency that drops a loader is
not a defect, and the budget controls append imports up to one over the budget whatever the
current count. The JSON result's `nonLiteralImports` lists each budgeted script's count and
maximum.

| Entry                                                                      | Maximum | Reason                                                                                                                          |
| -------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `@babel/core/lib/config/files/import.cjs`, today in `playgroundWorker.mjs` | 1       | Babel's loader for native ESM config files; the shell rewriter sets `configFile: false` and `babelrc: false`, so it never runs. |
| `monaco-editor/esm/vs/editor/common/services/editorSimpleWorker.js`        | 1       | Monaco's foreign-module loader, today in `monaco-<hash>.js`; we never create foreign-module workers.                            |
| Scripts named `editor.worker-<hash>.js` or `json.worker-<hash>.js`         | 2       | Monaco's request-handler and foreign-module loaders; our worker entries pass request-handler factories.                         |

When a dependency bump adds a loader, the failure names the script, its count and its budget:
review the new import, then add or raise an entry with its reason. Expression-free template
strings, also emitted by Vite's minifier, are resolved as literal strings for imports and URL
assets; they do not count against the budget.

### `bson` identity (runtime)

L1 counts the `node_modules/**/bson/lib/bson.*` modules in each shipped graph. It cannot see a copy
under another path (a dependency that vendors or pre-bundles `bson`), and it only sees the importers
the graph has today. The host Vite config therefore pins `bson` with a `resolve.alias` (`^bson$`)
to the CommonJS entry the driver `require`s. Vite views pin bson's browser entry.
[`bson-identity/check.cjs`](./bson-identity/check.cjs) builds two probe entries with
`vite.config.ext.mjs` (production mode, reusing its `host` environment, root aliases, resolve
settings, externals, defines, and ES output), runs them in Node
and requires every route to `ObjectId` to be one constructor, separately for the `main` and
`playgroundWorker` graphs. Routes: `mongodb`; `bson` from TypeScript compiled like `src/`; awaited
`import('bson')` and `import('mongodb')`; `bson` and `mongodb` from an ES module (as our ESM-only
packages would import them); and, in the host, a value parsed by `@mongodb-js/shell-bson-parser`.
`npm run test:verification` runs it together with a negative control that removes the alias and
must fail on the ES-module and dynamic-import `bson` routes in both graphs (the TypeScript route
splits too). `--prove` runs that same control with the same expectation (one shared function).
Standalone:

```bash
node build/verification/bson-identity/check.cjs            # identity
node build/verification/bson-identity/check.cjs --prove    # identity, then the alias-removed control
```

[`lowered-import/check.cjs`](./lowered-import/check.cjs) builds the same way (shared
[`vite-host-probe.cjs`](./vite-host-probe.cjs)) a CommonJS module containing azureauth's lowered
`Promise.resolve().then(() => require('@azure/arm-resources-subscriptions'))` and requires the
result to expose `SubscriptionClient` (G5-I01, [Vite rationale](../vite/README.md)). Its negative
control removes the package's CommonJS alias; Rolldown 1.0.3 then emits a call to the ESM
initializer, and the result must be `undefined`. Both run in `npm run test:verification`; add
`--prove` to the standalone command for the control.

These probes build and run bundles instead of inspecting the packaged artifact, so they are not part of L1,
which stays offline and build-free for the ADO release build.

The JSON result includes `manifestReport`: current `vsixBytes.bytes`, `graphAssetBytes` sums,
`graphSizes`, the per-graph measurements below, `graphPackages` and `graphPackagesLimit`. A short summary goes to stderr;
stdout stays JSON. `--manifest-report <file>` writes just the report; CI uploads it separately.
GitHub Actions publishes `Bundle-reports-<run_id>` from the package job and
`L1-manifest-report-<run_id>` from L1, including on inspection failure. The build size section of the
CI report reads the report's `graphSizes`, not the thin `views.js` entry. Push builds and manual cache
seeding use `{version: 3, vsixSize, graphSizes, graphPackages}` in the existing `build-sizes-<ref>-<sha>` cache;
`{version: 2, vsixSize, graphSizes}` entries compare sizes without packages, and
legacy `{vsixSize, webviewSize}` baselines compare only the VSIX and mark graph deltas unavailable.
The shared [`build-size-report.cjs`](./build-size-report.cjs) formats those measurements and writes
the cache without recalculating graph closures. It is also covered by `test:verification`.
ADO passes `--manifest-report` before signing and stages the L1 JSON with the bundle reports in
its existing OneBranch pipeline artifact, even if inspection fails. See the
[pipeline guide](../../docs/ai-and-plans/modernization/pipelines-readme.md#31-reports-artifacts-and-pr-size-feedback-stage-6)
for job conditions, artifact paths and the merge-ref checkout policy.
The proof has eight original rejection controls (including missing contributed grammar and runtime shell declarations;
the CommonJS `import.meta` control now mutates `playgroundTsPlugin.cjs`). Vite adds
`missing-lazy-chunk` (the entry's missing dynamic import fires first),
`monaco-in-local-quick-start`, `duplicate-bson` and `nonliteral-import`. All controls are mandatory.
Report mutations use temporary copies, never the supplied reports.
Six host controls additionally reject `missing-host-lazy-chunk`, `duplicate-host-bson`,
`missing-ts-plugin`, `kubernetes-in-main-static-closure`,
`kubernetes-in-extension-static-closure` and `missing-extension-implementation-boundary`.
Host controls refresh copied hashes to model matching newly built output and assert the intended
diagnostic, not a stale-report failure. Stage 6 adds `keepnames-class-name-lost` to the host
controls. Stage 8 adds `ambiguous-script-owner`, which copies
`views.js`'s entry into the host report and requires the single-owner rejection. Stage 8.5
replaces the import shape allowlists with the budget and retires their controls,
`second-babel-nonliteral-import` (a second copy of Babel's exact factory shape) and
`allowlisted-shape-at-top-level` (the Monaco loader shape outside a function), because those
shape rules no longer exist. Four budget controls replace them: `babel-chunk-over-import-budget`
(host), `monaco-chunk-over-import-budget` and `monaco-worker-over-import-budget` each append
imports until the script is one over its budget, and `import-budget-module-absent` drops the
Monaco loader's module ID from its chunk in a copied views report and requires the unbudgeted
rejection. The proof prints 24 PASS lines in total.
The unrelated README-image asset-change reporting control was retired because the Stage 0
manifest-drift report it exercised no longer exists, and the three Stage 6 size-budget controls
(`size-budget-collection-view`, `size-budget-host-startup`, `size-budget-views-assets`) were retired
with the size budget (G8 item 22).
Proof variants are written with deflated entries, so their VSIX size stays comparable to `vsce`
output.

### Size report (warning only)

L1 measures the packaged bytes of whole graphs, not single files, and no size ever fails a check
(operator decision, G8 item 22). Every counted file must still be owned by the bundle report its
graph comes from, and L1 checks those reports' hashes against the packaged bytes, so the sizes are
those of the files inside the VSIX. `manifestReport.graphSizes` holds one byte count per graph:

| Graph                                                                                       | Files counted                                                                                                                                  |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `main`                                                                                      | the `main.mjs` loader and every host chunk reachable through `imports` and `dynamicImports`                                                    |
| `mainStartup`                                                                               | the imports-only closure of `main.mjs` plus the awaited `./src/extension.ts` implementation chunk (the Kubernetes invariant's startup closure) |
| `playgroundWorker`                                                                          | `playgroundWorker.mjs` and everything it reaches, static and dynamic                                                                           |
| `playgroundTsPlugin`                                                                        | `playgroundTsPlugin.cjs` and its static closure                                                                                                |
| `viewsEntry`                                                                                | `views.js` and its static import closure                                                                                                       |
| `viewsAssets`                                                                               | every non-JavaScript asset owned by the views bundle report (fonts, CSS and future CSS-linked resources), counted once                         |
| `collectionView`, `documentView`, `localQuickStart`, `atlasCredentials`, `clusterDashboard` | JavaScript closures only: the `views.js` static closure plus the view's lazy chunk and its static closure                                      |
| `editorWorker`, `jsonWorker`                                                                | each Monaco worker script (`<name>.worker-<hash>.js`, self-contained classic scripts)                                                          |
| `vsix`                                                                                      | the compressed VSIX file                                                                                                                       |

On same-repository PRs, L1 compares these sizes with the base branch's cached sizes and flags a
graph that changed by **at least 5% of its base or at least 50 KiB** (`SIZE_CHANGE_FRACTION`
and `SIZE_CHANGE_BYTES` in [`build-size-report.cjs`](./build-size-report.cjs)). L1 writes the
build size section to its job summary and hands it to the `<!-- ci-report -->` comment
([CI](#ci)). Every delta carries ⬆️ (growth), ⬇️ (reduction) or ✅ (no change). The section is:

- one line when nothing was flagged, with the VSIX size;
- otherwise a table of the flagged graphs only (human-readable sizes and percentages), growth also
  marked ⚠️, decreases listed without it, one line per flagged graph naming its three biggest package
  changes when the base has package data (below), and a pointer to the bundle reports;
- an explicit "No size data for `<base>` yet; sizes only." when the base has no cache entry, and a
  VSIX-only comparison for a legacy `{vsixSize, webviewSize}` entry;
- always, every graph in exact bytes inside a collapsed `<details>` block, with the artifact links.

Rows list the pages (`collectionView`, `documentView`, `localQuickStart`, `atlasCredentials`,
`clusterDashboard`), activation (`mainStartup`), `main`, `playgroundWorker` and `vsix` first, then
the other graphs. Each flagged growth also emits a GitHub warning annotation, so it shows in the
checks UI. Shared chunks count in every graph that loads them, so rows do not add up.

To show why a graph moved, the bundle reports record each chunk's `moduleBytes` (Rolldown's
`renderedLength` per module, before minification), and L1 sums them per npm package, `src/<folder>`
or `packages/<name>` into `manifestReport.graphPackages` (each graph's 60 largest packages, the
rest as `(other)`; graphs without chunks are omitted; the 60 is `graphPackagesLimit`). Under a
flagged graph, the comment lists the three packages that changed most (at least 1 KiB, approximate
because unminified). A package tracked on one side only is marked "entered top 60" or "left top
60", with its delta when the other side has no `(other)`, otherwise its size where tracked; one
italic note then says this can mean crossing the line rather than being added or removed. A v2
base gives no package line.
For more detail, compare the chunks' `bytes`, `moduleIds` and `moduleBytes` in `host.json` and
`views.json` from `Bundle-reports-<run_id>` of the PR run and of a base build.

### Host class names (`keepNames`, review item F17)

The host build sets Rolldown `output.keepNames: true` because runtime code reads
`constructor.name`: the Query Insights stream path records `err.constructor.name` as the telemetry
`errorKind`, and throws `@microsoft/vscode-azext-utils`' `UserCancelledError` on cancellation (Azure
Identity spans and `getClusterMetadata` read class names too). L1 requires a class whose runtime
name is `UserCancelledError` somewhere in the `main` graph: the class's own name, else the
variable an anonymous class expression initialises, or Rolldown's `static { __name(this, "...") }`
block when it had to rename the binding. With `keepNames` the packaged chunk has
`var UserCancelledError=class extends Error{_isUserCancelledError=!0;…`; a build without it emits
`var W=class extends Error{…}` (checked again in Stage 8.5). The name still appears in that build,
as an export alias, a destructured import and telemetry strings, so L1 looks for the class, not the
text. The `keepnames-class-name-lost` control renames `UserCancelledError` throughout the main
graph, as the minifier does without `keepNames`, with matching report hashes. The views build keeps
`keepNames` off (a Stage 4 decision).

Downloaded artifacts need their matching bundle reports, not reports from an unrelated local build.
GitHub Actions uploads them separately; ADO stages `build/verification/reports/*.json` alongside the
release artifacts. Pass `--reports <downloaded-report-directory>` to either inspection or proof
for a downloaded VSIX (both default to `build/verification/reports`).

## L2: production webviews in the integrated browser

```bash
npm run prepare:browser-check -- --vsix <vsix> --output <fresh-directory> --port 18084
npm run serve:browser-check -- --output <fresh-directory> --port 18084
```

Pages are served under `/stage0/l2/`, with no query strings. Generation extracts the VSIX and reuses
the host's production HTML template, including its CSP and boot script. Typed fixtures respond to
known tRPC calls; unknown paths are errors rather than success-shaped defaults.

The browser-only [fixture core](./browser/core/) is shared with L2-dev. It exports router-typed
fixture paths, inferred inputs/outputs, response contracts and `fakeVsCodeApi(rpc, errors)`.
The factory returns a single-acquire VS Code API and exposes every procedure's `{ path, type, input }`
on `window.__harnessCalls`; abort/stop control messages are not procedure calls. Escaping actions
(URL opening, copying, opening a connection) are recorded and require explicit response fixtures,
never performed. L2 retains its unique, ordered `rpcPaths` report derived from this log.
`harness.ts` uses `transpileModule` to inline the core's modules into the existing classic
`runtime.js`, with a small closed module lookup that rejects unexpected imports. This installs the
API synchronously before the unchanged production boot module, adds no network requests, and needs
neither `eval` nor CSP/chunk-check exceptions. The source modules remain plain ESM TypeScript with
type-only app/protocol imports, so the Vite dev server can load the same core directly.

Open `/stage0/l2/pages/collectionView.html` in the integrated browser, then run this Playwright tool
snippet:

```javascript
const source = await page.evaluate(async () => {
    const response = await fetch('/stage0/l2/integrated-all-checks.js');
    if (!response.ok) throw new Error('Cannot load L2 helper');
    return response.text();
});
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
return await new AsyncFunction('page', source)(page);
```

The helper executes outside the page and does not weaken its CSP. It checks all five settled views,
computed styles, diagnostics, network responses, fetched chunks, and actual editor-originated worker
round-trips in both Monaco views. The helper edits the rendered editor and correlates a response with
that editor's synchronized model: Unicode highlighting for Collection View, and JSON validation with
diagnostics for Document View. Collection View's custom query validator runs on the main thread and
is not counted as worker proof. A sixth page deliberately drops CSS; its style checks
must fail while its other diagnostics remain clean. Reports are persisted in the generated output.
Generation requires Vite's `data-documentdb-views-css` marker in the extracted `views.js`: the negative
page removes only that marked bundle stylesheet (including late insertions), preserves Fluent/Griffel
runtime styles, and fails if no marked stylesheet was removed. An unmarked entry is rejected,
including a single-file entry; there is no all-style removal fallback.
The helper starts each check from `about:blank`, so requests left over from the previous page are not counted, and it polls readiness through `page.evaluate`, so it also runs from a plain Playwright page without `unsafe-eval`. Stop the server after verification.

This is not a real `vscode-webview://` test, an extension-host E2E suite, or proof of backend behavior.

## L2-dev: source scenarios

Start `npm run watch:views` and open `http://localhost:18080/scenarios/` (127.0.0.1 also works).
L2-dev must listen on port 18080: `vite.config.views.mjs` fixes `server.origin` to
`http://localhost:18080` for the development CSP, so Monaco worker URLs still point there if Vite
switches ports, and the Collection View and Document View routes fail with
"Could not create web worker(s)" unless another server supplies those workers on port 18080.
The serve-only [Vite plugin](../vite/webview-scenarios.mjs) lists every
`/<view>/<scenario>/<theme>` route; unknown routes return 404 with that list.
No scenario or helper URL uses query strings, which remote port forwarding mangles.
Nothing is added to production bundles or the packaged-VSIX L2 gate.

[Scenarios](./browser/scenarios.ts) import all five L2 fixtures as `default`, plus nine Local Quick
Start states: `introduction`, `configure`, `provisioning`, `success`, `failed-port-in-use`,
`failed-timeout`, and `docker-missing-windows`, `docker-missing-mac`, `docker-missing-linux`.
Every state has dark, light and high-contrast routes. The shared core's `TypedRpcFixtures` checks
procedure paths **and outputs**, including subscription items; escaping actions are only recorded.
Docker install assertions check exactly one `common.openUrl` call and its platform-specific URL.

With a Playwright `page` already on the dev-server origin, execute this snippet **outside the page**:

```javascript
const source = await page.evaluate(async () => {
    const response = await fetch('/scenarios/run-all.js');
    if (!response.ok) throw new Error('Cannot load L2-dev helper');
    return response.text();
});
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
return await new AsyncFunction('page', source)(page);
```

Use `/scenarios/run-all/localQuickStart.js` for one view, or
`/scenarios/run-all/localQuickStart/dark.js` for one view/theme. Each route starts from `about:blank`.
The helper drives the scenario's typed click/fill steps, polls `data-ready` with `page.evaluate`
(not CSP-blocked `waitForFunction`), runs assertions, and returns JSON with `route`, `ready`,
`errors`, `assertions` and `calls` (`window.__harnessCalls`). A route with steps initially shows its
entry state: drive `window.__scenario.data.steps` manually or use the helper to reach the named state.
Readiness checks visible content/selectors and no visible progressbar except in `provisioning`.
The page keeps monitoring after ready: any console error/warning, page error, unhandled rejection,
CSP violation or unknown RPC fails it (`data-ready="failed"`, reasons in `window.__harnessErrors`).
Assertion failures remain separate from readiness failures.

Themes are representative palettes, not live VS Code values. The boot mirrors the host's encoded
config, l10n and view type, and permits the configured Vite origin under a dev CSP (no unsafe-eval).
This is not proof of a real `vscode-webview://` origin, backend behavior or production worker
bundling; keep L2 for those packaged-asset checks. Screenshots are artifacts only, never baselines.
Stop the dev server when done.

## L3: installed-VSIX activation

```bash
npm run test:vsix -- <vsix>
npm run prove:activation -- <vsix>
```

GitHub Actions runs these under Xvfb and caches `.vscode-test/`. The isolated ADO build runs only L1
before signing; it must not download VS Code. Local L3 requires a display or operator-provided Xvfb.
The operator must still complete G0 using the installed production VSIX.

## Workspace packages: packed-tarball checks

Stage 3 made the six workspace packages ESM-only. These checks run on what `npm pack` produces,
not on the workspace sources:

```bash
npm run verify:packages                      # builds the workspaces first
npm run verify:packages -- --no-build --keep --report <file.json>
npm run verify:packages -- --archives <dir-or-.tgz> [--archives ...]   # offline, already packed
```

[`package-checks/check-packages.mjs`](./package-checks/check-packages.mjs) packs every workspace
into a temp directory outside the repository and, for each tarball, prints its file name and
SHA-256 and runs:

- a fail-closed check rejecting every `*.test.*` and `*.spec.*` file, including declarations and
  source maps left by older incremental builds. A packed fixture with a planted `dist/x.test.js`
  must be rejected for exactly this reason; builds do not clean composite `dist` output;
- a check that every `main`, `types`, `bin` and `exports` target in the packed `package.json` is in
  the tarball (`*` subpaths must match a file), and every `files` entry packed something
  ([`package-targets.cjs`](./package-checks/package-targets.cjs));
- `publint --strict` and `@arethetypeswrong/cli` (pinned versions, through `npx`; they are not
  dependencies). The only accepted ATTW finding is `CJSResolvesToESM` for TypeScript's node16
  CommonJS resolution, which is inherent to an ESM-only package; the CommonJS probe below shows
  that Node's `require(esm)` loads it;
- a top-level-await scan of every shipped `.js` file
  ([`top-level-await.mjs`](./package-checks/top-level-await.mjs)), because `require(esm)` rejects a
  graph that contains one;
- a CommonJS probe (`require()`), an ESM probe (`import()`) and a Vitest probe, in throwaway
  consumer projects that unpack the tarballs into `node_modules` and link every other dependency
  from this repository's `node_modules` (no network). Each probe makes the representative calls in
  [`calls.mjs`](./package-checks/calls.mjs) on every entry point, for example reading the shell API
  `.d.ts`, analysing a document with driver `bson` values, and a tRPC round trip between
  `vscode-ext-webview/webview` and `/host`. The Vitest probe aliases `vscode` to
  [`vscode-stub.cjs`](./package-checks/vscode-stub.cjs) and runs the Fluent calls under jsdom. A
  package with no calls in `calls.mjs` fails.

Expected and enforced: plain Node cannot load `vscode-ext-webview-fluentui` and its `/components`
entry, because of Fluent UI's own packaging (see that package's README), so the Node probes require
exactly that failure. A control run of the Vitest probe without inlining must fail for the same
reason and for the host entry's bare `vscode` import. Rerun this after any change to a package's
`package.json`, `tsconfig` or entry points.

**Archive mode (offline).** `--archives <dir-or-.tgz>` (repeatable; a directory means every `.tgz`
in it) checks tarballs that were already packed, instead of building and packing. It never runs
npm, npx or any tool other than Node, and reads the tarballs with
[`tarball.cjs`](./package-checks/tarball.cjs) rather than `tar`, so it works on a network-isolated
Windows agent with only `npm ci` behind it. It runs every check above except `publint` and
`@arethetypeswrong/cli`, which are not in the lockfile, and says so in its output. The probes cover
only the archives' entry points (`PROBE_PACKAGES`); the Vitest control without inlining runs when
both inlined packages are among the archives. The packed-test control writes its tarball directly
instead of running `npm pack`. The output and `--report` record the checkout commit and each
archive's SHA-256. [`package-archives.test.cjs`](./package-checks/package-archives.test.cjs) packs
`vscode-ext-webview` and requires archive mode to pass it, and to reject it with a planted
`dist/host.test.js` and without `dist/host.js` (an `exports` target), each with its own diagnostic.

Where it runs:

| Route                                                                                        | Command                                                    |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| GitHub Actions CI, Package checks job (when `packages/**` changes; full runs; see [CI](#ci)) | `npm run verify:packages` (builds the workspaces first)    |
| `npm-publish-documentdb-js.yml` verify job (`@documentdb-js/*`)                              | `npm run verify:packages`                                  |
| ADO `build-npm-packages.yml` (`@microsoft/vscode-ext-webview*`)                              | archive mode on the `npm-packages` tarballs it just packed |

### Unbundled `vscode-ext-webview/host` in VS Code (S3-F02)

```bash
npm run probe:host-unbundled                 # builds the package first; needs a display (xvfb-run in CI)
npm run probe:host-unbundled -- --no-build --keep --vscode 1.115.0
```

The Node probes above fake `vscode`, so they cannot show whether VS Code resolves the static
`import 'vscode'` in `/host` when another extension loads the package without bundling it.
[`package-checks/unbundled-host-probe.cjs`](./package-checks/unbundled-host-probe.cjs) packs the
package, installs the tarball into throwaway unbundled extensions with `npm install --offline` (the
required peers pinned to this lockfile's tarball URLs), and launches each one as the development
extension of the L3 VS Code (`engines.vscode` minimum, `.vscode-test/` cache, fresh profile). The
probe, in [`package-checks/unbundled-host/`](./package-checks/unbundled-host/), opens and disposes a
real webview through `openWebview`, which uses the package's own `vscode` binding
(`createWebviewPanel`, `Uri.file`, `asWebviewUri`, `EventEmitter`), and checks the tab in the
workbench. Expected and enforced:

| Variant            | How the extension loads `/host`                                  | Expected                                        |
| ------------------ | ---------------------------------------------------------------- | ----------------------------------------------- |
| `commonjs-require` | `require()` from a CommonJS extension                            | hang in `require()`, host reported unresponsive |
| `commonjs-import`  | `await import()` from a CommonJS extension                       | pass                                            |
| `esm-static`       | static `import` from an ES module extension                      | pass                                            |
| `esm-dynamic`      | `await import()` from an ES module extension                     | pass                                            |
| `control`          | `commonjs-import` with `/host` importing `vscode-does-not-exist` | fail at load for that specifier                 |

`require()` deadlocks because VS Code serves `import 'vscode'` from an asynchronous `module.register`
resolve hook that posts to the extension host's main thread and waits, while `require(esm)` blocks
that thread. The probe locates the hang through a trace file (the receipt is never written) and
VS Code's `is unresponsive` message, with a 40-second timeout for that variant. A change in either
direction (for example a VS Code fix that makes `require()` work) fails the run so the package
README and MIGRATION.md can be updated. The whole run takes about 70 seconds; GitHub Actions runs it
in the L3 job when `packages/vscode-ext-webview/**` changes, and in full runs ([CI](#ci)). Linux only so far, one VS Code version per run, and the probe is a development
extension rather than an installed VSIX.
