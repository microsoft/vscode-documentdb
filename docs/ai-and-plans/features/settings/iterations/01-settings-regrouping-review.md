---
feature: settings
kind: review
status: active
prs: [957]
created: 2026-09-23
verified: 2026-09-23
code:
  - src/extension.ts
  - src/settingsKeys.ts
  - src/settingsContributions.test.ts
  - package.json
---

# PR #957: Settings Safety Review

Reviewed revision: `83445470`, against `origin/main`.

Initial review scope: contribution validity, module loading, activation, renamed-setting reads and
writes, configuration precedence, and compatibility of the changed scopes. Findings below describe
the reviewed revision; author decisions record the subsequent implementation.

## Author Decisions

On 2026-09-23 the operator accepted resetting these preferences rather than maintaining migration
and fallback logic, given the small user base. See [D0008](../decisions.md#0008---accept-default-resets-instead-of-settings-migration).

- **R1/R2 resolved by removal:** only the new keys are contributed and read. The legacy aliases,
  fallback helper, migration service, and activation call are deleted. Existing settings files are
  untouched. Unset new values use `wordConfirmation` and AI query generation off.
- **R3 accepted:** retain `machine-overridable`; affected remote users must revisit their settings.
  No additional migration or scope compatibility logic is requested.
- **Reference audit:** no stale old-key references in runtime code, shell help, or warnings.
  Historical release notes and design/review records intentionally retain old names.

## Findings

### R1: High - Remote migration moves values into local User settings

Original location: [renamedSettings.ts:96](https://github.com/microsoft/vscode-documentdb/blob/83445470/src/services/renamedSettings.ts#L96),
especially the copy and delete at lines 97 and 99.

`inspect().globalValue` merges local and remote User settings. However, VS Code resolves
`ConfigurationTarget.Global` separately for each key. For these window-scoped settings, an existing
remote override selects Remote User; a key without a remote override selects local User.

Reproduction in a Remote SSH/WSL window:

1. Local User has the old confirmation key set to `wordConfirmation`.
2. Remote User has the old confirmation key set to `buttonConfirmation`.
3. Neither scope has the new key.
4. Migration reads the merged `buttonConfirmation` value.
5. Writing the new key targets local User. Deleting the old key targets Remote User.

Result: the remote-only preference becomes a local preference, the remote override is deleted, and
the original local `wordConfirmation` preference is shadowed. The new local setting can also be
synced to other machines. The same problem affects the AI query-generation toggle. An existing new
local key is worse: migration can skip copying altogether and still delete the old remote override.

Validation: executed the PR's actual migration with the `toEditableConfigurationTarget` method
extracted from VS Code **1.105.0**, the minimum supported version. The recorded writes were:

```text
local User: set documentDB.confirmations.style = buttonConfirmation
Remote User: delete documentDB.confirmations.confirmationStyle
```

This is a targeted model using upstream routing code, not an Extension Development Host test.

Recommended: do not perform destructive global migration unless the source and destination stores
can be preserved. The supported API's merged global value is insufficient to establish that. For
this PR, deferring the renames is the smallest fully conservative option; grouping does not require
them. Retaining aliases without destructive writes avoids this particular mutation but still needs
careful mixed-name precedence handling. A source-aware migration is more complete but needs explicit
local/remote coverage and must not depend on unsupported VS Code internals.

Status: resolved by removal under D0008. Author decision: accept default resets; do not migrate.

### R2: Medium - New User values override legacy workspace values

Original location: [renamedSettings.ts:61](https://github.com/microsoft/vscode-documentdb/blob/83445470/src/services/renamedSettings.ts#L61),
with the persistent skip at [renamedSettings.ts:75](https://github.com/microsoft/vscode-documentdb/blob/83445470/src/services/renamedSettings.ts#L75).

The fallback resolves all scopes of the new key before considering any scope of the legacy key.
Consequently, new `globalValue` wins over old `workspaceValue`, reversing the normal workspace-over-
User priority.

An ordinary upgrade sequence makes this permanent:

1. A user has legacy User confirmation style `buttonConfirmation`.
2. The first activation migrates it to the new User key and marks the profile complete.
3. They open another workspace with legacy confirmation style `wordConfirmation`.
4. The profile-wide flag skips that workspace's migration.
5. Reads return User `buttonConfirmation`, ignoring the workspace's stronger confirmation policy.

Likewise, a legacy workspace `false` for AI query generation loses to a new User `true`.
This also occurs temporarily before migration and persists when a workspace is not writable.

Validation: ran the actual helper and migration against controlled configurations, retaining the
same global state while replacing workspace settings. Confirmed both the incorrect effective value
and the absence of any writes on the second activation.

Recommended: compare old and new values within each scope before moving to the next broader scope,
preferring the new name only at equal scope. Do not use one profile-wide completion flag to claim
all workspaces were processed. An idempotent per-activation migration avoids that bookkeeping;
separate workspace state is another option but still needs to handle later edits and Settings Sync.
Simply awaiting the current migration is insufficient because later workspaces remain skipped.

This contradicts the value-preservation intent in [the feature README](../README.md).

Status: resolved by removal under D0008. Author decision: read only the new names, without fallback.

### R3: Medium - Port scope changes discard existing local User values remotely

Original location: [package.json:1670](https://github.com/microsoft/vscode-documentdb/blob/83445470/package.json#L1670),
[package.json:1677](https://github.com/microsoft/vscode-documentdb/blob/83445470/package.json#L1677), and
[package.json:1695](https://github.com/microsoft/vscode-documentdb/blob/83445470/package.json#L1695).

The three connection/port settings change from default window scope to `machine-overridable`.
That preserves Workspace values, but not local User values in Remote SSH/WSL/dev-container windows.
VS Code filters machine-overridable settings out of local User configuration when a remote authority
is present. Remote User and Workspace settings remain supported.

For example, an existing local User `documentDB.local.port = 27017` was honored remotely before
this PR. With no Remote User or Workspace override, it now resolves to `10260`. Likewise, a local
User `autoSelect` strategy falls back to `matchRemote`, and a custom base port is lost. This can
cause connections to target the wrong port or fail.

Validation: extracted and executed VS Code 1.105.0's
`getLocalUserConfigurationScopes` with its actual scope arrays. Both default and named profiles in
remote windows include `WINDOW` but exclude `MACHINE_OVERRIDABLE`.

Recommended: keep the prior scopes for this grouping change, or explicitly design and communicate
the remote compatibility transition. If the only aim is to exclude these values from Settings Sync,
evaluate `ignoreSync` while retaining window scope; that avoids changing where values are read from.
The tradeoff is that window scope still permits the local User fallback in remote windows.

This narrows the compatibility claim in [decisions.md](../decisions.md): preserving Workspace values
does not preserve every previously supported configuration source.

Status: accepted compatibility tradeoff under D0008. Author decision: keep scopes and existing
defaults; affected users may need to revisit their settings.

## Initial Review: Initialization And Test Coverage

- No demonstrated module-load or activation crash was found. Setting constants are independent of
  activation state; the new module does not evaluate VS Code configuration enums at import time.
- Configuration-write failures run inside the telemetry/error wrapper with display and rethrow
  suppressed. A rejecting-update probe preserved the legacy value, left completion unset, and
  succeeded on retry. The installed wrapper implementation was inspected to confirm this behavior.
- The initial global-state read remains outside that wrapper. A synthetic throwing read rejects
  the fire-and-forget migration promise, but no realistic throwing-read scenario was established;
  this is a hardening consideration, not a validated crash finding.
- No committed tests directly exercise `getSettingWithLegacyFallback` or `migrateRenamedSettings`.
  The new manifest tests cannot catch R1-R3. The existing confirmation tests cover word selection,
  not configuration precedence.
- Add regression coverage for defaults, explicit `false`, mixed old/new scopes, multiple workspaces
  in one profile, local/remote User separation, failed copy, failed delete, and successful retry.

## Initial Review Verification

- `npm run build`: passed, including workspace builds.
- Focused Jest run: **5 suites, 174 tests, 4 snapshots passed**. Suites: settings contributions,
  confirmation word selection, shell PTY, Kubernetes port prompting, and prompt templates.
- In-memory review probes reproduced R1-R2. An upstream-code scope probe confirmed R3.
- GitHub inline review comments and submitted reviews: none present when checked.
- No real-profile migration, packaged-extension activation, or rendered Settings tree was tested.
  These results do not establish end-to-end startup safety.
- This is the initial review pass. CONTRIBUTING section 6's independent cross-vendor validation
  remains pending. No commit, push, or PR-state change was made.

## Follow-up Verification

- `npm run build`: passed, including workspace builds.
- Focused Jest: **8 suites, 263 tests, 4 snapshots passed**, covering settings contributions,
  confirmation reads, shell PTY/output/help/links, Kubernetes ports, and prompt templates.
- Scanned **1,174 tracked source/resource files**: no old setting IDs, legacy helpers, migration
  state, or `ext.settingsKeys` references. The six shell/help/warning setting IDs remain contributed.
- Editor diagnostics: no errors in changed code or manifest. Feature metadata and local links pass.
- No real Extension Development Host activation or rendered Settings tree was tested. No commit,
  push, or PR-state change was made. The original independent-review gap remains.

## Upstream Evidence

- [VS Code 1.105.0 configuration service](https://github.com/microsoft/vscode/blob/1.105.0/src/vs/workbench/services/configuration/browser/configurationService.ts):
  `toEditableConfigurationTarget`, `getLocalUserConfigurationScopes`.
- [VS Code 1.105.0 configuration scopes](https://github.com/microsoft/vscode/blob/1.105.0/src/vs/workbench/services/configuration/common/configuration.ts):
  `LOCAL_MACHINE_SCOPES`, `LOCAL_MACHINE_PROFILE_SCOPES`.
- [VS Code extension-host configuration](https://github.com/microsoft/vscode/blob/1.105.0/src/vs/workbench/api/common/extHostConfiguration.ts):
  merged User inspection and Global-to-User target conversion.
