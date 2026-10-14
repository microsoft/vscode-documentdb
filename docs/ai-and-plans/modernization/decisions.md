---
kind: decisions
status: active
created: 2026-10-14
---

# Modernization: decisions

> Standing decisions about the build, bundling and test stack that later work builds on, the
> E2E iteration in particular. Decisions taken while executing the stages stay in
> [build-and-test-stack.md](./build-and-test-stack.md), next to the stage they shaped.

| #    | Decision                                                      | Status   | Changed from the proposal?                                                             | Date       | PR   |
| ---- | ------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------- | ---------- | ---- |
| 0001 | Workspace packages ship ESM only                              | Accepted | Accepted as proposed                                                                   | 2026-10-14 | #880 |
| 0002 | CI runs verification in tiers and reports what it ran and why | Accepted | **Operator added the layer report, the one-shot request label and the merged comment** | 2026-10-14 | #880 |
| 0003 | Negative controls run when their check changes, not every PR  | Accepted | Accepted as proposed                                                                   | 2026-10-14 | #880 |

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

| Tier     | When                                                                                         | Layers                                                         |
| -------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| fast     | Draft PR                                                                                     | L0: build, lint, formatting, type checks, unit tests           |
| standard | Ready PR (including the `ready_for_review` event), push to `main`                            | fast + package the VSIX + L1 inspection + L3 activation + size |
| full     | `ci:full-requested` label (one run), push to `release/**`, nightly on `main` once E2E exists | standard + E2E + every path-scoped check                       |

| Path-scoped check                                     | Runs when these change                                     |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| `verify:packages`                                     | `packages/**`, and always in the publish workflow          |
| `probe:host-unbundled`                                | `packages/vscode-ext-webview/**`, and when publishing      |
| `prove:vsix`, `prove:activation`, `test:verification` | `build/verification/**`, the Vite configs, `build/vite/**` |

Nightly runs cover `main` only: scheduled workflows run from the default branch, and open PRs get
the full tier on request. `release/**` branches are short-lived, so every push to one runs the
full tier.

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
- **Comment commands (`/run e2e`) through `issue_comment`:** runs in the default branch's
  context, needs its own permission checks, PR-head checkout and status reporting, and is a
  known security pitfall.
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
  [e2e-testing-strategy.md §5.8](./e2e-testing-strategy.md#58-tags-lanes-and-the-fail-loud-ci-machinery))
  select tests within the full tier; they do not decide whether E2E runs.
- A job that should have produced results and did not is reported as a failure, not as skipped.
- E2E is not a required check: with a one-shot request, the merged commit may not have had a
  full run. Making it required later needs a sticky label or a merge queue, as a new decision.
- A failing nightly run must notify someone (an issue or a message); see
  [e2e-testing-strategy.md §5.8](./e2e-testing-strategy.md#58-tags-lanes-and-the-fail-loud-ci-machinery).

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
