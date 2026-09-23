---
feature: settings
kind: iteration
status: active
created: 2026-09-23
---

# 01 — Settings regrouping

> Eight expandable groups in the Settings editor, two renames with migration, and setting IDs moved
> out of `ext`.

## Why

The operator reported that the extension's settings did not form expandable groups the way other
extensions' do, and asked whether 23 settings in essentially one list should be redesigned.

Both halves turned out to be true and, importantly, **independent**: the grouping failure had a
specific cause unrelated to how the settings are named, and the naming cleanup turned out to be
mostly not worth doing. See [decisions.md D0003](../decisions.md).

## What the investigation found

Read from VS Code source rather than documentation, because none of it is in the contribution-point
reference:

- `createTocTreeForExtensionSettings` hoists a group whose title equals the extension `displayName`
  onto the parent instead of rendering it as a child. That was the bug. (D0001)
- Group membership is decided by which node lists the property. **Keys are irrelevant to grouping.**
- `trimCategoryForGroup` never strips the `documentDB` prefix for extension settings, so every extra
  key segment lengthens the rendered label. (D0003)
- `createSettingsTreeGroupElement` hides deprecated settings unless the user configured them — and
  the same filter applies to search results, so a deprecation shim does not preserve discoverability
  of the old name. `keywords` on the new property does.
- VS Code exposes no configuration-migration API to extensions; `registerConfigurationMigrations` is
  internal to core.

## Work items

### 1. Restructure `contributes.configuration` into eight groups

Done. Eight nodes — General, Connections & Discovery, Queries & Results, Copy & Paste, Query
Playground, Interactive Shell, AI Assistant, Accessibility — each with an explicit `order` in tens,
and every non-deprecated property carrying an `order` within its group (D0007). Added
`machine-overridable` scope to the three port settings (D0006).

Also removed an em dash from the `shell.display.inlineHints` description, per house style on
generated labels.

### 2. Rename the two keys that actively mislead

Done. `documentDB.confirmations.confirmationStyle` → `documentDB.confirmations.style` (D0004) and
`documentDB.experimental.enableAIQueryGeneration` → `documentDB.aiAssistant.enableQueryGeneration`
(D0003). Both old keys stay registered with `markdownDeprecationMessage`.

`src/services/renamedSettings.ts` carries both halves: `getSettingWithLegacyFallback` reads through
to the old key using `inspect()` rather than `get()`, and `migrateRenamedSettings` copies the value
across and clears the old key once per profile.

**Deviation from the plan.** The original plan proposed ten renames. Eight were dropped once the
label-rendering behaviour was understood — see D0003 for the rejected list and the reasoning. One of
the two survivors, `confirmationStyle`, was one the agent had recommended dropping and the operator
kept (D0004).

### 3. Consolidate setting-ID literals

Done, then redone. 12 of 23 setting IDs were raw string literals scattered across the shell, the
Kubernetes plugin, the prompt-template service and `countPrefix`. All were consolidated into a
single constants surface so a rename is a one-file change.

**Deviation from the plan.** The plan put them in `ext.settingsKeys`. That broke five test suites,
because `getCountPrefix()` is reachable from many tree items and roughly 200 test files mock
`extensionVariables` with a partial `ext`. The constants were moved to their own module,
`src/settingsKeys.ts`, and removed from `ext` entirely — 46 call sites across 21 files. See D0005.

A second instance of the same hazard surfaced immediately afterwards: `renamedSettings.ts` evaluated
`vscode.ConfigurationTarget.*` at module scope, which broke a suite that stubs the `vscode` module.
Resolved by reading the enum inside functions. Both hazards are recorded in repository memory.

### 4. Contract test

Done. `src/settingsContributions.test.ts`, 11 tests. It asserts no group title equals `displayName`,
that group titles and orders are unique and explicit, that every non-deprecated property has an
`order`, that `settingsKeys` and the package.json keys are the same set in **both** directions, that
every deprecated key is listed under `settingsKeys.legacy`, and that no em dash appears in any
setting title or description.

The both-directions assertion is the one that matters: it catches a setting added to package.json
without a constant, _and_ a constant left behind after a setting is removed.

## Outcome

**Verified.** `npm run prettier-fix`, `npm run lint` (0), `npm run build` (0),
`npx jest --no-coverage` (4223 tests, 276 suites, all passing), `npm run package` (0).

**Not verified.** That the Settings editor actually renders eight expandable groups. The contract
test asserts the contribution shape, which is what caused the original bug, but the rendered tree
was not confirmed in an Extension Development Host during this iteration. The migration path
(existing value under an old key being moved onto the new key) was likewise not exercised against a
real profile — only its inputs are unit-covered.

**Left deliberately untouched.** `documentDB.aiAssistant.enablePromptCache` is read by
`PromptTemplateService` but has never been contributed in package.json, so it always resolves to its
hardcoded default. Flagged with a comment rather than silently contributed, since adding a
user-visible setting was not part of this work. Recorded as an open gap in the feature README.
