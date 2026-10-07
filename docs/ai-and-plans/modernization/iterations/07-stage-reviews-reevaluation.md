---
kind: review
status: active
---

# Stage 7: re-evaluation of every stage review against the merged branch

- **Date:** 2026-10-07.
- **Branch / HEAD:** `dev/tnaum/modernization`; the per-file re-evaluations were made at
  `946f7961`, the merge of `main` `1380b758`. HEAD then advanced to `63a69976`, which only
  removed the `glob` npm override (manifest and lockfile); the re-evaluations apply there too.
  The cross-review and coordinator observation use `63a69976`.
- **Method:** Each re-evaluator was independent and read-only, given the review file, the
  plan's inline record for the stage and the code at the merged HEAD, and nothing the
  Stage 7 authors reasoned. Evidence qualifications and later observations are retained
  below; this consolidation does not claim to rerun their product checks.

**Who re-evaluated what**

| Review file / part                              | Written by                                         | Re-evaluated by |
| ----------------------------------------------- | -------------------------------------------------- | --------------- |
| `00-stage0-review.md`                           | GPT-6 Sol                                          | Claude Opus 5.5 |
| `01-stage1-review.md`                           | Claude Opus 5.5                                    | GPT-6 Astra     |
| `02-stage2-review.md`                           | Claude Opus 5.5                                    | GPT-6 Astra     |
| `03-stage3-review.md`                           | Claude Opus 5.5                                    | GPT-6 Astra     |
| `04-stage4-review.md`                           | GPT-6.1 Sol                                        | Claude Opus 5.5 |
| `05-stage5-review.md`                           | GPT-6 Astra                                        | Claude Opus 5.5 |
| `06-stage6-review.md` main (S6-F01, S6-F02)     | GPT-6 Sol                                          | Claude Opus 5.5 |
| `06-stage6-review.md` addendum (S6-F03, S6-F04) | Claude Opus 5.5                                    | GPT-6 Astra     |
| `06-pr-pre-review.md`                           | Claude Opus 5.5 (step 1), GPT-6.1 Sol (steps 3, 4) | GPT-6 Astra     |
| Cross-review and combined-migration sweep       | n/a                                                | GPT-6 Astra     |
| X7-F09                                          | n/a                                                | the coordinator |

Plan line numbers cited below refer to `build-and-test-stack.md` at `63a69976`.

## Summary

These tables count each historical finding once in its owning review/part, including
Stage 5's own sweep items. Re-checks of earlier findings, X7-F01–F09 and SW7-F01 are not
included in these historical-review totals. Informational assurances and accepted limits
are not all defects. “Still open” for S5-SW10 is recorded as still valid, deferred to
Stage 9, consistently with that re-evaluator's status-count classification.

| Review file / part           | Resolved | Still valid | Obsolete | False positive in hindsight |  Total |
| ---------------------------- | -------: | ----------: | -------: | --------------------------: | -----: |
| 00-stage0-review.md          |        1 |           0 |        1 |                           0 |      2 |
| 01-stage1-review.md          |        2 |           4 |        0 |                           2 |      8 |
| 02-stage2-review.md          |        2 |           5 |        0 |                           7 |     14 |
| 03-stage3-review.md          |        2 |          10 |        1 |                           0 |     13 |
| 04-stage4-review.md          |        3 |           0 |        0 |                           0 |      3 |
| 05-stage5-review.md          |        5 |           9 |        0 |                           0 |     14 |
| 06-stage6-review.md main     |        2 |           0 |        0 |                           0 |      2 |
| 06-stage6-review.md addendum |        2 |           0 |        0 |                           0 |      2 |
| 06-pr-pre-review.md          |        0 |           6 |        0 |                           0 |      6 |
| **Total**                    |   **19** |      **34** |    **2** |                       **9** | **64** |

| Current severity of still-valid historical findings |  Count |
| --------------------------------------------------- | -----: |
| Critical                                            |      0 |
| High                                                |      0 |
| Medium                                              |      2 |
| Low                                                 |     18 |
| Info                                                |     14 |
| **Total**                                           | **34** |

**Still valid, by severity**

- **Medium**
  - PR-F01: Remaining merged-tree browser and ADO validation gap.
  - PR-F02: Package verification missing from general CI and ADO.
- **Low**
  - S1-F02: Missing error-helper assertions and environment parity coverage.
  - S1-F03: Unused environment helper retained without a consumer.
  - S1-F04: Final Stage 1 CI record contradicts successful run.
  - S2-F02: Unit-test wall-time cost remains without worker-cap decision.
  - S2-F03: Implicit isolation and split VS Code mock identities.
  - S2-F04: Incorrect namespace explanation survives the safe runtime replacement.
  - S2-F05: Stage 2 CI failure and correction remain misrecorded.
  - S2-F07: Fast CI paths skip root test-source type checking.
  - S3-F01: Latent bundled shell declaration reader uses wrong directory.
  - S3-F04: BSON constructor probes still omit dynamic import routes.
  - S3-F06: Compiled tests fixed but declaration maps lack sources.
  - S3-F07: Stage 3 factual record remains inaccurate and stale.
  - S5-SW5: Cold-start URI journey remains untested with accepted risk.
  - S5-SW12: Windows checked but macOS execution remains unverified.
  - PR-F03: Three 0.9.0 packages lack consumer migration notes.
  - PR-F04: Root emission and removed-tool configuration leftovers remain.
  - PR-F05: Formatting gate omits maintained build and bundler tooling.
  - PR-F06: Modernization rationale navigation and active design remain stale.
- **Info**
  - S1-F07: CI checkouts still persist unnecessary Git credentials.
  - S3-F08: Probe bundles do not prove shipped-artifact BSON identity.
  - S3-F09: Package versions and runtime floors remain consistently declared.
  - S3-F10: Workspace Vitest interop override removal remains sound.
  - S3-F11: L2 harness still executes the actual host template.
  - S3-F12: ESM checks sound but consumer TypeScript caveat missing.
  - S3-F13: tsx migration intact while maintenance URLs remain stale.
  - S5-SW1: Babel import allowance checks shape rather than provenance.
  - S5-SW2: Lazy SSH dependency remains an unguarded runtime external.
  - S5-SW3: PAC-proxy branch retains a latent require.resolve path.
  - S5-SW4: Azure module formats duplicate without demonstrated broken exchange.
  - S5-SW8: Local telemetry observation does not prove remote ingestion.
  - S5-SW10: Full Case 2 verification remains deferred to Stage 9.
  - S5-SW11: Execution record committed but coordinator decisions await confirmation.

## Per-review tables

### 00-stage0-review.md

Original: [00-stage0-review.md](./00-stage0-review.md).

| ID                                                       | Original severity | Current status | Current severity | Decision carried out?                                    | Evidence                                                                                                                                                                                                                                | Action |
| -------------------------------------------------------- | ----------------- | -------------- | ---------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| F01: webpack chunk IDs crossed compilation boundaries    | medium            | obsolete       | n/a              | yes: fixed as recorded; later removed with webpack       | First resolved in `c1d29535` = `a0836927` on HEAD's ancestry; `0843c1d0` deleted the `.e(chunkId)` resolver and collision test. `inspect.cjs:494-496` rejects non-Vite reports; no webpack file at HEAD.                                | none   |
| F02: standalone worker proof bypassed Monaco integration | medium            | resolved       | n/a              | yes: standalone worker replaced by rendered-editor proof | `c1d29535` + `0be05e8c` = `a0836927` + `88b568cf`; `browser/runtime.ts:108-230` observes production-bundle workers; `browser/playwright.ts:150-196` types into the real editor and rejects missing/mismatched proof; CI `main.yml:170`. | none   |

#### Notes

- **F01:** The fix landed as recorded. `a0836927` has the same patch-id as the cited `c1d29535` and
  added `webpack chunk IDs cannot resolve against another compilation` (inspect.test.cjs).
  `0843c1d0` (S6) removed that test, the `r.e(<number>)` branch and webpack. At HEAD, dynamic
  imports must be literal paths, resolved against packaged files (`inspect.cjs:571-574`). Lazy
  graphs are resolved per report (`viteChunkClosure`, `inspect.cjs:635-660`), so there are no
  numeric chunk IDs left to collide. The Vite-only rule is tested in `Vite-owned numeric .e calls
are not webpack chunk loaders` (inspect.test.cjs:871). One leftover difference: HEAD requires at
  least one owning report (`inspect.cjs:506`), not exactly one. See cross-review observation 2.
- **F02:** At HEAD, the editor-originated proof is covered in `runtime.test.ts` by:
  - `never constructs a standalone worker or sends its own messages when checking` (l.202)
  - `requires model synchronization, a matching editor request, and a correlated diagnostic response` (l.211)
  - `does not accept a main-thread marker or a worker reply that has no highlight` (l.325)

  `playwright.test.ts` adds `fails a success-shaped report that has no rendered-editor worker
evidence` (l.205). CI runs these through `test:verification` (`main.yml:170`). The real L2 run
  stays agent-run at gates. The plan records L2 headless passes with both worker round-trips in
  Stages 4 and 6 (plan l.2159-2169, 2900, 2949, 3136). I did not re-verify those runs. The `main`
  merge `946f7961` changed only `package-lock.json` and two ADO YAML files. It did not touch
  `src/webviews`, `build/verification` or `vite.config.views.mjs`.

The Stage 0 re-evaluator's cross-review observation 2 is consolidated as X7-F08 below.

#### Deferred items

- **Real-host L3 with the injected-error control:** done. It passed in run 36979370550 at
  `a6689e76` (= `b3a42db6` on HEAD's ancestry). It is still wired in CI (`main.yml:286`,
  `xvfb-run ... test:vsix`).
- **Operator-run ADO build:** done. G0 passed at `266aa693`, which is an ancestor of HEAD
  (plan l.554).
- **Installed-VSIX G0 manual checklist:** done, per the operator record in the plan (l.549-551).
  This is an operator claim; it cannot be verified from code.
- **BSON deviation (zero BSON modules allowed in browser graphs):** accepted at G0 (plan l.411).
  HEAD implements the accepted rule in `summarizeGraph`, `inspect.cjs:619-626`: browser graphs may
  have at most one BSON module, host graphs exactly one.
- **Adapt the L2 CSS-negative control when Stage 4 extracts CSS:** done. Vite inlines the CSS with
  the `data-documentdb-views-css` marker (`build/vite/inline-css.mjs`). The harness requires that
  marker (`browser/harness.ts:79-81`).
- **PR #880 readiness, Case 2 and the CONTRIBUTING §6 pre-review:** still open by design. The PR is
  an open draft (`gh pr view 880`). This moves to Stage 9.
- **Real `vscode-webview://` worker behavior:** still an operator-only check by design. L2 is a
  static-origin check.

### 01-stage1-review.md

Original: [01-stage1-review.md](./01-stage1-review.md).

Read-only source/history and CI-metadata assessment; no builds, installs, tests or artifact
inspection. Manifest evidence was frozen to `946f7961`, not concurrent working-tree output.

Author decisions for these findings are taken at G7.

| ID                                               | Original severity | Current status              | Current severity | Decision carried out?                                                  | Evidence                                                                                                                                                                         | Action                                                                                                             |
| ------------------------------------------------ | ----------------- | --------------------------- | ---------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| S1-F01: temporary PR-head checkout policy        | medium            | resolved                    | n/a              | pending in review; later merge-ref restoration: yes                    | `3ac5b4a5` removes four overrides; `main.yml:50,162,266,331` default checkout; plan `2811-2817`.                                                                                 | none — recommended: none needed; temporary policy reverted before G6.                                              |
| S1-F02: missing helper-test cases                | low               | still valid                 | low              | pending; no gap-closing decision or implementation                     | `improveError.test.ts:16-27`, `wrapError.test.ts:17-39`, `setEnvironmentVariables.test.ts:10-38`; comparison with deleted tests in `521fb828^`.                                  | fix in Stage 8 — add missing string/Windows-path and mixed-error assertions; handle environment coverage with F03. |
| S1-F03: unused environment helper and self-tests | low               | still valid                 | low              | pending; explicit retention implemented, recommended deletion not done | Utility `src/utils/testUtils/setEnvironmentVariables.ts:6-39` has only its self-test as consumer; plan `620-626`.                                                                | fix in Stage 8 — delete utility and self-tests; no consuming test or product code.                                 |
| S1-F04: incorrect final Stage 1 CI record        | low               | still valid                 | low              | pending; record correction not done                                    | Plan `573-577,798-823,841-847`; run `37021977737`, head `5b4ead56792c351d584e128845d7df8bfa37dcd9`, completed/success, updated `2026-10-02T15:39:04Z`, all four jobs successful. | fix in Stage 8 — record successful final-head run and correct “never got a runner.”                                |
| S1-F05: secret-slot compatibility preserved      | info              | false positive in hindsight | info             | pending; no remedial change proposed or required                       | `521fb828` preserves slot numbers; `connectionStorageService.ts:223-234` slots 0–6; regression test `:267` preserves secrets.                                                    | none — conversion preserves stored representation.                                                                 |
| S1-F06: references to removed extension bundle   | info              | resolved                    | n/a              | pending in review; Stage 5 cleanup: yes                                | `776f3a87` cleans `.vscodeignore`, comments and root `main.js`; HEAD `main.ts:6-9`, `.vscodeignore:37-45`.                                                                       | none — all three leftovers removed or corrected.                                                                   |
| S1-F07: persisted CI credentials remain enabled  | info              | still valid                 | info             | pending; no persistence-disable change                                 | Four checkouts omit `persist-credentials: false`; pinned checkout `3d3c42e5` defaults true. Storage-location claim corrected in Notes.                                           | file issue — pre-existing hardening gap; restoring merge refs does not remove persistence.                         |
| S1-F08: retired CI jobs provided no coverage     | info              | false positive in hindsight | info             | pending; no remedial change proposed or required                       | `521fb828` removes `if: false` GitHub test and no-op ADO test; `main.yml:80-81,180-185,280-287`, ADO `build.yml:153-166` retain real controls.                                   | none — deleting inert jobs did not remove executed tests.                                                          |

#### Notes

- **S1-F01:** The actual remedy supersedes the original recommendation to add a reminder: the override itself is gone. `git show 3ac5b4a5 -- .github/workflows/main.yml` contains exactly four two-line deletions. `pipelines-readme.md:50-55` accurately describes the restored merge-ref policy. Existing controls are CI Code Quality & Tests, VSIX inspection (L1), and Installed VSIX activation (L3); no dedicated checkout-policy regression test was found. This establishes the configuration fix, not a claim that this evaluation reran those controls or proved a HEAD CI run green.
- **S1-F02:** Still missing: an ENOENT **string** with a Windows path/backslashes; `wrapError` outer-string-only, inner-string-only, string-plus-Error, and Error-plus-string cases; and Windows environment-variable casing if the helper is retained. `git diff 521fb828 946f7961 --` the four relevant files shows only Vitest/mocking/environment-reset changes, not these assertions. The old mixed-case message assertion was weak and should not be copied. `getIp.test.ts:37-78` retains the improved boundaries/fallback/failure coverage. Severity remains low: a coverage gap, not evidence of a runtime regression.
- **S1-F03:** The original plan explicitly retained this helper to satisfy the request for missing helper coverage, rather than identifying a consumer. That decision is implemented, but it does not invalidate the dead-code observation. The current tests replace `process.env` with a plain object (`setEnvironmentVariables.test.ts:13-15`), so they also do not exercise the native Windows case-insensitive environment object. Severity remains low maintenance debt; no shipped-code failure is asserted.
- **S1-F04:** Read-only API calls to `repos/microsoft/vscode-documentdb/actions/runs/37021977737` and its `/jobs` endpoint independently confirmed success for Code Quality & Tests, Build & Package, VSIX inspection (L1), and Installed VSIX activation (L3). The incorrect Stage 2 wording originated in `29d5d4ff` and survives at HEAD. G1-3's later approval (`build-and-test-stack.md:1879-1882`) does not correct this provenance error. Severity remains low; the problem is the record, not a failed CI run.
- **S1-F05:** “False positive in hindsight” retains the original review's explicit false-positive classification; it is not a newly fixed defect. `git show 521fb828 -- src/services/connectionStorageService.ts` shows the unchanged slot values. Additional current coverage is `src/services/connectionStorageService.contract.test.ts:294`, “should preserve a user-assigned managed identity client ID,” and `:311`, “should distinguish a system-assigned managed identity from no managed identity at all.” These tests were read, not rerun. Informational severity is unchanged.
- **S1-F06:** `git show 776f3a87 -- .vscodeignore main.ts main.js` proves all three cleanups in one commit; the `main.js` component was removed rather than reworded. A HEAD `git grep` for `extension.bundle` outside documentation returns no matches. No dedicated regression test exists for these comments/ignore entries; the source/history check is sufficient for this informational cleanup.
- **S1-F07:** The original “token is written to `.git/config`” description is inaccurate for the already-pinned checkout v7.0.1. At `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1`, `action.yml:52-54` defaults persistence to true; `src/git-auth-helper.ts:326-358,369-379` writes a separate credentials file under `RUNNER_TEMP` and references it through Git `includeIf`; `src/git-source-provider.ts:316-325` removes auth immediately only when persistence is disabled. These public action sources were read via `gh api`. The job's subsequent code still has Git credential access; quality and L1 jobs now have `pull-requests: write`. Severity remains info: pre-existing hardening, not a demonstrated new exploit or exposure caused by head checkout.
- **S1-F08:** This was an affirmative no-regression observation, not an alleged defect; “false positive in hindsight” here classifies the potential **coverage-loss concern**, not the correctness of the original reassurance. `git show 521fb828^:package.json` confirms the old no-op `test` script; HEAD `package.json:76-77` instead invokes Vitest. CI runs unit tests, L1 inspection/failure proofs, and L3 activation/failure proofs; ADO's L1 step precedes signing (`.azure-pipelines/build.yml:235-241`). Informational severity is unchanged.

#### Deferred items

- **S1-F01 — revisit before G6:** done in code by `3ac5b4a5`; `243d6d95` records the decision and updates the pipeline documentation. Only the original review's pending decision cell remains to be reconciled.
- **S1-F02 — “next touch” recommendation:** still open. `0c8cb788` converted the helper tests to Vitest without adding the missing assertions. This was a recommendation, not an approved deferral. Removing F03's unused helper would make its Windows parity sub-item unnecessary, but would not fix either error-helper gap.
- **S1-F06 — fold cleanup into Stage 5:** done by `776f3a87`, independently verified in its diff and at HEAD.
- **S1-F07 — consider separately from this PR:** still open in the code; none of the four checkouts disables credential persistence. The scoped records contain no implemented hardening decision. Recommended disposition is a separate issue, not blocking modernization on this informational item.
- **S1-F08 — cross-reference to S2-F01, before publishing:** this is a separate Windows/ADO validation concern, not coverage lost by Stage 1. `.azure-pipelines/build-npm-packages.yml:87-89,124-130` still runs workspace tests on Windows; all six committed workspace test scripts now select root-config Vitest projects. `5e8fe48d` records the operator's report that both ADO pipelines were green (`build-and-test-stack.md:3074-3085`), but explicitly supplies neither build commit nor run identity. Thus it is **operator-reported done, not independently verified for HEAD here**; any remaining exact-build evidence gap belongs to S2-F01, not an extra S1-F08 defect.
- **S1-F03, S1-F04, S1-F05:** no later-stage or publication deferral was recorded for these findings. F03/F04 remain recommended Stage 8 work; F05 needs no work.

### 02-stage2-review.md

Original: [02-stage2-review.md](./02-stage2-review.md).

Read-only source/history, assertion comparisons and existing Actions-log assessment; no
install, build, package or test execution; manifests frozen to `946f7961`, not concurrent
working-tree output. All fourteen original decisions remain pending.

Author decisions for these findings are taken at G7.

S2-F08 to S2-F14 were informational verification notes in the original review (for example
“TDD contracts preserved”); “false positive in hindsight” here means no defect exists, not
that the review's verification was wrong.

| ID                                               | Original severity | Current status              | Current severity | Decision carried out?                                                                             | Evidence                                                                                                                                                                                                                      | Action                                                                                                                                                |
| ------------------------------------------------ | ----------------- | --------------------------- | ---------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| S2-F01: Windows package-test verification        | medium            | resolved                    | n/a              | pending; operator attestation establishes operational completion, exact run provenance unverified | ADO `build-npm-packages.yml:89,123–130` requires Windows workspace tests; `5e8fe48d`/`9063b223` record success; plan `3073-3085,3141-3143,3280-3285` lacks npm-build SHA; API sign-in page. (reconciled; see Inconsistencies) | none for original test obligation; recommended provenance URL/SHA closure remains low-severity X7-F07 work, or explicit G7 acceptance of attestation. |
| S2-F02: unit-test wall-time regression           | low               | still valid                 | low              | pending; no worker-cap decision; implementation unchanged                                         | `vitest.config.ts:39–41`; successful CI unit steps: `37021977737` 120 s, `37068033773` 207 s; no later cap change.                                                                                                            | file issue — benchmark workers/pools with CI memory measurements; avoid blind increases restoring OOM.                                                |
| S2-F03: implicit isolation and split mocks       | low               | still valid                 | low              | pending; immediate guard missing; long-term #990 open                                             | `vitest.config.ts:57–79` lacks explicit pool/isolation; `setup.ts:23–39` retains loader/factory split; old direct azext versions `package.json:162–165`. (reconciled; see Inconsistencies)                                    | fix in Stage 8 — pin forks/isolation and loader/mock-identity coverage; keep upgrade/hook removal in #990.                                            |
| S2-F04: incorrect Oxc namespace explanation      | low               | still valid                 | low              | pending; runtime replaced in `4386c580`, record not corrected                                     | Typed object `extensionVariables.ts:24–28,71–72` has correct explanation; plan `1413–1418` still claims initializer silently dropped. (reconciled; see Inconsistencies)                                                       | fix in Stage 8 — correct and close Stage 2 open item; only misleading documentation remains.                                                          |
| S2-F05: missing/incorrect Stage 2 CI record      | low               | still valid                 | low              | pending; formatting fixed `811b33b5`, historical correction absent                                | Plan `841–846,1387–1390`; `37051119892` formatting failed, build/L1/L3 skipped; `37068033773` all green; `37021977737` got runner and passed.                                                                                 | fix in Stage 8 — record failed run, correction/run and actual earlier-run outcome.                                                                    |
| S2-F06: stale test-exclude override              | low               | resolved                    | n/a              | pending; cleanup carried out `dee7773e`                                                           | Commit removes override/comment; `946f7961` manifest has only glob/vite overrides; lockfile no test-exclude.                                                                                                                  | none — obsolete pin and rationale gone.                                                                                                               |
| S2-F07: fast CI skips test type checking         | low               | still valid                 | low              | pending; no unconditional root check or specific acceptance                                       | `main.yml:61–83,318–325,343–344`; `package.json:62–63,76–77`; package configs exclude tests/only src; root `tsconfig.json:36–43` is fallback.                                                                                 | fix in Stage 8 — root no-emit check in Code Quality & Tests; feature-target/non-full routes lack equivalent.                                          |
| S2-F08: mock/assertion migration fidelity        | info              | false positive in hindsight | info             | pending; parity confirmed; old fixture cleanup undone                                             | AST comparison `5b4ead56..875ad255`: 299 changed files, 8,820 normalized assertions unchanged; four snapshot values equal HEAD.                                                                                               | none for migration — no weakening; old placeholder fixture is pre-existing.                                                                           |
| S2-F09: TDD contracts preserved                  | info              | false positive in hindsight | info             | pending; mechanics confirmed; G1-3 general approval                                               | Six `4ed9d944` files preserve names and 291 assertions; later four `WorkerSessionManager.test.ts` lines from `776f3a87` outside TDD suites.                                                                                   | none — intact contracts; new worker-path assertion adds coverage.                                                                                     |
| S2-F10: Fluent UI stubs preserve checks          | info              | false positive in hindsight | info             | pending; keep/remove choices implemented                                                          | `049c1a81` removes two StatusStrip stubs; `DashboardHeader.test.ts:18–24,289–290` keeps stub/class/color assertions.                                                                                                          | accept — header stub preserves color contract; StatusStrip exercises real components.                                                                 |
| S2-F11: configuration does not suppress failures | info              | false positive in hindsight | info             | pending; assurance supported; interop removed `39046f89`                                          | `vitest.config.ts:17–27,31–34,47–77,82–145`; browser config `10–17`; `identity.test.cjs:10–22` real identity and alias-removed controls.                                                                                      | none — narrow warning filter/timeouts do not suppress failures; bundle identity checked outside unit alias.                                           |
| S2-F12: batch consolidation retained coverage    | info              | false positive in hindsight | info             | pending; general G1-3 approval; historical deviation irreversible                                 | Former runner routing `9716ec80^` complementary; `9716ec80` globs; `37051119892` 296 files/4,588 tests; assertion comparison no weakening.                                                                                    | accept — current coverage intact; missing intermediate full runs affect historical bisect confidence.                                                 |
| S2-F13: Jest removal and replacement commands    | info              | false positive in hindsight | info             | pending; `9716ec80`/`bbd9ce79` guidance survives merge                                            | No Jest runner in lockfile or `jest.` in 298 tracked test files; scripts/workflow/CONTRIBUTING/backport skill agree.                                                                                                          | none — Vitest runner; jest-mock-vscode and older-release guidance intentional.                                                                        |
| S2-F14: overrides and dependency record          | info              | false positive in hindsight | info             | pending; quarantine pins removed `dee7773e`; vite retention conditional                           | `946f7961` manifest `202–205`; same chai 6.2.2/std-env 4.2.0/tinyrainbow 3.1.1/vite 8.0.16; eslint-plugin absent.                                                                                                             | accept — quarantine pins gone; remaining $vite has npm-resolution purpose.                                                                            |

#### Notes

- **S2-F01:** This is **not** a claim that the operator's reported Windows run failed or never happened. `5e8fe48d` records the operator's explicit green-pipeline report; `9063b223` records tarball comparisons. Source inspection confirms that a successful configured build runs workspace tests before packing, including Vitest projects selected by `packages/vscode-ext-webview/package.json:51` and `packages/vscode-ext-webview-fluentui/package.json:46`. Those records are claims, not independently accessible job logs: the npm drop has no recorded commit, and a read-only request to the documented `msdata/CosmosDB` branch-build API returned a sign-in page. Severity drops from medium to low because only auditable closure remains unproven; accepting the operator attestation explicitly at G7 is an alternative to attaching the run evidence.
- **S2-F02:** The 120 s/207 s figures were independently obtained from each named run's successful unit-test step timestamps; they include the workspace prebuild. No timing run was performed at HEAD, so this assessment does not claim a newly measured 60% regression. The causally relevant 25% setting is unchanged, and the Stage 6 record still reports the slowdown (`build-and-test-stack.md:2962–2975`). Raising workers is distinct from disabling isolation; the latter would compound S2-F03.
- **S2-F03:** `gh issue view 990` confirms that the follow-up exists and is **OPEN**. Its “What to do” item 5 says to check whether the hook can go or record which CommonJS dependency still needs it; that is more precise than the setup comment's implication that newer azext packages alone make the hook unnecessary. Issue #990 is expressly after #880 merges. No dedicated installed-twice or factory/CJS mock-identity regression test was found in the current setup/config; the broader architectural migration did not remove this split.
- **S2-F04:** The code problem is gone by replacement, with the fixing commit directly identifying S2-F04. The finding nevertheless stays “still valid” because its primary record-accuracy defect survives word-for-word in Stage 2. `src/extensionVariables.ts:24–26` already supplies the correct explanation, so no new Oxc experiment or production change is needed to reconcile the record.
- **S2-F05:** Verified via `gh run view`: `37051119892` at `875ad255` logs `l10n=success, lint=success, prettier=failure`, 296 passing test files and 4,588 passing tests. `811b33b5` changes only the plan's Markdown formatting, and run `37068033773` at that commit passed Code Quality, Build & Package, L1 and L3. Run `37021977737` at `5b4ead56` also passed all four jobs. Remaining severity is low because the unfinished work is documentary; the original failed gate itself is not still failing by that evidence.
- **S2-F07:** `git show 5b4ead56:jest.config.js` and former package configs confirm `ts-jest` on the original affected routes. The gap has expanded since the review: `6c6cf71d` excludes another 11 test files across operator-registry, shell-api-types and shell-runtime from package compilation; the new webview registry TSX test is also outside root type-checking on fast CI paths. There are now 45 package test files and four webview TSX test files, none selected by their package build as unit-test inputs; fluentui's separate `type-tests/` is not its unit suite. Some of this wider scope predates Stage 2, so it is not all newly caused by the migration. Severity stays low: main/release-target CI still runs root `tsc`, and this finding concerns test-source diagnostics, not demonstrated runtime failures.
- **S2-F08:** The read-only comparison checks complete top-level assertion expressions, not just `expect(` counts; both checks passed across 299 changed files, including the three separate browser-harness tests. Four snapshot payloads at HEAD equal the original Jest payloads. The optional fixture flaw remains explicitly visible at `src/commands/connections-view/moveItems/PromptTargetFolderStep.test.ts:46–47,69–80`: a missing export is intentionally represented as `undefined`, then used in folder fixtures. This existed under Jest and is not evidence of migration-induced weakening.
- **S2-F09:** The six exact files are the ones changed by `4ed9d944`; the playground completion files are under `src/documentdb/query-language/playground-completions/tdd/`. Test/suite names and normalized assertions compare identically against `5b4ead56`. Only `WorkerSessionManager.test.ts` changes afterward: `776f3a87` supplies an extensionPath fixture and asserts the `.mjs` worker path at HEAD line 185 in “initialization timeout,” not the TDD suites beginning at lines 622 and 732.
- **S2-F11:** Stage 3 removed the prebundle and redundant fluentui inline entry (`39046f89`), but the Azure identity inline entries, single-bson unit alias and narrow source-map warning filter remain. Runtime BSON coverage is not just a unit mock claim: `identity.test.cjs` names “host and playground worker graphs reach one ObjectId constructor” and “negative control: without the bson alias, the ES-module route gets a second copy.” This re-evaluation read those controls; it did not execute or claim a fresh pass of them.
- **S2-F14:** The old override table is historical, not a description of HEAD's override keys. `dee7773e` removes chai/std-env/tinyrainbow/test-exclude/ignore overrides without touching the lockfile; HEAD retains the same four relevant resolved versions, now nested under Vitest where applicable. The commit and `package.json` document why $vite remains. No fresh-dependency scan or clean resolution was rerun here, and no claim is made that the npm crash was independently reproduced today.

**Reconciliation qualification:** The copied S2-F01 note's low severity applies to the residual
provenance gap (X7-F07), not the resolved Windows-run obligation. See Inconsistencies.

#### Deferred items

- **S2-F01, Windows run before publishing/G6:** reported completed in `5e8fe48d`, with artifact comparison recorded in `9063b223`; independent job/run/SHA closure remains open for the reason above. A later signed release build is a separate requirement, not evidence that this particular test step passed.
- **S2-F02, G1-3 worker-cap decision:** still open as an individual decision; G1-3's general approval (`plan:1879–1882`) does not select 50%, threads, or accepting the cost. No configuration change implemented any option. Recommend an issue rather than speculative tuning on this branch.
- **S2-F03, azext upgrade/hook removal ideally before Stage 5:** not done. It is now explicitly deferred until after the PR through open #990 (`plan:2697–2700`), whose body includes the hook re-evaluation. Pinning the existing isolation assumptions remains a small independent Stage 8 fix.
- **S2-F04, replace ext before Stage 5:** done in `4386c580`; correct/close the old explanation remains open. No runtime deferral remains.
- **S2-F05, CI result recording:** the actual formatting correction and follow-up full CI are done; the Stage 2 inline failure/resolution record and “never got a runner” correction remain open.
- **S2-F06/S2-F14, remove temporary overrides before G6:** stale test-exclude and three Stage 2 quarantine pins are gone in `dee7773e`. $vite intentionally remains under the recorded condition “once npm resolves without it”; its manifest rationale is no longer a temporary quarantine explanation. This is a conditional retention, not an unmentioned missed removal.
- **S2-F08, optional placeholder-fixture improvement:** still open, pre-existing and non-blocking; accept separately from migration parity or file a narrow test-quality issue.
- **S2-F10, optional removal of the last header stub:** not done and not required to preserve the original checks. A later real-component assertion must retain the color expectation; deleting it would not be an equivalent cleanup.
- **S2-F11, remove Stage 2 workspace-package interop settings:** done in `39046f89`; the runtime BSON controls remain in `test:verification`. Azure identity reload handling and the unrelated CommonJS hook were not removed.
- **S2-F09/S2-F12, G1-3 review of TDD mechanics and batch consolidation:** G1-3 is generally recorded as passed, but original finding-level decisions remain pending. Independent code/history checks found no lost assertions; intermediate batch states cannot acquire retrospective full-run evidence.
- **S2-F07/S2-F13:** no separately scheduled later-stage task was recorded; the former remains a CI gap and the latter needs no additional migration work.

### 03-stage3-review.md

Original: [03-stage3-review.md](./03-stage3-review.md).

Read-only source/history assessment, manifests frozen to `946f7961`; no build, install,
tests, publication or concurrent outputs. Coverage means a check exists, not a fresh pass.
Still-valid informational findings remain observations, not newly discovered defects.

Author decisions for these findings are taken at G7.

| ID                                                      | Original severity | Current status | Current severity | Decision carried out?                                                                  | Evidence                                                                                                                                                                 | Action                                                                                                   |
| ------------------------------------------------------- | ----------------- | -------------- | ---------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| S3-F01: bundled declaration reader uses wrong directory | medium            | still valid    | low              | pending; Stage 5 retained latent issue                                                 | `shell-api-types/src/index.ts:36-39`, `vite.config.ext.mjs:205-210,259`; no helper caller in `src`; TS plugin reads own path `:44-45`. (reconciled; see Inconsistencies) | fix in Stage 8 — explicit bundled asset resolution/layout probe; correct TS-plugin attribution.          |
| S3-F02: unbundled /host consumers unchecked             | medium            | resolved       | n/a              | pending; probe/documentation and ESM-only commitment: yes                              | `5fc49e8c`; `unbundled-host-probe.cjs:57-109`; package README `406-429`; CI `main.yml:289-292`.                                                                          | none — real-host probes and documentation cover unsupported synchronous require.                         |
| S3-F03: webpack bakes build-machine URL                 | low               | obsolete       | n/a              | pending; Stage 5 revisit fulfilled by replacement                                      | `776f3a87` ESM Vite host; `770446c2` deletes old config; Vite `92-95,205-210`.                                                                                           | none — offending parser removed; native ESM metadata.                                                    |
| S3-F04: BSON probes omit dynamic import                 | low               | still valid    | low              | pending; dynamic route not added                                                       | `hostProbe.ts:8-21`, `workerProbe.ts:8-18`, `check.cjs:102-109`; `770446c2` port retained synchronous/static routes.                                                     | fix in Stage 8 — add/await dynamic import in both probes; port did not cover historical failure form.    |
| S3-F05: L1 skips unowned/non-js scripts                 | low               | resolved       | n/a              | pending; Stage 4 commitment fulfilled                                                  | `b47627f1`; `inspect.cjs:493-511,549-551`; tests `540-574`; unowned-script/import-meta controls.                                                                         | none — all script extensions require ownership; CJS syntax checked.                                      |
| S3-F06: tests fixed, declaration maps dangle            | low               | still valid    | low              | pending; mandatory test exclusion/check done, secondary maps not fixed                 | `6c6cf71d`, `b09b7629`; three configs `5,10-11` emit declaration maps but manifests omit src. (reconciled; see Inconsistencies)                                          | file issue — track pre-existing declaration-map/source packaging separately; compiled-test defect fixed. |
| S3-F07: Stage 3 record incorrect and stale              | low               | still valid    | low              | pending; gate superseded, facts remain                                                 | Plan `1446,1472,1531-1535,1576,1808,1852,1879-1882,1909`; TS plugin own path `index.ts:45`.                                                                              | fix in Stage 8 — reconcile record without inventing historical runs.                                     |
| S3-F08: probe identity is not artifact identity         | info              | still valid    | info             | pending; Vite port done, artifact boundary retained; formal acceptance not established | `770446c2`; `bson-identity/check.cjs:17-63,96-109`; `inspect.cjs:619-625,674-682`. (reconciled; see Inconsistencies)                                                     | accept — real-config constructor probes and hash-bound graphs complement, not prove every vendored path. |
| S3-F09: package versions/runtime floors consistent      | info              | still valid    | info             | pending; version/engine plan and gate: yes                                             | Six manifests; root `10-13,116`, lockfile `7069-7071`; schema changelog `3-18`; plan `1879-1882`.                                                                        | accept — breaking-version signals and VS Code/type floor match manifests.                                |
| S3-F10: workspace interop removal sound                 | info              | still valid    | info             | pending; removal commitment: yes                                                       | `39046f89`; `vitest.config.ts:65-77`; webview workspace links in lockfile `4768-4774`.                                                                                   | accept — workspace links distinct from packed-consumer inlining contract.                                |
| S3-F11: L2 executes actual host template                | info              | still valid    | info             | pending; loader repair: yes                                                            | `657df178`; `browser/template.ts:20-48,58-80`; harness `91`; production-template test `182`.                                                                             | accept — transpiles real controller, fails unexpected dependencies, no copied template.                  |
| S3-F12: ESM checks sound, TS caveat missing             | info              | still valid    | info             | pending; ESM checks done, node16-CJS note absent                                       | Six manifests/configs; package checker `44-46,201-221`; MIGRATION `16-51`; schema changelog `3-14`.                                                                      | fix in Stage 8 — node16-CJS versus modern NodeNext caveat; runtime require(esm) is not all TS modes.     |
| S3-F13: tsx intact, maintenance URLs stale              | info              | still valid    | info             | pending; tsx replacement yes, URL maintenance no                                       | `174c836a`, `dc2344c5`, `22512691`, `f2ddb288`; scraper `70-72`, verifier `33-34`; package scripts.                                                                      | file issue — unchanged upstream endpoints before next refresh; outside runtime/tests.                    |

#### Notes

- **S3-F01:** Severity drops from medium to low: there is no source caller, the standalone package layout is correct, and the final host bundle is no longer the old webpack artifact. The latent bundled-layout error is nevertheless directly visible: `../typeDefs` versus the Vite copy destination `typeDefs/`, with host entries/chunks emitted at the output root. I did not claim to recheck tree-shaking in concurrent `dist/`. The TS plugin uses its own `__dirname/typeDefs` path, so its completion check still cannot verify this helper; the package's own JSDoc (`src/index.ts:12-13`) also attributes the helper to the plugin.
- **S3-F02:** The original finding was uncertainty/test coverage, not a demand to support synchronous unbundled `require`. The fix documents a real limitation rather than repairing it: the `commonjs-require` variant expects a hang, while CommonJS `import()`, ESM static import and ESM dynamic import expect success. Coverage includes `unbundled-host-probe.test.cjs:57` (“covers require, import() from CommonJS, ESM static and dynamic imports, and one control”) and `:225` (“accepts the expected hang only when stuck in require and VS Code reported it unresponsive”). The recorded ESM-only choice is at plan `:3250-3264`; the probe is Linux-only so far (`build/verification/README.md:425-429`), not cross-platform proof.
- **S3-F03:** `git log --diff-filter=D -- webpack.config.ext.cjs` identifies **`770446c2`**, not the general Stage 6 webpack-removal commit, as the removing commit. `776f3a87` first replaced the host build and renamed the old config. No temporary ESLint ban was needed once that architecture replaced the offending parser; the separate CommonJS TS plugin is still protected by L1.
- **S3-F04:** Both route functions remain synchronous and contain only static imports; `check.cjs:103` does not await their result. `identity.test.cjs:10-22` still checks constructor identity and alias removal, but not dynamic import. The final Vite alias (`vite.config.ext.mjs:153`) protects normal bare `bson` resolution; this is a missing regression route, not evidence of a present constructor split. The old absolute claims that dynamic import resolves the ESM entry remain at `src/documentdb/feedResultToSchemaStore.ts:16`, `playground/PlaygroundEvaluator.ts:8`, and `playground/playgroundWorker.ts:18`.
- **S3-F05:** Regression coverage is explicit: `inspect.test.cjs:540-549` generates “unowned .js/.cjs/.mjs scripts fail with their packaged filename”; `:551-574` tests “.cjs is inspected as CommonJS and .mjs as a module”; `:577-700` checks host-owned `.mjs`/`.cjs` hash provenance. `prove-inspection.cjs:100-117` plants an unowned script and mutates the CJS TS-plugin file. No reliance on a stale webpack report or current generated artifact is necessary.
- **S3-F06:** **The headline compiled-test bug is fixed**, including a fail-closed tarball check at `check-packages.mjs:197-199` and `packed-tests.test.cjs:12` (“packed tests reject scripts, declarations, maps and other test companions”). “Still valid” applies only to the review's additional declaration-map observation, under the brief's partial-fix rule: all three configs retain `declarationMap: true`, `rootDir: ./src`, and `outDir: ./dist`; their manifests ship `dist` (plus shell `typeDefs`), not `src`. Read-only corroboration from installed TypeScript 6.0.3 (matching HEAD lockfile `:17858-17860`): its declaration printer omits `inlineSources` (`node_modules/typescript/lib/typescript.js:121501-121513`), unlike the JS printer (`:121439-121447`). No tarball or generated output was rebuilt/read.
- **S3-F07:** The plan still says “CI: pending” in the Stage 3 records, calls the inaccessible documentation repository “private” based on anonymous 404s, understates the old production retention of the shell helper, and labels the G1-3 TS-plugin check as that helper reading its file. The G1-3 passed annotation in `44d5488e` supersedes pending **gate** status; it expressly says no new checks were run to record confirmation. It does not supply new historical CI/L2 evidence or fix those statements. Recommendations are to annotate/correct facts, not manufacture retroactive test results.
- **S3-F08:** The Vite harness does load the real production config, but replaces entry points, output directory and plugins (`check.cjs:17-63`); it executes the resulting probe files, not installed extension entry files. L1 follows static and dynamic host edges but identifies BSON implementations by the `node_modules/bson/lib/bson…` pattern (`inspect.cjs:619-625,681`). A differently named vendored implementation reachable only from the real extension still lies outside that combined identity claim. The finding remains informational, not a reason to remove either control.
- **S3-F09:** Manifest versions remain operator-registry/shell-api-types/shell-runtime **0.9.0**, schema-analyzer **2.0.0**, webview **0.11.0**, fluentui **1.1.1**. Five Node-run packages retain `>=22.18.0`; browser-only fluentui has no Node engine. Root VS Code floor is `^1.109.0`, with locked typings **1.109.0** (`git show`/read-only JSON extraction). The original model of all extension output being CommonJS is historical; it is not needed for the still-correct version/floor observation.
- **S3-F10:** Reading HEAD's lockfile reported six workspace entries with `"link": true`; `vitest.config.ts` retains only the Azure identity/MSAL inline settings in the extension project. Packed package checks deliberately retain webview/fluentui inlining (`check-packages.mjs:57-59`) and a no-inline negative control (`:310-319`). This re-evaluation establishes that configuration distinction, not a new claim that the merged full test suite or CI has passed.
- **S3-F12:** The main/types/exports maps still exist, types precede default conditions, shell-api-types exports/shares `typeDefs`, and package module-resolution modes remain NodeNext except browser fluentui. ATTW's accepted `CJSResolvesToESM` exception and the top-level-await scan remain explicit. Stage 5's root `Bundler` resolution makes the review's explanation that legacy fields are necessary for root node10 resolution historical, not a package defect. The new migration text about preserving `import()` (`MIGRATION.md:47-48`) addresses S3-F02, not the original static-import-from-CJS `node16`/TS1479 caveat; schema-analyzer's changelog also still lacks that caveat.
- **S3-F13:** `git grep -n ts-node 946f7961 -- '*.json' '*.ts' '*.mjs' '*.cjs' '*.yml'` returned no matches. A second HEAD search for the scraper/verifier filenames and documentation endpoint identifiers in `*test.ts`, `*test.tsx`, `*test.cjs`, and `*test.mjs` also returned no matches. Their scripts still use `tsx`; history shows neither endpoint-bearing script changed after its Stage 3 conversion. I did not refetch the URLs: **404 is historical review evidence, not a newly observed HEAD-time HTTP result**, and “private” remains unproven.

#### Deferred items

- **S3-F01 — before G1-3 / before any host caller:** The labeling correction remains open; the optional API/layout fix and bundled-layout probe remain unimplemented. The absence of a host caller limits impact but does not fulfill either recommendation.
- **S3-F02 — before publishing at G6:** Probe and support documentation are done in `5fc49e8c`, with CI wiring and a documented synchronous-`require` exclusion. ESM-only publication is the recorded decision; no CJS fallback was promised or implemented, and this review makes no claim that packages were published.
- **S3-F03 — revisit at Stage 5:** Done by replacing the host architecture (`776f3a87`) and removing the host webpack config (`770446c2`); the original risk is obsolete.
- **S3-F04 — recommended dynamic-import route, no recorded stage assignment:** Still open after the Vite port; fix in Stage 8 rather than treating the port as new route coverage.
- **S3-F05 — Stage 4 ownership hardening:** Done in `b47627f1`, retained and extended by the Vite-host checks in `770446c2`; named unit/proof controls remain present.
- **S3-F06 — before package publication:** The mandatory compiled-test exclusion is done in `6c6cf71d`, strengthened by the packed-tarball rejection/control in `b09b7629`. Only the secondary, pre-existing declaration-map/source-distribution mismatch remains open; it need not be misreported as unresolved test leakage.
- **S3-F07 — corrections before G1-3:** Partly superseded by the explicit gate pass, but the factual correction work remains open. Historical L2/browser and CI execution must not be invented from that pass note; later artifact checks do not prove what ran on the old Stage 3 VSIX.
- **S3-F08 — revisit in Stages 4/5:** The probe was ported to the actual Vite host config in `770446c2`; direct shipped-artifact constructor identity remains unimplemented. Recommend accepting the scoped residual limitation, not declaring full artifact identity proven.
- **S3-F12 — suggested consumer typing note:** Still open in the two package-facing documents; add it alongside the branch's package migration/release documentation.
- **S3-F13 — upstream URLs before next real scraper/verifier run:** No source update landed; track separately. Current endpoint accessibility was not tested during this read-only review.

### 04-stage4-review.md

Original: [04-stage4-review.md](./04-stage4-review.md).

| ID                                              | Original severity | Current status | Current severity | Decision carried out?                                | Evidence                                                                                                                                                                 | Action |
| ----------------------------------------------- | ----------------- | -------------- | ---------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| S4-F01: missing non-JS asset coverage           | medium            | resolved       | n/a              | yes, option 1; operator confirmed A at G4 `095d14ad` | `dda2734c`; manifest + 22 runtime assets `inspect.cjs:187-232,996-998`; two missing-asset controls `prove-inspection.cjs:86-97`; tests `494,514`; CI `37517835337` PASS. | none   |
| S4-F02: Monaco allowance accepts any identifier | low               | resolved       | n/a              | yes, option 1; option 2 rejected                     | `3bb7e09b`; function ancestor and browser-URI provenance `inspect.cjs:402-433,339`; top-level negative control `331`; tests `961,982,996`; CI PASS.                      | none   |
| S4-F03: real-origin G4 gate remains open        | info              | resolved       | n/a              | yes; operator checks, no source change               | `095d14ad`; plan `2303-2330`: F5/HMR, installed VSIX, themes, L2-dev; G4 passed 2026-10-05.                                                                              | none   |

#### Re-checks of earlier findings

- **S3-F05:** See canonical row in 03. Stage 4 confirms resolution in `b47627f1`, kept through
  `0843c1d0`: all `.js/.cjs/.mjs` scanned, Vite owner required (`inspect.cjs:493-506`),
  `unowned-script` PASS in CI `37517835337`; decision carried out, no action.
- **S3-F08:** See canonical row in 03. Stage 4 says still valid/info and “yes (accepted)”,
  with `bson-identity/check.cjs:6-43` probe entries and graph counts `inspect.cjs:619-625`.
  Reconciled: formal author acceptance is not established; accept is the recommendation.
  See Inconsistencies.

#### Notes

- **S4-F01:** after the fix only file-extension updates touched these lists (`git diff 3bb7e09b HEAD -- build/verification/inspect.cjs`: `playgroundWorker.js`→`.mjs`, `playgroundTsPlugin.js`→`.cjs`, `main.mjs` added). A spot check of `src/**` runtime `extensionPath`/`extensionUri` joins (prompts, panel icons, debug overrides, playground icons, worker, TS plugin stub) found every target in `runtimeAssets`. The list is hand-maintained; no test ties it to the source (see cross-review observations). The main merge (`946f7961`) changed only `package-lock.json` and two ADO YAML files, so the CI run at `d371572b` covers the inspector and VSIX at HEAD.
- **S4-F02:** the narrowed rule still accepts today's shipped `monaco-*.js` chunk. `verify:vsix` passes in CI 37517835337, and `nonliteral-import` and `allowlisted-shape-at-top-level` are both rejected there.
- **S4-F03:** "resolved" means the operator ran the real-origin checks the finding left open (items 1–4 at `build-and-test-stack.md:2290-2330`). The source is unchanged by design. Evidence for those checks is the operator's recorded words, not artifacts.

#### Deferred items

- **PR size comment measured only the `views.js` entry (deferred to Stage 6):** done in `19f34777`. `build-size-report.cjs` reads per-graph sizes from the L1 manifest report (`.github/workflows/main.yml:210-252`), and Stage 6 budgets come from `f53df711` and `9b489252`.
- **G4 real-origin, themes, F5/HMR and L2-dev checks (deferred to G4):** done. Operator records are in `095d14ad` (`build-and-test-stack.md:2303-2330`).
- **L1 option A operator confirmation (deferred to G4):** done ("decisions, good", `build-and-test-stack.md:2319-2322`).
- **L2-dev Windows/light timeout (watch item, `build-and-test-stack.md:2264-2266`):** still open as a watch item. No later record mentions it recurring. L2-dev does not run in CI (no L2/Playwright step in `main.yml`), so it would surface only in manual runs.
- **Run hand-opened L2-dev scenario steps automatically (G4 follow-up):** still open. It is carried into the Stage 10 hand-over by design.
- **L2 in CI:** deferred by the plan to the E2E iteration (`build-and-test-stack.md` "The automated checks", about line 194). Still open, by design.

### 05-stage5-review.md

Original: [05-stage5-review.md](./05-stage5-review.md).

Read-only review/code/history/CI assessment; no build or test. S5-SW IDs name this review's
own sweep/verification-limit follow-ups; earlier-stage re-checks are not counted here.

| ID                                          | Original severity | Current status                                | Current severity     | Decision carried out?                                       | Evidence                                                                                                                 | Action                                 |
| ------------------------------------------- | ----------------- | --------------------------------------------- | -------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| S5-F01: Kubernetes laziness stops at loader | medium            | resolved                                      | n/a                  | yes, coordinator option 1; operator G7 confirmation pending | `555f9def`; startup closure unions main/facade `inspect.cjs:684-707`; controls `217-257`; tests `329-346`; CI `170,185`. | decide at G7 (confirm)                 |
| S5-F02: concurrent plugin-stub truncation   | low               | resolved                                      | n/a (residual: info) | yes, coordinator option 1; G7 confirmation pending          | `90374fee`; temp + rename `tsPluginStub.ts:51-64`, entry before manifest `91-96`; tests.                                 | decide at G7 (confirm); #548 long-term |
| S5-SW1: Babel allowance checks shape        | info (limit)      | still valid (accepted limit)                  | info                 | n/a, no decision recorded                                   | `inspect.cjs` babelConfigFileImports; second-babel-nonliteral-import control.                                            | accept                                 |
| S5-SW2: SSH lazy but unguarded external     | info (sweep)      | still valid (by design, as webpack)           | info                 | n/a                                                         | Vite `60`; proxy SSH `47` bare require; VSIX no node_modules.                                                            | accept                                 |
| S5-SW3: PAC require.resolve branch          | info (sweep)      | still valid (latent)                          | info                 | n/a                                                         | Proxy agent `139`; plan Stage 5 “Latent, recorded.”                                                                      | accept                                 |
| S5-SW4: Azure ESM/CJS duplication           | info (sweep)      | still valid (no broken exchange shown)        | info                 | n/a                                                         | Original sweep; G6 installed-VSIX Azure auth/discovery passed.                                                           | accept                                 |
| S5-SW5: cold-start URI untested             | G5 check          | still valid                                   | low                  | yes, operator accepted risk G6                              | G6 “uri wasn't tested, but i accept the risk”; Stage 10 hand-over.                                                       | accept (done); carry to Stage 10       |
| S5-SW6: rapid-edit/F5 limits                | limit             | resolved (operator manual)                    | info                 | n/a                                                         | G5 “rapid saving, no issues”, F5; G6 Windows F5.                                                                         | none                                   |
| S5-SW7: native/backend checks unexercised   | G5 check          | resolved (operator manual, “A passed”)        | n/a                  | yes, moved G6; operator “A passed”                          | G6 decisions; Azure G5-I01 installed-VSIX retest passed.                                                                 | none                                   |
| S5-SW8: telemetry only DebugReporter        | limit             | still valid (verification limit)              | info                 | n/a                                                         | Original telemetry section; G6 item 7 only “A passed.”                                                                   | accept                                 |
| S5-SW9: review-tip CI incomplete            | limit             | resolved                                      | n/a                  | n/a                                                         | Green `37368806263` at `57928f8e`; no `946f7961` CI at evaluation time, superseded below.                                | none                                   |
| S5-SW10: Case 2 deferred                    | limit             | still valid (still open, deferred to Stage 9) | info                 | n/a, plan rule 4                                            | Ground rule 4, Stage 9.                                                                                                  | none (Stage 9)                         |
| S5-SW11: execution record and decisions     | follow-up         | still valid for remaining part                | info                 | pending                                                     | Record committed `57928f8e`; G7 confirms/reverses open coordinator decisions.                                            | decide at G7                           |
| S5-SW12: Windows/macOS/real-origin limit    | limit             | still valid for remaining part                | low                  | n/a                                                         | Windows done G6/operator + ADO Windows L1; macOS never run; G6/ADO records.                                              | accept or file issue at G7             |

#### Re-checks of earlier findings

- **S1-F06:** See canonical 01 row. Resolved `776f3a87`; no bundle reference in
  `.vscodeignore`; `git log -S extension.bundle` confirms; n/a decision here, no action.
- **S2-F03:** See canonical 02 row. Still valid/low; loader/factory split `setup.ts:23-40`,
  Vitest `63`; #990 open/on-hold; no action here beyond 02/#990.
- **S2-F04:** See canonical 02 row. Stage 5 calls runtime hazard resolved `4386c580`,
  `extensionVariables.ts:72`; full record-accuracy finding still valid/low (reconciled;
  see Inconsistencies).
- **S3-F01:** See canonical 03 row. Still valid/low, latent; helper path `src/index.ts:37`,
  no source caller; no action here. Use source-grounded qualification, not mutable-output
  tree-shaking certification (reconciled; see Inconsistencies).
- **S3-F03:** See canonical 03 row. Obsolete `776f3a87`/`0843c1d0`; native import.meta,
  no webpack config; no action.
- **S3-F05:** See canonical 03 row. Resolved `b47627f1`/`dd8202bd`;
  unowned-script/import-meta-in-commonjs controls; no action.
- **S3-F08:** See canonical 03 row. Still valid/info; actual config probe entries
  `check.cjs:6-22`, CI identity test `170`, unknown-path vendored copies undetected;
  “accepted gap” is a recommendation, formal acceptance pending (reconciled; see
  Inconsistencies).
- **S4-F01:** See canonical 04 row. Resolved `dda2734c`; missing-runtime-asset and
  missing-contributed-grammar controls; no action.
- **S4-F02:** See canonical 04 row. Resolved `3bb7e09b`; top-level-shape control; no action.

#### Notes

- **S5-F01.** HEAD keeps the fix intact (`git diff 555f9def 946f7961 -- build/verification/inspect.cjs` only adds a reuse in the size budget, `mainStartup` assets, i.e. `size-budget-host-startup`). `main.ts:22` still top-level-awaits `import('./src/extension')`. Covering tests: `inspect.test.cjs` "Kubernetes SDK cannot be eagerly imported by the awaited implementation or its static children" and "main requires a unique implementation facade, not just an extension module in the graph"; L1 controls `kubernetes-in-extension-static-closure`, `missing-extension-implementation-boundary`. Option 2 (runtime module-load assertion) was declined, with a reason recorded.
- **S5-F02.** Covering tests: "publishes complete files across two interleaved writers when the stub is %s" (created/replaced) and "cleans up and propagates $code when publishing $fileName fails" (EACCES/EROFS/EPERM/EBUSY), "removes a partial temporary file when writing fails", "preserves the publication error even if temporary-file cleanup fails". Residual (info): Windows `EPERM`/`EBUSY` on rename has no retry and lands in the generic error path, not the read-only status-bar path (`ClustersExtension.ts:459` only matches EACCES/EROFS). It is mocked in tests only. The operator's G6 report "playgorund ts plugin work" does not say which platform. The stub workaround stays until #548 (open).
- **S3-F01.** Rated low now, not medium: Rolldown tree-shakes the function out of the host. Only `getMethodsByTarget` is imported (`ShellCompletionProvider.ts:28`). It ships in the public package, where `..` is correct, and `package-checks/calls.mjs:89-100` checks that path.
- **S5-SW7.** Before "A passed", the coordinator listed items 5 (K8s/Atlas) and 7 (DEBUGTELEMETRY) as "not yet reported". Only the operator's blanket "A passed" closes them. That reading is recorded in the plan; no test evidence exists.

**Reconciliation qualification:** The copied S3-F01 tree-shaking statement is that evaluator's
view; the canonical row uses the source-grounded qualification and does not certify
concurrent output. See Inconsistencies.

#### Deferred items

- S5-F01 option 2 (runtime check that the K8s chunk is not evaluated): declined, not deferred; no open item.
- S5-F02 option 2 / #548 (ship the TS plugin as a packaged dependency): **open**. #548 is OPEN ("WIP: Publish TS server plugin as standalone npm package"); intended as the long-term fix.
- S2-F03 hook removal via dual-format azureauth: **open**, #990 (OPEN, on-hold, "after #880").
- G5 items moved to G6 (playground/TS plugin, Azure re-test, K8s/Atlas, native auth, DEBUGTELEMETRY, F5, Windows): **done** by the operator at G6, by the reading recorded above. Exception: the cold-start URI, which is **open, risk accepted**.
- G5 item 9 decisions (incl. S5-F01/S5-F02 coordinator decisions): **open**, moved to G7 (plan Stage 7 G7 list).
- Case 2 suite: **open**, deferred to Stage 9 by design.

### 06-stage6-review.md — main

Original: [06-stage6-review.md](./06-stage6-review.md) (main review, S6-F01/S6-F02;
range `8472f112..ece5acf8`).

| ID                                                   | Original severity | Current status | Current severity | Decision carried out?                                 | Evidence                                                                                                                    | Action |
| ---------------------------------------------------- | ----------------- | -------------- | ---------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------ |
| S6-F01: stale compiled tests in incremental tarballs | low               | resolved       | n/a              | yes, minimum fail-closed guard, no dist clean         | `b09b7629`; packed-tests `8-11`; checker `197-199,282-296` stale-test control; three unit tests pass.                       | none   |
| S6-F02: font growth bypasses graph budgets           | low               | resolved       | n/a              | yes, option-2 variant covering all non-JS view assets | `9b489252`; inspector `868`; viewsAssets budget `80,340`; control `373`; tests `1250,1280,1294` pass; README `177,212-214`. | none   |

#### Re-checks of earlier findings

- **F17:** Owned outside these eight historical review files; not counted. Original severity
  below major (deferred `future-work.md:67`); resolved `64a7992f`/`9fb027d7`, n/a severity.
  Name L1 control `_isUserCancelledError` (`inspect.cjs:147`, proof `233`), keepNames
  `vite.config.ext.mjs:127`, TS `~6.0.3`/NodeNext; timing `89-106` asserts activate event,
  operator-run only. Decision carried out, no action; local telemetry, not ingestion.
- **G5-I01:** Gate issue owned by the plan, not counted. Observed Azure discovery defect
  resolved `370efdf2` and operator installed-VSIX retest 2026-10-07; alias `157-160`,
  #990 OPEN/on-hold; option 1 + #990 implemented. Additional L1 guard remains undecided
  at G7, not declined (reconciled; see Inconsistencies). Only subscriptions alias is
  scheduled for #990 removal; BSON independent (reconciled; see Inconsistencies).
- **S1-F01:** See canonical 01 row. Resolved `3ac5b4a5`; plan/coordinator decision carried
  out, original review pending. No head.sha override. Earlier absent merge-ref-run
  observation is time-superseded below; action: record decision G7.
- **S2-F01:** See canonical 02 row. Resolved by operator ADO run 2026-10-07; review decision
  pending; pipeline `88-89,129`, green ADO attestation, no source SHA. Accept operational
  completion; provenance is X7-F07 (reconciled; see Inconsistencies).
- **S2-F03:** See canonical 02 row. Still valid/low; no configured pool/isolate
  (`vitest.config.ts:39-64`), setup claims true default; #990 step 5 only long-term option.
  Fix Stage 8: pin forks/isolate.
- **S2-F06:** See canonical 02 row. Resolved `dee7773e`; review pending, plan removal done;
  frozen `946f7961` manifest only glob/vite, later glob removal below; record G7.
- **S3-F02:** See canonical 03 row. Resolved `5fc49e8c`; ESM-only plan, pending review;
  documented/accepted unsupported require hang; CI `289-292`, README `154,417-426`,
  MIGRATION; record G7.
- **S3-F06:** See canonical 03 row. Main Stage 6 re-check resolves only compiled tests
  (`6c6cf71d`/`b09b7629`, three configs exclusions `21/21/22`); schema tests outside src.
  Full original scope still valid/low for declaration maps (reconciled; see Inconsistencies).

#### Notes

- **S6-F01:** the check rejects only `*.test.*`/`*.spec.*` paths. Stale non-test output is not caught (plan's ADO side finding: four stale `WizardBreadcrumb.*` files in a local fluentui tarball). `verify:packages` runs only in `npm-publish-documentdb-js.yml:94`, not in `main.yml` or ADO `build-npm-packages.yml`. Clean CI checkouts make this moot for the reviewer's scenario.
- **S6-F02:** the ADO L1 report (plan, G6 artifact verification) shows 14 budget graphs `ok`, so `viewsAssets` also ran on a Windows ADO build. Option 1 (per-view attribution of CSS-linked assets) was not chosen; the README says per-view rows are JavaScript closures.
- **G5-I01:** no automated guard exists against the same Rolldown pattern in another package (option 4 declined). L3 does not exercise discovery. Removing the alias under #990 depends on a manual re-test.
- **S2-F03:** the `setup.ts` header describes isolation as though it were configured; it is a Vitest default. The factory-mock split is documented (`setup.ts:23-24`) but not detected. #990 step 5 may remove the hook later; option 1 is independent and cheap.
- **S2-F01:** the ADO npm drop was compared with `npm pack` of the branch: same file lists (plan, G6 artifact verification). The run's commit is not recorded, and the main merge changed only ADO release YAML and the lockfile.

**Reconciliation qualification:** The copied G5-I01 note's “option 4 declined” is superseded
by the explicit G7 decision in the plan; the generic guard remains undecided. See
Inconsistencies.

#### Deferred items

- S6-F01 "fail closed before G6 publication": done (`b09b7629`). The `@documentdb-js` publish path runs it (`npm-publish-documentdb-js.yml:94`; dry runs 37618213760, 37625969263). The ADO `@microsoft` path still does not run it (PR-F02, outside this scope).
- Review summary "merged-PR CI run": **still open**. Every Stage 6 CI run was `workflow_dispatch` on the branch head. `946f7961` is not on the remote (PR head `bbdf6150`). `origin/main` = `1380b758`, so pushing should clear the conflict.
- "Feed-safe merge/conflict resolution": done in `946f7961` (merges `1380b758`; only `package-lock.json` and two ADO release YAMLs change). Quarantine clearance is per the plan's note (`electron-to-chromium` 1.5.443 clear from 2026-10-07 14:13 UTC). Not re-scanned here.
- Installed-VSIX checklist (Linux + Windows): done per operator, except item 3 (cold-start `vscode://` URI). The operator accepted that risk.
- Case 2, the CONTRIBUTING §6 pre-review blockers, publish, signed ADO build and the digest-bound release: moved to Stage 9; still open.
- G5-I01 option 3 / S2-F03 option 3: #990 (OPEN, on-hold, after #880 merges).

**Evaluation qualification:** This re-evaluator additionally reported `node --test` on
`packed-tests.test.cjs` and matched inspector budget/keepNames/assets tests (13 matched,
all pass), plus one `git fetch -q origin main` updating only the remote-tracking ref,
with no tracked/working-tree file changed. This is not a fresh product-build certification.
Its separate statement that both BSON and subscriptions aliases depend on #990 is
reconciled: only subscriptions is scheduled for removal under that issue.

### 06-stage6-review.md — addendum

Original: [06-stage6-review.md](./06-stage6-review.md) (addendum, S6-F03/S6-F04).

Read-only assessment frozen to `946f7961`; later override removal and CI observations
are distinguished below.

| ID                                        | Original severity | Current status | Current severity | Decision carried out?                                                     | Evidence                                                                                                | Action |
| ----------------------------------------- | ----------------- | -------------- | ---------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------ |
| S6-F03: oldest Trusted Publishing npm pin | low               | resolved       | n/a              | yes, newer exact quarantine-safe coordinator pin; G7 confirmation remains | `dd5b767d`; publisher `81-82,137-138` both npm 11.20.0; successful dry-run `37625969263` exact fix SHA. | none   |
| S6-F04: dry runs share publication queue  | low               | resolved       | n/a              | yes, publish-job-only concurrency; G7 confirmation remains                | `dd5b767d` removes workflow concurrency; publisher `112-120` group only on non-dry-run job.             | none   |

#### Notes

- **S6-F03:** `git show dd5b767d -- .github/workflows/npm-publish-documentdb-js.yml` confirms both 11.5.1 → 11.20.0 changes. Read-only `gh run view 37625969263 --repo microsoft/vscode-documentdb --json headSha,status,conclusion,event,jobs,url` independently confirms the exact fix SHA, successful **Use npm 11.20.0**, **Verify Packed Packages and Consumers**, and all four dry-run steps; **Publish to npmjs.com** was skipped. This resolves the selected remedy, not a claim that OIDC/provenance has been exercised.
- **S6-F04:** The same diff confirms removal of the top-level group and addition under `publish`; `verify` has no concurrency group, and `dry_run=true` excludes `publish`. Therefore a dry run cannot occupy or replace a pending member of the publication group. Run `37625969263` confirms the publish job is skipped in the dry-run path. No dedicated concurrency regression test was found in tracked `build/**/*.test.*` or `src/**/*.test.*`; simultaneous dispatches were not exercised.

#### Deferred items

- **S6-F03:** First real publication remains a Stage 9 operator step. `docs/ai-and-plans/modernization/pipelines-readme.md:241-254` requires checking package versions and Trusted Publisher settings and explicitly says a dry run cannot verify OIDC. The observed fix-run skipped real publication; it supplies no authentication/signing evidence. This expected release gate does not undo the implemented pin decision.
- **S6-F03/S6-F04:** The fixes were coordinator decisions, not operator decisions. The pre-existing G7 checklist in `docs/ai-and-plans/modernization/build-and-test-stack.md:3393-3403` calls for operator confirmation of the S6-F01–F04 fixes. Implementation is done; confirmation is not inferred from a successful workflow.

### 06-pr-pre-review.md

Original: [06-pr-pre-review.md](./06-pr-pre-review.md).

| ID                                            | Original severity | Current status | Current severity                                           | Decision carried out?                                                                                        | Evidence                                                                                                                                                     | Action                                                                                 |
| --------------------------------------------- | ----------------- | -------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| PR-F01: merged-input revalidation             | medium            | still valid    | medium — remaining validation, not old local conflict      | partly; merge/bumps done; merged-tree proof incomplete at evaluation time; override cleanup later superseded | `946f7961` parents `bbdf6150`/`1380b758`, 17 retained updates; no exact-SHA Actions then. Later CI/override evidence below; browser/ADO gates not certified. | decide at G7 — exact-HEAD residual checks, not another main merge                      |
| PR-F02: package checks absent from CI/ADO     | medium            | still valid    | medium — GitHub publisher fixed, other enforcement missing | partly; GitHub gate `c0fd83c8`; CI/ADO before-merge work remains                                             | Publisher `93-94,114`; ADO build `116-140`, pack script `38-61`; no main.yml verifier.                                                                       | fix in Stage 8 — general CI and ADO release enforcement                                |
| PR-F03: missing 0.9.0 migration notes         | low               | still valid    | low — docs, not semver violation                           | no; promised before-merge notes absent                                                                       | Three documentdb-js package manifests 0.9.0/ESM/exports/Node floor, READMEs no migration sections.                                                           | fix in Stage 8 — supported migration in each README                                    |
| PR-F04: unused emission/tool leftovers        | low               | still valid    | low — cleanup, not production failure                      | no; before-merge decision unimplemented                                                                      | `package.json:62-65`, root config `3-8`, webview configuration `51-60`, main.yml `346-349`, ignore `35`.                                                     | fix in Stage 8 — root no-emit/obsolete config cleanup; preserve workspace emission     |
| PR-F05: formatting excludes build tooling     | low               | still valid    | low — check coverage, not runtime                          | no; before-merge decision unimplemented                                                                      | Scripts `74-75` omit build/root mjs/cjs; CI `75-78` same script.                                                                                             | fix in Stage 8 — maintained-tooling coverage, generated-output exclusions              |
| PR-F06: undiscoverable rationale/stale design | low               | still valid    | low — navigation/current-state docs                        | no; before-merge indexing/current-state decision unimplemented                                               | KB index `23-42`, no modernization README; active webview design `659-676` CJS/webpack; Fluent index versus 1.1.1.                                           | fix in Stage 8 — signpost modernization/current architecture without rewriting history |

#### Notes

- **PR-F01:** The local merge conflict is **resolved**: `git merge-base --is-ancestor 1380b758 946f7961` succeeds. A read-only JSON comparison of the two parents and HEAD finds exactly 17 changed lock entries, all matching applicable `main` updates, with no added/removed entries. Examples: `package-lock.json:8576-8577` browserslist 4.29.3, `:13296-13297` markdown-it 14.3.2, `:17933-17934` undici 7.30.0, `:8554-8555` brace-expansion 2.1.7. However, `gh run list --repo microsoft/vscode-documentdb --commit 946f7961d3f2b93608e3741b3b8597124138bfc2 --limit 10 --json databaseId,workflowName,headSha,status,conclusion,event,url` returned `[]`; PR #880 still pointed to `bbdf6150`, so its remote conflict is **not** evidence against this local merge. No exact-HEAD artifact result was independently established here. Status retains only the original finding's changed-input/revalidation part, per the partial-fix rule; it must not be read as a request to redo the merge.
- **PR-F02:** `git grep` across tracked workflows/pipelines finds the only `verify:packages` call at publisher line 94; `needs: verify` protects GitHub publication. ADO still builds/tests then packs, and its release scan at `.azure-pipelines/release-npm-packages.yml:465-477` checks sensitive filenames, not test output/export/type/consumer contracts. The checker still creates its own archives (`build/verification/package-checks/check-packages.mjs:139-153`), invokes pinned validators through `npx` (`:41-42,201-206`), and has no already-packed-archive input. GitHub rebuilds rather than transferring verified tarballs (`npm-publish-documentdb-js.yml:126-144`); the addendum explicitly accepted that same-SHA/lock/toolchain design, so this is not a newly invented independent blocker.
- **PR-F03:** Read the three READMEs in full: operator-registry `:1-92`, shell-api-types `:1-105`, shell-runtime `:1-94`. Each has a pre-1.0 warning, but none explains the new Node floor, ESM/CommonJS/TypeScript consumption, or restricted deep imports. Manifest anchors are operator-registry `:3-17,36-37`, shell-api-types `:3-18,36-37`, shell-runtime `:3-17,41-42`; schema-analyzer already supplies the contrasting guidance at `CHANGELOG.md:3-10`. Retain the approved 0.9.0 versions; document permitted `typeDefs/*` access for shell-api-types rather than claiming every subpath is blocked.
- **PR-F04:** Root `tsc` still emits **ESM**, not CommonJS: `module: ESNext`, `outDir: out`, `sourceMap: true`, no `noEmit`. `.vscode/launch.json:12,15` launches `dist` with Watch, and `vite.config.ext.mjs:146` sets `IS_BUNDLE=true`, excluding the stale `out/src/webviews` fallback from the supported bundled path. `0843c1d0` deleted `.swcrc` and webpack configuration, but the leftover references remain. Thus webpack removal did not make this finding obsolete; it created cleanup that is still present.
- **PR-F05:** The defect is directly provable from the checked-in globs and CI call; no formatter was run. `git diff --name-only ec7c7ff1 946f7961 -- package.json build/verification .github/workflows/main.yml` is empty. The historical “21 files” count is not presented as a new measurement. Widen both check/fix commands before the final Case 2 formatting pass; formatting a few files manually would not repair coverage.
- **PR-F06:** `git ls-tree --name-only 946f7961 docs/ai-and-plans/modernization/` confirms no README, and both main plans start with headings, not frontmatter (`build-and-test-stack.md:1`, `e2e-testing-strategy.md:1`). The active webview design's “Today” table says CJS/webpack, while `packages/vscode-ext-webview/package.json:5` is ESM and root `package.json:91` uses Vite. Its “No Vite” passage at `design.md:1237-1242` belongs to the earlier API rework and explicitly makes ESM/bundler changes independent; it is not a violated prohibition. Existing links in `build/verification/README.md:3` and `build/vite/README.md:5` mitigate, but do not fix, the missing index route.

#### Deferred items

- **PR-F01 — integration:** Merge and applicable dependency/pipeline-source updates are done in `946f7961`. The before-merge CI/L1/L2/L3 and package checks remain **open/unverified in this evaluation**, not asserted failed; no builds, installs, test runs, or concurrent `dist`/report reads were used. Pre-merge green evidence cannot prove the updated worker/build inputs. Both ADO builds on the merged branch and the Stage 9 signed-file/digest release checks remain separate gates; the pre-existing Stage 7 checklist requires them.
- **PR-F01 — overrides/quarantine:** At the requested HEAD, `package.json:202-205` still contains both `glob: ~12.0.0` and `vite: $vite`; the merge changes no root manifest. The pre-merge plan at `build-and-test-stack.md:3342-3345` makes `glob` removal conditional on safe fresh resolution, while retaining `vite` pending [open issue #991](https://github.com/microsoft/vscode-documentdb/issues/991), whose existence and scope were verified with `gh issue view`. Conditional `glob` removal and G7 confirmation are still open at HEAD, irrespective of concurrent worktree changes. The seven-day quarantine remains the recorded policy; this review did not rerun a registry freshness scan or verify how the lockfile was regenerated.
- **PR-F02:** The GitHub publisher's gate is done (`c0fd83c8`, confirmed working by run `37625969263` after `dd5b767d`). General CI, ADO enforcement, and feed-compatible validator provisioning remain open before merge. The `b09b7629` packed-test rejection is present, including `build/verification/package-checks/packed-tests.test.cjs` test **“packed tests reject scripts, declarations, maps and other test companions”**; that unit test is not a substitute for invoking the verifier on ADO release inputs.
- **PR-F03:** Package migration/release notes were explicitly promised before merge; still open, moved into Stage 8 implementation rather than postponed until publication.
- **PR-F04/PR-F05/PR-F06:** The before-merge decisions remain open and belong to Stage 8. Full Case 2, including `prettier-fix`, remains deferred to Stage 9 ready-for-review preparation; that timing does not resolve PR-F05's missing script coverage. No scoped finding's inline author decision is still `_pending_`; the pre-review's older summary saying all six are pending is superseded by its dated decision blocks.

**Time-superseded evidence:** The copied per-file notes/deferred items describe their
`946f7961` observation time. At `63a69976`, glob removal and exact-HEAD CI/package dry-run
are established below, so those old “no HEAD CI”/glob-open statements are not current
obligations. PR-F01 remains partial because the cross-review did not establish the
remaining browser and ADO receipts. The later coordinator observation additionally
establishes L2-dev PASS on 18080 (X7-F09); it is not a claim about L2 or ADO.

## Inconsistencies between re-evaluations

“Correct status” applies to the original finding's whole scope unless explicitly split.
Two requested examples have **no status/severity conflict**.

| ID                      | File A says                                                                                             | File B says                                                                                                | Correct status                                                                                                                                                                                                                                                          | Evidence                                                                                                                                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S2-F01                  | `reeval-02.md`: still valid, low, exact Windows run provenance unverified                               | `reeval-06a.md`: resolved, operator ADO run; source SHA absent                                             | **Resolved by operator attestation for the original “Windows run untested” obligation; residual low provenance gap X7-F07.** `06a` is right on operational completion; `02` correctly identifies weaker auditability but should not imply the run is still unperformed. | Plan `3073-3085,3141-3143,3280-3285`; `.azure-pipelines/build-npm-packages.yml:89,123-130`. The extension SBOM SHA must not be assigned to the different npm drop.                                                                                                                                     |
| S2-F04                  | `reeval-02.md`: still valid, low; wrong namespace explanation remains                                   | `reeval-05.md`: resolved by plain-object conversion                                                        | **Still valid, low for the original record-accuracy finding; runtime hazard resolved. `02` is right for the complete finding.**                                                                                                                                         | Original `02-stage2-review.md:115-139` expressly requests correcting the explanation; plan `1413-1418` still says initializer dropped; `src/extensionVariables.ts:24-28,71-72` proves runtime fix `4386c580`.                                                                                          |
| S3-F06                  | `reeval-03.md`: still valid, low; test publication fixed but declaration maps still dangle              | `reeval-06a.md`: resolved, no current severity; title narrowed to compiled tests                           | **Partially resolved; still valid, low for the original full scope. `03` is right; `06a` is right only about compiled tests.**                                                                                                                                          | Original `03-stage3-review.md:190-197` includes declaration maps. Three affected `tsconfig.json:5,10-11` still emit maps to omitted `src`; package `files` allowlists include `dist`, not `src`. `6c6cf71d` and `b09b7629` resolve new/stale tests, not map sources.                                   |
| S3-F08                  | `reeval-03.md`: still valid, info; recommendation accept, author decision pending                       | `reeval-04.md`: still valid, info, “yes (accepted)”; `reeval-05.md` says accepted gap                      | **Still valid, info; no status/severity dispute. Formal author acceptance is not established. `03` is right about pending disposition.**                                                                                                                                | Original `03-stage3-review.md:233-244` calls the limit acceptable but leaves author decision pending; plan `2471` records the Vite port, not an explicit operator disposition. `bson-identity/check.cjs:17-63` still substitutes probe entries.                                                        |
| G5-I01 option 4         | `reeval-06a.md` calls the additional L1 guard “declined”                                                | `reeval-05.md` calls it a G7 decision                                                                      | **Observed defect resolved; additional guard remains undecided at G7. `05` is right.**                                                                                                                                                                                  | Plan `3408-3410` explicitly asks G7 to decide option 4; `build/vite/README.md:217-226` confirms no guard. Do not confuse S5-F01's declined alternative with G5-I01's open choice.                                                                                                                      |
| G5-I01 / S3-F08 aliases | `reeval-06a.md` says both BSON and subscriptions aliases depend on #990                                 | `reeval-03.md` treats BSON as its own identity contract; `reeval-05.md` links the Azure workaround to #990 | **Only the subscriptions alias is scheduled for removal under #990; BSON is independent. `03`/`05` are right.**                                                                                                                                                         | `vite.config.ext.mjs:35-39,153-160`; read-only `gh issue view 990` names only removing the subscriptions alias and conditionally reconsidering the test loader. It does not authorize deleting BSON deduplication.                                                                                     |
| S2-F03                  | `reeval-02.md`: still valid, low; pin isolation and consider loader/mock checks                         | `reeval-05.md`/`reeval-06a.md`: still valid, low; #990 later, immediate pin missing                        | **Agreement: still valid, low.** No re-evaluation needs a status/severity correction.                                                                                                                                                                                   | `vitest.config.ts:57-79` has no explicit pool/isolation; `test/vitest/setup.ts:23-39` documents and implements the split. Production ESM does not erase CommonJS test dependencies.                                                                                                                    |
| S3-F01                  | `reeval-03.md`: still valid, low, latent layout mismatch; does not rely on concurrent bundle inspection | `reeval-05.md`: still valid, low, latent; additionally asserts tree-shaking                                | **Agreement: still valid, low and latent, not a broken current TS-plugin path.** Use `03`'s source-grounded qualification; this sweep does not certify tree-shaking from mutable output.                                                                                | No `getShellApiDtsContent` caller in `src`; `packages/documentdb-js-shell-api-types/src/index.ts:36-39` uses `../typeDefs`, versus Vite's flat chunk root/copy at `vite.config.ext.mjs:205-210,259`. Actual TS plugin uses its own correct path (`src/documentdb/playground/tsPlugin/index.ts:43-45`). |

The older “no HEAD CI” statements are **time-superseded observations, not contradictions**:
the exact-HEAD successful dispatch and dry-run below now exist. Similarly, stage-review
informational assurances should not be counted as defects merely because one evaluator
labels them “still valid” and another uses “false positive in hindsight.”

## Cross-review findings

### Scope and evidence rules

Read-only review of the eight supplied re-evaluations, the relevant original findings and gate records, tracked source/configuration, Git history, and GitHub run metadata. No installation, build, package, test-suite execution, Git mutation, or inspection of concurrently generated `dist/`, `out/`, reports, or tarballs was performed. Two small discriminating probes ran entirely in memory: TypeScript diagnostics and the exported JavaScript inspector. The only file written is this report.

Paths and line numbers below refer to `63a69976`. “Plan” means `docs/ai-and-plans/modernization/build-and-test-stack.md`. An operator attestation is valid evidence of an operator check, but is not an independently reproduced result or an exact-artifact receipt. “Accepted” as a review recommendation is not silently promoted to an author decision.

The `946f7961` evaluations remain applicable to source/configuration: `git diff --name-status 946f7961 63a69976` lists only `package.json` and `package-lock.json`. The following later facts supersede their “no HEAD CI” and override statements:

- `63a69976` removes the global `glob` override; only `vite: "$vite"` remains (`package.json:202-204`). Its commit message records successful build, lint and 298 files / 4,603 tests; these are author-reported results, not executions by this reviewer.
- Read-only lockfile comparison confirms 25 newly nested entries after override removal. `@vscode/l10n-dev` gets `glob@10.5.0`, `@vscode/vsce` gets `11.1.0`, root direct `glob` stays `12.0.0`, and `rimraf` gets `13.0.6`; all four entries are `dev: true`. Deprecation of the first two is not itself a vulnerability or a runtime regression. The supplied equal audit totals, 21 with or without the override versus 55 on `main`, were not independently rerun.
- Exact-HEAD CI dispatch [37638523801](https://github.com/microsoft/vscode-documentdb/actions/runs/37638523801) completed **successfully**, with Code Quality & Tests, Build & Package, L1 and L3 all successful. Exact-head publication dry-run [37638589114](https://github.com/microsoft/vscode-documentdb/actions/runs/37638589114) also succeeded: workspace tests, packed-consumer verification and all four dry-run publish steps passed; the real publish job was **skipped**.
- PR-triggered CI [37638469920](https://github.com/microsoft/vscode-documentdb/actions/runs/37638469920), associated with HEAD and using the restored default checkout policy, also completed **successfully** at the final observation: all four jobs passed. Earlier pending observations are superseded. These green runs do not replace the outstanding Stage 7 L2/L2-dev and ADO evidence, nor Stage 9 verification of signed release bytes.

**Later coordinator evidence:** X7-F09 records L2-dev PASS at `63a69976` on port 18080;
the cross-review's earlier unestablished L2-dev receipt is time-superseded to that extent.
No broader L2/ADO/signed-artifact conclusion is inferred.

### X7-F01 — Package-publication protection is still dependent on the publishing route

- **Severity:** medium. **Confidence:** high.
- **Related findings:** S3-F06, S6-F01, PR-F02; S3-F02 provides a separate real-host consumer check.
- **E2E iteration / Stage 10:** **yes**, carry the exact-tarball verification boundary; the already-decided publication fix belongs in Stage 8, not deferred wholesale to E2E.
- **Finding and shared root cause:** Stage 3 found shipped test output; Stage 6 excluded new test emission and added a stale-test rejection. Those fixes protect only callers of the package verifier. General PR CI and the ADO `@microsoft/*` build/release path never call it. Clean ADO artifacts observed at G6 establish the contents of that drop, not an enduring publication gate. This is incomplete enforcement, not a claim that `6c6cf71d` or `b09b7629` was reverted.
- **Evidence:** `build/verification/package-checks/check-packages.mjs:139-153,195-221,282-296` packs and checks its own archives; `packed-tests.cjs:8-11` rejects test/spec paths. `.github/workflows/npm-publish-documentdb-js.yml:93-94,112-120` now gates real GitHub publication correctly. `.azure-pipelines/build-npm-packages.yml:116-140` builds, runs Vitest and packs without the verifier; `.azure-pipelines/scripts/pack-npm-packages.ps1:38-61` calls `npm pack`; `.azure-pipelines/release-npm-packages.yml:465-477` checks sensitive-file patterns, not test output or exports/consumer compatibility. `.github/workflows/main.yml:61-81,168-185,289-292,343-347` has no `verify:packages` call. The plan at `3139-3154` records both clean ADO tarballs and four stale non-test local `WizardBreadcrumb.*` files that the test-name-only guard cannot detect.
- **Solutions:**
  1. Gate general CI on full packed-consumer verification, and add an offline verifier for the actual ADO-produced archives, recording their source SHA/digests. **Pros:** enforces the contract across both publishing routes without requiring public validator downloads in ADO. **Cons:** archive-input support and splitting online/offline checks require implementation.
  2. Verify the downloaded ADO tarballs manually before each release and record digests. **Pros:** quickest closure for this release. **Cons:** procedural, easy to omit, and a local rebuild is not verification of the downloaded archives.
- **Recommended option:** 1, because the architecture now distributes six ESM packages through two different publication systems and the guard must follow the artifact, not the developer's chosen command.

**Author decision:** _pending_

### X7-F02 — Dynamic interoperability is less well covered than the graph and mock checks imply

- **Severity:** low. **Confidence:** high for the missing checks; no current production failure asserted.
- **Related findings:** S2-F03, S3-F04, S3-F08, S5-F01, G5-I01, F17.
- **E2E iteration / Stage 10:** **yes**, especially installed-package Azure discovery and dependency/workaround changes.
- **Finding and shared root cause:** The Vitest, workspace-consumer, Vite-probe and VSIX-graph layers validate different boundaries. Porting the identity harness to Vite did not add the dynamic BSON route explicitly requested in Stage 3. The Azure lowered-import bug escaped unit tests and activation checks because those did not execute the affected bundled discovery operation; its targeted alias fixes the observed failure but has no dedicated regression guard. These facts do not establish that graph counts or the alias are wrong today.
- **Evidence:** `build/verification/bson-identity/hostProbe.ts:8-21` and `workerProbe.ts:8-18` enumerate static imports only; `check.cjs:17-63,99-109` replaces product entry points and calls synchronous `objectIdRoutes()`. `770446c2` ported the harness without closing S3-F04. `build/verification/inspect.cjs:619-625` counts recognized BSON paths, not constructor behavior. `test/vitest/setup.ts:23-39` retains the ESM-factory/CommonJS-default mock split. `vite.config.ext.mjs:153-160` independently aliases BSON and the Azure subscriptions SDK. `build/vite/README.md:217-226` expressly states that the lowered-import failure has no dedicated L1 invariant and L3 does not call discovery. G5-I01's installed-VSIX re-test passed by operator attestation (plan `3100-3108,3211-3215`).
- **Solutions:**
  1. Add and await dynamic `import('bson')` routes in both identity probes, and add a narrowly scoped production-config namespace-return regression probe for the Azure lowering pattern. Keep the broader installed Azure journeys in Stage 10. **Pros:** discriminating, low-cost coverage at the actual compiler boundary; does not require credentials. **Cons:** a synthetic probe still cannot prove every shipped dependency path.
  2. Explicitly accept both residual limits and require an installed-VSIX discovery/worker check whenever the aliases, bundler or implicated dependencies change. **Pros:** avoids additional harness code. **Cons:** depends on manual discipline and leaves the known missing dynamic route open.
- **Recommended option:** 1, because it targets two demonstrated historical failure mechanisms instead of equating green unit tests, graph structure and successful activation with exercised runtime semantics.

**Author decision:** _pending_

### X7-F03 — No macOS execution is evidenced across the migration

- **Severity:** low. **Confidence:** high about the available record; this is not proof nobody ran an unrecorded check.
- **Related findings:** S4-F03; Stage 5 verification limits; S5-SW12 in `reeval-05.md`; G6 platform checklist.
- **E2E iteration / Stage 10:** **yes**, record macOS as an untested execution platform.
- **Evidence:** All four general-CI jobs use Ubuntu (`.github/workflows/main.yml:42,156,261,311`); ADO uses Windows (`.azure-pipelines/build.yml:84`, `build-npm-packages.yml:89`). The operator's second-platform report names Windows and Windows F5 (plan `3100-3110`); final G6 disposition names Linux and Windows (`3280-3285`), not macOS. A simulated macOS L2-dev route is a fixture, not a macOS run. The host still has platform-specific optional certificate requests (`vite.config.ext.mjs:61-62`), alongside changed ESM worker/plugin packaging.
- **Qualification:** G6 explicitly requested Linux plus **Windows or macOS** (plan `3007,3049`), so the Windows report satisfies that gate's stated alternatives. Do not turn the absence of macOS evidence into a fabricated failed mandatory G6 check.
- **Solutions:**
  1. Have the operator run a bounded macOS installed-VSIX smoke covering activation, panels/workers, playground/plugin and F5; attach VS Code version, SHA and artifact digest. **Pros:** resolves platform uncertainty now. **Cons:** requires a Mac and operator time.
  2. Accept the platform gap explicitly and create a Stage 10 macOS lane/manual checklist with an owner. **Pros:** consistent with the actual G6 requirement and avoids blocking this PR solely on an extra platform. **Cons:** users may encounter a platform-only problem before automation lands.
- **Recommended option:** 2, unless a Mac is readily available, because the required Windows alternative was exercised and the remaining uncertainty should be tracked honestly rather than called a gate failure.

**Author decision:** _pending_

### X7-F04 — Browser gates remain agent/operator-run, with a documented headless substitution

- **Severity:** info. **Confidence:** high.
- **Related findings:** Stage 0 F02, S3-F07, S4-F03; Stage 5/6 L2 verification limits.
- **E2E iteration / Stage 10:** **yes**, a primary hand-over requirement.
- **Finding:** “No real webview was ever checked” is **refuted** by the operator's installed-VSIX G4 and G6 attestations. The narrower statement is true: production L2 is a static-origin test with a fake host API, not an automated real-workbench-origin proof; L2/L2-dev are not general-CI gates. Several later checks used headless Playwright rather than the integrated-browser tools specified in the original procedure.
- **Evidence:** `build/verification/browser/template.ts:58-78` supplies the static `cspSource` and fake `asWebviewUri`; `browser/runtime.ts:286` installs `fakeVsCodeApi`; `build/verification/README.md:253-303` explicitly states the limit. Plan `193-213` specifies the integrated browser; `1848-1850,2170-2174,2553-2556,2899-2902,2948-2951,3135-3137` records the headless substitution rather than concealing it. G4 installed-VSIX/theme checks and integrated-browser L2-dev opening are recorded at `2302-2318`; G6 passed the installed checklist except URI at `3211-3215`. The `/host` probe creates a real tab (`build/verification/package-checks/unbundled-host/exercise.cjs:41-45,83-94`) but is not an assertion of the five production panels' worker/font behavior. Stage 10 already carries headless CI and scenario wiring (`3484-3501`).
- **Solutions:**
  1. Preserve two named contracts in the hand-over: repeatable headless static-origin L2/L2-dev in CI, plus an installed-workbench lane for real resource URLs, workers, themes and host messages. State when integrated-browser operator checks are still required. **Pros:** distinguishes actual coverage and automates the existing repeatable checks. **Cons:** the workbench lane requires extra infrastructure.
  2. Require all future gate browser runs through integrated tools and retain real-origin behavior as a manual checklist only. **Pros:** matches the original procedure literally. **Cons:** integrated tooling availability remains a bottleneck and still does not turn static L2 into real-origin coverage.
- **Recommended option:** 1, because the headless runs execute the same assertions without CSP bypass, while only a separate workbench test can close the origin/host boundary.

**Author decision:** _pending_

### X7-F05 — The cold-start URI journey remains explicitly untested and accepted

- **Severity:** low. **Confidence:** high.
- **Related findings:** Stage 5 cold-start follow-up / S5-SW5; G6 item 3; Stage 10 URI-race candidate.
- **E2E iteration / Stage 10:** **yes**, retain the accepted risk verbatim and add an executable scenario.
- **Evidence:** `main.ts:20-24` awaits the implementation before activation; `src/extension.ts:80-85` registers the URI handler after cluster-support initialization. L3's existing activation proof is not an OS protocol launch. Plan `3211-3215` records the operator's exact acceptance: “uri wasn't tested, but i accept the risk”; `3489-3493` carries it to Stage 10. `05-stage5-review.md:185-198` explains why VS Code buffering makes slower imports alone insufficient evidence of a URI-loss bug.
- **Solutions:**
  1. Retain the acceptance and add a Stage 10 cold-start installed-VSIX journey, including URI arrival before activation, delayed Azure availability and error handling. **Pros:** respects the decision and covers the actual race boundary. **Cons:** the residual risk remains until that work lands.
  2. Run an operator protocol-launch smoke before release and append its exact artifact/platform evidence. **Pros:** cheap additional confidence now. **Cons:** a happy-path manual run does not replace a deterministic race test.
- **Recommended option:** 1, because there is an explicit accepted exception and no evidence justifying silently reopening it as a confirmed runtime failure.

**Author decision:** _pending_

### X7-F06 — Telemetry emission was observed locally, not at the receiving service

- **Severity:** info. **Confidence:** high.
- **Related findings:** F17; Stage 5 telemetry follow-up / S5-SW8; G6 item 7.
- **E2E iteration / Stage 10:** **yes**, distinguish instrumentation from transport/ingestion.
- **Evidence:** `build/verification/activation/timing.cjs:89-108,156,180-181` parses the printed `activate` event and launches with `DEBUGTELEMETRY=verbose`; `activation/runner.cjs:271,310` disables normal telemetry in L3. `05-stage5-review.md:244-253` explicitly distinguishes DebugReporter from remote ingestion. G6's checklist itself asks for `DEBUGTELEMETRY` (plan `3062`), and its blanket “A passed” is not a service-side receipt. The Stage 5 intent also calls the real send path an operator check (plan `2352-2356`). No service-side confirmation was found.
- **Qualification:** Local activation measurements and kept names genuinely close those parts of F17. The absence of a remote receipt is not evidence that telemetry is broken.
- **Solutions:**
  1. Record this boundary and have an authorized operator correlate a non-sensitive event from the release candidate with a service-side receipt, subject to telemetry consent and access controls. **Pros:** tests transport plus ingestion. **Cons:** needs service access and may be delayed by ingestion latency.
  2. Accept service ingestion as outside this migration and add transport-dispatch coverage with a controlled reporter in Stage 10, retaining the debug event assertions. **Pros:** deterministic and no production-data access. **Cons:** still cannot establish that the production service received an event.
- **Recommended option:** 2 for the PR, because the existing gate promises debug-event observation; explicitly retain a separate operator ingestion check rather than overstating its proof.

**Author decision:** _pending_

### X7-F07 — Historical evidence, implementation status and author disposition have drifted apart

- **Severity:** low. **Confidence:** high.
- **Related findings:** S1-F04, S2-F01, S2-F04, S2-F05, S3-F07, PR-F06; resolved S1-F01/S2-F06/S3-F02; G5/G6 coordinator decisions.
- **E2E iteration / Stage 10:** **yes**, hand over evidence provenance and accepted gaps, not just “gate passed.”
- **Finding and shared root cause:** Later passes or broad approvals were appended without consistently correcting the original factual assertions or distinguishing implementation from individual author decisions. This explains several re-evaluation disagreements. G7 is the planned point to reconcile dispositions; pending text alone must not resurrect a fixed defect.
- **Evidence:** Plan `846` still says run 37021977737 “never got a runner”; read-only `gh api .../actions/runs/37021977737` returned `completed/success` for `5b4ead56`. Plan `1413-1418` retains the wrong initializer explanation even though `src/extensionVariables.ts:24-28,71-72` now implements the safe object. Plan `1472` misattributes the TS plugin to the package helper, while `src/documentdb/playground/tsPlugin/index.ts:43-45` reads its own path. The ADO npm drop has no recorded commit (plan `3141-3143`); the extension drop separately has SBOM SHA `fb36e491` (`3120-3123`). Stage 1 decision cells remain pending (`01-stage1-review.md:77,104,121,140,154,171,188,202`), whereas PR decisions are dated (`06-pr-pre-review.md:98-102,158-159,201-202,250-251,283-284,328-329`), contradicting that review's summary at `448`.
- **Additional provenance correction:** `00-stage0-review.md:20,33,54-56` cites pre-rebase hashes. Read-only ancestry/patch-ID checks establish `c1d29535 → a0836927`, `0be05e8c → 88b568cf`, `a6689e76 → b3a42db6`: each pair has an identical stable patch ID, but only the latter is an ancestor of HEAD. Old hashes are not proof the fixes are absent.
- **Solutions:**
  1. In the Stage 7 consolidated record, separate implementation, observed checks, operator attestations and pending dispositions; include the hash map and factual corrections, link historical reviews, and ask for ADO npm run URL/source SHA. **Pros:** preserves history and produces one authoritative current account. **Cons:** requires careful evidence reconciliation and some operator provenance.
  2. Retain the scattered records and add only a short caveat that some statuses are stale. **Pros:** minimal effort. **Cons:** leaves the same ambiguous claims for Stage 10 and future release reviewers.
- **Recommended option:** 1, because it follows Stage 7's no-history-rewrite model while preventing “resolved,” “accepted,” and “verified at HEAD” from being treated as interchangeable.

**Author decision:** _pending_

### X7-F08 — Vite inspection dropped the old fail-closed ambiguous-owner guard

- **Severity:** info. **Confidence:** high for the reproduced inspector behavior; low present product impact.
- **Related findings:** Stage 0 F01, S3-F05, S4-F02.
- **E2E iteration / Stage 10:** **yes**, as a small inherited verification-invariant hardening item.
- **Evidence and regression boundary:** Stage 0 fix `a0836927:build/verification/inspect.cjs:72` required exactly one owner when interpreting webpack numeric chunk references. The numeric-chunk bug is now **obsolete**, not reintroduced. However, the Vite replacement at `build/verification/inspect.cjs:502-512` requires only at least one owner and combines permissions using `some(...)`; host ownership enables `node:` dynamic imports at `572-574`. Hash validation at `1016-1027` does not reject two reports binding identical bytes.
- **Read-only discriminating probe:** A `Map` containing `extension/shared.mjs` with `export const load = () => import('node:fs');`, supplied to exported `inspectJavaScript`, was **rejected** with a views-only owner and **accepted** when the same hash also appeared in a host report. Nothing was written. This tests the precise inspector boundary, not a fabricated full shipped VSIX.
- **Limit:** Actual host chunks are `.mjs`/`.cjs` and view chunks `.js` (`vite.config.ext.mjs:205-207,224-227`; `vite.config.views.mjs:111-115`), so this review found no current filename collision. This is loss of an ambiguity-rejection invariant during replacement, not an observed shipping regression or vulnerability.
- **Solutions:**
  1. Require exactly one owner across host/views reports for every packaged script, with a same-bytes/two-reports negative test. **Pros:** makes permission selection unambiguous and preserves the original defensive intent. **Cons:** any intentional future sharing needs an explicit policy.
  2. Accept the disjoint filename-format policy and add a configuration/report test proving host and view inventories cannot overlap. **Pros:** reflects today's output layout. **Cons:** protects the convention rather than rejecting malformed provenance at the inspection boundary.
- **Recommended option:** 1, because ownership ambiguity can be rejected directly without weakening any current build.

**Author decision:** _pending_

### X7-F09 — L2-dev on a non-default port silently depends on a server on port 18080

Observed by: the Stage 7 coordinator while running step 7.1's checks; HEAD `63a69976`;
2026-10-07.

- **Severity:** info. **Confidence:** high (reproduced).
- **Related:** L2-dev (Stage 4), the local verification kit's recipe; no earlier finding.
- **E2E iteration / Stage 10:** yes, when L2-dev runs in CI it must serve on the origin the config hands out.
- **Evidence:** `vite.config.views.mjs:36-38,176-181` fixes `server.origin` to `http://localhost:18080` (the development CSP origin, by design). Monaco worker URLs are therefore always `http://localhost:18080/...?worker_file&type=module`, whatever port the server listens on. The local kit (outside the repository) ran L2-dev with `npx vite --config vite.config.views.mjs --port 18087 --strictPort` because 18080 is usually the operator's Watch task. With nothing on 18080, the run at 63a69976 gave `routes=42 ready=36`: the six `collectionView/default/*` and `documentView/default/*` routes failed with "Could not create web worker(s)" and `net::ERR_CONNECTION_REFUSED` for `http://localhost:18080/node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker_file&type=module` (a Playwright probe recorded the failed request). The same tree on port 18080 gave `routes=42 ready=42 errors=0 assertions=60/60`, `L2-DEV PASS`. Earlier stages' 18087 passes therefore loaded their workers from the operator's Watch server on 18080, which serves the same working tree, so those results stand, but the recipe was not self-contained.
- **Solutions:**
  1. Document it: the repository's recipe (`npm run watch:views`, port 18080, in `.github/copilot-instructions.md` and `build/verification/README.md`) is already correct; fix only the local kit recipe (done by the coordinator on 2026-10-07, outside the repository) and add one sentence to the L2-dev section of `build/verification/README.md`. **Pros:** no code change; keeps the CSP contract. **Cons:** relies on readers.
  2. Make `run-all.js` / the runner fail fast with a clear message when the page's port differs from the configured origin. **Pros:** self-diagnosing. **Cons:** small harness change.
  3. Derive `server.origin` from the actual port. **Pros:** any port works. **Cons:** the extension's development CSP allows exactly 18080; both sides would have to change, for a scenario-only convenience.
- **Recommended option:** 1 now, plus 2 in the E2E iteration when L2-dev moves into CI, because the repository's documented recipe is already correct.

**Author decision:** _pending_

## Deferred-item and regression ledger

This ledger avoids counting already resolved or deliberately postponed work as new defects.
Its browser-receipt observation is qualified by the later coordinator evidence in X7-F09.

| Earlier obligation                                             | Current disposition and evidence                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1-F01: restore merge-ref checkout                             | **Implemented**, `3ac5b4a5`; all four checkouts in `.github/workflows/main.yml:50,162,266,331` use the default ref. The HEAD PR-triggered run completed successfully with all four jobs green. G7 coordinator-decision confirmation remains, not a checkout fix.                                                                                |
| Temporary overrides / S2-F06                                   | Temporary Stage 2 pins and `test-exclude` were removed in `dee7773e`; `glob` removed in `63a69976`. `vite: "$vite"` remains explicitly justified by the npm 10.9.3 resolver crash (`package.json:201-204`, plan `3344-3347`), with #991 named for retesting. No evidence that deprecated nested glob versions restore an earlier vulnerability. |
| S2-F01: Windows workspace tests before publication             | **Run according to the operator**; ADO pipeline still executes the tests on Windows (`build-npm-packages.yml:89,123-130`). Missing exact npm-build provenance is X7-F07, not an observed test failure.                                                                                                                                          |
| S2-F03: immediate isolation pin; later loader removal          | **Immediate pin still open** (`vitest.config.ts:57-79`; `test/vitest/setup.ts:23-39`). The old “before Stage 5” upgrade suggestion became open, on-hold #990 after this PR; upgrading one Azure dependency does not prove every CommonJS consumer stopped requiring the hook.                                                                   |
| S3-F02: unbundled `/host` before publication                   | **Resolved**, `5fc49e8c`: real-host variants and negative control exist (`unbundled-host-probe.cjs:57-109`), and CI runs them (`main.yml:289-292`). Synchronous unbundled `require('/host')` is a tested, documented unsupported hang, not promised compatibility.                                                                              |
| S3-F04: add the dynamic BSON route; S3-F08: revisit after Vite | Dynamic route **still missing**; real-config probes were ported in `770446c2`, not replaced by real-artifact constructor tests. X7-F02; accept the separate probe/artifact boundary only as an explicit disposition.                                                                                                                            |
| S3-F06: stop new compiled-test publication                     | **Implemented**, `6c6cf71d`; stale-test rejection in `b09b7629`. ADO enforcement is X7-F01; inaccessible declaration-map sources remain a separate, pre-existing low-severity residue. The changed strict test-typechecking boundary is new sweep finding SW7-F01.                                                                              |
| S4-F01/S4-F02 and S5-F01/S5-F02                                | Fixes remain: required assets (`dda2734c`), Monaco provenance (`3bb7e09b`), awaited implementation closure (`555f9def`), atomic plugin-stub publication (`90374fee`). No evidence of their reversal. The broader TS-plugin workaround and real Windows rename failures remain follow-up context, not a reintroduced truncation bug.             |
| S4 per-view sizes; S6 non-script asset budget                  | Implemented by `19f34777`, `f53df711`, `9b489252`; required assets and budget controls remain at HEAD. The manual runtime-asset list can drift with future features, but no currently missing runtime asset was identified here.                                                                                                                |
| G5-I01 / F17                                                   | Observed Azure failure fixed by `370efdf2` plus operator re-test; generic lowering guard remains a **G7 decision** (plan `3408-3410`). Kept-name and local telemetry checks landed in `64a7992f`/timing tooling; ingestion is X7-F06.                                                                                                           |
| PR-F01 / Stage 7.1                                             | Merge implemented (`946f7961`, parent `1380b758`); lockfile comparison confirms the 17 retained version changes, including browserslist, markdown-it and undici. HEAD full CI dispatch, PR-triggered CI and publication dry-run are now green. L2/L2-dev and both ADO build receipts were not established by this reviewer.                     |
| PR-F02–PR-F06 before merge                                     | Remain Stage 8 obligations: ADO/general package enforcement, consumer migration notes, non-emitting root check/leftovers, formatting coverage, and current design/navigation. Implemented GitHub publication gating narrows PR-F02, not the other obligations.                                                                                  |
| Stage 9 release-only checks                                    | Real Trusted Publishing/OIDC, final Case 2, requested Copilot review and dispositions, signed-main VSIX with digest-bound L1/L2/L3, and release approval are **still future gates**, not proved by branch build or publish dry-run. Plan `3451-3479`.                                                                                           |
| Stage 10 browser work                                          | CI L2/L2-dev, real-workbench integration and automatically advancing hand-opened scenario routes remain planned (`3481-3501`). Preserve X7-F02–F08's applicable boundaries rather than claiming G6 closed them all.                                                                                                                             |

No claim is made that a previously fixed current-path runtime defect was reintroduced.
Two concrete cross-stage weakenings were found: ambiguous-owner rejection was not retained
in the Vite inspector (X7-F08, presently limited by disjoint output formats), and strict
package-test diagnostics were lost when tests left the package build projects (SW7-F01).
S6-F01's stale output was an incomplete clean-build fix, not reintroduction of test compilation.

## Combined-migration sweep

### SW7-F01 — Removing published tests silently weakened their TypeScript contract

- **Severity:** low. **Confidence:** high; reproduced with an in-memory compiler probe.
- **Related findings:** S2-F07, S3-F06, S6-F01, PR-F04.
- **E2E iteration / Stage 10:** **yes**, preserve strict, non-emitting test checks when adding test projects; fix the immediate regression in Stage 8.
- **Combined failure mechanism:** Stage 2 switched to Vitest runtime transformation; Stage 3 established strict NodeNext workspace packages; Stage 6 correctly excluded test sources from distributable projects and moved their remaining type-check to the root TypeScript 6 program. But that root uses `strict: false`, Bundler resolution and browser libraries. Therefore “tests stay type-checked” is true but “the existing package-test diagnostics are preserved” is false—even on the full CI path that runs root `tsc`. On fast/general package-publication paths that only build workspaces and run Vitest, the affected tests receive no TypeScript diagnostic pass at all. That latter part is known S2-F07; the **strictness loss even when the fallback runs** is the additional sweep finding.
- **Evidence:** `packages/documentdb-js-operator-registry/tsconfig.json:3-12,20-21`, `shell-api-types/tsconfig.json:3-12,21-22`, `shell-runtime/tsconfig.json:3-12,20-21` set strict NodeNext builds but exclude tests. `tsconfig.json:3-14,36-43` sets Bundler resolution, DOM libraries, explicit `strict: false` and the broad root program. `package.json:62-63,76-77` distinguishes root `tsc` from workspace prebuild plus Vitest. `vitest.config.ts:38-145` defines runtime projects, no TypeScript typecheck gate. `.github/workflows/main.yml:61-81,318-325,343-344` only runs root `tsc` in the conditional full build job; the npm publisher at `npm-publish-documentdb-js.yml:87-94` and ADO at `build-npm-packages.yml:116-130` build workspaces and run runtime tests.
- **History:** `6c6cf71d` changed the three exclusions and expressly claimed root checking as the replacement. Read-only parsing of its parent configs against current sources yields **6, 1 and 4** test files respectively; current package configs yield **0, 0 and 0**. Root config includes the test files, but under different compiler options. The original shell-runtime config on `v0.11.0` already had `strict: true`, so this is not a demand to introduce a new project-wide strictness policy.
- **Discriminating command result:** A virtual test source, `export function reviewProbe(value) { return value; }`, was supplied through an in-memory TypeScript compiler host using each existing config's options, with emit disabled and no files created. Root configuration: `strict=false`, `moduleResolution=Bundler`, **no TS7006**. Shell-runtime configuration: `strict=true`, `moduleResolution=NodeNext`, **TS7006: Parameter 'value' implicitly has an 'any' type.** This proves a real lost diagnostic; it does not claim that current tests contain this injected error or that runtime tests now fail.
- **Solutions:**
  1. Add explicit non-emitting test configs inheriting each affected package's strict/NodeNext options, include their tests, and run those checks in normal CI and both package-verification paths. Keep production exclusions. **Pros:** restores the previous diagnostic contract without shipping tests or changing incremental production output. **Cons:** a few configs and an additional small CI step.
  2. Compile tests with their original package settings into a separate non-published output directory, then continue using the tarball hygiene guard. **Pros:** restores diagnostics and provides explicit build inputs. **Cons:** more output/cleaning and configuration than a no-emit check.
- **Recommended option:** 1, because it preserves both fixes—strict test validation and clean published packages—without forcing the whole extension into strict mode.

**Author decision:** _pending_

### Sweep boundaries checked without another finding

- **ESM entry, chunking and CJS plugin:** `main.ts:20-24`, host/TS-plugin environments at `vite.config.ext.mjs:186-229`, and `inspect.cjs:669-707` agree on the awaited implementation boundary and separate `.cjs` plugin. Existing real-host CI now succeeds at HEAD. No evidence supports reopening S5-F01/F02 or inferring a cold-start URI failure merely from top-level await.
- **Runtime externals and package layout:** `.vscodeignore:16,18` excludes dependency/workspace trees; `package.json:67-71` packages `dist` with `--no-dependencies`. The explicit external policy is at `vite.config.ext.mjs:41-79` and documented at `build/vite/README.md:228-265`. Lazy unguarded SSH and the optional PAC/config branches are already disclosed Stage 5 limits; no new normal-path failure was demonstrated. Re-reporting their existence as new migration regressions would be unsupported.
- **Node `require(esm)` versus VS Code:** S3-F02's real-host probe and README correctly distinguish import success from the synchronous `/host` deadlock. Plain-Node stub probes are not substituted for that host result. No demand to ship a second CommonJS distribution is inferred from an expressly ESM-only support decision.
- **BSON versus other dual builds:** the aliases have distinct rationales. Duplicate Azure module formats alone do not prove a broken singleton/`instanceof` exchange. The actionable unexercised routes are X7-F02; no additional constructor bug was found.
- **Merged dependency bumps and pipeline rename:** read-only lockfile comparison confirms 17 applicable version changes between the merge's first parent and `946f7961`; Vite/BSON configuration did not change in that merge. `git diff 1380b758 63a69976 -- .azure-pipelines/release.yml .azure-pipelines/release-npm-packages.yml` is empty: both upstream pipeline source-name changes were retained exactly. Current full-dispatch CI and package dry-run are green. This does not prove ADO feed acceptance or the later signed artifact; those remain specified gates rather than a newly discovered defect.
- **No padding:** old `out/` emission, formatting omissions, declaration-map sources, migration notes, and baseline-tool retirement remain their existing findings/decisions. They are not counted again as novel combined-migration bugs. No critical/high issue or confirmed current product-runtime regression was established.
