---
feature: aws-discovery
kind: review
status: active
created: 2026-11-04
pr: https://github.com/microsoft/vscode-documentdb/pull/1057
---

# AWS discovery PR #1057 review

## Scope and evidence

This review covers AWS credential onboarding, discovery services and trees, connection recovery,
and the browser verification harness. A rubber-duck subagent reassessed the original findings
against local source and relevant tests on 2026-11-04. It reported the inspected head as
`ceb4af15e8bb35464ac228e2e3af8de587dec06c`, matching the original review snapshot.
This rewrite records that assessment; it does not implement fixes or accept design changes.

The [feature scope](../README.md#1-confirmed-scope) explicitly covers provisioned DocumentDB
clusters, preserves role-backed and MFA profiles, and permits saving a verified identity even
when regional discovery is denied. These constraints govern the recommendations below.

Source inspection establishes local control flow, not successful reproduction against live AWS.
Confidence is therefore distinguished from severity and priority. GitHub comments and CI results
below are historical snapshots, not freshly retrieved remote state.

## Critical assessment

- **Fix session preservation first.** Save, update, reauthentication, and discovery refresh must
  not discard a usable verified identity. Global invalidation and entry-specific invalidation
  have different blast radii; do not remove the service's legitimate pre-replacement invalidation.
- **Recovery must actually retry.** A visual tree refresh does not clear cached recovery children.
  Certificate replacement and credential changes outside the tree need explicit cache reset.
- **Separate impact from urgency.** A harness routing defect can block verification without being
  a severe production defect. Conversely, an inaccessible validation error is not merely cosmetic.
- **Narrow unsupported assertions.** Backup-related availability is a stronger case than claiming
  every maintenance or failover state accepts new connections. The first-region STS concern needs
  endpoint validation, and the TLS diagnosis needs an actual driver-error sample.
- **Respect confirmed scope.** Elastic discovery is not a missing implementation requirement.
  Clarifying provisioned-only wording is a separate, low-priority improvement.
- **Avoid refactoring as a prerequisite.** Mixed-failure guidance needs a targeted fix; extracting
  shared Atlas/AWS builders is optional follow-up, not required to correct the behavior.

## Severity and priority

Severity describes impact: **High** breaks a supported core workflow; **Medium** impairs a
workflow, recovery, accessibility, or verification; **Low** is clarity or polish.
These are functional review ratings, not security vulnerability ratings.

Priority describes recommended scheduling:

- **P1:** Fix before release or before relying on the affected verification gate.
- **P2:** Normal corrective follow-up; address before calling the affected workflow validated.
- **P3:** Optional polish or investigation; not a confirmed release blocker.

Priorities are review recommendations, not recorded author decisions.

## Issue summary

Original finding numbers are retained for provenance. Findings 7 and 10 are split because their
subissues have different impact or independent fixes.

| ID  | Severity | Priority | Status   | Issue title                                                       | Assessment                                       |
| --- | -------- | -------- | -------- | ----------------------------------------------------------------- | ------------------------------------------------ |
| 1   | High     | P1       | Resolved | Preserve verified identities across save and discovery refresh    | Confirmed control flow                           |
| 2   | Medium   | P1       | Resolved | Accept AWS credential reports in the browser harness              | Confirmed                                        |
| 3   | Medium   | P2       | Resolved | Clear cached cluster errors after CA replacement                  | Confirmed                                        |
| 4   | Medium   | P2       | Resolved | Clear AWS root errors after credential changes outside the tree   | Confirmed                                        |
| 5   | Medium   | P2       | Blocked  | Do not reject a reachable cluster solely because it is backing up | Narrowed; broader state policy needs validation  |
| 6   | Medium   | P2       | Resolved | Treat superseded discovery scans as cancellation                  | Confirmed control flow                           |
| 7a  | Medium   | P2       | Resolved | Give accurate recovery guidance for mixed failures                | Confirmed                                        |
| 7b  | Low      | P3       | Resolved | Correct recovery-row wording and assess cosmetic differences      | Confirmed differences; not all are defects       |
| 8   | Low      | P3       | Resolved | Clarify that discovery lists provisioned clusters only            | Scope clarification, not missing Elastic support |
| 9   | Medium   | P2       | Blocked  | Decouple identity verification from the first discovery region    | Conditional; endpoint behavior needs validation  |
| 10a | Medium   | P2       | Resolved | Preserve approved SSO state when returning to the form            | Confirmed                                        |
| 10b | Medium   | P2       | Resolved | Associate expiration validation with its input                    | Confirmed accessibility gap                      |
| 11  | Low      | P3       | Blocked  | Validate diagnostics for TLS-disabled clusters                    | Investigation, not a confirmed diagnostic defect |

## Issues and solution paths

### 1. [Resolved] Preserve verified identities across save and discovery refresh

**Severity:** High  
**Priority:** P1  
**Confidence:** High for invalidation paths; live MFA reproduction remains outstanding.

**Status:** Resolved. Credential onboarding no longer invalidates the verified session after
successful save/update, and discovery-only refreshes clear the discovery snapshot without evicting
verified identities. Retry also preserves the cached identity; removal and replacement retain
entry-specific invalidation.

**Issue description:** Adding a credential calls unscoped `invalidate()` after `verifyAndSave()`
has cached the verified identity. Root Refresh/Retry and wizard refresh also invalidate all
identities. This discards unrelated sessions as well as the newly verified session. Subsequent
noninteractive profile resolution cannot satisfy a new MFA challenge. Update/reauthenticate
also invalidate a specific entry after successful verification; entry-specific Retry invalidates
that entry without necessarily obtaining a new interactive session.

**Evidence:** [credential management](../../../../../src/plugins/service-aws-documentdb/credentialsManagement/configureAwsCredentials.ts#L45)
(also lines 146, 151, and 189);
[invalidation and identity replacement](../../../../../src/plugins/service-aws-documentdb/discovery/AwsDiscoveryService.ts#L204)
(also lines 335-336);
[root refresh](../../../../../src/plugins/service-aws-documentdb/discovery-tree/AwsServiceRootItem.ts#L167);
[wizard refresh](../../../../../src/plugins/service-aws-documentdb/discovery-wizard/SelectAwsClusterSteps.ts#L58).

**Solution path:**

1. Remove redundant post-success invalidation from Add, Update, and Reauthenticate.
2. Expose a narrow snapshot-refresh operation around the existing private snapshot invalidation
   behavior. Use it for discovery-only refresh instead of clearing identities.
3. Distinguish discovery Retry from explicit reauthentication. Preserve valid sessions for Retry;
   use the interactive verification path when a profile really requires a new MFA challenge.
4. Preserve invalidation needed for removal, expiry, and replacing an identity. In particular,
   keep the service's invalidate-before-cache-replacement ordering inside `verifyAndSave()`.

**Acceptance:** Verify/save an MFA profile, then list clusters without another profile-provider
challenge. Repeat after root and wizard refresh and after successful update/reauthentication.
With two entries, refreshing one must not evict the other's identity. Removal and expiry must
still prevent reuse of invalid credentials.

**Validation:** `npx vitest run src/plugins/service-aws-documentdb/discovery/AwsDiscoveryService.test.ts`
passed (19 tests), including a regression test that verifies discovery refresh does not request
MFA again.

**Provenance:** [Copilot thread 1](https://github.com/microsoft/vscode-documentdb/pull/1057#discussion_r4455266700)
and the original deep-review extension. Copilot rated this High; the initial review rated it
Medium. This reassessment recommends High because the advertised profile/MFA workflow breaks
immediately after successful onboarding.

### 2. [Resolved] Accept AWS credential reports in the browser harness

**Severity:** Medium  
**Priority:** P1  
**Confidence:** High.

**Status:** Resolved. The harness accepts both AWS credential report paths, including the
`-broken-css` variant, while leaving unknown report paths rejected.

**Issue description:** The credentials fixture posts to `reports/awsCredentials`, but the harness
report-route allowlist omits that view. Both its normal and broken-CSS report variants are rejected
with HTTP 405. This breaks the affected integrated check even if the page assertions succeed;
historical standard-tier CI success does not establish that this route was exercised.

**Evidence:** [report allowlist](../../../../../build/verification/browser/harness.ts#L179);
[AWS fixture](../../../../../build/verification/browser/fixtures.ts#L262).

**Solution path:** Add `awsCredentials` to the existing report-route alternation so its existing
optional `-broken-css` suffix covers both routes. Keep unrelated routes rejected.

**Acceptance:** POST to both AWS report routes and assert the harness's normal successful report
response. An unknown report route remains rejected. Exercise the normal integrated check and
confirm the broken-CSS fixture still detects broken styling rather than failing on routing.

**Validation:** `npx vitest run --config build/verification/browser/vitest.config.ts harness.test.ts`
passed (15 tests), including both AWS report paths and an unknown-route rejection.

**Provenance:** [Copilot thread 2](https://github.com/microsoft/vscode-documentdb/pull/1057#discussion_r4455266777).
The comment is anchored to the fixture; the correction belongs in the harness.

### 3. [Resolved] Clear cached cluster errors after CA replacement

**Severity:** Medium  
**Priority:** P2  
**Confidence:** High.

**Status:** Resolved. The CA-selection command clears the selected cluster's cached error state
after certificate selection succeeds and before refreshing that node. Cancellation leaves the
existing error state unchanged.

**Issue description:** Selecting a replacement CA bundle refreshes the cluster node without
clearing its cached expansion failure. The discovery provider can return the previous recovery
children instead of retrying the connection with the replacement certificate.

**Evidence:** [CA selection command](../../../../../src/documentdb/ClustersExtension.ts#L777).

**Solution path:** After successful certificate selection, reset the affected node's error state
before refreshing it. Preserve cancellation behavior and do not clear unrelated nodes.

**Acceptance:** Cache a failed cluster expansion, select a valid replacement bundle, and verify
that the next expansion invokes the connection path rather than returning cached recovery actions.

**Validation:** `npm run build` passed. No command-level regression test was added.

**Provenance:** [Copilot thread 3](https://github.com/microsoft/vscode-documentdb/pull/1057#discussion_r4455266841).

### 4. [Resolved] Clear AWS root errors after credential changes outside the tree

**Severity:** Medium  
**Priority:** P2  
**Confidence:** High.

**Status:** Resolved. Credential changes without a tree node now reset only the AWS discovery
root's cached error state; a supplied node continues to receive a targeted reset.

**Issue description:** New Connection opens credential management without a tree node.
`refreshDiscoveryTree(node?)` clears cached errors only when a node is supplied, so successful
credential changes can leave stale AWS root recovery actions in the sidebar.

**Evidence:** [credential-management tree refresh](../../../../../src/plugins/service-aws-documentdb/credentialsManagement/configureAwsCredentials.ts#L24).

**Solution path:** Resolve the AWS root ID using the existing view/provider constants when no node
is supplied. Reset that root's error state before refreshing the view; preserve targeted refresh
when a node is supplied.

**Acceptance:** Seed an AWS root failure, save or update credentials through the no-node entry
point, and verify the next expansion rediscovers resources. Other providers' failures remain intact.

**Validation:** `npm run build` passed. No credential-management command test was added.

**Provenance:** [Copilot thread 4](https://github.com/microsoft/vscode-documentdb/pull/1057#discussion_r4455266897).

### 5. [Blocked] Do not reject a reachable cluster solely because it is backing up

**Status:** Blocked pending validation of AWS backup-state endpoint availability. No behavior
change is included.

**Severity:** Medium  
**Priority:** P2  
**Confidence:** High for the `available`-only guard; Medium for AWS state-specific impact.

**Issue description:** The shared connectability guard accepts only `status === 'available'`.
Consequently, a cluster reported as `backing-up` is rejected by tree expansion, wizard selection,
and Save to Connections even if its database endpoint remains reachable. The original review
overgeneralized this to maintenance, upgrading, modification, and failover without establishing
new-connection availability in every state.

**Evidence:** [connectability guard](../../../../../src/plugins/service-aws-documentdb/models/AwsClusterModel.ts#L23).

**Solution path:** Confirm the returned backup status and supported endpoint behavior, then make
the smallest justified change in the shared guard. Retain the endpoint requirement and rejection
of known unusable states. Do not replace the guard with an unverified denylist that permits unknown
states; validate additional transitional states separately before broadening the policy.

**Acceptance:** Cover available, validated backup, missing-endpoint, and known unusable-state
cases. Verify tree, wizard, and save paths use the same policy. Do not claim all failover or
maintenance connections succeed based on guard tests alone.

### 6. [Resolved] Treat superseded discovery scans as cancellation

**Severity:** Medium  
**Priority:** P2  
**Confidence:** High for cancellation propagation.

**Status:** Resolved. Root and wizard discovery translate only `AbortError` into the extension's
recognized cancellation type; credential-management retry also treats a superseded abort as
cancellation. Other errors still propagate.

**Issue description:** Snapshot invalidation aborts running scans. `listAll()` propagates
`AbortError`, while the tree/wizard callers do not translate it into the cancellation forms
recognized by the extension's error wrapper. Refreshing or changing credentials during discovery
can therefore surface "AWS operation cancelled." as a failure.

**Evidence:** [scan invalidation](../../../../../src/plugins/service-aws-documentdb/discovery/AwsDiscoveryService.ts#L196);
[root discovery](../../../../../src/plugins/service-aws-documentdb/discovery-tree/AwsServiceRootItem.ts#L103);
[wizard discovery](../../../../../src/plugins/service-aws-documentdb/discovery-wizard/SelectAwsClusterSteps.ts).

**Solution path:** Translate intentional scan aborts into the established cancellation type at
the discovery boundary or all affected callers. Ensure the replacement refresh can finish and
stale scans cannot publish obsolete results. Preserve genuine failure reporting; do not catch
all errors or return an empty success result. Sharing scans is optional, not required for this fix.

**Acceptance:** Abort a pending tree and wizard scan through refresh and credential change.
Assert no failure notification or cached error is produced for cancellation, replacement results
are current, and genuine service failures remain visible.

**Validation:** The combined AWS discovery, tree, and credential webview suites passed (33 tests),
including a root-scan `AbortError` cancellation check. The wizard cancellation path is not directly
covered by a new test.

### 7a. [Resolved] Give accurate recovery guidance for mixed failures

**Severity:** Medium  
**Priority:** P2  
**Confidence:** High.

**Status:** Resolved. Mixed credential and regional failures now direct users to resolve issues
and expose both causes, while credential-only and retry-only cases retain their specific actions.

**Issue description:** A mixture of credential and network failures receives only the
"revisit credentials" guidance. Users can be sent to re-enter working credentials without being
told that a separate reachability problem also needs attention.

**Evidence:** [AWS recovery rows](../../../../../src/plugins/service-aws-documentdb/discovery-tree/AwsServiceRootItem.ts#L105);
[Atlas comparison](../../../../../src/plugins/service-atlas-mongodb/discovery-tree/atlasTreeNodes.ts).

**Solution path:** Distinguish credential-only, retryable-only, and mixed failure guidance in the
AWS builder. Keep appropriate recovery actions and explanatory details available. Reuse an existing
helper if suitable, but do not require a cross-provider refactor to correct the label.

**Acceptance:** Cover credential-only, network-only, and mixed failures; mixed failures must not
imply that credential changes alone resolve the problem.

### 7b. [Resolved] Correct recovery-row wording and assess cosmetic differences

**Severity:** Low  
**Priority:** P3  
**Confidence:** High for the observed differences; no functional impact established for context values.

**Status:** Resolved. Singular counts now use “1 discovery failure”; retry-only rows use a retry
icon and explain that stored credentials may still be valid. Context values were left unchanged.

**Issue description:** The count can render "1 discovery failures". AWS also differs from Atlas
in retry icon, tooltip lead-in, and empty-row context value. These differences are not collectively
a Medium-severity bug, and Atlas parity alone is not proof of a requirement.

**Evidence:** [AWS row construction](../../../../../src/plugins/service-aws-documentdb/discovery-tree/AwsServiceRootItem.ts#L105);
[Atlas row helpers](../../../../../src/plugins/service-atlas-mongodb/discovery-tree/atlasTreeNodes.ts).

**Solution path:** Use existing localization conventions for singular/plural wording. Assess icon
and tooltip consistency separately. Change context values only after checking their consumers.
Consider shared builders only if they materially reduce duplication without changing provider behavior.

**Acceptance:** Assert correct singular and plural output. If presentation/context values change,
check the affected actions and menus; text snapshots alone cannot establish menu compatibility.

**Validation:** AWS discovery tree tests passed (7 tests), including singular/plural count, mixed
failure routing, and retry guidance.

### 8. [Resolved] Clarify that discovery lists provisioned clusters only

**Severity:** Low  
**Priority:** P3  
**Confidence:** High for the confirmed scope; wording improvement is optional.

**Status:** Resolved. The empty-state tooltip and provider description now specify provisioned
clusters only; no Elastic APIs or dependencies were added.

**Issue description:** Discovery uses the provisioned-cluster API, as required by the agreed scope.
The empty-state wording "No clusters found in the selected regions" can nevertheless imply that
every DocumentDB cluster type was searched. Missing Elastic discovery is not a functional defect
under the current agreement.

**Evidence:** [discovery API](../../../../../src/plugins/service-aws-documentdb/api/documentDb.ts#L47);
[confirmed resource scope](../README.md#1-confirmed-scope).

**Solution path:** Optionally clarify provisioned-only coverage in the empty-state tooltip and
onboarding hint. Do not add Elastic APIs or dependencies as a review fix; that requires a separately
approved scope change.

**Acceptance:** If wording changes, assert the scope qualifier is visible in the affected surfaces
without implying that an empty provisioned result means the account has no other cluster types.

**Validation:** The AWS discovery tree tests passed (7 tests), including the clarified empty-state
tooltip.

### 9. [Blocked] Decouple identity verification from the first discovery region

**Status:** Blocked pending a focused STS endpoint-resolution reproduction. No behavior change is
included.

**Severity:** Medium, conditional on the endpoint failure described below  
**Priority:** P2  
**Confidence:** Medium; no live reproduction.

**Issue description:** Identity verification and profile credential resolution use `regions[0]`.
An unactivated opt-in region can make a regional STS request fail with `InvalidClientTokenId`;
that code is classified as an authentication failure. If encountered here, valid credentials are
rejected before discovery can report an isolated regional failure. The selected region, partition,
STS endpoint behavior, and profile configuration must be established before treating this as reproduced.

**Evidence:** [identity verification and profile resolution](../../../../../src/plugins/service-aws-documentdb/discovery/AwsDiscoveryService.ts#L250)
(also lines 305 and 365).

**Solution path:** Add a focused endpoint-resolution reproduction first. If confirmed, select a
supported identity-verification region within the credential's partition and profile/SSO constraints,
independently of discovery ordering. Keep disabled-region discovery errors regional. Do not blindly
choose a global endpoint or reinterpret every `InvalidClientTokenId` as a disabled region.

**Acceptance:** Test first-region opt-in failure alongside a usable region, valid and invalid
credentials, relevant partitions, and profile/SSO configuration. Valid identity handling must not
depend on discovery-region ordering, and invalid credentials must still be rejected.

### 10a. [Resolved] Preserve approved SSO state when returning to the form

**Severity:** Medium  
**Priority:** P2  
**Confidence:** High.

**Status:** Resolved. Back to the same SSO form preserves the approved flow and account/role
selection after failed verification. Navigation to method selection, explicit cancellation, and
other back-navigation paths still clear the flow.

**Issue description:** After failed verification, Back navigates to the form through
`navigateBack('form')`, which calls `clearFlow()` and cancels SSO. Correcting a region or another
non-SSO field can require repeating browser approval.

**Evidence:** [Back navigation](../../../../../src/webviews/documentdb/awsCredentials/AwsCredentialsView.tsx#L803).

**Solution path:** Preserve approved flow/account/role state when returning to the same SSO form.
Cancel on method changes, explicit cancellation, or close, and invalidate state when SSO-defining
inputs change. Do not retain approved state beyond its validity or intended view lifetime.

**Acceptance:** Approve SSO, fail unrelated verification, return to the form, and verify approval
and selections survive. Switching method, changing SSO-defining inputs, cancellation, and close
must still clean up the flow.

**Validation:** `npm run build` and the AWS credential webview test suite passed. No direct SSO
Back-navigation regression test was added.

### 10b. [Resolved] Associate expiration validation with its input

**Severity:** Medium  
**Priority:** P2  
**Confidence:** High.

**Status:** Resolved. The expiration input now owns the Fluent UI error state and validation
message; correcting the value clears the message and restores submission eligibility.

**Issue description:** Invalid temporary-credential expiration is rendered as standalone text,
not the field's validation message/state. Assistive technology cannot reliably associate the
reason with the input, while the primary action is disabled. This affects error recovery, not
just visual consistency.

**Evidence:** [expiration validation](../../../../../src/webviews/documentdb/awsCredentials/AwsCredentialsView.tsx#L639).

**Solution path:** Use the existing Fluent UI Field validation pattern to associate the localized
message and error state with the expiration input. Preserve current validation rules and make the
reason for the disabled action available without relying on color.

**Acceptance:** For invalid/expired values, assert an accessible association between input and
validation message, not merely that the text exists. Valid input clears the error and enables
the action when other requirements are satisfied.

**Validation:** The AWS credential webview tests passed (7 tests), including an `aria-describedby`
association check and valid-value recovery.

### 11. [Blocked] Validate diagnostics for TLS-disabled clusters

**Status:** Blocked pending a sanitized representative driver error. No diagnostic behavior change
is included.

**Severity:** Low, investigation only  
**Priority:** P3  
**Confidence:** Low for the claimed misleading diagnostic; High that strict TLS is intentional.

**Issue description:** Connections deliberately require TLS and a CA file. The original review
assumed that a TLS-disabled endpoint would produce CA-specific advice, but the actual driver
error may instead match a network diagnostic or no specialized branch. That diagnostic defect
has not been established.

**Evidence:** [strict TLS connection setup](../../../../../src/plugins/service-aws-documentdb/connect/awsConnection.ts#L77);
[diagnostic matching](../../../../../src/plugins/service-aws-documentdb/AwsDiagnosticsProvider.ts).

**Solution path:** Obtain a sanitized representative driver error and test its diagnostic path.
If guidance is misleading, mention server TLS configuration as a possibility without asserting
an unverified root cause. Preserve strict TLS and certificate/hostname verification.

**Acceptance:** Use the captured error shape to verify the selected diagnostic; keep separate
certificate, reachability, and unknown-error cases. A fabricated error that merely matches the
desired branch does not validate the original claim.

## Subsequent PR review comments

- **[Resolved] Parse indented AWS profile assignments.** The INI parser now accepts trimmed
  assignments regardless of indentation, with coverage for profile and SSO-session properties.
- **[Resolved] Re-resolve identity on authentication retry.** Explicit credential Retry clears and
  re-resolves the selected identity only after an authentication failure; permission-only retries
  and ordinary discovery refreshes preserve verified identities.
- **[Resolved] Allow custom AWS discovery regions.** The credential form accepts syntactically valid
  region identifiers beyond the suggested list, including China and GovCloud examples.

## Historical review and CI provenance

The previous document recorded a GitHub snapshot retrieved on 2026-11-04 for head
`ceb4af15e8bb35464ac228e2e3af8de587dec06c`, targeting `feature/aws-discovery`.
It reported four unresolved, non-outdated inline threads with no replies, mapped to issues 1-4
above. Findings 1 and 4 were also independently raised in the original deep-review follow-up.
The rubber-duck pass did not refresh GitHub state or resolve threads.

- [Submitted Copilot review](https://github.com/microsoft/vscode-documentdb/pull/1057#pullrequestreview-5752943022):
  author `copilot-pull-request-reviewer[bot]`, review ID `5752943022`, submitted
  `2026-11-03T13:25:04Z`, state `COMMENTED`, verdict "Changes recommended", effort "Balanced".
  Copilot rated finding 1 High and findings 2-4 Medium.
- The submitted report described profile, access-key, SSO, and temporary-credential onboarding;
  discovery/tree integration; CA selection and diagnostics; dependencies, tests, fixtures, and
  documentation. Its "Case 1 draft work" wording was historical: the previous retrieval instead
  reported a non-draft PR. Neither statement establishes current handoff readiness.
- [CI conversation comment](https://github.com/microsoft/vscode-documentdb/pull/1057#issuecomment-6599095292):
  `github-actions[bot]`, created `2026-11-03T08:38:53Z`, updated `2026-11-03T10:00:01Z`.
  It reported a passing [standard-tier run](https://github.com/microsoft/vscode-documentdb/actions/runs/41614980118)
  for `ceb4af1`, including static checks, unit tests, package tarball checks, VSIX inspection,
  activation checks, and unbundled webview-host checks. Localization, ESLint, and Prettier were
  reported passing; E2E was unavailable, with no full-tier run reported.
  Reported VSIX size was 9,098,989 bytes, without a base comparison.
- The previous retrieval reported one submitted review, one general conversation comment, and
  exhausted pagination. It recorded no author replies or acceptance decisions.

## Validation and decisions still open

This implementation follow-up resolves issues 1-4, 6-8, and 10a-10b. Issues 5, 9, and 11 remain
blocked as noted above; no behavior changes were made for them. The work was verified with
`npm run build`, `npm run l10n:check`, the focused AWS discovery/credential tests (33 passing),
and the browser harness tests (15 passing). No live AWS flow or browser integration run was
performed. Issues 3, 4, and 10a have no dedicated regression test; their code paths compile, but
the corresponding interactive behavior remains unverified by an automated test.

The subsequent PR-comment fixes were verified with `npm run l10n`, `npm run build`, and the focused
profile, discovery-service, and credential-webview suites (34 tests passing); `git diff --check`
also passed.

The prior review separately reported **64 passing tests** for the initial pass and **96 passing
tests plus `npm run l10n:check`** for the deep-review follow-up. Exact commands and suite scopes
were not preserved sufficiently to reconcile those counts. Keep them as separate historical
reports, not a combined count or proof that the identified paths are covered.

No author acceptance or scope changes are recorded here. Before implementing broader behavior
changes, validate the state policy in issue 5, endpoint behavior in issue 9, and driver-error
evidence in issue 11. Provisioned-only scope and strict TLS remain unchanged.

For implementation follow-up, record decisions and rationale after operator agreement. Completion
still requires the relevant regression tests and the independent review/handoff requirements in
[CONTRIBUTING.md](../../../../../CONTRIBUTING.md); this document does not establish that those gates
or the full Case 2 checks have passed.
