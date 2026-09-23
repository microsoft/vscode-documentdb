---
feature: settings
kind: iteration
status: active
created: 2026-09-23
---

# 01 — Settings regrouping

> Eight expandable groups in the Settings editor, nine renames with accepted default resets, one
> shared connection timeout, and setting IDs moved out of `ext`.

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
  of the old name. VS Code 1.105 searches descriptions but not property-level `keywords`, so old IDs
  must appear in descriptions to remain searchable on the minimum supported version.
- VS Code exposes no configuration-migration API to extensions; `registerConfigurationMigrations` is
  internal to core.

## Work items

### 1. Restructure `contributes.configuration` into eight groups

Done. Eight nodes — General, Connections & Discovery, Queries & Results, Copy & Paste, Query
Playground, Interactive Shell, AI Assistant, Accessibility — each with an explicit `order` in tens,
and every non-deprecated property carrying an `order` within its group (D0007). Added
`machine-overridable` scope to the three port settings (D0006).

**Review follow-up (D0008).** These scopes remain. The operator accepts that remote windows stop
honoring local User values for these settings and that affected users may need to reconfigure.

Also removed an em dash from the `shell.display.inlineHints` description, per house style on
generated labels.

### 2. Rename misleading or inconsistent keys

Initial implementation: `documentDB.confirmations.confirmationStyle` → `documentDB.confirmations.style` (D0004) and
`documentDB.experimental.enableAIQueryGeneration` → `documentDB.aiAssistant.enableQueryGeneration`
(D0003). Both old keys initially stayed registered with `markdownDeprecationMessage`.

The initial `src/services/renamedSettings.ts` used `inspect()` for fallback reads and copied values
to the new keys once per profile. This implementation was removed after review.

**Review follow-up (D0008).** The operator rejected the compatibility overhead. Removed the aliases,
legacy constants, fallback reads, migration service, and activation call. The three readers now use
only the new names. Unset values use `wordConfirmation` and AI query generation disabled. Old
settings files are neither rewritten nor cleaned up. See the author decisions in
[the review](./01-settings-regrouping-review.md).

**Deviation from the plan.** The original plan proposed ten renames. Eight were initially dropped
once the label-rendering behaviour was understood — see D0003 for the rejected list and reasoning.
The operator later chose to finish seven of those renames in the same release (D0009), including the
shared shell and Playground connection timeout (D0010). The final change therefore renames nine
settings. `confirmationStyle` was one the agent had recommended dropping and the operator kept
(D0004).

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

**Review follow-up.** Searched source, packages, API, tests, resources, and user documentation for
old names and compatibility helpers. No stale runtime references remained after removal. Shell
help, timeout links, paste prompts, and batch-size warnings refer to unchanged, valid setting IDs.
Old names in release history and prior design/review records remain intentionally.

### 4. Contract test

Done. `src/settingsContributions.test.ts`, 11 tests. It asserts no group title equals `displayName`,
that group titles and orders are unique and explicit, that every non-deprecated property has an
`order`, that `settingsKeys` and the package.json keys are the same set in **both** directions, that
every deprecated key is listed under `settingsKeys.legacy`, and that no em dash appears in any
setting title or description.

**Review follow-up.** The manifest tests now require every property to be ordered, no deprecated
aliases, and the expected new IDs and defaults. Existing confirmation tests now verify that only
the current key is read and that default versus explicit values select the expected prompt.

The both-directions assertion is the one that matters: it catches a setting added to package.json
without a constant, _and_ a constant left behind after a setting is removed.

## Outcome

**Verified before review follow-up.** `npm run prettier-fix`, `npm run lint` (0), `npm run build` (0),
`npx jest --no-coverage` (4223 tests, 276 suites, all passing), `npm run package` (0).

**Verified after D0008.** `npm run build` passed; focused Jest passed 8 suites, 263 tests, and
4 snapshots. A scan of 1,174 tracked source/resource files found no removed keys or legacy helper
references. Shell help, warnings, and setting links still refer to contributed IDs. Changes remain
uncommitted; the draft PR was not pushed or marked ready.

**Not verified.** That the Settings editor actually renders eight expandable groups. The contract
test asserts the contribution shape, which is what caused the original bug, but the rendered tree
was not confirmed in an Extension Development Host during this iteration. The original migration
was not exercised against a real profile and has now been removed under D0008.

**Left deliberately untouched.** `documentDB.aiAssistant.enablePromptCache` is read by
`PromptTemplateService` but has never been contributed in package.json, so it always resolves to its
hardcoded default. Flagged with a comment rather than silently contributed, since adding a
user-visible setting was not part of this work. Recorded as an open gap in the feature README.
