---
feature: data-grid
kind: decisions
status: active
created: 2026-11-26
---

# Data grid decisions

G1 was released by the operator on 2026-11-26. These entries record the accepted decisions;
implementation remains subject to the planned work items and later gates.

| #    | Decision                                          | Status   | Changed from the proposal?                            | Date       | PR  |
| ---- | ------------------------------------------------- | -------- | ----------------------------------------------------- | ---------- | --- |
| 0001 | React Data Grid, beta candidate and document tree | Accepted | Exact pin and VS Code support floor finalized         | 2026-11-26 | —   |
| 0002 | Migration workflow and menus                      | Accepted | Playwright checks are on demand, not in CI            | 2026-11-26 | —   |
| 0003 | Confirmed migration scope                         | Accepted | M/K retained; D rows use RDG defaults; G1 choices set | 2026-11-26 | —   |

## 0001 - React Data Grid, beta candidate and document tree

**Status:** Accepted · **Date:** 2026-11-26

### Question

Which grid foundation and tree implementation should the migration use?

### Decision

Replace SlickGrid with upstream React Data Grid, without a fork, exact-pinned to
`react-data-grid@7.0.0-beta.64`. WI-4a installs the dependency; the pin is not yet installed.
Set the VS Code support floor to `^1.123.0`, committed in `a81d40fc`. The operator accepted the
shipped-release evidence and beta.64 standalone Chromium 148 smoke in lieu of an exact stable
1.123.0 workbench smoke; that workbench run was not done. No compatibility shim is required.

Build the arbitrary-depth document tree in the application rather than treating RDG's `TreeDataGrid`
as a drop-in. Keep a grid-neutral boundary.

Reopen the grid choice if SlickGrid's row selection and tree pass a future screen-reader check, if
RDG stalls or its API changes make exact pinning unworkable, or if the RDG tree or selection cannot
meet the accessibility gate after the planned retry.

### Evidence

- [Grid scorecard: priorities and conclusion](./grid-scorecard.md#our-priorities),
  [scorecard conclusion](./grid-scorecard.md#conclusion), and
  [sensitivity](./grid-scorecard.md#sensitivity).
- [RDG version recommendation and runtime caveats](./react-data-grid-capabilities.md#1-version-matters-more-than-the-beta-label-alone),
  [arbitrary document tree limitations](./react-data-grid-capabilities.md#3-available-library-features-that-are-not-cheap-database-features).
- [Tree parity contract](./migration-parity.md#3-tree-view-is-a-separate-release-gate).
- [Iteration 1 guiding rules](./iterations/01-rdg-migration-plan.md#guiding-rules) and
  [reversal trigger](./iterations/01-rdg-migration-plan.md#cross-cutting).
- [Iteration 2 G1](./iterations/02-rdg-execution-plan.md#g1-scope-pin-interfaces-gestures-operator-decision-gate)
  and [tree/selection escalation](./iterations/02-rdg-execution-plan.md#escalations).
- [Accepted VS Code 1.123.0 release evidence](./iterations/02-rdg-execution-plan.md#candidate-minimum-for-beta64)
  and [WI-4a support-floor change](./iterations/02-rdg-execution-plan.md#work-item-detail).

## 0002 - Migration workflow and menus

**Status:** Accepted · **Date:** 2026-11-26

### Question

How should the migration be organized, verified and integrate any grid menus?

### Decision

Use one feature branch, with no SlickGrid/RDG coexistence and automation-first verification.
Playwright contract checks run on demand only, not in CI. If a grid menu is later needed, use native
VS Code context menus with the
`webview/context` contribution, `data-vscode-context` on the target and host-executed commands, not
Fluent UI or grid-owned menus. The migration plan adds no menus; this rule applies if a menu is
introduced later.

### Evidence

- [Iteration 1 work organization](./iterations/01-rdg-migration-plan.md#how-the-work-is-organised)
  sets out the feature branch, no coexistence, automation-first verification and native-menu
  approach.
- [Iteration 2 WI-0a](./iterations/02-rdg-execution-plan.md#step-0) assigns drafting decisions to
  this entry and branch creation to the leader.
- [G1 decision](./iterations/02-rdg-execution-plan.md#g1-scope-pin-interfaces-gestures-operator-decision-gate)
  confirms on-demand Playwright checks.

## 0003 - Confirmed migration scope

**Status:** Accepted · **Date:** 2026-11-26

### Question

Which proposed migration scope rows are confirmed?

### Decision

Retain all M1–M7 and K1–K11 rows in the iteration 1 scope tables as requirements. Treat D1–D10 as
RDG defaults. The linked tables remain the definitions of those rows; this entry records their
accepted status.

Accept C1–C8 and the assigned per-item models as written in the G1 plan.

The exact pin is `react-data-grid@7.0.0-beta.64`, with VS Code minimum `^1.123.0`; Playwright
contract checks are on demand only, not in CI. The row gestures are provisional until G2: click
selects one row; Ctrl/Cmd+click or Space toggles; Shift+click or Shift+Space extends; Enter on an
object cell steps in. Shift+Arrow is future cell-range work (F-3), not part of this migration.

For O1–O5:

- **O1:** Keep the current nested root-`_id` presentation.
- **O2:** Keep tree siblings in Field-ascending order.
- **O3:** Withhold document actions when identity is not reliable.
- **O4:** All browsable rows remain selectable, even without a safe action target; selection does
  not imply action eligibility.
- **O5:** Cross-page/shard uniqueness mitigation is out of scope. Continue surfacing existing
  server errors, but do not promise duplicate documents will cause an error.

### Evidence

- [Iteration 1 proposed scope and operator scope check](./iterations/01-rdg-migration-plan.md#scope-what-the-migration-replicates).
- [Iteration 2 G1 decisions](./iterations/02-rdg-execution-plan.md#g1-scope-pin-interfaces-gestures-operator-decision-gate)
  and [WI-0b](./iterations/02-rdg-execution-plan.md#work-item-detail).
- [Accepted runtime and support-floor evidence](./iterations/02-rdg-execution-plan.md#candidate-minimum-for-beta64).
- [Accepted interface spec and O1–O5](./iterations/02-rdg-execution-plan.md#wi-1c-interface-spec).
- [No-loss contract](./migration-parity.md), which inventories current behavior but does not itself
  determine the migration scope.
