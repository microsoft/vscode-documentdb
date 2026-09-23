---
feature: settings
kind: notes
status: active
created: 2026-09-23
verified: 2026-09-23
code:
  - src/settingsKeys.ts
  - src/settingsContributions.test.ts
  - package.json
---

# Settings

**Status:** active · **Verified:** 2026-09-23

> How the extension's settings are grouped in the Settings editor, how setting IDs are named and
> stored in code, and which compatibility resets were explicitly accepted for PR #957.

Every user-visible setting this extension owns is declared in `contributes.configuration` in
`package.json` and mirrored as a constant in `src/settingsKeys.ts`. This area exists because the
VS Code Settings editor derives its entire layout from the shape of that contribution, and the rules
it applies are not documented anywhere in the VS Code API reference.

## Code map

- `package.json` → `contributes.configuration` — the eight setting groups, their order and scope
- `src/settingsKeys.ts` — every setting ID this extension owns
- `src/settingsContributions.test.ts` — the contract that keeps the two in sync

## Architecture (intent — code is authoritative for behavior)

### The Settings editor builds its tree from the contribution, and the rules are unwritten

Three behaviours in `createTocTreeForExtensionSettings` (VS Code's
`src/vs/workbench/contrib/preferences/browser/settingsTree.ts`) govern how an extension's settings
appear. None are in the public contribution-point documentation, and all three are easy to trip.

1. **One configuration node produces a flat leaf.** No expand arrow, no sub-grouping.
2. **A node whose `title` equals the extension's `displayName` is not rendered as a child.** Its
   settings are hoisted onto the parent entry as "ungrouped" settings. This is the trap: it looks
   like grouping silently does not work.
3. **Children are sorted by node `order`, with `undefined` last** — only the outer per-extension
   list is alphabetised. Groups without an explicit `order` land in an arbitrary relative position.

Within a group, `sortSettings` puts `experimental`- and `preview`-tagged settings last, then sorts
by property `order`, then alphabetically by key. **Mixing ordered and unordered properties in one
group therefore scrambles it**: the ordered ones come first, the rest fall back to alphabetical.

### Setting labels always keep the `Document DB` prefix

The `Category: Label` text in the settings list comes from `settingKeyToDisplayFormat`, which strips
the category only when it matches the group id. For extension settings the group id is the group
title (or the extension id), never `documentDB`, so `trimCategoryForGroup` never matches and the
prefix survives. `documentDB.batchSize` renders as **Document DB: Batch Size**, and
`documentDB.shell.display.colorSupport` as **Document DB › Shell › Display: Color Support**.

The practical consequence, and the reason most of the proposed renames were rejected: **every key
segment you add lengthens the rendered label**. Deepening a namespace for tidiness makes the UI
worse, not better.

### Setting IDs do not live in `ext`

`src/settingsKeys.ts` is deliberately separate from `src/extensionVariables.ts`. Roughly 200 test
files replace `extensionVariables` with a partial `ext` mock; a leaf utility that reads
`ext.settingsKeys.foo` therefore fails in any suite that mocks `ext` for an unrelated reason. Setting
IDs are compile-time constants, not activation state, so they belong outside `ext`. See
[decisions.md D0005](./decisions.md).

The same hazard applies to `vscode` enums: never evaluate `vscode.ConfigurationTarget.*` at module
scope, or suites that stub the `vscode` module fail to load the file at all.

### Accepted compatibility resets

PR #957 renames these settings without aliases, fallback reads, or migration:

| Old key (ignored)                                        | Current key                                                        | Default            |
| -------------------------------------------------------- | ------------------------------------------------------------------ | ------------------ |
| `documentDB.confirmations.confirmationStyle`             | `documentDB.confirmations.style`                                   | `wordConfirmation` |
| `documentDB.experimental.enableAIQueryGeneration`        | `documentDB.aiAssistant.enableQueryGeneration`                     | `false`            |
| `documentDB.userInterface.ShowOperationSummaries`        | `documentDB.userInterface.showOperationSummaries`                  | `true`             |
| `documentDB.aiAssistant.findQueryPromptPath`             | `documentDB.aiAssistant.indexAdvisorFindPromptPath`                | `null`             |
| `documentDB.aiAssistant.aggregateQueryPromptPath`        | `documentDB.aiAssistant.indexAdvisorAggregatePromptPath`           | `null`             |
| `documentDB.aiAssistant.countQueryPromptPath`            | `documentDB.aiAssistant.indexAdvisorCountPromptPath`               | `null`             |
| `documentDB.aiAssistant.crossCollectionQueryPromptPath`  | `documentDB.aiAssistant.queryGenerationCrossCollectionPromptPath`  | `null`             |
| `documentDB.aiAssistant.singleCollectionQueryPromptPath` | `documentDB.aiAssistant.queryGenerationSingleCollectionPromptPath` | `null`             |
| `documentDB.shell.initTimeout`                           | `documentDB.connectionTimeout`                                     | `30` (was `60`)    |

`documentDB.connectionTimeout` is the only timeout setting. It covers connecting and
authenticating for both the Interactive Shell and the Query Playground (previously a hard-coded
30 s). Running queries have no extension-side limit; see [D0010](./decisions.md).

Readers use ordinary configuration reads of the current keys, preserving VS Code's normal scope
precedence. Old entries are left untouched in settings files but no longer affect behavior. Users
who customized them must configure the new keys again. Activation performs no rename writes or
migration-state updates. Keywords on the new properties still help users find their replacements.

The three connection/port settings retain `machine-overridable` scope. Remote windows no longer
read their local User values; users may need to configure Remote User or Workspace values instead.
Otherwise the existing defaults apply: port `10260`, strategy `matchRemote`, and base port `27100`.

The maintainer accepted these resets for the small user base instead of maintaining compatibility
machinery. This is specific to this change, not a blanket policy for future settings. See
[D0008](./decisions.md#0008---accept-default-resets-instead-of-settings-migration).

## Timeline

| Date       | PR  | What changed                                                                                                 | Docs                                                                |
| ---------- | --- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| 2026-09-23 | 957 | Eight groups; direct renames with accepted default resets; one connection timeout; setting IDs outside `ext` | [01-settings-regrouping.md](./iterations/01-settings-regrouping.md) |

## Decisions

See [decisions.md](./decisions.md). The load-bearing ones for future work are **D0002** (group
titles mirror key namespaces), **D0003** (rename only where a key actively misleads), **D0005**
(setting IDs stay out of `ext`), **D0008** (accepted resets without migration), and **D0010** (one
connection timeout, no query-execution timeout).

## Open gaps

- **`documentDB.aiAssistant.enablePromptCache` is read but never contributed.**
  `PromptTemplateService` reads it, so it always resolves to its hardcoded `true`. Either contribute
  it or drop the read; left untouched deliberately in the first iteration.
- **Setting descriptions are not localized.** `package.nls.json` holds only a placeholder, so every
  `description` in `contributes.configuration` is English-only. Converting them to `%key%` is a
  self-contained follow-up.
- **No automated check that the editor actually renders eight expandable groups.** The contract test
  asserts the contribution shape; confirming the rendered tree still needs a manual pass in the
  Extension Development Host.

## Reading order for newcomers

1. This README, particularly the three unwritten Settings-editor rules
2. [decisions.md](./decisions.md) — especially why most proposed renames were rejected
3. [01-settings-regrouping.md](./iterations/01-settings-regrouping.md) for the implementation log
