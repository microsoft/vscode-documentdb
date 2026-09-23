---
feature: settings
kind: notes
status: active
created: 2026-09-23
verified: 2026-09-23
code:
    - src/settingsKeys.ts
    - src/settingsContributions.test.ts
    - src/services/renamedSettings.ts
---

# Settings

**Status:** active · **Verified:** 2026-09-23

> How the extension's settings are grouped in the Settings editor, how setting IDs are named and
> stored in code, and how a rename is carried out without losing a user's value.

Every user-visible setting this extension owns is declared in `contributes.configuration` in
`package.json` and mirrored as a constant in `src/settingsKeys.ts`. This area exists because the
VS Code Settings editor derives its entire layout from the shape of that contribution, and the rules
it applies are not documented anywhere in the VS Code API reference.

## Code map

- `package.json` → `contributes.configuration` — the eight setting groups, their order and scope
- `src/settingsKeys.ts` — every setting ID this extension owns, including deprecated aliases
- `src/settingsContributions.test.ts` — the contract that keeps the two in sync
- `src/services/renamedSettings.ts` — legacy-key fallback reads and the one-time rename migration

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

### Renaming a setting

VS Code exposes **no** configuration-migration API to extensions —
`registerConfigurationMigrations` is internal to core. A rename therefore needs both halves:

- the old key stays registered with `markdownDeprecationMessage`, and reads fall back to it via
  `getSettingWithLegacyFallback` (which uses `inspect()`, because `get()` would return the new key's
  _default_ and silently beat the user's old value);
- `migrateRenamedSettings` copies the value onto the new key once per profile and clears the old
  one, so the user does not end up looking at both.

A deprecated setting is **hidden from the Settings editor unless the user has configured it**
(`createSettingsTreeGroupElement` filters on `isConfigured`). It is still offered in settings.json
IntelliSense, struck through — the shim does not hide the old name there, and it does **not** make
the old name findable in search. `keywords` on the _new_ property is what does that.

## Timeline

| Date       | PR  | What changed                                                                        | Docs                                                                |
| ---------- | --- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 2026-09-23 | —   | Eight expandable groups; two renames with shims; setting IDs extracted out of `ext` | [01-settings-regrouping.md](./iterations/01-settings-regrouping.md) |

## Decisions

See [decisions.md](./decisions.md). The load-bearing ones for future work are **D0002** (group
titles mirror key namespaces), **D0003** (rename only where a key actively misleads) and **D0005**
(setting IDs stay out of `ext`).

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
