---
kind: review
status: historical
---

> Re-evaluated against the merged branch in Stage 7: see [07-stage-reviews-reevaluation.md](./07-stage-reviews-reevaluation.md).

# Stage 4 AI review: webviews to Vite, split per view

- **Reviewer:** GPT-6.1 Sol (GitHub Copilot agent), in a fresh session with no involvement in
  Stage 4 implementation.
- **Model-family note:** The plan picked GPT-6 Sol as Stage 4 reviewer; the operator requested
  GPT-6.1 Sol in this fresh session instead. The recorded authors are Claude Opus 5.5 and
  GPT-6.1 Sol, so this review is partly same-family. This is not the separate-vendor validation
  pass specified by CONTRIBUTING.md; no such pass is claimed.
- **Range reviewed:** `cb9986f4..9dbb9436`, **21 commits**, all with `S4:` subjects, verified with
  `git rev-list --count cb9986f4..9dbb9436` and `git log --oneline`. The initial HEAD was
  `9dbb9436617230ad583e26adb4cc73aa695a7faa`, on `dev/tnaum/modernization`; the worktree was clean.
- **Method:** [CONTRIBUTING.md](../../../../CONTRIBUTING.md#61-stage-1-ai-review-pass-run-by-the-contributor)
  section 6.1 steps 1 to 4: initial edge-case review, fetch PR reviewer comments, validate
  findings against code and artifact probes, then an independent sweep. Steps 1, 3 and 4 were
  performed by this reviewer, not by a second model. PR #880 remains draft and had **0 review
  comments and 0 reviews**, so step 2 had nothing to merge. Read the plan's ground rules,
  L1/L2/L2-dev/L3 requirements and Stage 4 record, S3-F05/S3-F08, and the reference extension's
  Vite config, plugins and webview-build rationale. Source, configs, tests and the plan were
  not modified.

## Checks run by the reviewer

Local checks were at `9dbb9436`, with Node **22.21.1**, npm **10.9.3**. Browser runs used
`playwright-core` **1.54.2** from the supplied `/tmp/s4-pw`, headless Chromium, the supplied
`LD_LIBRARY_PATH`, and `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1`; **not** `bypassCSP`.

| Check                                                                                           | Result                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Range, branch, worktree and PR metadata                                                         | 21 `S4:` commits; requested branch/tip; clean initial worktree; draft #880; no reviewer comments/reviews.                                                                                                                                                                                                                                                                                                                                      |
| `npm run build`                                                                                 | Pass, including all six workspace builds and the root type check.                                                                                                                                                                                                                                                                                                                                                                              |
| `npm run test:verification`                                                                     | Pass: **57 Node tests**, **6 browser test files / 82 Vitest tests**.                                                                                                                                                                                                                                                                                                                                                                           |
| `node_modules/.bin/tsc --noEmit --project build/verification/browser/tsconfig.json`             | Pass.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `node_modules/.bin/vitest run --no-coverage src/webviews/_integration/WebviewRegistry.test.tsx` | Pass: **1 file / 1 test**.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `npm run package`                                                                               | Pass: **139 files**, **9,320,483 bytes**. SHA-256 `1c48eeeb8f3abf0854855b3273f1c24e6f17179da77cf1f889436fab86301fbb`. The retained webpack host emitted two warnings: optional `supports-color` resolution and Express's expression-based dependency.                                                                                                                                                                                          |
| `npm run verify:vsix -- vscode-documentdb-0.11.0.vsix`                                          | Pass. Manifest report: **21 added, 6 removed, 1 size change** beyond tolerance; VSIX delta **-276,937 bytes**.                                                                                                                                                                                                                                                                                                                                 |
| `npm run prove:vsix -- vscode-documentdb-0.11.0.vsix`                                           | Pass: **11 PASS lines**: ten rejections and the positive asset-change reporting control; no Vite controls skipped.                                                                                                                                                                                                                                                                                                                             |
| L2 preparation and headless run of the generated `integrated-all-checks.js`                     | Pass: **five positive views**, no unexpected errors, both rendered-editor worker round-trips; CSS-negative page verified with **exactly seven CSS/layout failures** and nothing else. An initial invocation used invalid `--out`; the CLI rejected it, then the documented `--output` invocation succeeded.                                                                                                                                    |
| L2-dev generated `/scenarios/run-all.js`, all themes                                            | **First run: 41/42 ready, 59/59 assertions evaluated passed, one timeout** waiting for the Windows Docker install host call in the light theme. **Full rerun: 42/42 ready, 60/60 assertions passed, zero errors.** Five additional isolated runs of that failed route passed. The initial failure is not erased by the rerun.                                                                                                                  |
| L2-dev install-link mutation, using intercepted transformed responses only                      | For the three dark-theme Docker-missing routes, forcing the Linux guide made **exactly Windows and macOS URL assertions fail**; Linux passed; readiness stayed true and app diagnostics stayed clean. Both restored routes passed in a fresh browser context. The first restoration reused intercepted module-cache contents and still saw the mutation; that probe-cache effect was eliminated by the fresh context, without touching source. |
| L2-dev failure controls                                                                         | Removing `localQuickStart.getDockerStatus` from the intercepted fixture produced `ready: false` and `No query fixture for localQuickStart.getDockerStatus`. An injected `console.error` after ready produced `data-ready="failed"` with its reason.                                                                                                                                                                                            |
| Inspector probes on copied VSIX/reports                                                         | **Confirmed gaps:** removing a live grammar and the shell declaration file still passes L1 (S4-F01); an active unrelated non-literal import can occupy the Monaco allowance and still pass L1 (S4-F02).                                                                                                                                                                                                                                        |
| Retained webpack views config, production build redirected to `/tmp`                            | Pass; named `render` retained; **6,457,422-byte** single entry at the current lazy-registry source. Fresh compilation's Monaco module comparison: **247 editor/contrib, 28 editor/standalone, 2 JSON language modules** in both webpack and Vite, no missing/extra modules in those sets, excluding worker-URL wrappers.                                                                                                                       |
| Shipped JavaScript, graph and font inspection                                                   | `render` present; literal relative view imports; no CSS preload targets; font is a shipped **80,340-byte TTF**; workers are separate files and constructed through Blob module imports. No production `18080`, `DEVSERVER`, `@vite/client`, React Refresh, scenario boot or harness markers.                                                                                                                                                   |
| Fresh-dependency scan with `--fail-on-fresh --now 2026-10-05T11:52:56.758Z`                     | Pass: root **1,636 locked versions / 0 fresh**, API **116 / 0 fresh**; six root git/private/unpublished entries have no public-registry time. Lockfile range adds only `@vitejs/plugin-react@6.1.1`, with **no existing version changes**.                                                                                                                                                                                                     |
| `gh run view 37305697560` and its logs/step conclusions                                         | Exact-tip dispatch at `9dbb9436`: **all four jobs passed**. Individual localization, lint and formatting steps passed; full Vitest **297 files / 4,589 tests**; verification **57 + 82** tests; all **11 L1 proof lines**; **L3 PASS and L3 PROOF PASS on VS Code 1.109.0**. This was existing CI, not a run dispatched by the reviewer.                                                                                                       |
| VS Code 1.109.0 service-worker source check                                                     | Resource responses carry `Access-Control-Allow-Origin: *`; blob/dedicated-worker client lookup is present. Confirms the trampoline's stated platform assumption in source, not its execution in a real webview here.                                                                                                                                                                                                                           |
| Vite server HTTP/CORS probes                                                                    | `/views.js` and scenario runner return 200. `/views.js` reflects an allowed `vscode-webview://review-origin`; an unrelated HTTPS origin receives no allow-origin header. Servers were stopped after use.                                                                                                                                                                                                                                       |
| `npx prettier --check docs/ai-and-plans/modernization/iterations/04-stage4-review.md`           | Initial check requested formatting; targeted `prettier --write` on this file, then the final check passed.                                                                                                                                                                                                                                                                                                                                     |

**Side effects:** packaging regenerated the ignored production outputs, bundle reports and local
VSIX. The review's webpack comparison used a different output directory and omitted only the
root-writing report plugin; the real compilation supplied its module list. It did not replace
the Vite report or shipped output. Probe artifacts were created only under `/tmp` and cleaned
up; pre-existing author artifacts were not deleted. Only this review file is committed.

## Findings

### S4-F01: report-only manifest drift no longer protects live non-JavaScript assets

- **Severity:** medium. **Validation:** confirmed by a full L1 run on a mutated copy of the
  packaged VSIX, with the original, unmodified bundle reports.
- **Where:** [inspect.cjs:27](../../../../build/verification/inspect.cjs#L27),
  [inspect.cjs:59](../../../../build/verification/inspect.cjs#L59) and
  [inspect.cjs:76](../../../../build/verification/inspect.cjs#L76); implementation `b47627f1`.
  The decision and invariant claim are at
  [build-and-test-stack.md:1919](../build-and-test-stack.md#L1919), `44d5488e`.
- **What is wrong.** Making arbitrary file-list/size drift informational is an explicit,
  recorded choice, not itself an accidental bug. But the replacement required-files list is
  not a complete runtime-asset invariant. The webpack host report hashes JavaScript only;
  Vite hashes its own outputs, not the host's copied grammars or declarations.

  The reviewer removed both
  `extension/syntaxes/documentdb-playground.tmGrammar.json` and
  `extension/typeDefs/documentdb-shell-api.d.ts`. **`inspect()` still passed**, merely listing
  the deletions in `manifestReport.removed`. The installed manifest still declares that grammar;
  the TS plugin still needs the shell declaration asset. Neither L2's five panel fixtures nor
  activation-only L3 exercises these consumers. Before this range, exact file-list comparison
  rejected either deletion. Thus there is a real loss of missing-asset coverage, despite the
  record's statement that hard failures stay for every invariant. The current positive-control
  asset removal proves that reporting works, not that required runtime assets are protected.

  All those assets exist in the reviewed package today: this is a gate regression, not a claim
  of a currently broken shipped playground. The record correctly labels option A as
  **not operator-approved** and asks G4 to confirm/reverse it; this review supplies the missing
  consequence for that decision.

- **Solutions:**
  1. Retain informational drift, but require manifest-declared local runtime paths and a small
     explicit list for runtime-discovered assets, including the shell declaration.
     **Pros:** preserves asset evolution and hashed-chunk churn without re-baselining; catches
     real packaging omissions. **Cons:** the explicit runtime-discovered list needs maintenance;
     contributed-path handling needs validation and tests.
  2. Restore the exact normalized file-list gate until Stage 6, with intentional baseline updates.
     **Pros:** restores the old protection immediately. **Cons:** rejects harmless asset changes
     and creates the re-baselining work option A was intended to avoid.
- **Recommended:** option 1; add negative controls deleting a contributed grammar and the shell
  declaration, requiring their specific missing-runtime-asset diagnostics. At G4 explicitly
  approve/reverse the manifest decision with this lost coverage disclosed; do not equate the
  present eleven controls with preservation of the old missing-file invariant.
- **Copilot comment:** none.
- **Author decision (coordinator, 2026-10-05; not an operator decision):** accepted; option 1
  implemented in `dda2734c`. Manifest-declared local paths (17, derived generically from the
  packaged `package.json`) and an explicit, commented list of 22 runtime-read assets (the shell
  `.d.ts`, prompt bodies, panel and tree icons, debug overrides) are hard failures again.
  Unrelated file drift stays informational. New controls `missing-contributed-grammar` and
  `missing-runtime-asset` reject the reviewer's two probes with their specific messages. The
  plan's claim that "hard failures stay for every invariant" was qualified in the Stage 4
  record. The manifest decision itself still needs the operator at G4.

### S4-F02: the Monaco allowance identifies a syntax slot, not an unused loader call

- **Severity:** low (no offending active import in today's output). **Validation:** confirmed
  by AST inspection and a full L1 run on a copied VSIX with matching copied asset hashes.
- **Where:** [inspect.cjs:23](../../../../build/verification/inspect.cjs#L23),
  [inspect.cjs:149](../../../../build/verification/inspect.cjs#L149) and
  [inspect.cjs:212](../../../../build/verification/inspect.cjs#L212); `0e990aef`, following
  `8feb2349`.
- **What is wrong.** The filename, Vite ownership, empty template quasis and count caps are
  useful restrictions. They reject a third worker import and imports in other chunks. However,
  `allowIdentifier: true` permits **any** single identifier inside the one Monaco template
  import. The worker alternative validates the member names `asBrowserUri(...).toString(...)`,
  but neither rule checks the enclosing bootstrap/foreign-module loader or the expression's
  provenance. The invariant relies on those calls being unused, which the predicate does not
  establish.

  In the actual chunk the permitted ``import(`${t}`)`` is inside `$loadForeignModule`. The probe
  replaced that unused expression with `Promise.resolve({})` and appended an unrelated active
  top-level import, with `s4UnreviewedSpecifier = "./missing-s4-allowlist-proof.js"` and
  ``import(`${s4UnreviewedSpecifier}`)``. It refreshed the copied report's byte hash/size to model
  newly built matching output. **Full L1 passed despite the absent target.** This is not
  stale-report acceptance and not a demonstrated production defect; it shows that a future
  active import can silently reuse the reviewed allowance.

- **Solutions:**
  1. Keep the filename/shape/count checks, also requiring the actual enclosing foreign-loader
     or worker-bootstrap AST context; add a control with the same shape at top level.
     **Pros:** narrows the allowance to the code whose non-use was reviewed, without changing
     Monaco. **Cons:** the validator must be revisited if upstream/minified loader structure changes.
  2. Replace the known unused upstream loading paths at build time with explicit unsupported
     operation errors, then reject all non-literal imports.
     **Pros:** removes the unverifiable loading paths entirely. **Cons:** patches upstream
     behavior and needs stronger upgrade/feature-parity coverage; substantially more intrusive.
- **Recommended:** option 1 before treating the allowlist as a general non-literal-import guard
  in subsequent stages. Preserve fail-closed count limits and reviewed source reasoning.
- **Copilot comment:** none.
- **Author decision (coordinator, 2026-10-05; not an operator decision):** accepted; option 1
  implemented in `3bb7e09b`. Both allowed forms must be inside a function. The identifier form
  must be bound in its enclosing scope from `<X>.asBrowserUri(…).toString(…)` (checked with an
  acorn ancestor walk). The filename, ownership and count limits are unchanged. New control
  `allowlisted-shape-at-top-level` rejects the reviewer's probe. Option 2 (patching Monaco's
  loaders) was rejected as more intrusive than the risk justifies.

### S4-F03: artifact runtime checks pass, but they do not close the real-origin G4 gate

- **Severity:** info. **Validation:** confirmed for the artifact and platform-source facts;
  real `vscode-webview://` execution **not reproduced**.
- **Where:** [vite.config.views.mjs:60](../../../../vite.config.views.mjs#L60),
  [monaco.mjs:85](../../../../build/vite/monaco.mjs#L85),
  [inline-css.mjs:35](../../../../build/vite/inline-css.mjs#L35), `769a2971`;
  [WebviewController.ts:300](../../../../packages/vscode-ext-webview/src/host/WebviewController.ts#L300)
  supplies the unchanged production policy.
- **What is right.** Production uses relative script-resource URLs, keeps the named export, keeps
  fonts out of `data:`, rewrites the actual codicon CSS URL against `import.meta.url`, and emits
  no per-chunk stylesheet references after deleting the concatenated CSS asset. The lightweight
  views fetched neither Monaco nor SlickGrid. Both editor-originated worker probes completed
  through the real emitted Blob/module trampoline. Fresh webpack compilation confirms the
  editor-feature module sets, and `keepNames: false` does not newly remove a guarantee the
  old production views build provided: the fresh webpack bundle has **1,459 short class names**.

  The trampoline intentionally differs from the reference extension's inline-worker choice.
  Monaco 0.52's `getWorkerUrl` path creates module workers; `importScripts` would be wrong.
  VS Code 1.109.0's service worker explicitly provides resource CORS headers and worker-client
  lookup, supporting the chosen `import` path. The reference plugin's claim that production
  resource responses lack CORS headers is not a sound reason to reject this implementation.

  **What remains unproved:** L2 serves the document and resources from one HTTP origin.
  Therefore it does not exercise the actual custom-scheme/resource-origin boundary, VS Code's
  service worker/local-resource-root enforcement, or a real editor's F5/HMR loop. L3's green
  activation result adds no panel/worker coverage. The plan explicitly reserves these for G4;
  the authors' record does not falsely claim they ran.

- **Solutions:**
  1. Keep this implementation and run the installed-VSIX G4 checklist, capturing worker/font
     requests and console output in a real webview, plus F5/HMR and all themes.
     **Pros:** tests the actual boundary and preserves the measured size win.
     **Cons:** requires the operator/editor environment.
  2. Change to inline worker bytes now to eliminate the production worker fetch.
     **Pros:** removes that worker CORS dependency. **Cons:** adds roughly the recorded 870 KB,
     does not remove cross-origin chunk/font dependencies, and discards a mechanism already
     used by webpack without evidence of a failure.
- **Recommended:** option 1. No source change on this finding; do not close G4 based solely on
  the static browser and activation checks.
- **Copilot comment:** none.
- **Author decision (coordinator, 2026-10-05; not an operator decision):** accepted as
  information; no source change. The real-origin, theme, worker, font and F5/HMR checks are
  listed for the operator at G4, and G4 is not claimed as passed. The reviewer's one-off
  L2-dev timeout (Windows, light theme) is recorded in the Stage 4 record as a watch item.

## Independent sweep

- **Per-view graph and non-vacuity.** [viteViewGraph](../../../../build/verification/inspect.cjs#L335)
  includes the entry's static closure plus the selected direct lazy chunk's static closure,
  not every dynamic child of the entry. Each facade must exist and be a direct entry dynamic
  import; registry-map tests prevent unnoticed name/path drift. Lightweight exclusion is on
  by default for Vite even if an option says false. Missing lazy chunks and duplicate BSON
  have working controls. The Monaco/SlickGrid exclusion controls mutate reports rather than
  rebuilding code; they establish inspector behavior, not independent metadata extraction.
  The current emitted graph and actual L2 fetches agree.
- **What each view actually loads.** JavaScript graph bytes, excluding workers/font, reproduce
  the execution record exactly: Local Quick Start **1,561,824**, Atlas Credentials **1,515,441**,
  Cluster Dashboard **1,704,959**, Document View **4,820,202**, Collection View **6,052,379**.
  The SlickGrid chunk is **756,981 bytes**, matching the replacement baseline. Entry module IDs
  contain the provider/registry/boot code, not lazy roots or Monaco/SlickGrid JavaScript.
  Fluent/React shared grouping and global CSS are intentional; this is not CSS isolation.
- **S3-F05 and S3-F08.** Ownership now covers packaged `.js`, `.cjs` and `.mjs`; `.cjs` gets
  CommonJS parsing, and report hashes bind emitted bytes, including Vite workers and the
  post-injection entry. S3-F05's current hole is closed. Host graphs still require exactly one
  BSON implementation. Views use none, consistently with the pre-stage code comment and
  zero-or-one rule; changing the literal plan wording from "exactly one" to "at most one" is
  not a new runtime concession made here. S3-F08's runtime identity probes remain for the
  webpack host; there is no actual browser BSON consumer to identity-probe in this stage.
  Vendored/renamed copies outside the detector's known BSON paths remain its acknowledged limit.
- **L2 changes do not weaken its intended assertions.**
  [playwright.ts](../../../../build/verification/browser/playwright.ts) retains settling,
  style, worker and diagnostic failures. `page.evaluate` polling changes how readiness is
  observed, not the CSP delivered to application code. `__name` supplies tsx's external helper
  binding, not a page CSP exemption. `about:blank` isolates successive documents before
  observers attach; reading the upload body avoids navigation aborts. The new CSS-negative
  mode preserves Fluent/Griffel styles, requires that a marked stylesheet was actually removed,
  and rejects missing markers in split entries. It is more targeted than removing all styles,
  not a vacuous control: the packaged negative run produced exactly seven failures.
- **L2-dev contracts and isolation.**
  [core/fixtures.ts](../../../../build/verification/browser/core/fixtures.ts) and
  [scenarios.ts](../../../../build/verification/browser/scenarios.ts) type paths, output payloads
  and assertion inputs against the router; defaults reuse L2 fixture objects. Runtime unknown
  paths/type mismatches fail explicitly, escaping calls are logged, and late errors continue
  to set failure after ready. The server plugin is `apply: 'serve'`; scenario modules are not in
  production module IDs/output. Prior local report snapshots and this rebuild have the same
  `views.js` hash, `b7ee9b93f3447f859bda60c6232bd350a1799cd18f4ed7c686b5b14b135aefae`.
  The initial Windows/light timeout merits tracking if it recurs; no root cause or product
  regression was established. A report's `ready: true` is deliberately separate from assertion
  success: the mutation reports prove consumers must inspect both fields.
- **Lazy registry, host and l10n.** `ca13fcae` retains exactly the five-name type union.
  Suspense loading starts after `render()` calls `l10n.config`; the host's type-only reference
  is elided, with no registry module in its report. The Local Quick Start call-time translation
  pattern is retained. Shared vendor modules still evaluate before the boot function, so this
  is a guarantee about lazy view roots, not every module in the graph.
- **Flip and retained fallbacks.** `10e62925` wires default and win32 normal/pre-release
  packaging through workspace-prebuilt `build-prod`, webpack host, Vite views. `build-dev`
  selects explicit development `NODE_ENV`; production strips the ResizeObserver detector.
  `watch:views` serves Vite; the custom ready matcher releases the background task; on-disk
  development output is not required for that loop. `063e242b` limits the task change and
  restores indentation. The webpack configs/scripts remain, and the retained views config
  was successfully rebuilt by this reviewer. Packaging's cleanup removes stale chunks; the
  Vite build itself correctly leaves the host's shared output directory intact.
- **CI/ADO and size reporting.** Both pipelines already call `npm run package`, so the Vite
  flip flows through without another packaging-command edit. GitHub's new manifest-report
  artifact upload ran successfully; ADO still uses offline inspection before signing.
  The PR size comparison still measures only the **568,837-byte entry**, not per-view totals:
  an apparent approximately 90% drop is misleading. This is already explicitly deferred to
  Stage 6 in the record, not a newly discovered omission. ADO itself was not run here.
- **Dependency/record audit.** Only the older `@vitejs/plugin-react@6.1.1` is added; the fresh
  scan reproduces the recorded counts and needs no quarantine pins/overrides. Implementation
  hashes cited inline resolve to the described changes; the follow-up documentation commits
  are prompt and distinguish authors, alternatives, deviations and operator-only steps.
  Package/file/chunk sizes, the export, module sets and L2 claims were independently reproduced.
  The report-only decision was deliberately pulled forward without approval, clearly disclosed;
  its invariant-preservation claim needs the qualification in S4-F01. This review's initial
  L2-dev failure limits how strongly to generalize the recorded clean run, but does not prove
  that the authors did not run it. There is no evidence that an unrun real-origin, HMR, Windows
  or ADO check was presented as passed.

## Verification limits

- No production panel was opened in an actual `vscode-webview://` document by this reviewer.
  The real-origin, installed-VSIX themes/editing/fonts, F5/HMR, Windows/macOS and pre-release
  packaging checks remain operator work. The static-origin browser checks are not a substitute.
- L3 was **observed in exact-tip CI**, not run locally, and proves activation only. No ADO
  release/signing run, backend operation, real playground/TS-server interaction or native
  optional dependency was exercised.
- The mutation proof changed transformed HTTP responses, not the working tree, and covered
  the three relevant dark-theme install-link routes. The unmutated full scenario matrix was
  separately run twice; the first transient failure and later passes are reported above.
- This is **Case 1**, still-working/draft PR review, not a ready-for-review handoff. The local
  full Case 2 suite, including `prettier-fix`, was **deferred until ready for review**. Existing
  CI's green checks are reported separately; they are not a claim that local Case 2 ran.
- The strong-model/different-vendor validation step of CONTRIBUTING.md section 6 was not
  independently supplied. Operator approval of the manifest decision and author decisions
  on these findings remain pending.

## Summary for G4

| Severity | Count |
| -------- | ----- |
| critical | 0     |
| high     | 0     |
| medium   | 1     |
| low      | 1     |
| info     | 1     |

No confirmed current production webview regression. Address the missing-runtime-asset guard
(S4-F01), explicitly decide the manifest deviation, and complete the real-origin G4 checklist.
Harden the Monaco allowlist (S4-F02) before relying on it as protection against new non-literal
imports in later stages. The automated green artifact/CI checks do not themselves close G4.
