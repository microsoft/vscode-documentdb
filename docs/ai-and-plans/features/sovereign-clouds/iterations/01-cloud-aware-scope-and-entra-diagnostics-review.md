---
feature: sovereign-clouds
kind: review
status: active
---

# Sovereign cloud connectivity: correctness review

- PR: [#1050](https://github.com/microsoft/vscode-documentdb/pull/1050).
- Reviewed on: 2026-10-26.
- Head: `e98e2f40b686c702143ed30b0664624c2ffabeaa`.
- Base: `e15fa6c12e64ad9483e1211805956043ce91720d` (`main`, also the merge base).
- Scope: audience and authority selection, managed identity, worker token delivery, copied connection
  strings, error translation, support traces, telemetry, and public-cloud regressions.
- Constraint: no sovereign-cloud account, VM, or cluster was used. Passing local tests and reading
  public ARM metadata are not evidence of successful sovereign-cloud authentication.

This is a review, not an implementation pass. Product code is unchanged. Author decisions below
remain open; recommendations are not approvals to implement a different design.

## Verdict

**Request changes for two P2 findings before relying on this implementation for remote
troubleshooting.** No P0/P1 issue or additional high-confidence correctness defect was established.
The cloud audience table and the main token-delivery paths are supported by the inspected code,
local tests, installed SDK behavior, and public metadata. Successful sovereign authentication is
still unverified.

| ID | Priority | Finding | Confidence | Validation |
| --- | --- | --- | --- | --- |
| R1 | P2 / medium | Invalid explicit audience overrides silently fall through | High (99%) | Code trace, local reproduction, separate reviewer confirmed |
| R2 | P2 / medium | Support traces omit or misstate available cloud evidence | High (99%) | Three local reproductions, separate reviewer confirmed |

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
5. Author decisions and fixes: not started.

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

**Author decision:** pending.

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

**Author decision:** pending.

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
- When the Microsoft-side change is available, obtain a reporter-run preview check that covers
  token acquisition and an actual database command, not merely successful resource listing.
