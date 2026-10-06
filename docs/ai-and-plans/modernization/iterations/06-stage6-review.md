---
kind: review
status: active
---

# Stage 6 AI review: remove webpack, lock in, TypeScript 6

- **Reviewer:** GPT-6 Sol (GitHub Copilot agent), independent of the Stage 6 implementation.
- **Model-family note:** Claude Opus 5.5 coordinated and authored parts of Stage 6, with Claude
  Opus 5.5 and GPT-6.1 Sol subagents. No author was GPT-6 Sol; the GPT-6.1 Sol contribution is
  same-vendor-family work. No separate different-vendor validation pass is claimed.
- **Range reviewed:** `8472f112..ece5acf8`, 18 `S6:` commits on
  `dev/tnaum/modernization`; the worktree was initially clean. Reviewed the diff excluding
  the current plan's Stage 6 execution record. For intent, used **only** the plan at
  `8472f112`, including its ground rules, L0-L3/L2-dev, G4 manifest decision, G5-I01 and G6.
  Read the earlier stage reviews and F17.
- **Method:** [CONTRIBUTING.md](../../../../CONTRIBUTING.md#61-stage-1-ai-review-pass-run-by-the-contributor)
  section 6.1 steps 1-4: edge-case diff review; fetch PR #880 review comments and conversation
  with `gh` (zero review comments/reviews; three issue comments); validate candidates against
  code and isolated artifact probes; independent sweep. All mutations and builds used a copy
  under `~/.cache/documentdb-modernization/tmp-review`, not product or tooling files. This
  uncommitted review is the only repository change; no branch switch, commit or push.

## Checks run by the reviewer

Node 22.21.1 on Linux/WSL. The isolated build produced a **204-file, 8,493,819-byte** VSIX;
its 20-byte difference from the supplied 8,493,839-byte file is consistent with repackaging
timestamps. Browser checks used the supplied headless Chromium kit without CSP bypass.

| Check                                                                    | Result                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch/range, PR comments and final-SHA CI                               | 18 commits; #880 draft and currently merge-conflicted. Run `37509399673` at `ece5acf8`: all four jobs successful; VSIX, bundle-report and L1-report artifacts present. Zero PR review comments or reviews.                              |
| `npm run build` in the copy                                              | Pass; all six packages and the root type check under TypeScript 6.                                                                                                                                                                      |
| `npm run package` in the copy                                            | Pass; 204 files, 8,493,819 bytes.                                                                                                                                                                                                       |
| `verify:vsix` on the copied build                                        | Pass: **13/13** graph budgets `ok`, no failures; informational manifest drift reported.                                                                                                                                                 |
| `prove:vsix` on the copied build                                         | **24 PASS**, including the kept-class-name and two graph-size controls.                                                                                                                                                                 |
| `test:verification`                                                      | **117 Node** and **79 browser** tests pass.                                                                                                                                                                                             |
| `npx vitest run --no-coverage`                                           | **298 files / 4,603 tests** pass.                                                                                                                                                                                                       |
| `verify:packages` and `npm pack --dry-run --json` for all six workspaces | Pass; no compiled tests in clean tarballs, consumer probes pass with their documented expected failures.                                                                                                                                |
| `test:vsix`, `prove:activation` with isolated Xvfb display               | **L3 PASS**, **L3 PROOF PASS**. A first attempt with the probe's `TMPDIR` inside its development checkout was rejected by the harness's deliberate development-path check; moving the temp directory to a sibling fixed the test setup. |
| `probe:host-unbundled -- --no-build` on the packed package               | **PASS**: CommonJS `require('./host')` hangs as documented; CommonJS `import()`, static and dynamic ESM succeed; missing-module control fails.                                                                                          |
| `measure:activation -- --runs 1` on the installed VSIX                   | Pass; packaged `vscode-documentdb/activate` debug telemetry event recorded with `result: Succeeded`, duration and main-file-load measures. This is not proof of remote ingestion.                                                       |
| L2 packaged and L2-dev headless checks                                   | **L2 HEADLESS PASS**: five positive views, both editor worker round-trips, seven expected CSS-negative errors. **L2-DEV PASS**: 42/42 routes ready, 60/60 assertions.                                                                   |
| Seven-day fresh-dependency scan with `--fail-on-fresh`                   | Pass: root lockfile 1,275 locked versions / 1,200 packages, API lockfile 116 / 106; **zero fresh** (six root entries not on the public registry).                                                                                       |
| Installed package count                                                  | `npm ls --all --parseable`: 1,256 paths including the root, hence **1,255 installed packages**, versus Stage 0's reported 1,836.                                                                                                        |
| Isolated mutations: stale test and font-size budget                      | Both reproduced and validated below; `verify:packages` accepted the stale test, and full L1 accepted the inflated font.                                                                                                                 |

## Findings

### S6-F01: an incremental package build can still publish compiled Vitest tests

- **Severity:** low (published-tarball hygiene; a clean checkout does not reproduce it).
  **Validation:** confirmed with an isolated incremental build, `npm pack --dry-run` and
  `verify:packages`.
- **Where:** [shell-runtime tsconfig](../../../../packages/documentdb-js-shell-runtime/tsconfig.json),
  also the [operator-registry tsconfig](../../../../packages/documentdb-js-operator-registry/tsconfig.json)
  and [shell-api-types tsconfig](../../../../packages/documentdb-js-shell-api-types/tsconfig.json);
  [package checks](../../../../build/verification/package-checks/check-packages.mjs).
- **What is wrong.** Excluding `src/**/*.test.ts` stops TypeScript 6 from emitting new test
  files but does not remove test JavaScript already in `dist/` from an earlier build.
  The package `files` allowlist includes `dist`, and the consumer verifier packs whatever
  is there without rejecting test files. In the copy, I placed one old-style
  `dist/__review_stale.test.js`, rebuilt only `shell-runtime`, and obtained a **32-file
  tarball containing that test**; `verify:packages` still reported "All package checks
  passed" (clean: 31 files). The old tsconfig included tests, so this is a realistic
  incremental-upgrade state. Clean CI builds and the current tarballs are unaffected.
- **Solutions:**
  1. Clean each affected package's `dist` before its build and assert that packed
     tarballs contain no `*.test.*` outputs. **Pros:** prevents stale output and proves
     the publication contract. **Cons:** removes incremental package build output and
     adds a packaging assertion.
  2. Exclude `dist/**/*.test.*` in the package allowlists and verify the exclusion with
     `npm pack --dry-run`. **Pros:** smaller publishing-only change. **Cons:** stale files
     remain on disk and the allowlist patterns need checking for each package.
- **Recommended:** 1; at minimum, make the tarball assertion fail closed before G6 publication.
- **Copilot comment:** none.
- **Author decision (coordinator, 2026-10-06; not an operator decision):** accepted; the
  recommended minimum, without the `dist` clean. Fixed in `b09b7629`: `verify:packages` fails a
  package whose packed file list contains test or spec output (JavaScript, declarations or
  maps), naming the files. A packed-fixture control (`dist/x.test.js`) is rejected for exactly
  that reason. The reviewer's scenario, a stale `dist/__stale.test.js` in `shell-runtime`, now
  fails with `packed test files are forbidden`. Three unit tests were added. Rejected: cleaning
  `dist` in the package build scripts, because that discards the incremental `composite`
  output; the assertion already guards the published bytes.

### S6-F02: a shipped font can grow without changing any per-view graph budget

- **Severity:** low (size-budget coverage gap; no present oversized or broken font).
  **Validation:** confirmed against full L1 with a copied VSIX and matching copied bundle
  report hash.
- **Where:** [measureSizeGraphs](../../../../build/verification/inspect.cjs#L865) and
  [size budget](../../../../build/verification/size-budget.json). The
  [budget documentation](../../../../build/verification/README.md#size-budget-enforced)
  describes JavaScript closures and separate worker graphs, but no font graph.
- **What is wrong.** The view budget sums report-owned **chunk** assets, not CSS-referenced
  assets. The packaged codicon font is report-owned and loaded by the views, yet belongs
  to none of the 12 host/view/worker graphs. In a copied artifact I appended 256 KiB to
  `codicon-DCmgc-ay.ttf` and refreshed its bundle-report SHA-256. The VSIX grew from
  8,493,819 to **8,753,637 bytes**, below the overall VSIX tolerance; full `inspect()`
  still passed with **all 13 graphs `ok` and every non-VSIX graph byte count unchanged**.
  This does not claim the altered font is an intended product asset. It demonstrates
  that a material change in a real view resource can evade the per-view size gates.
- **Solutions:**
  1. Include CSS-referenced assets in the entry/view resource graphs and prove one
     oversized-asset rejection. **Pros:** budgets complete loaded view payloads.
     **Cons:** CSS URL ownership and attribution across views add complexity.
  2. Add a separately budgeted, required codicon-font graph with a negative control.
     **Pros:** narrow and explicit for the currently unbudgeted shipped font.
     **Cons:** does not generalize to later CSS-linked assets.
- **Recommended:** 2 now; document that the per-view rows are JavaScript closures rather
  than all resources until option 1 is justified.
- **Copilot comment:** none.
- **Author decision (coordinator, 2026-10-06; not an operator decision):** accepted; a
  variant of option 2. Fixed in `9b489252`: a required `viewsAssets` graph sums every
  non-JavaScript asset owned by the views bundle report (today the 80,340-byte codicon font),
  so later CSS-linked assets are covered too without per-view attribution. `size-budget.json`
  gains only that entry. The `size-budget-views-assets` control grows the font in a copied
  artifact and is rejected on exactly `['viewsAssets']`. The README now says that the per-view
  rows are JavaScript closures. `prove:vsix` prints 25 PASS lines (re-run by the coordinator).
  Option 1 was not chosen.

## Independent sweep

- Webpack scripts, config, plugin and ESLint allowance are gone; inspection rejects
  non-Vite reports instead of accepting a webpack `.e(chunkId)` path. No required Vite
  control was retired. `.swcrc` was used for webpack loaders, while retained SWC
  dependencies are transitive. The committed `size-budget.json` matches all 13 measured
  graphs. The `bson` and `arm-resources-subscriptions` aliases, including `TODO(#990)`,
  remain in the host config; the build rationale covers both Vite environments, globals,
  absence of a `require` banner, externals, names and watch readiness.
- G4 option A remains intact: unrelated manifest drift is reported, while required
  manifest/runtime assets, hash provenance, class name and size budgets are hard
  failures. The refreshed controls reject missing grammar/declarations and both inflated
  graph cases. S1-F01's temporary PR-head checkout is removed; PR jobs again use the
  merge ref. Since #880 currently conflicts with `main`, a green manual-dispatch run
  on the head does **not** establish a green merged-PR run or exercise its PR comment.
  Its comment path is source-reviewed, not live-validated.
- S2-F06 and the temporary freshness overrides are removed; the surviving `glob` and
  `vite` overrides have recorded non-quarantine reasons. All package projects retain
  `NodeNext`; the root's two exact type-only `paths` aliases have explanations, no
  `baseUrl` or `"*"` mapping is present, and the build and consumer checks pass.
  S2-F03 remains open: [Vitest config](../../../../vitest.config.ts) still relies on
  default per-file isolation, and the [CJS `vscode` hook](../../../../test/vitest/setup.ts)
  does not receive per-file ESM factory mocks. Pin `pool: 'forks'`/`isolate: true` or
  retain this explicitly under #990; a production alias fix is not a test-mock fix.
- S3-F02 is now characterized, not concealed: the real unbundled `/host` test detects
  the CommonJS `require()` deadlock and the migration guide tells consumers to use
  `import()` or bundle. S3-F06 is fixed in clean tarballs, with the incremental exception
  above. F17's kept-name control and TypeScript 6 builds are present; the reviewer
  observed packaged **debug** activation telemetry, not a remote send or a production
  telemetry-ingestion guarantee. The Stage 4 `views.js`-only PR-size proxy is replaced
  by a per-graph report, with the font limitation above.

## Verification limits

- This is **Case 1** on a draft PR, not handoff for review. The full Case 2 suite,
  including `prettier-fix`, was **deferred until ready for review**. CI lint passed,
  but I did not run local lint, l10n, full Case 2 formatting or `npm run package`
  against the repository itself. `npx prettier --check` on this review is separate.
- No ADO build or Windows/macOS package Vitest run was available; S2-F01 remains
  operator-run. No actual signed ADO VSIX, real `vscode-webview://` panel, F5/HMR,
  cold-start URI, real editor plugin, Azure/Kubernetes/Atlas backend or remote
  telemetry ingestion was tested. The headless HTTP-origin browser check is not a
  real VS Code webview-origin check.
- No second, different-vendor validator performed CONTRIBUTING.md section 6.1
  step 3. The author/operator must decide findings; the tests here are independent
  probes, not operator approval of G6.

## Summary for G6

| Severity | Count |
| -------- | ----- |
| high     | 0     |
| medium   | 0     |
| low      | 2     |
| info     | 0     |

The isolated Stage 6 build, package, budgets, negative controls, browser checks,
package contracts and installed activation pass, as do all four exact-SHA GitHub
Actions jobs. Address or explicitly accept S6-F01 and S6-F02. G6 still needs an
operator decision on the open S2-F03 mock assumption and unbundled `/host` behavior,
the **Windows ADO npm-package test (S2-F01)**, feed-safe merge/conflict resolution
and a merged-PR CI run, plus the full installed-VSIX manual checklist on Linux and
Windows/macOS. Then run Case 2 and the required AI pre-review, mark #880 ready,
merge, publish the decided package versions, build and sign in ADO from `main`,
record the signed digest, run L1/L2/L3 on **that exact signed file**, and approve
release only for that digest. None of those operator actions is claimed complete.
