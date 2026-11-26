---
feature: data-grid
kind: plan
status: proposed
created: 2026-11-26
code:
  - src/webviews/documentdb/collectionView/components/resultsTab/**
  - src/webviews/documentdb/collectionView/CollectionView.tsx
  - src/webviews/documentdb/collectionView/collectionViewContext.ts
  - src/webviews/slickgrid.scss
  - src/webviews/utils/slickgrid/**
  - src/utils/slickgrid/**
  - src/documentdb/ClusterSession.ts
  - vite.config.views.mjs
  - build/verification/**
---

# Iteration 2: execution plan for the React Data Grid migration

**Status:** proposed, awaiting the operator at **G1**. This turns the accepted
[iteration 1 plan](./01-rdg-migration-plan.md) into work items an agent run can execute: owned
files, order, parallel lanes, interfaces, checks, gates and a model per item. It does **not** change
iteration 1's scope, guiding rules or the three operator gates. Where it reorders or splits items,
the change is listed in [What changed from iteration 1](#what-changed-from-iteration-1) and needs
approval at G1. Tracks [#1101](https://github.com/microsoft/vscode-documentdb/issues/1101).

The last section [evaluates how to run it](#evaluation-lead-or-copilot-fusion): with `/lead`, or with
Copilot Fusion at high or max effort.

## What changed from iteration 1

All of these are ordering or splitting; none adds product scope.

| #   | Change                                                                                                                            | Why                                                                                                                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | **WI-1c (new):** the advisor drafts the exact interfaces before G1                                                                | The `lead` skill requires interfaces that span items to be fixed before the first prompt. WI-2, WI-3 and WI-5–WI-9 all depend on them.                                                                                |
| C2  | **WI-2 split** into WI-2a (types only) and WI-2b (host shaping)                                                                   | A types-only commit lets the removal, fixtures and host work run in parallel against one contract.                                                                                                                    |
| C3  | **WI-3 split** into WI-3a (scenario runner), WI-3b (fixtures) and WI-3c (contract checks)                                         | The runner only has `click` and `fill` steps today (`build/verification/browser/scenarios.ts:49-53`). Keyboard journeys (M5–M7) need `press`, `dblclick` and a focus assertion first.                                 |
| C4  | **WI-4 moves ahead of WI-2b** and is split into WI-4a (remove SlickGrid, add RDG) and WI-4b (theme)                               | Iteration 1 says SlickGrid goes "at the start". Removing it first means WI-2b adapts placeholders, not SlickGrid code that is deleted a day later.                                                                    |
| C5  | **WI-9a (new):** a throwaway tree keyboard spike right after Step 1                                                               | WI-9 is the highest-risk item and the [reversal trigger](./01-rdg-migration-plan.md#cross-cutting) sits on it. Hit it before the table work, not after.                                                               |
| C6  | **Gestures provisionally decided at G1**, confirmed at G2                                                                         | Iteration 1 leaves row-selection gestures (open decision 3) to G2. WI-3c writes the keyboard checks _before_ the implementation, so it needs the selection and step-in keys earlier. G2 still confirms them hands-on. |
| C7  | **WI-12 (new):** the AI pre-review required by [CONTRIBUTING.md §6](../../../../../CONTRIBUTING.md#6-ai-assisted-review-workflow) | Repository rule for handover. Its "author decisions" stage is an operator decision, so **G3 splits into G3a (review decisions) and G3b (acceptance)**. It is still the third operator gate, in two sittings.          |
| C8  | **Draft PR opened at G2**                                                                                                         | The CONTRIBUTING review merges Copilot reviewer comments from the PR, so the PR must exist before WI-12. Pushing is an always-ask action, so it is authorised at G2.                                                  |

## Gates

There are four kinds. Only the first two stop work for the operator.

| Kind                       | Released by                                                                                | Form in chat                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| **Operator decision gate** | The operator's reply `G<n> released`, with any changes per row                             | **[OPERATOR DECISION NEEDED] G<n>: …** with options, recommendation, what it blocks |
| **Operator test gate**     | The operator's reply `G<n> released` plus findings (or "no findings")                      | **[OPERATOR TEST NEEDED] G<n>: …** with numbered steps and the build to use         |
| **Automated gate (A)**     | The leader, on recorded evidence (command and result in the done note). No operator reply. | Progress checkpoint line `A<n> passed: <evidence>`                                  |
| **Escalation (E)**         | Conditional. Raised only if its trigger fires; then it is an operator decision gate.       | **[OPERATOR DECISION NEEDED] E<n>/WI-x: …**                                         |

Rules that apply to every gate:

- Silence is not approval. A question tool that reports the operator unavailable leaves the gate
  pending.
- While an operator gate is pending, only the work listed under "May continue" runs. Everything
  else is parked with a note.
- A gate is released for the evidence shown. If that evidence changes (for example a new pin), the
  gate is raised again.
- The leader records each release in this document under the gate, with the date and the
  operator's changes, in a docs-only commit.

### G1: scope, pin, interfaces, gestures (operator decision gate)

- **When:** WI-0a, WI-1 and WI-1c have returned.
- **Evidence package:** the WI-1 pin report; the iteration 1 [scope tables](./01-rdg-migration-plan.md#scope-what-the-migration-replicates);
  the WI-1c interface spec with the advisor's verdict; this plan; the draft decision entries.
- **Operator decides:**
  1. Each scope row (M, K, D): keep, move to "RDG default", or drop.
  2. The exact pin: beta.64 or beta.61 (iteration 1 open decision 1).
  3. Playwright contract checks: on demand only, or also in CI (open decision 2). If CI, WI-3c
     also owns the workflow change.
  4. Provisional gestures (C6): row selection (recommendation: click selects one row,
     Ctrl/Cmd+click toggles, Shift+click extends, Space on a focused row toggles, Shift+Space
     extends with the keyboard) and the keyboard step-in key on an object cell (recommendation:
     Enter, since the grid has no cell editors; alternative Alt+Down).
  5. The changes C1–C8 above, and the per-item models below.
- **Release:** `G1 released` plus any per-row changes. The leader then runs WI-0b.
- **Blocks:** all code on the feature branch.
- **May continue:** nothing except answering questions about the evidence.

**G1 pending (2026-11-26).** Step 0 evidence is ready: [proposed decisions](../decisions.md),
[M/K/D scope tables](./01-rdg-migration-plan.md#scope-what-the-migration-replicates),
[pin report](#wi-1-pin-report) and [interface spec and O1–O5](#wi-1c-interface-spec). Recommended:
beta.61, on-demand Playwright checks, the scope rows as proposed, and the gestures above with
Enter for step-in. Preserve current nested `_id` and tree sibling presentation; confirm fail-closed
identity and non-actionable-row selection behavior. O5 does not authorize host changes: if K2 is
expected to cover collections without globally unique `_id` values, resolve the safe action policy
before implementing it. Release only on the operator's `G1 released` with any per-row changes.
WI-0b has not started.

**G1 operator feedback (2026-11-26; not a release).** The operator wants the gate message to
show the options and recommendations directly; the links are for evidence. Keep implementation
simple and maintainable. The exact pin remains open pending a retest in VS Code's Integrated
Browser and the operator's pin decision.

| Choice | Operator feedback |
| --- | --- |
| Scope, execution and models | Keep the M/K/D rows and accept C1–C8 and the assigned models as written. |
| Pin | Selected `7.0.0-beta.64` after the built-in browser retest. The choice does not by itself change VS Code's minimum supported version. |
| Playwright checks | On demand only. |
| Gestures | Accept the proposed row gestures and Enter. Include Shift+arrows only if already in scope; it is listed for future cell-range selection (F-3), not as a row-selection gesture in this migration. Do not add it. |
| O1–O3 | Keep today's nested `_id` display and field-name tree ordering; withhold document actions for unreliable IDs. |
| O4 | Browsable rows are always selectable, even when they have no safe action target. Selection does not confer action eligibility. |
| O5 | Cross-page/shard duplicate handling is out of scope. Keep existing error handling when the database reports an error. This is not a guarantee that a duplicate ID will trigger one: `ClustersClient.deleteDocuments` uses `deleteMany` and currently checks acknowledgement, not match uniqueness. |

The [built-in browser retest](#built-in-browser-retest) is complete. The operator selected
beta.64 and said G1 was approved. The specified `G1 released` signal and the minimum-version
policy are still pending. No change to `engines.vscode` or compatibility shim was authorized.

### G2: hands-on direction check (operator test gate)

- **When:** A2–A8 have passed (WI-5 to WI-9 done) and the VSIX for G2 is built (A9).
- **Steps for the operator:** install the VSIX in VS Code; against a real cluster, open a
  collection with wide and nested data; in Table view step into an object by double-click and by
  the G1 key, step out by Level up and a breadcrumb; select one, several and no rows and try
  View/Edit/Delete on a throwaway collection; page through 10/50/100/500; switch to Tree view,
  expand and collapse with arrow keys, check Narrator reads level and expanded state; switch the
  three VS Code themes.
- **Operator decides:** the gestures (confirms or changes the G1 provisional choice); whether the
  look is acceptable; whether to open the draft PR now (C8).
- **Release:** `G2 released` plus a numbered findings list. Findings become items WI-G2-1, WI-G2-2,
  … before Step 4.
- **Blocks:** WI-10, WI-11, WI-12 and the draft PR push.
- **May continue:** nothing on the branch; the leader may prepare the WI-10 sweep prompt.

### G3a: review decisions (operator decision gate)

- **When:** WI-12 has produced the review file
  (`docs/ai-and-plans/features/data-grid/iterations/03-rdg-migration-review.md`).
- **Operator decides:** per finding, fix now, issue for later, or reject, with reasoning
  (CONTRIBUTING §6.2). The leader records the decisions verbatim in the review file.
- **Release:** `G3a released`. Accepted fixes become WI-G3-1, WI-G3-2, …
- **Blocks:** the fixes and G3b.

### G3b: final acceptance (operator test gate)

- **When:** the G3a fixes are committed and the Case 2 list has run and passed (A11).
- **Steps for the operator:** NVDA and Narrator in packaged VS Code, table and tree (focus and
  selection announced distinctly, tree level and expansion); Windows contrast themes; a real cluster
  with wide and deep data; the WI-10 report's "not verified" list.
- **Release:** `G3b released`. The operator merges the PR (the agent does not merge) and comments on
  #383 and the other grid `a11y` issues, or asks the leader to draft those comments.

### Automated gates

| Gate | After                  | Passes when                                                                                                                                                                                                             |
| ---- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1   | WI-1c                  | Advisor approves the interface spec at ≥ 80 % confidence. Before G1, because G1 shows it.                                                                                                                               |
| A2   | Step 1 (WI-2a – WI-4b) | `npm run build` green; L1 inspection green with no SlickGrid assertions left; `git grep -i slickgrid -- src build package.json vite.config.views.mjs` returns only intended history mentions; shaping unit tests green. |
| A3   | WI-3c                  | Every contract check runs without harness errors (`data-ready` not `failed` for setup reasons) and fails only because the grid is missing. A check that passes against a placeholder is rewritten.                      |
| A4   | WI-9a                  | In the spike, Right/Left expand and collapse a tree row from the keyboard and `aria-expanded`/`aria-level` update. If not: raise **E1**.                                                                                |
| A5   | WI-5, WI-6             | Their scope rows' contract checks pass; no earlier passing check regresses; build green.                                                                                                                                |
| A6   | WI-7                   | K1–K2 checks pass, including the late-delete and missing-`_id` cases; advisor logic review approved.                                                                                                                    |
| A7   | WI-8                   | M1, M2, M7 checks pass; step-in telemetry still fires (unit test or harness call log).                                                                                                                                  |
| A8   | WI-9                   | M4–M5 checks pass; advisor logic review approved.                                                                                                                                                                       |
| A9   | Before G2              | `npm run package` succeeds; L1 and L3 checks green; a VSIX path is in the G2 message.                                                                                                                                   |
| A10  | WI-10                  | Sweep report written with "verified" and "not verified" lists; no console errors or CSP violations in any Collection View route.                                                                                        |
| A11  | Before G3b             | Full Case 2 list from `.github/copilot-instructions.md` ran and passed, each result reported separately.                                                                                                                |

**A1 passed (2026-11-26).** Leader applied the ≥80% gate to the baseline spec at `373373a0`:
`claude-opus-5.5` approved it at 86% (see the [WI-1c verdict](#wi-1c-interface-spec)). This is a
read-only design gate, not runtime verification or release of G1. The operator choices remain open.

### Escalations

| ID  | Trigger                                                                                                                                    | Operator chooses                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| E1  | Reversal trigger: tree (A4/A8) or selection (A6) cannot meet the accessibility gate for reasons inside RDG, after one advisor-guided retry | Retry with a stronger model (see [models](#models)), patch upstream, or stop and re-evaluate SlickGrid 11 |
| E2  | The pin must change after G1 (a blocking RDG bug, a needed fix in a later beta)                                                            | New pin, or a workaround                                                                                  |
| E3  | A `TDD:` contract check from WI-3c needs to change                                                                                         | Change the contract or fix the implementation (repository rule)                                           |
| E4  | A **M** or **K** row cannot be met with RDG's defaults and needs custom behaviour not in the spec, or a **D** row turns out broken         | Build it, move it to "RDG default", or drop it                                                            |
| E5  | Any always-ask trigger from the `lead` skill: new user-visible wording or behaviour, persisted data, settings, CI workflow, push           | As asked                                                                                                  |

## Work items

### Overview and order

`∥` marks items that may run at the same time. Their owned files do not overlap.

| Step | Items                 | Lane notes                                                                                                            | Gate after   |
| ---- | --------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------ |
| 0    | WI-0a ∥ WI-1 ∥ WI-1c  | WI-1 in a scratch worktree; WI-1c read-only                                                                           | A1, **G1**   |
| 0    | WI-0b                 | Records G1                                                                                                            | —            |
| 1    | WI-2a ∥ WI-4a ∥ WI-3a | Disjoint files                                                                                                        | —            |
| 1    | WI-2b ∥ WI-4b         | WI-2b after WI-4a (placeholders); WI-4b owns a new theme file                                                         | —            |
| 1    | WI-3b                 | After WI-2b, WI-3a, WI-4a (shares `fixtures.ts` and `scenarios.ts`)                                                   | A2           |
| 1    | WI-3c ∥ WI-9a         | WI-9a in a scratch worktree                                                                                           | A3, A4       |
| 2    | WI-5 ∥ WI-6 ∥ WI-9    | WI-6 owns the cell; WI-5 the table; WI-9 the tree. WI-6's last step wires the cell into the table after WI-5 commits. | A5, A8       |
| 2    | WI-7 → WI-8           | Same files; one after the other                                                                                       | A6, A7       |
| 3    | (build)               | —                                                                                                                     | A9, **G2**   |
| 3    | WI-G2-n               | Findings from G2, sized by the leader                                                                                 | —            |
| 4    | WI-10 ∥ WI-11         | WI-10 owns checks; WI-11 owns docs                                                                                    | A10          |
| 4    | WI-12                 | Needs the draft PR                                                                                                    | **G3a**      |
| 4    | WI-G3-n, then Case 2  | —                                                                                                                     | A11, **G3b** |

Critical path: G1 → WI-4a → WI-2b → WI-3b → WI-3c → WI-5 → WI-7 → WI-8 → G2 → WI-10 → WI-12 → G3a
→ G3b. The tree (WI-9a, WI-9) runs beside the table and must not become the critical path; if A4
fails, it does, through E1.

### Models

Roles follow the `lead` skill. Full model IDs; the reason is per item below.

| Role                  | Model                           | Notes                                                                                                                                                                                                                                                             |
| --------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Leader                | `gpt-6.1-sol`                   | The session model. CONTRIBUTING §6.3 recommends Sol as leader. Coordination only; it should not need a stronger model.                                                                                                                                            |
| Advisor               | `claude-opus-5.5`               | Used as advisor in earlier `/lead` runs here (for example [local-quickstart 11](../../local-quickstart/iterations/11-setup-stage-details.md#execution-summary)). A different vendor from the Sol workers, so its reviews are independent.                         |
| Coding, high risk     | `gpt-6.1-sol`                   | Data identity, selection, the tree's keyboard and ARIA semantics, and the `TDD:` contracts. A mistake here deletes the wrong document or breaks the accessibility gate.                                                                                           |
| Coding, standard      | `mai-code-2`                    | **Operator override.** Takes the simpler Sol items and all Terra items: UI components, test infrastructure, fixtures, mechanical removal. Each has an automated gate (A2–A10); the theme's look is also judged at G2. See [MAI Code 2](#mai-code-2-what-we-know). |
| Coding, small or docs | `gpt-6-luna`                    | Types copied from a spec, docs, decision entries.                                                                                                                                                                                                                 |
| Fallback coding       | `gpt-6.1-sol` / `gpt-6.1-terra` | Used when a `mai-code-2` item fails (rule below). Each item names its fallback.                                                                                                                                                                                   |
| Checks and builds     | `mai-code-2-flash`              | **Operator override.** Runs `npm run build`, focused Vitest, the browser scenario suite, L2-dev `run-all`, `npm run package`, L1/L3. Returns pass/fail and failure output only.                                                                                   |
| Exploration           | `mai-code-2-flash`              | Same override, for broad reads that return summaries.                                                                                                                                                                                                             |
| Escalation (E1 only)  | `hydrafusion-max`               | Only if the operator names it for WI-9 or WI-7 after a failed attempt. The skill forbids giving a coder a model as strong as the advisor without asking.                                                                                                          |
| AI pre-review (WI-12) | see WI-12                       | Two vendors, as CONTRIBUTING §6.1 requires.                                                                                                                                                                                                                       |

**Fallback rule for `mai-code-2`.** If an item fails its acceptance (its automated gate, the
leader's review or the advisor's review) and one corrective turn on `mai-code-2` does not fix it,
the leader reruns the item on its named fallback and records the substitution in the done note. A
call that fails before any work is retried once on the same model, as the skill says. The other
fallbacks follow the skill: the next tier down for a failed or unavailable model;
`gpt-6.1-terra` replaces `mai-code-2-flash` for checks if it cannot drive Playwright or misreports
results. `gpt-6.2-sol` is listed by the host but has no track record here; do not substitute it
without the operator naming it.

**Reasoning effort.** Host default for every subagent unless the operator names one. Microsoft
measured MAI Code 2 at max effort, so default-effort results may be lower than its published
figures.

### MAI Code 2: what we know

From Microsoft's announcement and model card (both dated 2026-11-17; vendor claims, not
independent measurements):

| Model              | Claimed position                                                                                                                                                                                                                                                                                           | Context                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `mai-code-2`       | About 98 % of `gpt-6.1-sol`'s score at about 40 % of its cost, and 96 % of `claude-opus-5.5`'s at about 5 %, averaged over four coding benchmarks. Cost figures use a 50 % promotional price. Strong on multi-file work and UI: developers preferred its frontend results over GPT-6 Sol 64 % of the time. | 1M tokens; effort low to max |
| `mai-code-2-flash` | Comparable to `gpt-6-luna` and `claude-haiku-5.5` at about 65 % and 20 % of their cost. Built for targeted edits, routine fixes and fast iterations.                                                                                                                                                       | 1M tokens; effort low to max |

What we do not know: how either model performs in this repository. The operator's session history
has three `mai-code-2` calls and seven `mai-code-2-flash` calls, too few to judge. So:

- `mai-code-2` gets the items where a mistake is caught before it can matter, by an automated gate
  or, for the theme's look, by the operator at G2: UI components (its claimed strength), test
  infrastructure, fixtures, the removal, the sweep.
- Sol keeps the six items where a subtle mistake can pass the tests or no test exists: the pin
  report (WI-1), which has no automated gate and on which the operator bases the pin at G1; data
  identity (WI-2b); the contracts that every later item is judged by (WI-3c); selection and delete
  (WI-7); and the tree (WI-9a, WI-9).
- The run's usage report (per model and role, from `agent-stats.mjs`) is the measurement. Compare
  `mai-code-2` items with the Sol items and with earlier Terra runs before keeping this split for
  the next iteration.

Sources: [Introducing MAI Code 2 and MAI Code 2 Flash](https://microsoft.ai/news/introducing-mai-code-2-and-mai-code-2-flash/),
[model card (PDF)](https://microsoft.ai/pdf/MAI-Code-2-And-MAI-Code-2-Flash-Model-Card.pdf?v=3).

### Per-item model assignment

| Item  | Title                                  | Model                                 | Fallback        | Why                                                                                         |
| ----- | -------------------------------------- | ------------------------------------- | --------------- | ------------------------------------------------------------------------------------------- |
| WI-0a | Draft decisions and branch             | `gpt-6-luna`                          | —               | Writes three entries from existing research; leader creates the branch.                     |
| WI-1  | Pin and runtime check                  | `gpt-6.1-sol`                         | —               | Judgement on evidence with no automated gate; the operator picks the pin from its report.   |
| WI-1c | Interface spec                         | `claude-opus-5.5`                     | —               | Advisor gate: interfaces across modules.                                                    |
| WI-0b | Record confirmed scope                 | `gpt-6-luna`                          | —               | Transcribes G1.                                                                             |
| WI-2a | Neutral types                          | `gpt-6-luna`                          | —               | Copies the approved spec into one file.                                                     |
| WI-4a | Remove SlickGrid, add RDG              | `mai-code-2`                          | `gpt-6.1-terra` | Mechanical but wide; build and L1 inspection verify it.                                     |
| WI-3a | Scenario runner: keys and focus        | `mai-code-2`                          | `gpt-6.1-terra` | Self-contained test infrastructure with its own unit tests.                                 |
| WI-2b | Host shaping and identity              | `gpt-6.1-sol`                         | —               | Data identity: a mistake here deletes the wrong document.                                   |
| WI-4b | Grid theme                             | `mai-code-2`                          | `gpt-6.1-terra` | One SCSS file mapping tokens; visual, its claimed strength.                                 |
| WI-3b | Collection View fixtures and scenarios | `mai-code-2`                          | `gpt-6.1-terra` | Data fixtures from a list of cases.                                                         |
| WI-3c | `TDD:` contract checks                 | `gpt-6.1-sol`                         | —               | Every later item is judged by these; they must state outcomes and ARIA semantics correctly. |
| WI-9a | Tree keyboard spike                    | `gpt-6.1-sol`                         | —               | Highest technical risk; result decides E1.                                                  |
| WI-5  | Table core                             | `mai-code-2`                          | `gpt-6.1-sol`   | UI wiring, fully checked by the WI-3c contracts (A5).                                       |
| WI-6  | Typed value cell                       | `mai-code-2`                          | `gpt-6.1-terra` | One component with clear inputs and outputs.                                                |
| WI-7  | Selection and document actions         | `gpt-6.1-sol`                         | —               | Data-loss risk; stale responses; advisor review mandatory.                                  |
| WI-8  | Step in and out                        | `mai-code-2`                          | `gpt-6.1-sol`   | Existing flow re-keyed by field; the key was chosen at G1. Builds on WI-7's state shape.    |
| WI-9  | Accessible document tree               | `gpt-6.1-sol`                         | —               | `treegrid` semantics and focus management; `hydrafusion-max` only via E1.                   |
| WI-10 | Automated sweep                        | `mai-code-2` + `mai-code-2-flash`     | `gpt-6.1-sol`   | `mai-code-2` fills check gaps; flash runs the suites.                                       |
| WI-11 | Clean-up and documentation             | `gpt-6-luna`                          | —               | Docs.                                                                                       |
| WI-12 | AI pre-review                          | `gpt-6-astra`, then `claude-opus-5.5` | —               | Stage 1 and the validation gate from different vendors (CONTRIBUTING §6.1).                 |

`gpt-6-luna` stays on docs and transcription. `mai-code-2-flash` claims Luna's level at lower cost,
but those items are cheap already and have no automated gate to catch a weaker draft.

## Interfaces (starting point for WI-1c)

Today's shapes carry three hazards that the migration must remove, all visible in
`src/utils/slickgrid/mongo/toSlickGridTable.ts`:

- Row IDs are `${index}/${timestamp}`, so they change on every fetch and say nothing about the
  document.
- The document identity is a field in the row (`'x-objectid'`) and collides with a user field of
  that name; `_id` is skipped when falsy (`if (doc._id)`), so a document with `_id: 0` cannot be
  edited or deleted.
- Step-in and selection use row and cell **indexes** (`handleStepIn(row, cell)`,
  `selectedDocumentIndexes`).

WI-1c turns this sketch into exact types. It is a proposal, not a decision:

```typescript
// src/utils/documentGrid/types.ts (folder name settled in WI-1c)

/** One displayed value; `type` keeps today's BSON type keys. */
export interface GridCellValue {
  readonly display: string;
  readonly type: string;
}

/** A document's root identity. Present only when the root `_id` can be serialised canonically. */
export interface DocumentIdentity {
  /** Canonical EJSON of the root `_id` (relaxed: false); used for queries and as the row key. */
  readonly key: string;
  readonly display: string;
}

export interface TableColumn {
  /** Field name at the current level; the root `_id` column uses a reserved key that no field can have. */
  readonly key: string;
  readonly label: string;
  readonly isRootId: boolean;
}

export interface TableRow {
  /** Stable across fetches: `identity.key` when present, otherwise a page-position key. */
  readonly rowKey: string;
  /** Undefined: browsable, never a View/Edit/Delete target (K2). */
  readonly identity?: DocumentIdentity;
  /** Missing key means a missing field (K6), never `null`. */
  readonly cells: Readonly<Record<string, GridCellValue>>;
}

export interface TablePage {
  readonly path: readonly string[];
  readonly columns: readonly TableColumn[];
  readonly rows: readonly TableRow[];
}

export interface TreeNode {
  /** Stable: document key plus field path. */
  readonly key: string;
  readonly parentKey: string | null;
  readonly depth: number;
  readonly field: string;
  readonly value: GridCellValue;
  /** False for arrays over the expansion limit (M4). */
  readonly expandable: boolean;
}
```

Webview contracts WI-1c also fixes: `onStepIn(rowKey, columnKey)`; selection held as row keys in
`CollectionViewContext.dataSelection` (replacing `selectedDocumentIndexes`), with the identities
taken from the rows, not recomputed from positions; the cell component's props
(`value: GridCellValue | undefined`, `isRootId`). The tRPC procedures keep their names; only their
output types change, so no telemetry or command contract moves.

## Work item detail

Every prompt also carries the `lead` skill's fixed block and file lists. "Owns" lists files the
item may change; "Not" lists files it must leave alone. The leader re-derives owned files with
`git grep` before each prompt, as the skill requires; these lists are the starting point.

### Step 0

**WI-0a: draft decisions and create the branch** · `gpt-6-luna`

- Leader creates `feature/rdg-migration` from `main` (local only; pushing is E5).
- Owns: `docs/ai-and-plans/features/data-grid/decisions.md` (new) with entries 0001 (RDG, exact
  beta pin, tree built by us, reversal triggers), 0002 (way of working: feature branch, no
  coexistence, automation first, native menus), 0003 placeholder for the confirmed scope. Status
  "Proposed".
- Acceptance: each entry cites the research files it rests on; no rationale the operator did not
  state.

> **Done (2026-11-26), commit `50154173`:** `gpt-6-luna` drafted Proposed entries 0001–0003
> with research links and no pin or scope approval. The operator authorized drafting only;
> the leader confirmed (100%) that the entries leave the G1 choices open and created local
> `feature/rdg-migration` at `main` (`8f81840d`). Step 0 records stay on the planning branch
> `dev/tnaum/table-redesign`, where their source research and plan are tracked. No tests added
> (documentation only); staged whitespace check passed. Coding usage: 1.5 AIU, 8 requests,
> 59s summed model time (host log).

**WI-1: pin and runtime check** · `gpt-6.1-sol` · scratch worktree, nothing committed but the report

- Compare beta.64 and beta.61 from the approved registry: does either use
  `Map.prototype.getOrInsertComputed` or CSS `light-dark()`, and does the Chromium in the Electron of
  VS Code `^1.109.0` (from `package.json` `engines`) support them; CSS file emission in a Vite
  library build; CSP needs (inline styles).
- Smoke: a throwaway route rendering RDG with 500 rows in `npm run watch:views`; record console and
  CSP errors.
- Output: a "Pin report" section appended to this document: a table per version, with evidence
  links, and a recommendation.
- Checks: `mai-code-2-flash` runs the dev server and Playwright.

#### WI-1 pin report

**Recommendation for G1: exact-pin `react-data-grid@7.0.0-beta.61`.** Beta.64's normal resize
setup uses a `WeakMap` upsert method unavailable at the declared VS Code engine floor. Its
newer-runtime success does not make it a compatible pin. No dependency or engine was changed
in the product.

`npm view` and `npm pack` retrieved both exact artifacts through the configured approved proxy
(`https://packagefeedproxy.microsoft.io/npm/`), with lifecycle scripts disabled. The downloaded
hashes matched proxy metadata (SHA-1 for both, published SRI also for beta.64), and the installed
scratch JavaScript/CSS matched the unpacked artifacts byte for byte.

| Published artifact | 7.0.0-beta.61 | 7.0.0-beta.64 |
| --- | --- | --- |
| Upstream evidence | [Release](https://github.com/Comcast/react-data-grid/releases/tag/v7.0.0-beta.61) | [Release](https://github.com/Comcast/react-data-grid/releases/tag/v7.0.0-beta.64), [sizing hook](https://github.com/Comcast/react-data-grid/blob/v7.0.0-beta.64/src/hooks/useGridDimensions.ts) |
| Executable `getOrInsertComputed` in `lib/index.js` | No `Map` or `WeakMap` call; uses a module-scoped `ResizeObserver`. | No executable `Map` call; one `WeakMap` call for grid sizing. The [grouping fix](https://github.com/Comcast/react-data-grid/pull/4227) is a different call site. |
| Published `lib/styles.css` | 12 `light-dark()` color calls; 8,813 bytes. | 13 `light-dark()` color calls; 9,900 bytes. |
| React/React DOM peer and public row key API | `^19.2`; `rowKeyGetter`. | `^19.2`; `getRowKey`. |

**Minimum runtime.** `engines.vscode` is `^1.109.0`. The
[VS Code 1.109.0 source](https://github.com/microsoft/vscode/blob/1.109.0/.npmrc) pins
[Electron 39.3.0](https://releases.electronjs.org/release/v39.3.0) with Chromium **142.0.7444.265**.
[Chromium 145](https://developer.chrome.com/release-notes/145#upsert) first shipped the Map and
WeakMap upsert methods by default; [`light-dark()` colors](https://developer.chrome.com/blog/new-in-chrome-123#light-dark)
have been supported since Chromium 123. Transpiling syntax to ES2023 does not polyfill a missing
runtime method. The minimum VS Code installation is distinct from either of the standalone browser
probes.

**CSS and CSP.** [The webview controller](../../../../../packages/vscode-ext-webview/src/host/WebviewController.ts)
uses a nonce in `script-src`, not in `style-src`. Its `style-src` already permits inline styles
and there is no overriding `style-src-attr`/`style-src-elem`; RDG needs no CSP relaxation.
[The views build](../../../../../vite.config.views.mjs) injects the emitted stylesheet via
[`inlineCss()`](../../../../../build/vite/inline-css.mjs), so a standalone CSS file is expected
from a Vite library build but not from the packaged-style output. Both need content checks.

**Scratch smoke results.** Both exact aliases used React 19.2.4, Vite 8.1.6, Lightning CSS 1.33.0
and Playwright Core 1.65.1. The scratch-only aliases initially split the dev React dependency
graph (beta.61 invalid hook call); React deduplication and pre-optimization of both aliases
eliminated the error. The smoke has no host RPC or installed VS Code webview.

| Check | 7.0.0-beta.61 | 7.0.0-beta.64 |
| --- | --- | --- |
| Chromium 148.0.7778.96, dev and packaged-style | Rendered 500 rows. | Rendered 500 rows; one benign favicon 404 in the dev probe. |
| [Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/) 142.0.7444.175, dev and packaged-style | Rendered a 760×400 grid, 16 virtual rows initially, reached ID 500. No page/CSP errors. | Both routes failed to mount: `resizeObservers.getOrInsertComputed is not a function`. Map and WeakMap upserts were absent; `ResizeObserver` and `light-dark()` were supported. |
| Vite library output | Standalone CSS (8,871 bytes), RDG selectors/tokens present. | Standalone CSS (9,963 bytes), RDG selectors/tokens present. |
| Packaged-style output | One injected style (8,871 bytes), no standalone CSS or CSP violation. | One injected style (9,963 bytes), no standalone CSS or CSP violation. |

The library/packaged builds ran `npm run build:lib:64`, `build:lib:61`, `build:packaged:64` and
`build:packaged:61` in the scratch package (`--ignore-scripts` for each). Playwright drove
`npm run watch:views --ignore-scripts` and a local static server for the packaged-style pages.
In Chromium 148, both packaged grids also supported horizontal scrolling with a frozen column,
keyboard movement and resizing from 400 to 430 px. This is a runtime smoke, not the K11
performance or accessibility acceptance check.

**Theme caveat for WI-4b/K10.** The default packaged CSS on both versions had Lightning CSS
markers and no native `light-dark()` calls. It tracked the system preference even when the
document's `color-scheme` was explicitly set to the opposite mode. A scratch-only beta.61 A/B
using `npx vite build --config vite.config.ab61.mjs --mode packaged61` with `cssMinify: false`
retained all 12 native calls and restored correct forced colors in Chromium 142; still one
injected stylesheet and no CSP violations. This diagnostic is not a recommendation to disable
minification globally. Verify the planned VS Code token/theme mapping under packaged output;
high-contrast and the installed minimum VS Code workbench were not run.

##### Built-in browser retest

On 2026-11-26, `mai-code-2-flash` drove the existing scratch routes in VS Code's Integrated
Browser as requested. Its reported runtime was **VS Code Insiders 1.149.0-insider, Electron
43.8.10, Chromium 150.0.7871.250**. Both Map and WeakMap upserts were present. The four dev and
packaged-style routes loaded, rendered a 760×400 grid (`aria-rowcount=501`, three columns and
15 initial virtual rows), and reached ID 500 on scroll. Both packaged routes had one injected
stylesheet. The beta.64 dev and beta.61 packaged reloads recorded no CSP violations. An attempted
external-browser inspection returned a missing-reference error and supplied no test evidence.

This verifies both versions on the operator's current Insiders runtime. It does not reproduce
the earlier Chromium 142 setup, which loaded the beta.61 control but threw the missing-method
error with beta.64, nor does it test an installed VS Code 1.109.0. **Keep the beta.61 recommendation
if retaining the declared support floor.** Selecting beta.64 requires compatibility evidence at
that floor or a separately approved new floor. Retest checks used 3.0 AIU over 27 requests
(2m41s summed model time; host log).

> **Done (2026-11-26), commit `4f8ef192`:** `gpt-6.1-sol` compared exact artifacts and prepared
> the isolated smoke; `mai-code-2-flash` ran the checks and fixed a scratch-only React alias
> issue on the follow-up. The leader recommends beta.61 (99% confidence): beta.64's ordinary
> sizing actually fails on Chromium 142 and beta.61 mounts in both modes. The operator still
> owns the pin. The CSS A/B confirmed a theme caveat, not a production change. No product tests
> added; scratch type check, four Vite builds, two Chromium smoke runs and the CSS A/B ran as
> described above. Investigation usage: 66.7 AIU, 16 requests, 7m08s summed model time.
> Checks usage across both turns: 3.7 AIU, 48 requests, 6m16s summed model time (host log).

**WI-1c: interface spec** · advisor `claude-opus-5.5`, read-only

- Input: the [interfaces sketch](#interfaces-starting-point-for-wi-1c), `toSlickGridTable.ts`,
  `toSlickGridTree.ts`, `ClusterSession.ts`, `collectionViewContext.ts`, `CollectionView.tsx`
  (`handleStepInRequest`, delete flow around lines 480–520), parity §2.
- Output: exact types, the reserved root `_id` column key, the row key fallback, which file each
  type lives in, and the list of consumers. Recorded in this document under WI-1c. Passing A1 means
  ≥ 80 % confidence.

#### WI-1c interface spec

**Status:** proposed by the advisor; only G1 accepts it. Pin, gestures and scope rows are separate
G1 decisions. This is the concrete proposal for the provisional sketch above.

| File | Side | Owner | Contents |
| --- | --- | --- | --- |
| `src/utils/documentGrid/types.ts` | Shared | WI-2a | Neutral types, column keys and `getCell`; no BSON, driver or React imports. |
| `src/utils/documentGrid/documentIdentity.ts` | Host | WI-2b | ID serialization, projection trust and page row keys. |
| `src/utils/documentGrid/toTablePage.ts` | Host | WI-2b | Replaces `slickgrid/mongo/toSlickGridTable.ts`. |
| `src/utils/documentGrid/toTreeNodes.ts` | Host | WI-2b | Replaces `slickgrid/mongo/toSlickGridTree.ts`. |
| `src/utils/documentGrid/*.test.ts` | Host | WI-2b | Moved shaping tests and new `documentIdentity.test.ts`. |
| `src/webviews/utils/documentGrid/typeToDisplayString.ts` | Webview | WI-2b | Moved unchanged: `bsonStringToDisplayString(type: string): string`. |

`GridCellValue` replaces `src/utils/slickgrid/CellValue.ts`. Webviews import only `types.ts` from
`src/utils/documentGrid/`. Payloads are plain JSON; optional fields are omitted when absent.

```typescript
// src/utils/documentGrid/types.ts
export interface GridCellValue {
    /** Formatter output; render as text, not HTML. */
    readonly display: string;
    /** The existing BSONTypes key, not its display name. */
    readonly type: string;
}

export const ROOT_ID_COLUMN_KEY = 'root:_id';
const FIELD_COLUMN_KEY_PREFIX = 'field:';
export type FieldColumnKey = `field:${string}`;
export type ColumnKey = typeof ROOT_ID_COLUMN_KEY | FieldColumnKey;

export function fieldColumnKey(field: string): FieldColumnKey {
    return `${FIELD_COLUMN_KEY_PREFIX}${field}`;
}

export function fieldFromColumnKey(key: ColumnKey): string | undefined {
    return key.startsWith(FIELD_COLUMN_KEY_PREFIX) ? key.slice(FIELD_COLUMN_KEY_PREFIX.length) : undefined;
}

export interface TableColumn {
    readonly key: ColumnKey;
    readonly label: string;
    readonly isRootId: boolean;
}

export interface TableRow {
    /** 'id:' + documentId when actionable; otherwise 'pos:' + zero-based page index. */
    readonly rowKey: string;
    /** Canonical EJSON of the root _id. Absent means browsable but not actionable. */
    readonly documentId?: string;
    /** Missing key means missing field. BSON null is { display: 'null', type: 'null' }. */
    readonly cells: Readonly<Partial<Record<ColumnKey, GridCellValue>>>;
}

export interface TablePage {
    readonly path: readonly string[];
    /** Root ID column first, then field columns at path. */
    readonly columns: readonly TableColumn[];
    /** Server order. */
    readonly rows: readonly TableRow[];
}

export interface TreeNode {
    /** JSON.stringify([rowKey, ...segments]); segments are field strings or array index numbers. */
    readonly key: string;
    readonly parentKey: string | null;
    /** Document root = 0; aria-level = depth + 1. */
    readonly depth: number;
    readonly field: string;
    readonly value: GridCellValue;
    /** True only if children exist; false for arrays over the expansion cap. */
    readonly expandable: boolean;
}

export function getCell(row: TableRow, key: ColumnKey): GridCellValue | undefined {
    return Object.prototype.hasOwnProperty.call(row.cells, key) ? row.cells[key] : undefined;
}
```

The prefix is injective for any raw field, including `''`, `__proto__`, `constructor`, `root:_id`
and `rdg-select-column`; it does not make a field discoverable if the SchemaStore does not emit it.

```typescript
// documentIdentity.ts (Document is the driver document type)
export interface PageRowIdentity {
    readonly rowKey: string;
    readonly documentId?: string;
}
export function toDocumentId(document: Document): string | undefined;
export function isIdentityTrustedForProjection(projection: Document | undefined): boolean;
export function assignRowIdentities(documents: readonly Document[], identityTrusted: boolean): PageRowIdentity[];

// toTablePage.ts
export function toGridCellValue(value: unknown): GridCellValue;
export function toTablePage(
    documents: readonly Document[],
    path: readonly string[],
    headers: readonly string[],
    identityTrusted: boolean,
): TablePage;

// toTreeNodes.ts
export function toTreeNodes(documents: readonly Document[], identityTrusted: boolean): TreeNode[];
```

**Host invariants:**

- `toDocumentId`: require an own `_id` and reject `undefined`, array, regexp, DBRef, Map and unknown
  root types. In plain objects/arrays at any depth, reject own `$`-prefixed keys, `undefined` values
  and invalid dates. Require successful canonical `EJSON.stringify(id, { relaxed: false })` and
  exact reserialization after the existing default `EJSON.parse`. This is intentionally
  conservative: identity is withheld when the current action parser cannot preserve the value.
  Cover `0`, `false`, `''`, `null`, ObjectId, UUID, Long, Decimal128, Date and composite IDs in the
  round-trip matrix; do not assume all numeric subtypes survive the existing parser.
- An absent/empty projection or one with no `_id`/`_id.*` field preserves identity provenance.
  A simple boolean or numeric flag for `_id` is allowed, but exclusion still leaves no own ID.
  An expression, string, sub-projection, dotted `_id.*` key or parse failure withholds identity.
  `ClusterSession.runFindQueryWithCache` derives and stores the flag with the cached page, using
  the same Loose `parseShellBSON` semantics as `ClustersClient.runFindQuery`, and clears it with
  the documents.
- Only an ID occurring exactly once on the page gets `id:` plus canonical EJSON. Rows with
  missing, untrusted, non-round-tripping or duplicate IDs get `pos:` plus the row index and no
  `documentId`. Position keys are scoped to the page and never reused as action targets. This
  does not establish uniqueness across pages or shards.
- Table cell formatting preserves BSON keys; arrays are `array[N]`. Formatter failure leaves
  the cell's text blank, not the page failed; use repository-standard diagnostics without
  including user values. Use SchemaStore headers, excluding `_id`, after the dedicated root
  column. The root cell displays an own `_id` even when non-actionable. Walk only own object
  fields; at a missing path retain the root row and ID. Nested `_id` remains hidden (O1).
- Tree shaping emits parents before children in proposed document order (O2), with today's
  root-label algorithm (`null` → `null`, ObjectId → hex, missing → empty, otherwise JSON).
  Roots and objects use `{...}`, arrays use `(elements: N)` and emit children only for N ≤ 10.
  Array labels are `field[i]`; other values use `toGridCellValue`. Tree has no document actions.
  At depth 0 the view labels the type `Document`; elsewhere it maps the BSON key to its
  existing display name.

```typescript
// ClusterSession.ts
getCurrentPageAsTable(path: string[]): TablePage;
getCurrentPageAsTree(): TreeNode[];

// DataViewPanelTable.tsx
interface DataViewPanelTableProps {
    readonly page: TablePage | undefined;
    readonly selectedRowKeys: readonly string[];
    readonly onSelectedRowKeysChange: (rowKeys: readonly string[]) => void;
    readonly onStepIn: (rowKey: string, columnKey: ColumnKey) => void;
}

// DataViewPanelTree.tsx
interface DataViewPanelTreeProps {
    readonly nodes: readonly TreeNode[];
}

// TypedValueCell.tsx (WI-6)
interface TypedValueCellProps {
    readonly value: GridCellValue | undefined;
    readonly isRootId: boolean;
}

// collectionViewContext.ts
// dataSelection: { readonly selectedRowKeys: readonly string[] }
export interface DocumentTarget {
    readonly rowKey: string;
    readonly documentId: string;
}
export function resolveDocumentTargets(
    page: TablePage | undefined,
    selectedRowKeys: readonly string[],
): DocumentTarget[] | undefined;

// CollectionView.tsx
interface QueryResults {
    tablePage?: TablePage;
    treeNodes?: TreeNode[];
    jsonDocuments?: string[];
    documentCount?: number;
}
```

**Webview invariants:**

- Apply a table response only for the latest request token. On successful page replacement,
  clear selected row keys and disable document actions together; also clear table selection on
  view switch and table unmount. `resolveDocumentTargets` fails closed if any selected key is not
  actionable on the current page. Add stays available; View/Edit require one target, Delete at
  least one. The proposal excludes non-actionable rows from selection (O4).
- On Delete, snapshot the requested IDs, not the positions, before the RPC. On acknowledgement,
  remove current rows matching that snapshot, subtract only their keys from the current selection,
  and recompute toolbar state. An intervening selection of other documents survives.
- Step-in reads the current page and path from refs; require matching paths, a current row and a
  non-root column whose cell type is `object`. Decode the raw field and append that one path
  segment. No `_id`, arrays, Map or DBRef. Keep the `stepIn` telemetry event, source
  `step-in-button` and `depth`; both double-click and the G1 key use it.
- `value === undefined` renders the existing missing-cell treatment and tooltip. Null stays a
  real typed value.

**Consumer migration:**

| Consumer | Change |
| --- | --- |
| `src/documentdb/ClusterSession.ts` | Replace the shaper imports and `TableDataEntry`/`TableData` exports; shape the cached page with its identity trust state. |
| `src/webviews/documentdb/collectionView/collectionViewRouter.ts` | `getCurrentPageAsTable` keeps `z.array(z.string())` input and returns `TablePage`; `getCurrentPageAsTree` keeps no input and returns `TreeNode[]`. JSON and action RPCs keep their names and inputs. |
| `CollectionView.tsx`, `collectionViewContext.ts` | Update result/context state, RPC response handling, selection, command handlers, step-in and grid props. Remove the webview's extra root header injection. |
| `DataViewPanelTable.tsx`, `DataViewPanelTree.tsx`, new `TypedValueCell.tsx` | Consume neutral props. `ToolbarDocumentManipulation.tsx` and `ToolbarTableNavigation.tsx` keep their current context interface for commands and path. |
| Document commands and data access | `viewDocumentById`, `editDocumentById`, `deleteDocumentsById`, `vscode-documentdb.command.internal.documentView.open`, `documentsViewRouter.getDocumentById`, `ClustersClient` action methods and `parseDocumentId` keep their current contracts. Any O5 change is separate. |
| `build/verification/browser/fixtures.ts` | `CollectionOutputs['getCurrentPageAsTable']` mock becomes `TablePage`; e.g. a string ID is `'"stage0-1"'`. WI-3b supplies `TreeNode[]` and relevant identity/field edge cases once scope is agreed. |
| Existing shaper tests and docs | Move table/tree tests to the new filenames; add the focused identity matrix. WI-11 updates the still-relevant architecture skill and `slickgrid-removal.md`. |

**Differences from the sketch/current implementation:** root ID display already lives in the
root cell, so the actionable ID is `documentId?: string` rather than a second display-bearing
object. Headers currently come from SchemaStore, not a one-page union. The tree currently uses
display names as its type values. SlickGrid initializes Field-ascending sibling sorting even
though [parity R06](../migration-parity.md#3-tree-view-is-a-separate-release-gate) describes sorting
as disabled. Falsy IDs are dropped today; missing IDs can reach the action path as an empty string.
The late delete handler uses current instead of requested selection. Action identity also depends
on projection provenance, parser round trips and match semantics, not merely serialization.

**Choices left open for G1/E5 (not approved by A1):**

| Option | Decision |
| --- | --- |
| O1 | Keep the current hidden nested `_id` (recommended), or show it separately with a distinct label (E5). |
| O2 | Preserve current Field-ascending sibling order (leader recommendation; no unrequested visible change), or approve the spec's document-order UI explicitly. The shaper can still emit preorder in either case. |
| O3 | Confirm the proposed K2 fail-closed cases for computed, ambiguous or unsafe IDs; otherwise specify a different safe policy. |
| O4 | Confirm non-actionable rows are not selectable (proposed), or allow inspecting them by selection without enabling actions. |
| O5 | The proposal leaves cross-page duplicates unguarded. Host-side current-page validation or stronger uniqueness safeguards affect the action boundary and need E5 approval. A count observed only after deletion is not a guard. If K2 covers such collections, resolve this before implementing their document actions. |

**A1 advisory verdict — approve (86%), `claude-opus-5.5`.** `toSlickGridTable.ts:41–69`,
`DataViewPanelTable.tsx:122` and `CollectionView.tsx:498–514,582,611` support the identity,
late-delete and step-in constraints. `ClustersClient.ts:1190–1243` uses `$in`, `findOne` and
`replaceOne` with upsert; `parseDocumentId.ts:39` uses default EJSON parsing, so a stable
presentation key alone is insufficient. The advisor identified risks in the BSON matrix,
cross-page uniqueness, SchemaStore field discovery and deep-tree payload size. The verdict
would strengthen with round-trip/payload evidence and weaken if G1 rejects the identity or
selection constraints. A1 reviews the **proposal**, not approval of O1–O5 or proof of runtime
parity.

> **Done (2026-11-26), commit `373373a0`:** advised (`claude-opus-5.5`, 86%): field keys
> and row identities have separate namespaces; the host alone shapes neutral results; the
> webview resolves actions against a current page. The proposal documents why a merely
> serializable `_id` is insufficient and leaves the visible/host-boundary choices to G1/E5.
> No tests added (spec only); whitespace check passed. Advisor usage: 336.7 AIU, 52 requests,
> 10m39s summed model time (host log).

**WI-0b: record the confirmed scope** · `gpt-6-luna` · after G1

- Owns: `decisions.md` entry 0003 (the confirmed M/K/D list, the gestures, the pin, the CI choice),
  and status of 0001–0002 set to "Accepted".

### Step 1

**WI-2a: neutral types** · `gpt-6-luna`

- Owns: the new types file from WI-1c only.
- Acceptance: compiles; no consumer changes.
- Check: `npx tsc --noEmit -p .`

**WI-4a: remove SlickGrid, add React Data Grid** · `mai-code-2` (fallback `gpt-6.1-terra`)

- Owns: `package.json`, `package-lock.json` (exact pin, approved registry), `vite.config.views.mjs`
  (`slickgrid` group → `react-data-grid` lazy chunk; `optimizeDeps`), `src/webviews/slickgrid.scss`
  (delete), `collectionView.scss` (its SlickGrid imports), `DataViewPanelTable.tsx` and
  `DataViewPanelTree.tsx` (replace with placeholders that keep today's props),
  `dataViewPanelTable.scss`, `hooks/useHideScrollbarsDuringResize.ts` (delete if unused),
  `QueryEditor.tsx` (its SlickGrid reference only), `tsconfig.json` (`allowSyntheticDefaultImports`,
  only if nothing else needs it), `build/verification/inspect.cjs`, `inspect.test.cjs`,
  `prove-inspection.cjs`, `build/verification/browser/fixtures.ts` (SlickGrid assertions only),
  `NOTICE.html` (dependency notice).
- Not: `src/utils/slickgrid/**`, `src/documentdb/ClusterSession.ts` (WI-2b).
- Acceptance: build green; L1 inspection green; the RDG chunk is lazy, like SlickGrid's was.
- Checks (stated explicitly, so they override Case 1): `npm run build`, the L1 inspection, and
  `npx vitest run build/verification/inspect.test.cjs`.

**WI-3a: scenario runner, keys and focus** · `mai-code-2` (fallback `gpt-6.1-terra`)

- Owns: `build/verification/browser/scenarios.ts` (step and assertion type unions only),
  `scenario-runtime.ts`, `scenario-playwright.ts`, `scenario-runtime.test.ts`, the `run-all` helper
  source, `build/verification/README.md` (L2-dev vocabulary paragraph).
- Adds: steps `press` (key or chord on the focused element), `dblclick` (role and name), `focus`
  (role and name); assertion `focused` (the active element matches role and name, or a selector).
- Acceptance: unit tests for each new step and assertion; existing scenarios unchanged.
- Check: `npx vitest run --config build/verification/browser/vitest.config.ts build/verification/browser/scenario-runtime.test.ts build/verification/browser/scenarios.test.ts`

**WI-2b: host shaping and identity** · `gpt-6.1-sol` · after WI-4a and WI-2a

- Owns: `src/utils/slickgrid/**` moved to the WI-1c folder (with tests), `src/webviews/utils/slickgrid/typeToDisplayString.ts`
  moved likewise, `src/documentdb/ClusterSession.ts`, `collectionViewRouter.ts` (output types),
  `CollectionView.tsx` (data plumbing, `handleStepInRequest`, delete flow selection filter),
  `collectionViewContext.ts` (selection by key), the WI-4a placeholders' props,
  `build/verification/browser/fixtures.ts` (the `CellValue` import only).
- Not: `packages/documentdb-js-schema-analyzer/**` (BSON formatting stays there).
- Acceptance: identity rules from WI-1c; falsy and composite `_id` cases; heterogeneous columns;
  missing versus `null`; step-in by field key.
- Tests: update and extend the moved shaping tests.
- Check: `npx vitest run src/utils/<new folder>` and `npx tsc --noEmit -p .`
- Advisor: logic review before commit (persisted-data and cross-module impact).

**WI-4b: grid theme** · `mai-code-2` (fallback `gpt-6.1-terra`)

- Owns: a new `src/webviews/documentdb/collectionView/components/resultsTab/dataGridTheme.scss`
  mapping `--rdg-*` variables to VS Code tokens for light, dark and high contrast, including focus
  and selection (K10, D4, D10).
- Not: the grid components (WI-5 imports the file).
- Check: `npm run build`. Visual check happens in WI-5's scenarios and at G2.

**WI-3b: Collection View fixtures and scenarios** · `mai-code-2` (fallback `gpt-6.1-terra`) · after WI-2b, WI-3a, WI-4a

- Owns: a new `build/verification/browser/collectionViewFixtures.ts`, the `collectionView` entry in
  `scenarios.ts`, the `collectionView` fixture in `fixtures.ts`.
- Scenarios: `mixed-types`, `missing-vs-null`, `heterogeneous`, `deep-nesting`, `arrays`
  (0/10/11 elements), `page-500`, `html-values`, `empty`, `no-id` (a row without a trustworthy
  `_id`), `first-load`. Each in three themes (automatic).
- Acceptance: routes load; `data-ready` succeeds against the placeholders.

**WI-3c: `TDD:` contract checks** · `gpt-6.1-sol` · after WI-3b

- Owns: assertions and steps on the WI-3b scenarios, and `scenarios.test.ts` cases; CI workflow
  only if G1 chose CI (E5 then covers the push).
- One check per confirmed **M** and **K** row, written as a user outcome through roles and ARIA
  (`grid`, `treegrid`, `row`, `gridcell`, `aria-selected`, `aria-expanded`, `aria-level`), never
  RDG class names. Suite names start with `TDD:` so later items cannot weaken them (E3).
- Include the partner regressions from iteration 1 (one selected row treated as none; stale results
  acting on another collection) and the WI-7 edge cases (no-`_id` row is never a target; a late
  delete acknowledgement does not touch a newer selection).
- Acceptance: A3.

**WI-9a: tree keyboard spike** · `gpt-6.1-sol` · scratch worktree, throwaway

- Build the smallest treegrid on RDG at the pinned version over `TreeNode[]`: flattened visible rows,
  expansion state, `aria-level`, `aria-expanded`, Right/Left expand and collapse, Left on a child
  moves to its parent.
- Output: A4 evidence (Playwright run in the dev server) and a short note of the RDG APIs used. The
  code is not committed; WI-9 may reuse it.

### Step 2

Each item ends at its automated gate. The leader runs `npm run build` and the browser suite
through `mai-code-2-flash` after each pair of items, not after every commit.

**WI-5: table core** · `mai-code-2` (fallback `gpt-6.1-sol`)

- Owns: `DataViewPanelTable.tsx`, `dataViewPanelTable.scss`, `LoadingAnimationTable.tsx` if needed.
- Scope rows M3, M6, K3, K4, K9, K11; D1–D3, D5–D6. Plain text cells until WI-6 lands.
- Acceptance: A5.

**WI-6: typed value cell** · `mai-code-2` (fallback `gpt-6.1-terra`)

- Owns: a new `TypedValueCell.tsx` with a jsdom test. Last step, after WI-5 commits: wire it into
  `DataViewPanelTable.tsx` (one-line change, declared in the prompt).
- Scope rows K5–K8; D8. Text only, never HTML (K8).
- Acceptance: A5.

**WI-7: selection and document actions** · `gpt-6.1-sol` · after WI-5

- Owns: `DataViewPanelTable.tsx` (selection), `CollectionView.tsx` (delete flow and its
  acknowledgement), `collectionViewContext.ts`, `ToolbarDocumentManipulation.tsx` if its enabled
  logic moves.
- Scope rows K1–K2; D9. Gestures as released at G1.
- Acceptance: A6, including the advisor's logic review (lifecycle and data-loss risk).

**WI-8: step in and out** · `mai-code-2` (fallback `gpt-6.1-sol`) · after WI-7

- Owns: `DataViewPanelTable.tsx` (double-click and key), `CollectionView.tsx`
  (`handleStepInRequest`), `ToolbarTableNavigation.tsx`.
- Scope rows M1–M2, M7. Telemetry kept.
- Acceptance: A7.

**WI-9: accessible document tree** · `gpt-6.1-sol` · after WI-6 and A4; beside WI-7/WI-8

- Owns: `DataViewPanelTree.tsx`, a new tree hook file and its tests. It must not touch
  `CollectionView.tsx`; if it needs to, it stops and asks.
- Scope rows M4–M5; D7.
- Acceptance: A8, including the advisor's logic review. Two failures of A8: E1.

### Step 3

Leader runs A9 through `mai-code-2-flash`, then raises **G2**. After release: WI-G2-n items, each
with a model chosen by the same rules; then the draft PR push if authorised.

### Step 4

**WI-10: automated sweep** · `mai-code-2` (fallback `gpt-6.1-sol`), runs by `mai-code-2-flash`

- Every confirmed **M** and **K** row in three themes; keyboard-only journeys for table and tree;
  emulated forced colours; narrow width and zoom; no console errors or CSP violations; L1 and L3.
- Output: a "Sweep report" section in this document, verified and not verified, for G3.

**WI-11: clean-up and documentation** · `gpt-6-luna`

- Owns: this feature's `README.md` and a new `design.md`; the SlickGrid notes in
  `docs/ai-and-plans/features/e2e-testing/strategy.md`, `build/vite/README.md`,
  `build/verification/README.md`, `.github/skills/react-webview-architecture/**`; release notes
  (through the `writing-release-notes` skill).
- Not: `CHANGELOG.md` history and older release notes.

**WI-12: AI pre-review** · `gpt-6-astra`, then `claude-opus-5.5` in a fresh context

- CONTRIBUTING §6.1 stages 1–4 into `iterations/03-rdg-migration-review.md`. Stage 1 by
  `gpt-6-astra`; Copilot reviewer comments merged from the draft PR; validation and independent
  sweep by `claude-opus-5.5`, which must not reuse its advisor context.
- Then **G3a**.

## Open decisions

_At G1:_ the scope rows; the pin; on-demand or CI checks; the provisional gestures and step-in
key; C1–C8. The model table is already set by the operator (`mai-code-2` for standard coding,
`mai-code-2-flash` for checks). Step 0 has no `mai-code-2` coding item, so G1 only shows how
`mai-code-2-flash` handled WI-1's checks.

_At G2:_ the gestures (confirm); the look; the draft PR push; whether `mai-code-2` keeps its
items in Step 4, based on its Step 1 and 2 results and the fallbacks recorded so far.

_At G3a:_ each review finding.

## Evaluation: `/lead` or Copilot Fusion

### What Fusion is

Copilot Fusion is not a single model. It is a router and orchestrator that, **for each prompt**,
picks one or more models and combines their output
([About Copilot Fusion](https://docs.github.com/copilot/concepts/models/copilot-fusion)). It
uses three patterns:

- **Single:** one model answers.
- **Cascade:** a cheaper model drafts, a judge checks it, and the prompt escalates to a stronger
  model only if the draft fails.
- **Critique:** one model drafts, several models critique it in parallel, and the draft is revised.

The effort level sets how much of this it does: Standard usually uses one model, High is for
substantial, well-scoped tasks, Max for the deepest reasoning. It is billed per model used, at
each model's normal rate. It has no context window of its own: a prompt is limited by the smallest
window among the models it uses. It shows only the final answer. In this host it is likely the
`hydrafusion` and `hydrafusion-max` model IDs (our assumption, not documented).

### How it compares

Fusion and `/lead` work at different levels. Fusion decides **how to answer one prompt**. `/lead`
decides **how to run a plan**: which item comes next, who writes it, who checks it, when to stop
for the operator, what gets committed. Fusion does not replace that; in this plan, it would either
be the leader's session model or a coding model for one item.

| Criterion                                  | `/lead`                                                                                                          | Fusion as the session model (high/max)                                                                              |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Gates and always-ask rules                 | Built in: prominent gate messages, park-and-continue, never infers approval                                      | Must be restated in the prompt and kept up over a long run                                                          |
| One commit per item, done notes            | Built in, recorded in this document                                                                              | Possible, but by instruction only                                                                                   |
| File ownership and parallel lanes          | Built in; the lanes above map directly onto its rules                                                            | Sequential in practice, or ad hoc subagents without ownership rules                                                 |
| Independent review                         | Advisor from another vendor reviews WI-2b, WI-7, WI-9 logic, with a fixed role and a recorded verdict            | Critique gives several models per prompt, but internally: we see neither the critiques nor which models ran         |
| Model choice                               | Fixed per item by the operator (this plan); measured afterwards per model and role                               | Chosen per prompt by Fusion; cannot be pinned per item, so the `mai-code-2` comparison cannot be made               |
| Context over about 20 items and 4 gates    | Leader keeps a small context; state lives in this document; a fresh session per step is supported                | One growing context full of Playwright and build output, capped by the smallest model Fusion picks; compaction risk |
| Cost visibility                            | Per-model, per-role AIU from `agent-stats.mjs`; the last measured run (4 items) cost 1157 AIU, 86 % in subagents | Not measured here; High and Max may run several models on every prompt, including builds and docs                   |
| Quality on the two hard items (WI-7, WI-9) | Sol with Opus review; one advisor-guided retry, then E1                                                          | Likely its strongest case: Critique and Max are built for single hard problems                                      |
| Cheap models for mechanical work           | Yes: Luna for docs, `mai-code-2` for standard coding, `mai-code-2-flash` for checks (operator override)          | Only if Fusion chooses them; Cascade may, but we cannot require it                                                  |

Fusion and `/lead` also overlap: `/lead` already has tiers (cheap models for simple work) and an
advisor (a second model that judges). Running Fusion as the leader would add a second layer of
routing on top of the skill's own, on every leader turn, mostly for coordination work that does not
need it.

### Recommendation

**Run it with `/lead`**, `gpt-6.1-sol` as leader and `claude-opus-5.5` as advisor, with the
operator's model table above. Use Fusion where a single hard prompt is the problem:

1. **E1 escalation:** if WI-9 or WI-7 fails its gate twice, the operator names `hydrafusion-max` as
   the coding model for that item. The skill requires this to be the operator's call.
2. **Optional second opinion at G1:** run `hydrafusion-max` read-only on the WI-1c interface spec
   if the advisor's confidence is below 90 %. A Critique-style review of one spec is what it is for.
3. **Debugging a gate that fails for an unclear reason,** in a separate session the operator starts,
   with the failure output pasted in.
4. **Not as leader,** and not as a coding model for routine items: it would hide which model wrote
   each item and break the `mai-code-2` measurement.

### `/lead` prompt

One session per step, so each starts with a small context. Step 0:

```text
/lead advisor: claude-opus-5.5 docs/ai-and-plans/features/data-grid/iterations/02-rdg-execution-plan.md

Run Step 0 only (WI-0a, WI-1, WI-1c, then A1) and stop at G1. Do not start WI-0b before I release G1.

Models are operator-named and binding. Use the "Per-item model assignment" table in the plan as
written: it overrides the skill's tiers. Do not ask the advisor for model recommendations and do
not change an item's model. Consult the advisor only for the technical gates and reviews the plan
names (WI-1c, A1, the logic reviews), not for model choice.
- Standard coding: mai-code-2. If a mai-code-2 item fails its acceptance and one corrective turn
  does not fix it, rerun it on the item's named fallback and record the substitution in its done
  note. A call that fails before doing any work is retried once on the same model.
- Checks, builds, Vitest, browser scenarios, L2-dev run-all, packaging and exploration:
  mai-code-2-flash. If it cannot drive Playwright or misreports a result, use gpt-6.1-terra.
- Never use hydrafusion, hydrafusion-max or gpt-6.2-sol unless I name them (E1 only).
- Reasoning effort: host default.

Gates: raise G1 with the plan's gate message. Silence is not approval; only "G1 released" releases
it. Automated gates are yours to release, with evidence in the done note. Escalations E1-E5 come to
me.

One commit per item, done notes inline in the plan. Do not push. At the end, report usage per model
and role.
```

Later sessions keep everything after the first paragraph and replace it with:

- **Step 1:** "G1 is released (see the G1 record in the plan). Run WI-0b, then Step 1, and stop at
  A3/A4 with the WI-9a spike result."
- **Steps 2 and 3:** "Run Step 2, then A9, and stop at G2."
- **Step 4:** "G2 is released. Run the WI-G2 items, then Step 4 (WI-10, WI-11, WI-12), and stop at
  G3a."

# Outcome

Step 0 complete; stopped at **G1**, not released. Only documentation was committed, on
`dev/tnaum/table-redesign`. `feature/rdg-migration` remains at its local `main` base, with no
product code changes. Verified: published artifacts, scratch Chromium 142/148 behavior, Vite
CSS delivery and the packaged-theme caveat. Not verified: installed VS Code 1.109.0, a real
collection, screen readers and high-contrast. The package pin, final scope and operator-visible
behavior have not been approved. No Step 1 work has begun.
