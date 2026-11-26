---
feature: data-grid
kind: decisions
status: active
created: 2026-11-26
---

# Data grid decisions

These are **proposals for G1, not accepted decisions**. No product or code changes are authorized
before G1 is released. The exact pin, confirmed scope, Playwright CI choice, gestures and step-in key
remain unresolved for the operator.

| #    | Decision                                              | Status   | Changed from the proposal? | Date       | PR  |
| ---- | ----------------------------------------------------- | -------- | -------------------------- | ---------- | --- |
| 0001 | React Data Grid, beta candidate and document tree     | Proposed | Pending G1                 | 2026-11-26 | —   |
| 0002 | Migration workflow and menus                         | Proposed | Pending G1                 | 2026-11-26 | —   |
| 0003 | Confirmed migration scope                            | Proposed | Intentionally unspecified  | 2026-11-26 | —   |

## 0001 - React Data Grid, beta candidate and document tree

**Status:** Proposed · **Date:** 2026-11-26

### Question

Which grid foundation and tree implementation should the migration use?

### Decision

Propose replacing SlickGrid with upstream React Data Grid, without a fork. Evaluate beta.64 as the
primary exact-pin candidate and beta.61 as the alternative; WI-1's published-package and runtime
checks and the operator's G1 decision must settle the exact pin. Neither version is approved or
declared runtime-compatible here.

Propose building the arbitrary-depth document tree in the application rather than treating RDG's
`TreeDataGrid` as a drop-in. Keep a grid-neutral boundary so another grid remains an option.

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

## 0002 - Migration workflow and menus

**Status:** Proposed · **Date:** 2026-11-26

### Question

How should the migration be organized, verified and integrate any grid menus?

### Decision

Propose one feature branch, with no SlickGrid/RDG coexistence; automation-first verification; and
native VS Code context menus for any grid menu that is later needed. Such menus use the
`webview/context` contribution, `data-vscode-context` on the target and host-executed commands, not
Fluent UI or grid-owned menus. The migration plan says it adds no menus; this rule applies if a menu
is introduced later. The leader creates the local branch in Step 0; implementation waits for G1.

### Evidence

- [Iteration 1 work organization](./iterations/01-rdg-migration-plan.md#how-the-work-is-organised)
  sets out the feature branch, no coexistence, automation-first verification and native-menu
  approach.
- [Iteration 2 WI-0a](./iterations/02-rdg-execution-plan.md#step-0) assigns drafting decisions to
  this entry and branch creation to the leader.

## 0003 - Confirmed migration scope

**Status:** Proposed · **Date:** 2026-11-26

### Question

Which proposed migration scope rows are confirmed?

### Decision

Placeholder only. At G1, the operator reviews each M, K and D row in the iteration 1 scope tables
and decides whether to keep it, move it to “RDG default” or drop it. Record the resulting scope here
after G1; this entry does not preselect any row.

### Evidence

- [Iteration 1 proposed scope and operator scope check](./iterations/01-rdg-migration-plan.md#scope-what-the-migration-replicates).
- [Iteration 2 G1 decisions](./iterations/02-rdg-execution-plan.md#g1-scope-pin-interfaces-gestures-operator-decision-gate)
  and [WI-0a](./iterations/02-rdg-execution-plan.md#step-0).
- [No-loss contract](./migration-parity.md), which inventories current behavior but does not itself
  determine the migration scope.
