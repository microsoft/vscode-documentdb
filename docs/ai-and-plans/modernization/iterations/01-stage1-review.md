---
kind: review
status: historical
---

> Re-evaluated against the merged branch in Stage 7: see [07-stage-reviews-reevaluation.md](./07-stage-reviews-reevaluation.md).

# Stage 1 AI review: remove the legacy test harness

- **Reviewer:** Claude Opus 5.5 (GitHub Copilot agent), as ground rule 2 assigns for the Stage 1 to 3
  reviews. The largest context variant was requested; the runtime exposes no context-tier
  identifier, so the variant cannot be confirmed. Stage 1 was authored by GPT-6.1 Sol, so author and
  reviewer are from different model families for this stage.
- **Range reviewed:** `70136d8f..5b4ead56`, 9 commits (verified with `git rev-list --count`).
  Implementation commits: `521fb828` (harness removal) and `116a6c7b` (CI checkout). The other seven
  are plan-record commits.
- **Method:** CONTRIBUTING.md §6.1 steps 1 to 4, read-only. No source, test, config, lockfile,
  baseline or plan file was edited.

## Checks run by the reviewer

The working tree was not moved to older commits. Stage 1 code was reviewed by diff, and its runtime
evidence comes from CI logs of its own head. Local checks ran on the final branch head `811b33b5`
(Node 22.21.1, npm 10.9.3; `.nvmrc` says 22.18), which contains Stage 1 unchanged.

| Check                                                                            | Result                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gh run view` 37010184351 (`84aacaf7`) and 37021977737 (`5b4ead56`)              | Both `pull_request` runs green on all four jobs. 37021977737 log: Jest `295 passed` suites / `4582 passed` tests, verification Jest 3 / 45, four `PASS: … rejected for the expected reason` lines, `L3 PASS`, `L3 PROOF PASS`. |
| `gh run view` 37011967057 (`b08aa1c7`)                                           | `cancelled`, as the record says.                                                                                                                                                                                               |
| PR #880 review comments and reviews (`gh api …/pulls/880/comments`, `…/reviews`) | **0 review comments, 0 reviews.** The PR is a draft, so the Copilot reviewer has not run. Nothing to merge in step 2.                                                                                                          |
| Lockfile diff `70136d8f..5b4ead56` (throwaway script)                            | 0 entries added, 36 removed, 0 versions changed. Matches the record ("only removals").                                                                                                                                         |
| `grep` for every deleted path and tool name outside `docs/`                      | No importer of a deleted file. Leftovers listed in S1-F06.                                                                                                                                                                     |
| `npm run build`, `npm run lint`, `npm run prettier` at `811b33b5`                | Pass.                                                                                                                                                                                                                          |
| `CI=true npx vitest run` at `811b33b5`                                           | 296 files / 4,588 tests pass. Includes the four Stage 1 test files, now on Vitest.                                                                                                                                             |

Not run for this stage: a local Jest run at `5b4ead56` (Jest no longer exists at the head), L2 and L3.

## Findings

### S1-F01: the temporary PR-head checkout has no enforced revisit before G6

- **Severity:** medium. **Validation:** confirmed.
- **Where:** `.github/workflows/main.yml` lines 52, 165, 198 and 253; commit `116a6c7b`. Recorded in
  the plan under the Stage 1 "Additional Stage 1 task" and in `pipelines-readme.md` lines 48 to 51.
- **What is wrong.** All four checkouts now use
  `ref: ${{ github.event.pull_request.head.sha || github.sha }}`. Correctness per event:
  - `pull_request`: builds the PR head instead of `refs/pull/N/merge`. Correct for this branch's
    goal (the artifact matches the branch lockfile and the L1 baseline), but every PR then stops
    testing the merge result with its base. A PR that is green on its head can break `main` once
    merged.
  - `push` to `main` and `workflow_dispatch`: `github.sha` is the pushed or dispatched commit, so
    behavior is unchanged.
  - The build-size PR comment compares the PR artifact with `main`'s cached sizes. With a head
    checkout, the delta also contains the inverse of everything `main` gained since the branch
    point, so it is misleading on long-lived branches.

  The change lives in the branch that merges to `main`, so it becomes the policy for every PR
  unless someone reverts it. The only guard is prose: "revisit before G6" appears in the Stage 1
  record and in `pipelines-readme.md`, but not in the Stage 6 task list or the G6 gate steps
  (plan lines 2033 to 2062), and the workflow carries no comment. That is not adequate for a
  decision that is easy to forget and silently weakens CI after merge.

- **Security:** no new exposure (see S1-F07). The workflow uses `pull_request`, not
  `pull_request_target`, and the merge ref already executed the PR's code.
- **Solutions:**
  1. Add a Stage 6 task and a G6 gate step: "restore the merge-ref checkout, or record the
     operator's decision to keep it", plus a one-line YAML comment on each `ref:`.
     Pros: cheap, makes the revisit unmissable. Cons: still relies on the G6 executor.
  2. Scope the override to this branch now:
     `ref: ${{ github.head_ref == 'dev/tnaum/modernization' && github.event.pull_request.head.sha || '' }}`
     (empty means the default ref). Pros: other PRs keep merge-ref testing even if the revisit is
     forgotten. Cons: an expression that is easy to get wrong; still needs removal later.
  3. Revert now and dispatch CI manually on the branch head (`workflow_dispatch` already uses the
     head). Pros: no policy drift at all. Cons: PR-triggered CI on this branch fails L1 until the
     branch takes `main`'s lockfile; `pull_request` CI does not trigger anyway while #880
     conflicts with `main`.
- **Recommended:** 1 now, and 2 if the PR might merge before Stage 6 is reviewed in detail.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S1-F02: the new helper tests do not cover every case the deleted Mocha files covered

- **Severity:** low. **Validation:** confirmed by comparing the deleted and added files.
- **Where:** `src/utils/improveError.test.ts`, `src/utils/wrapError.test.ts`,
  `src/utils/getIp.test.ts`, `src/utils/testUtils/setEnvironmentVariables.test.ts`; commit
  `521fb828`.
- **What is wrong.** The Mocha files never ran, so nothing was lost in practice, but the plan asks
  whether the new tests cover what the old ones did:
  - `improveError`: the old tests passed a **string** (`'spawn c:\Program Files\…\mongo.exe ENOENT'`).
    The new tests pass an `Error` with a POSIX path. The string input with a Windows path and
    backslashes is no longer exercised.
  - `wrapError`: four of the seven old cases have no counterpart: outer string only (returns the
    string unchanged), inner string only, outer string with inner `Error`, outer `Error` with inner
    string. The old "outer string, inner error" case was vacuous (`assert(msg, …)` always passes),
    so that one was never real coverage.
  - `getIp`: better than before. The old test called the live network; the new one mocks both
    services, checks the inclusive range boundaries (the five old range cases map onto the new
    `it.each`), the fallback and the error propagation.
  - `setEnvironmentVariables`: the Windows case-insensitivity test (`PAth` versus `PATH`) is gone.
- **Solutions:**
  1. Add the missing `it.each` rows to the two error-helper tests. Pros: a few lines, closes the
     gap. Cons: none worth noting.
  2. Accept the gap. Pros: no work. Cons: the string path of both helpers stays untested.
- **Recommended:** 1, in the next touch of these files.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S1-F03: `setEnvironmentVariables` is now dead, test-only code under `src/`

- **Severity:** low. **Validation:** confirmed; `git grep setEnvironmentVariables` finds only the
  utility and its own test.
- **Where:** `src/utils/testUtils/setEnvironmentVariables.ts`; commit `521fb828`.
- **What is wrong.** The plan said to move the utility "if it is still needed". Nothing uses it. The
  stage kept it, changed its behavior (an unset variable is now deleted on disposal instead of being
  set to the string `"undefined"`), and added a test for it. The behavior change is an improvement,
  but it is a test of code with no consumer, inside the product source tree.
- **Solutions:**
  1. Delete the utility and its test. Pros: less dead code. Cons: removes 2 of the 18 new tests.
  2. Keep it, with a comment naming its intended consumer. Pros: ready if a test needs it. Cons:
     dead code until then.
- **Recommended:** 1.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S1-F04: the Stage 1 record does not reflect the green run on its own head

- **Severity:** low (record accuracy, ground rule 8). **Validation:** confirmed against
  `gh run view`.
- **Where:** plan lines 549 to 552 (Stage 1 status), the "Historical final documentation-head
  queue" block, and plan line 822 in the Stage 2 operator-decision bullet.
- **What is wrong.** The Stage 1 status cites run 37010184351, which ran on `84aacaf7`, not on the
  stage head. Run 37021977737 ran on the head `5b4ead56` and passed all four jobs with all six
  proof lines (completed 15:39 UTC), but the Stage 1 record never cites it. The Stage 2 bullet says
  37021977737 "never got a runner", which is wrong.
- **Solutions:**
  1. Add one line to the Stage 1 status citing 37021977737, and correct the Stage 2 bullet.
     Pros: the record then matches CI. Cons: none.
  2. Leave it; the orchestrator's summary has the facts. Cons: ground rule 8 requires the record
     itself to be right.
- **Recommended:** 1.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S1-F05: `SecretIndex` as a plain object keeps stored data compatible

- **Severity:** info. **Validation:** false positive (the concern does not hold).
- **Where:** `src/services/connectionStorageService.ts` lines 223 to 234; commit `521fb828`.
- **Evidence.** Every slot keeps its number: `ConnectionString` 0, `NativeAuthConnectionUser` 1,
  `NativeAuthConnectionPassword` 2, `EntraIdTenantId` 3, `EntraIdSubscriptionId` 4,
  `ManagedIdentityClientId` 5, `ManagedIdentityTenantId` 6. All 29 uses are value lookups in the same
  file; none uses `SecretIndex` as a type, so the change from enum to `as const` object cannot alter
  a signature. `as const` keeps literal types, so indexing stays type-checked. No other `const enum`
  remains in `src/`, `packages/`, `main.ts` or `api/`. Stored secrets and indices are unchanged.
- **Solutions:** none needed.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S1-F06: harmless leftovers from the deletions

- **Severity:** info. **Validation:** confirmed.
- **Where:** `.vscodeignore` line 38 still lists `extension.bundle.ts`; comments in `main.ts` lines
  10 to 11 and in the retained root `main.js` lines 8 to 10 still describe `extension.bundle.js`.
- **What is wrong.** Nothing functional: the file is gone and nothing imports it. Every other item in
  the plan's deletion list is done (`test/*.ts` harness files, `test.code-workspace`,
  `extension.bundle.ts`, the `main.ts` re-export, `.vscode-test.js`, both "Launch Tests"
  configurations, the Mocha ESLint block and its `extension.bundle` import restriction, the
  commented `types` block, `xvfb.init`, the `integration-tests` job and the ADO `🧪 Test` step).
  `@vscode/test-electron`, `jest-mock-vscode` and the root `main.js` are kept, as required.
- **Solutions:** drop the `.vscodeignore` line and reword the two comments when Stage 5 replaces
  `main.js`. Pros: tidy. Cons: none.
- **Recommended:** fold into Stage 5.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S1-F07: the head checkout adds no security exposure; one pre-existing hardening gap

- **Severity:** info. **Validation:** confirmed by reading the workflow.
- **Where:** `.github/workflows/main.yml`; commit `116a6c7b`.
- **Evidence.** The trigger is `pull_request`. For fork PRs GitHub gives a read-only token and no
  secrets, whichever commit is checked out. The merge ref already contained and executed the PR's
  code, so building the head runs no additional untrusted code. Permissions are unchanged
  (`pull-requests: write` on two jobs, `contents: read` on the others).
- **Pre-existing, not introduced here:** `actions/checkout` keeps its default
  `persist-credentials: true`, so the job token is written to `.git/config` before `npm ci` and
  `npm test` run the PR's code. For same-repository PRs that token has `pull-requests: write`.
- **Solutions:** set `persist-credentials: false` on the four checkouts (no step pushes). Pros:
  removes the token from disk. Cons: a later step that needs Git credentials would have to opt in.
- **Recommended:** consider it separately from this PR.
- **Copilot comment:** none.
- **Author decision:** _pending_

### S1-F08: removing the ADO `🧪 Test` step and the `integration-tests` job loses no coverage

- **Severity:** info. **Validation:** confirmed by diff.
- **Where:** `.azure-pipelines/build.yml` (step removed at the end of the build job) and
  `.github/workflows/main.yml` (`integration-tests` job); commit `521fb828`.
- **Evidence.** The ADO step ran `npm test`, which was a no-op that printed a deprecation notice. The
  GitHub job's only real step had `if: false`. Neither ever executed a test. Unit tests run in the
  GitHub `code-quality-and-tests` job; the isolated ADO build keeps L1 before signing. The ADO
  `build-npm-packages.yml` pipeline still runs `npm run test --workspaces`; that is a Stage 2 risk
  (S2-F01).
- **Solutions:** none needed.
- **Copilot comment:** none.
- **Author decision:** _pending_

## Record check

Ground rule 8 reconciliation of the Stage 1 record against `git log` and the checks:

- **Tasks and commits.** Every task is marked with a hash: the helper tests, deletions, dependency
  removal, `npm test`, `SecretIndex` and the retained files in `521fb828`; the checkout fix in
  `116a6c7b`. The dev-loop item is marked skipped with a reason. The record's commit reconciliation
  lists the seven documentation commits correctly; `5b4ead56` (the reconciliation itself) is the
  last one. **Gap:** the final-head CI run is missing (S1-F04).
- **Deviations.** The checkout change names two rejected alternatives (regenerate the baseline from
  the merge-ref artifact; wait for quarantine to end on 2026-10-07). Both are real. The record
  correctly calls it an orchestrator decision awaiting G1-3, not operator approval.
- **`TDD:` changes.** None claimed; `git log` shows no Stage 1 commit touching a `TDD:` file.
- **Dependency scans.** Recorded as 0 fresh, no pins. The lockfile diff (36 entries removed, none
  changed) is consistent with "only removals".
- **Claimed checks.** The Jest counts (295 / 4,582), the four L1 proof lines and both L3 lines are
  confirmed by the 37021977737 log. Local claims (`npm run package`, `verify:vsix`, `prove:vsix`, VSIX
  sizes) were not rerun at `5b4ead56`; they are consistent with what CI produced on the same tree.
- **Stale statement:** "Status at that handoff: STOPPED pending CI execution" is marked as superseded
  but nothing below it records the outcome (S1-F04).

## Independent sweep

- `.github/copilot-instructions.md`'s project-structure table now points unit tests at
  `src/**/*.test.ts(x)` and `packages/`; at the final head it says Vitest. `test/` survives only as
  `test/vitest/` (the shared mock and setup file added in Stage 2), which the table does not mention.
  Cosmetic.
- The removed `export * from './src/utils/getIp'` in `main.ts` did not change the extension's API:
  VS Code exposes the return value of `activate`, not the module's exports.
- No other workflow references the removed job; `seed-build-cache.yml` is unaffected, as the record
  says.

## Verification limits

- No local Jest run at `5b4ead56`; Stage 1 runtime evidence is the CI log of that commit.
- L2 is not relevant to this stage and was not run. L3 was not run locally (no display); CI ran it.
- The ADO build was not run by the reviewer (operator-run).
- The hands-on VSIX checklist is the operator's.

## Summary for G1-3

| Severity | Count |
| -------- | ----- |
| critical | 0     |
| high     | 0     |
| medium   | 1     |
| low      | 3     |
| info     | 4     |

No blocker for G1-3 from Stage 1. S1-F01 needs an operator decision at G1-3 (the record already
flags it), and the recommended fix is to make the revisit an explicit Stage 6 / G6 step.
