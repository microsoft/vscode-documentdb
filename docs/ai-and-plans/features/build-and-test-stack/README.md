---
feature: build-and-test-stack
kind: readme
status: active
created: 2026-10-14
verified: 2026-10-14
code:
  - vite.config.ext.mjs
  - vite.config.views.mjs
  - vitest.config.ts
  - main.ts
  - build/vite/**
  - build/verification/**
  - test/vitest/**
  - .github/workflows/main.yml
---

# Build and test stack

**Status:** active. The modernization iteration is still running; Stages 9 and 10 are pending.

The extension host and all webviews are built with Vite. Vitest runs the extension and workspace
package unit tests. The extension host is ESM, with a small CommonJS exception for the TypeScript
server plugin. All seven workspace packages ship ESM only. The repository targets TypeScript 6.

Code and tests are authoritative for behavior. This folder records the constraints and why they
exist. Start with [design.md](./design.md) when changing bundle format, resolution, chunks, assets,
or test loading.

## Where things live

| Path                                                                                   | Responsibility                                                                                                                                                                    |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`vite.config.ext.mjs`](../../../../vite.config.ext.mjs)                               | Builds the ESM extension loader, playground worker, and CommonJS TypeScript server plugin. It also defines host aliases, externals, copied assets, and production bundle reports. |
| [`vite.config.views.mjs`](../../../../vite.config.views.mjs)                           | Builds `views.js`, lazy view chunks, vendor groups, inlined CSS, Monaco workers, and the source scenario server.                                                                  |
| [`build/vite/`](../../../../build/vite/README.md)                                      | Local Vite plugins and the detailed rationale for non-obvious build settings.                                                                                                     |
| [`vitest.config.ts`](../../../../vitest.config.ts)                                     | Defines the extension project and seven workspace-package projects, their environments, aliases, isolation, and file patterns.                                                    |
| [`test/vitest/`](../../../../test/vitest/)                                             | The shared `vscode` mock and the CommonJS loader hook used by extension tests.                                                                                                    |
| [`build/verification/`](../../../../build/verification/README.md)                      | Packaged-artifact inspection, activation, browser fixtures, package checks, runtime probes, negative controls, and CI report formatting.                                          |
| [`build/verification/browser/`](../../../../build/verification/browser/)               | Typed L2 fixtures, the packaged browser harness, and L2-dev scenarios.                                                                                                            |
| [`build/verification/package-checks/`](../../../../build/verification/package-checks/) | Packed workspace-package validation and the unbundled `/host` probe.                                                                                                              |
| [`.github/workflows/main.yml`](../../../../.github/workflows/main.yml)                 | Selects the CI tier, path-scoped checks, artifacts, and the combined PR report.                                                                                                   |

## Verification layers

[Decision 0002](./decisions.md#0002-ci-runs-verification-in-tiers-and-reports-what-it-ran-and-why)
defines the tiers. [Decision 0003](./decisions.md#0003-negative-controls-run-when-their-check-changes-not-every-pr)
keeps proof controls path-scoped instead of repeating them on every PR.

| Layer or check                                                     | Fast | Standard                                      | Full | Notes                                                                 |
| ------------------------------------------------------------------ | ---- | --------------------------------------------- | ---- | --------------------------------------------------------------------- |
| L0: build, localization check, lint, Prettier, type checks, Vitest | yes  | yes                                           | yes  | Fast is used for draft PRs and ordinary manual runs.                  |
| Workspace package checks                                           | no   | when `packages/**` changes                    | yes  | Runs `verify:packages` against packed artifacts.                      |
| L1: packaged VSIX inspection and size report                       | no   | yes                                           | yes  | Offline inspection of the built VSIX and its matching bundle reports. |
| L1 verification-tool tests and negative controls                   | no   | when verification or Vite paths change        | yes  | Includes `test:verification` and `prove:vsix`.                        |
| L3: installed-VSIX activation                                      | no   | yes                                           | yes  | Runs on GitHub Actions because it downloads and launches VS Code.     |
| L3 negative control                                                | no   | when verification or Vite paths change        | yes  | `prove:activation` proves an injected activation failure is detected. |
| Unbundled webview host probe                                       | no   | when `packages/vscode-ext-webview/**` changes | yes  | Characterizes ESM loading from real VS Code.                          |

A ready PR and a push to `main` or `release/**` use the standard tier. The one-shot
`ci:full-requested` label requests the full tier for a PR commit. The workflow report lists every
layer and why it ran or was skipped.

L2-dev is a development tool, not a CI layer. `npm run watch:views` serves typed source scenarios at
`http://localhost:18080/scenarios/`; browser tools drive `/scenarios/run-all.js`. Screenshots are
artifacts, not baselines.

The L2 production harness renders packaged webviews in an ordinary browser and is not wired into CI.
It remains a release check for this iteration. The planned E2E iteration will retire its useful
coverage into installed-workbench E2E; see the
[E2E strategy](../e2e-testing/strategy.md) and
[decision 0002](./decisions.md#0002-ci-runs-verification-in-tiers-and-reports-what-it-ran-and-why).

## Add a webview

1. Add the React root component and its host command or factory.
2. Add a `React.lazy` entry with a literal import to
   [`WebviewRegistry`](../../../../src/webviews/_integration/WebviewRegistry.ts). Pass the same key
   as `webviewName` to `openAppWebview`; the `WebviewName` type checks the host call.
3. Add the component's source path to `viewModules` in
   [`inspect.cjs`](../../../../build/verification/inspect.cjs). L1 uses this separate map to bind the
   registry entry to the packaged lazy chunk.
4. Add a typed settled-state fixture in
   [`fixtures.ts`](../../../../build/verification/browser/fixtures.ts). Unknown RPC paths must fail,
   not receive a generic success value.
5. Add the default and any useful development states to
   [`scenarios.ts`](../../../../build/verification/browser/scenarios.ts). Keep scenario paths in the
   form `/<view>/<scenario>/<theme>` and do not use query strings.
6. Run the relevant Vitest tests, package the VSIX, and run the L1 and browser checks described in
   [`build/verification/README.md`](../../../../build/verification/README.md).

## Add or bump a dependency

1. Use the repository Node and npm versions. Regenerate `package-lock.json`; do not hand-merge it
   during this iteration, per the
   [active plan ground rules](./iterations/01-modernization/build-and-test-stack.md#ground-rules).
2. Run the
   [fresh-dependency scan](../../../../.github/skills/flagging-fresh-dependencies/SKILL.md). The
   repository [Copilot instructions](../../../../.github/copilot-instructions.md) link this skill;
   the active plan records the current seven-day quarantine rule.
3. For host dependencies, review `isExternal` in `vite.config.ext.mjs`. The VSIX has no dependency
   tree, so only host-provided modules, Node built-ins, and deliberately supported runtime requests
   belong there. A normal dependency should remain bundled.
4. Build and package. Review the warning-only per-graph size report instead of only the size of
   `views.js`.
5. Run L1. If a dependency adds a non-literal dynamic import, inspect the runtime path before
   changing `nonLiteralImportBudget` in `inspect.cjs`; every budget entry needs a specific reason.
6. If a workspace package changed, run `npm run verify:packages` so checks execute against packed
   tarballs rather than workspace sources.

## Add a test

1. Put extension tests under `src/**/*.test.{ts,tsx}`. Put package tests under the include pattern
   for that package's project in [`vitest.config.ts`](../../../../vitest.config.ts).
2. Extension tests use the Node environment by default. Add `// @vitest-environment jsdom` at the
   top of a React test that needs a DOM. The Fluent UI package project uses jsdom for every test.
3. Import `vscode` normally. The extension project aliases it to
   [`test/vitest/vscode.ts`](../../../../test/vitest/vscode.ts), while
   [`setup.ts`](../../../../test/vitest/setup.ts) makes CommonJS dependencies receive that same mock.
4. Run the narrow file with `npx vitest run <path>`. Use `npm test` for the full Vitest suite.
5. Tests for verification tooling belong beside that tool and run through
   `npm run test:verification`, not the main Vitest project unless the local config says otherwise.

## Durable documents

- [Design and invariants](./design.md)
- [Standing decisions](./decisions.md)
- [Pipeline guide](./pipelines.md)
- [Deferred work](./future-work.md)
- [Modernization iteration](./iterations/01-modernization/build-and-test-stack.md) and its reviews
- [E2E strategy](../e2e-testing/strategy.md)
- [Data-grid replacement plan](../data-grid/slickgrid-removal.md)
