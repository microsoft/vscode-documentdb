# Packaged-artifact checks

Stage 0 tooling for the [modernization plan](../../docs/ai-and-plans/modernization/build-and-test-stack.md).
All harness files and bundle reports are excluded from the VSIX.

## Default build and dev loop

`npm run package` and `npm run package-prerelease` use `build-prod`: webpack for the extension
host, Vite for the webviews. `npm run build-dev` builds the same combination unminified with source maps.
`webpack-prod` and `webpack-dev` remain all-webpack fallbacks until Stage 6.

`npm run watch:views` now starts Vite on port 18080 and serves `/views.js` without an existing
`dist/views.js`. The Stage 0 advice to run `npm run webpack-dev-wv` once before starting the
views watcher applies only to the `watch:views-webpack` fallback, not the default Vite dev loop.
The VS Code task waits for Vite's ready line; its diagnostic pattern intentionally never matches,
because Vite reports development build errors in the browser overlay.

## L1: offline inspection

Production webpack host and Vite views builds generate hash-bound reports in `reports/`.
The webpack views fallback also generates a report. Enable its optional visual analyzer with
`BUNDLE_ANALYZE=true`; it writes `reports/views.html` without starting a server.

After packaging:

```bash
npm run verify:vsix -- vscode-documentdb-0.11.0.vsix --manifest-report l1-manifest-report.json
npm run prove:vsix -- vscode-documentdb-0.11.0.vsix
npm run test:verification
```

Inspection reports archive file-list and size drift without failing. Hard checks cover required
package files and the resolved `package.json` main entry, bundle-report ownership of every packaged
`.js`, `.cjs` and `.mjs` file under `extension/`, the named `render` export,
literal dynamic imports, webpack-owned lazy-chunk references, Vite literal `new URL(..., import.meta.url)`
assets (fonts and workers), development-server strings, `import.meta` in
CommonJS bundles (including `.cjs`), and reachable BSON implementations. Reports must match the packaged JavaScript
hashes and record each compilation's `chunkFormat`; every JavaScript file of a `commonjs`
compilation (today `main.js`, `playgroundWorker.js`, `playgroundTsPlugin.js` and their chunks) is
parsed and rejected if it contains `import.meta`, which a `require` cannot load (Stage 3 found
webpack leaving `import.meta.dirname` in `main.js`). Host and playground graphs
require one BSON implementation; browser graphs allow zero because today's webviews do not bundle
BSON, but reject duplicates. Webpack views retain the shared `views` entry fallback. With a Vite
views report (`bundler: 'vite'`), each graph is the `views.js` entry's static import closure plus
that view's lazy chunk and its static import closure, never every dynamic child. The lazy chunk's
`facadeModuleId` must match the registry-backed map and appear in the entry's `dynamicImports`.
Local Quick Start and Atlas Credentials must exclude Monaco and SlickGrid by default for Vite;
`--require-lightweight-views` forces the same assertion for webpack.

Nonliteral imports fail except for `monacoModuleLoaderImports`, which permits one-expression,
empty-quasi templates wrapping `asBrowserUri(...).toString(...)` calls in Vite-owned
`monaco-<hash>.js` (maximum one) or `editor.worker-<hash>.js` / `json.worker-<hash>.js` (maximum two),
or an Identifier in the Monaco chunk only, because our worker entries pass request-handler factories
and foreign modules are unused.
Expression-free template strings, also emitted by Vite's minifier, are resolved as literal strings
for imports and URL assets; they do not use this allowlist.

### `bson` identity (runtime)

L1 counts the `node_modules/**/bson/lib/bson.*` modules in each shipped graph. It cannot see a copy
under another path (a dependency that vendors or pre-bundles `bson`), and it only sees the importers
the graph has today. The host webpack config therefore pins `bson` with a `resolve.alias` (`bson$`)
to the CommonJS entry the driver `require`s. Both Vite views and the webpack views fallback pin
bson's browser entry.
[`bson-identity/check.cjs`](./bson-identity/check.cjs) builds two probe entries with the real
`webpack.config.ext.js` (production mode, same aliases, loaders and externals), runs them in Node
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
The proof has six rejection controls and one positive asset-change reporting control. Vite adds
`missing-lazy-chunk` (the entry's missing dynamic import fires first),
`monaco-in-local-quick-start`, `duplicate-bson` and `nonliteral-import`; webpack prints `SKIP` for
these four. Report mutations use temporary copies, never the supplied reports.
Review intentional artifact changes before regenerating the version-1 baseline (its format is unchanged):

```bash
node build/verification/inspect.cjs <vsix> --write-baseline build/verification/baseline.json
```

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

Production timings now run `npm run build-prod` to measure the shipped webpack-host/Vite-views build.
The `webpackSeconds` key and `webpack-N.log` names are retained for comparison with the Stage 0 baseline.

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
Generation detects Vite's `data-documentdb-views-css` marker in the extracted `views.js`: the negative
page removes only that marked bundle stylesheet (including late insertions), preserves Fluent/Griffel
runtime styles, and fails if no marked stylesheet was removed; webpack packages retain all-style removal.
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
