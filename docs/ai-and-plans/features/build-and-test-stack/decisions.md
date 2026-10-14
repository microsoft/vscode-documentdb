---
feature: build-and-test-stack
kind: decisions
status: active
created: 2026-10-14
---

# Build and test stack: decisions

> Standing decisions about the build, bundling and test stack that later work builds on, the
> E2E iteration in particular. Decisions taken while executing the stages stay in
> [build-and-test-stack.md](./iterations/01-modernization/build-and-test-stack.md), next to the stage they shaped.

| #    | Decision                                                        | Status              | Changed from the proposal?                                                               | Date       | PR   |
| ---- | --------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------- | ---------- | ---- |
| 0001 | Workspace packages ship ESM only                                | Accepted            | Accepted as proposed                                                                     | 2026-10-14 | #880 |
| 0002 | CI runs verification in tiers and reports what it ran and why   | Accepted            | **Operator added the layer report, the one-shot request label and the merged comment**   | 2026-10-14 | #880 |
| 0003 | Negative controls run when their check changes, not every PR    | Accepted            | Accepted as proposed                                                                     | 2026-10-14 | #880 |
| 0004 | Use Vite for the host and webviews                              | Accepted            | The documented host-only esbuild fallback was not needed                                 | 2026-09-30 | #880 |
| 0005 | Replace Jest with Vitest in one sweep                           | Accepted            | Adopted for pipeline and ESM unification, not for speed                                  | 2026-10-02 | #880 |
| 0006 | Split each view with ordered named groups                       | Accepted            | Rolldown groups replaced planned `manualChunks`; ordering came from the build experiment | 2026-10-05 | #880 |
| 0007 | Run the extension host as ESM through a thin loader             | Accepted            | Accepted as proposed                                                                     | 2026-10-05 | #880 |
| 0008 | Keep the TypeScript server plugin CommonJS                      | Accepted            | The shipped bundle moved to the root and a runtime stub supplies the package path        | 2026-10-01 | #880 |
| 0009 | Keep SlickGrid during modernization                             | Accepted            | Replacement remains a separate later iteration                                           | 2026-09-30 | #880 |
| 0010 | Run L3 on GitHub Actions only                                   | Accepted            | ADO keeps only offline checks that can run before signing                                | 2026-09-30 | #880 |
| 0011 | Keep L2-dev runner-free in this iteration                       | Accepted            | CI wiring stays with the E2E iteration                                                   | 2026-10-05 | #880 |
| 0012 | Use one branch and one PR, merging `main`                       | Accepted (modified) | The 2026-10-07 decision restored a merge from `main` before the PR merges                | 2026-10-01 | #880 |
| 0013 | The required check passes only when every expected layer passed | Accepted            | Accepted as proposed by the Stage 8.5 review (S85-F01)                                   | 2026-10-14 | #880 |
| 0014 | CI jobs run in parallel where safe, under descriptive names     | Accepted            | Accepted as proposed; prompted by the operator's comparison with PR #963                 | 2026-10-14 | #880 |

> Entries below are **semantically** immutable: append new entries rather than rewriting old
> ones, and record reversals as a new entry plus a status change above. Heading text is frozen
> once written; a retitle means a new decision.

**Status vocabulary** (closed set of seven):

`Proposed` · `Open` · `Accepted` · `Accepted (modified)` · `Deferred` ·
`Superseded by D#` · `Rejected`

---

## 0001: Workspace packages ship ESM only

**Status:** Accepted · **Date:** 2026-10-14 · **Raised by:** complexity review of the
modernization branch after Stage 8

### Question

Stage 3 made all six workspace packages ESM only. `@microsoft/vscode-ext-webview` is meant for
other extensions, and the unbundled-host probe showed that a CommonJS extension which does not
bundle deadlocks when it `require`s `/host` (VS Code serves `import 'vscode'` from an async loader
hook that `require(esm)` blocks). Should the packages also ship a CommonJS build?

### Decision

No. The packages stay ESM only (operator: "yes, keep esm only"). CommonJS consumers use Node's
`require(esm)`, or `await import()` where the ESM graph imports `vscode`.

### Reasoning

The operator's question was whether ESM only is where packages are heading; it is. Node 20.19+
and 22.12+ load ESM from `require` without a flag, and the tools this repo now uses (Vite,
Vitest) are ESM only. A dual build would add, permanently:

- two builds and file extension handling (`.cjs`/`.mjs` or nested `package.json` files);
- conditional `exports` with separate types per condition (`.d.ts` and `.d.cts`);
- the dual-package hazard in our own code: two copies of the tRPC and webview controller state,
  and broken `instanceof`, the same failure class that `bson` caused in Stages 3 to 5;
- twice the package checks.

It would fix one consumer setup: a CommonJS extension that does not bundle and imports
`vscode-ext-webview/host`. Bundling extensions are unaffected.

### Rejected alternatives

- **Dual ESM and CommonJS packages:** the costs above, for one rare consumer setup.
- **A CommonJS-only `/host` entry:** the same hazard between `/host` and the ESM entries.

### Consequences

- The `vscode-ext-webview` README states the `await import()` rule for CommonJS extensions that
  do not bundle.
- `probe:host-unbundled` characterizes a documented constraint, not a regression risk in this
  extension. It leaves the per-PR pipeline and runs when the package is published (see 0002).
- `require(esm)` rejects top-level await, so the static top-level-await scan in
  `verify:packages` stays.

---

## 0002: CI runs verification in tiers and reports what it ran and why

**Status:** Accepted · **Date:** 2026-10-14 · **Raised by:** complexity review of the
modernization branch after Stage 8

### Question

Every push to a PR, draft or not, runs packaging, L1, the L1 negative controls, L3 with its
control, the package checks and five VS Code launches of the unbundled-host probe. The operator:
"the checks on every push to a PR are expensive timewise, I already differentiate between a
draft PR and a regular PR, so maybe some checks should run only on a 'non-draft' prs". The E2E
iteration will add slower checks still, and the operator wants a way to request them, for
example "e2e requested or full test requested".

### Decision

CI picks a tier per run and runs only that tier's layers. Path-scoped checks run inside the
standard and full tiers when their paths change.

| Tier     | When                                                                                    | Layers                                                         |
| -------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| fast     | Draft PR                                                                                | L0: build, lint, formatting, type checks, unit tests           |
| standard | Ready PR (including the `ready_for_review` event), push to `main` or `release/**`       | fast + package the VSIX + L1 inspection + L3 activation + size |
| full     | `ci:full-requested` label (one run), nightly on `main` and `release/**` once E2E exists | standard + E2E + every path-scoped check                       |

| Path-scoped check                                     | Runs when these change                                     |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| `verify:packages`                                     | `packages/**`, and always in the publish workflow          |
| `probe:host-unbundled`                                | `packages/vscode-ext-webview/**`, and when publishing      |
| `prove:vsix`, `prove:activation`, `test:verification` | `build/verification/**`, the Vite configs, `build/vite/**` |

Nightly runs cover `main` and the open `release/**` branches; open PRs get the full tier on
request. `release/**` follows the same rules as PRs, plus the nightly run (operator: "just same
rules as for the PR + nightly"). Scheduled workflows start only from the default branch, so the
nightly job on `main` dispatches a full run for each `release/**` branch.

A nightly run skips a branch whose tip is the commit of its last successful nightly run, except
the Sunday-night run, which always runs (operator: "skip when unchanged, but once a week, every..
sunday night"). The weekly run catches changes outside the repository, such as a new VS Code
stable, container images or runner images.

**Requesting a full run on a PR** is a one-shot label, the operator's proposal ("a label that
says that something is requested, then a job kicks in and removes that label and posts
comments"):

1. Adding `ci:full-requested` starts the full tier for the PR's current head commit.
2. The workflow removes the label at once and records in the report who requested the run, for
   which commit, with a link to the run. Removing it with `GITHUB_TOKEN` starts no new run.
3. The next push runs the tier the PR is in again. The report then says the last full run was on
   an earlier commit, and how to request another.

The `plan` job ignores every other label, so adding an unrelated label does not rerun CI. A full
run is not cancelled by a later push (its concurrency group includes the tier). On fork PRs the
read-only token cannot remove the label; the run still happens.

**Every run reports itself** (operator: "there should be a comment posted explaining what test
layers were run and why. for example L1: vsix inspection - not running on draft PRs"). One PR
comment, updated in place, replaces the existing Code Quality and Build Size comments (operator:
"yes, let's merge them"). It shows the layer table first, then the code quality and build size
details. Size changes carry an arrow next to the signed value, as the original size comment did
(operator: "add some emoji as well like this ⬆️"): ⬆️ for growth, ⬇️ for a reduction, ✅ for
no change; ⚠️ stays on growth past the warning threshold. The layer table lists every layer with
its result or the reason it was skipped, for example:

| Layer              | Result  | Why                              |
| ------------------ | ------- | -------------------------------- |
| L0 build and tests | passed  | runs on every push               |
| L1 VSIX inspection | skipped | draft PR; runs when marked ready |
| Package checks     | skipped | no changes under `packages/**`   |
| E2E                | skipped | add `ci:full-requested` to run   |

The minimal layer set behind the tiers: L0, L1, L3 and (next iteration) E2E are CI layers. L2-dev
is a development tool, not a CI layer. The L2 production harness is not wired into CI and is
retired into E2E when that suite lands.

### Reasoning

Draft and ready map onto the repository's existing verification cases (Case 1 while working,
Case 2 when handing over), so CI follows the same line the local rules already draw. Marking a
PR ready triggers the standard tier, so nothing reaches review unverified. A label is the common
way to request more on demand: only users with triage permission can add one, so fork PRs cannot
start the expensive runs. The report comment keeps a skipped layer from reading as a passed one,
which is the failure mode tiering otherwise introduces.

### Rejected alternatives

- **Workflow-level `on.pull_request.paths` filters:** a workflow that never starts leaves its
  required checks pending. Jobs skipped by `if:` report "skipped", which satisfies them.
- **Comment commands (`/ci full`) through `issue_comment`** (operator: "let's stick with the
  one-shot label"). Their one advantage is arguments, for example a VS Code version or platform
  for E2E. Against them: the workflow runs from `main`, so a change to it cannot be tested on the
  PR that makes it; results do not appear as PR checks without extra code; the run has a write
  token and secrets, so checking out fork code is a known attack ("pwn request"), and the commit
  must be pinned at comment time; and every comment needs a permission check. A comment that only
  adds the label would need a GitHub App or personal token, because labels added with
  `GITHUB_TOKEN` start no run. Revisit in the E2E iteration if runs need arguments.
- **A sticky label** (full tier on every push while the label is on): makes every later push
  expensive until someone remembers to remove it. The operator chose a one-shot request.
- **Nightly runs on open PRs:** needs a job that dispatches one run per open PR, and those runs
  do not show as PR checks without more plumbing.
- **Merge queue for the expensive tier:** fits larger PR volumes; heavier than this repo needs.
- **`workflow_dispatch` as the on-demand mechanism:** kept for manual runs, but its runs do not
  show as PR checks.

### For the E2E iteration

- E2E jobs join the full tier; nothing E2E runs on draft PRs.
- Every E2E job adds its row to the layer report, including the skip reason.
- Tags or lanes inside the suite (see
  [E2E strategy §5.8](../e2e-testing/strategy.md#58-tags-lanes-and-the-fail-loud-ci-machinery))
  select tests within the full tier; they do not decide whether E2E runs.
- A job that should have produced results and did not is reported as a failure, not as skipped.
- E2E is not a required check: with a one-shot request, the merged commit may not have had a
  full run. Making it required later needs a sticky label or a merge queue, as a new decision.
- A failing nightly run must notify someone (an issue or a message); see
  [E2E strategy §5.8](../e2e-testing/strategy.md#58-tags-lanes-and-the-fail-loud-ci-machinery).

---

## 0003: Negative controls run when their check changes, not every PR

**Status:** Accepted · **Date:** 2026-10-14 · **Raised by:** complexity review of the
modernization branch after Stage 8

### Question

Ground rule "prove that each check can fail" produced `prove:vsix` (22 controls) and
`prove:activation`, which run in CI on every PR next to the unit tests of the same checks.
Should they keep running on every PR?

### Decision

No. Negative controls prove a check when the check is written or changed. They run in CI when
`build/verification/**`, `build/vite/**` or the Vite configs change, and in the full tier
(operator: "agreed").

### Reasoning

A control can only start failing when the check, or the build output it inspects, changes. On
every other PR it repeats a proof already made, at the cost of CI time.

### Rejected alternatives

- **Delete the controls:** they are the evidence that a check works, and are needed whenever a
  check changes.

### Consequences

- The ZIP writer in `build/verification/vsix.cjs` stays; the controls still need it.

---

## 0004: Use Vite for the host and webviews (reconstructed)

**Status:** Accepted · **Date:** 2026-09-30
**Evidence:** [J.6, the three real options](./iterations/01-modernization/build-and-test-stack.md#j6-the-three-real-options)

### Question

Should the extension standardize on Vite for both build targets, use the Azure Tools esbuild stack,
or split the host and webviews across two bundlers?

### Decision

Use Vite for both the extension host and the webviews. Keep esbuild as a documented host-only
fallback if Vite cannot handle the host's entries, externals, or CommonJS interop.

### Reasoning

The measured output reduction came from the Vite build, and the primary product problem was the
webview bundle. The Azure Tools esbuild stack had no webview story, was an alpha engineering
package, and carried Mocha choices that conflicted with the Vitest direction. One bundler also keeps
the migration's "do it once" goal intact. The Vite host implementation later handled the recorded
fallback triggers, so the fallback was not used.

### Rejected alternatives

- **All esbuild through `@microsoft/vscode-azext-eng`:** no webview solution, an alpha shared
  package, and an opinionated Mocha-based stack.
- **esbuild for the host and Vite for webviews:** retained only as a fallback because it creates two
  configuration surfaces.
- **Split the Webpack webviews first:** throwaway work because Vite's splitting mechanism was the
  intended end state.

---

## 0005: Replace Jest with Vitest in one sweep (reconstructed)

**Status:** Accepted · **Date:** 2026-10-02
**Evidence:** [Stage 2: Jest to Vitest, in one sweep](./iterations/01-modernization/build-and-test-stack.md#stage-2-jest-to-vitest-in-one-sweep)

### Question

Should the repository keep Jest, run Jest and Vitest indefinitely, or convert the full unit-test
surface before the bundler stages?

### Decision

Convert the extension and all six workspace-package projects to Vitest in one stage, then remove
Jest and its configuration. Use one root Vitest config with per-project environments and includes.

### Reasoning

Vitest supplied an ESM-native test net before the package and bundler changes and shared Vite's
transform pipeline. Jest already needed workarounds for an ESM workspace package, and the test
surface had grown 48 percent in seven weeks. The plan explicitly adopted Vitest for pipeline
unification, not as a speed claim; the completed suite was slower at the retained worker cap.

### Rejected alternatives

- **Keep a mixed Jest and Vitest end state:** the overlap existed only as migration scaffolding and
  was removed in the same stage.
- **Delay conversion until after the bundler:** later conversion would increase the growing sweep
  and leave weaker ESM coverage during Stages 3 to 5.
- **Keep Jest and convert later arrivals by hand:** rejected for the migration branch in favor of
  the recorded mechanical conversion recipe.

---

## 0006: Split each view with ordered named groups (reconstructed)

**Status:** Accepted · **Date:** 2026-10-05
**Evidence:** [Stage 4: webviews to Vite, split per view](./iterations/01-modernization/build-and-test-stack.md#stage-4-webviews-to-vite-split-per-view)

### Question

How should shared dependencies be split without pulling Monaco or SlickGrid into lightweight
webviews?

### Decision

Load each registered view through a literal lazy import. Use named Rolldown groups in this order:
`preload-helper`, `react`, `fluentui`, `slickgrid`, then `monaco`. Do not add a catch-all vendor
group.

### Reasoning

Rolldown recursively captures dependencies of grouped modules. Capturing the most shared modules
first prevents a later group from absorbing React or Vite's preload helper. The order preserves the
lazy boundaries that keep Monaco and SlickGrid out of Local Quick Start and Atlas Credentials.

### Rejected alternatives

- **Keep one `views.js` chunk:** it made every view load Monaco and SlickGrid.
- **Capture Monaco first:** the experiment absorbed React and the preload helper, which made the
  entry statically import Monaco.
- **Add a catch-all vendor group:** a group shared by the entry and a lazy view could hoist the
  view's dependencies into the entry graph.

---

## 0007: Run the extension host as ESM through a thin loader (reconstructed)

**Status:** Accepted · **Date:** 2026-10-05
**Evidence:** [Stage 5: extension host to ESM and Vite](./iterations/01-modernization/build-and-test-stack.md#stage-5-extension-host-to-esm-and-vite)

### Question

What module format and entry shape should VS Code load after the host leaves Webpack?

### Decision

Declare the extension package as ESM and point its manifest at `main.mjs`. Keep `main.ts` as a thin
loader that starts timing, top-level awaits `import('./src/extension')`, and delegates activation
and deactivation.

### Reasoning

ESM is the direction required by the selected Vite host build. The dynamic boundary keeps the
extension implementation in its own chunk and makes `mainFileLoad` measure real loading work;
the old hoisted CommonJS load happened before timing began.

### Rejected alternatives

- **A static import in the loader:** it would evaluate before the timing boundary.
- **A CommonJS Webpack host fallback:** it could not reproduce the ESM entry, top-level await, and
  `.mjs` worker without forking product behavior.
- **An esbuild host fallback:** retained in the plan but not used because Vite handled the host.

---

## 0008: Keep the TypeScript server plugin CommonJS (reconstructed)

**Status:** Accepted · **Date:** 2026-10-01
**Evidence:** [Stage 5: extension host to ESM and Vite](./iterations/01-modernization/build-and-test-stack.md#stage-5-extension-host-to-esm-and-vite)

### Question

Should the TypeScript server plugin follow the extension host into ESM?

### Decision

No. Build `playgroundTsPlugin.cjs` as CommonJS and export the callable plugin factory directly.
At activation, create a small CommonJS package under
`node_modules/documentdb-playground-ts-plugin` that forwards to the root bundle.

### Reasoning

TypeScript loads the contributed plugin with `require()` and calls the module itself as the factory;
an ESM default export does not provide that shape. The runtime stub is required because vsce omits
`node_modules/**` from the VSIX.

### Rejected alternatives

- **Emit the plugin as ESM:** TypeScript would receive a namespace or default-export wrapper instead
  of the callable factory it expects.
- **Ship the plugin directly at the contributed `node_modules` path:** vsce always excludes that
  tree, so the path must be created at runtime.

---

## 0009: Keep SlickGrid during modernization (reconstructed)

**Status:** Accepted · **Date:** 2026-09-30
**Evidence:** [B4: why SlickGrid stays in this iteration](./iterations/01-modernization/build-and-test-stack.md#b4-why-slickgrid-stays-in-this-iteration)

### Question

Should the Collection View grid be replaced while the build and test stack changes?

### Decision

Keep SlickGrid for this iteration. Isolate it in its own JavaScript chunk and measure that chunk,
then replace the grid in a separate iteration.

### Reasoning

Both changes affect Collection View, so combining them would make regressions difficult to
attribute. Replacing the grid before Vitest would also require writing its component behavior tests
twice. Per-view splitting creates a measurable baseline without coupling the migrations.

### Rejected alternatives

- **Replace SlickGrid during the stack migration:** too many simultaneous changes in Collection
  View to attribute failures.
- **Replace it before the Vitest stage:** the behavior tests would be written once for Jest and
  again for Vitest.

---

## 0010: Run L3 on GitHub Actions only (reconstructed)

**Status:** Accepted · **Date:** 2026-09-30
**Evidence:** [The automated checks](./iterations/01-modernization/build-and-test-stack.md#the-automated-checks)

### Question

Should installed-VSIX activation run in both GitHub Actions and the official ADO build?

### Decision

Run L3 in GitHub Actions only. Keep ADO's pre-signing verification to offline checks such as L1.

### Reasoning

L3 downloads VS Code and launches it under a display. The official ADO build may run under
`DefaultDeny` network isolation, which blocks VS Code and Marketplace downloads. GitHub Actions can
provide network access and Xvfb, while ADO still inspects the exact artifact before signing.

### Rejected alternatives

- **Run L3 in ADO:** the equivalent Cosmos DB pipeline failed when network isolation blocked the
  required downloads.

---

## 0011: Keep L2-dev runner-free in this iteration (reconstructed)

**Status:** Accepted · **Date:** 2026-10-05
**Evidence:** [The automated checks](./iterations/01-modernization/build-and-test-stack.md#the-automated-checks)

### Question

Should the source-scenario harness add a new Playwright test project and CI lane during the build
migration?

### Decision

No. Serve typed scenarios through the Vite dev server and let agents and reviewers drive them with
the integrated browser tools. Add no `@playwright/test` dependency or new test runner in this
iteration.

### Reasoning

L2-dev exists for rapid access to named UI states without a host, backend, or Docker. Vite removes
the stale-disk-bundle problem from the parked harness, while the shared typed fixture core prevents
silent RPC drift. CI wiring and the final browser-runner choice belong to the E2E iteration.

### Rejected alternatives

- **Port the parked standalone Playwright project as-is:** it would retain a second runner and a
  bespoke page when Vite and Vitest can provide the future home.
- **Add `@playwright/test` and CI now:** explicitly deferred to the E2E iteration so this iteration
  does not fragment the test stack again.

---

## 0012: Use one branch and one PR, merging `main` (reconstructed)

**Status:** Accepted (modified) · **Date:** 2026-10-01
**Evidence:** [Ground rules](./iterations/01-modernization/build-and-test-stack.md#ground-rules)

### Question

Should modernization land stage by stage, and should the long-lived branch rebase or merge when it
updates from `main`?

### Decision

Keep all stages on `dev/tnaum/modernization` in one draft PR to `main`. Bring in eligible `main`
commits with merge commits, not rebases, and regenerate conflicted lockfiles with the repository
Node and npm versions. The 2026-10-07 modification restored a final `main` merge before #880 merges.

### Reasoning

No intermediate stage reaches `main` or users. The combined gates review the integrated migration,
while normal releases from `main` remain unblocked until the modernization is ready. The lockfile
quarantine rule avoids importing versions unavailable to the ADO feed immediately before release.

### Rejected alternatives

- **Separate per-stage PRs:** explicitly excluded by the one-branch, one-PR operator decision.
- **Rebase the branch:** the ground rule requires merge commits; one rebase onto `v0.11.0` was an
  exception after a fresh dependency broke the ADO build.
- **Merge the newest `main` regardless of dependency age:** rejected after the same-day relaxation
  was reversed because release builds use the quarantined ADO feed.

---

## 0013: The required check passes only when every expected layer passed

**Status:** Accepted · **Date:** 2026-10-14 · **Raised by:** the Stage 8.5 review, S85-F01
**Evidence:** [08.5-stage8.5-review.md](./iterations/01-modernization/08.5-stage8.5-review.md#s85-f01-the-sole-required-check-can-pass-or-be-skipped-while-expected-ci-fails)

### Question

The branch ruleset requires `license/cla` and `Build & Package`. That job only packaged the VSIX:
L1, L3 and the package checks could fail without blocking a merge, and when L0 failed the job was
skipped, which GitHub counts as passed. Should the required check cover every layer?

### Decision

Yes (operator: "yes, update the policy change"). The packaging job is renamed `Package VSIX`. A
final `gate` job, named `Build & Package` so the ruleset stays unchanged, runs after every layer
(`if: always()`) and fails unless the plan, L0 and, as the tier and path flags expect, the package
checks, packaging, L1 and L3 all succeeded. L1, L3 and the package checks therefore block merges.
In a run for an unrelated label the gate has a different name, so it never posts a skipped
`Build & Package`.

### Reasoning

Tiering made skipped jobs normal, and a skipped required check passes. One aggregate job that
knows what the tier expected is the only place that can tell a deliberate skip from a missing
result, and keeps the ruleset to one stable name as E2E jobs are added.

### Rejected alternatives

- **Require every verification job in the ruleset:** path-scoped jobs and future E2E jobs would
  make the ruleset brittle, and skipped jobs would still pass.

### For the E2E iteration

- E2E jobs join the gate's `needs` and are expected in the full tier only, so a requested full
  run that fails E2E fails the required check on that commit.

---

## 0014: CI jobs run in parallel where safe, under descriptive names

**Status:** Accepted · **Date:** 2026-10-14 · **Raised by:** the operator, comparing this branch's
CI with PR #963 ("I have gates so that I don't waste resources when one fails, but maybe that's
not so smart")

### Question

The first standard-tier run on #880 took 12.5 minutes of wall time for about 15 minutes of runner
time, because the jobs form a chain: L0 (7.1 min, with Vitest capped at one worker by
`maxWorkers: '25%'` on a 4-vCPU runner), then packaging, then L1 and L3. PR #963 runs every check
as its own parallel job and finishes in about 4 minutes. Should the chain stay, and should the job
names keep the plan's L-numbers?

### Decision

The hybrid structure (operator: "agreed, structure as in '1'"):

- L0 becomes two parallel jobs, static checks (l10n, ESLint, Prettier, type checks) and unit
  tests. Packaging no longer waits for them; L1 and L3 still follow packaging, which they need.
- Vitest uses every CPU in CI (`maxWorkers` 100% when `CI` is set; 25% locally), after checking
  the flaky Docker kill tests PR #963 fixed for four workers.
- A composite setup action restores `node_modules` from the Actions cache and runs `npm ci` only
  on a miss, as in PR #963.
- The merge gate (decision 0013) stays the only required check, so parallel jobs cannot weaken
  what blocks a merge.

The job names (operator: "names, as shown"), with no L-numbers in what people see:

| Before                         | After                                       |
| ------------------------------ | ------------------------------------------- |
| Plan CI tier                   | `Plan: choose checks`                       |
| Code Quality & Tests           | `Static checks` and `Unit tests`            |
| Package checks                 | `npm packages: verify tarballs`             |
| Package VSIX                   | `VSIX: build`                               |
| VSIX inspection (L1)           | `VSIX: inspect contents`                    |
| Installed VSIX activation (L3) | `VSIX: activate in VS Code`                 |
| (step) unbundled `/host` probe | `Webview host in unbundled extensions`      |
| CI report                      | `PR report`                                 |
| Build & Package (gate)         | `Merge gate` (after #880 merges, see below) |

Steps and report rows use the same words, and "self-test" replaces "negative control" (for
example "Self-test: inspection rejects broken VSIXs"). The L-numbers stay in the docs.

### Reasoning

The chain only saves runner time when a run fails, and draft PRs already run the cheap tier
first; on every passing ready PR it costs about 7 minutes of waiting. Standard runners are free for
this public repository, so wait time is the cost that matters. Expected: about 5 minutes of wall
time for about the same 15 minutes of runner time. The names say what each job checks without the
plan's vocabulary.

### Rejected alternatives

- **Keep the chain:** about 12.5 minutes per ready PR to save runner time on rare failures.
- **Every check its own job, as in PR #963:** about 4 minutes, but more jobs repeat setup (about 17
  runner-minutes) and occupy more concurrent runners; the hybrid gets most of the gain.

### Order

The structure, the names and the report wording change together on #880 after the G8.5 runs, so
the names change once. `Merge gate` follows after #880 merges, because the ruleset requires
`Build & Package` until then (see future-work.md).
