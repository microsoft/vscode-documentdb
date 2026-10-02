# Packaged-artifact checks

Stage 0 tooling for the [modernization plan](../../docs/ai-and-plans/modernization/build-and-test-stack.md).
All harness files and bundle reports are excluded from the VSIX.

## L1: offline inspection

Production webpack builds generate hash-bound reports in `reports/`. Enable the optional visual
analyzer with `BUNDLE_ANALYZE=true`; it writes `reports/views.html` without starting a server.

After packaging:

```bash
npm run verify:vsix -- vscode-documentdb-0.11.0.vsix
npm run prove:vsix -- vscode-documentdb-0.11.0.vsix
npm run test:verification
```

Inspection checks the exact archive file list, per-file size tolerance, the named `render` export,
literal dynamic imports, webpack lazy-chunk references, development-server strings, and reachable
BSON implementations. Reports must match the packaged JavaScript hashes. Host and playground graphs
require one BSON implementation; browser graphs allow zero because today's webviews do not bundle
BSON, but reject duplicates. Each view records its graph even while the views share one bundle.
Once Stage 4 introduces separate entries, use `--require-lightweight-views` to require Local Quick
Start and Atlas Credentials to exclude Monaco and SlickGrid.

The committed [baseline](./baseline.json) uses the operator-approved tolerance: the greater of 10%
or 4 KiB per file. Added/missing files always fail. Review intentional artifact changes before
regenerating:

```bash
node build/verification/inspect.cjs <vsix> --write-baseline build/verification/baseline.json
```

Downloaded artifacts need their matching bundle reports, not reports from an unrelated local build.
GitHub Actions uploads them separately; ADO stages `build/verification/reports/*.json` alongside the
release artifacts. Pass `--reports <downloaded-report-directory>` when inspecting a downloaded VSIX.

The [measurements](./measurements.json) record three production builds, three unit-test runs (Jest
at Stage 0; the script now runs Vitest), the median test time, installed package count, and every
measured `dist/` file size. Reproduce them with:

```bash
node build/verification/measure.cjs <output-directory>
```

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
Stop the server after verification.

This is not a real `vscode-webview://` test, an extension-host E2E suite, or proof of backend behavior.

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
