# Modernization Catch-Up: Build, Bundling, and Test Stack

**Research date:** 2026-08-07
**This repo:** `microsoft/vscode-documentdb`, branch `dev/tnaum/modernization`
**Reference repo:** `microsoft/vscode-cosmosdb`, `main` at `4b1bb6c598230a5e22fd4f09934211bdf0572290`

**Companion document:** [`e2e-testing-strategy.md`](./e2e-testing-strategy.md) — deep dive on their
Playwright E2E suite and how it relates to our parked PR #867.

**Re-reviewed:** 2026-09-30 against `vscode-cosmosdb` `main` at `07ac7f86` (84 commits after the
reference commit). The findings and the **sequential execution plan** are in
[Rev 6](#rev-6-2026-09-30-re-review-and-the-sequential-execution-plan) directly below. Where Rev 6
and the older sections disagree on **sequencing or scope**, Rev 6 wins. The measurements in Parts A,
C and I are still the evidence base. Rev 6 refreshes the ones that have gone stale.

---

## Rev 6 (2026-09-30): re-review and the sequential execution plan

**Scope of this iteration:** the build, bundling and unit-test stack, moving our own packages to ESM
(R6.7), stripping the legacy VS Code test harness, and a small **packaged-artifact gate** split
between GitHub Actions and ADO (R6.8). The E2E suite (Playwright against a
real VS Code, and unparking the #867 harness) is **out of scope**. It gets its own iteration after
this one. Phase 4 of the older Sequence table therefore moves out of this plan.

### R6.1 What Cosmos DB changed since the reference commit

Reference commit `4b1bb6c` (2026-08-05), re-checked at `07ac7f86` (2026-09-29). Most of the 84
commits are product fixes. This table lists the ones that touch the stack, the pipeline, or a
failure class the migration could bring back. E2E-only commits are left to the companion document.

| #   | Cosmos DB change                                                                                                                                                                                                                                                                                                                | Source                               | How it differs from our plan                                                                                                                                                                                                 | Action for us                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1  | Adopted **our** `@microsoft/vscode-ext-webview` on `main`. Vite dev still needs `optimizeDeps.include` for three subpaths because the package is CJS                                                                                                                                                                            | #3217 (2026-08-26)                   | H.5 described this as a finding on an unmerged branch. It is now in production on `main`                                                                                                                                     | R13 becomes **ESM-only packages** (R6.7, Stage 3)                                                                                                    |
| N2  | Vitest needs `deps.optimizer.ssr` pre-bundling for `@microsoft/vscode-ext-webview` (root, `/host`, `/react`, `/webview`). The CJS host entry `require`s `vscode`, which bypasses the Vitest alias to the mock                                                                                                                   | `9fb37690`, `vitest.config.ts`       | **New.** The plan assumed the CJS cost only affected the Vite dev server. It affects the test runner too, and we will hit it ourselves in Stage 2                                                                            | Copy Cosmos DB's workaround in Stage 2. Stage 3 ships the package as ESM, which should make it unnecessary; a consumer test in the package proves it |
| N3  | Adopted `@microsoft/vscode-ext-webview-fluentui` 1.1.0. Vitest needs `server.deps.inline` for it: the package is ESM and imports named Fluent exports that resolve to CJS under Node (`Named export 'createDarkTheme' not found`)                                                                                               | `9fb37690`, `e7049bda`               | **New.** The plan predates this package. Our second package has a consumer-side interop cost too, but in the opposite direction                                                                                              | Expect the same `inline` entry in our own Vitest config. Look at whether the package can avoid named imports from Fluent's CJS build                 |
| N4  | Every `.js.map` published in fluentui 1.1.0 points at `src` files that are not in the package. The result is a wall of sourcemap warnings on every Vitest run                                                                                                                                                                   | issue #926 (in this repo)            | **New**                                                                                                                                                                                                                      | Set `inlineSources: true` in all packages (Stage 3)                                                                                                  |
| N5  | The ADO build moved to **`networkisolation: DefaultDeny`** (SFI ES-4.2.4). `npm test` downloads VS Code and installs a Marketplace extension. Both were blocked with `EACCES`, so the step was disabled in ADO. Integration and E2E tests now gate only on GitHub Actions                                                       | #3275, #3278, #3280, #3289           | **New. It directly affects Phase 0a.** The plan assumed the installed-VSIX check could run in any CI. Our `.azure-pipelines/build.yml` still has a `🧪 Test` step that runs `npm test`                                       | Anything that downloads VS Code runs **on GitHub Actions only**. Remove the ADO Test step in Stage 1. Full explanation and split: R6.8               |
| N6  | Dependency bump reverted, then relanded lockfile-only with "feed-safe" versions (past the internal feed quarantine)                                                                                                                                                                                                             | #3272, #3281, #3284                  | **New constraint.** The migration adds many devDependencies (Vite, Vitest, plugin-react, coverage, jsdom). A version newer than the quarantine window breaks the internal build                                              | Choose every new version with the `flagging-fresh-dependencies` skill. Regenerate the lockfile once per stage (repo memory: lockfile discipline)     |
| N7  | Toolchain on `main` now: Vite `~8.0` (Rolldown-based, still configured through `build.rollupOptions.output.manualChunks`), Vitest `~4.1`, `@vitejs/plugin-react` `^6`, `@playwright/test` `~1.61`, `@vscode/test-electron` `~3.0`, **TypeScript `~6.0`** with `module: ESNext` + `moduleResolution: Bundler`, engine `^1.109.0` | `package.json`, `tsconfig.base.json` | The plan did not cover TypeScript. Our `tsconfig.json` is `module: commonjs`, with `baseUrl` and a `"*"` paths mapping, so it is not ready for TS 6/7 defaults                                                               | Switch `tsconfig` to Bundler resolution together with ESM (Stage 5). Bump TypeScript last (Stage 6)                                                  |
| N8  | Webview CSS goes through JS via a ~30-line `vite-plugin-inline-css.mjs`, because the webview HTML has no hook for `<link>` tags                                                                                                                                                                                                 | `plugins/`                           | Confirms #3037 from the other side. **The HTML template is ours:** `WebviewController.getDocumentTemplate` in `packages/vscode-ext-webview` emits one `<script type="module">` that imports `render`, and no stylesheet link | Adopt the inline-css approach in Stage 4. Do not change the package template in this iteration                                                       |
| N9  | Proxy routing now goes through VS Code (`http.proxySupport`) by clearing custom agents, and an isolated proxy/TLS test launcher was added                                                                                                                                                                                       | #3367                                | A product fix that came from a production problem. Not about the stack                                                                                                                                                       | Out of scope. Pass it to the E2E iteration: our Azure and Atlas discovery HTTP calls are the equivalent surface                                      |
| N10 | Fixed an activation race: the external URI handler ran before the Azure Resources API was ready                                                                                                                                                                                                                                 | #3288                                | A product fix, but activation ordering **changes** when the entry becomes an async `main.mjs` loader                                                                                                                         | Add "open a `vscode://` URI on a cold start" to the Stage 5 operator gate                                                                            |
| N11 | `vsce` for signing now comes from the repo-pinned version through `npx`, not a global install                                                                                                                                                                                                                                   | #3286                                | Pipeline hygiene                                                                                                                                                                                                             | Note only                                                                                                                                            |
| N12 | Their pre-ship visual checklist was **removed** from the repo docs as "PR review content"                                                                                                                                                                                                                                       | `e7049bda`                           | Our plan keeps a checklist                                                                                                                                                                                                   | Keep ours, but in this plan and in iteration files, not in user-facing docs                                                                          |

Unrelated production fixes (large JSON freezes #3342, document data loss #3266, tree sorting, NL2Query)
were reviewed and do not affect the stack.

### R6.2 What changed in this repo since the research date

| Plan claim                                                       | Now (measured 2026-09-30)                                                                                                                                                                                                                                                                        | Consequence                                                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| "All six Jest projects use `ts-jest`" (A2, R4)                   | The root `extension` project moved to `@swc/jest` in `95dc1786` (2026-09-14, "reduce Jest memory usage in CI"). The new `extension-webview` (jsdom) project and the five package projects still use `ts-jest`. `maxWorkers: '25%'` is unchanged                                                  | **R4 is half done.** Do not convert the rest to `@swc/jest`: Vitest replaces them in Stage 2                                     |
| Four webviews                                                    | **Five**: `clusterDashboard` was added                                                                                                                                                                                                                                                           | All checks cover five                                                                                                            |
| 110 files, 1,905 `jest.*` call sites, 313 `jest.mock()`          | **293 test files, 2,812 `jest.*` call sites, 448 `jest.mock()`**                                                                                                                                                                                                                                 | **+48 % in seven weeks.** Every week of delay makes the Vitest conversion larger. This argues for Stage 2 early and in one sweep |
| One owned package, CJS                                           | Six workspace packages, all published. Five are CJS (`module: commonjs`): the four `@documentdb-js/*` packages and `vscode-ext-webview` 0.10.1. `vscode-ext-webview-fluentui` 1.1.0 is already ESM. Jest cannot load the ESM one: three Cluster Dashboard tests `jest.mock()` it for that reason | All six move to ESM-only in Stage 3 (R6.7), after Vitest                                                                         |
| `maxChunks: 1`, analyzer commented out, Monaco `['sql', 'json']` | Unchanged                                                                                                                                                                                                                                                                                        | A1 still holds                                                                                                                   |
| Engine `^1.105.0`                                                | Unchanged                                                                                                                                                                                                                                                                                        | Operator decision before Stage 5                                                                                                 |
| `npm test` is a no-op                                            | Unchanged. The ADO `build.yml` still runs it. The GitHub `main.yml` `integration-tests` job has `if: false`                                                                                                                                                                                      | Stage 1                                                                                                                          |
| K.4 #27 `keepNames` "if anything compares `fn.name`"             | `webpack.config.ext.js` already sets Terser `keep_classnames` / `keep_fnames: true`, with a TODO saying "code should not rely on function names"                                                                                                                                                 | Not hypothetical: carry `keepNames: true` into the new host build from day one                                                   |
| K.4 #24 `const enum`                                             | One, local to its module (`SecretIndex` in `connectionStorageService.ts`)                                                                                                                                                                                                                        | Safe under `isolatedModules`. Convert it to a plain object in Stage 1 anyway                                                     |
| K.4 #25 `__dirname`                                              | Three runtime uses: `playground/WorkerSessionManager.ts` (worker path), `playground/tsPlugin/index.ts`, `packages/documentdb-js-shell-api-types/src/index.ts`                                                                                                                                    | All three are about separate entry points or files on disk. Convert them in Stage 5 and verify them in the **packaged** build    |

### R6.3 How we verify automatically: the test levels

The operator's time is the scarce resource. Each stage below states which of these levels the agent
runs by itself, and only what the levels cannot prove goes to an operator gate.

| Level  | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Runs where                                                                                                                             | Catches                                                                                                                                         | Status                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **L0** | `npm run build` (type check), lint, unit tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Agent terminal, all CI                                                                                                                 | Logic and types                                                                                                                                 | Exists                            |
| **L1** | **Artifact inspection** (plain Node script, no UI): unzip the VSIX; diff its file list and sizes against a committed baseline manifest (with a tolerance); assert `views.js` exports `render`; assert every chunk a dynamic import references exists in the VSIX; assert the production bundle contains no dev-server host string (`127.0.0.1:18080`, `DEVSERVER`); from the bundle report, assert the Local Quick Start / Atlas Credentials import graphs do not include the Monaco or SlickGrid chunks                                                                                                                                                                                                                                                                                                                | Agent terminal, GitHub Actions, ADO (no network needed)                                                                                | Missing assets, lost entry export (#3037), build-mode confusion (#3164), splitting regressions, copied-asset bloat (I.3)                        | To build in Stage 0               |
| **L2** | **Production-bundle harness in the integrated browser.** Serve the `dist/` **extracted from the VSIX** with a static server. Generate one HTML page per webview from the **same template** as `WebviewController.getDocumentTemplate`: the same CSP meta tag, with `cspSource` set to the static origin, the same inert-JSON boot script, and a fake `acquireVsCodeApi`. The agent drives it with `open_browser_page`, `read_page` and `run_playwright_code`. For each of the five views, assert: root is not empty; styles are applied (a known Fluent class resolves to a non-default computed style); no `console.error`, `pageerror` or `securitypolicyviolation`; which network requests were made (Local Quick Start must not fetch Monaco/SlickGrid chunks); for Monaco views, a worker constructs without error | Agent (integrated browser); later GitHub Actions headless in the E2E iteration                                                         | Blank render and missing CSS (#3037), CSP violations, lazy-chunk 404s, worker construction failures, per-view bundle leaks                      | To build in Stage 0               |
| **L3** | **Installed-VSIX activation smoke** (the old Phase 0a). `@vscode/test-electron` downloads VS Code and installs our VSIX into a temp `--extensions-dir`. `--extensionDevelopmentPath` points at a tiny **probe** extension, not ours. The probe activates `ms-azuretools.vscode-documentdb`, asserts that a set of commands is registered, and fails on activation errors                                                                                                                                                                                                                                                                                                                                                                                                                                                | GitHub Actions only (N5, R6.8). Locally, it needs a display: **this dev machine has no Xvfb** (checked). The operator installs it once | Entry point, ESM resolution, externals, `__dirname`, native optional dependencies, name-dependent code, telemetry "type: module" breakage (J.7) | To build in Stage 0               |
| **L4** | **The full workbench in the integrated browser via `code serve-web`**. Details under "L4 spike" below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Agent (integrated browser), local only                                                                                                 | The same as the operator checklist, with a real CSP, real theme variables and real host messaging                                               | **Spike, partial.** Not relied on |
| **L5** | Desktop VS Code driven by Playwright `_electron.launch` (Cosmos DB's harness), or attaching over CDP to a running VS Code started with `--remote-debugging-port`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | E2E iteration                                                                                                                          | Everything, including desktop-only behavior                                                                                                     | **Out of scope**                  |

**Build the checks before using them, and prove they can fail.** Stage 0 runs L1 to L3 against
**today's** webpack VSIX, where they must pass. It then runs them once against a deliberately broken
variant, where they must fail. Examples: drop the CSS from the bundle, rename the `render` export,
point a dynamic import at a missing chunk. A check that has never failed has not been shown to work.

**L2 relationship to the existing technique.** [live-preview-playwright.md](../live-preview-playwright.md)
tests individual webviews against the **dev server** bundle with a hand-written shim. L2 is the same
loop aimed at the **production** artifact, with the HTML generated from the real template. It is the
"committed harness" listed in that document's future work. Its gotchas apply unchanged: use one
static page per view (no query strings through the remote port forward), set no viewport before
screenshots, and give a real payload for every tRPC path you answer.

**L4 spike (2026-09-30, exploratory, cleaned up afterwards).** The team has only used the integrated
browser for individual webviews. This spike checked whether it can also host the **entire
workbench**:

- Worked: the standalone CLI (`~/.vscode-server/code-<commit> serve-web --port … --without-connection-token --server-data-dir <tmp> --cli-data-dir <tmp>`)
  downloaded the server. `<cli-data-dir>/serve-web/<commit>/bin/code-server --install-extension <vsix> --extensions-dir <server-data-dir>/extensions`
  installed the packaged DocumentDB 0.10.2 VSIX in isolation. The workbench rendered in the
  integrated browser, and Playwright could drive it: the activity bar, the Extensions view (DocumentDB
  listed as installed on the server), the command palette, dialogs, and the full accessibility tree.
- Did not work yet: the DocumentDB view container did not appear, and its commands were not in the
  palette. The folder opened in **Restricted Mode**, and the machine setting
  `security.workspace.trust.enabled: false` had no effect, since trust is client-side in the web.
  Several built-in web extensions failed with "Not Found" / 403 behind the remote port forward.
- Not verified: webview iframes in VS Code for the Web are expected to load from a `vscode-cdn.net`
  origin, so they would need internet access. [INFERRED]
- Next time-boxed attempt (Stage 0, optional): run on a local, not port-forwarded, machine; try the
  server's `--disable-workspace-trust`, which may not pass through `serve-web` [INFERRED]; then open a
  DocumentDB webview and check that Playwright can reach into its frame through `page.frames()`.
- If this works, it replaces most operator gate items with agent runs. **No stage depends on it.**

**What stays with the operator** in this iteration, because L0 to L3 cannot prove it: real
`vscode-webview://` origin behavior (Monaco workers, `asWebviewUri`); dark and high-contrast themes
in the real workbench; the F5 / watch / HMR developer loop; Windows and macOS packaging; URI-handler
cold start (N10); playground worker and TS plugin in a real editor; Kubernetes and Atlas lazy paths
against real backends.

### R6.4 Legacy VS Code test harness: what to strip (Stage 1)

This repo tests with **Jest only**. The Mocha suite under `test/` came over with the codebase's
history. It was never maintained here, is not in the Jest `testMatch`, and never runs. The intent is
to **drop it**, not migrate it. Its only replacement is L3 (R6.3) now, and the E2E iteration later
(companion document).

| Item                                                                                                                                                                          | What it is                                                                         | Verdict                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `test/improveError.test.ts`, `test/wrapError.test.ts`, `test/util/getIp.test.ts`, `test/util/setEnvironmentVariables.test.ts`                                                 | Mocha `suite`/`test` unit tests of plain utilities, run through `extension.bundle` | Delete. If a utility turns out to have no Jest coverage, write a fresh Jest test for it; do not port the Mocha file                     |
| `test/global.test.ts`, `TestActionContext.ts`, `TestOutputChannel.ts`, `TestUserInput.ts`, `runWithSetting.ts`, `test.code-workspace`, `test/util/setEnvironmentVariables.ts` | Harness for the above. Nothing under `src/` or `packages/` imports them (checked)  | Delete. If `setEnvironmentVariables` is still needed, move it with its test                                                             |
| `extension.bundle.ts`                                                                                                                                                         | Re-export surface "for tests". Only `test/**` imports it                           | Delete                                                                                                                                  |
| `export * from './src/utils/getIp'` at the end of `main.ts`                                                                                                                   | Its comment says it exists for tests not yet moved to Jest                         | Remove                                                                                                                                  |
| `.vscode-test.js`                                                                                                                                                             | `@vscode/test-cli` config. It still installs the retired `ms-vscode.azure-account` | Delete                                                                                                                                  |
| `.vscode/launch.json` "Launch Tests" and "Launch Tests (webpack)"                                                                                                             | Point at `out/test/index` and `dist/test/index`, which do not exist                | Delete                                                                                                                                  |
| `mocha`, `@types/mocha`, `mocha-junit-reporter`, `mocha-multi-reporters`, `eslint-plugin-mocha`, `@vscode/test-cli`                                                           | Used only by the above                                                             | Remove. **Keep** `@vscode/test-electron` for L3. **Keep** `ts-node` (package scripts use it) and `jest-mock-vscode` (unit tests use it) |
| `eslint.config.mjs` Mocha block for `test/**`                                                                                                                                 |                                                                                    | Remove                                                                                                                                  |
| `tsconfig.json` commented `types: ["jest", "mocha", …]` block                                                                                                                 |                                                                                    | Remove                                                                                                                                  |
| `package.json` `test` no-op                                                                                                                                                   |                                                                                    | Point it at the unit tests now. L3 gets its own script (`test:vsix`) in Stage 0                                                         |
| `.azure-pipelines/build.yml` `🧪 Test` step                                                                                                                                   | Runs the no-op                                                                     | Remove (N5: nothing that downloads VS Code belongs in ADO)                                                                              |
| `.azure-pipelines/linux/xvfb.init`                                                                                                                                            | No pipeline references it (checked)                                                | Delete                                                                                                                                  |
| `.github/workflows/main.yml` `integration-tests` job                                                                                                                          | `if: false`, "unreliable, needs revisiting"                                        | Delete. L3 gets a new job in Stage 0                                                                                                    |
| Root `main.js` and the "Launch Extension + Host" config                                                                                                                       | Unbundled dev path that loads `out/src/extension`                                  | **Keep until Stage 5**, where `main.mjs` replaces it                                                                                    |

### R6.5 SlickGrid: what to do first (and why later)

SlickGrid will be replaced in a later iteration. **Do not replace it during this one.** The
migration and the grid swap both change `collectionView`, and doing both at once would make any
regression impossible to attribute (H.6). Doing the swap before Stage 2 would also mean writing its
component tests twice, once in Jest and again in Vitest.

The guidance for the removal itself lives in its own plan:
**[slickgrid-removal.md](./slickgrid-removal.md)** (footprint, behavior contract, pain points,
candidates, and a sequential plan G1 to G6).

The only thing this iteration does for it:

1. **Stage 4: isolate it.** Give `slickgrid-react` (plus `src/webviews/slickgrid.scss`) its own named
   chunk that only `collectionView` loads, the same way Cosmos DB keeps `react-data-grid` out of
   `vendor` (K.1 #3). Record that chunk's size in the L1 baseline, so the replacement's size can be
   measured against it. Watch the ESM interop: `tsconfig.json` carries
   `allowSyntheticDefaultImports` "to fix SlickGrid integration", and that is exactly the kind of
   default-import shim that behaves differently under Vite/Rolldown.

### R6.6 The sequential plan

Each stage is one stretch of autonomous agent work followed by one operator gate. Stages do not
overlap. A stage starts only after the previous gate passes. Every stage ends on a working,
releasable `main`. In every stage the agent follows the repository's verification rules: Case 1 while
working, Case 2 at hand-over.

**Model recommendations** (2026-09-30) open each stage. They are based on GitHub's published model
descriptions and per-token prices
([supported models](https://docs.github.com/en/copilot/reference/ai-models/supported-models),
[comparison](https://docs.github.com/en/copilot/reference/ai-models/model-comparison),
[pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing)), not on
runs in this repo. The rules behind them:

- The author and the reviewer come from **different model families**, so they tend to catch
  different mistakes. This also feeds the repo's AI pre-review (CONTRIBUTING.md §6).
- Bulk work goes to the cheaper, efficient models. Risky module and build work goes to the strongest.
- Keep the default context and reasoning settings. For GPT models, input above 272K tokens is
  billed at about twice the rate.
- Avoid models marked ⚠ in the picker. Claude Opus 4.7 and Gemini 3.5 / 3.6 Flash are retired on
  2026-10-02.
- Re-check this guidance when the model list changes. Stage 0 or Stage 1 is a cheap place to run two
  candidates against each other, because both have a clear pass/fail result.

```mermaid
flowchart LR
    S0[S0 Baseline and checks] --> S1[S1 Strip legacy tests] --> S2[S2 Jest to Vitest] --> S3[S3 Packages to ESM] --> S4[S4 Views to Vite and splitting] --> S5[S5 Host to ESM and Vite] --> S6[S6 Remove webpack, CI gates, TS 6] --> S7[S7 Hand-over to E2E iteration]
```

#### Stage 0: baseline and the verification tooling

- **Models:** author **Claude Opus 5.5**, reviewer **GPT-6 Sol**. Open-ended tool building (VSIX
  inspection, browser harness, VSIX activation check, the `serve-web` follow-up) needs strong
  agentic recovery; GPT-6 Sol is a low-cost reviewer with a published model card. Optional: run the
  L1 script as a head-to-head trial against GPT-6.1 Sol or GPT-6 Astra.
- **Autonomous:** record the baselines on today's stack: `webpack-prod` time (three runs), per-file
  `dist` sizes, VSIX size and file manifest, dependency count, and unit-test wall time (three runs,
  median). Re-enable the bundle analyzer behind `BUNDLE_ANALYZE` (R1). Build L1 (VSIX inspection
  script plus committed baseline manifest), L2 (a production-bundle page per webview, generated from
  the real template) and L3 (`test:vsix`, a probe extension, and a GitHub Actions job with a cached
  `.vscode-test/`). Add L1 to the ADO build **before signing** (R6.8), and a GitHub Actions
  dependency-freshness check ([pipelines-readme.md §2.1](./pipelines-readme.md#21-package-source-public-npmjs-versus-the-internal-feed)).
  Prove each check passes on the
  current VSIX **and fails on a broken variant**.
  Optionally, the time-boxed L4 follow-up.
- **Automated verification:** L0 to L3 green on the current VSIX. The broken variants fail as
  expected.
- **Operator gate G0:** install the current VSIX (not F5) and run the manual checklist once to
  record a baseline (see "Phase 0" below, updated to five webviews). Install Xvfb locally if L3
  should run on the dev machine. Decide whether the L2 harness is committed as dev-only and excluded
  from the VSIX. The expected answer is yes, via `.vscodeignore`.
- **Exit:** baselines are committed in this document, and L1 to L3 run on every PR that touches
  build config.

#### Stage 1: strip the legacy harness

- **Models:** author **Claude Sonnet 5.5**, no model reviewer; the operator reviews the diff (G1).
  Small, mechanical, and easy to check. Opus would be overkill.
- **Autonomous:** everything in R6.4. Before deleting, check whether `improveError`, `wrapError`,
  `getIp` and `setEnvironmentVariables` already have Jest coverage, and add a small Jest test only
  where they have none. Convert the one `const enum`.
- **Automated verification:** L0; L1 (the VSIX manifest must not change except for removed dev-only
  files, of which there should be none); L3.
- **Operator gate G1:** review the dependency and CI diff only. No manual UI check is needed.

#### Stage 2: Jest to Vitest, in one sweep

- **Models:** author **Claude Sonnet 5.5** for the codemod and the bulk sweep (alternative:
  GPT-5.3-Codex). Hand **Claude Opus 5.5** the `vi.hoisted` / mock-hoisting failures and every
  `TDD:` suite. Reviewer **GPT-6 Sol**. Work in batches of test files rather than switching to the
  1M-token context.
- **Why before the bundler:** Vitest does not need Vite as the build bundler. With Vitest in place,
  Stages 3 to 5 have a fast, ESM-native test net, and the bundler change can be told apart from the
  test-runner change (H.6). The test surface is growing about 48 % every seven weeks (R6.2), so later
  costs more.
- **Why before the packages go ESM:** Jest cannot load ESM-only packages without transform
  workarounds. The three Cluster Dashboard tests that `jest.mock()` the fluentui package show it
  (R6.2). Vitest loads them natively.
- **Autonomous:** a codemod for `jest.*` to `vi.*`, then `vi.hoisted` for the hoisting cases (I.4
  predicts some; 448 `jest.mock()` sites). Move the `extension-webview` jsdom project to per-file
  `// @vitest-environment jsdom` (Cosmos DB #3172). Merge the six package projects into one Vitest
  workspace. Copy Cosmos DB's N2 and N3 settings for now; Stage 3 should make them unnecessary.
  Replace the fluentui `jest.mock()` stubs with the real package where the test allows. Remove
  `ts-jest`, `@swc/jest`, `jest`, `jest-environment-jsdom`, and `eslint-plugin-jest` (replace it with
  the Vitest ESLint plugin if one is wanted).
- **Automated verification:** the same test count as before, give or take documented deletions;
  record the wall time against the Stage 0 baseline; L0. The shipped artifact is unchanged, so L1 to
  L3 are a formality.
- **Operator gate G2:** review the list of tests changed beyond mechanical renames. Watch `TDD:`
  suites in particular: per the repo rules, a changed contract needs the operator's decision.

#### Stage 3: our packages to ESM (R6.7, and N1 to N4)

- **Models:** author **Claude Opus 5.5**, reviewer **GPT-6.1 Sol** (or GPT-6 Sol). Module format,
  `exports` maps, `require(esm)` and the duplicate-`bson` risk are subtle, and mistakes only show up
  in consumers.
- **Autonomous:** everything in R6.7, one package per commit, in dependency order. Remove the Stage 2
  N2/N3 workarounds from the Vitest config once the packages load without them.
- **Automated verification:** per package, the consumer smoke tests and `publint` /
  `@arethetypeswrong/cli` on the packed tarball (R6.7); L0; L1 (our `views.js` should shrink a
  little from better tree-shaking, and must not grow); L2; L3. The BSON single-instance check (R6.7)
  must pass.
- **Operator gate G3:** decide the version bumps and publish. Publishing is irreversible and helps
  Cosmos DB, but this repo uses the workspace copies, so **no later stage waits on the publish**.

#### Stage 4: webviews to Vite, per-view splitting

- **Models:** author **Claude Opus 5.5**, reviewer **GPT-6 Sol**. Vite config, CSS inlining, workers
  and chunking each have several plausible-but-wrong solutions; the L2 browser checks catch most
  regressions, so a second strong author is not needed.
- **Autonomous:** add `vite.config.views.mjs` **next to** webpack (K.1 #1) and write it to
  `dist/` the same way. Make `WebviewRegistry` lazy (R2). Add `manualChunks` for `monaco-editor`,
  Fluent + Griffel, React, and a separate SlickGrid chunk (R6.5). Add inline-css (N8) and an entry
  plugin that keeps the `render` export (Cosmos DB #3037). Handle Monaco workers in both `serve` and
  `build` (Cosmos DB #3169). Point `watch:views` at Vite. Decide on `sql` in the Monaco language list
  (R5). Flip the default only when every check passes. Keep the webpack views config until Stage 6.
- **Automated verification:** L1 (per-view graphs: Local Quick Start and Atlas Credentials free of
  Monaco and SlickGrid; bundle sizes recorded); **L2 is the main gate here** (all five views
  non-blank, styled, CSP clean, workers constructing); L3.
- **Operator gate G4:** install the packaged VSIX. For all five webviews check the dark,
  light and high-contrast themes, Monaco editing and workers in the real `vscode-webview://` origin,
  and a DevTools console that stays clean. Check that F5 plus watch give a working dev loop with HMR.

#### Stage 5: extension host to ESM and Vite

- **Models:** author **Claude Opus 5.5**; the alternative is a head-to-head trial against **GPT-6
  Astra**, which is positioned for long autonomous runs with independent verification but costs about
  2.5x as much. Whichever writes it, the other reviews. This is the riskiest stage, so it is where a
  more expensive reviewer pays off.
- **Before starting:** the operator confirms the engine floor. Keep `^1.105.0` unless the empirical
  check fails (J.3).
- **Autonomous:** `"type": "module"` (J.7: telemetry breaks without it), a `main.mjs` thin loader,
  `vite.config.ext.mjs` for the three entries (`main`, `playgroundWorker`, `playgroundTsPlugin`),
  audit the 18 externals (J.7 / K.3 #20), convert the three `__dirname` uses, `keepNames: true`, the
  `createRequire` banner for CJS dependencies, a single `bson` instance (R6.7), `tsconfig` on `module: ESNext` + `moduleResolution:
Bundler` without `baseUrl` (N7), and the rules from K.4 #26 to #28 for guarded requires and
  type-only externals. Delete root `main.js` and "Launch Extension + Host". If the host build is
  painful, fall back to esbuild **for the host only** (J.6, option C).
- **Automated verification:** **L3 is the main gate here** (activation, commands, no errors); L1
  (entry files, chunks, externals present or absent as intended); L2 (unchanged views); L0.
- **Operator gate G5:** install the VSIX, then check: activation time against the baseline; a `vscode://`
  URI on a cold start (N10); playground run (worker and TS plugin); Kubernetes discovery (lazy chunk);
  Atlas discovery; Azure discovery; a connection with Kerberos or another native optional dependency
  where one is available; and that telemetry events appear with `DEBUGTELEMETRY`.

#### Stage 6: remove webpack, lock in, TypeScript 6

- **Models:** author **Claude Sonnet 5.5**, reviewer **Claude Opus 5.5**. Mostly deletion, CI wiring
  and docs. Escalate the TypeScript 6 bump to Opus if it surfaces type errors that need judgment.
- **Autonomous:** delete the webpack configs, loaders and plugins, and record the dependency count
  (I.5). Put the CI gates in place per the split in R6.8: the L1 manifest and size budget (with a
  tolerance) in both GitHub Actions and ADO, L3 on GitHub Actions, and the bundle report as a PR
  artifact (K.1 #7). Write the equivalent of Cosmos DB's
  `docs/webview-build.md` (K.1 #8). Then bump TypeScript to 6.x with feed-safe versions (N6).
- **Automated verification:** L0 to L3, plus comparison against the Stage 0 baselines, recorded in
  this document.
- **Operator gate G6:** a full manual pass on the final VSIX, on Windows or macOS as well as Linux.
  This is the release candidate for the stack change.

#### Stage 7: hand-over to the E2E iteration

**Models:** **Claude Sonnet 5.5** to write the hand-over; nothing else is needed.

This stage adds no new work. It lists what the E2E iteration inherits: the L2 harness (to run headless in
CI), L3 (to extend into Extension Host integration tests), the L4 spike notes, N9 (proxy routing)
and N10 (URI activation) as candidate specs, and the companion document.

### R6.7 Our packages to ESM

**Operator direction (2026-09-30):** the packages stayed CommonJS only because the modernization kept
being deferred. They are now in scope.

| Package                                  | Version | Today                                                | Published by                                              | Runs in                                                     | Package-specific work                                                                          |
| ---------------------------------------- | ------- | ---------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `@documentdb-js/operator-registry`       | 0.8.1   | CJS, no `exports` map                                | GitHub `npm-publish-documentdb-js.yml`                    | Extension host (completions)                                | Its scraper script runs on `ts-node`                                                           |
| `@documentdb-js/schema-analyzer`         | 1.0.0   | CJS, no `exports` map; depends on `mongodb`          | GitHub `npm-publish-documentdb-js.yml`                    | Extension host                                              | **BSON single instance** (below)                                                               |
| `@documentdb-js/shell-api-types`         | 0.8.1   | CJS, no `exports` map                                | GitHub `npm-publish-documentdb-js.yml`                    | Extension host, playground TS plugin                        | Reads a `.d.ts` through `__dirname`; its verify script runs on `ts-node`                       |
| `@documentdb-js/shell-runtime`           | 0.8.1   | CJS, no `exports` map; depends on `mongodb`, mongosh | GitHub `npm-publish-documentdb-js.yml`                    | Playground worker thread, interactive shell                 | BSON single instance; the worker is a separate entry point, so verify it in the packaged build |
| `@microsoft/vscode-ext-webview`          | 0.10.1  | CJS, `exports` with `default` only                   | ADO `build-npm-packages.yml` / `release-npm-packages.yml` | Extension host (`/host`) and webview (`/webview`, `/react`) | Removes Cosmos DB's N1 and N2 workarounds                                                      |
| `@microsoft/vscode-ext-webview-fluentui` | 1.1.0   | **Already ESM** (`type: module`)                     | ADO, as above                                             | Webview                                                     | `inlineSources` (N4); check whether named imports from Fluent's CJS build can be avoided (N3)  |

**Recommendation: ESM-only, not dual ESM + CJS.** This replaces R13's "dual build".

- **Dual packages create two module instances, and this repo has already been bitten by that.**
  `bson` ships separate ESM and CJS entries. When both were bundled, `instanceof` failed and the
  schema analyzer classified `ObjectId`, `Double` and `Int32` as plain objects (repo memory
  `bson-dual-package-hazard`). A dual `schema-analyzer` would add a second way to get there.
- **CJS consumers can still load an ESM-only package.** `require(esm)` is unflagged since Node 20.19
  and 22.12, for modules without top-level await. Our `engines.node` is `>=22.18`. Confirm the Node
  version inside the VS Code extension host at our engine floor is at least 22.12. [VERIFY]
- **It removes workarounds on both sides:** Cosmos DB's Vite `optimizeDeps` and Vitest
  `deps.optimizer.ssr` entries (N1, N2), and our own `jest.mock()` stubs of the fluentui package.
- **It improves tree-shaking** of the webview bundle, which is the original R13 argument.

**Work per package** (Stage 3, one package per commit, in dependency order):

1. `"type": "module"`, and an `exports` map with `types` and `default` for every subpath.
2. `tsconfig`: `module` / `moduleResolution` `NodeNext` for the packages that run under Node (the
   four `@documentdb-js/*` packages and `vscode-ext-webview`). `NodeNext` requires `.js` extensions
   on relative imports, which a codemod can add. fluentui is browser-only and keeps `bundler`.
3. `__dirname` -> `import.meta.dirname` (shell-api-types).
4. `inlineSources: true`, so the published sourcemaps work (N4, issue #926).
5. The `ts-node` scripts (operator-registry scraper, shell-api-types verifier) -> Node's built-in
   type stripping, on by default in our Node floor (22.18). Then drop `ts-node`. [VERIFY that the
   scripts use no TypeScript-only runtime syntax, such as `enum` or `namespace`, that stripping
   rejects.]
6. Version bumps, because this breaks CJS consumers on older Node: `schema-analyzer` 2.0.0, the
   0.8.x packages 0.9.0, `vscode-ext-webview` 0.11.0, and fluentui 1.1.1 (sourcemaps only).

**BSON single instance.** `schema-analyzer` and `shell-runtime` depend on `mongodb`, which is CJS and
`require`s the CJS `bson` entry. ESM code importing `bson` gets the ESM entry. In the extension bundle,
that means two `bson` copies and broken `instanceof`. The rules:

- Pin one `bson` entry in every bundler config (webpack until Stage 6, Vite from Stage 4 or 5), with a
  resolve alias.
- Add a unit test that runs the analyzer on documents decoded by `mongodb`'s own `bson`, not
  hand-built ones.
- Make the check in the repo memory part of L1: the packaged bundle contains exactly one `bson`
  module.

**Verification, autonomous:** for each package, pack the tarball and run
[`publint`](https://publint.dev) and [`@arethetypeswrong/cli`](https://github.com/arethetypeswrong/arethetypeswrong.github.io)
on it, then run the consumer smoke tests: `node -e "require('<pkg>')"` (require(esm)),
`node --input-type=module -e "import '<pkg>'"`, a Vitest import (with the `vscode` alias for
`vscode-ext-webview/host`), and the extension's own webpack build. Then L1 to L3 for the extension.
**Operator:** version bumps and publishing (gate G3).

### R6.8 GitHub Actions and ADO: the network isolation problem, and what runs where

The full explanation now lives in its own file, to make it easier to catch up on:
**[pipelines-readme.md](./pipelines-readme.md)**. It covers the inventory of both CI systems, the
feed-quarantine and network-isolation constraints (with Cosmos DB's #3275 to #3289 sequence), the
table of where each check runs, and a short decision list for new checks.

What this plan depends on from it:

- **The split rule.** ADO produces the shipped artifact from vetted inputs, and checks that exact
  artifact with checks that need no network. GitHub Actions runs everything that needs the internet
  or a display, and everything that exists for PR feedback.
- **L1** runs in both pipelines, in ADO before signing, against one committed manifest. **L3** and
  the future E2E suite run on GitHub Actions only. The ADO `🧪 Test` step is removed in Stage 1.
- **A freshness check** on GitHub Actions fails PRs that add a version younger than the feed
  quarantine (N6). The migration adds many devDependencies, so this goes in with Stage 0.
- **A release-checklist step:** run `npm run test:vsix` locally on the ADO-signed VSIX before
  approving `release.yml`.

---

## Executive Summary & Recommendation

> Added after the research was complete, in response to the constraint: _"assume conversion effort
> can be outsourced to efficient coding agents; I want to do this transformation once and be
> future-proof for a while."_ That constraint changes the answer — see the note at the end of
> this section.

### What the measurements say

I rebuilt and ran the reference repo at the commits immediately before and after their migration.

| Question                          | Answer                                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Is Vite's build faster?           | **Yes — 8.95x** (71.5s → 8.0s), identical source. Their published ~8x claim replicates independently. |
| Does it produce a smaller bundle? | **Yes — ~29% less JavaScript** (completeness-adjusted). The one benefit nothing cheaper replicates.   |
| Smaller VSIX?                     | **Only ~6–10%.** Half the package is copied assets, and ZIP compression flattens the rest.            |
| Is Vitest much faster than Jest?  | **The premise is wrong.** ~95% of the speedup is dropping `ts-jest`; Vitest itself contributes ~5%.   |
| Side effect                       | Their dependency count fell **1,385 → 784 packages (−43%)**.                                          |

### Our two problems are unrelated, and only one is about the stack

1. **The 6.4 MB single-chunk `views.js`** is caused by `LimitChunkCountPlugin({ maxChunks: 1 })` in
   our own config. Local Quick Start and Atlas Credentials load Monaco _and_ SlickGrid despite
   importing neither. A disabled Webpack feature, not a Webpack limitation.
2. **The test suite** uses `ts-jest` in all six projects, type-checking in every worker — which is
   why the config caps `maxWorkers: '25%'`.

### Recommendation: do the full migration, with one hard precondition

Target end state: **ESM + Vite (both targets) + Vitest + Playwright + per-view code splitting.**

| Decision                                | Verdict                                         | Reasoning                                                                                                                                              |
| --------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Vite**                                | **Adopt**                                       | Only path to the ~29% output reduction. Sibling team already solved the hard parts. Vite→Rolldown is the ecosystem direction.                          |
| **ESM**                                 | **Adopt**                                       | Required for the Vite extension-host build; the future-proof direction.                                                                                |
| **Vitest**                              | **Adopt — for pipeline unification, not speed** | One config for dev/build/test. Be honest internally that it is not a speed play.                                                                       |
| **Playwright + real integration tests** | **Adopt — but _after_ the migration**           | Getting E2E right is its own project, and building it on the outgoing stack wastes part of it. This is also what they did. Phase 0 covers the interim. |
| **Rspack**                              | **Drop**                                        | It was a hedge against migration _effort_. That constraint is gone.                                                                                    |
| **Oxlint / Oxfmt**                      | **Skip**                                        | Pure churn, no measured pain, a second linter to maintain forever.                                                                                     |

**The precondition — verify the packaged artifact, not the dev build.** Cosmos DB shipped
**four** post-migration fixes: blank packaged webviews, missing CSS, Monaco workers failing under
the dev server, and dev-watch output corrupting E2E. **None are catchable by unit tests**, and
crucially **none are visible in F5 development mode** — which is why one of them survived 18 days.
Manual testing is acceptable at our current surface (four webviews); testing only via F5 is not.

**But "build E2E first" is the wrong conclusion — their own history disproves it.** [MEASURED]
Cosmos DB migrated on `main` (2026-04-30), had production webview rendering broken for **18 days**,
fixed it (2026-05-18), and only built the Playwright suite **three weeks later** (2026-06-10). No
release was tagged in the broken window — the next tags, `v0.32.1`/`v0.32.2`, are dated 2026-05-19,
the day _after_ the fix — and the fix was never backported to a release branch. **Nothing broken
ever shipped.** They caught it without E2E.

So E2E is not the gate. The gate is **verifying the right artifact**. The reason that bug survived
18 days is precise and instructive: PR #3037 is titled _"restore **production** rendering"_ —
dev mode worked fine the whole time. **F5 development testing would not have caught it.**

### Sequence

| Phase                          | Work                                                                                                                                                             | Why here                                                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **0a. VSIX activation check**  | **One automated test**: package → install into a temp extensions dir → launch with **no** `--extensionDevelopmentPath` → assert activation + zero console errors | ~150 lines, bundler-agnostic; nothing in it is invalidated by the migration. Companion document §5.4 and §5.14 |
| **0b. Verification checklist** | A written manual checklist run against a **packaged VSIX**, not F5 (see below)                                                                                   | An hour of work; covers rendering, styling, workers and lazy chunks, which one activation test cannot          |
| **1. Prerequisites**           | ESM-first build for `@microsoft/vscode-ext-webview`; engine-floor decision                                                                                       | We already hit CJS friction with it on the Cosmos DB side.                                                     |
| **2. Migration**               | ESM + Vite (ext + views) + Vitest + per-view lazy loading + `manualChunks`                                                                                       | Coupled; run as one program.                                                                                   |
| **3. Lock in**                 | CI gates on bundle size and activation time                                                                                                                      | Prevents silent regression.                                                                                    |
| **4. Test layers**             | Extension Host integration tests, then Playwright E2E, then unpark the #867 harness                                                                              | Built **on** the new stack, so none of it is throwaway. Mirrors what they did.                                 |

> **Superseded on sequencing by [Rev 6 R6.6](#r66-the-sequential-plan)**, which splits this table
> into eight sequential stages and moves Phase 4 (E2E) into its own iteration.

**Do not** do the Webpack code-splitting fix first. If Vite is the destination, that work is
throwaway — `manualChunks` is the mechanism that survives. The same logic is why the E2E _suite_
belongs in Phase 4: its `globalSetup` build invocation and the #867 harness are both stack-coupled.
**Phase 0a is the deliberate exception** — it asserts on a VSIX rather than on a build config, so it
is the one piece of test infrastructure the migration cannot invalidate.

### Phase 0: the checklist that replaces "build E2E first"

Manual testing is a reasonable call while the surface is four webviews — provided it is written
down and aimed at the right build. Run this **against an installed VSIX** after each migration
step, not against F5. Check 0 is automated (Phase 0a); the rest are manual.

| #   | Check                                                                                                                                        | Failure class it catches                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 0   | **Automated:** install the VSIX, launch without `--extensionDevelopmentPath`, assert activation + a registered command + zero console errors | Everything below that is fatal rather than cosmetic — and it runs on every PR |
| 1   | Install the packaged VSIX; extension activates                                                                                               | Packaging / entry-point / ESM resolution                                      |
| 2   | Open all five webviews (Rev 6); each renders non-blank                                                                                       | Their #3037 — lost entry export in app-mode build                             |
| 3   | Styling is correct (grid, editor, splitters, icons, fonts)                                                                                   | Their #3037 — emitted CSS not linked into webview HTML                        |
| 4   | Monaco loads and edits; check DevTools for worker errors                                                                                     | Their #3169 — worker origin under `vscode-webview://`                         |
| 5   | DevTools console clean on every panel                                                                                                        | CSP violations, failed asset URLs, lazy-chunk 404s                            |
| 6   | Exercise a lazily-loaded path (Kubernetes plugin, playground worker)                                                                         | Dynamic-import chunk resolution                                               |
| 7   | Confirm dev-watch output cannot be mistaken for production                                                                                   | Their #3164 — build-mode confusion                                            |
| 8   | Record `dist` sizes + activation time                                                                                                        | Baseline for the Phase 3 CI gates                                             |

Checks 2–5 are exactly the bugs the reference project shipped post-migration, and all four are
visible within seconds of opening a panel in a production build.

**Four more failure classes to add to the pre-migration audit**, from Ref1's own bundler-migration
post-mortem (companion document §5.14) — all four are invisible in source mode and fatal in the
packaged artifact:

1. **`const enum`** — `tsc` inlines the values; esbuild/Rollup cannot inline them across a `.d.ts`
   boundary and will fail to resolve the import. Ban them with `isolatedModules` **before** starting.
2. **`__dirname` / `__filename` / `require.resolve`** in our code or our dependencies — these break
   moving _to_ ESM, exactly as `import.meta.url` broke for them moving to CJS. Grep
   `node_modules` before starting; it is a five-minute check.
3. **Optional guarded requires** (`try { require('x') } catch {}`) — each needs an explicit
   `external` entry, or the bundle fails to resolve it.
4. **`constructor.name` / `fn.name` comparisons** — minification renames them, so the failure
   appears **only in production builds**. `keepNames` is the fix.

### The one decision only you can make

**Engine floor.** Cosmos DB ships ESM at `vscode ^1.109.0`; we are at `^1.105.0`. **Update (Part J):**
the Azure Tools migration guide gives the only hard floor as Node 22 → **VS Code 1.101.0**, with no
separate ESM requirement — so we are likely already clear, and Cosmos DB's 1.109 is probably
unrelated to ESM. Confirm empirically before Phase 2, but treat this as a check rather than a
likely blocker.

### How you will know it worked

- All webviews render from a **packaged** build (CSS, Monaco, workers, lazy chunks, real CSP)
- `npm test` runs real Extension Host tests
- Local Quick Start no longer loads Monaco or SlickGrid
- JS output down ~30%; VSIX down ~6–10% (set expectations accordingly)
- Dev-watch and production builds cannot corrupt each other

### Decision log

The recommendation changed several times during this research. Each revision was driven by new
information, and all are recorded here so a later reader can tell current guidance from
superseded guidance.

| Rev             | Recommendation                                                                                                                                                                            | Why it changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1**           | Defer stack changes; capture the cheap wins first (`@swc/jest`, Webpack code-splitting, bundle analyzer). Tiered by effort.                                                               | Original framing assumed migration labour was the binding constraint. Preserved in Section 0 and Part F.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **2**           | Do the full migration (ESM + Vite + Vitest), but **build E2E first** as a safety net.                                                                                                     | The constraint changed: conversion effort can be outsourced to coding agents, and the goal is to transform once. With effort no longer binding, deferral arguments lose their force.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **3 — current** | Full migration, but **E2E comes after it**. Phase 0 is a written manual checklist run against a **packaged VSIX**.                                                                        | The reference project's own timeline disproved "E2E first": they migrated (2026-04-30), ran broken for 18 days, released only after fixing (2026-05-19), and built E2E six weeks later (2026-06-10). Nothing broken shipped. Building E2E first would also mean building part of it against the outgoing stack — the same "don't build on the layer you're deleting" argument already used to reject doing Webpack code-splitting first. Rev 2 applied that reasoning inconsistently.                                                                                                                                                                                                                    |
| **4 — current** | Unchanged on substance: **Vite for both targets**. esbuild evaluated and rejected as the _primary_ stack, retained as a host-only fallback (Part J).                                      | Reviewed `vscode-azuretools/eng/MIGRATION.md`. Their esbuild standardisation is silent on webviews — our actual pain — and ships as an **alpha** eng package that also imposes Mocha. Two of our assumptions improved though: the ESM engine floor is likely a non-issue (Node 22 → VS Code 1.101.0), and `@microsoft/vscode-azext-utils` already ships dual ESM/CJS.                                                                                                                                                                                                                                                                                                                                    |
| **5 — current** | Unchanged on the stack. **Sequencing amended:** Phase 0 splits into **0a**, one automated installed-VSIX activation check built _before_ the migration, and **0b**, the manual checklist. | A detailed architecture report on **Ref1** (an internal, more mature sibling suite) landed. Its hardest-defended claim is that a bundler migration must be validated against a **packaged artifact continuously**, because packaging-time breakage is invisible to both F5 and source-mode tests. Ref1 has the lane that catches this but runs it on `workflow_dispatch` only, so its own bundler migration was never covered by it. Rev 3's "do not build on the layer you are deleting" logic still holds for the E2E _suite_; it does not apply to 0a, which asserts on a VSIX rather than a build config. Ref1 also supplied four concrete bundler-breakage classes now folded into Phase 0 and K.5. |

| **6 - current** | Stack unchanged. **Execution rewritten as eight sequential stages** (R6.6), each ending on an operator gate. Vitest moves **before** the bundler. E2E becomes its own iteration. The legacy Mocha harness is dropped. Our six packages move to **ESM-only**, not dual (R6.7). The installed-VSIX check (0a, now L3) runs on GitHub Actions only, and L1 runs in both pipelines (R6.8). SlickGrid removal gets its own plan ([slickgrid-removal.md](./slickgrid-removal.md)). | Re-review against Cosmos DB `main` at `07ac7f86` (R6.1): their ADO pipeline adopted `DefaultDeny` network isolation, which blocked `npm test`; both of our packages now carry consumer-side interop costs in their Vitest config; the feed-quarantine constraint on new dependencies; TypeScript 6. In this repo (R6.2): the Jest surface grew 48 % in seven weeks, which argues for converting it early; there is now a fifth webview. The automated test levels (R6.3) move most verification from the operator to the agent. |

**What survived every revision:** the measurements in Parts A, C and I, and the four failure
classes in the Phase 0 checklist. Those are evidence, not preference.

> **Note on internal consistency.** Section 0 and Part F below are written _effort-optimized_ —
> they defer stack changes because migration labour is expensive (Rev 1). This Executive Summary
> supersedes them on **sequencing**. The **measurements** in Parts A, C and I are unaffected and
> remain the evidence base.

---

## 0. How to read this document

Everything here is labelled by evidence strength, because "X is faster" claims are where
modernization projects usually go wrong:

| Tag             | Meaning                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------- |
| **[MEASURED]**  | Measured on this machine, in this repo, during this research session. Reproducible with the commands in Appendix A. |
| **[PUBLISHED]** | A number or statement published by the Cosmos DB team in their own PR/commit/docs.                                  |
| **[VENDOR]**    | A claim by the tool's own maintainers. Directionally useful, not independent evidence.                              |
| **[INFERRED]**  | My reasoning from the code. Plausible, but not verified by execution.                                               |

The single most important message: **most of the performance win you are looking for does
not require changing the stack.** Two of the biggest costs in this repo are self-imposed
configuration choices that Webpack and Jest would happily let you remove today. Changing
the stack is a separate, later decision, and it should be made on measurements you do not
have yet.

---

## 1. TL;DR — headline findings

1. **Your suspicion is correct, and it is worse than "all webviews load".** [MEASURED]
   `webpack.config.views.js` contains `new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })`.
   That forces **every** webview, every vendor library, Monaco's editor core and SlickGrid
   into one file. `dist/views.js` is **6.4 MB minified**. Opening Local Quick Start — which
   imports neither Monaco nor SlickGrid — loads all 6.4 MB.

2. **This is not a Webpack limitation.** Code splitting is a native Webpack feature that is
   explicitly switched off. You can fix this without Vite, without ESM, and without touching
   the test stack.

3. **Your test suite's likely bottleneck is `ts-jest`, not Jest.** [MEASURED]
   All six Jest projects use `ts-jest`, which runs the TypeScript compiler for type checking
   on every test file, in every worker. Your own config comments say each worker costs
   ~500 MB and therefore caps `maxWorkers: '25%'` — so on a many-core machine you are
   deliberately using a quarter of it. `@swc/jest` is **already in your devDependencies**
   and unused by the root config.

4. **Cosmos DB published one hard number, and we independently reproduced it.** [PUBLISHED + MEASURED]
   PR #2997: "`vite-prod` cold build: ~4s vs webpack ~30s (~8x faster)". Rebuilding their repo
   at that exact commit on this machine: **71.5s vs 8.0s — 8.95x**. The ratio replicates. See Part I.

5. **We measured what they never published: Jest vs Vitest — and the headline is misleading.** [MEASURED]
   Same 551 tests, adjacent commits: **ts-jest 22.4s → Vitest 1.7s (13x)**. But swapping only the
   transform to `@swc/jest`, keeping Jest, gives **2.7s**. So **~95% of the speedup is the
   transform, not the framework.** See Part I.

6. **Your `npm test` is a no-op.** This is the clearest correctness gap in the repo, and it
   is independent of any bundler debate.

7. **On one axis you are upstream of them, not behind.** [MEASURED]
   `@microsoft/vscode-ext-webview` — a package this repo owns and publishes — is already being
   consumed by a Vite-based Cosmos DB branch, where it required a workaround because it ships
   CommonJS only. See Part H.5.

---

## 2. Part A — What is actually true about _this_ repo

### A1. The webview bundle: one file, everything in it

**Evidence chain:**

`src/webviews/_integration/WebviewRegistry.ts` statically imports all four views:

```ts
import { AtlasCredentialsView } from '../documentdb/atlasCredentials/AtlasCredentialsView';
import { CollectionView } from '../documentdb/collectionView/CollectionView';
import { DocumentView } from '../documentdb/documentView/documentView';
import { LocalQuickStart } from '../documentdb/localQuickStart/LocalQuickStart';

export const WebviewRegistry = {
  collectionView: CollectionView,
  documentView: DocumentView,
  localQuickStart: LocalQuickStart,
  atlasCredentials: AtlasCredentialsView,
} as const;
```

`src/webviews/index.tsx` then does a plain object lookup: `const Component = WebviewRegistry[key]`.

A static import plus a static lookup means the bundler must include all four component trees.
Then `webpack.config.views.js` removes the last escape hatch:

```js
new webpack.optimize.LimitChunkCountPlugin({
    maxChunks: 1,
}),
```

**What this costs you** [MEASURED, from the current `dist/`]:

| Artifact                                       | Size                         | Note                                                                        |
| ---------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------- |
| `dist/views.js`                                | **6,405,079 bytes (6.4 MB)** | Verified minified (single line, license banner). One chunk, all four views. |
| `dist/main.js`                                 | 15,796,621 bytes (15.8 MB)   | Extension host bundle, from the same build output.                          |
| `dist/editor.worker.js`, `dist/json.worker.js` | separate                     | Monaco workers _are_ already emitted as separate files.                     |

**Which views actually need the heavy libraries** [MEASURED, by import scan]:

| View               | Monaco                                      | SlickGrid | Verdict             |
| ------------------ | ------------------------------------------- | --------- | ------------------- |
| `collectionView`   | yes                                         | yes       | Genuinely heavy     |
| `documentView`     | yes (`@monaco-editor/react` + `editor.api`) | no        | Needs Monaco only   |
| `localQuickStart`  | **no**                                      | **no**    | Pays for both today |
| `atlasCredentials` | **no**                                      | **no**    | Pays for both today |

So two of your four webviews load a multi-megabyte editor and data grid they never render.
That is the concrete form of the problem you suspected.

**A second, subtler consequence.** `maxChunks: 1` also neutralizes deliberate lazy loading
elsewhere. `src/webviews/query-language-support/registerLanguage.ts` contains:

```ts
const jsLanguage = await import('monaco-editor/esm/vs/basic-languages/javascript/javascript.js');
```

Someone wrote that `await import()` to defer a cost. With `maxChunks: 1` the chunk is folded
back into `views.js`, so the deferral buys nothing at load time. [INFERRED — the plugin's
documented behavior is to merge chunks; not separately verified by build inspection.]

**Why the constraint probably exists** [INFERRED]: the host loads exactly one script file.
`src/webviews/_integration/configuration.ts` declares `bundled: { dir: '', file: 'views.js' }`,
and the framework builds webview HTML pointing at that one file. Additional chunks need a
correct absolute URL under the `vscode-webview://` origin and a CSP that permits them. So
`maxChunks: 1` is a _simplifying_ choice, not an accident.

Encouragingly, the groundwork is already half-present: `src/webviews/typings.d.ts` declares
`__webpack_public_path__`, which is exactly the runtime hook needed to point chunk loading at
the webview base URI.

### A2. The test stack: `ts-jest` everywhere, workers throttled

**Evidence** [MEASURED]. `jest.config.js` root project:

```js
maxWorkers: '25%',
projects: [
    {
        displayName: 'extension',
        testEnvironment: 'node',
        testMatch: ['<rootDir>/src/**/*.test.ts'],
        transform: { '^.+\\.tsx?$': ['ts-jest', {}] },
    },
    '<rootDir>/packages/documentdb-js-schema-analyzer',
    ...
]
```

All five workspace packages use `['ts-jest', {}]` too. The config's own comment states the
reason for the throttle: _"Each ts-jest worker loads the TypeScript compiler and consumes
~500MB+."_

Current suite performance [MEASURED, earlier in this session]:
**210 suites, 3,406 tests, 4 snapshots — 38.2 s wall clock**, at 25% workers.

Two independent costs are stacked here:

1. **`ts-jest` type-checks while testing.** By default it runs a full TypeScript program.
   That is the single slowest common Jest transform. `@swc/jest` (Rust) does syntax-only
   transformation and is typically far faster — and `@swc/jest ~0.2.39` is _already_ a
   devDependency in this repo, alongside `@swc/core`.
2. **Memory pressure forces `maxWorkers: '25%'`.** Type checking is what makes each worker
   expensive. Remove the cause and the throttle can likely be relaxed, which is a second,
   multiplicative win.

**Why this matters for the stack decision:** if you migrate to Vitest _without_ changing this,
you will attribute the speedup to Vitest when much of it actually came from dropping
type-checking-during-test. Conversely, if you fix the transform first and the suite becomes
fast enough, the case for migrating on _speed_ grounds largely evaporates — and you would
migrate (or not) for other reasons like config unification and watch-mode DX.

You lose nothing in safety: `npm run build` already runs `tsc` across the workspace, so types
are checked there. Type checking inside the test runner is duplicated work.

### A3. The extension host bundle

`dist/main.js` is 15.8 MB [MEASURED]. The extension build _does_ split — `dist/` contains
numbered chunks (`58.js` at 4.1 MB, `244.js` at 1.36 MB, `505.js` at 631 KB, and others), and
`src/plugins/service-kubernetes/kubernetesClient.ts` documents a deliberately lazy chunk. So
the ext side is architecturally healthier than the views side.

Still worth attention: a large eager bundle is parsed at activation. VS Code activation time
is user-visible. This deserves its own measurement (Appendix A) before any optimization.

Also note `du -sh dist` reports **131 MB** total [MEASURED]. Much of that is copied resources,
and `dist/.vscodeignore` will exclude some from the VSIX — but it is worth confirming what
actually ships.

---

## 3. Part B — What Cosmos DB did, when, and why

Their modernization was a deliberate, staged program between April and June 2026 — not one
big-bang PR. The staging is the most transferable part.

| Date       | PR                 | What                                                                         | Stated rationale                                                                                                          |
| ---------- | ------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-20 | #2986              | ESLint → Oxlint                                                              | Speed. Adjacent work, **not** a prerequisite for anything else.                                                           |
| 2026-04-24 | #2996              | `.oxlintrc.jsonc`, tighter ESLint, fix findings                              | Consolidation; kept ESLint alongside Oxlint for rules Oxlint lacks.                                                       |
| 2026-04-30 | #2997              | Webpack configs → ESM (`.mjs`), `"type": "module"`, **Vite added alongside** | Explicitly labelled _"zero-risk benchmark"_. Webpack stayed the default. This is where the ~4s vs ~30s number comes from. |
| 2026-04-30 | #2999              | Vite becomes default; **Jest → Vitest**                                      | Remove duplicate pipelines; single config for dev/build/test.                                                             |
| 2026-05-18 | #3037              | Fix blank packaged webviews + missing CSS                                    | Vite app-mode build dropped the entry's named `render` export; emitted CSS was not linked into webview HTML.              |
| 2026-06-05 | (commit `f7bc40d`) | Mocha → Vitest for integration tests                                         | One assertion API. 52 packages removed.                                                                                   |
| 2026-06-10 | #3136              | Vitest integration runner + Playwright E2E                                   | Real Extension Host + real VS Code + isolated emulator.                                                                   |
| 2026-06-18 | #3164              | Force production `dist` for E2E                                              | A dev watch build looked "fresh" by mtime but broke webview rendering under the harness.                                  |
| 2026-06-23 | #3169              | Fix Monaco workers under Vite dev server                                     | `vscode-webview://` cannot construct a worker from a cross-origin dev URL.                                                |
| 2026-06-23 | #3172              | React component tests                                                        | jsdom + Testing Library, opted in per file.                                                                               |

### The shape worth copying

**Phase 1 was explicitly non-committal.** They added Vite _next to_ Webpack, kept Webpack as
the default F5/watch path, and used the coexistence period to benchmark. Only after that did
they flip the default. That is exactly how to de-risk this in your repo.

### The costs they paid (do not skip this)

The four post-migration fix PRs are the honest price list for a Vite webview migration:

- **Production ≠ dev.** A working dev server proved nothing about the packaged bundle (#3037).
- **CSS delivery is your problem.** Vite emits CSS files; someone must inject `<link>` tags
  into the generated webview HTML (#3037).
- **Workers and origins are subtle.** Monaco workers needed different handling in `serve` vs
  `build` because of the webview origin (#3169).
- **Build modes collide.** Dev-watch output overwriting production output silently broke E2E
  (#3164).

Their `docs/webview-build.md` is a whole document of rationale for non-obvious Vite settings:
relative `base` in prod, ES-module workers, font inlining, flat `assetsDir`, dev-server origin
and CORS, React Refresh preamble, Monaco worker plugin, CSS injection. **That file is the real
scope estimate for "migrate webviews to Vite".**

### One architectural idea worth stealing regardless of bundler

Their `vite.config.views.mjs` uses `manualChunks` to create _stable, cacheable_ vendor groups:
`monaco-editor`, `fluentui`, `griffel`, `react`, `react-data-grid`, and a catch-all `vendor`.
The comments explain the goal: predictable named chunks instead of a "file-name lottery", and
several medium parallel-loadable chunks instead of one huge one. They also note that
`react-data-grid` is deliberately kept out of `vendor` because only two of their views use it —
**precisely the optimization your `maxChunks: 1` currently forbids.**

---

## 4. Part C — The speed evidence, graded honestly

### C1. Build speed: Vite vs Webpack

**The one real data point** [PUBLISHED], from Cosmos DB PR #2997:

> `vite-prod` cold build: ~4s vs webpack ~30s (~8x faster)

Strengths of this evidence: same problem domain (VS Code extension + React webviews + Monaco),
same team, both configs written by people who understood the codebase, measured on the same
machine.

Limits you must respect:

- Single machine, single run, no variance reported.
- Their Webpack config used `ts-loader`; **yours uses `swc-loader`**, which is Rust-based and
  substantially faster than `ts-loader`. Your Webpack baseline is therefore probably better
  than theirs was, so **you should not expect an 8x improvement**.
- "Cold build" excludes watch/HMR, which is what you actually feel while developing.
- Output differences (chunking, minifier, sourcemaps) can dominate.

**Why Vite is architecturally faster in dev** (mechanism, not marketing):

| Phase               | Webpack                                         | Vite                                                     |
| ------------------- | ----------------------------------------------- | -------------------------------------------------------- |
| Dev server start    | Build the graph before serving                  | Serve immediately; transform modules on request          |
| Dependency handling | Push `node_modules` through the loader pipeline | Pre-bundle once with esbuild (Go), then serve cached ESM |
| Single-file edit    | Invalidate + rebuild affected chunks            | Transform the one module, push HMR update                |
| Production          | Webpack compiler                                | Rollup/Rolldown                                          |

The dev-side advantage is real and structural. The production-side advantage is
workload-dependent.

**Vite's own costs**, visible in Cosmos DB's config: they needed `optimizeDeps.include` for
Fluent UI/Griffel and `server.warmup` for ~230 webview source files because otherwise the
first panel open paid a **~1.5 s** sequential transform waterfall [PUBLISHED, in their config
comments]. Vite is not free; it relocates cost.

### C2. Test speed: Jest vs Vitest — what is actually proven

**What Cosmos DB published:** nothing about speed. PR #2999 says "All 536 unit tests pass".
PR #3136 reports "1092 passed, 1 skipped". Their stated motivation is **de-duplication of
pipelines**, not raw speed:

> **Update:** we have since measured this ourselves by rebuilding their repo at the commits
> before and after the migration. See **Part I** for the numbers — they confirm a large
> speedup but attribute ~95% of it to the transform rather than to Vitest.

> "in a world where we have Vite providing support for the most common web tooling…
> Jest represents a duplication of complexity… having two different pipelines to configure
> and maintain is not justifiable" — Vitest docs [VENDOR], echoed by their PR framing.

**What Vitest itself claims** [VENDOR]:

> "Vitest cares a lot about performance and uses Worker threads to run as much as possible in
> parallel. Some ports have seen test running an order of magnitude faster."

Note the careful wording: _"some ports"_. That is a best-case anecdote, not a general result.

**Where a genuine Jest-vs-Vitest gap comes from:**

| Factor             | Effect                                                                             | Applies to you?                        |
| ------------------ | ---------------------------------------------------------------------------------- | -------------------------------------- |
| Transform cost     | `ts-jest` (type-checks) ≫ `babel-jest` > `@swc/jest` ≈ esbuild                     | **Yes — this is your dominant factor** |
| Isolation model    | Jest sandboxes per test file in child processes; Vitest defaults to worker threads | Partially                              |
| Watch mode         | Vitest re-runs only affected tests via Vite's module graph                         | Yes — real DX gain                     |
| Config duplication | Separate test pipeline vs shared Vite config                                       | Only if you adopt Vite                 |
| ESM handling       | Jest's ESM support is still awkward                                                | Only if you go ESM                     |

**The critical caveat:** Jest 30 (which you are on, `~30.3.0`) is markedly faster than the Jest
that most "Jest is slow" blog posts were written about. And with `@swc/jest`, Jest's transform
is _also_ Rust-based. **Equalize the transform and the framework gap narrows dramatically.**

So: "tests will run much faster with the other framework" is **plausible but unproven for your
codebase**, and it is confounded by a variable you can control today for far less effort.

### C3. How to settle it honestly

> **Update:** steps 1–4 below were executed against the _reference_ repo, where the
> before/after commits exist. See **Part I**. They still need running against _this_ repo,
> because our suite is 6.2x larger and structured differently.

Run this sequence. It is designed so each step isolates one variable:

1. **Baseline.** `npx jest --no-coverage` three times, record the median. (Current known value:
   38.2 s.)
2. **Change only the transform.** Swap `ts-jest` → `@swc/jest` in all six projects. Re-measure.
   _This tells you how much of the "Jest is slow" story is really "ts-jest is slow"._
3. **Change only the worker cap.** Raise `maxWorkers` (e.g. `50%`, then `75%`). Re-measure and
   watch memory. _This tells you how much the OOM-avoidance throttle was costing._
4. **Only then**, prototype Vitest on **one** package (e.g. `packages/documentdb-js-schema-analyzer`,
   which is self-contained). Compare against the _already-optimized_ Jest number, not the
   original baseline.

If step 4 still shows a decisive win on a fair baseline, you have a real, defensible reason to
migrate. If it does not, migrate later for pipeline unification — or not at all.

---

## 5. Part D — Big picture: what each tool is actually for

Useful if you want the mental model rather than the config details.

**The two runtimes.** A VS Code extension with React webviews is really two programs:

- **Extension host** — Node/Electron. Owns `vscode` APIs, commands, storage, credentials.
  Constraint: VS Code provides `vscode`; native/optional deps must stay external.
- **Webview** — a browser iframe with a synthetic `vscode-webview://` origin, a strict CSP,
  and no Node access. Constraint: asset URLs, workers, and CSS must all resolve under that
  origin.

Almost every hard problem in this space comes from the second column.

**Bundler.** Walks imports from an entry, transforms TS/JSX/SCSS, resolves packages, and emits
files for one runtime. It decides _what is in which file_ — which is exactly your webview
problem. Webpack and Vite both do this; they differ mainly in dev-time model and defaults.

**Transformer.** Turns TS/JSX into JS. `tsc`/`ts-jest` (slow, type-aware), Babel (medium),
SWC and esbuild (fast, syntax-only). **Type checking and transformation are separable** —
this is the insight behind both `@swc/jest` and Vite.

**Test runner.** Finds tests, runs them with isolation, provides assertions/mocks/coverage.
Cannot, by itself, prove your extension activates in VS Code or that a webview renders under
CSP. Hence three layers:

| Layer                             | Proves                                 | Cost                        |
| --------------------------------- | -------------------------------------- | --------------------------- |
| Unit (Jest/Vitest)                | Logic, services, components            | Fast                        |
| Integration (real Extension Host) | Activation, commands, contributions    | Medium                      |
| E2E (Playwright + real VS Code)   | Panels actually render; workflows work | Slow, environment-sensitive |

You currently have layer 1 (strong: 3,406 tests) and **neither layer 2 nor 3**.

**Where your subset is thin or non-idiomatic:**

- You use Webpack but disable its central feature (code splitting) for webviews.
- You have `webpack-bundle-analyzer` installed but **commented out** in `webpack.config.views.js`,
  so bundle regressions are invisible.
- You have `@swc/jest` installed but use `ts-jest` everywhere.
- You have `@vscode/test-electron` and `@vscode/test-cli` installed, plus Mocha and reporters,
  but `npm test` is a no-op — dependency weight with no coverage.

---

## 6. Part E — Market overview

**Bundlers / build tools**

| Tool        | Model                                 | Fit here                                                     | Caution                                                       |
| ----------- | ------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------- |
| **Webpack** | Mature, plugin/loader based           | What you have; handles dual-target, externals, workers well  | Config-heavy; slower dev model; you own more machinery        |
| **Vite**    | ESM dev server + Rollup/Rolldown prod | Strong fit for React webviews; proven in the sibling repo    | ESM-first; webview asset/CSP/worker work is real              |
| **Rspack**  | Rust, Webpack-API-compatible          | Speed **without** rewriting config; underrated for your case | Verify Monaco plugin + extension-specific plugin parity       |
| **esbuild** | Extremely fast transformer/bundler    | Great for the _extension host_ bundle                        | Fewer features for complex webview output                     |
| **Rollup**  | ESM library bundler                   | Powers Vite's prod build                                     | Not a dev-server story on its own                             |
| **tsup**    | esbuild wrapper for libraries         | Good for `packages/*`                                        | Not an app/webview solution                                   |
| **Parcel**  | Zero-config                           | Low config burden                                            | Rare in VS Code extensions; less control                      |
| **Bun**     | Runtime + bundler + test runner       | Interesting long-term                                        | Extension runtime is Node/Electron; adds a compatibility axis |

**Note on Rspack:** given that your pain is _configuration you already own_ rather than
Webpack's API, Rspack is a legitimate middle path — Webpack-compatible config, Rust speed, no
ESM migration required. It deserves a spike alongside Vite rather than being skipped.

**Test runners**

| Tool            | Role             | Note                                                            |
| --------------- | ---------------- | --------------------------------------------------------------- |
| **Jest**        | Unit             | Mature; Jest 30 is fast; your bottleneck is the transform       |
| **Vitest**      | Unit             | Jest-compatible API; shines when paired with Vite               |
| **Mocha**       | Unit/integration | Historic VS Code integration choice; Cosmos DB dropped it       |
| **node:test**   | Unit             | Zero-dependency, built into Node; viable for `packages/*`       |
| **Playwright**  | E2E              | Can drive Electron/VS Code; the only way to prove panels render |
| **WebdriverIO** | E2E              | Has a dedicated VS Code service; alternative to raw Playwright  |

---

## 7. Part F — Recommendations, in priority order

Ordered by **value ÷ effort**, not by novelty. Tiers 1–2 need no stack change at all.

### Tier 1 — High value, low risk, no stack change

**R1. Turn on bundle visibility first.** _(effort: ~1h)_
Re-enable `webpack-bundle-analyzer` in `webpack.config.views.js` behind an env flag (Cosmos DB
uses `BUNDLE_ANALYZE`). You cannot manage what you cannot see, and every later recommendation
is validated with this. Commit the baseline numbers.

**R2. Split the webview bundle per view.** _(effort: 1–3 days; the biggest single user-facing win)_

This is the fix for the problem you identified. Three coordinated changes:

1. **Remove** `LimitChunkCountPlugin({ maxChunks: 1 })`.
2. **Make the registry lazy** in `src/webviews/_integration/WebviewRegistry.ts`:
   ```ts
   export const WebviewRegistry = {
     collectionView: lazy(() => import('../documentdb/collectionView/CollectionView')),
     documentView: lazy(() => import('../documentdb/documentView/documentView')),
     localQuickStart: lazy(() => import('../documentdb/localQuickStart/LocalQuickStart')),
     atlasCredentials: lazy(() => import('../documentdb/atlasCredentials/AtlasCredentialsView')),
   } as const;
   ```
   `WebviewName = keyof typeof WebviewRegistry` still works, so the compile-time safety you
   documented is preserved. Wrap the render in `<Suspense>` in `src/webviews/index.tsx`.
3. **Make chunk URLs resolvable** under the webview origin. The declaration already exists in
   `src/webviews/typings.d.ts`; since the views build emits ESM (`libraryTarget: 'module'`,
   `experiments.outputModule`), the runtime value can be derived at the top of the entry:
   ```ts
   __webpack_public_path__ = new URL('.', import.meta.url).href;
   ```
   Then confirm the framework's generated CSP permits loading those sibling scripts.

**Expected outcome** [INFERRED — verify with R1]: Local Quick Start and Atlas Credentials
should drop from 6.4 MB to roughly the shared React + Fluent UI + framework core, with Monaco
and SlickGrid moving into chunks loaded only by the views that use them. Measure before
claiming a number.

**Risk to watch:** this is exactly where Cosmos DB got burned — dev worked, production was
blank. Test the **packaged** extension for all four panels, not just the dev server.

**R3. Add stable vendor chunks.** _(effort: ~half a day, after R2)_
Once splitting is on, group `monaco-editor`, `@fluentui/*` + Griffel, `react`/`react-dom`, and
`slickgrid` into named `cacheGroups` via `optimization.splitChunks`. Mirror Cosmos DB's intent:
predictable names, independently cacheable, parallel-loadable.

**R4. Replace `ts-jest` with `@swc/jest`.** _(effort: ~2h across six configs; dependency already present)_
Then raise `maxWorkers` and re-measure. Type safety is unaffected — `npm run build` already
runs `tsc`. Record before/after; this single number determines how much of the Vitest case is
real.

> **Measured on the reference repo (Part I):** this exact swap took their suite from
> **22.4s → 2.7s (8.4x)**. Budget for one caveat: one of their 17 suites failed afterwards with
> `Cannot access 'mockContext' before initialization` — a `jest.mock()` hoisting difference.
> **That same test file, `src/utils/survey.initSurvey.test.ts`, exists in this repo**, and we
> have 313 `jest.mock()` call sites, so expect a handful of similar fixes.
> **R5. Audit what Monaco actually needs.** _(effort: ~2h)_
> `MonacoWebpackPlugin({ languages: ['sql', 'json'] })` — confirm `sql` is still required for a
> DocumentDB/MongoDB-API extension. Dropping an unused language removes a worker and grammar
> weight.

**R13. Ship a dual ESM + CJS build of `@microsoft/vscode-ext-webview`.** _(effort: ~1 day)_
The package this repo publishes is currently CJS-only, which hurts tree-shaking in the webview
bundle you are trying to shrink in R2/R3 — and already forced a workaround in a Cosmos DB
branch. Full rationale in **H.5**.

### Tier 2 — High value, moderate effort, still no stack change

**R6. Restore a real integration test layer.** _(effort: 2–4 days)_
`npm test` being a no-op is your largest _correctness_ gap, and it is independent of Vite.
You already have `@vscode/test-electron`. Start with three tests: extension activates, a key
command is registered, one connection workflow succeeds. Cosmos DB's `scripts/run-integration-tests.mjs`
(~80 LOC) is a good structural model even if you keep Jest/Mocha for now.

**R7. Measure activation cost.** _(effort: ~1 day)_
15.8 MB of extension bundle is parsed at activation. Use VS Code's extension profiler, identify
the heaviest eager imports (Azure SDKs, shell runtime, Kubernetes client), and push more behind
`await import()`. The Kubernetes client already demonstrates the pattern in your codebase.

### Tier 3 — Stack changes, only after Tier 1–2 data exists

**R8. Run a Vite _and_ Rspack webview spike, side by side.** _(effort: 3–5 days)_
Keep Webpack as default. Emit to a separate directory. Success criteria, all four panels, in a
**packaged** build:

- panel renders (not blank), CSS applied
- Monaco loads; workers construct in dev _and_ prod
- lazy chunks fetch under CSP
- HMR works in dev
- production size ≤ post-R2/R3 Webpack numbers

Include Rspack because it may deliver most of the speed with a fraction of the migration risk.

**R9. Prototype Vitest on one package.** _(effort: 1–2 days)_
Use `packages/documentdb-js-schema-analyzer`. Compare against the post-R4 Jest baseline.
Decide on evidence.

**R10. Defer ESM.** ESM conversion (`"type": "module"`, `main.mjs`) is the highest-blast-radius
change: packaging, `__dirname`, worker resolution, optional native deps, compiled tests. Cosmos
DB needed it because Vite is ESM-first for the _extension_ build. You do **not** need it for the
webview-only work in R2/R3/R8. Keep it as a separate, later decision.

**R11. Add a Playwright smoke suite.** _(effort: 2–4 days)_
Only after R6. Start with: launch VS Code, activate, open each of the four panels, assert the
root mounts. This is the regression net that would have caught Cosmos DB's #3037 blank-webview
bug — and would protect your R2 splitting work.

**R12. Skip the lint/format migration for now.** Oxlint/Oxfmt is unrelated to your goals and
Cosmos DB's own history shows it was independent. Revisit only if lint time becomes a
measured complaint.

### Suggested sequencing

```mermaid
flowchart TD
    R1[R1 Bundle analyzer\nvisibility] --> R2[R2 Split webviews\nper view]
    R13[R13 Dual ESM/CJS\nwebview package] --> R2
    R2 --> R3[R3 Vendor chunks]
    R4[R4 swc-jest + workers\nre-measure] --> R9[R9 Vitest spike\non one package]
    R1 --> R7[R7 Activation profiling]
    R6[R6 Real integration tests] --> R11[R11 Playwright smoke]
    R3 --> R8[R8 Vite + Rspack spike]
    R13 --> R8
    R11 --> R8
    R8 --> R10[R10 ESM decision]
```

---

## 8. Part G — Decision gates

Promote any new tool to default **only** when all hold:

1. Packaged extension activates on Windows, Linux, macOS.
2. All four webviews render from a **production** build: CSS, fonts, Monaco, workers, lazy
   chunks, all under real CSP.
3. Dev server and watch do not corrupt production output (Cosmos DB #3164).
4. Unit coverage green with no unexplained mock/timer/snapshot semantic changes.
5. `npm test` runs real Extension Host tests.
6. Measured: bundle sizes, activation time, first-panel time, dev-server start, save-to-update
   latency, and production build time — each compared against the _optimized_ Webpack baseline
   from Tier 1, not today's baseline.
7. CI produces actionable failure diagnostics.

---

## 9. Part H — What would we actually gain by matching Cosmos DB?

### H.1 The question is really eight questions

"Match Cosmos DB" sounds like one decision. It is at least eight separable ones, and they have
very different payoffs for _this_ repo:

1. ESM package (`"type": "module"`, `main.mjs`)
2. Vite for the webview build
3. Vite for the extension-host build
4. Vitest for unit tests
5. Vitest running inside the real Extension Host for integration tests
6. Playwright E2E against real VS Code
7. Oxlint + Oxfmt replacing/augmenting ESLint + Prettier
8. Their staged migration _method_ (coexistence, then flip)

Bundling these into "modernize the stack" is how a project ends up paying for the expensive
items to get the benefits of the cheap ones.

### H.2 Scope reality check: matching costs us more than it cost them

The migration is not the same size for both repos. Measured:

| Dimension                    | Cosmos DB at migration         | DocumentDB today                                              | Implication                                          |
| ---------------------------- | ------------------------------ | ------------------------------------------------------------- | ---------------------------------------------------- |
| Unit tests to migrate        | 536 (PR #2999)                 | **3,406**                                                     | **~6.4x larger** test migration                      |
| Files touching `jest.*` APIs | —                              | **110**                                                       | Broad, not concentrated                              |
| `jest.*` call sites          | —                              | **1,905**                                                     | Mostly mechanical, but large                         |
| `jest.mock()` calls          | —                              | **313**                                                       | The genuinely risky part (hoisting semantics differ) |
| Extension-host entry points  | 1 (`main.ts`)                  | **3** (`main`, `playgroundWorker`, `playgroundTsPlugin`)      | Vite lib mode is single-entry-oriented               |
| Optional/native externals    | `vscode`, `vs`, Node built-ins | **18** (kerberos, snappy, ssh2, mongodb-client-encryption, …) | Much larger externals surface to port                |
| Engine floor                 | `^1.109.0`                     | `^1.105.0`                                                    | ESM may require raising it — a user-reach cost       |

And the target is not "write two config files". Cosmos DB's actual Vite surface is **507 lines
of config** (`vite.config.ext.mjs` 257 + `vite.config.views.mjs` 250), **six custom plugins**
(`no-extension-imports`, `webview-entry`, `react-refresh-preamble`, `monaco-workers`,
`inline-css`, `bundle-report`), plus **263 lines** of `docs/webview-build.md` explaining why
each non-obvious setting exists, plus **313 lines** of `docs/test-configuration.md`.

That is the honest scope of "matching", and their `ts-loader` starting point made their
before/after look better than yours will (you already use `swc-loader`).

### H.3 Choice-by-choice: gain, cost, verdict

| #   | Choice                                       | What we'd gain                                                                                                                                         | What it costs                                                                                                       | Verdict                                                                                                      |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 8   | **Staged method** (coexist, then flip)       | De-risks everything else; a reversible decision at every step                                                                                          | Nothing — it is a process                                                                                           | **Adopt now.** Free.                                                                                         |
| 5   | **Integration tests in real Extension Host** | Fills a genuine hole: `npm test` is a no-op today. Catches activation/command/contribution regressions                                                 | 2–4 days; can be done with your existing `@vscode/test-electron`                                                    | **Adopt** (see R6). Doesn't require Vitest.                                                                  |
| 6   | **Playwright E2E**                           | The only layer that proves a panel actually renders under real CSP. Would have caught their #3037 blank-webview bug — and protects your splitting work | 2–4 days + CI time + flake maintenance                                                                              | **Adopt, scoped small.** Smoke only.                                                                         |
| 2   | **Vite for webviews**                        | Faster dev server/HMR; native SCSS; `manualChunks` ergonomics                                                                                          | 6 custom plugins' worth of edge cases: CSP, worker origins, CSS injection, asset paths                              | **Defer** until after R2/R3 prove splitting in Webpack. Then compare fairly — and evaluate Rspack alongside. |
| 4   | **Vitest**                                   | Unified config with Vite; better watch mode; single assertion API                                                                                      | 110 files, 1,905 call sites, 313 `jest.mock()` migrations                                                           | **Defer.** Do R4 (`@swc/jest`) first — it may capture most of the speed for ~2h of work.                     |
| 3   | **Vite for extension host**                  | Consistency with the views build; possibly faster prod build                                                                                           | Hardest item for us: 3 entries, 18 native externals, CJS interop, packaging                                         | **Defer.** Lowest gain-to-risk ratio of the set.                                                             |
| 1   | **ESM package**                              | Unlocks item 3; modern module semantics                                                                                                                | Highest blast radius: packaging, `__dirname`, worker resolution, native deps, compiled tests, **engine floor bump** | **Defer / decide separately.** Not required for items 2, 5, 6.                                               |
| 7   | **Oxlint + Oxfmt**                           | Faster lint/format                                                                                                                                     | Re-tuning rules; churn across the codebase; a second linter to maintain                                             | **Skip for now.** No measured pain here.                                                                     |

### H.4 What we'd gain _only_ by matching — versus what's available cheaper

This is the crux of the analysis.

**Gains genuinely unique to matching them:**

- **A single transform pipeline** for dev, build, and test. If you adopt Vite _and_ Vitest,
  one resolver/transform config serves all three. This is Vitest's own stated rationale, and
  it is a real long-term maintenance reduction — it is not, primarily, a speed argument.
- **Native-ESM dev server semantics** — on-demand module transforms and Vite HMR. Webpack's
  dev model cannot replicate this; Rspack partially can.
- **Shared solutions with a sibling team.** Their `docs/webview-build.md` becomes usable
  documentation for your problems, and fixes flow both ways.

**Gains that do _not_ require matching them** (already covered in Part F, Tier 1):

- Per-view code splitting → **Webpack feature you disabled**, not a Vite feature.
- Stable vendor chunks → `optimization.splitChunks` today.
- Bundle visibility → `webpack-bundle-analyzer`, already installed, currently commented out.
- Faster tests → `@swc/jest`, already installed, currently unused.
- Real integration tests → `@vscode/test-electron`, already installed.

**So the honest framing is:** the largest measurable wins available to you right now
(a 6.4 MB single-chunk webview bundle and a type-checking test transform) are **not** things
Cosmos DB's stack gives you and yours withholds. They are things your current stack already
offers and your configuration currently declines.

### H.5 Where we are ahead — and a concrete action that helps both repos

A notable asymmetry surfaced during this research [MEASURED]:

Cosmos DB's `main` still uses its own local webview RPC packages. But the branch
`dev/tnuam/use-npm-webview-api` removes them in favour of **`@microsoft/vscode-ext-webview`** —
the package _this_ repo owns and publishes (`packages/vscode-ext-webview`, v0.10.1).

That branch also records a concrete Vite integration finding, in commit `620206e`:

> `@microsoft/vscode-ext-webview` ships CommonJS. List its dev-facing subpaths in
> `optimizeDeps.include` so Vite pre-bundles the CJS→ESM interop shim at dev-server start,
> instead of triggering a re-optimize and a full webview reload the first time a panel opens.
> _Dev-only and removable once the package ships an ESM build._

Verified against this repo: `packages/vscode-ext-webview/tsconfig.json` sets
`"module": "commonjs"`, and its `exports` map exposes only a `default` condition per subpath —
no `import` condition, no `module` field. It is **CJS-only**.

**R13. Ship a dual ESM + CJS build of `@microsoft/vscode-ext-webview`.** _(effort: ~1 day)_

Gains, in order of value:

1. **Better tree-shaking in the webview bundle.** CJS is hard to statically analyse, which
   works directly against R2/R3 — the 6.4 MB problem. This is a _current_ cost, not a
   future-Vite cost.
2. Removes the workaround already required downstream in Cosmos DB.
3. Removes a known first-panel reload penalty from any future DocumentDB Vite adoption.
4. Improves the package for every external consumer.

This is a rare item that is cheap, benefits the current Webpack setup, benefits a sibling team
today, and de-risks a possible future migration. It should sit in Tier 1.

### H.6 What matching would cost us that is easy to overlook

- **Engine floor.** Cosmos DB ships ESM at `vscode ^1.109.0`; you are at `^1.105.0`. Confirm
  the minimum VS Code version supporting ESM extension entry points before committing —
  raising the floor drops users on older builds. This is a product decision, not a build one.
- **Two migrations at once.** Their #2999 changed the bundler _and_ the test runner in one PR.
  With 3,406 tests, doing the same here would make any regression hard to attribute.
- **Loss of a stable baseline.** Until R1 gives you bundle numbers and R4 gives you a fair test
  baseline, a migration cannot be evaluated — only asserted.
- **Config ownership doesn't disappear.** You would trade ~470 lines of Webpack config for
  ~507 lines of Vite config plus six custom plugins. The maintenance is different, not absent.

### H.7 Net verdict

If the goal is _measurable improvement_, match them **partially and in this order**:

| Action                                                                                                                                                         | Rationale                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Match now:** staged coexistence method; real Extension Host integration tests; small Playwright smoke suite; vendor-chunk discipline; bundle reporting in CI | Fills genuine holes or is free                               |
| **Do instead of matching:** enable code splitting; `@swc/jest`; dual-build the webview package (R13)                                                           | Captures the biggest measured wins at a fraction of the cost |
| **Defer, decide on data:** Vite for webviews (compare against Rspack); Vitest                                                                                  | Only justified after a fair baseline exists                  |
| **Skip for now:** ESM extension host; Vite for extension host; Oxlint/Oxfmt                                                                                    | Highest cost, least evidence of benefit for this codebase    |

Expected outcome of that subset: most of the user-visible performance benefit Cosmos DB got,
plus the test-confidence layers they built, **without** the ESM blast radius, the engine-floor
bump, or a 1,905-call-site test migration — while keeping the option to adopt Vite later on
evidence rather than on analogy.

---

## 10. Part I — Measured: rebuilding their repo before and after

### I.1 Why this was worth doing, and the design

Everything in Parts B–C rests on _their_ claims. Those claims cover build time only — they never
published output size, VSIX size, or test-runner timings. Those are exactly the questions that
matter for a go/no-go decision here.

A rare opportunity makes a **controlled** experiment possible: commit `1ae9fd8` (PR #2997) has
**Webpack and Vite configs in the same tree**, with `webpack-prod`, `vite-prod` and `jesttest`
all present. Building both from identical source removes every confound — same dependencies,
same code, same machine, same minification intent.

**Environment:** Linux, 16 cores, 31 GB RAM, Node 22.21.1, npm 10.9.3. Clean builds (both
scripts begin with `rimraf ./dist`). Single runs — treat ±10% as noise.

| Point  | Commit                           | State                                          |
| ------ | -------------------------------- | ---------------------------------------------- |
| Before | `1ae9fd8` (PR #2997, 2026-04-30) | Webpack default; Vite present; Jest + ts-jest  |
| After  | `f0f606f` (PR #2999, 2026-04-30) | Vite default; Vitest; Webpack and Jest removed |

### I.2 Build: Webpack vs Vite, identical source

| Metric                         | Webpack          | Vite            | Delta            |
| ------------------------------ | ---------------- | --------------- | ---------------- |
| **Build wall-clock**           | **71,510 ms**    | **7,975 ms**    | **8.95x faster** |
| `dist` total (`du -sb`)        | 20,315,268 B     | 16,113,151 B    | −20.7%           |
| Top-level JS + MJS             | 9,486,599 B      | 5,264,154 B     | **−44.5%**       |
| JS/MJS chunk count             | 24               | 27              | +3               |
| Monaco core chunk              | 3,616,832 B      | 2,260,518 B     | **−37.5%**       |
| `main.mjs` (extension host)    | 1,953,201 B      | 1,524,722 B     | −21.9%           |
| **`dist` zipped (VSIX proxy)** | **10,999,997 B** | **9,904,851 B** | **−10.0%**       |

**Their published claim reproduced.** They reported ~30s vs ~4s (8x). We measured 71.5s vs 8.0s
(8.95x). Both absolute numbers are ~2.2x slower on this machine, but **the ratio replicates
independently** — which is the part that transfers.

**Important fairness check.** This is not a rigged comparison in Webpack's disfavour:

- Their Webpack views config already enables `usedExports: true`, `sideEffects: true`
  (tree shaking) and a full `splitChunks` setup with `monaco`, `react-vendor`, `fluent-icons`
  cache groups.
- Terser runs with `mangle: true` and **no** `keep_fnames`/`keep_classnames`, so Webpack is not
  penalised by name preservation.
- Both externalize `vscode`/`vs`.

**The one real caveat — and it matters.** The Vite build at this commit is **not production-
complete**. It emits _no_ Monaco worker files and no codicon font, where Webpack emits
`json.worker.js` (784,419 B), `editor.worker.js` (654,938 B) and an 80,340 B `.ttf`. It also
emits CSS to `dist/assets/` that was **not yet linked into the webview HTML** — which is
precisely the bug PR #3037 fixed three weeks later.

Correcting for the missing ~1.52 MB of workers + font:

| Measure            | Raw delta | Completeness-adjusted delta |
| ------------------ | --------- | --------------------------- |
| Top-level JS + MJS | −44.5%    | **≈ −29%**                  |
| Zipped package     | −10.0%    | **≈ −6–7%**                 |

So the honest headline is: **Vite/Rollup produced roughly 30% less JavaScript from identical
source**, largely through better tree-shaking and flat-scope hoisting rather than any
configuration trick.

### I.3 Answering the VSIX question directly

> _"did they manage to reduce the size of the vsix?"_

**Yes, but far less than the bundle numbers suggest — roughly 6–10%.**

The reason is instructive: a 44.5% cut in raw JavaScript became only a 10.0% cut in the zipped
package (≈6–7% adjusted). Two effects compress the win:

1. **About half the package is not JavaScript.** Of Webpack's 20.3 MB `dist`, ~10.2 MB is
   copied `resources/`, `l10n/`, `syntaxes/`, `skills/` and `NOTICE.html` — byte-identical in
   both builds.
2. **A VSIX is a ZIP.** Minified JS compresses well regardless of who minified it, so raw-size
   advantages shrink substantially after deflate.

**Read-across for us:** our `dist` is 131 MB with a 6.4 MB `views.js` and 15.8 MB `main.js`.
Bundler choice would trim the JS share; it would do nothing for the copied-asset share. If VSIX
size is a goal, auditing what gets copied into `dist` is likely worth more than changing
bundler — and it is free.

### I.4 Tests: the decomposition that changes the recommendation

Same 551 tests, 17 suites, same machine.

| Setup                                                           | Commit                | Reported | Wall-clock    | vs ts-jest |
| --------------------------------------------------------------- | --------------------- | -------- | ------------- | ---------- |
| Jest + **ts-jest** (their original)                             | `1ae9fd8`             | 21.342 s | **22,402 ms** | 1.0x       |
| Jest + **`@swc/jest`** (transform swapped, framework unchanged) | `1ae9fd8` + our patch | 1.695 s  | **2,681 ms**  | **8.4x**   |
| **Vitest** (their migration)                                    | `f0f606f`             | 0.974 s  | **1,729 ms**  | **13.0x**  |

**Attribution of the 20,673 ms total gap (wall-clock):**

| Source of speedup                                     | Amount    | Share     |
| ----------------------------------------------------- | --------- | --------- |
| Dropping `ts-jest` for a Rust/esbuild-class transform | 19,721 ms | **95.4%** |
| Vitest itself (over an already-fast Jest)             | 952 ms    | **4.6%**  |

This is the single most decision-relevant result in the whole document. "Tests run much faster
on the other framework" is **true in outcome but wrong in cause**. The framework contributes
about one twentieth of it. The rest is not running the TypeScript compiler inside the test
runner — which you can stop doing today, on Jest, in an afternoon.

**Caveats, stated plainly:**

- The `@swc/jest` run completed 515 of 551 tests because **one suite failed to run**:
  `src/utils/survey.initSurvey.test.ts` — `ReferenceError: Cannot access 'mockContext' before
initialization`, a `jest.mock()` factory referencing a `const` declared below it. `ts-jest`
  tolerated the hoisting; `@swc/jest` does not. If that suite is unusually slow, the 2,681 ms
  figure is slightly optimistic.
- Vitest ran all 551. Their PR #2999 notes they used `vi.hoisted` for hoisted mocks — i.e.
  **they had to fix the same class of problem**, just under different syntax.
- Single runs; no warm/cold cache control beyond clean checkouts.

**Direct read-across to this repo:** that failing file, `src/utils/survey.initSurvey.test.ts`,
**exists here too**, and we have 313 `jest.mock()` call sites. Expect a small number of hoisting
fixes on the `@swc/jest` path — and note that the Vitest path requires those same fixes _plus_
rewriting 1,905 `jest.*` call sites across 110 files.

### I.5 A side finding: dependency weight

`npm ci` package counts at the two commits:

| Commit    | Stack                           | Packages installed |
| --------- | ------------------------------- | ------------------ |
| `1ae9fd8` | Webpack + Jest (+ Vite present) | **1,385**          |
| `f0f606f` | Vite + Vitest                   | **784**            |

**−601 packages (−43%).** Consistent with their commit note about removing 52 packages just for
Mocha. Smaller install, smaller supply-chain surface, faster CI `npm ci` — a real benefit that
nobody quantified before now, and one that has nothing to do with runtime performance.

### I.6 What this changes in the recommendations

| Finding                                             | Effect on the plan                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| ~95% of test speedup is the transform               | **Strengthens R4** and further justifies deferring the Vitest migration until after it                                   |
| SWC hoisting failure is real                        | **Adds a known cost to R4** — small, but budget for it                                                                   |
| Vite produced ~29–44% less JS from identical source | **New, genuine argument for Vite** that no cheaper change replicates — raises the value of the R8 spike                  |
| VSIX only shrank ~6–10%                             | **Lowers** the priority of bundler choice if package size is the goal; **raises** the priority of auditing copied assets |
| Build ratio (~9x) reproduced                        | Vite's dev-loop advantage is real; still must be re-measured against our `swc-loader` baseline, not theirs               |
| −601 packages                                       | Adds a maintenance/supply-chain argument that was previously invisible                                                   |

**Net:** the case for `@swc/jest` (R4) is now strongly evidenced. The case for Vitest on _speed_
grounds is much weaker than folklore suggests. The case for Vite gains a **new** dimension —
output size — that is not available from any Webpack-side tuning, and that should now be an
explicit success criterion in the R8 spike.

---

## 11. Part J — esbuild and the Azure Tools path

Source: [`vscode-azuretools/eng/MIGRATION.md`](https://github.com/microsoft/vscode-azuretools/blob/main/eng/MIGRATION.md).
This matters more than a random third-party comparison, because that repo publishes the
`@microsoft/vscode-azext-*` packages **this extension depends on**.

### J.1 What esbuild is

A bundler and transformer written in Go. It is the fastest mainstream option and is deliberately
narrow in scope: it transforms and bundles: it is not a dev-server/framework tool. Vite itself
uses esbuild internally for dependency pre-bundling and TS/JSX transforms.

One constraint dominates everything below: **esbuild code splitting works only with `esm` output
format.** [VENDOR — esbuild docs; corroborated by the Azure Tools guide, which discusses splitting
exclusively in its ESM section.]

### J.2 What the Azure Tools team actually standardised

Not "esbuild" in isolation — a whole shared engineering package, `@microsoft/vscode-azext-eng`,
which supplies eslint config, esbuild config, Mocha setup, `vscode-test` config and vsce.
Consuming extensions **delete their own** lint/bundle/test/publish devDependencies — including
`typescript`.

| Element            | Their choice                                                                  |
| ------------------ | ----------------------------------------------------------------------------- |
| Bundler            | esbuild, via `esbuild.mjs` + `autoSelectEsbuildConfig()`                      |
| Entry              | `main.mjs` thin loader that `await import()`s the bundle                      |
| Node/VS Code floor | Node 22 → **minimum VS Code 1.101.0**                                         |
| ESM                | **Optional**, and its stated purpose is "allows ESBuild to do code splitting" |
| Unit tests         | **Mocha**, run directly on TS via Node `experimental-transform-types` + tsx   |
| VS Code tests      | `.vscode-test.mjs`                                                            |
| Webviews           | **Not addressed at all**                                                      |

### J.3 Three assumptions of ours that this corrects

**1. The engine-floor worry is largely defused.** [MEASURED / PUBLISHED]
I previously flagged that Cosmos DB ships ESM at `vscode ^1.109.0` while we are at `^1.105.0`.
The Azure Tools guide states the only hard floor as **Node 22 → VS Code 1.101.0**, and gives no
separate ESM engine requirement. We are already above that. Cosmos DB's 1.109 is therefore
likely unrelated to ESM. Still worth an empirical check, but this is no longer a likely blocker.

**2. Our main Azure dependency is already ESM-ready.** [MEASURED]
`@microsoft/vscode-azext-utils@4.1.0` ships **dual ESM/CJS** with a proper conditional exports map
(`import` → `dist/esm/...`, `require` → `dist/cjs/...`). Their guide requires `^4.0.4` for ESM;
we satisfy it. The other three are **CJS-only** (no exports map): `vscode-azext-azureutils@4.2.0`,
`vscode-azext-azureauth@4.1.1`, `vscode-azureresources-api@2.5.1`. Both Vite and esbuild handle
that through CJS interop — it is exactly why Cosmos DB injects a `createRequire` banner — but it
confirms we will need that shim.

**3. ESM is no longer a differentiator; it is a prerequisite.**
Vite is ESM-first. esbuild needs ESM **to code-split at all**. Since per-view code splitting is our
headline problem, **every path that solves it requires ESM.** ESM therefore stops being a
cost to weigh against Vite and becomes a shared precondition.

### J.4 esbuild vs Vite on the dimensions that matter here

| Dimension                                  | esbuild                  | Vite                                                                  |
| ------------------------------------------ | ------------------------ | --------------------------------------------------------------------- |
| Raw speed                                  | Fastest available        | Fast (uses esbuild for transforms; Rollup/Rolldown for prod)          |
| Extension-host bundle                      | Excellent fit            | Proven by Cosmos DB; measured **−21.9%** vs webpack on `main.mjs`     |
| Multiple entrypoints (we have **3**)       | Native, trivial          | Supported via `build.lib.entry` object / `rollupOptions.input`        |
| Externals (we have **18** optional/native) | Simple array/function    | Function-based; equally workable                                      |
| Code splitting                             | **ESM output only**      | Yes, with `manualChunks` control                                      |
| Tree-shaking quality                       | Good                     | Generally better (Rollup); we **measured −29% JS** overall vs webpack |
| React webviews                             | No HMR / no Fast Refresh | Dev server + HMR + React Refresh                                      |
| SCSS                                       | Needs a plugin           | Native                                                                |
| Monaco workers                             | Manual wiring            | Query-suffix support (they still needed a custom plugin)              |
| CSS emission for webviews                  | Basic                    | Full asset pipeline (still needs HTML `<link>` injection)             |
| Test-runner alignment                      | Mocha (their stack)      | Vitest shares the config/transform                                    |
| Config surface                             | Small                    | Larger (Cosmos DB: ~507 lines + 6 plugins)                            |

### J.5 The decisive observation

**The Azure Tools guide is silent on webviews.** Its entrypoint examples are "the extension itself
plus one for each language server". It is an excellent answer to _extension-host_ bundling.

Our actual pain is a **webview** problem: a 6.4 MB single-chunk `views.js` containing Monaco,
SlickGrid, Fluent UI and SCSS, needing HMR for development and CSP-correct assets in production.
esbuild alone does not address that, and `@microsoft/vscode-azext-eng` does not either.

### J.6 The three real options

| Option                                                                  | Shape                     | Pros                                                                                  | Cons                                                                                                             | Verdict                 |
| ----------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------- |
| **A. All-Vite** (Cosmos DB path)                                        | One tool, both targets    | Measured −29% JS / 8.95x build; best webview DX; Vitest alignment; one config surface | Larger config; we own the webview edge cases                                                                     | **Recommended**         |
| **B. All-esbuild via `@microsoft/vscode-azext-eng`** (Azure Tools path) | Shared eng package        | Ecosystem alignment; least bespoke host config; lint/test/publish included            | **No webview story**; pulls in Mocha, conflicting with Vitest; package is **alpha** (`latest` = `1.0.0-alpha.1`) | **Not viable alone**    |
| **C. Hybrid** — esbuild for host, Vite for webviews                     | Two tools, one per target | Best-of-both; esbuild is a natural fit for a 3-entry Node bundle                      | Two config surfaces to maintain; splits the "do it once" story                                                   | **Documented fallback** |

**Recommendation: Option A**, for three reasons:

1. **`@microsoft/vscode-azext-eng` is alpha** (`latest: 1.0.0-alpha.1`, `alpha: 1.1.0-alpha.3`).
   Building a "do it once, stay future-proof" migration on an alpha shared eng package is the
   opposite of future-proof.
2. **It is a whole opinionated stack, not a bundler.** Adopting it means adopting their Mocha and
   ESLint choices too, which conflicts with the Vitest direction and deepens Azure-Tools coupling
   at a time when this extension is positioning as DocumentDB-first.
3. **Rollup's tree-shaking is what produced the measured win.** The −29% figure came from
   Vite/Rollup. esbuild's tree-shaking is good but generally less aggressive, and nobody has
   measured it here.

**Trigger for falling back to Option C:** if the extension-host Vite build proves genuinely painful
— specifically the 18 optional/native externals, the 3 entrypoints, or CJS interop with the
mongosh/kerberos family — swap **only that target** to esbuild. The webview decision is unaffected.

### J.7 Steal these regardless of bundler choice

The guide contains hard-won gotchas that apply to us whichever path we take:

| Gotcha                                                                                                                           | Why it matters here                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `"type": "module"` is required or **telemetry silently breaks**                                                                  | We have substantial telemetry; this is a silent failure we would ship                                                                                  |
| `main.mjs` becomes a thin loader that `await import()`s the bundle                                                               | Clean pattern; also removes the bundled-vs-unbundled env-var switch                                                                                    |
| "A lot of the time, the externals are no longer needed — do your research"                                                       | We carry **18**. Auditing them is likely to shrink the bundle for free                                                                                 |
| "Build your VSIX, unzip it, compare contents to the previous version"                                                            | Adopt directly into the Phase 0 checklist                                                                                                              |
| Tests import a **copy** of `src`, not the extension's live instance — so `extensionVariables` and other shared state do not work | Independently matches Cosmos DB's conclusion that integration tests must target the public API surface. Design our Phase 4 tests that way from day one |

---

## 12. Part K — Consolidated adoption checklist

Every "steal this" item found across all three reference projects, in one place. Nothing here is
new — it is an index into the detail, so this section can be worked through without re-reading the
document.

> **For value / complexity / carrying-cost scores on these items**, and for the option neither
> reference project chose, see the companion document's
> [Part 7](./e2e-testing-strategy.md#7-recommendations--scored-and-not-limited-to-copying). This
> section is the index; Part 7 is the decision artifact.

### K.1 From Cosmos DB — build & bundling

| #   | Pattern                                                                                                                   | Why                                                                                  | Detail      |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------- |
| 1   | **Coexistence phase**: add the new bundler alongside the old, keep the old as default, flip only after benchmarking       | Makes every step reversible; it is how they de-risked the whole program              | Part B      |
| 2   | **Named vendor chunks** via `manualChunks` — `monaco-editor`, `fluentui`, `griffel`, `react`, `react-data-grid`, `vendor` | Cacheable, predictable, parallel-loadable; avoids the "chunk name lottery"           | Part B      |
| 3   | **Keep heavy libs out of the shared `vendor` chunk** when only some views use them                                        | Exactly our Local Quick Start / Atlas Credentials problem                            | Part B, A1  |
| 4   | **Do not force-group lazily-imported code into named chunks**                                                             | Silently defeats the `await import()` boundary                                       | Part B      |
| 5   | **`optimizeDeps.include`** for Fluent UI / Griffel / our own CJS packages                                                 | Prevents a dev re-optimize + full webview reload on first panel open                 | Part B, H.5 |
| 6   | **`server.warmup`** for webview sources                                                                                   | They measured ~1.5 s of first-open transform waterfall without it                    | Part C1     |
| 7   | **Bundle report committed to CI**                                                                                         | Bundle regressions are otherwise invisible                                           | Part F (R1) |
| 8   | **Document non-obvious build settings in one file** (their `docs/webview-build.md`)                                       | `base`, worker format, `assetsDir`, CORS, CSP, font inlining each have a real reason | Part B      |

### K.2 From Cosmos DB — testing

| #   | Pattern                                                                                           | Why                                                                                 | Detail       |
| --- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------ |
| 9   | **`consoleHealth` with an empty allowlist** — fail on any `console.error` from the webview origin | Arguably their best idea; catches CSP, asset and runtime errors automatically       | E2E doc §1.3 |
| 10  | **Worker-scoped Playwright fixtures** + `closeAllEditorTabs` in `afterEach`                       | ~5 s vs ~50 s per 10-test file                                                      | E2E doc §1.3 |
| 11  | **Activation handshake before any spec runs**                                                     | Removes a whole class of flake                                                      | E2E doc §1.3 |
| 12  | **Test-only commands** gated by env var **and** context key                                       | Reach real states fast without shipping them to users                               | E2E doc §1.3 |
| 13  | **Build-mode marker** in staleness checks, not just mtime                                         | A dev watch build looked "fresh" and silently broke E2E (their #3164)               | E2E doc §1.3 |
| 14  | **Run-scoped isolation** (`runId` + temp/results/reports dirs)                                    | Parallel workers and repeat runs never collide                                      | E2E doc §1.3 |
| 15  | **Self-managed screenshot/trace capture** with env-var modes                                      | Playwright's declarative capture does not apply to a manually launched Electron app | E2E doc §1.3 |
| 16  | **Separate Docker project + ports** for any test backend                                          | Never touches the developer's own instance                                          | E2E doc §1.3 |
| 17  | **Integration tests target only the public API surface**                                          | Independently confirmed by the Azure Tools guide (see #22)                          | Part B       |

### K.3 From Azure Tools (`vscode-azuretools/eng/MIGRATION.md`)

| #   | Pattern                                                                                   | Why                                                                      | Detail |
| --- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------ |
| 18  | **`"type": "module"` is mandatory or telemetry silently breaks**                          | We have substantial telemetry; this is a failure we would ship unnoticed | J.7    |
| 19  | **`main.mjs` as a thin `await import()` loader**                                          | Also removes the bundled-vs-unbundled env-var switch entirely            | J.7    |
| 20  | **Audit externals — "a lot of the time they are no longer needed"**                       | We carry **18**; removing stale ones shrinks the bundle for free         | J.7    |
| 21  | **Unzip the VSIX and diff against the previous version**                                  | Cheap, catches packaging surprises; folded into Phase 0                  | J.7    |
| 22  | **Tests import a _copy_ of `src`** — shared state like `extensionVariables` will not work | Design Phase 4 integration tests around the public API from day one      | J.7    |
| 23  | **Type-check as a separate `--noEmit` step** alongside bundling                           | Neither esbuild nor Vite type-checks; `tsc` must stay in the pipeline    | J.4    |

### K.4 From Ref1 — bundler-migration failure classes and test infrastructure

Ref1 is an internal, more mature sibling extension; its architecture report is distilled in the
companion document §5. It migrated the extension host from unbundled `tsc` output to a bundled
artifact, and its build files document what broke. Names and paths are redacted; the mechanics are
not.

| #   | Pattern                                                                                    | Why                                                                                                         | Detail              |
| --- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------- |
| 24  | **Ban `const enum` (`isolatedModules: true`) before migrating**                            | `tsc` inlines the values; esbuild/Rollup cannot inline across a `.d.ts` boundary and fails to resolve       | E2E doc §5.14       |
| 25  | **Audit our code and `node_modules` for `__dirname` / `__filename` / `require.resolve`**   | These break moving _to_ ESM, mirroring how `import.meta.url` broke for them moving to CJS. Five-minute grep | E2E doc §5.14       |
| 26  | **Every optional guarded `require` needs an explicit `external`**                          | `try { require('x') } catch {}` for uninstalled packages otherwise fails the bundle                         | E2E doc §5.14       |
| 27  | **`keepNames` in production** if anything compares `constructor.name` / `fn.name`          | Minification renames them; the failure appears **only** in production builds                                | E2E doc §5.14       |
| 28  | **Never mark a type-only ambient module `external`**                                       | Converts a compile-time no-op into an unguarded runtime `require` that crashes activation                   | E2E doc §5.14       |
| 29  | **Unify the build: one pipeline for dev, tests and packaging**                             | Their two-mode setup means the tests do not run the code that ships — the root cause of all of the above    | E2E doc §5.14       |
| 30  | **`metafile` / bundle stats on from day one**                                              | "Why did the bundle grow 400 KB?" answerable without archaeology                                            | E2E doc §5.14       |
| 31  | **Hand-maintained entry-point list, not globbing**                                         | Lets you deliberately exclude an entry and document why                                                     | E2E doc §5.14       |
| 32  | **Installed-VSIX activation check on every PR touching build config**                      | Their equivalent lane is dispatch-only, so their bundler migration was never continuously validated         | E2E doc §5.4        |
| 33  | **Launch-arg rewriter that _throws_ if `--extensionDevelopmentPath` survives**             | Makes "green build that silently tested source" structurally unrepresentable                                | E2E doc §5.4        |
| 34  | **Console-error + `pageerror` assertions with an empty allowlist**                         | Ref1 has none and calls it its own biggest gap; it is the best detector of module-resolution breakage       | E2E doc §5.5, §5.6  |
| 35  | **A readiness contract in the product** (`data-webview-id` + `data-ready`)                 | ~60 lines of product code that deletes several hundred lines of test heuristics, permanently                | E2E doc §5.7        |
| 36  | **Convention scanner in `--strict` mode, in PR CI, from day one**                          | Agent-written specs follow visible patterns and ignore prose rules                                          | E2E doc §5.8, §5.12 |
| 37  | **Build-once-distribute with _post-archive_ verification**                                 | Catches the `nullglob` failure mode where a glob expands to nothing and the archive ships incomplete        | E2E doc §5.8        |
| 38  | **Fail the build when the notification path itself fails** (`!= 'false'`, not `== 'true'`) | Otherwise broken alerting is discovered after a month of silent red                                         | E2E doc §5.8        |
| 39  | **Never put a test seam at the layout boundary**                                           | Their 23 test-only buttons distorted hit-testing for every other test                                       | E2E doc §5.6        |

### K.5 Ours to fix (found during this research)

| #   | Item                                                                              | Detail    |
| --- | --------------------------------------------------------------------------------- | --------- |
| 40  | Remove `LimitChunkCountPlugin({ maxChunks: 1 })` and lazy-load views              | A1, F(R2) |
| 41  | Replace `ts-jest` with a fast transform; expect `jest.mock()` hoisting fixes      | A2, I.4   |
| 42  | Ship a dual/ESM build of `@microsoft/vscode-ext-webview` (helps tree-shaking now) | H.5       |
| 43  | Re-enable the bundle analyzer (installed, currently commented out)                | F (R1)    |
| 44  | Audit what gets copied into `dist` — ~half the VSIX is non-JS assets              | I.3       |
| 45  | Restore a real `npm test`                                                         | F (R6)    |

---

## Appendix A — Reproducing the measurements

```bash
# Webview bundle size and whether it is minified
ls -la dist/views.js dist/main.js
head -c 300 dist/views.js && wc -l dist/views.js

# Which views pull heavy libraries
for v in localQuickStart atlasCredentials collectionView documentView; do
  echo "== $v"
  grep -rhoE "from '[^']*(monaco|slickgrid|react-data-grid)[^']*'" "src/webviews/documentdb/$v" | sort -u
done

# Test baseline (run 3x, take median)
npx jest --no-coverage

# Confirm transform in use
grep -rn "ts-jest\|swc/jest" jest.config.js packages/*/jest.config.js
```

### Cross-repo benchmark (Part I)

Reproduces the controlled Webpack-vs-Vite and ts-jest/swc-jest/Vitest comparisons.

```bash
git clone --filter=blob:none https://github.com/microsoft/vscode-cosmosdb.git /tmp/cosmosdb
mkdir -p /tmp/cosmos-bench

# "Before": Webpack + Vite coexist in one commit, Jest still present
git -C /tmp/cosmosdb worktree add /tmp/cosmos-bench/at-2997 1ae9fd8
cd /tmp/cosmos-bench/at-2997 && npm ci

time npm run webpack-prod      # measured: 71.5 s
du -sb dist && (cd dist && zip -qr /tmp/webpack.zip .)

time npm run vite-prod         # measured:  8.0 s
du -sb dist && (cd dist && zip -qr /tmp/vite.zip .)

npx jest --silent              # measured: 22.4 s wall (ts-jest)

# Transform-only swap: keep Jest, change ts-jest -> @swc/jest
npm i --no-save @swc/jest @swc/core
# write jest.swc.cjs with transform '^.+\\.tsx?$': ['@swc/jest', ...]
npx jest -c jest.swc.cjs --silent   # measured: 2.7 s wall

# "After": Vite default + Vitest
git -C /tmp/cosmosdb worktree add /tmp/cosmos-bench/at-2999 f0f606f
cd /tmp/cosmos-bench/at-2999 && npm ci
npx vitest run --silent        # measured: 1.7 s wall

# Cleanup (each worktree carries a full node_modules)
git -C /tmp/cosmosdb worktree remove --force /tmp/cosmos-bench/at-2997
git -C /tmp/cosmosdb worktree remove --force /tmp/cosmos-bench/at-2999
```

## Appendix B — Source trail

**Cosmos DB (public):**

- PR #2997 — ESM + Vite alongside Webpack; **"~4s vs webpack ~30s (~8x faster)"**; 2026-04-30
- PR #2999 — Vite default + Jest→Vitest; "All 536 unit tests pass"; 2026-04-30
- PR #3037 — production webview render + CSS fix; 2026-05-18
- PR #3136 — Vitest integration runner + Playwright E2E; 2026-06-10
- PR #3164 — production-build guard for E2E; 2026-06-18
- PR #3169 — Monaco workers under Vite dev server; 2026-06-23
- PR #3172 — React component tests (jsdom + Testing Library); 2026-06-23
- `docs/webview-build.md`, `docs/test-configuration.md`, `vite.config.views.mjs`, `vitest.config.ts`, `playwright.config.ts`
- Branch `dev/tnuam/use-npm-webview-api` (**not merged to `main`**) — commits `f8d11a9` (remove
  local `@cosmosdb/webview-rpc`) and `620206e` (pre-bundle `@microsoft/vscode-ext-webview`
  subpaths in dev, with the CJS rationale quoted in H.5); 2026-07-29

**Cosmos DB, Rev 6 re-review (2026-09-30, `main` at `07ac7f86`):**

- PR #3217 / `800cb298` - adopt `@microsoft/vscode-ext-webview` on `main`; Vite `optimizeDeps` for its CJS subpaths; 2026-08-26
- `9fb37690`, `e7049bda` - adopt `@microsoft/vscode-ext-webview-fluentui`; Vitest `server.deps.inline` and `deps.optimizer.ssr` rationale; 2026-09-16
- PRs #3275, #3278, #3280, #3289 - ADO `networkisolation: DefaultDeny`; `npm test` disabled in ADO; 2026-08-18/19
- PRs #3272, #3281, #3284 - dependency bump reverted, relanded as feed-safe lockfile-only; 2026-08-18/19
- PR #3286 - pinned local `vsce` for signing; 2026-08-19
- PR #3288 - external URI activation race; 2026-08-19
- PR #3367 - proxy routing through VS Code, plus an isolated proxy/TLS launcher; 2026-09-29
- `plugins/vite-plugin-inline-css.mjs` - CSS through JS because the webview HTML has no `<link>` hook
- Issue #926 (this repo) - fluentui sourcemaps and theme gaps reported from Cosmos DB's adoption

**Ref1 (internal, redacted):** a ten-chapter architecture report on an internal sibling extension's
E2E system and build pipeline, produced for this research. Not committed — it cannot be sufficiently
anonymised. Distilled in the companion document §5; build-relevant findings in §5.14 and K.4.

**Vitest docs (vendor):** `vitest.dev/guide/why`, `vitest.dev/guide/comparisons`

**This repo (measured 2026-08-07):** `webpack.config.views.js`, `webpack.config.ext.js`,
`jest.config.js`, `packages/*/jest.config.js`, `src/webviews/index.tsx`,
`src/webviews/_integration/WebviewRegistry.ts`, `src/webviews/_integration/configuration.ts`,
`src/webviews/typings.d.ts`, `packages/vscode-ext-webview/package.json`,
`packages/vscode-ext-webview/tsconfig.json`, `dist/`
