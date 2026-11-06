---
feature: connectivity-troubleshooter
kind: review
status: active
prs: [1066]
created: 2026-11-05
updated: 2026-11-06
---

# Diagnose connection: parallel PR review

## Scope and method

- PR: [#1066](https://github.com/microsoft/vscode-documentdb/pull/1066), still a draft.
- Reviewed head: `513a59fe19817b80db2fbe575ed7860d75a4592d`.
- GitHub base: `a4b8451359f91cc54a27dfaf2a8289506c4e98d7` (`main`).
- Merge base: `6ec182c6f314b850dad017a25c785b81f2368846`.
- Range: `git diff a4b8451359f91cc54a27dfaf2a8289506c4e98d7...513a59fe19817b80db2fbe575ed7860d75a4592d`,
  263 changed files, 51,840 insertions and 967 deletions. The initial worktree was clean.
- Placement and workflow follow [CONTRIBUTING sections 5 and 6](../../../../../CONTRIBUTING.md#6-ai-assisted-review-workflow).
  This is a new review, not a replacement for the
  [historical implementation review](./01-implementation-review.md).

Two independent passes ran **in parallel**, as requested:

| Pass | Agent         | Model             | Original finding IDs |
| ---- | ------------- | ----------------- | -------------------- |
| RD   | `rubber-duck` | `gpt-6.1-sol`     | RD1, RD2, RD3        |
| CR   | `code-review` | `claude-opus-5.5` | CR1, CR2             |

After both passes finished, each reviewer validated only the other reviewer's concrete candidates
against the code and active decisions. This supplied the cross-vendor validation gate without
replacing the independent sweeps with a shared initial checklist. The reviewers did not launch
additional agents.

The PR's review, inline-comment and non-CI issue-comment endpoints contained no reviewer feedback
when queried on 2026-11-05. There were therefore no GitHub Copilot comments to merge or link.
Revisit that step if a review is posted later.

### Severity and agreement

- **high:** major correctness or reliability failure with substantial impact.
- **med:** meaningful incorrect diagnosis or breach of the report's identifier-hiding expectation
  in a supported workflow.
- **low:** narrower race or limited-impact behavior, including the previously deferred limitation.

**Both agree** below means that both models confirmed the behavior and final severity after
cross-validation. It does **not** mean both independently discovered the same manifestation or
both reproduced it at runtime. No exact manifestation was independently reported by both.
F1 and F3 independently identify related credential-source defects; retain both reproduction cases
but address them with one coherent credential-selection change.

## Findings

**Four new findings: three med, one low. No high finding confirmed.**
One additional low item, K1, is an existing deferred limitation with a newly identified consequence,
not a new blocker.

| ID  | Severity | Finding                                                                           | Independent origin | Agreement after validation            | Proposed resolution (2026-11-06)                                    | Author decision                    |
| --- | -------- | --------------------------------------------------------------------------------- | ------------------ | ------------------------------------- | ------------------------------------------------------------------- | ---------------------------------- |
| F1  | med      | Discovery defaults replace the identity used by the working connection            | RD1                | **Both agree: med**                   | Fix: identity follows the method's source (shared with F3)          | **Accepted; done `d74501b3`**      |
| F2  | med      | Hidden reports retain private certificate identities in self-signed issuer chains | RD2                | **Both agree: med**                   | Fix: one-line redaction change, accept over-redaction               | **Accepted; done `0895ed18`**      |
| F3  | med      | Unsaved session passwords cannot be diagnosed; remediation advice loops           | CR1                | **Both agree: med**                   | Fix with F1: complete same-method session pair as fallback          | **Accepted; done `d74501b3`**      |
| F4  | low      | Concurrent Kubernetes tunnel starts inherit another caller's interactive policy   | CR2                | **Both agree: low**                   | Partial: guard diagnosis from `externalAssumed`; won't fix the rest | **Accepted; done `ef7de528`**      |
| K1  | low      | Internal hello deadlines suppress longer/no-timeout retries                       | RD3; historical S3 | **Both agree: low, already deferred** | Won't fix in this PR; keep the S3 deferral                          | Existing deferral; no new decision |

### Proposed resolutions: guiding rule

Proposals added 2026-11-06 at the operator's request. The operator accepted all of them on
2026-11-06; each finding's **Author decision** and **Done** note record the outcome.

The operator set the rule they follow: "the diagnostics should not show incorrect answers,
something not showing a detail is better than showing an incorrect one", and "a wont-fix is an
acceptable solution". So:

- Anything that can make the run test or report something other than what the user has (F1, F3,
  the diagnosis half of F4) is fixed.
- Anything that only leaks identifiers the user asked to hide is fixed, accepting over-redaction
  (F2).
- Anything that only leaves out a detail or an optional action is a won't-fix (the
  ordinary-connect half of F4, K1).

### F1 - Discovery defaults replace the selected authentication identity

**Severity:** med. **Confidence:** high. **Agreement:** RD found it; CR confirmed it.

**Evidence:** [input.ts:53](../../../../../src/connectionDiagnostics/input.ts#L53),
[input.ts:72](../../../../../src/connectionDiagnostics/input.ts#L72),
[input.ts:97](../../../../../src/connectionDiagnostics/input.ts#L97);
discovery producers at
[clusterHelpers.ts:92](../../../../../src/plugins/service-azure-mongo-vcore/utils/clusterHelpers.ts#L92)
and [clusterHelpers.ts:119](../../../../../src/plugins/service-azure-mongo-vcore/utils/clusterHelpers.ts#L119).

**Trigger and impact:** Connect to an Azure-discovered cluster as a database user different from
the ARM administrator, or with a user-assigned managed identity. Then diagnose that same cluster.
The authentication method comes from the cache, but fresh discovery configurations take precedence:

- Native authentication combines the ARM administrator username with the selected user's cached
  password. A working connection can be diagnosed as an authentication failure.
- The fresh managed-identity configuration contains only `tenantId`. It replaces the cached
  configuration containing the chosen `clientId`, testing a different identity.

Ordinary connection setup caches what the user actually chose; see
[DocumentDBResourceItem.ts:145](../../../../../src/plugins/service-azure-mongo-vcore/discovery-tree/documentdb/DocumentDBResourceItem.ts#L145).
Accepted [decision 0013](../decisions.md#0013--authentication-uses-the-chosen-method-and-nothing-else-no-method-chosen-means-skipped)
requires testing the chosen method with its associated credentials, including session-cached
credentials. No operator decision authorizes mixing identities from discovery defaults and cache.

**Validation evidence:** RD exercised the actual input builder in a file-free offline Node.js
probe. It selected the ARM administrator instead of the cached database user and produced a
managed-identity configuration without the cached client ID. CR confirmed both paths by reading
the producers and consumers. Existing input tests miss partial discovery defaults combined with a
cached selected identity.

| Option                                | Proposal                                                                                                                                                                                                                                                             | Pros                                                                                                  | Cons                                                                                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **A - recommended, together with F3** | Select the method and its identity configuration from one authoritative source. When the method comes from cache, preserve that cached native/Entra/managed-identity configuration as a unit. Fresh discovery data still supplies endpoint and transport properties. | Small, local change; matches the working connection; avoids mixing identities; no package API change. | Requires explicit source-selection and same-method cache rules; uses the session's tenant if discovery metadata subsequently changes. |
| B                                     | Add explicit provenance to credential/configuration results so discovery defaults cannot be mistaken for selected credentials.                                                                                                                                       | Makes authority clear across producers; stronger long-term contract.                                  | Broader type and producer changes across several tree-node implementations.                                                           |

**Regression validation:** Add native ARM `admin-A` plus cached `user-B/password-B`, and fresh
`{ tenantId }` plus cached `{ tenantId, clientId }` cases. Assert the configuration actually passed
to authentication preserves the selected user and client ID. Retain complete stored-credential
precedence and reject fallback from a different cached authentication method.

**Proposed resolution (agent, 2026-11-06): fix, option A, as one change with F3.**

Why it must be fixed: this is a wrong answer, not a missing detail. In the native case,
`buildDiagnosticsSetup` builds a user/password pair that no connection ever used and reports
**Authentication failed** for a connection that works. Both causes are field-by-field `??`
fallbacks in [input.ts](../../../../../src/connectionDiagnostics/input.ts): `connectionUser`,
`entraIdConfig` and `managedIdentityConfig` each prefer the target's value, so a discovery
default wins even when the method came from the cache. Azure vCore discovery never sets
`selectedAuthMethod`, see `extractCredentialsFromCluster` in
[clusterHelpers.ts](../../../../../src/plugins/service-azure-mongo-vcore/utils/clusterHelpers.ts),
so for those clusters the method always comes from the cache.

Rule: **the identity comes from the same source as the method, as a whole.**

1. **The method comes from the target** (`credentials.selectedAuthMethod` is set: saved
   connections, RU, Kubernetes, Quick Start): use the target's identity for that method. The F3
   exception is the only one: a native pair with an empty user or password falls back to the cached
   pair as a whole, see F3.
2. **The method comes from the cache** (no stored method, for example Azure vCore discovery): take
   the identity entirely from the cache: `nativeAuthConfig`, `entraIdConfig` and
   `managedIdentityConfig`. Discovery defaults (the ARM administrator name, `{ tenantId }`) never fill
   an identity field. The target still provides the connection string and connection properties
   (endpoint, TLS, emulator, port-forward).
3. **Neither source has a complete identity:** the existing explained skip (`passwordMissing` or
   `noMethod`), unchanged.

Concretely: replace the three field-level `??` chains with one `identitySource` chosen next to
`chosenAuthMethod` (`'target' | 'cache' | undefined`), and read every identity field from it. About
20 lines in one file. No package, type or producer changes. Option B (provenance on every producer)
is not needed for correctness.

This also mirrors ordinary connect, which reuses the cache entry whenever one exists, see
`ClusterItemBase.connect()` / `getChildren()` in
[ClusterItemBase.ts](../../../../../src/tree/documentdb/ClusterItemBase.ts). The diagnosis therefore
tests the same identity the working connection uses. The remaining caveat, a session tenant
that ARM has since changed, is the session's real state, not a wrong answer.

Tests (in [input.test.ts](../../../../../src/connectionDiagnostics/input.test.ts)): add the two
cases from **Regression validation** above. Assert `transientCredentials` (what reaches
`buildAuthConnectionTarget`): cached `user-B`/`password-B` despite target `admin-A`, and cached
`{ tenantId, clientId }` despite target `{ tenantId }`. Keep "honors the stored method before a
cached method" and "uses stored native credentials before cached ones" unchanged; both still hold.

**Author decision:** Accepted, option A as proposed (with F3). **Rationale:** Operator, 2026-11-06: "perform the work as now noted in the review file."
Guiding rule: no wrong answers.

> **Done (2026-11-06), commit `d74501b3`:** `buildDiagnosticsSetup` selects one identity source next
> to the method (`target` when `selectedAuthMethod` is set, otherwise `cache`) and reads the native
> pair, Entra and managed-identity configuration only from it. Discovery defaults no longer fill
> identity fields. Leader decision (95%): the subagent first also skipped when the selected _user_
> was empty; sent back, because it changed behaviour beyond the item and the "Stored password
> unavailable" message would be inaccurate. The skip stays password-only, as before. Tests: cached
> native, managed-identity and Entra identities beat discovery defaults (3 tests). Model: sol.

### F2 - Hide identifiers preserves a private self-signed certificate identity

**Severity:** med. **Confidence:** high. **Agreement:** RD found it; CR confirmed it.

**Evidence:** [redact.ts:170](../../../../../packages/documentdb-js-connection-diagnostics/src/report/redact.ts#L170)
excludes issuer chains from identifier collection;
[redact.ts:244](../../../../../packages/documentdb-js-connection-diagnostics/src/report/redact.ts#L244)
also preserves their strings verbatim. The self-issued certificate producer is
[tls.ts:147](../../../../../packages/documentdb-js-connection-diagnostics/src/checks/tls.ts#L147).
Issuer-chain facts also reach the Markdown renderer at
[renderMarkdown.ts:121](../../../../../packages/documentdb-js-connection-diagnostics/src/report/renderMarkdown.ts#L121).

**Trigger and impact:** Diagnose a TLS endpoint whose self-signed certificate contains a private
hostname or organization. Enable **Hide identifiers in the report**, then preview, copy or save.
The subject and SAN are replaced, but the same private identity survives in `issuerChain` in both
JSON and Markdown. A user can therefore share identifying values after explicitly choosing to
hide them.

RD's offline probe through the actual report builder/redactor produced the equivalent of:

```json
{
  "subject": { "CN": "certificate-1", "O": "certificate-2" },
  "issuerChain": [
    { "CN": "private-db.internal.example", "O": "Private Customer Organization" }
  ],
  "selfIssued": true
}
```

The values above are synthetic fixtures. The exception for readable public CA names does not
justify retaining private leaf identities duplicated as issuers.
[redact.test.ts:292](../../../../../packages/documentdb-js-connection-diagnostics/src/report/redact.test.ts#L292)
currently asserts preservation using identical private subject/issuer values in a purported
public-issuer fixture. Both reviewers identify this as an implementation assumption, not an
operator decision requiring private names to remain visible.

| Option              | Proposal                                                                                                                                        | Pros                                                                                                              | Cons                                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A - recommended** | Continue excluding issuer-only names from identifier collection, but apply already-known private identifier substitutions inside `issuerChain`. | Small change; fixes the duplicated self-signed subject; preserves unrelated public CA names without an allowlist. | Does not independently classify private issuer-only names; can over-redact a public issuer sharing a subject value, such as an organization name. |
| B                   | Explicitly classify self-issued or private-CA issuer identities and redact those too.                                                           | Can cover additional private issuer-only identities.                                                              | Broader policy decision; reliably distinguishing private and public issuers is harder and can hide useful CA evidence.                            |

**Regression validation:** Build self-signed TLS facts through the report builder and assert the
private hostname and organization are absent from redacted JSON **and** Markdown. Use a separate,
genuinely unrelated public-CA fixture to prove its issuer remains readable. Correct the misleading
fixture rather than treating its current assertion as proof that the behavior is safe.

**Proposed resolution (agent, 2026-11-06): fix, option A, in its smallest form. Accept
over-redaction.**

In `replace()` in
[redact.ts](../../../../../packages/documentdb-js-connection-diagnostics/src/report/redact.ts), drop
`key === 'issuerChain'` from the `keep` condition. Keep it excluded in `collect()`. In effect:

- Issuer names add no new placeholders, so an unrelated public CA such as
  `DigiCert Global G2 TLS RSA SHA256 2020 CA1` stays readable, as intended today.
- Issuer strings go through the same `replaceSubstrings` pass as every other free-text value. A
  self-signed issuer that repeats the subject CN/O, a SAN host, or a name containing one of them
  (`Contoso Internal Root CA` when the subject O is `Contoso Internal`) gets the existing placeholder.
- Markdown needs no separate change: `renderMarkdown` with `redact` renders the `redactReport`
  snapshot (renderMarkdown.ts:92).

Accepted costs, per the guiding rule (redaction is for sharing, so hiding too much is better than
leaking):

- A public issuer whose O equals the subject's O, such as `Microsoft Corporation` on both, is also
  replaced. The panel and the unredacted report still show it.
- Identifiers shorter than 3 characters are not substring-replaced, the existing threshold. That
  limit is no worse than for any other field.

Option B (classifying private issuers) is rejected: it needs a public/private CA policy, and it is
not needed to close this leak.

Tests (in
[redact.test.ts](../../../../../packages/documentdb-js-connection-diagnostics/src/report/redact.test.ts)):
split the misleading fixture into (a) a self-signed case, where subject and issuer are both
`private-db.internal.example` / `Private Customer Organization`. Assert neither value appears in
`renderJson` or `renderMarkdown` with `redact`. (b) a public-CA case with an unrelated issuer, and
assert the issuer stays readable.

**Author decision:** Accepted, option A as proposed. **Rationale:** Operator, 2026-11-06: "perform the work as now noted in the review file."
Over-redaction is acceptable; leaking hidden identifiers is not.

> **Done (2026-11-06), commit `0895ed18`:** `replace()` in `redact.ts` no longer preserves
> `issuerChain`; `collect()` still skips it, so issuer names create no placeholders. Tests: the
> misleading fixture now uses an unrelated public CA and asserts it stays readable; a new self-signed
> test asserts the private CN and O are absent from redacted `renderJson` and `renderMarkdown`
> output. It failed before the fix. Model: sol.

### F3 - A connected session with an unsaved password still cannot be diagnosed

**Severity:** med. **Confidence:** high. **Agreement:** CR found it; RD confirmed it.

**Evidence:** [input.ts:54](../../../../../src/connectionDiagnostics/input.ts#L54),
[savedConnectionSecrets.ts:21](../../../../../src/tree/connections-view/savedConnectionSecrets.ts#L21),
[DocumentDBClusterItem.ts:136](../../../../../src/tree/connections-view/DocumentDBClusterItem.ts#L136),
[DocumentDBClusterItem.ts:239](../../../../../src/tree/connections-view/DocumentDBClusterItem.ts#L239),
and [findingMessages.ts:65](../../../../../src/connectionDiagnostics/findingMessages.ts#L65).

**Reproduction:**

1. Save a connection with a username but no saved password. The absent stored password is `''`.
2. Connect normally, enter a password, and decline to save it. The entered credentials are cached
   for that session.
3. Run Diagnose connection.

The stored empty string wins over the usable cached password because selection uses `??`.
Authentication, database access and server facts are skipped. The proposed next step says to
connect and enter the password, repeating what the user just did.

The test at [input.test.ts:100](../../../../../src/connectionDiagnostics/input.test.ts#L100)
explicitly asserts that the stored empty string wins. Cross-validation found no accepted operator
decision forbidding session-password fallback; accepted
[decision 0013](../decisions.md#0013--authentication-uses-the-chosen-method-and-nothing-else-no-method-chosen-means-skipped)
allows credentials cached after a connection in this session.

**Qualification from validation:** Do not justify fallback by claiming all failed connections evict
credentials. Initial failures do, but cached reconnect failures can retain them:
[ClusterItemBase.ts:308](../../../../../src/tree/documentdb/ClusterItemBase.ts#L308).
A cached password can be stale; diagnostics should then test it and report the real failure.

**Relationship to F1:** Same selection boundary and shared fix, but a different supported workflow:
F1 concerns discovery defaults overriding a cached chosen identity; F3 concerns an absent stored
password blocking a usable session identity. Keep both regression cases.

| Option                                | Proposal                                                                                                                                                                            | Pros                                                                                                                           | Cons                                                                                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A - recommended, together with F1** | Use a complete authoritative stored native pair when available; otherwise use the complete cached native pair for the same cluster and selected method; otherwise explain the skip. | Supports unsaved passwords; never pairs one user's name with another user's password; retains complete stored-pair precedence. | Requires explicit eligibility rules and changing the existing empty-password expectation; stale cache can produce a genuine authentication failure. |
| B                                     | Replace field-level `??` with `\|\|` fallback.                                                                                                                                      | Very small patch; recognizes the empty-string sentinel.                                                                        | Can still mix a stored username with another user's cached password; does not solve F1's configuration provenance. Not recommended.                 |
| C                                     | Retain behavior and advise saving the password.                                                                                                                                     | No runtime behavior change.                                                                                                    | Keeps the core check unavailable to users who do not save passwords and conflicts with session-credential intent. Not recommended.                  |

**Regression validation:** Cover an unsaved password after a successful wizard connection,
different stored/cached usernames, mismatched cached methods, and complete stored-pair precedence.
Assert that the authentication check runs with the selected pair, not merely that the setup says
`available`. Revise the existing expectation only after the author approves the behavior correction;
do not silently rewrite a failing `TDD:` contract.

**Proposed resolution (agent, 2026-11-06): fix, option A, inside the F1 rule.**

Within rule 1 of F1 (the method comes from the target): when that method is native and the target's
pair is incomplete (empty user or empty password, so `''` counts as absent), use the cached native
pair **only if** `cached.authMechanism` is also native and the cached user and password are both
non-empty. Take both values from the cache, never one field. Otherwise skip with
`passwordMissing`, as today.

Why this is not a wrong answer:

- The cached pair is exactly what this session's working connection uses. `DocumentDBClusterItem`
  caches the pair the wizard returned
  ([DocumentDBClusterItem.ts](../../../../../src/tree/connections-view/DocumentDBClusterItem.ts),
  `setAuthCredentials`), and ordinary connect reuses it while the entry exists.
- If that pair is stale, after a cached reconnect failure, the authentication failure the diagnosis
  reports is the session's real state.
- The user may have confirmed a different user name in the wizard. Taking the whole pair means the
  report names the user who actually connected.

Option B (`||`) is rejected: it can pair the stored user with another user's password, the same
class of wrong answer as F1. Option C is rejected: it leaves the core check unavailable for anyone
who does not save passwords.

With this fix, `passwordMissing` only fires when neither a saved password nor a session password
exists. The current next step, "Connect to the cluster and enter the password, then run the check
again." ([findingMessages.ts](../../../../../src/connectionDiagnostics/findingMessages.ts)), is then
accurate and no longer loops. No wording change is required. An optional precision: change the
explanation to "No password is saved, and none was entered in this session." This is not
required, and it costs an l10n update.

Tests: the test `does not replace an explicitly empty stored password with a stale cached password`
is **not** a `TDD:` contract, so it can be revised once the author approves. Change it to expect the
cached pair (user and password both from the cache). Add these cases:

- cached pair with a different user name: whole cached pair used;
- cached method not native: still `passwordMissing`;
- cached pair with an empty password: still `passwordMissing`;
- complete stored pair plus a different cached pair: the stored pair wins (existing test).

**Author decision:** Accepted, option A as proposed, inside the F1 rule. **Rationale:** Operator, 2026-11-06: "perform the work as now noted in the review file."
The existing empty-password test may be revised (it is not a `TDD:` contract).

> **Done (2026-11-06), commit `d74501b3`** (shared with F1): when the stored method is native and
> the stored pair has an empty user or password, a cached pair is used only if the cached method
> is native and both cached values are non-empty, and then as a whole. `findingMessages.ts` wording is
> unchanged (the optional precision was not taken). Tests: the empty-password test now expects
> the cached pair; added a different cached user (whole pair), a non-native cached method and an
> empty cached password (both `passwordMissing`), plus parameterized variants. 24 tests in
> `input.test.ts` pass. Model: sol.

### F4 - Kubernetes single-flight startup shares caller-specific prompt policy

**Severity:** low. **Confidence:** high from code tracing; not runtime-reproduced.
**Agreement:** CR found it; RD confirmed both directions.

**Evidence:** [portForwardTunnel.ts:228](../../../../../src/plugins/service-kubernetes/portForwardTunnel.ts#L228)
joins a pending start without checking the joining caller's interactive policy. The pending promise
is published at [portForwardTunnel.ts:248](../../../../../src/plugins/service-kubernetes/portForwardTunnel.ts#L248)
before binding or prompting, because startup first suspends on the import at
[portForwardTunnel.ts:333](../../../../../src/plugins/service-kubernetes/portForwardTunnel.ts#L333).
Noninteractive and interactive occupied-port handling differ at
[portForwardTunnel.ts:445](../../../../../src/plugins/service-kubernetes/portForwardTunnel.ts#L445)
and [portForwardTunnel.ts:456](../../../../../src/plugins/service-kubernetes/portForwardTunnel.ts#L456).

**Trigger and impact:** Start diagnosis and ordinary connection concurrently for the same
Kubernetes tunnel while another process occupies its local port:

- Diagnosis first: an ordinary connect joining the noninteractive start inherits
  `LocalPortInUseError`, rather than offering its normal **Use existing** choice.
- Ordinary connect first: diagnosis joining the interactive start waits for someone else's
  warning prompt. If the user chooses **Use existing**, diagnosis inherits `externalAssumed`,
  despite the diagnostic surface saying it does not use another program's occupied port.

The join branch only changes `started` to `reused`; it does not reject `externalAssumed`.
[KubernetesReachabilityProvider.ts:49](../../../../../src/plugins/service-kubernetes/KubernetesReachabilityProvider.ts#L49)
forwards the outcome without a caller-specific eligibility check.

The corresponding occupied-port policy at [decisions.md:1100](../decisions.md#L1100)
is marked **Proposed**, not explicitly operator-approved. This qualification does not remove the
ordinary-connect UX regression caused by inheriting a diagnostic caller's policy.

| Option                               | Proposal                                                                                                                                                                                                                                        | Pros                                                                                                                                   | Cons                                                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **A - recommended after validation** | Share raw binding work/outcomes, not caller-specific prompting. Publish the bind/busy outcome before any prompt; noninteractive callers reject busy ports, while interactive callers apply their own recovery policy. Retain generation checks. | Fixes both directions; preserves single-flight binding; diagnosis never awaits someone else's prompt; ordinary connect retains its UX. | Refactors a sensitive concurrency boundary and needs careful stop/invalidation coverage.                        |
| B                                    | Track the pending start's mode. Reject incompatible noninteractive joins before awaiting a prompt-bearing promise; let an interactive caller retry its own recovery after a noninteractive busy-port failure.                                   | Can be narrower than separating bind and recovery phases.                                                                              | More mode-dependent branches and retry races; rejecting only after awaiting the shared promise is insufficient. |
| C                                    | Explicitly defer the race.                                                                                                                                                                                                                      | No immediate implementation risk.                                                                                                      | Leaves the ordinary-connect regression and diagnostic-policy contradiction.                                     |

**Regression validation:** Add mixed-policy concurrency tests in both orders. Hold the interactive
warning unresolved and assert diagnosis settles without answering it. Verify the ordinary caller
still receives and can accept **Use existing**. Exercise `stopTunnel()` and `stopAll()` during the
overlap to guard against stale results or duplicate starts. Existing tests cover only individual
noninteractive starts, not this mixed-caller scenario.

**Proposed resolution (agent, 2026-11-06): partial fix. Guard the wrong-answer direction, won't-fix
the rest.**

The two directions differ under the guiding rule:

- **Ordinary connect first, diagnosis joins (wrong answer, fix).** Diagnosis can inherit
  `externalAssumed` and test a port that another program owns, contradicting what the diagnostic
  surface says it does. In the join branch of `startTunnel`
  ([portForwardTunnel.ts](../../../../../src/plugins/service-kubernetes/portForwardTunnel.ts)), add:
  when `options?.interactive === false` and the joined result is `externalAssumed`, throw
  `LocalPortInUseError(params.localPort, 'otherProgram', …)`. That is the same error and message a
  non-interactive start already throws. About 5 lines, and the diagnosis reports
  `prepare.localPortInUse`, which is true.
- **Diagnosis waits for someone else's prompt (accept).** The `prepare` timeout and Cancel bound
  that wait. If it expires, the report says preparation timed out, which is true. A retry after the
  prompt closes starts its own non-interactive bind and reports the occupied port correctly.
- **Diagnosis first, ordinary connect joins (won't fix).** Connect fails with "Port {0} is already
  in use. Choose a different local port.", which is accurate. It only misses the **Use existing**
  offer for this one overlapping attempt; the next connect gets the normal prompt. This is a narrow
  race (two simultaneous starts of the same tunnel while the port is externally occupied), and the
  UX cost does not justify refactoring the single-flight boundary (option A) or adding mode-dependent
  retries (option B).

Tests: one mixed-policy test. An interactive start with an occupied port resolves `externalAssumed`
through a stubbed `showWarningMessage`. A concurrent `interactive: false` join rejects with
`LocalPortInUseError`, while the interactive caller still receives `externalAssumed`. Do not add
`stopTunnel()` / `stopAll()` overlap tests: the guard does not touch the generation logic.

Decision to record if accepted: [0036](../decisions.md#0036--the-troubleshooter-reads-connection-details-silently-and-prepares-kubernetes-tunnels-only-in-prepare)
point 3 is still **Proposed**. Accepting this resolution is a good moment to have the operator
confirm that policy, and note there the accepted race.

**Author decision:** Accepted (partial fix as proposed, with a `TDD:` contract test).
**Rationale:** Operator, 2026-11-06: "I also accept F4. and adding that TDD test." The remaining
race is recorded in decision 0036.

> **Done (2026-11-06), commit `ef7de528`:** in the join branch of `startTunnel`, a caller with
> `interactive: false` that joins a start resolving `externalAssumed` now throws the existing
> `LocalPortInUseError` (`otherProgram`, same localized message, so no new l10n string). Test:
> `TDD: concurrent tunnel starts keep the non-interactive port policy`. An interactive start holds
> the **Use existing** prompt, a non-interactive join waits, the prompt is accepted, and then the
> interactive caller gets `externalAssumed` while the join rejects. The prompt is shown once. The test
> failed before the fix. Model: sol.

### K1 - Known/deferred: hello reply deadlines do not enable timeout retries

**Severity:** low. **Confidence:** high.
**Agreement:** Both confirm the behavior and its existing deferred status.

**Provenance:** This extends historical
[S3](./01-implementation-review.md#L1019), whose timeout-accounting root cause was explicitly left
documented on 2026-10-30. Do not count it as a new blocker or silently reverse that decision.
The additional consequence identified here is hidden retry actions.

**Evidence:** [hello.ts:445](../../../../../packages/documentdb-js-connection-diagnostics/src/checks/hello.ts#L445)
and [hello.ts:537](../../../../../packages/documentdb-js-connection-diagnostics/src/checks/hello.ts#L537);
[runner.ts:212](../../../../../packages/documentdb-js-connection-diagnostics/src/runner.ts#L212)
and [runner.ts:443](../../../../../packages/documentdb-js-connection-diagnostics/src/runner.ts#L443);
[DiagnosticsResultCard.tsx:384](../../../../../src/webviews/documentdb/connectionDiagnostics/DiagnosticsResultCard.tsx#L384).

A peer accepts TCP but supplies no hello response, or only a delayed partial response.
The internal reply deadline ends with `hello.noReply` or `hello.inconclusive/truncated`, before
the runner's timer. Because coverage accounts for `check.timeout`, it can report
`limited: false`, an empty `timedOut` list and `retryWouldHelp: false`.
The panel consequently offers neither longer-timeout nor timeout-free retry, even though its own
deadline stopped the probe.

RD reproduced this with the actual runner/hello check and an in-memory silent socket; CR validated
the path and historical decision. Existing hello tests exercise deadline classification but not the
resulting runner coverage and retry visibility.

| Option                                                 | Proposal                                                                                     | Pros                                                                                                                                           | Cons                                                                                                                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A - recommended disposition now**                    | Keep this consequence attached to the existing S3 deferral.                                  | Respects the author's prior decision; avoids unrelated contract changes during review fixes.                                                   | Retry actions remain unavailable for this diagnostic timeout.                                                                                                  |
| B - recommended comprehensive fix when S3 is addressed | Add explicit timeout metadata, including its source, independent of finding codes.           | Consistent across hello, TCP and future specialized outcomes; preserves the distinction between diagnostic and connection-configured timeouts. | Larger public result-contract and propagation change.                                                                                                          |
| C                                                      | Add `check.timeout` alongside the specific hello finding when a diagnostic deadline expires. | Reuses existing coverage/retry accounting.                                                                                                     | Produces duplicate error findings unless presentation is adjusted; must retain the limiting timeout source.                                                    |
| D                                                      | Teach runner accounting about specialized timeout codes.                                     | Smaller change without duplicate findings.                                                                                                     | Brittle code list; `hello.inconclusive/truncated` still needs explicit deadline/source evidence to avoid treating every partial reply as a diagnostic timeout. |

**Regression validation if reopened:** Run hello through the real runner with a silent peer and a
delayed partial reply; assert limited coverage and retry availability when diagnostic timeouts
apply. Separately test connection-configured timeouts and completed malformed replies so they do
not acquire misleading timeout-retry guidance.

**Proposed resolution (agent, 2026-11-06): won't fix in this PR. Keep option A, the S3 deferral.**

Under the guiding rule this is a missing detail, not a wrong answer:

- The **Server greeting (hello)** row fails with `hello.noReply` ("The server sent no handshake
  reply before the reply deadline.", with `waitedMs`) or `hello.inconclusive/truncated`. Both are
  true.
- What is missing is the pair of retry buttons and the retry advice. Users can still Re-run, or
  choose a longer profile on a later run if one is offered.
- The Markdown report makes no "not limited" claim. Its Coverage section lists timed-out operations
  only when there are some (renderMarkdown.ts:238).

The only imprecise value is `coverage.limited: false` in the JSON report and in the
`coverageLimited` telemetry property. It matches the runner's definition (a recorded `check.timeout`,
a check not started, or an omitted target), and nothing in the panel or Markdown presents it as a
statement to the user. Accept it with the deferral. Do not adopt option D, the hard-coded code list:
`hello.inconclusive/truncated` is also used for replies that finished malformed, so treating it as a
timeout would produce wrong retry advice. Option B remains the right fix if S3 is reopened.

**Author decision:** Existing S3 deferral retained.
**Rationale:** The earlier review records the author's decision; this pass does not invent a new one.
**Implementation:** None.

## Outcome and verification limits

- Both requested agents and models completed independent parallel reviews and a bounded
  cross-vendor validation pass. Agreement and origin are recorded per finding above.
- CR ran `npx vitest run src/connectionDiagnostics/input.test.ts`: **1 file, 14 tests passed**.
  Passing tests include the disputed empty-password expectation; they do not refute F3.
- RD ran two file-free offline Node.js stdin probes using in-memory TypeScript transpilation:
  one exercised the real input builder and runner/hello check, and one exercised the real report
  builder/redactor. They made no external connections and created no repository files.
  These were reviewer probes, not committed regression tests; their complete harnesses are not
  included in this document.
- Neither cross-validation pass ran tests or probes. No `TDD:` contract failure was reported.
- Combined reading covered diagnostic inputs, ordinary authentication, discovery credential
  producers, preparation/tunnels, runner/cancellation, network probes, report generation, panel
  session/router/report actions, telemetry and error-explanation rename callers.
- RD covered the network package and webview behavior more broadly; CR only skimmed the lower-level
  DNS/SRV/TCP/TLS/hello checks and did not review visual/accessibility styling. Code inspection is
  not installed-workbench UX, screen-reader, packaging or live-service validation.
- No live Azure/Entra/Kubernetes, remote-host or installed-extension verification was performed.
  Generated localization and lockfile noise were not exhaustively reviewed. This was not a
  dedicated security audit.
- **Case 1: still working.** This remains a draft PR, not a ready-for-review handoff.
  No new build was run for this documentation-only result. Full Case 2 checks, including
  `prettier-fix`, were deferred until ready for review; this report does not claim that suite passed
  at the reviewed head. Earlier checks mentioned in the PR body were not rerun here.
- This pass adds only this review document. No runtime fixes, author approvals, commits, pushes,
  GitHub review submissions or PR-readiness changes were made.

Before handing over, record the author's decision **and reasoning inline under each finding**,
implement approved fixes with their validation and commit references, check in the review, merge
any subsequently posted Copilot comments, complete operator acceptance, and run every required
Case 2 command. The existence of this review alone is not readiness approval.

**Follow-up (2026-11-06):** the operator accepted F1–F4 and kept K1 deferred. Fixes landed with the
`/lead` workflow in `ef7de528` (F4), `0895ed18` (F2) and `d74501b3` (F1, F3), each written by a
`gpt-6.1-sol` subagent and reviewed by the leader. Case 1 ran after the batch: `npm run build` passed; focused Vitest (51 files, 1,283 tests) passed.
Case 2 had not run at that point.

**Case 2 handover (2026-11-06):** `gpt-5.6-terra` ran the full suite after the F1-F4 fixes.
`npm run l10n`, `npm run prettier-fix`, `npm run l10n:check`, `npm run lint`,
`npm run build`, `npm run typecheck:tests`, `npx vitest run` and `npm run package`
all passed. Vitest reported 379 passing files, 7,406 passing tests and one skipped test.
Packaging produced an 8.61 MB VSIX. The generated formatting changes are included in this handover.
No new live-service or installed-extension verification was performed; the limits above still apply.
