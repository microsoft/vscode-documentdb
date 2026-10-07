---
kind: review
status: historical
---

> Re-evaluated against the merged branch in Stage 7: see [07-stage-reviews-reevaluation.md](./07-stage-reviews-reevaluation.md).

# Stage 2 AI review: Jest to Vitest

- **Reviewer:** Claude Opus 5.5 (GitHub Copilot agent). The largest context variant was requested;
  the runtime exposes no context-tier identifier, so the variant cannot be confirmed.
- **Model-family note:** Phases A and C were authored by Claude Opus 5.5, the reviewer's own family,
  which departs from ground rule 7 by operator choice. To compensate, every claim below was checked
  against code, a command or a CI log; the record's own summaries were not accepted as evidence.
  Phase B (batches B01 to B15) was authored by GPT-6.1 Sol.
- **Range reviewed:** `5b4ead56..875ad255`, 44 commits (verified with `git rev-list --count`).
- **Method:** CONTRIBUTING.md §6.1 steps 1 to 4, read-only.

## Checks run by the reviewer

Local checks ran on the final branch head `811b33b5` (Node 22.21.1, npm 10.9.3; `.nvmrc` says
22.18). Stage 3 changed the Vitest config after this stage (two interop settings removed), so local
results describe the head; Stage 2's own head is covered by its CI log.

| Check                                                                         | Result                                                                                                                                                               |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gh run view` 37051119892 (dispatch on `875ad255`)                            | `failure`. Code Quality: `prettier=failure` (l10n and lint passed); Vitest `296 passed` files. Build & Package, L1 and L3 **skipped**.                               |
| PR #880 review comments and reviews                                           | **0 review comments, 0 reviews** (draft PR). Nothing to merge in step 2.                                                                                             |
| `expect(` count per changed test file, `5b4ead56` versus `875ad255`           | **Identical in every changed test file.** No added `.skip`, `.only`, `.todo`, `.fails` or retries.                                                                   |
| Snapshot values (`promptTemplates.test.ts.snap`), Jest versus Vitest          | 4 keys each; values byte-identical; only the key separators changed (`>`).                                                                                           |
| `jest-mock-vscode` keys versus the ESM mock's named exports (throwaway probe) | Every key the mock creates is exported; no member lost against the old CommonJS mock.                                                                                |
| `CI=true npx vitest run`                                                      | 296 files / 4,588 tests pass; 68.3 s wall (Duration 66.9 s; `import` 121 s summed).                                                                                  |
| `npx vitest run src/utils/wrapError.test.ts` (Case 1 command)                 | 1 file / 3 tests pass.                                                                                                                                               |
| `npm test` in `packages/documentdb-js-schema-analyzer` and `…-fluentui`       | 5 / 150 and 18 / 140 pass.                                                                                                                                           |
| `npm run build`, `npm run lint`, `npm run prettier`                           | Pass.                                                                                                                                                                |
| Fresh-dependency scan (`find-fresh-dependencies.mjs --fail-on-fresh`)         | Exit 0: root 1,635 locked versions, 0 fresh; `api/` 116, 0 fresh. Overrides resolve as recorded (`chai` 6.2.2, `std-env` 4.2.0, `tinyrainbow` 3.1.1, `vite` 8.0.16). |
| Lockfile diff `5b4ead56..875ad255` (throwaway script)                         | 64 added, 205 removed, 1 version changed (`@tybys/wasm-util` 0.10.1 to 0.10.4). Matches the record.                                                                  |
| Oxc transform of a namespace with `export let` (throwaway probe)              | See S2-F04.                                                                                                                                                          |
| CI unit-test step duration, 37021977737 (Jest) versus 37068033773 (Vitest)    | 2 min 0 s versus 3 min 27 s, both including the workspace prebuild.                                                                                                  |

## Findings

### S2-F01: the ADO npm-packages build now runs Vitest on Windows, untested and unrecorded

- **Severity:** medium. **Validation:** confirmed.
- **Where:** `.azure-pipelines/build-npm-packages.yml` lines 123 to 130 (`npm run test --workspaces
--if-present`, Windows pool at line 89); each package's `test` script, changed in `9716ec80` to
  `vitest run --config ../../vitest.config.ts --project <name>`.
- **What is wrong.** This pipeline builds the npm packages that G6 publishes. Its test step used to
  run each package's own Jest config; it now runs Vitest through the root config, on a Windows
  agent, with `.nvmrc`'s Node. Vitest has never run on Windows in this repository: GitHub Actions is
  Linux only. `pipelines-readme.md` describes the step, but no Stage 2 task or record considers what
  it now executes. Failure modes
  that only show there: path handling in `vitest.config.ts` (`path.join`, `require.resolve('bson')`),
  the 15 s timeout on a slower agent (the fluentui cold transform already takes about 7 s on Linux),
  and workspace links being junctions on Windows.
- **Solutions:**
  1. Have the operator queue `build-npm-packages.yml` once on this branch (it publishes nothing) and
     record the result. Pros: direct evidence. Cons: operator time; feed quarantine applies.
  2. Add a `windows-latest` Vitest job for the six package projects to GitHub Actions. Pros:
     continuous coverage. Cons: more CI minutes; adds a CI change to this PR.
  3. Drop the test step from the ADO package build, relying on GitHub CI for the same commit.
     Pros: removes the risk. Cons: the release pipeline then builds packages that were never tested
     on its own agent.
- **Recommended:** 1 before G1-3 closes, or at the latest before publishing at G6.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S2-F02: unit tests are about 60 % slower than under Jest at the same worker cap

- **Severity:** low. No correctness impact; operator decision already flagged in the record.
- **Validation:** confirmed. Local: 68.3 s (this review) against the Stage 0 Jest median 42.2 s, in
  line with the record's 68.6 s. CI: the unit-test step went from 2 min 0 s (run 37021977737, Jest)
  to 3 min 27 s (run 37068033773, Vitest).
- **Where:** `vitest.config.ts` line 41 (`maxWorkers: '25%'`); commits `2c54aacf`, `9716ec80`.
- **What is wrong.** The plan's case for Vitest included faster tests. At the 25 % cap the run is
  worker-bound: `import` costs about 121 s summed across workers. On a 4-core GitHub runner, 25 % is
  one worker.
- **Solutions:**
  1. Raise the cap to 50 % (measured 45.8 s locally) and watch CI memory for a few runs. Pros:
     near Jest parity. Cons: the cap exists because of past out-of-memory kills.
  2. Try `pool: 'threads'`. Pros: cheaper workers. Cons: native modules and `process.env` mutation
     in tests behave differently under threads; needs a full-suite check.
  3. `isolate: false`. Pros: largest speed-up. Cons: breaks the per-file assumption of the
     `require('vscode')` hook (S2-F03); not recommended.
- **Recommended:** 1, decided by the operator at G1-3.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S2-F03: the `require('vscode')` hook depends on per-file isolation, and factory mocks do not reach CommonJS dependencies

- **Severity:** low. **Validation:** confirmed by reading the hook and the config.
- **Where:** `test/vitest/setup.ts` lines 24 to 40; `vitest.config.ts` (no explicit `pool` or
  `isolate`); commit `86baf001`.
- **What it does well.** The hook hands Node's `require('vscode')` the same object the aliased
  `test/vitest/vscode.ts` module exports as `default`, so ESM and CommonJS importers share one
  mock instance. With Vitest's defaults (`forks`, `isolate: true`) every test file gets a fresh
  process, so neither the mock nor the require cache leaks between files.
- **What is fragile.**
  - The isolation is implicit. If someone sets `isolate: false` (S2-F02, option 3), modules that
    CommonJS dependencies loaded (for example `@vscode/extension-telemetry`,
    `@microsoft/vscode-azext-azureauth`) stay in the require cache with the **first** file's mock,
    and each later file wraps `Module._load` again. Tests would then assert on one mock while the
    dependency calls another.
  - 68 test files use `vi.mock('vscode', factory)`. In those files the factory mock reaches only
    ESM importers; CommonJS dependencies still get the default mock. The setup file documents this,
    but nothing detects a test whose assertion depends on a CommonJS dependency seeing the factory.
    Jest did not have this split.
- **Solutions:**
  1. Pin `pool: 'forks'` and `isolate: true` in the `extension` project with a one-line comment
     pointing at `setup.ts`. Pros: makes the dependency explicit; a speed change has to touch it.
     Cons: none.
  2. Make the hook fail loudly if it is installed twice in one process. Pros: catches the leak if
     isolation is ever turned off. Cons: a few lines in test infrastructure.
  3. Remove the hook by upgrading the azext packages to their dual-format releases (the record's
     open item). Pros: removes the split entirely. Cons: major-version upgrades touching product
     code.
- **Recommended:** 1 now; 3 when the azext upgrade happens (before Stage 5, as the record suggests).
- **Copilot comment:** none.
- **Author decision:** _pending_

### S2-F04: the record misdescribes the Oxc namespace hazard

- **Severity:** low (record accuracy; latent behavior difference).
- **Validation:** confirmed by a throwaway probe with `vite.transformWithOxc`, the transform
  Vitest uses.
- **Where:** plan lines 1389 to 1394 (open item); `src/extensionVariables.ts` lines 24 to 65.
- **What is wrong.** The record says "an initializer added later would be dropped silently". The
  probe shows the opposite: `export let withInit = 1` becomes `let withInit = _ext.withInit = 1`, so
  the initial value does reach `ext.withInit`. What Oxc does not do is rewrite **bare-name
  references inside the namespace**: `export let a` becomes a local `let a`, decoupled from `ext.a`.
  A function declared inside `namespace ext` that reads or writes `a` would see the local, while
  other modules assign `ext.a`. swc (webpack today) and `tsc` rewrite those references; Oxc
  (Vitest today, Vite in Stage 5) does not. Today `ext` contains only declarations and one `const`,
  so the output is equivalent and no test can notice. The namespace warnings in each run are
  expected.
- **Solutions:**
  1. Correct the open item's wording now. Pros: the Stage 5 decision is made on the right facts.
     Cons: none.
  2. Convert `ext` to a plain object with a typed interface before Stage 5. Pros: removes the
     warning and the hazard. Cons: a production change in a widely imported module.
  3. Add a lint rule that forbids function declarations inside `namespace ext`. Pros: cheap guard.
     Cons: guards only the known shape.
- **Recommended:** 1 now; 2 at Stage 5, as the record already proposes.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S2-F05: the Stage 2 record omits its CI result, and the stage head was pushed knowingly failing a CI check

- **Severity:** low (ground rule 8). **Validation:** confirmed against `gh run view`.
- **Where:** plan lines 1363 to 1366 ("CI … The run URL and its status are in the Phase C handoff
  report … This record does not claim a CI result"); plan lines 1342 to 1344 (Prettier); line 822
  ("never got a runner").
- **What is wrong.**
  - The only CI run on `875ad255` (dispatch 37051119892) failed on `prettier`; Build, L1 and L3 were
    skipped. The Stage 2 section never records this; it is mentioned only in Stage 3's Prettier
    follow-up. The stage therefore ended without the branch passing its checks, which ground rule
    2 requires before the next stage.
  - The record states that the plan file "already failed `--check` at `bbd9ce79`" and that one
    `--write` pass was kept. The author knew `npm run prettier`, a CI gate, would fail and pushed.
    Unit tests did pass in that run (296 files).
  - Line 822 says run 37021977737 never got a runner; it passed (S1-F04).
- **Solutions:**
  1. Add the run, its failure and its resolution (`811b33b5`, run 37068033773) to the Stage 2
     record, and fix line 822. Pros: accurate record. Cons: none.
  2. Leave the cross-reference in Stage 3. Cons: a reader of Stage 2 alone sees no CI outcome.
- **Recommended:** 1.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S2-F06: a Jest-era override is left behind

- **Severity:** low. **Validation:** confirmed; `test-exclude` is no longer in `package-lock.json`.
- **Where:** root `package.json` `overrides` (`"test-exclude": "~7.0.1"`) and its `//overrides`
  comment ("test-exclude 7 for compatibility"); Jest removed in `9716ec80`.
- **What is wrong.** `test-exclude` came in through Jest's coverage instrumentation. With Jest gone,
  the override pins nothing, and the comment explains a constraint that no longer exists. The record
  lists the four temporary Stage 2 overrides but not this stale one.
- **Solutions:** remove the entry and its comment clause, regenerate the lockfile with `.nvmrc`'s
  npm, and rescan. Pros: one less confusing pin. Cons: a lockfile regeneration (expected no-op).
- **Recommended:** remove it together with the temporary overrides before G6.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S2-F07: some test files lost type-checking in the PR fast path

- **Severity:** low. **Validation:** confirmed from the old configs, the package `tsconfig` files and
  `main.yml`.
- **Where:** old package Jest configs (deleted in `9716ec80`) used `ts-jest`, which type-checks;
  `packages/documentdb-js-schema-analyzer/tsconfig.json` (`include: ["src/**/*"]`, tests are in
  `test/`); `packages/vscode-ext-webview/tsconfig.json` (excludes `*.test.ts`); the three
  `src/webviews/**/*.test.tsx` files (old `extension-webview` project, `ts-jest`).
- **What is wrong.** Vitest's Oxc transform does not type-check. These tests are still type-checked
  by the root `tsc` (`npm run build`), but in CI that runs only in `build-and-package`, which is
  skipped for PRs to `feature/**` and for dispatches without `enforce_full_run`. In those runs a
  type error in about 19 test files (schema-analyzer 5, `vscode-ext-webview` 11, webviews 3) now
  passes CI where `ts-jest` failed it. Locally, Case 1 runs
  `npm run build` first, so developers are unaffected.
- **Solutions:**
  1. Run `tsc --noEmit -p .` in `code-quality-and-tests`. Pros: restores the check everywhere.
     Cons: about 35 s more per run.
  2. Accept it; PRs to `main` still get the check. Cons: feature-branch PRs can merge type errors
     in tests.
- **Recommended:** 1, if `feature/**` PRs are used; otherwise 2.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S2-F08: mock changes are faithful; no assertion was weakened

- **Severity:** info. **Validation:** confirmed (false positive for the "more permissive mocks"
  concern).
- **Evidence.**
  - `expect(` counts are identical in every changed test file; no skip/only/todo was added.
  - The six `...(await importOriginal())` / `vi.importActual` spreads are one-to-one translations of
    existing `jest.requireActual` spreads (`CountSourceIndexesStep`, `ContainerRuntime` twice,
    `QuickStartService`, `improveError`, `wrapError`). None is new.
  - The four explicit `undefined` exports (`FOLDER_PLACEHOLDER_CONNECTION_STRING`, two `env`, one
    `default`) reproduce what Jest returned for an export a factory omitted; Vitest would otherwise
    throw. They preserve behavior, including one latent fixture flaw:
    `moveItems/PromptTargetFolderStep.test.ts` builds folder fixtures whose connection string is
    `undefined` instead of the real placeholder. Worth fixing separately with `importOriginal`.
  - Arrow `vi.fn(() => …)` rewritten as `function () { return …; }` is semantically identical under
    `new` when the function returns an object.
  - The one removed `@jest-environment jsdom` (`openWebview.test.ts`) was not the file's first
    comment, so Jest ignored it; the file ran under node before and after.
  - `require()` of the module under test inside a `describe` became a static import in several files
    (for example `kubernetesClient.test.ts`); no factory in those files mocks the module under test,
    so the instance is the same.
- **Solutions:** none needed; optional follow-up for the placeholder fixture.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S2-F09: the six `TDD:` files changed only in mechanics

- **Severity:** info. **Validation:** confirmed.
- **Evidence.** All six files holding `TDD:` suites at `5b4ead56` were touched by exactly one Stage 2
  commit, `4ed9d944`; no Stage 1 or Stage 3 commit touched them. Filtering that commit's diff for
  lines other than `jest.`/`vi.` renames, imports and `Mock` types leaves only: the `worker_threads`
  `Worker` mock wrapped in `function () { return { … } }`; `require('worker_threads')` replaced by the
  statically imported mock (`workerThreads as unknown as …`); `jest.SpyInstance` to `MockInstance`;
  and `hoverAndEdgeCases.test.ts`'s in-suite `require('../playgroundContextDetector')` moved to a
  top-level import of the same, unmocked module. No test name, expected value or assertion changed.
  The record's list matches.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S2-F10: the fluentui stub decisions are sound

- **Severity:** info. **Validation:** confirmed.
- **Evidence.** `049c1a81` removes the stubs in `StatusStrip.test.ts` and
  `StatusStrip.inventory.test.tsx` and changes nothing else (only unused type imports go). The old
  `MetricCard` stub rendered `value ?? 'N/A'` itself, so the tests now check the real component's
  output, which is stronger. `DashboardHeader.test.ts` keeps its `FocusableBadge` stub because lines
  289 to 290 assert `class="dashboardResilienceBadge"` and `color="success"` in static markup, which
  exist only because the stub forwards props as attributes. Keeping the stub instead of deleting the
  colour assertion is the right trade.
- **Solution (optional):** later, assert the colour through an accessible attribute or a
  `data-` attribute the real component sets, then drop the stub.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S2-F11: the Vitest config settings do not hide failures

- **Severity:** info. **Validation:** confirmed by reading `vitest.config.ts` and the run output.
- **Evidence.**
  - Projects: the `extension` project replaces Jest's `extension` and `extension-webview` with the
    same file set; jsdom comes from the docblock on exactly the three former `extension-webview`
    files. fluentui keeps a project-wide jsdom, as its Jest config did.
  - `bson` alias to the CommonJS build: one copy in unit tests, as under Jest. By design the unit
    tests therefore cannot see a dual-package bundle hazard; Stage 3's identity check covers that.
  - `@azure/identity` and `@azure/msal-node` inlining only changes how they reload under
    `vi.resetModules()`.
  - `testTimeout` 15 s widens the window before a slow test fails; it cannot turn a failure into a
    pass. Two shell tests take 7.5 to 8.8 s.
  - The warning filter drops only `Failed to load source map for` messages for `/node_modules/`
    paths. Errors and other warnings (for example the Oxc namespace warning) still print.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S2-F12: the B10+ batch-merge deviation did not lose coverage

- **Severity:** info. **Validation:** confirmed.
- **Evidence.** The dropped per-batch full Jest run guarded only files still on Jest, which the
  routing helper kept apart from converted files. Each merged batch still has its own commit
  (`37aee78c` to `1b06cf46`), per-batch Vitest and `npm run build`; Phase C ran the full suite, and
  this review's run passes 4,588 tests. Intermediate states between B10 and B15 were never run in
  full; that matters only for bisecting, not for the result. The worktree alternative the
  orchestrator rejected was a real one.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S2-F13: Jest removal is complete and the documented commands work

- **Severity:** info. **Validation:** confirmed.
- **Evidence.** No `jest` dependency, config or `jest.*` call remains outside documentation history
  and two explanatory comments. `npm test` is `vitest run` with a workspace `pretest`; CI step
  "🧪 Run Unit Tests (Vitest)" runs it. `.github/copilot-instructions.md` and `CONTRIBUTING.md` §4.1
  and §4.2 name `npx vitest run <path>` and `npx vitest run`; the backport skill uses `npm test`
  (with `npm run jesttest` for older release branches). The Case 1 command, the full run and two
  package `npm test` scripts were run in this review and pass.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S2-F14: the overrides and dependency scans match the record

- **Severity:** info. **Validation:** confirmed.
- **Evidence.** The lockfile resolves `chai` 6.2.2, `tinyrainbow` 3.1.1, `std-env` 4.2.0 and `vite`
  8.0.16 as recorded; today's scan reports 0 fresh. The `"vite": "$vite"` override ties the
  transitive `vite` to the direct pin, which works around the npm 10.9 crash the record describes.
  The masked versions (`chai` 6.3.0, `tinyrainbow` 3.2.0, `std-env` 4.3.0) leave the 7-day window on
  2026-10-06 and 2026-10-07, after which those three overrides can be dropped. The rejected
  `@vitest/eslint-plugin` is not in the tree.
- **Copilot comment:** none.
- **Author decision:** _pending_

## Record check

- **Tasks and commits.** Every task carries hashes; Phase B lists each batch commit with counts.
  The status line lists the Phase C commits correctly.
- **Deviations.** The `require('vscode')` hook names three measured alternatives and two rejected
  ones with reasons; the B10+ merge names the worktree alternative; the Vitest ESLint plugin
  rejection gives the scan result. These are real alternatives.
- **`TDD:` changes.** Complete and accurate (S2-F09).
- **Dependency scans and pins.** Recorded for Phase A and Phase C; confirmed (S2-F14). The stale
  `test-exclude` override is not listed (S2-F06).
- **Claimed checks without evidence or with wrong statements:**
  - CI outcome missing (S2-F05).
  - The Oxc open item's description is wrong (S2-F04).
  - "Prettier ran on every changed file" is qualified correctly in the record, but the consequence
    (a red CI gate) is not stated (S2-F05).
  - Local artifact checks (`npm run package`, L1 and its four proofs) were not rerun at `875ad255`
    by the reviewer; CI did not run them either (skipped). They were rerun at `811b33b5` in the
    Stage 3 review.

## Independent sweep

- **Published tarballs now ship compiled tests that import `vitest`.** See S3-F07; the cause spans
  both stages.
- **Repository guidance outside the repo.** Agent memory notes that still say "use `npm run
jesttest`" are now wrong; they are not part of the repository and were not edited.
- **`packages/*/package.json` `test` scripts depend on the root config** (`../../vitest.config.ts`).
  That is fine inside the monorepo, and it is what S2-F01's ADO step now executes.

## Verification limits

- No run at `875ad255` itself: local checks ran at `811b33b5`. Between the two, Stage 3 removed two
  interop settings and two redundant `default` keys; the test count is unchanged.
- Vitest on Windows was not run (S2-F01). The ADO pipelines are operator-run.
- L2, L3 and the hands-on VSIX checklist are not Stage 2 concerns and were not run.

## Summary for G1-3

| Severity | Count |
| -------- | ----- |
| critical | 0     |
| high     | 0     |
| medium   | 1     |
| low      | 6     |
| info     | 7     |

No blocker for G1-3 from Stage 2. S2-F01 should be closed by one operator run of
`build-npm-packages.yml` before the packages are published; the wall-time decision (S2-F02) and the
record corrections (S2-F04, S2-F05) belong on the G1-3 agenda.
