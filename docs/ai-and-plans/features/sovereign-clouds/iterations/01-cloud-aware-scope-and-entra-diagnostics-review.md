---
feature: sovereign-clouds
kind: review
status: active
---

# Sovereign cloud connectivity: correctness review

- PR: [#1050](https://github.com/microsoft/vscode-documentdb/pull/1050).
- Reviewed on: 2026-10-26. Second pass (verification of R1/R2, independent edge-case sweep,
  shipping enhancements) on the same day and the same head.
- Head: `e98e2f40b686c702143ed30b0664624c2ffabeaa`.
- Base: `e15fa6c12e64ad9483e1211805956043ce91720d` (`main`, also the merge base).
- Scope: audience and authority selection, managed identity, worker token delivery, copied connection
  strings, error translation, support traces, telemetry, and public-cloud regressions.
- Constraint: no sovereign-cloud account, VM, or cluster was used. Passing local tests and reading
  public ARM metadata are not evidence of successful sovereign-cloud authentication.

The original review below is preserved alongside the live implementation progress. On 2026-10-26 the
operator accepted the recommended option for every finding, R1 to R9, with neutral wording only
for R7. S1 to S7 are accepted as follow-up todos. S8 is accepted as preview-build-only work. The
implementation began on 2026-10-26. See the live progress below; the original review and its
evidence are preserved.

## Implementation progress (2026-10-26)

The operator requested GPT-6.1 Sol for narrowly scoped coding, an Opus 5.5 review after the fixes
and again after enhancements, separate commits per item, and a Terra final verification run.
Only medium-or-higher findings are in the fix scope; R6 to R9 remain documented low-severity
follow-ups. S1 to S8 remain accepted enhancement work. PR #1050 remains a draft.

Started at 09:36 UTC. Durations below are wall-clock observations, not model compute time.
Token usage is unavailable unless explicitly reported. Commits are local unless stated otherwise.
The read-only attachment is unchanged; this repository copy is the live progress record.

| Item | State | Model | Result / commit |
| --- | --- | --- | --- |
| R1 | Complete | GPT-6.1 Sol | 09:38:47-09:40:20 UTC; 114 focused tests passed; `047465a2bd3b561e92d0069570dd74ba0bd48f99` |
| R2 | Complete | GPT-6.1 Sol | 09:40:20-09:41:21 UTC; 95 focused tests passed; `2e27b5583d2e622d1b06bd7ac319eb56f52dff09` |
| R3 | Complete | GPT-6.1 Sol | 09:44:40-09:48:03 UTC; 189 focused tests passed; `0de180b1e93495b3a2c9504431b7fd34079614fa` |
| R4 | Complete | GPT-6.1 Sol | 09:41:33-09:42:03 UTC; 118 focused tests passed; `f1bc8bffeb0d6106d5f4182767f5d7219884bd65` |
| R5 | Complete | GPT-6.1 Sol | 09:42:14-09:44:14 UTC; 174 focused tests passed; `ecd0995babb996863cd2bfb71b9181941a347228` |
| R6-R9 | Deferred (low) | — | Kept documented per the operator's medium-or-higher threshold |
| Fix review | Complete | Opus 5.5 | 09:49:45-09:53:46 UTC; no medium-or-higher findings |
| S1 | Complete | GPT-6.1 Sol | 09:56:21-09:58:33 UTC; 124 focused tests passed; `20e07a36bf6e3d294cf14bcbe1c330b5821708e6` |
| S2 | Complete | GPT-6.1 Sol | 09:58:59-09:59:39 UTC; 76 focused tests passed; `c20cc619363aafed9c6f717873fc5e718ad54b0e` |
| S3 | Complete | GPT-6.1 Sol | 09:59:50-10:00:36 UTC; 99 focused tests passed; commit recorded with S4 |
| S4 | Pending | GPT-6.1 Sol | Actionable OIDC allowed-host explanation |
| S5 | Pending | GPT-6.1 Sol | Settings patterns; reuse R1 audience validation |
| S6 | Pending | GPT-6.1 Sol | Real-resolver integration tests |
| S7 | Externally blocked | Orchestrator | 09:54-09:55 UTC; Kusto has no configured cluster/database; query recorded below |
| S8 | Pending | GPT-6.1 Sol | Preview-only dialogs on separate `preview/sovereign-diagnostics` branch |
| Enhancement review | Pending | Opus 5.5 | Review enhancements, including isolated preview |
| Full verification | Pending | Terra | Case 1 plus all Case 2 commands, including strict package-test types |

### Execution log

- S3: GPT-6.1 Sol, 09:59:50-10:00:36 UTC (46 seconds). Local IMDS evidence retains only the
  accepted Azure-prefixed letter-only shape, with length and control-character boundaries tested.
  Public-cloud normalization and D7 mapping/precedence remain unchanged; no new mappings.
  Resolver and telemetry projection suites: two files / 99 tests passed. Hash recorded in S4.
- S2: GPT-6.1 Sol, 09:58:59-09:59:39 UTC (40 seconds). `ClustersClient` reuses the existing
  closed Azure suffix helper for the same public-cloud appName on Government and China hosts.
  Dot-boundary/lookalike tests and historical sovereign-domain hash assertions passed:
  two focused files / 76 tests. No metadata hashing semantics changed.
  Commit: `c20cc619363aafed9c6f717873fc5e718ad54b0e`.
- S1: GPT-6.1 Sol, 09:56:21-09:58:33 UTC (132 seconds). Existing per-attempt auth trace contexts
  project only the five allowlisted enums onto startup telemetry; token catches mark a closed
  failure category without replacing errors. Covered both handlers and worker surfaces, resolution
  and token failures, retry/late-result isolation, and exclusion of raw resources/custom/IMDS data.
  Six focused files / 124 tests passed. Initial new assertion expected an unreadable cloud, but
  the existing auth mock supplies public Azure; corrected that assertion. No TDD contract failed.
  Build deferred to the end of S1-S6. Commit: `20e07a36bf6e3d294cf14bcbe1c330b5821708e6`.
- 09:36-09:39 UTC: orchestrator read the supplied review, checked the clean worktree and draft PR,
  and mapped implementation, review, preview isolation, and verification work. No code changed.
- S7: orchestrator, 09:54-09:55 UTC. The read-only Kusto attempt returned "No connection configured"
  and requires explicit cluster/database instructions. The repository has no Kusto query files or
  connection settings. All four supplied domain hashes were independently recomputed with SHA-256
  and match. No telemetry rows were retrieved; no China audience compatibility claim is possible.
- R1: GPT-6.1 Sol, 09:38:47-09:40 UTC. IDE runner found no tests; `npx vitest run`
  covered resolver, settings contributions, scopes, and copied managed-identity strings:
  4 files / 114 tests passed. Build deferred to the five-fix cluster.
  Commit: `047465a2bd3b561e92d0069570dd74ba0bd48f99`.
- R2: GPT-6.1 Sol, 09:40:20-09:41:21 UTC. Resolver, interactive handler, and copied
  managed-identity string suites: 3 files / 95 tests passed, including real-resolver emitted
  resolved/unresolved records. Commit: `2e27b5583d2e622d1b06bd7ac319eb56f52dff09`.
- R4: GPT-6.1 Sol, 09:41:33-09:42:03 UTC. Resolver, interactive/managed-identity handlers,
  and copied managed-identity string suites: 4 files / 118 tests passed.
  Commit: `f1bc8bffeb0d6106d5f4182767f5d7219884bd65`.
- R5: GPT-6.1 Sol, 09:42:14-09:44:14 UTC. Allowlist, resolver, both auth handlers, settings,
  and copy-command suites: 6 files / 174 tests passed. Initial copy and managed-identity handler
  failures identified configuration mocks missing the newly used `inspect` API; updated only those
  mock APIs and reran successfully. No `TDD:` contract failed.
  Commit: `ecd0995babb996863cd2bfb71b9181941a347228`.
- R3: GPT-6.1 Sol, 09:44:40-09:48:03 UTC. Host helper, New Connection, Update Credentials,
  token-source eligibility, and resolver suites: 5 files / 189 tests passed. Initial new assertions
  inspected JSON-escaped log text rather than the message; corrected those assertions. The one
  cluster build found a widened mock return type introduced in R5; pinned its literal return type
  in this commit and rechecked root compilation successfully.
  Commit: `0de180b1e93495b3a2c9504431b7fd34079614fa`.

### Five-fix cluster verification and handoff

**Subsequent verification:** the orchestrator reran the exact `npm run build` command after the
mock correction; all workspace prebuilds and root compilation passed (09:49-09:50 UTC).
The historical first-attempt result below is retained rather than overwritten.

- **Case 1: still working**, draft PR. Exactly one `npm run build` was run after R1/R2/R4/R5/R3
  implementation. Workspace prebuilds passed; root compilation failed on the suffix-source mock's
  widened `string` return type. After its explicit `'none'` return type fix, `npx tsc --noEmit`
  passed. The build command itself was not rerun and is not reported as passed.
- Focused tests passed for every item, including the final 189-test run. No `TDD:`-prefixed
  contract failed. IDE discovery was unavailable, so Vitest CLI was used.
- Public resource/scope definitions in `src/documentdb/auth/entraScopes.ts`, and all constants
  (including RU) in `src/documentdb/utils/connectionStringHelpers.ts`, are unchanged byte-for-byte.
- Full checks, including `prettier-fix`, remain deferred until ready for review. No lint,
  localization generation/check, packaging, full runtime suite, or strict package-test suite ran.
  No dependencies were changed, and no live sovereign-cloud validation or token-usage measurement
  was performed. R6-R9 and S1-S8 were not implemented.
- All five code/doc commits are local. Only this review's final R3 hash record is uncommitted,
  intentionally left for the next documentation commit rather than amending or making a sixth commit.

Changed files across the five scoped commits:

- `package.json`
- `src/documentdb/auth/documentdbTokenResource.ts`
- `src/documentdb/auth/documentdbTokenResource.test.ts`
- `src/documentdb/auth/oidcAllowedHosts.ts`
- `src/documentdb/auth/oidcAllowedHosts.test.ts`
- `src/documentdb/auth/MicrosoftEntraIDAuthHandler.test.ts`
- `src/documentdb/auth/ManagedIdentityAuthHandler.test.ts`
- `src/settingsContributions.test.ts`
- `src/commands/copyConnectionString/copyConnectionString.test.ts`
- `src/commands/newConnection/PromptConnectionStringStep.ts`
- `src/commands/newConnection/PromptConnectionStringStep.test.ts`
- `src/commands/updateCredentials/updateCredentials.ts`
- `src/commands/updateCredentials/updateCredentials.test.ts`
- `docs/ai-and-plans/features/sovereign-clouds/README.md`
- This live review/progress file.

### Opus 5.5 fix review

- 09:49:45-09:53:46 UTC (about four minutes), read-only review of all five R1-R5 commits against
  the complete accepted decisions and refinements. No high, medium, or new actionable low findings.
- Checked real resolver callers, both credential wizards, copy fallback, machine scope enforcement,
  dot-boundary recognition, mismatch evidence, invalid custom-cloud remediation, and public behavior.
- The reviewer additionally ran a cluster-wide runtime checkpoint: 322 files, 5,486 tests passed,
  one skipped; `npx tsc --noEmit` passed. This is not the final strict package-test check.
- R6-R9 remain deferred low findings. No evidence raised their severity.
- The coding and review tool requests explicitly selected GPT-6.1 Sol and Claude Opus 5.5,
  respectively. These requested model identities are recorded; no additional runtime/vendor
  attestation or token accounting was supplied.
- No live sovereign authentication was performed. Full Case 2 checks are still pending; the draft
  PR has not been marked ready.

## Verdict

**Request changes.** The first pass found two P2 findings (R1, R2). The second pass confirmed
both and found one P1 gap (R3) that keeps the PR's own recommended workaround, managed identity, out
of reach for Government and China clusters added from a connection string. It also found two more P2
issues (R4, R5) and several P3 items. No P0 issue and no public-cloud regression was established. The
cloud audience table and the main token-delivery paths are supported by the inspected code, local
tests, installed SDK and driver behavior, and public metadata. Successful sovereign authentication
is still unverified.

| ID | Priority | Finding | Confidence | Validation |
| --- | --- | --- | --- | --- |
| R1 | P2 / medium | Invalid explicit audience overrides silently fall through | High (99%) | Code trace, local reproduction, separate reviewer confirmed, re-reproduced in second pass |
| R2 | P2 / medium | Support traces omit or misstate available cloud evidence | High (99%) | Three local reproductions, separate reviewer confirmed, re-reproduced in second pass |
| R3 | P1 / high | Government and China hosts are not recognized as DocumentDB, so managed identity is never offered in New Connection or Update Credentials | High (99%) | Code trace, local reproduction (second pass) |
| R4 | P2 / medium | A missing or incomplete custom cloud definition gets remediation that names the wrong setting | High (95%) | Code trace, installed SDK inspection, local reproduction (second pass) |
| R5 | P2 / medium | `mongoClusterHostnameSuffix` widens the token allowlist from workspace settings and accepts public suffixes | High (90%) | Code trace, installed driver inspection, local reproduction (second pass) |
| R6 | P3 / low | AADSTS code regex is unbounded and disagrees with the trace regex | High (99%) | Local reproduction (second pass) |
| R7 | P3 / low | Opaque-broker message assumes Windows | Medium (70%) | Code trace (second pass) |
| R8 | P3 / low | Token-failure registry is never cleared on success | Medium (75%) | Code trace (second pass) |
| R9 | P3 / low | User manual overstates managed identity cloud detection and scopes the host suffix to custom clouds only | High (95%) | Doc/code comparison (second pass) |

Enhancements that reduce the risk of shipping without sovereign access are listed separately in
[Shipping without sovereign access](#shipping-without-sovereign-access-enhancements). They are
not defects.

## Review workflow

Following [CONTRIBUTING section 6](../../../../../CONTRIBUTING.md#6-ai-assisted-review-workflow):

1. Initial edge-case review: completed, with local reproductions of the findings below.
2. Copilot comments: both the PR review-comments endpoint and reviews endpoint returned no entries
   when inspected. There are no Copilot comments to merge or reference.
3. Validation gate: a separate read-only reviewer confirmed R1 and R2, retained P2 severity, and
   reassessed solution options. Neither reviewer has attestable runtime model/vendor metadata.
   **The separate-context check is complete, but the different-vendor requirement cannot be
   attested; do not represent the full section 6.1 vendor gate as satisfied.**
4. Independent sweep: the reviewer checked beyond the captured issues, including the installed
   Azure-auth SDK and driver/worker boundaries. No additional high-confidence defect was established.
   The provisional telemetry concern was assessed as a documented limitation, not a third finding.
5. Author decisions: recorded on 2026-10-26 for R1 to R9 (all recommended options; R7 neutral
   wording only). R1-R5 are now implemented locally; R6-R9 remain deferred.
6. Second pass (same head): re-verified R1 and R2 against the code and reassessed their
   recommendations (see "Second-pass verification" under each). Then an independent sweep
   covered the New Connection and Update Credentials wizards, the installed Azure-auth SDK
   (`@microsoft/vscode-azext-azureauth` 4.1.1, `@azure/ms-rest-azure-env`), and the installed
   MongoDB driver (7.2.0) `ALLOWED_HOSTS` enforcement. It also covered the diagnostics service
   ordering and deadline, the managed identity error path, settings scope, user documentation,
   and existing telemetry. 19 temporary probe tests reproduced R1 to R6. They were removed after
   execution. This pass also comes from a single reviewer without attestable vendor metadata, so
   the section 6.1 vendor gate is still not satisfied.

## Validated findings

### R1. P2: Reject an invalid explicit audience instead of silently selecting another

**Location:** [custom resolution](../../../../../src/documentdb/auth/documentdbTokenResource.ts#L268)
and [managed identity resolution](../../../../../src/documentdb/auth/documentdbTokenResource.ts#L171).

The resolver treats a nonempty, invalid `ossrdbmsEndpoint` exactly like an absent setting. For
example, putting a scope rather than a resource in the setting,
`https://ossrdbms-aad.database.windows.net/.default`, fails parsing. Interactive custom-cloud
resolution then selects the login host's resource; managed identity selects the host's resource
or IMDS. Neither reports the invalid setting, and `customOssrdbmsEndpointSet` is `false`.

This matters when the override is the operator's deliberate fix for an otherwise unresolvable or
incompatible audience. A typo can cause the extension to request a different audience while
reporting that no override was configured. Remote troubleshooting then starts from false
configuration evidence.

**Reproduced:** with a Government login host and `mongodb://cluster.azure.us/`, both interactive
and managed identity resolution returned the Government audience despite the malformed explicit
public-resource override. Reasons were `customLoginHost` and `host`; warnings were not called.

**Recommended:** distinguish absent, valid, and invalid values. Reject a nonempty invalid override
with a localized, setting-specific error before fallback on paths where the override applies.
Keep the intentional behavior that built-in interactive clouds ignore the custom override.

| Option | Pros | Cons |
| --- | --- | --- |
| Reject an invalid applicable override (recommended) | Makes precedence explicit; avoids requesting an unintended audience; gives a direct corrective action | A currently ignored typo becomes a visible configuration failure |
| Warn and continue with a trace value of `invalid` | Preserves permissive behavior | Still requests an audience different from the explicit configuration; warning can be missed |

**Regression tests:** nonempty malformed override with a recognized custom login host, a recognized
managed-identity cluster host, valid ARM metadata, and a usable IMDS result; assert no
fallback/token request for the recommended option. Test absent and valid values separately,
including unchanged public behavior. Keep the intentional copy-operation fallback separate.

**Validation gate:** confirmed, high confidence (99%). A new override-handling defect, not evidence
of a normal public-cloud regression. Existing invalid-override tests cover only situations where
the lower-priority resolution sources also fail.

**Second-pass verification:** confirmed. Re-reproduced: Government login host, an override of
`https://ossrdbms-aad.database.windows.net/.default`, and an `azure.us` host. The result was
`reason: customLoginHost`, the Government audience, and `customOssrdbmsEndpointSet: false`, with no
warning. A scheme-less override (`ossrdbms-aad.database.usgovcloudapi.net`) on a managed identity
with a private host and public IMDS silently resolved to the **public** audience. In that case the
fallback crosses clouds, not just sources. The recommended option is correct. Refinements:

- Treat `undefined`, `""`, and whitespace-only values as absent. Clearing the field in
  `settings.json` often leaves `""`, and that must not start failing connections.
- Report the override as a tri-state in traces (`absent`, `valid`, `invalid`) and add whether it
  applied on this path. Today `customOssrdbmsEndpointSet: true` is also logged for built-in
  interactive clouds, where the override is intentionally ignored. That reads as if it was used.
- In the error, show the expected form (`https://ossrdbms-aad.database.usgovcloudapi.net`, no
  `/.default`, no path). The value is not secret, but keep it out of traces.
- Add a JSON-schema `pattern` and `patternErrorMessage` to `ossrdbmsEndpoint` in `package.json`
  (for example `^\s*https://[^/?#:@\s]+/?\s*$`). The Settings editor then flags the typo before
  any connection attempt. This is a cheap complement to the runtime check, not a replacement.
- Copy: keep the documented permissive fallback, but log a warning so a copied string that ignores
  the override is not silent.

**Author decision:** accepted (2026-10-26), recommended option. Reject a nonempty invalid override on the paths where it applies, including the second-pass refinements: empty or whitespace-only values count as absent, a tri-state trace value, the expected form in the error, a `package.json` `pattern`, and a warning on copy.

**Implementation (R1):** applicable invalid overrides now fail before login-host, ARM, host, or
IMDS fallback with a localized setting-specific expected-form error. Empty/whitespace values remain
absent; built-in interactive clouds ignore overrides. Traces record `absent|valid|invalid` and
applicability without the configured value. Settings validate resource form; copy warns and keeps
its permissive fallback. Focused resolver, settings, scope, and copy suites: 114 tests passed.

### R2. P2: Populate cloud evidence before early returns and mismatch errors

**Location:** [interactive mismatch handling](../../../../../src/documentdb/auth/documentdbTokenResource.ts#L136)
and [managed identity override handling](../../../../../src/documentdb/auth/documentdbTokenResource.ts#L169).

Some new support records contain incorrect or incomplete evidence precisely on the paths where
an operator will need it:

- Managed identity returns an explicit override before computing the host cloud, so a recognizable
  `cluster.azure.us` is logged with `hostCloud: "none"`.
- Interactive custom resolution can throw before computing the host cloud, again reporting
  `"none"` for a recognizable Government host.
- A cloud mismatch is thrown before `withDetails` adds the selected resource, reason, and cloud
  category. The unresolved trace therefore loses which candidate audience caused the rejection,
  especially useful when the selected configuration is merely labeled `"custom"`.

**Reproduced:** all three cases were exercised against the production resolver with injected
configuration and network dependencies. The mismatch error's `details` object has no
`tokenResource`, `reason`, or `cloudCategory` keys.

**Recommended:** collect the host classification before audience selection and merge the selected
candidate's safe resolution fields before the mismatch check. Distinguish an unexamined value from
an examined but unrecognized host. Preserve the current audience precedence; this does not propose
adding a managed-identity mismatch check. Do not log cluster hosts, credentials, or raw errors.

| Option | Pros | Cons |
| --- | --- | --- |
| Populate known evidence before branching (recommended) | Accurate traces across all consumers; small central change | Requires updating trace expectations |
| Mark skipped fields `notEvaluated` and add evidence at each error site | Avoids asserting a false negative | More branch-specific handling and incomplete evidence |

**Regression tests:** override plus recognized host, unresolved custom cloud plus recognized host,
and custom-resource mismatch. Assert the full resolved/unresolved trace shape, not just the error
kind or that an event was written. Include an emitted-trace test using the real resolver rather
than a mocked resolution object.

**Validation gate:** confirmed, high confidence (99%). This is a defect in the new support
instrumentation, not a demonstrated authentication-selection regression.

**Second-pass verification:** confirmed. Re-reproduced all three cases. The mismatch error's
`details` keys are exactly `flow, configuredCloud, authProvider, brokerImplementation, hostCloud,
customOssrdbmsEndpointSet, customHostnameSuffixSet, armMetadata, imdsAzEnvironment, errorKind`,
with no `tokenResource`, `reason`, or `cloudCategory`. The recommended option is correct, and the
simplest form of it removes the need for a `notEvaluated` value:

- Host classification is a pure, offline parse. Compute `details.hostCloud` as the **first** step
  of every flow. `none` then always means "examined, not a built-in Azure domain", and the second
  option in the table becomes unnecessary.
- In the mismatch branch, build the error from `withDetails(resolved, details).details` instead of
  `details`.
- `resolveTokenResourceForCopy` has the same early return before `hostCloud`. Its details are not
  traced today, so it has no user impact, but fix it the same way to keep the three flows
  identical.

**Second-pass refinement, related to R4:** when the configured cloud cannot be read, the mismatch
message says "VS Code is signed in to {cloud of the override}". VS Code is not signed in to anything
in that state. See R4.

**Author decision:** accepted (2026-10-26), recommended option. Classify the host first in every flow, including copy, and build the mismatch error from the merged resolution details.

**Implementation (R2):** interactive, managed identity, and copy classify hosts before branching.
Mismatch errors now carry the candidate's resource, reason, and cloud category. Focused tests
cover override early returns, unresolved custom clouds, and complete emitted resolved/unresolved
trace objects through the interactive handler using the real resolver: 95 tests passed. No host,
token, or raw error is added to traces; audience precedence and D8 are unchanged.

## Second-pass findings

### R3. P1: Recognize Government and China DocumentDB hosts so managed identity is offered

**Location:** [`AzureDomains.vCore`](../../../../../src/documentdb/utils/connectionStringHelpers.ts#L101),
used by [New Connection](../../../../../src/commands/newConnection/PromptConnectionStringStep.ts#L107)
and [Update Credentials](../../../../../src/commands/updateCredentials/updateCredentials.ts#L68);
the gate is in [`SelectEntraTokenSourceStep`](../../../../../src/documentdb/wizards/authenticate/SelectEntraTokenSourceStep.ts#L259).

`AzureDomains.vCore` is `mongocluster.cosmos.azure.com`. A portal-copied Government or China string
(`<name>.mongocluster.cosmos.azure.us` or `.azure.cn`, confirmed for China by the
[China documentation](https://docs.azure.cn/en-us/documentdb/how-to-connect-role-based-access-control))
therefore gets `availableAuthenticationMethods = [NativeAuth, NoAuth]`. Microsoft Entra ID is still
selectable, because manual entry shows every top-level method. Managed identity is not a top-level
method, though: `SelectEntraTokenSourceStep` offers it only when `ManagedIdentity` is in the
available list. Otherwise it returns `managedIdentityUnavailable` and goes straight to interactive
sign-in. Update Credentials does not add Entra ID or managed identity for these hosts either.

**Why P1:** the PR's AADSTS65002 explanation, the `brokerOpaque` message, and the user manual all
tell Government and China users to use managed identity as the workaround. For the most common
entry path, a pasted portal connection string, the UI never offers it. Remaining routes are the
Azure discovery tree, which synthesizes managed identity from ARM `allowedModes`, and pasting a
driver-native `MONGODB-OIDC` + `ENVIRONMENT:azure` string. Neither is discoverable from the error
message. This is a gap in the feature, not a public-cloud regression.

**Reproduced:** with `PromptConnectionStringStep`, `azure.com` yields
`NativeAuth,MicrosoftEntraID,ManagedIdentity,NoAuth`, while `azure.us` and `azure.cn` yield
`NativeAuth,NoAuth`.

**Recommended:** replace the single-suffix check with a helper that recognizes
`mongocluster.cosmos.azure.{com,us,cn}`. Reuse the closed TLD list in `oidcAllowedHosts.ts` rather
than a second hardcoded list. Consider also accepting a host that matches a configured
`mongoClusterHostnameSuffix`. Leave `AzureDomains.RU` alone; it is out of scope. Regression tests:
New Connection and Update Credentials for each of the three suffixes, plus a lookalike
(`mongocluster.cosmos.azure.us.evil.com`) that must not match. Note that `hasDomainSuffix` matches
with a bare `endsWith`, so `xmongocluster.cosmos.azure.com` also matches today; use a dot boundary
in the new helper.

**Author decision:** accepted (2026-10-26), recommended option. Recognize `mongocluster.cosmos.azure.{com,us,cn}` with a dot boundary, reuse the closed TLD list, also accept a configured `mongoClusterHostnameSuffix`, and apply the result in both New Connection and Update Credentials.

**Implementation (R3):** both credential wizards use `hasDocumentDBHost`, which reuses the existing
closed Azure TLD set through the host-suffix helper and the R5-hardened custom suffix validator.
Matching requires a dot boundary, including configured suffixes. No RU or public-cloud constants
changed. Tests cover all three service domains, configured service hosts, lookalikes, rejected public
suffixes, unchanged RU availability, and the real managed-identity token-source eligibility gate in
both wizard flows. The final focused run (including resolver regression coverage): 189 tests passed.

### R4. P2: Name `microsoft-sovereign-cloud.customEnvironment` when it is missing or incomplete

**Location:** [`getConfiguredCloudForDetails`](../../../../../src/documentdb/auth/documentdbTokenResource.ts#L407)
and the [`customCloudUnresolved` error](../../../../../src/documentdb/auth/documentdbTokenResource.ts#L290).

`getConfiguredAzureEnv()` throws in two cases. One is when `environment` is `custom` and
`customEnvironment` is absent. The other is when `customEnvironment` lacks any of the six fields
the `@azure/ms-rest-azure-env` constructor requires (`name`, `portalUrl`, `managementEndpointUrl`,
`resourceManagerEndpointUrl`, `activeDirectoryEndpointUrl`, `activeDirectoryResourceId`). The
resolver swallows that error and treats the state as a custom cloud with no endpoints. Results:

- Without an override, the user is told "VS Code is signed in to a custom cloud ... Set
  `documentDB.customEnvironment.ossrdbmsEndpoint`". That cannot fix the problem.
- If the user follows the advice, resolution succeeds (`reason: customOverride`). Then
  `getSessionFromVSCode` calls `getConfiguredAuthProviderId()`, which throws the raw SDK message,
  for example `Please provide "portalUrl" for the environment...`. That failure is recorded as an
  Entra token failure.
- With an override and an `azure.com` host, the message says "VS Code is signed in to Azure US
  Government". VS Code is not signed in at all.

**Reproduced:** all three, with the trace showing `configuredCloud: unreadable`.

**Recommended:** when the configured cloud is unreadable, throw a new `TokenResourceErrorKind`
(for example `customCloudDefinitionInvalid`) before audience selection. Its message should name
`microsoft-sovereign-cloud.customEnvironment` and list the required fields. Never include the SDK
error text in traces. Regression tests: missing `customEnvironment`, one missing field, and the
override-plus-`azure.com` case.

**Author decision:** accepted (2026-10-26), recommended option. Add a new error kind for an unreadable custom cloud definition that names `microsoft-sovereign-cloud.customEnvironment` and its required fields, raised before audience selection.

**Implementation (R4):** interactive resolution now raises `customCloudDefinitionInvalid` before
audience selection when the VS Code cloud definition is unreadable. Its localized message names
`microsoft-sovereign-cloud.customEnvironment` and all six SDK-required fields. Tests exercise the
real SDK with an absent definition and missing `portalUrl`, including an override with a public
host, and preserve managed identity's override/host/IMDS independence from unreadable VS Code
settings. No SDK error text enters traces. Focused suites: 118 tests passed.

### R5. P2: Do not let a workspace widen the OIDC token allowlist

**Location:** [`documentDB.customEnvironment` contribution](../../../../../package.json#L1990)
(`"scope": "machine-overridable"`) and
[`normalizeCustomHostnameSuffix`](../../../../../src/documentdb/auth/oidcAllowedHosts.ts#L109).

Driver 7.2.0 enforces `ALLOWED_HOSTS` for callback-based OIDC after SRV resolution, and the
extension never sets `ENVIRONMENT`, so the allowlist is a real control. `mongoClusterHostnameSuffix`
extends that allowlist. Two weaknesses:

1. `machine-overridable` lets workspace and folder settings override the value. A trusted
   repository's `.vscode/settings.json` can therefore add any suffix. The extension declares no
   `untrustedWorkspaces` capability, so Restricted Mode disables it. The exposure is limited to
   trusted workspaces, and exploitation also needs the user to choose Entra ID for a host the
   attacker controls. For example, a deep link through the URI handler adds a connection after a
   confirmation.
2. Any two-label suffix is accepted, including public suffixes. Reproduced: `.com.cn` and `.co.uk`
   normalize successfully, and `attacker.com.cn` gets `ALLOWED_HOSTS: ['*.com.cn']`.

The token's audience (`ossrdbms-aad...`) is shared by the Azure open-source database family.
A leaked token is therefore broader than one DocumentDB cluster, which raises the stakes above a
typical setting typo.

**Recommended:** make the suffix setting `machine` scoped, or read only
`inspect(...).globalValue`/machine values for the suffix. Then reject suffixes that equal a known
public-suffix pattern; at minimum, reject `com.<cc>`, `co.<cc>`, `net.<cc>`, `org.<cc>`, and
`gov.<cc>` style two-label values. Record `customHostnameSuffixSource` (`user`, `workspace`, or
`none`) in traces. Applying the same scope to `ossrdbmsEndpoint` is lower risk but keeps the object
consistent. VS Code's own `microsoft-sovereign-cloud.*` settings use the default scope, so this is
hardening, not parity.

**Author decision:** accepted (2026-10-26), recommended option. Use `machine` scope for `documentDB.customEnvironment`, covering both properties. Reject two-label public-suffix patterns and trace `customHostnameSuffixSource`.

**Implementation (R5):** the entire `documentDB.customEnvironment` object is machine scoped;
the settings contract test pins this rather than adding another settings reader. Suffix normalization
rejects `com|co|net|org|gov.<two-letter-cc>` after case/dot normalization while retaining narrower
service suffixes. Traces report only `user|workspace|none` from configuration inspection, never raw
suffixes. Focused allowlist, source-trace, manifest scope, handler, and copy tests: 174 passed.
This is targeted pattern hardening, not a complete public-suffix database.

### R6. P3: Bound the AADSTS code match

**Location:** [`classifyEntraError`](../../../../../src/documentdb/auth/entraErrors/classifyEntraError.ts#L22).

`/AADSTS(\d{5,7})/g` has no trailing boundary. `AADSTS12345678` is classified as code `1234567`,
while `describeAuthError` in `authTrace.ts` uses `\d{5,9}` with word boundaries. No current rule is
affected, because the regex is greedy and `500011` is not truncated to `50001`. But `unknownAadsts`
would build a wrong lookup link, and the trace and classifier would disagree. **Recommended:**
`/\bAADSTS(\d{5,9})\b/g` in both places, with a test.

**Author decision:** accepted (2026-10-26), recommended option.

### R7. P3: Do not assume Windows in the opaque-broker message

**Location:** [`brokerOpaque` rule](../../../../../src/documentdb/auth/entraErrors/entraErrorRules.ts#L121).

The generic branch says "The Windows sign-in window reported an error". The classification is
based only on the presence of `platform_broker_error`. If VS Code's broker is used on other
platforms, or the text appears on another path, the message misleads. **Recommended:** neutral
wording ("The sign-in window reported an error without details"), or gate the Windows wording on
`process.platform === 'win32'`.

**Author decision:** accepted (2026-10-26), neutral wording only. No platform gate: the message
must not mention Windows on any platform.

### R8. P3: Clear the token-failure record on success

**Location:** [`recordEntraTokenFailure`](../../../../../src/documentdb/auth/entraErrors/entraTokenFailures.ts#L19).

Records persist for 10 minutes per `clusterId` and are only overwritten by the next failure. A later
error for the same cluster that is not a token failure can therefore be explained with the earlier
attempt's `cloudCategory` and `authMethod`, and the telemetry gets the same stale values.
That earlier attempt may have used a different cloud setting. Practical impact is small because
only Entra-matching texts are classified. **Recommended:** clear the record when token acquisition
succeeds on any of the four call sites. Add one test per surface.

**Author decision:** accepted (2026-10-26), recommended option.

### R9. P3: Correct the user manual on managed identity and private hosts

**Location:** [sovereign-clouds.md](../../../../user-manual/sovereign-clouds.md#managed-identity).

- "Otherwise, it uses the Azure VM's instance metadata" implies a Government VM is detected. By
  decision D7, only `AZUREPUBLICCLOUD` is recognized. Reproduced: IMDS `AzureUSGovernmentCloud`
  with a private host fails with `managedIdentityCloudUnknown`. State that only the public cloud
  is detected this way and that other clouds need `ossrdbmsEndpoint`.
- `mongoClusterHostnameSuffix` is documented under "Custom clouds" only. A Government or China
  cluster reached through a private DNS name or CNAME also fails `ALLOWED_HOSTS`
  (`*.azure.com` default) and needs this setting. A private-host managed identity user in
  Government needs **both** properties. Add a "Private endpoints and custom DNS names" subsection.
- The driver's rejection (`Host '...' is not valid for OIDC authentication with ALLOWED_HOSTS of
  '*.azure.com'`) is not translated by any provider. See enhancement S4.

**Author decision:** accepted (2026-10-26), all three corrections.

## Shipping without sovereign access: enhancements

These items are not defects. They are ordered by how much they reduce the risk of a blind release.

| ID | Enhancement | Why it matters without a sovereign cluster |
| --- | --- | --- |
| S1 | Attach the coarse resolution fields (`cloudCategory`, `tokenResourceReason`, `configuredCloud`, `hostCloud`, `errorKind`) to the existing connection-startup telemetry for Entra and managed identity attempts. | The only scalable signal for whether Government/China connections succeed after release. All values are closed enums with no identifiers. The first pass called this a separate scope decision; this pass recommends making it before shipping. |
| S2 | Set the extension `appName` for `azure.us` and `azure.cn` hosts too ([`ClustersClient`](../../../../../src/documentdb/ClustersClient.ts#L365) uses `hasAzureDomain`, which matches `azure.com` only). | The service team can then attribute VS Code connections in sovereign clusters and confirm success or failure server-side, independent of client telemetry. Same data as already sent for public clusters. |
| S3 | Trace the raw IMDS `azEnvironment` when it matches a safe shape such as `^Azure[A-Za-z]{1,40}$`; keep `other` for anything else. | Answers research open question 5 from the first Government managed identity report, which is the evidence needed to revisit D7 safely. |
| S4 | Translate the driver's `ALLOWED_HOSTS` rejection into a message naming `documentDB.customEnvironment.mongoClusterHostnameSuffix` (a rule matched on the driver text, routed through `ConnectionDiagnosticsService`). | Private endpoints with custom DNS are common in Government tenants; today the user sees a raw driver message that mentions `*.azure.com`. |
| S5 | Add `pattern` validation for both `documentDB.customEnvironment` properties in `package.json` (see R1). | Catches configuration mistakes in the Settings editor, before any remote troubleshooting round trip. |
| S6 | Add end-to-end handler tests using the real resolver, not a mocked resolution, for: Government interactive (scope passed to `getSessionFromVSCode`, `ALLOWED_HOSTS`), Government managed identity by host, China both flows, and the shell and playground `tokenRequest` path with a Government connection string. | The current handler tests mock `resolveInteractiveTokenResource`, so a wiring regression between resolver and token request would pass. |
| S7 | Use the existing hashed domain telemetry to run the D11 check. `*.azure.cn` and `*.azure.us` hosts are classified `domainInfo_isAzure = false` and hashed. Match `domainInfo_domain_l2 = 6a619114` (`azure.cn`) or `domainInfo_domain_l3 = 49133d63` (`cosmos.azure.cn`); for Government, `8bafc480` (`azure.us`) and `f3e87358` (`cosmos.azure.us`). Values are the first 8 hex characters of SHA-256, as computed by `getClusterMetadata.ts`. | Makes the D11 shipping gate answerable with data that already exists. |
| S8 | Preview-build connection diagnostics dialogs. Replaces the earlier scripted-checklist idea. See [S8 design](#s8-preview-build-connection-diagnostics-dialogs). | The reporter sees what the extension detected and decided at each stage, and can paste a redacted report with one click. |

### Follow-up todos (S1 to S7)

Accepted by the operator on 2026-10-26 as follow-up work. These are not blocking findings. Track
each one as a separate commit, so they can be reviewed apart from the R fixes.

- [x] **S1.** Add `cloudCategory`, `tokenResourceReason`, `configuredCloud`, `hostCloud`, and
      `errorKind` to the connection-startup telemetry for Entra ID and managed identity attempts.
      Use closed enums only. Implemented through existing attempt-bound trace contexts, never a
      cluster-keyed registry or raw trace spread.
- [x] **S2.** Set the extension `appName` for `azure.us` and `azure.cn` hosts, not only
      `azure.com` (`ClustersClient`, `hasAzureDomain`). Implemented by reusing the closed suffix
      matcher locally in `ClustersClient`; historical `hasAzureDomain` telemetry behavior is unchanged.
- [x] **S3.** Trace the raw IMDS `azEnvironment` value when it matches `^Azure[A-Za-z]{1,40}$`.
      Otherwise keep `other`. Implemented locally only; the S1 telemetry allowlist excludes it.
- [ ] **S4.** Translate the driver's `ALLOWED_HOSTS` rejection into a message that names
      `documentDB.customEnvironment.mongoClusterHostnameSuffix`.
- [ ] **S5.** Add `pattern` and `patternErrorMessage` validation for both
      `documentDB.customEnvironment` properties. This overlaps with the R1 decision; implement it once.
- [ ] **S6.** Add end-to-end handler tests with the real resolver for the Government and China
      interactive and managed identity flows, and for the shell and playground `tokenRequest` path.
- [ ] **S7.** Run the D11 China check against existing hashed domain telemetry. Use
      `6a619114` (`azure.cn`) and `49133d63` (`cosmos.azure.cn`); for Government, use `8bafc480`
      (`azure.us`) and `f3e87358` (`cosmos.azure.us`).

### S7 execution: telemetry access blocker and query

**Blocked externally (2026-10-26).** The available Kusto tool returned
`No connection configured. The query must include :setDefaultCluster and :setDefaultDb instructions.`
No approved telemetry endpoint or database was available in the repository settings. The initial
availability probe therefore never reached a server. No credential, endpoint, or database was
invented. D11 remains an open shipping gate, not a passed check and not evidence of zero users.

The following read-only query uses the repository's documented `RawEventsVSCodeExt` schema,
lowercase ingested property names, and startup correlation IDs. Add the approved cluster/database
instructions before running it. Its live schema and results are **not verified**:

```kusto
let recent = materialize(
    RawEventsVSCodeExt
    | where ServerTimestamp > ago(30d)
    | where EventName contains "vscode-documentdb"
    | where EventName endswith "connect.staticmetadata" or EventName endswith "connect.startup"
    | project EventName, Properties
);
let sovereignAttempts = recent
    | where EventName endswith "connect.staticmetadata"
    | extend l2 = tostring(Properties.domaininfo_domain_l2),
             l3 = tostring(Properties.domaininfo_domain_l3),
             startup = coalesce(tostring(Properties.startupcorrelationid),
                                tostring(Properties.connectioncorrelationid))
    | extend cloud = case(l2 == "6a619114" or l3 == "49133d63", "china",
                          l2 == "8bafc480" or l3 == "f3e87358", "usgov", "")
    | where cloud != "" and startup != ""
    | distinct startup, cloud;
recent
| where EventName endswith "connect.startup"
| extend startup = tostring(Properties.startupcorrelationid),
         auth = tostring(Properties.authmethod),
         outcome = tostring(Properties.startupoutcome)
| join kind=inner sovereignAttempts on startup
| summarize attempts = count() by cloud, auth, outcome
| order by cloud asc, auth asc, outcome asc
```

Restrict the reporting period to versions predating the sovereign audience change when evaluating
whether China previously accepted the public audience. Historical telemetry does not record the
requested audience directly. Count only the relevant Entra/managed-identity methods, and investigate
missing metadata/correlation rather than interpreting absent joined rows as absent connections.
The query returns aggregate counts only, with no machine, tenant, user, or host identifiers.

### S8. Preview-build connection diagnostics dialogs

Accepted by the operator on 2026-10-26. It replaces the earlier scripted-checklist idea.

**Purpose.** Nobody on the team can sign in to a Government or China cluster. The preview reporter
is the only real-cloud test. A preview build should therefore show, at each connection stage, what
the extension detected, what it decided, and what happens next. Each stage needs one button that
copies a redacted report the reporter can paste into the issue.

**Delivery: never in a release.**

- **Preferred:** a separate `preview/sovereign-diagnostics` branch, based on the PR branch, that
  produces a VSIX for the reporter. The branch is never merged; it is deleted when the preview
  check is done. This is easier to abandon than a revert.
- **Fallback:** if it must live on the PR branch, put the whole feature in **one commit**, titled
  `chore(preview): sovereign connection diagnostics dialogs (DO NOT MERGE)`. Revert it with a
  single `git revert` before the PR is marked ready for review.
- Either way:
  - All code is in one new folder, `src/documentdb/auth/previewDiagnostics/`.
  - The hooks are one-line calls, so the commit stays small and its revert stays clean.
  - Strings are plain English and not wrapped in `vscode.l10n.t()`, so `l10n:check` is not affected
    and the bundle does not pick up throwaway strings.
  - One constant, `PREVIEW_DIAGNOSTICS_ENABLED = true`, gates every hook, so the code can be
    disabled without removing it.

**Constraint found in this review.** Every token path uses the driver's automated `OIDC_CALLBACK`,
whose timeout is 60 s (`AUTOMATED_TIMEOUT_MS` in driver 7.2.0). Managed identity on the extension
connection, and both auth methods in the shell and playground, request the token **inside** that
callback. A dialog there must not be awaited, or a reporter who reads it slowly causes a
timeout that looks like a sign-in failure. Interactive sign-in on the extension connection gets its
token in `configureAuth`, before the driver runs, so it can safely block.

| Dialog | Shown | Blocking? | Hook |
| --- | --- | --- | --- |
| 1 of 3: about to request a token | After cloud resolution succeeds or fails, before any token request | Yes in `configureAuth` (both handlers). No in shell and playground (`handleTokenRequest` runs inside the worker's callback) | `MicrosoftEntraIDAuthHandler`, `ManagedIdentityAuthHandler` (`configureAuth`), `ShellSessionManager` and `PlaygroundEvaluator` (`handleTokenRequest`) |
| 2 of 3: token result | After the token request succeeds or fails | Yes for interactive in `configureAuth`; no elsewhere | After `getSessionFromVSCode` or `getManagedIdentityAccessToken`, at the same four sites |
| 3 of 3: connection result | After `MongoClient.connect()` succeeds or throws, and after two probe commands | Yes (the connection is already open or has failed) | `ClustersClient.connect`, after stage 04, and in its `catch` |

Show each dialog at most once per `(clusterId, surface, step)` per window. Token refreshes in the
shell and playground then do not repeat it. If resolution fails, dialog 1 reports the failure and
dialogs 2 and 3 are skipped. If the token request fails, dialog 2 reports the failure and dialog 3
is skipped.

A modal closes on any button. **Copy report** therefore writes the clipboard, shows a non-modal
"Copied" toast, and opens the same dialog again. **Continue** proceeds. The built-in **Cancel**
on dialog 1 throws `UserCancelledError`, so the reporter can capture the evidence without
attempting sign-in. `ConnectionDiagnosticsService` already ignores that error.

**Dialog 1 of 3** (example: Government, interactive):

```text
Preview build: connection check 1 of 3
About to request a Microsoft Entra ID token

What was detected
  VS Code cloud setting:     USGovernment  (microsoft-sovereign-cloud.environment)
  Cluster domain:            *.azure.us  ->  Azure US Government
  Authentication:            Microsoft Entra ID, VS Code account
  Sign-in provider:          microsoft-sovereign-cloud   broker: default
  Custom settings:           ossrdbmsEndpoint absent; mongoClusterHostnameSuffix absent

What was decided
  Token resource:            https://ossrdbms-aad.database.usgovcloudapi.net
  Why:                       reason=setting
  Token may be sent only to: *.azure.us

What happens next
  VS Code may open a sign-in window. If it shows an error, write down the AADSTS code
  it displays before closing it.

[Continue]  [Copy report]  [Cancel]
```

For managed identity, replace the last three groups with `Authentication: Managed identity
(system-assigned | user-assigned)`, the IMDS outcome (`notQueried`, `AZUREPUBLICCLOUD`, `other`,
or `unavailable`), and "Next: the token is requested from this machine's identity endpoint when the
driver asks for it." On failure, show `errorKind` and the same message the user would see.

**Dialog 2 of 3** (token result):

```text
Preview build: connection check 2 of 3
Token received

  Requested resource:        https://ossrdbms-aad.database.usgovcloudapi.net
  Token audience (aud):      https://ossrdbms-aad.database.usgovcloudapi.net   matches: yes
  Issuer host (iss):         login.microsoftonline.us   ->  Azure US Government
  Token version (ver):       2.0
  Client (appid/azp):        VS Code   (or: other, managed identity)
  Tenant (tid):              present; matches the configured cluster tenant: yes | no | not configured
  Expires in:                59 min
  Token acquisition:         1,240 ms

What happens next
  The extension connects to the cluster and sends this token. The cluster decides whether
  it accepts the audience and whether this identity has a role.

[Continue]  [Copy report]
```

On failure, the title becomes "Token request failed" and the body lists `describeAuthError`
(`type`, `code`, `httpStatus`, `aadsts`, `broker`), the classifier `ruleId`, and the text that
`EntraDiagnosticsProvider` would show. Decode the claims from the JWT payload locally, with no
signature check and no network call. Never show or copy the token itself.

**Dialog 3 of 3** (connection result):

```text
Preview build: connection check 3 of 3
Connected and authenticated

  Handshake and authentication:  succeeded   (connect: 2,310 ms)
  ping (admin):                  ok
  listDatabases (nameOnly):      ok, 3 databases visible
  connectionStatus:              ok, 1 role assigned   (or: not supported by this server)

What this proves
  The cluster accepted a token for https://ossrdbms-aad.database.usgovcloudapi.net from
  Azure US Government. Please paste this report into the GitHub issue.

[Done]  [Copy report]
```

On failure, list the error name, `code`, `codeName`, and one plain-language reading of it:

- `AuthenticationFailed` (code 18): the cluster rejected the token. A wrong audience or a missing
  role is likely.
- The `ALLOWED_HOSTS` rejection: the token was not sent; see S4.
- Timeout or network error: the token was not the problem.

Also include the `ConnectionDiagnosticsService` explanation, if any. The probe commands run only in
the preview build and only after a successful connect. Each one is wrapped so that its failure is
reported, not thrown.

**Copied report.** Every dialog's **Copy report** produces one fenced Markdown block. It starts with
the step header, the extension version, the VS Code version, `process.platform`/`arch`, the UTC
time, and the startup correlation ID, so the report can be matched to the output channel. It then
repeats the fields shown in the dialog, plus the `entraCloud.resolved` or `entraCloud.unresolved`
details object verbatim. That object is already identifier-free by design.

Redaction rules, enforced by a unit test of the formatter:

- No cluster host names. Report only the matched domain suffix (`*.azure.us`) or `private`.
- No tenant IDs, client IDs, object IDs, user names, or e-mail addresses. Report "present" and
  derived yes/no comparisons instead.
- No tokens, connection strings, or raw error text from the driver or MSAL beyond the classified
  fields above.

**Implementation sketch** (all in the one commit or on the preview branch):

```ts
// src/documentdb/auth/previewDiagnostics/previewDiagnostics.ts
export const PREVIEW_DIAGNOSTICS_ENABLED = true;

export type PreviewStep = 1 | 2 | 3;
export type PreviewSurface = 'extension' | 'shell' | 'playground';

export interface PreviewDialog {
    readonly step: PreviewStep;
    readonly title: string; // "About to request a Microsoft Entra ID token"
    readonly sections: ReadonlyArray<{ heading: string; rows: ReadonlyArray<[string, string]> }>;
    readonly next?: string;
    readonly details?: Readonly<Record<string, string | boolean>>; // resolution details, copied verbatim
}

const shown = new Set<string>();

/** Never throws. When `blocking` is false, returns immediately; use it inside OIDC callbacks. */
export async function showPreviewDialog(
    clusterId: string,
    surface: PreviewSurface,
    dialog: PreviewDialog,
    options: { blocking: boolean; cancellable?: boolean },
): Promise<void> {
    if (!PREVIEW_DIAGNOSTICS_ENABLED) return;
    const key = `${clusterId}|${surface}|${dialog.step}`;
    if (shown.has(key)) return;
    shown.add(key);
    const run = loopUntilDismissed(dialog, options.cancellable === true); // Copy report re-opens
    if (options.blocking) await run;
    else void run.catch(() => undefined);
}

// formatPreviewReport(dialog): string  -> the redacted Markdown block, unit-tested
// describeTokenClaims(accessToken, requestedResource, clusterTenantId?) -> rows for dialog 2
// runPostConnectProbes(client): Promise<rows> -> ping, listDatabases({ nameOnly: true }), connectionStatus
```

Hook call sites, one line each: two handlers × steps 1 and 2; `ShellSessionManager` and
`PlaygroundEvaluator` × steps 1 and 2 with `blocking: false`; `ClustersClient.connect` × step 3
(success and `catch`). Tests: formatter redaction, the once-per-key behavior, and
`blocking: false` returning before the dialog resolves.

**Reporter run sheet** (attach to the preview VSIX):

1. Government, interactive, portal connection string (`*.mongocluster.cosmos.azure.us`): expect
   `usgov` in dialog 1, a matching `aud` in dialog 2, and dialog 3 succeeded. Then open a
   collection, and run `db.runCommand({ ping: 1 })` in the shell and in a playground (dialogs 1
   and 2, non-blocking).
2. Government, managed identity on a Government VM, same connection string: `reason=host`.
3. Government, managed identity, private DNS name with both `documentDB.customEnvironment`
   properties set: `reason=customOverride` and `ALLOWED_HOSTS` from the custom suffix.
4. If sign-in fails with the Windows broker: copy dialog 2, then repeat once with
   `microsoft-authentication.implementation = msal-no-broker` to capture the AADSTS code. Reset the
   setting afterward.

## What checked out

- The installed Azure-auth helper chooses its provider from the same configured Azure environment
  used by the interactive resolver. The built-in cloud names and resources match.
- The existing public resource and scope remain byte-for-byte unchanged; targeted tests pin them.
- Built-in audience selection does not add ARM lookups. Successful custom ARM metadata is cached,
  while failed lookups are retryable.
- Managed identity does not use the VS Code sign-in cloud to decide its audience, as required by D7.
- Shell and playground request their scopes on the main thread. Both token sources and the
  custom host-suffix configuration are wired through the affected integration paths.
- The Entra diagnostics provider returns explanations without rewriting errors or recovering.
  Known AADSTS codes take precedence over opaque broker hints; cancellation and unrelated-error
  cases have focused tests.

## Observability limitation, not a third finding

The new cloud-resolution details are local output records, not properties attached to
`connect.startup`. `entraSignIn.classified` is emitted when an error text matches a rule; it can
also be emitted without a recent token-failure record, with an unknown cloud/auth method.

Consequently:

- Classification-event counts are not connection success/failure rates.
- Resolution errors and ordinary database authentication rejections after successful token
  acquisition are not classified by this provider.
- Existing startup outcomes and correlated domain metadata offer partial evidence for known
  host domains, but not the audience selected or why it was selected.
- Provider events intentionally lack correlation IDs in the accepted plan. That is not a defect
  raised by this review.

Broader cloud-attributed startup telemetry would require a separate scope decision. For the
current design, accurate local traces are particularly important, which is why R2 is actionable.
The second pass recommends taking that decision before release (S1, S2), because without
sovereign access, field telemetry is the main way to learn whether the feature works.

## Evidence and verification

### Local checks

Verification is **Case 1: still working**, because this is a review of a draft PR, not a request to
mark it ready for review.

| Check | Result |
| --- | --- |
| `npm run build` | Passed, including workspace prebuilds |
| Focused Vitest run: auth resolver/scopes/allowed hosts/handlers/Entra errors, shell/playground worker integration, copy connection string, connection-string input, diagnostics service, auth traces | 15 files, 297 tests passed |
| Settings contribution suite | 11 tests passed |
| Temporary characterization probes of R1/R2 | 5 tests passed; removed after execution |
| Second pass: temporary probes for R1 to R6 and the edge cases below | 19 tests passed (`npx vitest run`, two files); removed after execution |

The IDE test runner did not discover these files, so the suites were run with the repository's
`npx vitest run` command. One initial temporary-probe assertion incorrectly equated absent object
keys with present `undefined` values; correcting the assertion verified the missing keys. This
was a probe error, not a failing product test.

The full local Case 2 checks, including `prettier-fix`, were deferred until ready for review:
localization generation/check, formatting, lint, strict package-test type checking, the full runtime
suite, and packaging were not run in this review.

GitHub checks inspected for the reviewed PR head were all successful, including static checks,
unit tests, packaging, VSIX inspection/activation, and the merge gate. That is separate CI evidence,
not a claim that this review ran the local Case 2 list.

### External facts verified without cloud credentials

- [US Government ARM metadata](https://management.usgovcloudapi.net/metadata/endpoints?api-version=2022-09-01)
  returned `ossrDbmsResourceId: https://ossrdbms-aad.database.usgovcloudapi.net`.
- [China ARM metadata](https://management.chinacloudapi.cn/metadata/endpoints?api-version=2022-09-01)
  returned `ossrDbmsResourceId: https://ossrdbms-aad.database.chinacloudapi.cn`.
- [Azure China DocumentDB connection documentation](https://docs.azure.cn/en-us/documentdb/how-to-connect-role-based-access-control)
  explicitly uses `TOKEN_RESOURCE:https://ossrdbms-aad.database.chinacloudapi.cn`.

These support the audience table. They do not establish Government DocumentDB data-plane acceptance,
VS Code client preauthorization, broker behavior, or a customer's private DNS/proxy configuration.

Second pass:

- The same China page uses `*.global.mongocluster.cosmos.azure.cn` hosts and
  `ALLOWED_HOSTS: ['*.azure.cn']`. This matches `oidcAllowedHosts.ts` and the China row of D7, and
  is the basis of R3.
- The Government host suffix (`azure.us`) remains operator-confirmed (D7), not publicly documented.
- Research §8 documents only `AZUREPUBLICCLOUD` for IMDS `azEnvironment`. Third-party summaries
  list `AzureUSGovernmentCloud` and `AzureChinaCloud`, but this is not authoritative, which is why
  S3 captures evidence rather than adding a mapping.

### Second-pass edge cases examined

| Case | Observed | Assessment |
| --- | --- | --- |
| Interactive, public setting, private DNS host | Public audience, no mismatch check | Correct per D8 |
| Replica set mixing `azure.com` and `azure.us` hosts | No host cloud; `ALLOWED_HOSTS` is `*.azure.com,*.azure.us` | Acceptable; unrealistic topology |
| `mongodb+srv://` alias under a private domain whose SRV targets `azure.us` | No host cloud from the alias; `ALLOWED_HOSTS` defaults to `*.azure.com`, so the driver rejects the `azure.us` targets | **Sovereign-specific.** The same alias works in the public cloud only because the default happens to be `*.azure.com`. Consider deriving `ALLOWED_HOSTS` from the configured interactive cloud when the host is unclassified, or document it under R9; S4 makes it diagnosable |
| Copy, managed identity, private host, `USGovernment` setting | Government audience (`reason: setting`) | Documented copy policy; it can disagree with connect-time D7, which ignores the setting. Acceptable because the copy is editable |
| Text with `platform_broker_error` and AADSTS65002 | `firstPartyPreauthorization`, `brokered: true` | Correct precedence |
| Text with AADSTS50001 and AADSTS500011 | `resourceNotInTenant` (rule order, not text order) | Acceptable; document that rule order is the precedence |
| HTML-escaped preauthorization phrase only | `firstPartyPreauthorization` | Correct |
| IMDS request through a VS Code proxy or a stalled body | Resolves `undefined` on error or socket timeout | Acceptable. The managed identity token request uses the same patched `http` stack, so a proxy that breaks IMDS breaks the token anyway |
| Shell/playground token refresh | The audience is re-resolved on every worker request; managed identity with a private host repeats IMDS (2 s timeout) | Acceptable at hourly refresh; consider caching the IMDS outcome for the window |
| Diagnostics provider order and deadline | The Entra provider is registered last and is synchronous; the service deadline is shared across providers | Low risk; it depends on earlier providers declining Azure clusters quickly, which this pass did not trace in detail |
| Managed identity token errors | The provider rethrows a described message; the uncategorized branch keeps the original text, so AADSTS codes generally survive for classification | Acceptable; categorized branches drop the code, but those reasons are not Entra-classifier rules |
| Driver `ALLOWED_HOSTS` enforcement (7.2.0) | Enforced after SRV resolution for callback OIDC unless `ENVIRONMENT` is set; the extension never sets it | Confirms that `ALLOWED_HOSTS` is a real control, which is the basis of R5 |

## Decisions respected and remaining rollout gates

- The service-side preauthorization dependency is acknowledged, not an extension bug to work
  around with another client ID or public-cloud fallback (D1).
- Refusing unknown sovereign IMDS values is intentional (D7), not a missing mapping to invent.
- Synchronous best-effort public fallback when copying an otherwise unknown managed-identity
  connection string is explicitly documented in the implementation plan. It is not the runtime
  connection policy.
- Lack of sovereign end-to-end access is an accepted constraint (D2). Preserve that limitation in
  release claims rather than treating fixture tests as real-cloud validation.
- The China compatibility check in D11 is still a shipping gate. This review did not query
  production telemetry or establish whether existing China connections accept the public audience.
  S7 lists the hashed domain values that make the query possible with existing data.
- When the Microsoft-side change is available, obtain a reporter-run preview check that covers
  token acquisition and an actual database command, not merely successful resource listing.
