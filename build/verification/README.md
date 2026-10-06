# Packaged-artifact checks

Stage 0 tooling for the [modernization plan](../../docs/ai-and-plans/modernization/build-and-test-stack.md).
All harness files and bundle reports are excluded from the VSIX.

## Default build and dev loop

`npm run package` and `npm run package-prerelease` use `build-prod`: Vite for the extension host
(`vite.config.ext.mjs`, ES modules plus the CommonJS TS server plugin) and for the webviews.
`npm run build-dev` builds the same combination unminified with source maps, and `npm run watch:ext`
rebuilds the host on change. Vite is the only bundler for both targets; the `bson` identity
probes below also reuse the shipped Vite host environment.

`npm run watch:views` now starts Vite on port 18080 and serves `/views.js` without an existing
`dist/views.js`. No initial views build is needed.
The `watch:views` VS Code task waits for Vite's ready line; its diagnostic pattern intentionally never matches,
because Vite reports development build errors in the browser overlay.

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
enforced by the [size budget](#size-budget-enforced), and the host's kept class names by the
[`keepNames` invariant](#host-class-names-keepnames-review-item-f17). Hard checks cover required
package files and the resolved `package.json` main entry, bundle-report ownership of every packaged
`.js`, `.cjs` and `.mjs` file under `extension/`, the named `render` export,
literal dynamic imports, Vite literal `new URL(..., import.meta.url)`
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

Nonliteral imports fail except for two named, reviewed allowances. `monacoModuleLoaderImports` permits one-expression,
empty-quasi templates wrapping `asBrowserUri(...).toString(...)` calls in Vite-owned
`monaco-<hash>.js` (maximum one) or `editor.worker-<hash>.js` / `json.worker-<hash>.js` (maximum two),
or an Identifier in the Monaco chunk only; both forms must be inside a function.
The identifier's nearest enclosing function/block binding must come from that same member-call chain
in a variable initializer or simple assignment, with no unreviewed writes or shadow bindings,
because our worker entries pass request-handler factories and foreign modules are unused.
Expression-free template strings, also emitted by Vite's minifier, are resolved as literal strings
for imports and URL assets; they do not use this allowlist.

`babelConfigFileImports` permits exactly one import per host-owned `.mjs` chunk reporting
`node_modules/@babel/core/lib/config/files/import.cjs`. In today's build that is
`playgroundWorker.mjs`, alongside Babel's `module-types.js`. The argument must be the sole
identifier parameter of the named `function import_`; its entire body must be
`return import(parameter)`. That function must be assigned to the second CommonJS factory
parameter's `.exports`, as the factory's only statement, inside the `require_import`
declarator's `__commonJSMin`/`__commonJS` call. Other functions, wrappers, arguments, writes,
templates, top-level imports, missing imports and a second matching import fail closed.
Upstream `module-types.js` calls this helper with a `pathToFileURL(filepath).toString() +
"?import"` URL when loading native ESM configuration files; the helper's argument is a
parameter, so L1 validates the exported helper structure rather than claiming interprocedural
URL provenance. Any Babel/bundler shape change requires re-review, not broadening the allowance.

### `bson` identity (runtime)

L1 counts the `node_modules/**/bson/lib/bson.*` modules in each shipped graph. It cannot see a copy
under another path (a dependency that vendors or pre-bundles `bson`), and it only sees the importers
the graph has today. The host Vite config therefore pins `bson` with a `resolve.alias` (`^bson$`)
to the CommonJS entry the driver `require`s. Vite views pin bson's browser entry.
[`bson-identity/check.cjs`](./bson-identity/check.cjs) builds two probe entries with
`vite.config.ext.mjs` (production mode, reusing its `host` environment, root aliases, resolve
settings, externals, defines, and ES output), runs them in Node
and requires every route to `ObjectId` to be one constructor, separately for the `main` and
`playgroundWorker` graphs. Routes: `mongodb`; `bson` from TypeScript compiled like `src/`; `bson`
and `mongodb` from an ES module (as our ESM-only packages would import them); and, in the host, a
value parsed by `@mongodb-js/shell-bson-parser`. `npm run test:verification` runs it together with a
negative control that removes the alias and must fail on the ES-module route. Standalone:

```bash
node build/verification/bson-identity/check.cjs            # identity
node build/verification/bson-identity/check.cjs --prove    # identity, then the alias-removed control
```

It builds and runs probe bundles instead of inspecting the packaged artifact, so it is not part of L1,
which stays offline and build-free for the ADO release build.

The committed [baseline](./baseline.json) uses the operator-approved tolerance: the greater of 10%
or 4 KiB per file (`NOTICE.html` is size-exempt). Added/removed files and size changes beyond
tolerance are informational, with content hashes normalized when pairing renamed assets (numeric
webpack chunks remain distinct). The JSON result includes `manifestReport`: `added`, `removed`,
`sizeChanges`, total `vsixBytes` delta and `graphAssetBytes` sums. A short summary goes to stderr;
stdout stays JSON. `--manifest-report <file>` writes just the report; CI uploads it separately.
GitHub Actions publishes `Bundle-reports-<run_id>` from the package job and
`L1-manifest-report-<run_id>` from L1, including on inspection failure. L1's PR comment reads the
report's `sizeBudget` measurements, not the thin `views.js` entry. Push builds and manual cache
seeding use `{version: 2, vsixSize, graphSizes}` in the existing `build-sizes-<ref>-<sha>` cache;
legacy `{vsixSize, webviewSize}` baselines compare only the VSIX and mark graph deltas unavailable.
The shared [`build-size-report.cjs`](./build-size-report.cjs) formats those measurements and writes
the cache without recalculating graph closures. It is also covered by `test:verification`.
ADO passes `--manifest-report` before signing and stages the L1 JSON with the bundle reports in
its existing OneBranch pipeline artifact, even if inspection fails. See the
[pipeline guide](../../docs/ai-and-plans/modernization/pipelines-readme.md#31-reports-artifacts-and-pr-size-feedback-stage-6)
for job conditions, artifact paths and the merge-ref checkout policy.
The proof has eight original rejection controls (including missing contributed grammar and runtime shell declarations;
the CommonJS `import.meta` control now mutates `playgroundTsPlugin.cjs`)
and one positive, unrelated README-image asset-change reporting control. Vite adds
`missing-lazy-chunk` (the entry's missing dynamic import fires first),
`monaco-in-local-quick-start`, `duplicate-bson`, `nonliteral-import` and
`allowlisted-shape-at-top-level`. All controls are mandatory.
Report mutations use temporary copies, never the supplied reports.
Seven host controls additionally reject `missing-host-lazy-chunk`, `duplicate-host-bson`,
`missing-ts-plugin`, `second-babel-nonliteral-import`, `kubernetes-in-main-static-closure`,
`kubernetes-in-extension-static-closure` and `missing-extension-implementation-boundary`.
Host controls refresh copied hashes to model matching newly built output and assert the intended
diagnostic, not a stale-report failure. Stage 6 adds `keepnames-class-name-lost` to the host
controls and two size-budget controls (below). The proof prints 24 PASS lines in total.
Proof variants are written with deflated entries, so their VSIX size stays comparable to `vsce`
output and within the `vsix` budget.
Review intentional artifact changes before regenerating the version-1 baseline (its format is unchanged):

```bash
node build/verification/inspect.cjs <vsix> --write-baseline build/verification/baseline.json
```

### Size budget (enforced)

Unlike the per-file manifest report, the [size budget](./size-budget.json) is a hard failure, and
`verify:vsix` enforces it by default (so the GitHub Actions and ADO inspection steps run it). It
budgets the packaged bytes of whole graphs, not single files. Every counted file must be owned by
the bundle report its graph comes from, and L1 checks those reports' hashes against the packaged
bytes, so the sizes are those of the files inside the VSIX:

| Graph                                                                                       | Files counted                                                                                                                                  |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `main`                                                                                      | the `main.mjs` loader and every host chunk reachable through `imports` and `dynamicImports`                                                    |
| `mainStartup`                                                                               | the imports-only closure of `main.mjs` plus the awaited `./src/extension.ts` implementation chunk (the Kubernetes invariant's startup closure) |
| `playgroundWorker`                                                                          | `playgroundWorker.mjs` and everything it reaches, static and dynamic                                                                           |
| `playgroundTsPlugin`                                                                        | `playgroundTsPlugin.cjs` and its static closure                                                                                                |
| `viewsEntry`                                                                                | `views.js` and its static import closure                                                                                                       |
| `collectionView`, `documentView`, `localQuickStart`, `atlasCredentials`, `clusterDashboard` | the per-view graph above: the `views.js` static closure plus the view's lazy chunk and its static closure                                      |
| `editorWorker`, `jsonWorker`                                                                | each Monaco worker script (`<name>.worker-<hash>.js`, self-contained classic scripts)                                                          |
| `vsix`                                                                                      | the compressed VSIX file                                                                                                                       |

A graph fails when it exceeds its budget by more than the tolerance, **10% or 4 KiB, whichever is
greater** (a coordinator decision for Stage 6, mirroring the operator-approved per-file tolerance).
Decreases never fail; a graph more than the tolerance below its budget prints a note suggesting an
update. A graph in the budget but not in the artifact, or in the artifact but not in the budget, also
fails, so a renamed or added view, worker or host entry cannot escape the budget. The budget is
checked after every other invariant, so an invariant failure is always reported first. ADO's
regenerated `NOTICE.html` is larger than the committed copy; compressed, the difference stays well
inside the `vsix` tolerance.

`verify:vsix` prints a table (graph, bytes, budget, limit, delta, status) to stderr. The JSON from
`--manifest-report <file>` (and `manifestReport` on stdout) includes it as `sizeBudget`:
`enforced`, `tolerance`, `graphs` (`graph`, `bytes`, `budgetBytes`, `limitBytes`, `deltaBytes`,
`status`: `ok`, `below`, `over`, `missing` or `unbudgeted`), `failures` and `notes`. On a budget
failure the report and table are still written before the command exits non-zero.
`--size-budget <file>` checks against another budget file.

Update the budget only for an intended size change, from a fresh `npm run package`, and commit it
with the change that caused it. Writing never runs implicitly; it still runs every invariant, but
does not enforce the budget it replaces, and keeps that file's tolerance:

```bash
npm run verify:vsix -- vscode-documentdb-0.11.0.vsix --write-size-budget            # build/verification/size-budget.json
npm run verify:vsix -- vscode-documentdb-0.11.0.vsix --write-size-budget <file>     # another path
```

Proof controls: `size-budget-collection-view` appends a compressible comment past the
`collectionView` limit to the Collection View lazy chunk, and `size-budget-host-startup` does the
same to the extension implementation chunk. Both refresh the copied host and views reports' hashes
and chunk sizes, and require the failure to be the size budget for exactly the expected graphs
(`collectionView`; `main` and `mainStartup`).

### Host class names (`keepNames`, review item F17)

The host build sets Rolldown `output.keepNames: true` because runtime code reads
`constructor.name`: the Query Insights stream path records `err.constructor.name` as the telemetry
`errorKind`, and throws `@microsoft/vscode-azext-utils`' `UserCancelledError` on cancellation (Azure
Identity spans and `getClusterMetadata` read class names too). L1 locates every class in the `main`
graph with a `_isUserCancelledError` member (a property name the minifier does not rename) and
requires its runtime name to be `UserCancelledError`, by JavaScript naming rules: the class's own
name, else the binding an anonymous class expression initialises, overridden by a
`static { __name(this, "...") }` block or a static `name` field. With `keepNames` the packaged chunk
has `var UserCancelledError=class extends Error{_isUserCancelledError=!0;…`; a build without it
emitted `var W=class extends Error{…}` (runtime name `W`), and mangled product classes to
`var ds=class e extends Error`. A missing class also fails, for re-review of `keptClassNames` in
`inspect.cjs`. The `keepnames-class-name-lost` control gives the packaged class the inner name `W`
(as the minifier does without `keepNames`), with matching report hashes. The views build keeps
`keepNames` off (a Stage 4 decision).

Downloaded artifacts need their matching bundle reports, not reports from an unrelated local build.
GitHub Actions uploads them separately; ADO stages `build/verification/reports/*.json` alongside the
release artifacts. Pass `--reports <downloaded-report-directory>` to either inspection or proof
for a downloaded VSIX (both default to `build/verification/reports`).

The [measurements](./measurements.json) record three production builds, three unit-test runs (Jest
at Stage 0; the script now runs Vitest), the median test time, installed package count, and every
measured `dist/` file size. Reproduce them with:

```bash
node build/verification/measure.cjs <output-directory>
```

Production timings now run `npm run build-prod` to measure the shipped Vite host and views build.
New measurements use `buildSeconds` and `build-N.log`. The committed Stage 0 measurements remain
unchanged and readable with their historical `webpackSeconds` key.

Run measurements without concurrent builds or full test suites. They are machine-specific wall
times, not CI performance thresholds.

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
```

[`package-checks/check-packages.mjs`](./package-checks/check-packages.mjs) packs every workspace
into a temp directory outside the repository and, for each tarball, runs:

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
  [`vscode-stub.cjs`](./package-checks/vscode-stub.cjs) and runs the Fluent calls under jsdom.

Expected and enforced: plain Node cannot load `vscode-ext-webview-fluentui` and its `/components`
entry, because of Fluent UI's own packaging (see that package's README), so the Node probes require
exactly that failure. A control run of the Vitest probe without inlining must fail for the same
reason and for the host entry's bare `vscode` import. Rerun this after any change to a package's
`package.json`, `tsconfig` or entry points.
