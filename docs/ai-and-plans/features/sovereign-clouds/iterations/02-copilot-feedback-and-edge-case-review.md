---
feature: sovereign-clouds
kind: review
status: active
---

# Sovereign clouds: Copilot feedback verification and edge-case review

## Snapshot and scope

- Reviewed on **2026-11-03**.
- PR: [#1050](https://github.com/microsoft/vscode-documentdb/pull/1050).
- Reviewed head: `7f2a288aa23369dbc26a95bfe7b93ec4cae0205c`; the local checkout and
  GitHub head matched. Base branch: `main`.
- Latest submitted Copilot review:
  [review 5751720999](https://github.com/microsoft/vscode-documentdb/pull/1050#pullrequestreview-5751720999),
  submitted **2026-11-03 at 11:53:18 UTC** by `copilot-pull-request-reviewer[bot]`.
  GitHub returned one submitted review from this reviewer, with five inline comments.
  All five threads were unresolved at retrieval.
- This is a **review-only iteration**. No runtime fixes, test changes, thread resolutions,
  GitHub replies, commits, or pushes were made. Temporary reproduction tests were removed.
- The PR is **not a draft** at this snapshot. Copilot's overview and the earlier iteration
  still describe a draft; those statements are stale, not evidence of its present state.
- Scope: all five comments, audience-selection branches, worker/cache lifetime, diagnostic
  context, classifier precedence, relevant tests, current design decisions, and user guidance.
  No live sovereign account, VM, database, or token endpoint was used.

Copilot's review overview:

> Credential eviction can break token refresh in existing shells and playgrounds, while
> case-sensitive failure tracking and incorrect managed-identity guidance make authentication
> diagnostics unreliable.

The original comments are retained below, with permanent links. The assessments and priorities
are independent of Copilot's wording.

## Verdict

**All five Copilot comments are valid.** The worker-refresh regression is the highest-priority
item. The wider review found **three additional defects/intent mismatches** and **one
configuration-hardening gap**. None of the offline results establishes successful sovereign
authentication or resolves the service-side preauthorization dependency.

Priority definitions:

- **P1 / High:** an ordinary operation can break an existing primary workflow.
- **P2 / Medium:** incorrect remediation, loss of a promised guard, or materially misleading
  configuration guidance; bounded conditions or workarounds exist.
- **P3 / Low:** narrower diagnostic/documentation defects or defensive hardening.

Confidence measures confidence in the described behavior, not its production frequency.

| ID  | Independent priority | Assessment                                                                                       | Confidence                                          |
| --- | -------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| C1  | P2 / Medium          | Valid: managed-identity errors recommend an irrelevant interactive cloud setting                 | 10/10                                               |
| C2  | P3 / Low             | Valid: case-variant cluster IDs lose or fail to clear diagnostic context                         | 10/10                                               |
| C3  | P1 / High            | Valid: credential eviction breaks existing worker token refresh, including public-cloud sessions | 9/10                                                |
| C4  | P3 / Low             | Valid: upstream issue reports Government as well as China cache failures                         | 10/10 for the documentation claim                   |
| C5  | P2 / Medium          | Valid: Settings text hides the global precedence of the managed-identity override                | 10/10                                               |
| E1  | P2 / Medium          | Additional intent mismatch: a broker marker discards an available unknown AADSTS code            | 10/10                                               |
| E2  | P2 / Medium          | Additional guard gap: one unclassified seed erases a known sovereign-host mismatch               | 10/10 for resolution; live topology unverified      |
| E3  | P3 / Low             | Hardening gap: a custom override can contradict a known login authority without warning          | 10/10 for acceptance; not an observed cloud sign-in |
| E4  | P3 / Low             | Additional lifecycle defect: an abandoned worker can overwrite current failure context           | 10/10                                               |

### Second opinion (2026-11-04)

An independent pass re-checked every finding on the same head (`7f2a288`) by reading the code
and running throwaway probes, which were deleted afterwards. **All nine findings reproduce.**
The disagreements are about severity and, for C3, the fix approach. Notes marked
**Second opinion** under each finding give the details.

| ID  | Review priority | Second-opinion severity                                                                         | Before merge?                 | Recommended option                                        |
| --- | --------------- | ----------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------- |
| C3  | P1              | **P1, agree**. The impact is wider than stated (see C3)                                         | **Yes, blocker**              | **A (per-worker snapshot)**, not B; B becomes a follow-up |
| C5  | P2              | P2, agree                                                                                       | Yes (text only)               | A                                                         |
| C1  | P2              | **P3**. In practice only AADSTS500011 reaches managed identity, and the raw error stays visible | Yes, if cheap                 | A, plus a fallback to the cached auth method (see C1)     |
| C2  | P3              | P3, agree                                                                                       | Yes (one-line fix)            | A                                                         |
| C4  | P3              | P3, agree (upstream impact line verified)                                                       | Yes (text only)               | A                                                         |
| E1  | P2              | **P3**. The code still appears in the modal `detail`                                            | Optional                      | A, after the operator accepts changing the pinned test    |
| E2  | P2              | **P3**. Unusual topology; the failure still happens, just later; no token leak                  | Follow-up                     | Smaller variant of A                                      |
| E3  | P3              | **P4**. Niche misconfiguration; the resulting 500011 is already explained                       | Docs only                     | C now (qualify D6); A optional later                      |
| E4  | P3              | **P4 / nit**. Affects diagnostic wording only, inside a 10-minute window                        | Only together with the C3 fix | A, folded into C3                                         |

Severity scale: P1 to P3 as defined below; **P4** means a nit or watch item with no user-facing
failure.

### Operator decisions (2026-11-04)

The operator (@tnaum-ms) reviewed the second opinion and decided the following. Each finding
has an **Operator decision** note with the specifics.

| ID  | Decision                                                                                                                                                                                                                                                                                                              | When                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| C1  | Accepted as recommended: narrowed option A                                                                                                                                                                                                                                                                            | Before merge                    |
| C2  | Accepted as recommended: option A (`CaseInsensitiveMap`)                                                                                                                                                                                                                                                              | Before merge                    |
| C3  | Accepted after discussion ([D12](../decisions.md#d12-open-sessions-keep-what-they-started-with)): pin the audience per session, Update Credentials writes through and stops the playground worker, modal only when a shell is open; Disconnect is [#1059](https://github.com/microsoft/vscode-documentdb/issues/1059) | Before merge (fix); #1059 later |
| C4  | Accepted as recommended: option A, with the suggested wording                                                                                                                                                                                                                                                         | Before merge                    |
| C5  | Accepted as recommended: option A                                                                                                                                                                                                                                                                                     | Before merge                    |
| E1  | Accepted as recommended: option A. The precedence change is approved; record it in D9                                                                                                                                                                                                                                 | Before merge                    |
| E2  | Accepted as recommended: the smaller variant of option A                                                                                                                                                                                                                                                              | Follow-up                       |
| E3  | Accepted as recommended: option C (qualify D6 and the resolver JSDoc); A is not planned                                                                                                                                                                                                                               | Before merge (docs)             |
| E4  | Accepted as recommended: option A, folded into the C3 fix                                                                                                                                                                                                                                                             | With C3                         |

### Reading the solution ratings

Each option has an **upside score** and a **downside score**, independently rated from 1 to 5.
Higher upside means better coverage/usefulness; higher downside means more implementation cost,
behavioral disruption, or residual correctness risk. These are engineering judgments, not
measurements. Recommended options are proposals, **not approved design decisions**.

## Verified Copilot feedback

### C1. Managed-identity errors receive interactive-cloud remediation

**Source:** [comment 4454295437](https://github.com/microsoft/vscode-documentdb/pull/1050#discussion_r4454295437),
on [entraErrorRules.ts](../../../../../src/documentdb/auth/entraErrors/entraErrorRules.ts#L34).

> Managed-identity AADSTS500011 failures also reach this rule, but
> `microsoft-sovereign-cloud.environment` does not select their token audience, so this advice
> cannot fix an incorrect audience override. Forward the registry's `authMethod` into
> `EntraErrorContext` and direct managed-identity users to verify or clear
> `documentDB.customEnvironment.ossrdbmsEndpoint` and check the VM/cluster cloud. Apply the same
> distinction to the cloud-setting advice at lines 66 and 75.

**Assessment: valid, P2.** The registry already retains `authMethod`, but
[EntraDiagnosticsProvider](../../../../../src/documentdb/auth/entraErrors/EntraDiagnosticsProvider.ts#L32)
passes it only to telemetry, not to the explanation context.
[The rules](../../../../../src/documentdb/auth/entraErrors/entraErrorRules.ts#L34) for 500011,
700016, and 90002 consequently recommend the same interactive setting for both token sources.
[Managed-identity resolution](../../../../../src/documentdb/auth/documentdbTokenResource.ts#L176)
does not use that setting to choose an audience.

Three probes recorded a managed-identity failure and explained each code. Every explanation
contained `microsoft-sovereign-cloud.environment`; none named the audience override.
This confirms misleading guidance, not a defect in the actual token selection.

**Documentation cross-check:** [D7](../decisions.md#d7-managed-identity) and the
[managed-identity user instructions](../../../../user-manual/sovereign-clouds.md#managed-identity)
explicitly exclude the VS Code sign-in cloud as a managed-identity signal.

| Option                                                                                             | Upside /5 | Downside /5 | Pros                                                                                                 | Cons                                                                                               |
| -------------------------------------------------------------------------------------------------- | --------- | ----------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **A. Pass optional `authMethod` into the existing rule context; branch the affected explanations** | 5         | 2           | Reuses the existing registry and single rule table; provides actionable instructions for each source | Requires localized variants and an explicit unknown-context branch                                 |
| B. Use one explanation listing both interactive and managed-identity remedies                      | 3         | 2           | Works even without a recent failure record; small implementation                                     | Longer modal headings; users still have to identify the relevant branch                            |
| C. Add a separate managed-identity diagnostics provider                                            | 2         | 4           | Independent wording ownership                                                                        | Duplicates AADSTS routing and introduces precedence issues; conflicts with the single-table intent |

**Recommend A.** Missing/expired context must produce neutral wording, not silently default to
interactive sign-in. For managed identity, check or clear the override and verify the VM/cluster
cloud and identity/tenant; do not promise that changing the interactive setting will help.
Also audit the other account-selection rules for inappropriate interactive instructions rather
than assuming only these three strings need attention.

**Acceptance checks:** all three codes across interactive, managed identity, and unknown context;
both `Error` and string input; no raw identity data added to telemetry; no error wrapping or UI
side effects inside the provider.

> **Second opinion: confirmed, but P3 rather than P2.**
>
> - **Confirmed.** `EntraErrorContext` has no `authMethod`. The 500011, 700016 and 90002 rules all
>   name `microsoft-sovereign-cloud.environment`.
> - **Why lower.** Realistically only **AADSTS500011** comes back from IMDS-issued managed-identity
>   tokens. A managed identity's own app always exists in its own tenant, so 700016 and 90002 are
>   interactive-client or tenant-lookup failures. Also, every surface keeps the raw error visible:
>   for example, [ClusterItemBase](../../../../../src/tree/documentdb/ClusterItemBase.ts) passes
>   `detail: errorMessage` to the modal. The wording is wrong, but it does not hide evidence.
> - **Option A refinement.** Don't rely on the 10-minute registry alone. Use
>   `failure?.authMethod ?? CredentialCache.getCredentials(clusterId)?.authMechanism`. The cached
>   credential knows the auth method even after the record expires or under a casing mismatch
>   (C2), which makes the "unknown" branch rare. When the method is still unknown, keep the
>   current interactive wording, since interactive users are the large majority. Making every
>   message neutral would weaken guidance for them to cover a rare case.
> - Only **500011 needs a managed-identity variant**. Adding variants for 700016 and 90002 costs
>   extra l10n strings without a realistic trigger.
> - **Recommendation:** A, narrowed as above, before merge. It is small.

> **Operator decision (2026-11-04): accepted as recommended.** Add `authMethod` to
> `EntraErrorContext`, taken from the failure record and falling back to the cached credential's
> auth method. Add a managed-identity variant for AADSTS500011 only. When the method is still
> unknown, keep the current interactive wording. Fix before merge.

### C2. Failure context uses a different cluster-key contract from credentials

**Source:** [comment 4454295514](https://github.com/microsoft/vscode-documentdb/pull/1050#discussion_r4454295514),
on [entraTokenFailures.ts](../../../../../src/documentdb/auth/entraErrors/entraTokenFailures.ts#L17).

> A cluster ID can differ in casing between cached credentials and a diagnostics caller:
> credential lookup succeeds because `CredentialCache` uses `CaseInsensitiveMap`
> (`src/documentdb/CredentialCache.ts:54-57`), but this registry then misses the failure or fails to
> clear it. Use the same case-insensitive map here so sovereign-cloud explanations and failure
> telemetry survive case-variant lookups.

**Assessment: valid, P3 rather than a connection blocker.**
[CredentialCache](../../../../../src/documentdb/CredentialCache.ts#L54) explicitly handles
Azure resource casing variations. The new registry uses a plain `Map`.
A cached credential can be found with one casing while its stored `clusterId`, used by the
handler when recording a failure, has another.

The probe set credentials and a failure under `AzureResource`:

1. Credential lookup for `azureresource` succeeded.
2. Failure lookup for `azureresource` returned `undefined`.
3. Clearing `azureresource` left the failure under `AzureResource` intact.

The practical effect is missing or stale cloud/auth-method context and wrong classification
dimensions. Direct AADSTS classification still works, and this map does not choose token scopes.
That limits severity even though the inconsistency is certain.

**Documentation cross-check:** the stable `clusterId` contract in
[CredentialCache](../../../../../src/documentdb/CredentialCache.ts#L12) and the
[tree architecture](../../../../../.github/skills/tree-cluster-architecture/SKILL.md#dual-identity-contract)
applies across consumers; casing must not create a second logical identity.

| Option                                                          | Upside /5 | Downside /5 | Pros                                                                  | Cons                                                                          |
| --------------------------------------------------------------- | --------- | ----------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **A. Use the existing `CaseInsensitiveMap<EntraTokenFailure>`** | 5         | 1           | Same invariant as credentials; normalizes get/set/delete in one place | Changes the internal key representation; add regression tests                 |
| B. Lowercase keys in each registry operation                    | 4         | 2           | Small and explicit                                                    | Duplicates existing normalization and is easier to omit in a future operation |
| C. Normalize only the diagnostics caller                        | 1         | 3           | Tiny local change                                                     | Does not fix recording or clearing with another casing; incomplete            |

**Recommend A.** Test record/read/clear using differing casing, replacement without duplicates,
expiry, and isolation between different cluster IDs. Never substitute `treeId`.

> **Second opinion: confirmed, P3, agree.** A probe reproduced it: `CredentialCache.hasCredentials('azureresource')`
> returns `true`, while `getRecentEntraTokenFailure('azureresource')` returns `undefined` after
> recording under `AzureResource`. **Option A is correct and is a one-line change**
> (`new CaseInsensitiveMap<EntraTokenFailure>()`). Options B and C add nothing. Fix before merge;
> it is cheaper than discussing it.

> **Operator decision (2026-11-04): accepted as recommended.** Use `CaseInsensitiveMap` in the
> failure registry, with regression tests for casing on record, read and clear. Fix before merge.

### C3. Existing workers cannot refresh after credential-cache eviction

**Source:** [comment 4454295578](https://github.com/microsoft/vscode-documentdb/pull/1050#discussion_r4454295578),
on [ShellSessionManager.ts](../../../../../src/documentdb/shell/ShellSessionManager.ts#L360).

> Update Credentials clears `CredentialCache` without stopping existing workers, so an open
> shell's next token refresh now fails before either token provider runs. Resolve from connection
> metadata captured for that worker, or restart the worker when credentials are invalidated.
> Same issue in `src/documentdb/playground/PlaygroundEvaluator.ts:383-386`; cover eviction
> followed by token refresh.

**Assessment: valid, P1.** The new audience-resolution step adds a live credential-cache dependency
to every worker token request in both
[shell](../../../../../src/documentdb/shell/ShellSessionManager.ts#L366) and
[playground](../../../../../src/documentdb/playground/PlaygroundEvaluator.ts#L382).
[Update Credentials](../../../../../src/commands/updateCredentials/updateCredentials.ts#L127)
deletes the main-thread client and credentials.
[Client deletion](../../../../../src/documentdb/ClustersClient.ts#L634) does not stop worker
clients, and [refreshView](../../../../../src/commands/refreshView/refreshView.ts#L10) only
requests a tree refresh.

Four probes used the real session managers, real credentials, and real audience resolvers,
with simulated worker transport and token APIs:

1. Successfully initialize a Government shell/playground with either token source.
2. Evict that cluster's credentials.
3. Emit the next token request from the still-existing worker.
4. Observe `tokenError` containing `No credentials found`; the token provider has still been
   called only once, during initialization.

This dependency also affects public-cloud workers; it is not sovereign-specific. Tree activity
may repopulate the cache and mask the problem, so **not every Update Credentials invocation
will visibly fail**. The failing branch is the interval or state in which the worker is alive
but credentials are absent. Normal playground evaluation also has an older credential lookup
while building its init message; that pre-existing behavior is not attributed to this PR.

**Documentation cross-check:** [D6/D7](../decisions.md#d6-interactive-sign-in) change how the
audience is selected, not the lifetime of an already-connected worker. The
[previous review's refresh row](01-cloud-aware-scope-and-entra-diagnostics-review.md#second-pass-edge-cases-examined)
considered re-resolution acceptable but missed eviction. Worker init messages already carry
the original tenant/client identity, while the new refresh logic reads a live connection string:
simply repopulating the cache can mix different generations of configuration.

| Option                                                                                    | Upside /5 | Downside /5 | Pros                                                                                             | Cons                                                                                                           |
| ----------------------------------------------------------------------------------------- | --------- | ----------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| A. Keep immutable, minimal audience-resolution metadata with each worker                  | 4         | 2           | Refresh no longer depends on cache presence; preserves shell variables and active queries        | Existing workers retain the old identity/configuration until explicitly restarted; that UX must be intentional |
| **B. Invalidate affected workers on credential changes, with an explicit reconnect path** | 5         | 3           | Applies new credentials consistently; avoids combining an old tenant/client ID with new metadata | Must reach every shell and playground; reconnect loses worker-local state and needs a clear notice             |
| C. Reload the live credential cache on every missing-entry refresh                        | 2         | 4           | May hide the immediate missing-cache error                                                       | Can prompt from a callback, resurrect removed connections, or mix new metadata with the old worker identity    |

**Recommend B for credential updates**, with a per-worker metadata snapshot for normal token
requests if continuity across unrelated cache eviction is required. Choose and document the
session-update semantics before implementing; neither blindly retaining old credentials nor
silently switching identity is an adequate unspecified default. Never automatically replay a
database operation after restarting a worker.

**Acceptance checks:** all four surface/source combinations; public and Government scopes;
update followed by refresh before cache repopulation; repopulation with a changed tenant,
client ID, or auth method; multiple open shells; connection deletion; an in-flight token request
during invalidation; no automatic query replay. Include E4's late-completion case.

> **Second opinion: confirmed, P1, agree. This blocks merge. The impact is wider than stated,
> and I recommend A, not B.**
>
> - **Regression confirmed against `main`.** On the merge base, both workers' `handleTokenRequest`
>   used `msg.scopes` and never read `CredentialCache`. This PR removes `scopes` from
>   `tokenRequest` and adds `CredentialCache.getCredentials(...)` as the first step. A probe
>   reproduced it on all four surface/source combinations: after `deleteCredentials`, the next
>   token request posts `tokenError` and neither token provider is called.
> - **Wider than Update Credentials.** Every tree connection-failure path also evicts credentials:
>   [DocumentDBClusterItem](../../../../../src/tree/connections-view/DocumentDBClusterItem.ts),
>   the VCore and RU resource items, and the Atlas, Kubernetes, Azure VM, Mongo RU and vCore
>   discovery items, plus `removeConnection` and Quick Start. A transient tree reconnect failure
>   (VPN drop, sleep or resume) can therefore break an open shell's next OIDC refresh (about once
>   an hour) with "No credentials found". This affects public-cloud Entra and managed-identity
>   users, not just sovereign ones.
> - **Why A, not B.** Each worker already snapshots its identity at spawn: `tenantId` and
>   `managedIdentityClientId` in the init message, and `oidcAllowedHosts` in `WorkerSessionManager`.
>   Only the audience is read live. The "mixed generations" problem the review raises against A
>   is therefore what the **current** code does: identity and allowlist from spawn time, audience
>   from live settings and cache. A per-worker snapshot makes all four values one generation.
>   It also restores `main`'s exact semantics, where the worker sent a fixed scope, so it does
>   not change user-visible behaviour. B (invalidate workers on credential change) is a real UX
>   improvement. But keeping the old identity until restart already happens on `main`, B loses
>   shell state, and it needs its own design. It should not ride on a regression fix.
> - **Suggested shape for A.** Capture the connection string, and ideally the **first successful
>   `ResolvedTokenResource`**, per worker generation at init time. For example, store it next to
>   `_connectionInfo` in the shell. In the playground, key it to the worker that
>   `WorkerSessionManager` spawned, not to `workerClusterId`. Then reuse it for later
>   `tokenRequest`s. Memoizing the resolution also removes the uncached IMDS call that
>   managed-identity refreshes to private hosts currently make on every refresh (see PR review
>   R4).
> - **Tests:** evict the credentials, then refresh, for all four combinations. Also cover a
>   settings change after spawn, which must not change the audience of an existing worker.

> **Operator decision (2026-11-04): accepted after discussion. Recorded as
> [D12](../decisions.md#d12-open-sessions-keep-what-they-started-with).**
>
> - **Semantics.** Open sessions keep the credentials and token audience they started with.
>   Update Credentials does not reconnect them; new credentials apply to new connections.
> - **Fix (before merge): pin the audience per session.** Resolve the audience once on the main
>   thread, when a shell starts or a playground worker is spawned. Keep the `ResolvedTokenResource`
>   on that session and reuse it for every refresh. Token refresh no longer reads
>   `CredentialCache`, so no way of clearing the cache can break it. No tokens or secrets are added
>   to sessions: workers already hold the connection string, tenant and client ID, and the audience
>   is a public URL. This is option A from above, reduced to the one value that was read live. It
>   also covers R4 (repeated IMDS calls) and R5 (a cloud-setting change mid-session).
> - **Update Credentials writes through instead of wiping.** After saving, it writes the new values
>   into `CredentialCache` and still drops the main-thread client.
> - **The playground worker is shut down on update.** Each run gets a fresh context
>   (`persistent: false`), so no user state is lost and the next run uses the new credentials.
> - **Modal.** Shown only when a shell for that cluster is open. It says the new credentials apply
>   to new connections and that open shells keep theirs until closed.
> - **E4** is fixed together with this change, in the same token callback.
> - **Follow-up:** an explicit "Disconnect" action replaces option B. It is tracked in
>   [#1059](https://github.com/microsoft/vscode-documentdb/issues/1059), which also covers the
>   teardown checklist, the per-cluster caches, the decision on whether tree failures should evict
>   credentials, and the playground's per-run cache read. It shares its teardown with
>   [#566](https://github.com/microsoft/vscode-documentdb/issues/566).
> - **Rejected:** restarting workers when credentials change; reloading from storage when the cache
>   has no entry; stopping the cache wipe on update alone.

### C4. The no-broker warning is narrower than its cited source

**Source:** [comment 4454295628](https://github.com/microsoft/vscode-documentdb/pull/1050#discussion_r4454295628),
on [the sovereign-cloud guide](../../../../user-manual/sovereign-clouds.md#find-the-error-code).

> The linked VS Code issue reports this cache failure for both Azure China and Azure US
> Government, not China alone. Government users following this diagnostic step can also
> encounter repeated sign-in prompts across Azure extensions. Widen the caveat to cover sovereign
> clouds while keeping the instruction to restore the setting afterward.

**Assessment: valid, P3.** The guide names China only.
[microsoft/vscode#307340](https://github.com/microsoft/vscode/issues/307340), still open when
fetched, explicitly reports affected Azure China and Azure US Government users in its impact
section. Its detailed reproduction is China-based; that distinction should not be turned into
a claim that this review reproduced the bug in both clouds.

The [maintainer comment](https://github.com/microsoft/vscode/issues/307340#issuecomment-4182988768)
also says the broker is the preferred/default experience and no-broker is a fallback.
[Our research](../research-findings.md#3-precedent-the-same-failure-for-azure-sql-fixed-by-configuration) already describes the issue as affecting
sovereign-cloud tokens generally.

| Option                                                                                     | Upside /5 | Downside /5 | Pros                                                                                  | Cons                                                               |
| ------------------------------------------------------------------------------------------ | --------- | ----------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **A. Say failures have been reported in sovereign clouds, including Government and China** | 5         | 1           | Matches the source without overstating verification; retains a useful diagnostic step | Upstream status can change; keep the issue link                    |
| B. Remove the no-broker diagnostic step entirely                                           | 2         | 2           | Avoids suggesting a global setting with side effects                                  | Removes a documented way to expose an otherwise hidden AADSTS code |

**Recommend A.** Suggested wording: "Token-cache failures and repeated sign-in prompts have
been reported in this mode for sovereign clouds, including Azure China and Azure US Government.
See microsoft/vscode#307340. Restore the setting after diagnosis." Preserve the warning that
the setting affects all of VS Code. Do not prescribe it as a permanent fix.

> **Second opinion: confirmed, P3, agree with A.** Re-fetched on 2026-11-04: microsoft/vscode#307340
> is **open**. Its impact section says "All sovereign cloud users (Azure China / Azure US
> Government) using `msal-no-broker` are affected". The stated root cause is a PCA cache shared
> between the `microsoft` and `microsoft-sovereign-cloud` providers, which does not depend on
> the cloud, so widening the caveat is justified. The proposed wording is good; apply it before
> merge.

> **Operator decision (2026-11-04): accepted as recommended.** Widen the caveat in the guide to
> sovereign clouds, including Azure China and Azure US Government, using the suggested wording.
> Keep the link to microsoft/vscode#307340 and the instruction to restore the setting. Fix before
> merge.

### C5. Settings text misstates applicability and precedence

**Source:** [comment 4454295683](https://github.com/microsoft/vscode-documentdb/pull/1050#discussion_r4454295683),
on [package.json](../../../../../package.json#L1995).

> This describes the audience override as a fallback, but managed identity applies it before both
> the cluster host and instance metadata. It also describes the object as custom-cloud-only,
> although the hostname suffix applies in every cloud. Document the actual precedence and the
> interactive-only custom-cloud restriction so users do not unknowingly override other
> managed-identity connections.

**Assessment: valid, P2.** The Settings description says the audience is also used when the VM
cloud cannot be detected. In fact, a valid override returns before either host or IMDS selection
in [the resolver](../../../../../src/documentdb/auth/documentdbTokenResource.ts#L185).
It is machine-scoped configuration, not a setting on one connection. Configuring it for a private
Government endpoint can therefore change other managed-identity connections in the same scope.
The custom hostname suffix is passed to the allowlist regardless of the interactive cloud.

**Documentation cross-check:** [D6](../decisions.md#d6-interactive-sign-in),
[D7](../decisions.md#d7-managed-identity), and the
[user guide](../../../../user-manual/sovereign-clouds.md#private-endpoints-and-custom-dns-names)
already describe the real behavior. This is a Settings-surface inconsistency, not justification
to change the accepted runtime precedence.

| Option                                                               | Upside /5 | Downside /5 | Pros                                                                                           | Cons                                                                            |
| -------------------------------------------------------------------- | --------- | ----------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **A. Correct the object description and both property descriptions** | 5         | 1           | Makes precedence, scope, and applicability visible where users configure them; preserves D6/D7 | Requires concise wording and keeping Settings/docs aligned                      |
| B. Keep short descriptions and link to the guide                     | 3         | 1           | Less duplicated prose                                                                          | Users can still miss a consequential global override without opening the link   |
| C. Change runtime behavior so the override is only a fallback        | 1         | 5           | Would match the current misleading sentence                                                    | Violates accepted D7 and breaks explicit overrides; outside a documentation fix |

**Recommend A**, optionally with B's link. State independently:

- Audience: interactive sign-in uses it only when the selected cloud is `custom`.
- Audience: managed identity uses it first, before host and IMDS, for all affected connections.
- Suffix: applies to trusted custom/private service names in any cloud; it does not select an audience.
- Empty values restore automatic selection; configure the machine-scoped object in User settings.

**Acceptance checks:** read the object description without opening the guide; a user must be able
to predict the two auth-source branches and the effect on another managed-identity connection.

> **Second opinion: confirmed, P2, agree with A.** `package.json` says `ossrdbmsEndpoint` "is also
> used for managed identity when the cloud of the virtual machine cannot be detected". In
> [resolveManagedIdentityTokenResource](../../../../../src/documentdb/auth/documentdbTokenResource.ts)
> the override is checked **first**, before the host and IMDS. One consequence: a user who sets a
> Government override for one private-endpoint connection silently changes the audience for
> _every_ managed-identity connection on that machine, including ones to `*.azure.com` hosts.
> Settings is where users decide this, so the text must state the precedence. Keep it to three
> sentences; the guide carries the detail. Fix before merge.

> **Operator decision (2026-11-04): accepted as recommended.** Rewrite the object description
> and both property descriptions. They must state that interactive sign-in uses the override only
> for a `custom` cloud, that managed identity uses it first, before the host and IMDS, for every
> connection on the machine, and that the suffix applies in any cloud and does not choose an
> audience. Fix before merge.

## Findings beyond Copilot

### E1. An unknown AADSTS code becomes an "opaque" broker error

**Assessment: P2, confirmed behavior and documented-intent mismatch.**
[classifyEntraError](../../../../../src/documentdb/auth/entraErrors/classifyEntraError.ts#L39)
checks the broker rule before falling back to an unknown numeric AADSTS code.
For `platform_broker_error AADSTS1234567: probe`, it returns:

```json
{ "ruleId": "brokerOpaque", "brokered": true }
```

The available code disappears from classification telemetry and the explanation. With recent
Government context, the provider instead displays the conditional AADSTS65002 explanation.
It does not assert 65002 as fact, but it does replace available precise evidence with a less
relevant hypothesis and asks the user to retrieve information already present.

**Cross-check:** [plan B3](01-cloud-aware-scope-and-entra-diagnostics.md#b3-classification)
says the opaque branch is for a broker error **without a code**;
[D9](../decisions.md#d9-opaque-broker-errors) likewise describes an opaque failure.
However, [the current test](../../../../../src/documentdb/auth/entraErrors/classifyEntraError.test.ts#L86)
explicitly expects broker precedence over unknown codes. This is not merely missing coverage:
code/tests and documented intent disagree. The test is not a `TDD:` contract, but its intentional
expectation still needs an explicit resolution rather than being silently rewritten.

| Option                                                                                              | Upside /5 | Downside /5 | Pros                                                                                         | Cons                                                                            |
| --------------------------------------------------------------------------------------------------- | --------- | ----------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **A. After specific code/phrase matches, classify any remaining numeric code before opaque broker** | 5         | 2           | Preserves the actual code and generic lookup link; keeps `brokered: true`; aligns with B3/D9 | Changes an existing tested precedence rule                                      |
| B. Keep broker classification but carry/show the numeric code and suppress the 65002 hedge          | 4         | 3           | Preserves existing rule-ID grouping while retaining evidence                                 | Adds a second unknown-code presentation path and more branches                  |
| C. Keep code/tests and amend the documentation only                                                 | 1         | 3           | No runtime behavior change                                                                   | Still loses useful evidence; needs an explicit rationale for preferring opacity |

**Recommend A.** Test broker plus unknown code directly and in an `Error.cause`; preserve known
code precedence and the truly code-less broker behavior. Record the chosen precedence if adopted.

> **Second opinion: confirmed, but P3 rather than P2.** A probe returned
> `{ ruleId: 'brokerOpaque', brokered: true }` for `platform_broker_error AADSTS1234567`. The code
> is not lost to the user: the raw message stays in the modal `detail`. What is lost is the
> `aadstsCode` telemetry dimension and a precise explanation. In a non-public cloud with a recent
> failure, users also see the conditional 65002 hint, which is a misleading lead.
> **Option A is right and small**: in `classifyEntraError`, move the `codes.length > 0` fallback
> above the MSAL rule lookup. However,
> [classifyEntraError.test.ts](../../../../../src/documentdb/auth/entraErrors/classifyEntraError.test.ts)
> deliberately pins the opposite ("the broker over an unknown code"). The operator should approve
> the precedence change, and it should be recorded in D9 rather than the test being quietly
> rewritten. Fine before merge if the operator approves; otherwise a follow-up.

> **Operator decision (2026-11-04): accepted as recommended. The precedence change is approved.**
> When a broker error carries an unknown AADSTS code, classify it as `unknownAadsts` (keeping
> `brokered: true`) instead of `brokerOpaque`. Only a code-less broker error stays opaque. Update
> the pinned test, add the `Error.cause` case, and record the new precedence in
> [D9](../decisions.md#d9-opaque-broker-errors). Fix before merge.

### E2. Unclassified seeds erase known cloud evidence

**Assessment: P2, confirmed guard gap; live mixed-name topology not tested.**
[getAzureCloudFromHosts](../../../../../src/documentdb/auth/oidcAllowedHosts.ts#L90) returns
`undefined` unless _every_ seed maps to the same built-in cloud. It conflates:

1. no recognized hosts;
2. contradictory recognized clouds;
3. a recognized Government host plus an unclassified private hostname.

The probe used:

```text
mongodb://a.mongocluster.cosmos.azure.us,b.documentdb.private.example/
```

With the public interactive setting, the Government-only version throws `cloudMismatch`.
Adding the private seed instead returns the public audience and `hostCloud: none`.
For managed identity with no override and public IMDS evidence, the mixed string also selects
the public audience. When the private suffix is explicitly trusted, the allowlist accepts both
suffixes, so allowlist rejection is not a guaranteed alternative guard.

**Cross-check:** [D8](../decisions.md#d8-cloud-mismatch-stops-the-request) promises to stop
clear known-host/cloud disagreements. The
[previous review](01-cloud-aware-scope-and-entra-diagnostics-review.md#second-pass-edge-cases-examined)
dismissed mixed public/Government replica sets as unrealistic. The known-service-plus-private-name
case is a different assumption: aliases/private names need not mean different clouds.
The present [unit test](../../../../../src/documentdb/auth/oidcAllowedHosts.test.ts#L144)
pins the ambiguous `undefined` result but does not test its downstream resolution consequences.

No claim is made that a database accepted this synthetic topology. The established defect is
that adding an unknown seed suppresses a mismatch already established by a known seed.

| Option                                                                               | Upside /5 | Downside /5 | Pros                                                                                                                             | Cons                                                                                    |
| ------------------------------------------------------------------------------------ | --------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **A. Retain the set of recognized clouds separately from unknown hosts**             | 5         | 3           | Rejects any known interactive mismatch; distinguishes conflicting clouds from absent evidence; supports legitimate private peers | Needs a richer host-evidence result and a deliberate managed-identity mixed-host policy |
| B. Reject all mixed known/unknown or cross-cloud seed lists for Entra authentication | 3         | 3           | Simple, fail-early behavior                                                                                                      | May reject valid private/alias configurations unnecessarily                             |
| C. Keep the current resolver and add troubleshooting documentation                   | 2         | 3           | No behavioral compatibility change                                                                                               | Wrong-scope attempts and lost diagnostics remain; weaker than the stated D8 guard       |

**Recommend A.** For interactive sign-in, any positively recognized incompatible cloud should
prevent token acquisition; unknown peers must not erase that evidence. For managed identity,
reject contradictory known clouds rather than falling through to IMDS; decide explicitly whether
one known cloud plus unknown peers is sufficient. Keep D7's explicit override precedence unless
the operator changes it. Do not automatically widen the OIDC allowlist or infer trust from DNS.

**Acceptance checks:** known Government plus private in both orders; same-cloud multi-host;
Government plus public; all-private; bracketed IPs; custom suffix; zero token calls after mismatch.

> **Second opinion: confirmed, but P3 rather than P2. Follow-up, not a merge blocker.**
>
> - **Confirmed.** A probe showed `getAzureCloudFromHosts` returns `AzureUSGovernment` for a single
>   Government host and `undefined` for the mixed list. Code check: `new Set([cloud, undefined])`
>   has size 2.
> - **Why lower.** Azure DocumentDB connection strings are normally single-host `mongodb+srv://`.
>   Private endpoints normally resolve under `privatelink.mongocluster.cosmos.azure.us`, which is
>   still recognized. A seed list mixing a built-in Azure FQDN with a custom private name is
>   unusual. The failure still happens, just later, at the server with a wrong-audience error.
>   It is not a token-leak or trust issue: `ALLOWED_HOSTS` still contains only `*.azure.us`, and
>   the private host is excluded unless its suffix is trusted.
> - **Option A is smaller than its downside score of 3 suggests.** Compute the set of recognized
>   clouds and **ignore unclassified hosts**:
>   - exactly one recognized cloud: that cloud is `hostCloud`;
>   - more than one: contradictory. Interactive returns `cloudMismatch`; managed identity returns
>     a resolution error;
>   - none: today's behaviour.
>
>   This takes about 10 lines in `oidcAllowedHosts.ts` plus a `kind` discriminator for the
>   contradictory case. For managed identity it strictly improves today's result: Government
>   plus a private host currently falls through to IMDS, which recognizes only public, and fails.
>   It also changes the copy resolver, so add a copy test.

> **Operator decision (2026-11-04): accepted as recommended.** Implement the smaller variant of
> option A as a follow-up after merge: ignore unclassified hosts, use the single recognized cloud,
> and treat more than one recognized cloud as a contradiction. Include tests for interactive,
> managed identity and copy.

### E3. A custom override can contradict a known login authority

**Assessment: P3 hardening gap, not a claim that explicit-override precedence is wrong.**
[resolveCustomCloud](../../../../../src/documentdb/auth/documentdbTokenResource.ts#L286)
returns the override before examining the configured login host. The later
[mismatch check](../../../../../src/documentdb/auth/documentdbTokenResource.ts#L150)
compares the database host with the _audience_, not the sign-in authority.

A probe configured a custom cloud with `activeDirectoryEndpointUrl` pointing to
`https://login.microsoftonline.com/`, a Government audience override, and a Government cluster
host. Resolution succeeded with no warning. Both sides are recognizable built-in cloud signals,
yet their contradiction is lost. No actual token was requested by this probe.

**Cross-check:** [D6](../decisions.md#d6-interactive-sign-in) says authority and audience
"cannot disagree" because they follow the same setting, but also gives explicit overrides first
priority. The latter is implemented; the former guarantee is too strong for custom definitions.
An arbitrary custom resource cannot safely be rejected merely because it is not in the built-in
table. This finding is about known contradictory evidence, not inventing cloud mappings.

| Option                                                                                      | Upside /5 | Downside /5 | Pros                                                                                 | Cons                                                                           |
| ------------------------------------------------------------------------------------------- | --------- | ----------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| **A. Warn for known-authority/known-audience contradictions and qualify the documentation** | 4         | 1           | Preserves accepted override precedence; explains a predictable configuration mistake | Still permits a request that is likely to fail                                 |
| B. Fail early for known contradictory pairs, leaving genuinely custom values alone          | 5         | 3           | Prevents demonstrably inconsistent built-in combinations                             | Changes explicit override semantics; requires approval and compatibility tests |
| C. Document user responsibility without a runtime warning                                   | 2         | 1           | Smallest change; no compatibility risk                                               | The two configuration surfaces remain easy to misconfigure                     |

**Recommend A initially.** If strict rejection is desired, make it an explicit D6 refinement.
Test all built-in contradictory pairs, matching pairs, and unknown/custom resources; do not
generalize a built-in lookup into validation of arbitrary sovereign deployments.

> **Second opinion: confirmed by code reading, P4. Recommend C now; A is optional later.**
> [resolveCustomCloud](../../../../../src/documentdb/auth/documentdbTokenResource.ts) returns the
> override before it looks at the login host, so the contradiction goes undetected. Reaching it
> requires a custom cloud whose authority is the _public_ login host combined with a _Government_
> audience override, which is an unusual hand-made configuration. The likely server response is
> AADSTS500011, which the `resourceNotInTenant` rule already explains by pointing at the cloud
> setting. A runtime warning therefore adds little. What is wrong is the guarantee: "so the two
> cannot disagree" appears both in [D6](../decisions.md#d6-interactive-sign-in) and in the JSDoc
> of `resolveInteractiveTokenResource`. Change both to "cannot disagree unless an explicit
> override is set". That is option C, with A as an optional later change.

> **Operator decision (2026-11-04): accepted as recommended.** Option C. Qualify the "cannot
> disagree" guarantee in D6 and in the JSDoc of `resolveInteractiveTokenResource`. No runtime
> warning is planned. Docs fix before merge.

### E4. Late token completions can update diagnostics after their worker is gone

**Assessment: P3, reproduced in both worker surfaces.**
[WorkerSessionManager](../../../../../src/documentdb/playground/WorkerSessionManager.ts#L619)
guards `postResponse` so a terminated worker cannot receive a response through its replacement.
It does **not** prevent the token callback's other side effects. The new
[shell](../../../../../src/documentdb/shell/ShellSessionManager.ts#L432) and
[playground](../../../../../src/documentdb/playground/PlaygroundEvaluator.ts#L450) paths record
or clear cluster failure context before invoking that guarded response.

Two probes performed this sequence:

1. Initialize a worker successfully.
2. Start a refresh and leave its token promise pending.
3. Dispose that manager and initialize a successful replacement for the same cluster.
4. Reject the old refresh with a broker error.
5. Observe a new recent failure record even though the replacement succeeded.
   No old response was delivered, so the existing response guard worked.

The symmetric late-success path can clear a newer failure. This does not corrupt a database
result; it compromises the registry's claim to represent the current/relevant failure.
It is related to, but not fixed merely by, C2's case normalization or C3's worker restart.

**Cross-check:** the
[previous R8 fix](01-cloud-aware-scope-and-entra-diagnostics-review.md#r8-p3-clear-the-token-failure-record-on-success)
clears stale records on success, but its sequential failure-then-success tests do not establish
correctness under reversed completion order or disposed-worker callbacks.

| Option                                                                             | Upside /5 | Downside /5 | Pros                                                                         | Cons                                                                                                |
| ---------------------------------------------------------------------------------- | --------- | ----------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **A. Capture worker-lifetime validity and check it before registry writes/clears** | 5         | 2           | Extends the existing response-isolation principle to diagnostic side effects | Requires passing lifetime context through both consumers                                            |
| B. Give registry records attempt/generation ownership and compare before mutation  | 5         | 4           | Can also address overlapping still-live attempts                             | More state and cross-surface ownership design; larger than this disposal defect                     |
| C. Clear the registry when disposing a worker                                      | 1         | 3           | Very small patch                                                             | An outstanding callback can immediately repopulate it; can also erase another live session's record |

**Recommend A with C3's lifecycle work.** Check liveness on both success and failure, after every
asynchronous token operation, without rewriting the original error. Cancellation support can
reduce wasted work, but is not a substitute for ignoring a late result. Test late failure after
new success and late success after new failure for both token sources and both surfaces.

> **Second opinion: confirmed by code reading, P4 / nit.** In
> [WorkerSessionManager](../../../../../src/documentdb/playground/WorkerSessionManager.ts),
> `this._worker === worker` guards only `postResponse`, not the registry writes that happen
> before it. Reaching the bug requires disposing a worker while its token request is pending
> and then a replacement settling first. Both workers serve the same cluster, so they nearly
> always resolve the same `cloudCategory`. The only observable effect is the
> `recentTokenFailure` flag, which only changes the `brokerOpaque` wording, and only for 10
> minutes. **Fold option A into the C3 fix**, because it touches the same callback, and pass
> the same liveness predicate. Don't do it as separate work. Option B is over-engineered for
> this impact.

> **Operator decision (2026-11-04): accepted as recommended.** Option A, implemented together
> with the C3 fix. Skip registry writes and clears when the worker that issued the token request
> is no longer the current worker.

## Other branches and assumptions checked

These are not additional confirmed defects. The table distinguishes intentional policy from
remaining evidence gaps so they are not accidentally "fixed" by broadening fallbacks.

| Branch / assumption                                                                   | Evidence and assessment                                                                                                                                                        | Follow-up                                                                                                                                                   |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Built-in interactive cloud plus an invalid/custom audience override                   | [Resolver tests](../../../../../src/documentdb/auth/documentdbTokenResource.test.ts#L132) and D6 deliberately ignore the override outside `custom`                             | Preserve this in C1/C5 wording and tests                                                                                                                    |
| Managed identity ignores the interactive cloud, even if its definition cannot be read | [Tests](../../../../../src/documentdb/auth/documentdbTokenResource.test.ts#L399) confirm host/override/IMDS selection survives unreadable sign-in configuration                | Preserve D7; do not copy the interactive fix into this branch                                                                                               |
| Valid override contradicts a managed-identity host                                    | D7 explicitly makes the override authoritative; existing tests enforce it                                                                                                      | Explain scope in C5; any conflict guard is a separate approved behavior change                                                                              |
| Government/China IMDS value with an unclassified host                                 | [D7](../decisions.md#d7-managed-identity) intentionally recognizes only public IMDS; other values fail with a named setting                                                    | Not a missing mapping to invent from names; obtain authoritative/live evidence first                                                                        |
| Copy chooses a value that live managed-identity resolution would not choose           | [Copy resolver](../../../../../src/documentdb/auth/documentdbTokenResource.ts#L211) is explicitly offline/best-effort and can fall back to the setting/public audience         | Preserve the distinction; copied strings are not proof of runtime audience selection                                                                        |
| Private SRV alias and service targets have different suffixes                         | [User guide](../../../../user-manual/sovereign-clouds.md#private-endpoints-and-custom-dns-names) documents the limitation and driver checks                                    | Do not authorize arbitrary SRV targets to make an alias work                                                                                                |
| Unknown/expired diagnostic context                                                    | Provider supports missing context and raw strings; only the recent registry supplies the auth method                                                                           | C1 must retain an honest unknown branch; it cannot assume a failed token record always exists                                                               |
| Registry expiry bounds memory                                                         | [Registry](../../../../../src/documentdb/auth/entraErrors/entraTokenFailures.ts#L31) expires entries only when the same key is read; time-to-live is not a global memory bound | Low-priority watch item for long-lived windows with many one-off failed clusters; a bounded sweep/cap could address it                                      |
| Settings change during asynchronous custom ARM resolution                             | Resolver captures cloud before metadata lookup; the installed Azure auth helper selects its provider when `getSessionFromVSCode` runs                                          | Potential configuration race, not reproduced here; test changing the cloud while metadata is pending before claiming authority/audience selection is atomic |
| Custom ARM metadata changes during a window                                           | Only successful lookups are cached, keyed by ARM endpoint; no production invalidation path was found in the resolver                                                           | Document lifetime/reload expectations or add invalidation if dynamic metadata is a requirement; not established as a current incident                       |
| Full AADSTS evidence always reaches the classifier                                    | Managed-identity translation preserves the outer unknown-error message, but not every possible nested-only SDK cause; webviews send only the message                           | Existing boundary limitation; use real SDK-shaped fixtures before promising universal code recovery                                                         |
| Real-cloud resource acceptance and Microsoft preauthorization                         | [Research](../research-findings.md) and [D1/D2/D11](../decisions.md) explicitly leave external verification gaps                                                               | Still require sovereign token acquisition plus a database command, and D11 evidence for China compatibility                                                 |

### Documentation reconciliation

- The feature README's draft label is stale at this snapshot; it was not changed because this
  request is limited to producing a new review file.
- The prior review is historical evidence, not a current green check for the behaviors above.
- C4 and C5 identify user/Settings documentation corrections still to implement.
- E1 identifies an explicit code/test versus intent conflict; E3 identifies an overstrong design
  guarantee under accepted override precedence. Neither was silently resolved by changing code
  or recording an unapproved decision.
- No new public-audience fallback, sovereign IMDS mapping, client application ID, automatic retry,
  or broader hostname trust is recommended as an incidental fix.

## Verification and limitations

**Case 1 verification applies:** this request is investigation and a review document, not a
request to prepare or mark the PR ready for review. The existing non-draft flag does not turn
these results into a new ready-for-review handoff.

| Check                                                                                              | Result                                                                                                      |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| GitHub reviews/comments and active threads                                                         | One submitted Copilot review, five linked unresolved comments, matching local/GitHub head                   |
| `npm run build`                                                                                    | Passed, including workspace prebuilds                                                                       |
| Focused existing Vitest run                                                                        | **16 files, 416 tests passed**                                                                              |
| Temporary reproduction probes                                                                      | **13 tests passed**, asserting the observed problematic behavior, not asserting fixes                       |
| Upstream caveat source                                                                             | Fetched microsoft/vscode#307340 and its comments; issue open; body explicitly includes Government and China |
| Live Azure Government / China / custom-cloud sign-in                                               | Not performed; no suitable cloud access used                                                                |
| Full runtime suite / strict workspace test type-check / localization / formatting / lint / package | Not run in this review; no Case 2 success is claimed                                                        |

The existing-test command was:

```bash
npx vitest run \
  src/documentdb/auth/documentdbTokenResource.test.ts \
  src/documentdb/auth/entraScopes.test.ts \
  src/documentdb/auth/oidcAllowedHosts.test.ts \
  src/documentdb/auth/entraErrors \
  src/documentdb/auth/MicrosoftEntraIDAuthHandler.test.ts \
  src/documentdb/auth/ManagedIdentityAuthHandler.test.ts \
  src/documentdb/auth/managedIdentityConnectionString.test.ts \
  src/documentdb/auth/sovereignAuth.integration.test.ts \
  src/documentdb/shell/ShellSessionManager.test.ts \
  src/documentdb/playground/WorkerSessionManager.test.ts \
  src/services/connectionDiagnosticsService.test.ts \
  src/commands/updateCredentials/updateCredentials.test.ts \
  src/commands/copyConnectionString/copyConnectionString.test.ts \
  src/commands/newConnection/PromptConnectionStringStep.test.ts
```

Probe coverage: C1 (three codes), C2 (one lookup/clear sequence), C3 (four surface/source
combinations), E1 (one code/broker sequence), E2 (one mixed-host sequence), E3 (one conflicting
custom definition), E4 (two disposed-worker sequences). Worker probes used real managers,
credential lookup, and audience resolvers; only token APIs, worker transport, and host-service
dependencies were simulated. E2/E3 used injected resolver dependencies to make branch selection
deterministic. Temporary probe code is not part of this review's repository changes.

## Recommended implementation order

1. **C3 + E4:** choose worker credential-update semantics, then fix cache/lifetime handling together.
2. **C1 + C2:** carry accurate auth-method context into the single rule table and normalize registry keys.
3. **E1 + E2:** resolve precedence/host-evidence decisions, then add regression tests for the missed branches.
4. **C5 + C4:** align Settings and troubleshooting text with actual precedence and upstream reports.
5. **E3:** add targeted configuration hardening without silently changing D6's override policy.

When implementation is approved, keep fixes and their regression tests separate from this
evidence record. This review does not satisfy the remaining real-sovereign rollout gates or
replace a full Case 2 verification before a future review handoff.

> **Second opinion on the order.** Split into _before merge_ and _follow-up_:
>
> - **Before merge:** R1 (drop the preview version bump), C3 option A plus the E4 guard, C2, C5,
>   C4, and C1 (narrowed). The E3 change is documentation only (qualify D6 and the JSDoc).
>   Optionally E1, if the operator approves the precedence change.
> - **Follow-up:** E2 (recognized-cloud set), worker invalidation on credential change (C3 option
>   B, as its own UX design), and memoizing IMDS (R4).
>
> **After the operator decisions (2026-11-04):**
>
> - **Before merge:** R1, then C3 as D12 (pin the audience per session, Update Credentials writes
>   through and stops the playground worker, a modal only when a shell is open) together with E4.
>   Then C2, C1, E1 (record the precedence in D9), C5, C4, and the E3 documentation change (D6
>   and the JSDoc).
> - **Follow-up:** E2. Option B is replaced by the Disconnect feature,
>   [#1059](https://github.com/microsoft/vscode-documentdb/issues/1059). Pinning the audience
>   already covers R4.

## Independent PR review (2026-11-04)

Reviewed [#1050](https://github.com/microsoft/vscode-documentdb/pull/1050) at head `7f2a288`
(unchanged since the snapshot above) against `origin/main`. The diff covers 55 files, about
6.7k additions, of which about 4.4k are in `src/` and `package.json`, mostly tests. CI is green on
all 14 checks. Review state: `REVIEW_REQUIRED`, mergeable, no milestone.

**Verdict: request changes.** The design is sound and well tested. Two items block merge: the
preview version bump (R1) and the C3 refresh regression. The other pre-merge items are small.

### Blocking

- **R1. Preview version bump on the PR branch.** Commit `7f2a288` ("version bump") changes
  `package.json` and `package-lock.json` from `1.0.2-alpha.0` to `1.0.2-sov-cloud-preview`. That
  is a preview-build artifact and must not reach `main`. Revert it before merge, or produce the
  preview VSIX from a side branch or tag.
- **C3**, as above. This is a regression from `main` for every Entra or managed-identity shell
  and playground, not just sovereign ones.

### Should fix before merge (small)

- **C2, C5, C4, C1** as recommended above. Each is either a one-line change or a text change.
- **R2. Stale PR description.** The description still says "Draft: the full Case 2 checks …
  deferred" and "The AI pre-review has not run yet". The PR is no longer a draft, and the
  iteration-01 review is committed. Update the verification section to say which Case 2 checks
  ran on the final head. Also set a milestone.
- **R3. Feature README status.** The feature README still calls the PR a draft (as this review
  already noted). Update it in the same PR.

### Non-blocking observations

- **R4. IMDS is not memoized.** `readImdsAzEnvironment` runs on every managed-identity resolution
  that reaches the IMDS step, which includes every worker refresh for a private host without an
  override. A VM's cloud never changes during a process's lifetime, so a process-lifetime memo
  of the _successful_ value is safe. Caching the C3 snapshot covers most of this anyway.
- **R5. Worker generation consistency.** The OIDC allowlist, tenant and client ID are fixed at
  worker spawn, but the audience follows live settings. If the user changes
  `microsoft-sovereign-cloud.environment` while a shell is open, the next refresh requests a
  token for another cloud's audience while the allowlist still targets the original host. The
  C3 option A snapshot fixes this as well.
- **R6. `DOCUMENTDB_ENTRA_SCOPE` is now referenced only by tests.** Consider removing the export
  or marking it as the public-cloud constant used by tests.
- **R7. Rollout messaging.** End-to-end sovereign sign-in is unverified and depends on Microsoft
  preauthorizing VS Code's client in each cloud. Keep release notes conditional, for example
  "supported once …", until a Government token plus a database command has been observed.

### What is good

- `ALLOWED_HOSTS` stays a curated allowlist. It uses a closed `azure.{com,us,cn}` list, rejects
  lookalikes such as `azure.com.evil.com`, never echoes the raw host back, and accepts a custom
  suffix only from `machine`-scoped configuration. A cloned workspace therefore cannot widen
  where tokens are sent.
- Custom clouds never fall back silently to the public audience, and a known host/cloud
  mismatch fails before any token is requested (D8, apart from the E2 edge).
- The single Entra rule table plugs into `ConnectionDiagnosticsService`, so every existing surface
  gets the explanations without further UI work. The provider has no UI side effects, which
  matches the error-translation skill.
- Test coverage is thorough: the resolver matrix, an integration test with real resolvers, and
  settings-to-manifest parity tests.

### Second-opinion verification

| Check                                 | Result                                                                                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code reading, all nine findings       | All confirmed. C3's eviction surface is wider than the original review reported                                                                                            |
| Throwaway probes (removed afterwards) | 7 passed. C3 on all four surface/source combinations: `tokenError` with no provider call after eviction. C2 casing miss. E1 `brokerOpaque`. E2 `undefined` for mixed hosts |
| Merge-base comparison for C3          | `main` used `msg.scopes` in both workers and never read `CredentialCache`                                                                                                  |
| microsoft/vscode#307340               | Open; the impact line names Azure China and Azure US Government                                                                                                            |
| CI on `7f2a288`                       | 14 of 14 checks passing                                                                                                                                                    |
| Case 2 suite                          | Not run; this is still a review-only iteration (Case 1)                                                                                                                    |
