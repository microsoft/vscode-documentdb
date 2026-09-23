---
feature: settings
kind: decisions
status: active
created: 2026-09-23
---

# Settings — Decisions

> How the setting groups were chosen, which renames were rejected and why, and how a rename is
> handled when the operator explicitly accepts resetting old customizations.

| #    | Decision                                                       | Status   | Changed from the proposal?                            | Date       | PR  |
| ---- | -------------------------------------------------------------- | -------- | ----------------------------------------------------- | ---------- | --- |
| 0001 | No group title may equal the extension `displayName`           | Accepted | Accepted as proposed                                  | 2026-09-23 | —   |
| 0002 | Group titles mirror key namespaces, one group per feature area | Accepted | Accepted as proposed                                  | 2026-09-23 | —   |
| 0003 | Rename only where a key actively misleads                      | Accepted | Reversed the agent's own earlier proposal             | 2026-09-23 | —   |
| 0004 | `confirmationStyle` → `style` is worth the rename after all    | Accepted (modified) | Rename retained; migration superseded by D0008 | 2026-09-23 | 957 |
| 0005 | Setting IDs live outside `ext`                                 | Accepted | Added mid-implementation, not in the plan             | 2026-09-23 | —   |
| 0006 | Port settings are `machine-overridable`, not `machine`         | Accepted (modified) | Scope retained; remote compatibility loss accepted in D0008 | 2026-09-23 | 957 |
| 0007 | Every non-deprecated property carries an explicit `order`      | Accepted | Accepted as proposed                                  | 2026-09-23 | —   |
| 0008 | Accept default resets instead of settings migration | Accepted | Operator rejected compatibility overhead after review | 2026-09-23 | 957 |

> Entries below are **semantically** immutable: append new entries rather than rewriting old ones,
> and record reversals as a new entry plus a status change above. Heading text is frozen once
> written — a retitle means a new decision.

**Status vocabulary** (closed set of seven):

`Proposed` · `Open` · `Accepted` · `Accepted (modified)` · `Deferred` · `Superseded by D#` ·
`Rejected`

---

## 0001 — No group title may equal the extension `displayName`

**Status:** Accepted · **Date:** 2026-09-23 · **Raised by:** operator report that "other extensions have settings that are expandable groups and this seems not to be happening to me"

### Question

The extension contributed two configuration nodes, titled `DocumentDB for VS Code` and
`Accessibility`. The Settings editor showed 22 of 23 settings as one flat list. Why?

### Decision

A configuration node's `title` must never equal the extension's `displayName`. Enforced by
`settingsContributions.test.ts`.

### Reasoning

`createTocTreeForExtensionSettings` contains an explicit special case: when a child entry's label
matches the extension root's label, that child's settings are pushed onto the parent as _ungrouped_
settings and the child disappears as a node. The first configuration node was titled exactly
`DocumentDB for VS Code`, so it hit that branch and its settings were hoisted.

This reads as "grouping does not work for my extension". It is a one-line fix, but it is invisible
without reading VS Code's source, so it is worth a permanent test rather than a comment.

### Rejected alternatives

- **Rename the extension's `displayName`.** Absurd for a Settings-editor layout bug, and it is a
  Marketplace-visible identity.
- **Leave one group and accept the flat list.** A single configuration node renders as a flat leaf
  with no expand arrow at all, which is the same problem in a different shape.

---

## 0002 — Group titles mirror key namespaces, one group per feature area

**Status:** Accepted · **Date:** 2026-09-23

### Question

23 settings across how many groups, split on what axis?

### Decision

Eight groups, each owning a key namespace: General (`confirmations.*`, `userInterface.*`),
Connections & Discovery (`local.*`, `serviceDiscovery.*`), Queries & Results (`batchSize`,
`collectionView.*`), Copy & Paste, Query Playground, Interactive Shell, AI Assistant, Accessibility.
Each node gets an explicit `order` in tens.

### Reasoning

Aligning the group title with the key prefix means the answer to "which group does my new setting
go in?" is mechanical — read the key prefix — rather than a judgement call. It also makes the TOC
label and the `Category:` prefix rendered in the list agree with each other.

`order` in tens rather than ones so a group can be inserted later without renumbering. Explicit
rather than omitted because children with `undefined` order sort last in an arbitrary relative
position.

### Rejected alternatives

- **Split by setting type or by frequency of use** (a "Commonly used" group). Both require a
  judgement call per setting and go stale as usage changes.
- **Keep `batchSize` in its own group or in General.** It is shared by the Playground and the Shell,
  so it has no single feature owner; grouping it with `collectionView.defaultPageSize` under
  "Queries & Results" puts the two "how many documents do I get at a time" settings together.

---

## 0003 — Rename only where a key actively misleads

**Status:** Accepted · **Date:** 2026-09-23 · **Raised by:** operator question "what does that mean to the user, do they see old and new keys in their settings?"

### Question

An initial pass proposed ten key renames to tidy the namespace: `documentDB.batchSize` →
`documentDB.query.batchSize`, `documentDB.local.port` → `documentDB.connections.local.port`, the
five `aiAssistant.*PromptPath` keys under an `aiAssistant.prompts.*` sub-namespace, and others.
Which are worth a breaking change?

### Decision

Almost none. Only two keys were renamed (see D0004 and below); every namespace-deepening rename was
dropped.

### Reasoning

Two findings killed them, and both were discovered only by reading VS Code's source:

1. **Grouping needs no renames at all.** Which group a setting appears in is decided purely by which
   node's `properties` object lists it. The key has no influence. The entire original complaint was
   fixable with zero breaking changes.
2. **Extra key segments make labels worse.** `trimCategoryForGroup` only strips the category prefix
   when it matches the group id, which for extension settings it never does. So
   `documentDB.batchSize` renders as "Document DB: Batch Size" and `documentDB.query.batchSize`
   would render as "Document DB › Query: Batch Size" — longer and more redundant, for no gain.

That leaves a rename justified only when the key itself is actively misleading. It was for
`documentDB.experimental.enableAIQueryGeneration`: encoding lifecycle in the key means graduating
the feature forces a second rename, and the `tags: ["experimental"]` already present is what
actually drives the UI badge and the sort-to-bottom behaviour.

### Rejected alternatives

- **Rename everything and take one breaking change while we're here.** Each rename costs a
  permanently registered deprecated key, a migration path, and a period where a user who customised
  the setting sees both entries. Paying that for a cosmetic tidy-up is a bad trade.
- **`userInterface.ShowOperationSummaries` → `showOperationSummaries`.** A real convention violation
  (every other key is camelCase), but it renders identically either way, so it is invisible to users.
  Left alone.

---

## 0004 — `confirmationStyle` → `style` is worth the rename after all

**Status:** Accepted · **Date:** 2026-09-23 · **Raised by:** operator: "I'm fine with renaming the confirmationStle to style"

### Question

D0003's reasoning recommended dropping `documentDB.confirmations.confirmationStyle` →
`documentDB.confirmations.style` as cosmetic. The operator overruled it.

### Decision

Rename it, with the same shim-plus-migration treatment as the AI toggle.

### Reasoning

The rendered label is "Confirmations: Confirmation Style" — the stutter is visible to every user who
opens the group, not just to whoever reads the key. Unlike the namespace-deepening renames, this one
_shortens_ the label. With the migration machinery already being built for the AI toggle, the
marginal cost of a second entry is close to zero.

Recorded as its own decision rather than editing D0003 because the reversal is the interesting part:
the agent's cost model undervalued a label that every user sees.

---

## 0005 — Setting IDs live outside `ext`

**Status:** Accepted · **Date:** 2026-09-23 · **Raised by:** five test suites breaking mid-implementation

### Question

Consolidating scattered setting-ID string literals into `ext.settingsKeys` broke five unrelated test
suites with `Cannot read properties of undefined (reading 'hideCountPrefix')`. Patch the mocks, or
change where the constants live?

### Decision

Setting IDs moved to their own module, `src/settingsKeys.ts`, and were removed from `ext` entirely.
All 46 call sites across 21 files were migrated.

### Reasoning

`getCountPrefix()` is called from many tree items, and roughly 200 test files mock
`extensionVariables` with a partial `ext` object. Reading a setting ID through `ext` therefore makes
_any_ tree-item test fail for a reason unrelated to what it is testing, and the failure message
points at the setting, not at the mock.

`ext` is documented as variables "initialized in the activate() method". Setting IDs are
compile-time constants with no runtime state, so they never belonged there. Extracting them fixes
the whole class of breakage rather than the six instances of it.

### Rejected alternatives

- **Patch the six failing mocks with `jest.requireActual`.** Works today, but every future tree-item
  test pays the same tax, and the failure mode is confusing.
- **Keep `ext.settingsKeys` as a re-export of the new module.** The re-export does not help, because
  the mocks replace `ext` wholesale. It would leave two ways to do the same thing for no benefit.

---

## 0006 — Port settings are `machine-overridable`, not `machine`

**Status:** Accepted · **Date:** 2026-09-23

### Question

`documentDB.local.port` and the two Kubernetes port-forward settings are machine facts and should
not be committed to a workspace `.vscode/settings.json`. Which scope?

### Decision

`machine-overridable` for all three.

### Reasoning

`machine` scope stops VS Code reading the value from workspace settings entirely. Any user who had
already set one of these in a workspace file would silently lose it, with no warning and no
deprecation notice — the exact failure mode this whole iteration was trying to avoid elsewhere.

`machine-overridable` states the same intent (this is a per-machine concern) while continuing to
honour a workspace value. No silent break.

---

## 0007 — Every non-deprecated property carries an explicit `order`

**Status:** Accepted · **Date:** 2026-09-23

### Question

Before this work, 9 of 23 properties had an `order` and 14 did not. Standardise on all, or none?

### Decision

All non-deprecated properties carry an explicit `order` within their group. Enforced by
`settingsContributions.test.ts`.

### Reasoning

`sortSettings` places ordered settings first and falls back to alphabetical-by-key for the rest, so a
partially ordered group is not "mostly ordered" — it is visibly scrambled, which is what the old
single group looked like. Both extremes are self-consistent; "all" was chosen because several groups
have a genuine reading order (Interactive Shell: timeout, then paste, then display).

Deprecated properties are exempt: they are hidden from the editor unless configured, so their
position is irrelevant.

---

## 0008 - Accept default resets instead of settings migration

**Status:** Accepted · **Date:** 2026-09-23 · **Raised by:** operator response to PR #957 review

### Question

The review found that migration could move Remote User values into local User settings, mixed old
and new names could invert scope precedence, and `machine-overridable` excludes previously honored
local User values in remote windows. Add more compatibility logic, or accept the resets?

### Decision

Keep the two new names and read only those keys using ordinary configuration reads. Remove the old
contributions, legacy constants, fallback helper, migration service, and activation call. Do not
copy or clear existing settings files. When the new keys are unset, use `wordConfirmation` and
`false` for AI query generation.

Keep all three `machine-overridable` scopes. Accept that users whose local User values no longer
apply remotely will receive the existing defaults unless they configure Remote User or Workspace
values. No port migration or additional compatibility layer is needed.

### Reasoning

The operator explicitly accepts requiring users to revisit these preferences: the user base is
small and preserving these customizations does not justify the startup writes and scope-handling
complexity. Simpler reads remove the migration risks rather than adding machinery to manage them.

This supersedes D0004's shim-plus-migration treatment and D0006's claim of no silent compatibility
break. Their naming and scope choices remain accepted. D0003's earlier compatibility-cost argument
describes the original proposal; D0008 governs the two implemented renames.

### Rejected alternatives

- **Source-aware migration and scope-aware legacy fallback.** More logic and tests than this
  compatibility requirement warrants, with additional local/remote API constraints.
- **Undo the renames or port scope changes.** Not requested; the operator accepts the new defaults
  and the need for affected users to reconfigure.
- **Keep deprecated aliases indefinitely.** Unnecessary if old values are deliberately ignored.

The reference audit must include shell help, setting links, and warning messages. Historical release
notes and review records retain old names as historical evidence, not current configuration advice.
