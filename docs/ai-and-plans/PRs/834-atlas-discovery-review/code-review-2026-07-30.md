# PR #765 Code Review: MongoDB Atlas Discovery Provider

Review date: 2026-07-30 (first pass), 2026-07-30 (second pass / independent reassessment),
2026-07-31 (owner decisions applied)

PR: https://github.com/microsoft/vscode-documentdb/pull/765

Base: `release/0.10.0`

> **For the implementing agent:** start at
> [Recommended Disposition](#recommended-disposition). Findings that carry a `— FINAL DECISION:`
> subsection have been ruled on by the owner; that subsection supersedes any earlier
> "Owner decision" or "Recommendation" paragraph inside the same finding, which is retained only so
> the reasoning trail stays readable. Requested code comments are part of the deliverable.

## Implementation Iteration — Executive Summary

Branch: `dev/tnaum/atlas-discovery-review-iteration` (cut from `feature/atlas-discovery`).
Iteration date: 2026-07-31. Each work item is one commit; each finding below carries an inline
`✅ RESOLVED` note at the end of its section pointing at the fix and tests.

Implementation PR: https://github.com/microsoft/vscode-documentdb/pull/834 (targets
`feature/atlas-discovery`). This document lives under `docs/ai-and-plans/PRs/834-atlas-discovery-review/`
because it now belongs to that implementation PR, not the original review-target PR #765.

**PR checklist (all green):** `npm run l10n` → `npm run prettier-fix` → `npm run lint` →
`npx jest --no-coverage` (180 suites, **2941 tests pass**, up from 2905) → `npm run build`.

### Implemented (one commit each)

| Finding(s)                         | What was done                                                                                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **MEDIUM-1**                       | `signal?.throwIfAborted()` before `persistCredential()` in both auth methods.                                                                                                                                |
| **WITHDRAWN-1 + NEW-4**            | Sign the full Digest request-target; cache the challenge and reuse with an incrementing `nc`.                                                                                                                |
| **NEW-2**                          | Added `mongoDBAtlas` to the four remaining `treeitem_index` `when` clauses.                                                                                                                                  |
| **MEDIUM-2**                       | Serialized `listAll()` passes; `invalidate()` keeps `inflight`; per-pass timeout; abort/timeout classifier.                                                                                                  |
| **MEDIUM-3 + NEW-3**               | Typed `AtlasTokenError`; rethrow transient token failures; classifier-driven tree modal + refresh-vs-expand rule.                                                                                            |
| **NEW-8**                          | Reverted per-source shell terminal labelling; restored the four original DocumentDB message IDs.                                                                                                             |
| **MEDIUM-4**                       | `updateAtlasCredentialMetadata` no longer rewrites secrets; per-credential generation guard on `storeSession`.                                                                                               |
| **LOW-1 + LOW-2**                  | `openUrl()` returns the open result; router notifies on failure; credential-neutral `403` fallback.                                                                                                          |
| **LOW-3 + LOW-4**                  | One localized tooltip field list using "Server version"; `requiresInitialCollection` comment terminology.                                                                                                    |
| **NEW-5 + NEW-6 + NEW-7 + INFO-1** | Tree/wizard parity for non-connectable clusters; journey correlation ID threaded from root; payload guards (`connectionStrings?`, `UNKNOWN` state, `?? ''` comparators); `AtlasClusterType` union folded in. |

### Skipped / not implemented (with reasons)

- **NEW-1** (footer experiment): the experiment itself is kept per the FINAL DECISION (intended for
  a preview release), but the experimental adaptive footer position now defaults to **off**
  (`adaptiveFooterEnabled = false`) so it is opt-in via the preview switch rather than the default
  behaviour. Removal checklist for the preview exit remains recorded in the finding.
- **NEW-9** (`config.ts` module-load `l10n.t()`): accepted per the FINAL DECISION — left consistent
  with the two Azure plugins; tracked extension-wide instead of fixing one plugin in isolation.
- **NEW-10 – NEW-13** (dead code, recursive prompt, token-shape check, unrelated-bundling): marked
  non-blocking / accepted in the work order. Not addressed to keep scope to the disposition. NEW-13's
  `requiresInitialCollection`-once-saved sub-point is left for an explicit product decision.
- **Deferred issues (ISSUE-1 zod boundary, ISSUE-2 platform-aware shell, ISSUE-3 extension-wide
  `l10n.t()`):** the disposition says "file these, do not implement". They are **not** implemented.
  They were also **not auto-filed as GitHub issues** — creating public issues is a shared-system
  action left for the operator; the ready-to-paste bodies remain in "Follow-up Issues to File".

### Deviations from the plan (confidence-based)

- **WITHDRAWN-1 Digest URL parsing:** the proposal snippet used `new URL(path, ATLAS_API_BASE_URL)`,
  which would drop the base's `/api/atlas/v2` path prefix because request paths start with `/`. The
  concatenated string is parsed directly instead — same "one parsed URL" intent, correct for the
  path-prefixed base. (Confidence > 80%; documented in the finding.)
- **LOW-1 tests:** the requested router-level notification tests were not added — there is no
  existing `appRouter` caller test harness and `appRouter` transitively imports the full webview
  router graph, so a bespoke harness was disproportionate for a Low finding. The `openUrl` util
  boolean contract is tested; the router branch is trivial and type-checked. (Documented in LOW-1.)
- **INFO-1** (non-blocking) was folded into NEW-7 because that finding already reopened the same
  model files, matching the reviewer's "whenever the touched model is next updated" guidance.

## Severity Summary

Counts reflect the state **after the owner decisions of 2026-07-31**. Movement is tracked in the
next two tables.

| Severity      | Count | Notes                                                                                                             |
| ------------- | ----: | ----------------------------------------------------------------------------------------------------------------- |
| Critical      |     0 | No extension-wide, destructive, or secret-disclosure failures found.                                              |
| High          |     0 | The only High (NEW-1) was accepted: the footer experiment is intended for a preview release.                      |
| Medium        |     5 | Cancellation persists a secret; discovery passes race; auth errors misclassified; index menus and Digest traffic. |
| Low           |     9 | Four confirmed from pass 1, one downgraded from Medium, four new consistency / robustness issues.                 |
| Informational |     8 | Model typing, six code-health items, plus NEW-1 after acceptance.                                                 |

Net movement in the second pass:

| Finding                        | Pass 1       | Pass 2                    | Why                                                                                      |
| ------------------------------ | ------------ | ------------------------- | ---------------------------------------------------------------------------------------- |
| MEDIUM-4 (credential writes)   | Medium       | **Low**                   | Three of the four claimed scenarios do not reproduce against the actual store/push code. |
| MEDIUM-1 (cancel then persist) | Medium       | Medium (impact corrected) | The stated "tree is not refreshed" consequence is wrong; the real defect is narrower.    |
| WITHDRAWN-1 (Digest URI)       | Withdrawn    | Withdrawn, Informational  | Confirmed withdrawal; a materially larger Digest problem sits next to it (NEW-4).        |
| NEW-1 … NEW-13                 | not reported | High/Medium/Low/Info      | Second-pass findings, listed under "Second-Pass Findings".                               |

Owner decisions, 2026-07-31 — these are the authoritative dispositions:

| Finding      | Decision                                                                 | Effect                                                      |
| ------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------- |
| **MEDIUM-2** | **Proposal B** (serialize passes), not the complete-snapshot redesign.   | Much less code; comments required to explain the chaining.  |
| **MEDIUM-4** | Second-pass fix (stop rewriting secrets), not the per-credential queue.  | Severity stays Low; comments required.                      |
| **NEW-1**    | **Accepted, no change.** This ships as a preview release.                | High → Informational; nothing to implement.                 |
| **NEW-3**    | **Proposal A.** Modals on interaction are intended; suppress on Refresh. | Premise of the finding corrected, wording fix still needed. |
| **NEW-7**    | Proposal B now; file an issue for the `zod` boundary.                    | ISSUE-1.                                                    |
| **NEW-8**    | **Revert the shell labelling entirely**; do not tweak it.                | ISSUE-2 covers the real feature.                            |
| **NEW-9**    | Leave as-is; the deferral question is extension-wide.                    | ISSUE-3.                                                    |

## Review Scope

The review compares `feature/atlas-discovery` with the PR's actual base,
`release/0.10.0`. It covers the Atlas Admin API and authentication, credential storage,
multi-credential discovery aggregation, tree and connection flows, credential-management webview,
tRPC boundary, database and shell integration, package registration, tests, and workflow changes.

The design history in `docs/ai-and-plans/PRs/733-atlas-mongodb-discovery/` was consulted to avoid
reporting intentional multi-credential, partial-failure, tree/list, and recovery behavior as bugs.

### How the second pass was run

Every pass-1 finding was re-derived from the branch source rather than from the pass-1 text, and
each claimed consequence was traced to the code that would actually produce it. Three claims did
not survive that trace and are corrected below. The second pass then widened the search to areas
pass 1 did not cover: the React credential view, `package.json` menu `when` clauses, the
non-Atlas files bundled into the same commit, and cross-plugin consistency with the four discovery
providers that already exist in this repository.

## Withdrawn Finding

### WITHDRAWN-1: Digest authentication signs a different URI than the request sends

Source: Independent review.

**Reassessment: Withdrawn. No severity.** Live testing with an API Key on the current branch showed
that Atlas discovery succeeds with the existing path-only Digest value. That test did exercise the
relevant query-string case even with only a few resources: `requestAllPages()` unconditionally adds
`?itemsPerPage=500&pageNum=1` before the first request. A short first page changes only when the loop
stops; it does not bypass pagination parameters or use a different authentication path.

Files:

- `src/plugins/service-atlas-mongodb/api/AtlasApiClient.ts`
- `src/plugins/service-atlas-mongodb/api/AtlasApiClient.test.ts`

There is still a standards discrepancy. RFC 7616 section 3.4.6 says the Digest `uri` must agree with
the request target, and MongoDB's supported Go SDK uses `req.URL.RequestURI()`, which includes the
query string. The current implementation instead signs `new URL(url).pathname` while `fetch()` sends
the query as well. That establishes an RFC-conformance and future-compatibility concern, but not a
current product defect against Atlas. The original review incorrectly promoted the standards-based
hypothesis to a guaranteed Atlas failure without target-specific evidence.

Multi-page traversal does not add a distinct failure mode here. Page 2 repeats the same challenge
and response path with `pageNum=2`; if Atlas accepts a Digest value that omits the page-1 query, there
is no code or documented server behavior suggesting that it validates the page-2 query differently.
A live page-2 probe would add confidence, but the absence of that probe does not justify a High
finding.

**Optional hardening proposal: derive the URL and Digest request-target from one parsed URL.**

```typescript
const parsedUrl = new URL(path, ATLAS_API_BASE_URL);
const url = parsedUrl.toString();
const digestUri = `${parsedUrl.pathname}${parsedUrl.search}`;

const authHeader = computeDigestHeader(
  'GET',
  digestUri,
  this.session.publicKey,
  this.session.privateKey,
  challenge,
  this.digestNonceCount,
);
```

Why this helps: `fetch()` and the Digest calculation are derived from the same parsed value, so a
future query parameter cannot be added to the transmitted URL without also appearing in the
signed request-target.

Pros:

- Aligns the implementation with RFC 7616 and MongoDB's supported Go SDK.
- Remains correct if the base URL later gains a path prefix.
- Makes the invariant visible beside the authentication code.

Cons:

- Slightly broadens the change from one expression to URL construction.
- A future caller must still pass only paths accepted by the client.

**Owner decision: implement the hardening proposal.** The live test means this is not a confirmed
Atlas failure and does not restore the former High severity, but matching RFC 7616 and MongoDB's
supported Go SDK is preferable to relying on Atlas's current tolerance. Verify the change with an
Authorization-header unit test and a live API Key request. To exercise a second page without
creating 500 resources, use a focused live probe with a temporary page size of 1 and at least two
visible resources. The extension trace line ending in `(digest challenge answered)` can confirm
that the successful request used the Digest branch.

**Second-pass assessment: withdrawal upheld. Severity: Informational.** `requestOnce()` still signs
`new URL(url).pathname` while `fetch(url, …)` sends `?itemsPerPage=500&pageNum=N`, so the
discrepancy described above is exactly what the code does. Nothing found in the second pass turns
it into a product defect, and the owner-selected hardening is the right disposition.

Two things should be recorded alongside it:

- **The Digest path has no test coverage at all.** `AtlasApiClient.test.ts` covers the error
  envelope, diagnostic headers, pagination, and the Service Account refresh/`403` behaviour. There
  is no test that exercises the challenge/response branch, so `computeDigestHeader`'s output is
  never asserted from the client's side. The hardening therefore lands on untested code; the
  Authorization-header test the owner asked for is the first test this branch will have.
- **A materially larger Digest problem sits next to this one.** The request-per-call structure of
  the Digest branch, not the signed URI, is what will actually be felt by API Key users. See
  [NEW-4](#new-4-digest-authentication-repeats-the-unauthenticated-challenge-on-every-request).

> ✅ **RESOLVED (dev/tnaum/atlas-discovery-review-iteration), together with NEW-4.** `requestOnce()`
> now derives both the transmitted URL and the Digest request-target from one parsed URL, signing
> `${pathname}${search}` so the query string is part of the signed target (RFC 7616 §3.4.6).
> Deviation from the proposal snippet: `new URL(path, ATLAS_API_BASE_URL)` would drop the base's
> `/api/atlas/v2` path prefix (path segments start with `/`), so the concatenated string is parsed
> directly instead — same single-parsed-URL intent, correct for the path-prefixed base.
> Fix: [src/plugins/service-atlas-mongodb/api/AtlasApiClient.ts](../../../../src/plugins/service-atlas-mongodb/api/AtlasApiClient.ts).
> Tests: first Digest-branch coverage added in
> [AtlasApiClient.test.ts](../../../../src/plugins/service-atlas-mongodb/api/AtlasApiClient.test.ts),
> asserting the signed request-target equals `/api/atlas/v2/groups?itemsPerPage=500&pageNum=1`.

## Active Findings

### MEDIUM-1: Closing credential setup can still persist the credential

Source: Independent review.

**Reassessment: Confirmed. Severity: Medium (unchanged).** Closing the panel is a clear cancellation
signal, yet the operation can still write a secret and report completion to a controller whose
opener has already resolved `false`. The impact is surprising persistent state, but not a privilege
bypass or secret disclosure: the user supplied the credential and explicitly selected Verify.

Files:

- `src/webviews/documentdb/atlasCredentials/atlasCredentialsController.ts`
- `src/webviews/documentdb/atlasCredentials/atlasCredentialsRouter.ts`
- `src/plugins/service-atlas-mongodb/auth/AtlasServiceAccountClient.ts`

Disposing a webview aborts its in-flight tRPC operation through `ctx.signal`, and the controller
immediately resolves the credential flow as `false`. Both submit mutations ignore that signal:
the API Key path does not pass it to `listProjects()`, the Service Account token helper does not
accept one, and neither path checks for cancellation before `persistCredential()`.

If a user closes the tab while verification is waiting on Atlas, the host operation can finish
later, write the credential, and call `onCredentialPersisted()`. The opener has already settled as
cancelled, so it does not refresh the tree and the user is left with a silently stored credential
from a flow they closed.

**Second-pass assessment: mechanism confirmed, stated impact corrected. Severity: Medium
(unchanged).**

The mechanism is exactly as described. In `atlasCredentialsController.ts`, `onDisposed` calls
`finish(state.credentialsStored)`, which is still `false` while verification is in flight, so the
promise settles `false`; the later `onCredentialPersisted()` hits the `settled` guard and is
discarded after the write has already happened.

One consequence in the pass-1 text is wrong and should not be used to justify the fix:

> "The opener has already settled as cancelled, so it does not refresh the tree."

`configureAtlasCredentials()` calls `discoveryService.reset()` and `refreshDiscoveryTree(node)`
**unconditionally**, outside the `changed` check, precisely because Atlas-side state can change
while the QuickPick is open. The tree is therefore refreshed either way; the real problem is
ordering — the refresh runs before the late write lands, so the newly stored credential is invisible
until the next expansion past the 30 s snapshot TTL. The defect that justifies Medium is narrower
and simpler: **a secret is written to SecretStorage after the user closed the flow**, and the
caller (for example `getDiscoveryWizard`, which throws `UserCancelledError` on `false`) proceeds as
if nothing was stored.

The proposal also needs one correction before it can be implemented as written. `signal` is
declared **optional** on the framework `BaseRouterContext`; `appRouter.ts` documents the intended
usage as `myCtx.signal?.aborted`. So `myCtx.signal.throwIfAborted()` will not compile under the
repository's strict settings. The commit guard must be:

```typescript
myCtx.signal?.throwIfAborted();
await persistCredential(myCtx, secrets);
```

`AbortSignal.throwIfAborted()` also requires a modern lib target; if that is not available, use the
equivalent explicit check and throw `UserCancelledError`, which the telemetry middleware already
classifies as a cancellation rather than a failure.

**Proposal A: propagate the operation signal and guard the commit point.**

```typescript
const projects = await client.listProjects(myCtx.signal);

const tokenResponse = await fetchServiceAccountToken(clientId, clientSecret, myCtx.signal);

myCtx.signal.throwIfAborted();
await persistCredential(myCtx, secrets);
```

```typescript
export async function fetchServiceAccountToken(
  clientId: string,
  clientSecret: string,
  signal?: AbortSignal,
): Promise<AtlasServiceAccountTokenResponse> {
  const response = await fetch(ATLAS_SERVICE_ACCOUNT_TOKEN_URL, {
    method: 'POST',
    headers,
    body,
    signal,
  });
  // Keep the existing non-2xx handling here.
  return (await response.json()) as AtlasServiceAccountTokenResponse;
}
```

Why this helps: disposal aborts the network request where possible, and the final check closes the
important window between successful verification and the persistent write.

Pros:

- Follows the repository's tRPC cancellation contract.
- Stops unnecessary token and list requests after disposal.
- Preserves the current behavior that a verified credential is stored before the success screen.

Cons:

- The signal must be threaded through token acquisition, list calls, and best-effort error-action
  lookups.
- Abort errors must remain classified as cancellation rather than being converted to inline auth
  errors.

**Proposal B: stage verified secrets and persist only from the completion mutation.**

```typescript
// submitServiceAccount / submitApiKey
myCtx.credentialState.pendingSecrets = secrets;
return { success: true };

// complete
myCtx.signal.throwIfAborted();
await persistCredential(myCtx, nonNullProp(myCtx.credentialState, 'pendingSecrets'));
myCtx.onCredentialsStored();
```

Why this helps: validation and persistence become separate phases; closing the success screen
without completing leaves storage untouched.

Pros:

- Creates an explicit user-controlled commit point.
- Removes the verification-versus-disposal write race entirely.

Cons:

- Changes the current UX contract: today a verified credential remains stored if the success
  screen is closed without pressing Done.
- Holds secret material in controller memory for longer and requires careful clearing on disposal.
- Requires a larger router/controller state change.

**Owner decision: use a minimal commit-boundary cancellation check.** Do not thread the signal
through token acquisition, project listing, or the best-effort error-action lookups. It is
acceptable for those network calls to finish after the panel closes; the important contract is that
their result must not become persistent state after cancellation.

```typescript
const projects = await client.listProjects();
// Existing validation and no-project handling remain unchanged.

myCtx.signal.throwIfAborted();
await persistCredential(myCtx, secrets);
```

Apply the same check to both auth methods immediately before `persistCredential()`. This uses the
tRPC cancellation signal without plumbing it through every helper, preserves the current validation
flow, and prevents the known post-verification write. The accepted tradeoff is that cancelled work
may still consume an Atlas request. Add a deferred-request test for each auth method: abort while
`listProjects()` is pending, resolve it, and assert that neither store function nor completion
callback runs.

> ✅ **RESOLVED (dev/tnaum/atlas-discovery-review-iteration).** Added `myCtx.signal?.throwIfAborted()`
> immediately before `persistCredential()` in both `submitApiKey` and `submitServiceAccount`
> (optional chaining, per the FINAL DECISION work order). The signal is not threaded through the
> verification helpers, matching the minimal commit-boundary decision.
> Fix: [src/webviews/documentdb/atlasCredentials/atlasCredentialsRouter.ts](../../../../src/webviews/documentdb/atlasCredentials/atlasCredentialsRouter.ts).
> Tests: two deferred-abort tests (one per auth method) assert neither the store function nor
> `onCredentialPersisted` runs, in
> [atlasCredentialsRouter.test.ts](../../../../src/webviews/documentdb/atlasCredentials/atlasCredentialsRouter.test.ts).

### MEDIUM-2: Incompatible discovery passes can coalesce or overwrite each other

Source: Independent review.

**Reassessment: Confirmed. Severity: Medium (unchanged).** This can produce an empty List view or
replace a user-requested refresh with older credential/error data for the 30-second cache TTL. It is
visible and repeatable under slow requests, but it neither loses persisted data nor blocks all
discovery permanently.

File: `src/plugins/service-atlas-mongodb/discovery/AtlasDiscoveryService.ts`

`listAll()` stores one untyped `inflight` promise. A call with `includeClusters: true` joins an
existing projects-only pass and receives `clustersIncluded: false`, so switching to List mode
during an expansion can render no clusters until another refresh. Forced refreshes have the
opposite race: they start beside the old pass, but both passes commit to the same snapshot and each
`finally` clears `this.inflight` unconditionally. If the old pass finishes last, it overwrites the
fresh result and can reintroduce removed credentials or pre-refresh errors for the 30-second TTL.

The tests cover sequential cache upgrades and refreshes, but not overlapping deferred calls.

**Second-pass assessment: confirmed and reproducible from the UI. Severity: Medium (unchanged).**

The second pass adds the concrete user gesture that reaches it and two aggravating factors pass 1
did not record.

_The reachable gesture._ `AtlasServiceRootItem.getChildren()` calls
`listAll({ includeClusters: getAtlasViewMode() === 'list' })`, and `switchAtlasViewMode` persists the
mode and then calls `ext.discoveryBranchDataProvider.refresh()`. Toggling **View as List** while a
tree-mode expansion is still fetching therefore joins a `includeClusters: false` pass and renders a
List view with no clusters, from a single click on the view title bar. This is a one-gesture
reproduction, not a theoretical interleaving.

_`invalidate()` cannot stop a running pass._ `invalidate()` clears `snapshot`, `snapshotTakenAt`,
`lastResults`, and `inflight`, but the promise it dropped keeps running and still executes the
`this.snapshot = snapshot` assignment at the end of `buildSnapshot()`. `refreshAll()` is
`invalidate()` followed by `listAll({ forceRefresh: true })`, so the documented "explicit refresh"
path is itself a two-writer situation — this is not limited to two competing user actions.

_An aborted pass still becomes the cached snapshot._ `buildSnapshot()` never consults
`options.signal` before committing, and `classifyAtlasError()` has no branch for an abort: a
`DOMException` named `AbortError` is not an `AtlasApiError`, is not a `TypeError`, and its message
does not match the network regex, so it lands in `kind: 'other'`. A cancelled pass therefore commits
a snapshot in which every credential carries an `other` error, `snapshotHasFailures()` returns
`true`, and `classifyRecoveryAction()` renders a "Click here to retry" row — for work the extension
itself cancelled. Whatever shape the fix takes, `classifyAtlasError` needs an abort branch and
`buildSnapshot` needs to refuse to commit an aborted pass.

The owner's chosen direction is **Proposal B** (see the FINAL DECISION subsection below), which
resolves the coalescing dimension and the last-writer dimension by queuing rather than by
restructuring the snapshot; the abort handling above is additional, independent, and becomes
mandatory once the serialized path gains a timeout.

**Proposal A: describe each pass and protect commits with a generation.**

```typescript
interface InflightDiscovery {
  readonly generation: number;
  readonly includesClusters: boolean;
  readonly promise: Promise<AtlasDiscoverySnapshot>;
}

if (this.inflight && !options.forceRefresh && (!needsClusters || this.inflight.includesClusters)) {
  return this.inflight.promise;
}

const generation = ++this.generation;
const promise = this.buildSnapshot(needsClusters, options.signal, forceFreshSessions).then((result) => {
  if (generation === this.generation) {
    this.commit(result.results, needsClusters);
  }
  return result.snapshot;
});
```

The `finally` block should clear the slot only when `this.inflight?.promise === promise`. Why this
helps: a caller joins only work that satisfies its requested shape, and a superseded pass can no
longer commit or clear the current pass's state.

Pros:

- Cluster-inclusive work can satisfy both callers while projects-only work cannot satisfy List
  mode.
- A forced refresh has explicit last-generation-wins semantics.
- Keeps fast concurrent refresh behavior; a service-owned controller may also abort superseded work.

Cons:

- `buildSnapshot()` must stop committing unconditionally or return an uncommitted result.
- Superseded work may still consume requests unless it is also aborted.

**Proposal B: serialize incompatible discovery passes.**

```typescript
const previous = this.inflight?.promise;
const promise = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(() =>
  this.buildSnapshot(needsClusters, options.signal, forceFreshSessions),
);
```

Why this helps: only one pass can write the snapshot at a time. A cluster-inclusive call waits for
the projects-only pass and then performs the richer query, so completion order cannot overwrite a
newer result.

Pros:

- Simple commit ordering with no concurrent snapshot writers.
- Avoids duplicate fleet-wide requests running at the same time.

Cons:

- A manual refresh waits behind the stale or slow request it was meant to supersede.
- A hung request can block every later discovery call unless all requests have a timeout.
- Does not make request compatibility explicit.

**Owner decision (superseded): use complete internal snapshots plus Proposal A's generation guard.**
Dynamic cluster loading is not required. Discovery should first collect the complete internal data
set for each credential - organizations, projects, clusters, and typed failures - and merge it into
one immutable snapshot. Tree and List modes should then be presentation projections over that same
snapshot rather than requesting different snapshot shapes.

Concretely, `listAll()` no longer needs `includeClusters` as a cache or in-flight compatibility
dimension: every pass fetches clusters with the existing bounded project concurrency. Tree mode
groups the resulting snapshot as organization to project to cluster; List mode flattens the same
cluster entries. `AtlasProjectItem` should read its cluster children from the snapshot instead of
making a separate `listClusters()` call on expansion.

This makes the architecture easier to reason about and removes the projects-only versus
cluster-inclusive coalescing bug entirely. The accepted cost is a slower and more request-heavy
initial Tree-mode load, especially for credentials with many projects; bounded concurrency,
per-project errors, and the snapshot TTL remain important. Proposal A's generation/identity guard
is still required because a forced refresh can overlap an older complete pass, and only the newest
generation may commit or clear the active in-flight slot.

Add deferred tests that prove:

- Tree and List modes render different projections of the same complete snapshot without a new API pass.
- Expanding a project performs no direct cluster request.
- A slow old pass finishing after a fast forced refresh cannot replace the newer snapshot.

---

### MEDIUM-2 — FINAL DECISION: Proposal B (serialize discovery passes)

**Decision: implement Proposal B. This supersedes the complete-snapshot / generation-guard decision
above.** Rationale: the bug is a genuine edge case (it needs two overlapping passes), and Proposal B
is materially less code than restructuring `listAll` into complete snapshots plus a generation
counter plus tree/list projections. Ship the cheap correct fix; do not redesign the snapshot shape
in this PR.

**Implement exactly this in `AtlasDiscoveryService.listAll()`.**

Extract the existing cache lookup into a helper so it can be evaluated twice — once before queuing,
once after the predecessor has committed — then chain instead of racing:

```typescript
/**
 * Returns the cached snapshot when it is still fresh and rich enough for this caller.
 * Split out of `listAll()` because the serialized path has to ask twice: once before queuing,
 * and again after the pass ahead of it committed, which may have already produced the answer.
 */
private readUsableSnapshot(needsClusters: boolean, forceRefresh: boolean): AtlasDiscoverySnapshot | undefined {
    if (forceRefresh || !this.snapshot) {
        return undefined;
    }
    if (needsClusters && !this.snapshot.clustersIncluded) {
        return undefined;
    }
    return monotonicNow() - this.snapshotTakenAt < SNAPSHOT_TTL_MS ? this.snapshot : undefined;
}

public async listAll(options: ListAllOptions = {}): Promise<AtlasDiscoverySnapshot> {
    const needsClusters = options.includeClusters === true;
    const forceRefresh = options.forceRefresh === true;

    const cached = this.readUsableSnapshot(needsClusters, forceRefresh);
    if (cached) {
        return cached;
    }

    // Discovery passes are queued, never raced. Joining an arbitrary in-flight pass was wrong in
    // both directions: a projects-only pass would answer a clusters-inclusive caller (List mode
    // rendered empty when the view was toggled mid-fetch), and two overlapping passes both wrote
    // `this.snapshot`, so a slow old pass could replace a newer forced refresh for the whole TTL.
    // Waiting and then re-checking the cache gives the fast path back for free: a caller whose
    // needs the predecessor already satisfied returns that snapshot without a second API pass.
    const previous = this.inflight;
    const work = (previous ?? Promise.resolve())
        // The predecessor's failure is its own caller's problem; it must not fail this pass.
        .catch(() => undefined)
        .then(
            () =>
                this.readUsableSnapshot(needsClusters, forceRefresh) ??
                this.buildSnapshot(needsClusters, options.signal, options.forceFreshSessions === true),
        )
        .finally(() => {
            // Only the tail of the queue may clear the slot; an earlier pass finishing late must
            // not detach a successor that other callers are already chained behind.
            if (this.inflight === work) {
                this.inflight = undefined;
            }
        });

    this.inflight = work;
    return work;
}
```

**Three companion changes are required, not optional.** Proposal B is only safe with all three.

1. **`invalidate()` must stop clearing `inflight`.** Under the old code `inflight` was a
   join-target; under Proposal B it is the tail of a queue. `refreshAll()` calls `invalidate()` and
   then `listAll({ forceRefresh: true })`, so leaving the clear in place would detach the forced
   pass from the running one and reintroduce exactly the two-writer race this change removes.

   ```typescript
   public invalidate(): void {
       this.snapshot = undefined;
       this.snapshotTakenAt = 0;
       this.lastResults = undefined;
       // `inflight` is deliberately NOT cleared: it is the tail of the serialized pass queue,
       // not cached data. Clearing it would let the next pass start beside the running one.
   }
   ```

2. **Every pass needs a timeout.** Serializing makes one hung request block _all_ later discovery,
   including a forced refresh — the old code at least let `forceRefresh` bypass a stuck join. No
   Atlas request currently has a deadline: `AtlasServiceRootItem.getChildren()` calls `listAll()`
   with no signal, and `AtlasApiClient` passes `signal` straight through to `fetch`, which has no
   default timeout. Give `buildSnapshot` a deadline of its own:

   ```typescript
   /** A discovery pass may not outlive this. Serialized passes queue behind each other, so a
    *  request with no deadline would stall every later expansion for the rest of the session. */
   const DISCOVERY_TIMEOUT_MS = 30_000;

   const deadline = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS);
   const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
   ```

   Both `AbortSignal.timeout` and `AbortSignal.any` are available (`target: ES2023`, `lib` includes
   `dom`, Node `>=22.18.0`), and `AbortSignal.timeout` already has in-repo precedent in
   `SelectAtlasDatabaseUserStep`.

3. **`classifyAtlasError()` needs an abort/timeout branch.** This was already required (see the
   second-pass assessment above) and becomes unavoidable once (2) lands, because
   `AbortSignal.timeout` rejects with a `TimeoutError` `DOMException` that is neither an
   `AtlasApiError` nor a `TypeError` and does not match the network regex, so it would be reported
   as `kind: 'other'` on every credential:

   ```typescript
   // `AbortSignal.timeout()` rejects with TimeoutError and a disposed webview/tree with AbortError.
   // Neither is an Atlas response, so neither may be reported as a credential problem.
   if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
     return { kind: 'network', message: error.message };
   }
   ```

   `buildSnapshot()` must additionally refuse to commit when the pass was aborted rather than timed
   out, so a cancelled pass never becomes the cached snapshot.

**Optional hardening, not required for this PR:** `retryCredential()` calls `this.commit()` directly
and is therefore a fourth writer outside the queue. A retry launched from the credential manager
while a tree expansion is fetching can still be overwritten. Routing that commit through the same
chain closes it; the window is narrow enough that it can wait.

**Two implementation notes.**

- Referencing `work` inside its own `.finally()` is fine here and is not a circular-inference error,
  because every function in the chain has an explicit return type.
  `AtlasCredentialSessionRegistry.getSession()` already uses exactly this shape and compiles.
- Keep the existing `atlasTrace` output. The current `listAll()` logs a cache hit with the snapshot's
  age and contents, and logs separately when the snapshot has expired. Moving the cache check into
  `readUsableSnapshot()` must not drop those lines — they are the only way to tell a served cache
  from a fresh pass in a bug report. Add one more for the queued case
  (`listAll: waiting for the discovery pass ahead of this one`) so a serialized wait is visible
  rather than looking like a hang.

**Comments are part of the deliverable.** The reason for the chaining, the reason `invalidate()`
leaves `inflight` alone, the reason `finally` compares identity, and the reason the timeout exists
are all non-obvious from the code. Keep each of the comments above (or equivalents); a future
maintainer removing any one of them silently reintroduces one of the three bugs.

Tests to add:

- Two deferred `listAll()` calls, the first `includeClusters: false` and the second `true`: assert
  the second returns a snapshot with `clustersIncluded: true` and that it ran a second pass.
- A slow first pass and a `forceRefresh` second pass: assert the final `this.snapshot` is the
  second pass's result regardless of completion order.
- A `refreshAll()` issued while a pass is in flight: assert only one pass runs at a time and the
  forced result wins.
- A timed-out pass: assert every credential is reported as `kind: 'network'`, not `'other'`.

> ✅ **RESOLVED (dev/tnaum/atlas-discovery-review-iteration) — Proposal B.** `listAll()` now queues
> passes instead of racing them: a `readUsableSnapshot()` helper is evaluated before queuing and
> again after the predecessor commits, and the pass chains off `this.inflight` with an
> identity-checked `finally`. All four required companion changes landed: `invalidate()` no longer
> clears `inflight`; `buildSnapshot()` wraps the caller's signal with `AbortSignal.any([signal,
AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)])`; `classifyAtlasError()` maps `DOMException`
> `TimeoutError`/`AbortError` to `network`; and `buildSnapshot()` returns without committing when the
> caller's `signal` aborted (a timeout still commits as network errors). All required explanatory
> comments were kept.
> Fix: [src/plugins/service-atlas-mongodb/discovery/AtlasDiscoveryService.ts](../../../../src/plugins/service-atlas-mongodb/discovery/AtlasDiscoveryService.ts).
> Tests in [AtlasDiscoveryService.test.ts](../../../../src/plugins/service-atlas-mongodb/discovery/AtlasDiscoveryService.test.ts):
> clusters-inclusive caller not answered by a projects-only pass; forced refresh commits last;
> `maxActive === 1` under overlap; timed-out pass reported as `network`; a caller-cancelled pass is
> not cached; plus a direct `classifyAtlasError` abort/timeout assertion. The optional
> `retryCredential()` fourth-writer hardening was intentionally left out per the FINAL DECISION.

### MEDIUM-3: Transient Service Account token failures are reported as rejected credentials

Source: Independent follow-up review.

**Assessment: New finding. Severity: Medium.**

Files:

- `src/plugins/service-atlas-mongodb/auth/AtlasServiceAccountClient.ts`
- `src/plugins/service-atlas-mongodb/auth/AtlasCredentialSessionRegistry.ts`
- `src/plugins/service-atlas-mongodb/discovery/AtlasDiscoveryService.ts`
- `src/webviews/documentdb/atlasCredentials/atlasCredentialsRouter.ts`

`fetchServiceAccountToken()` throws a plain `Error` for every non-2xx response. The session registry
then catches every token failure and returns `undefined`; `queryCredential()` interprets that only
as `kind: 'auth'` with "Stored credentials were rejected." A DNS failure, offline machine, Atlas
`429`, or token-service `5xx` therefore sends an existing user to update a valid secret. The add
flow preserves network `TypeError`, but still converts token-service `429` and `5xx` responses into
"MongoDB Atlas did not accept the Client ID and secret."

This is more than generic wording: the original status and retry category are discarded before the
shared error classifier can select the correct recovery action. Existing tests cover only a generic
`invalid_client` rejection and explicitly expect `undefined`, so they encode the collapse rather
than distinguish transient failure.

**Second-pass assessment: confirmed, with one clarification and one extension. Severity: Medium
(unchanged).**

_Clarification._ The raw failure is not entirely lost today. `mintServiceAccountToken()` already
does `atlasWarn(… service account token request failed: ${message})` before returning `undefined`,
so the output channel does carry the underlying text. The defect is therefore squarely about the
**typed** outcome: `queryCredential()` turns every `undefined` session into a hardcoded
`kind: 'auth'` with `'Stored credentials were rejected. Update them to continue.'`, and that string
is what drives `classifyRecoveryAction()` to `revisitCredentials`. The owner's decision to keep full
diagnostics in the output channel and classify only at the UI's required level therefore matches
what the code already does for logging; the work is on the return type.

_Extension._ The same collapse has a second, worse-behaved instance in the tree, reported separately
as [NEW-3](#new-3-project-expansion-raises-a-blocking-modal-that-blames-credentials-for-every-failure-kind).
Fixing only the session registry leaves that path telling a user with a flaky network to revisit
their credentials, in a modal. The two should be fixed together, because they share the same root
cause: a failure kind is discarded and replaced with a credential-blaming default.

**Proposal A: introduce a typed token error and rethrow transient failures.**

```typescript
export class AtlasTokenError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

if (!response.ok) {
  throw new AtlasTokenError(errorDetail, response.status, errorCode);
}
```

```typescript
try {
  return await this.mintServiceAccountToken(credentialId, secrets);
} catch (error) {
  if (error instanceof AtlasTokenError && (error.statusCode === 400 || error.statusCode === 401)) {
    return undefined;
  }
  throw error;
}
```

`classifyAtlasError()` and `describeAtlasError()` can then map `429` to rate limiting, `5xx` to a
retryable service failure, and an unchanged `TypeError` to network failure.

Pros:

- Small change to the existing `Promise<AtlasSession | undefined>` API.
- Preserves HTTP status and OAuth error code for both discovery and the webview.
- Lets actual invalid-client responses keep the current rejected-credential behavior.

Cons:

- Both existing classifiers must learn the token error type.
- The token client's status-to-category policy must be maintained explicitly.

**Proposal B: return a discriminated session-resolution result.**

```typescript
type SessionResolution =
  | { readonly ok: true; readonly session: AtlasSession }
  | { readonly ok: false; readonly error: unknown; readonly retryable: boolean };
```

Why this helps: "missing secret," "invalid secret," and "could not contact token service" can no
longer share the ambiguous `undefined` value.

Pros:

- Makes every failure path explicit at the type boundary.
- Scales if the UI later needs token-expiry or consent-specific recovery.

Cons:

- Changes all session-registry consumers and the refresher interface.
- Adds branching to API-client retry code for a problem that currently needs only status fidelity.

**Owner decision: preserve full diagnostics in the output channel and classify only at the UI's
required level.** The existing Show details action is the escape hatch for status, OAuth code, and
raw backend detail; user-facing state does not need to reproduce that envelope. Preserve enough
structured information from token acquisition to distinguish these broad outcomes:

- invalid client/secret responses become `authentication`;
- fetch/DNS/offline failures become `network`;
- `429` becomes `rateLimit`;
- token-service `5xx` and unrecognized responses become `unknown` with retry-oriented wording.

Log the complete original failure through `ext.outputChannel.error` before returning the concise
classification. A small typed token error carrying status and OAuth code remains a suitable way to
avoid parsing message text, but the types should serve this high-level mapping rather than expand
the webview contract.

Do not regress the existing Atlas Admin API classification. In particular, project-list `403`
responses must continue through `AtlasApiError` and `isAtlasIpAccessListError()`, retaining the
rejected-IP message, access-settings action, and current distinction between IP-access and missing
permissions. Token-endpoint classification must not replace or intercept that path. Add focused
tests for `invalid_client`, `TypeError`, token `429`, and token `503`, plus the existing Admin API IP
access-list cases as regression coverage.

> ✅ **RESOLVED (dev/tnaum/atlas-discovery-review-iteration), with NEW-3.** Added a typed
> `AtlasTokenError` (status + OAuth code) thrown by `fetchServiceAccountToken`.
> `mintServiceAccountToken` now logs the full failure via a new `atlasError` helper, returns
> `undefined` only for a genuinely rejected client/secret (`400`/`401`), and **rethrows** transient
> failures (`429`, `5xx`, network `TypeError`) so the discovery pass classifies them.
> `classifyAtlasError` gained an `AtlasTokenError` branch (`429`→`rateLimited`, `5xx`→`other`), and the
> webview `describeAtlasError` classifies token failures directly, removing the hardcoded
> authentication override in `submitServiceAccount`. The Admin API `403` / `isAtlasIpAccessListError`
> path is untouched. The wizard's `getClusterItems` swallows the now-throwing `getSession` to keep
> its neutral "manage credentials" fallback.
> Fix: [AtlasServiceAccountClient.ts](../../../../src/plugins/service-atlas-mongodb/auth/AtlasServiceAccountClient.ts),
> [AtlasCredentialSessionRegistry.ts](../../../../src/plugins/service-atlas-mongodb/auth/AtlasCredentialSessionRegistry.ts),
> [AtlasDiscoveryService.ts](../../../../src/plugins/service-atlas-mongodb/discovery/AtlasDiscoveryService.ts),
> [atlasCredentialsRouter.ts](../../../../src/webviews/documentdb/atlasCredentials/atlasCredentialsRouter.ts),
> [SelectAtlasSteps.ts](../../../../src/plugins/service-atlas-mongodb/discovery-wizard/SelectAtlasSteps.ts),
> [atlasTrace.ts](../../../../src/plugins/service-atlas-mongodb/atlasTrace.ts).
> Tests: `invalid_client`, `429`, `503`, and `TypeError` cases in both the session-registry and
> router suites.

### MEDIUM-4: Concurrent credential writes can restore stale secrets after rotation or sign-out

Source: Independent follow-up review.

**Assessment: New finding. Severity: Medium.** The race can undo a validated secret rotation or
recreate an item after sign-out, which is a data-integrity failure. It requires overlapping storage
operations, so its likelihood is lower than the deterministic cancellation and error-classification
paths above.

**Second-pass assessment: partially confirmed. Severity: downgraded to Low.**

The unserialized read-modify-write pattern is real, but three of the four scenarios pass 1 built on
top of it do not reproduce against the actual store and `StorageService` code. Downgrading matters
here because the pass-1 severity is what justified the heaviest proposed change in the whole review
(a per-credential write queue across four call sites).

_Scenario 1 — token caching restores an old client secret. Does not reproduce._
`cacheServiceAccountToken()` calls `readAtlasCredentialSecrets(id)` **after** the token round-trip,
not before it, and spreads that fresh read: `pushItem(record, { ...secrets, accessToken, expiresAt })`.
A rotation that lands during a token mint is therefore preserved; the only stale value written is an
access token minted from the previous secret, which self-heals on its next `401` through
`AtlasApiClient`'s existing refresh-and-retry.

_Scenario 2 — a stale write recreates a removed credential. Does not reproduce in the token path._
`cacheServiceAccountToken()` returns early twice for a deleted credential: `readAtlasCredentialSecrets`
resolves `undefined` because the storage item is gone, and `ensureCache()` re-reads from storage
because `removeAtlasCredential()` called `invalidateCache()`. Resurrection needs both reads to land
before the delete **and** the `pushItem` to land after it.

_Scenario 3 — metadata writes clobber secrets when the secret read fails. Does not reproduce._
`StorageService.push()` only touches SecretStorage under `if (item.secrets && item.secrets.length > 0)`.
A `pushItem(record, undefined)` leaves the stored secret untouched, so a failed or empty secret read
during a metadata update is already safe.

_Scenario 4 — the one that does hold._ `updateAtlasCredentialMetadata()` is the only path that reads
the full secret array and writes it straight back:

```typescript
const secrets = await readAtlasCredentialSecrets(id);
await pushItem(updated, secrets);
```

It is called on every discovery pass through `cacheOrganizationMetadata()`. A rotation completing
between those two lines is written back as the old secret. The window is one `await` boundary wide,
so this is a Low-likelihood, high-consequence race rather than the Medium-likelihood one pass 1
described.

**Second-pass recommendation: prefer a one-line elimination over the write queue.** The
`updateAtlasCredentialMetadata` path does not need to write secrets at all, because `push()` already
treats `undefined` as "leave the stored secrets alone":

```typescript
// Metadata is non-secret by definition; `push()` preserves the existing secret array
// when none is supplied, so this path never needs to read or rewrite it.
await pushItem(updated, undefined);
```

Why this is better than Proposal A here: it removes the only reachable window instead of narrowing
it, it deletes a SecretStorage read from the hot discovery path, and it does not add a queue whose
own cleanup and rejection handling then need tests to avoid permanently blocking a credential ID.
Proposal A remains the right answer **if** cross-window credential management is in scope, but that
is Proposal B territory (independent storage keys) and is out of scope for this release. Keep the
deferred storage tests pass 1 asked for; they are cheap and they pin the corrected behaviour.

Files:

- `src/plugins/service-atlas-mongodb/credentials/atlasCredentialStore.ts`
- `src/plugins/service-atlas-mongodb/auth/AtlasCredentialSessionRegistry.ts`
- `src/webviews/documentdb/atlasCredentials/atlasCredentialsRouter.ts`
- `src/services/storageService.ts` (for the `push()` secret-preservation behaviour above)

`replaceAtlasCredentialSecrets()`, `updateAtlasCredentialMetadata()`, and
`cacheServiceAccountToken()` each perform an asynchronous read-modify-write of the entire item,
including its secret array, with no per-credential serialization. A discovery pass can read the old
secret for metadata or token caching, the webview can persist a validated replacement, and the old
pass can then call `pushItem()` last and restore the stale secret. The same pattern can recreate an
item when a write has already captured the record and `removeAtlasCredential()` wins only before
that stale `pushItem()`.

Session invalidation does not make the storage write atomic. In-flight session promises are removed
from the registry map, but the already-running promise can still finish and call
`cacheServiceAccountToken()`.

**Second-pass note on the session registry.** There _is_ a related in-memory race in
`AtlasCredentialSessionRegistry` that pass 1 gestured at but did not isolate, and it is more likely
than the storage race: `invalidate(credentialId)` deletes the cached session and the in-flight map
entries, but a `resolveSession()` promise that is already running still finishes with
`this.storeSession(credentialId, session)` and repopulates the cache with the pre-rotation session.
The same applies to `refreshSession()` racing an older `getSession()`: both call `storeSession`, and
the later completion wins regardless of which is newer. Today this is masked because
`configureAtlasCredentials()` ends with `discoveryService.reset()` (a full `invalidateAll()`), but
`AtlasCredentialActionStep.update()` relies on the narrow `sessionRegistry.invalidate(credentialId)`
alone. A generation counter on the registry, or having `storeSession` refuse to write when its
originating request has been invalidated, closes it without a queue.

**Proposal A: serialize every operation for one credential.**

```typescript
return withCredentialWrite(id, async () => {
  const current = await readAtlasCredentialSecrets(id);
  const record = (await ensureCache()).find((candidate) => candidate.id === id);
  if (!current || !record) {
    return;
  }

  await pushItem(record, mergeWithLatestSecrets(current, update));
  invalidateCache();
});
```

Rotation, metadata updates, token caching, and removal must all use the same per-ID queue. Why this
helps: whichever operation runs second re-reads the first operation's result instead of writing a
snapshot captured before it.

Pros:

- Focused fix for all same-extension-host call sites.
- Preserves the current storage schema.
- Gives removal deterministic ordering with token and metadata writes.

Cons:

- Every credential write must consistently use the queue.
- An in-process queue does not coordinate two VS Code windows sharing the same profile.
- Queue cleanup and rejected-operation handling need tests to avoid permanently blocking an ID.

**Proposal B: separate independently changing values instead of rewriting the whole secret array.**

```typescript
// Primary credential item
secrets: [clientId, clientSecret];

// Separate cache item keyed by credential ID
tokenSecrets: [accessToken, expiresAt];

// Metadata update: push properties without rewriting either secret value
await pushCredentialMetadata(record);
```

Why this helps: organization-name caching cannot overwrite credentials, and token caching cannot
restore an old client secret. Rotation becomes the only writer of the primary secret.

Pros:

- Removes the structural cause of stale whole-record writes.
- Reduces the amount of sensitive data rewritten by unrelated operations.
- Is safer across multiple extension hosts because independent values use independent keys.

Cons:

- Requires a storage migration and cleanup of orphaned token-cache entries.
- Removal becomes a multi-key operation.
- Larger implementation and compatibility surface for this release.

**Recommendation:** choose Proposal A for this PR, covering removal and all three read-modify-write
paths in one per-credential queue. It is the smallest complete correction for the reachable UI
race. Proposal B is the stronger long-term storage design if cross-window concurrent credential
management is a supported scenario. Add deferred storage tests that force metadata/token writes to
finish after rotation and after removal, then assert that the new secret remains and a removed item
stays absent.

---

### MEDIUM-4 — FINAL DECISION: second-pass fix, with the reasoning captured in comments

**Decision: implement the second-pass recommendation. Do not build the per-credential write queue.**
Only `updateAtlasCredentialMetadata()` is actually exposed, and it does not need to write secrets at
all, so the window is removed rather than narrowed.

**Change 1 — `atlasCredentialStore.ts`, `updateAtlasCredentialMetadata()`.**

```typescript
export async function updateAtlasCredentialMetadata(
  id: string,
  metadata: AtlasCredentialMetadataUpdate,
): Promise<AtlasCredentialRecord | undefined> {
  const records = await ensureCache();
  const existing = records.find((record) => record.id === id);
  if (!existing) {
    return undefined;
  }

  const updated: AtlasCredentialRecord = {
    ...existing,
    label: metadata.label ?? existing.label,
    orgId: metadata.orgId ?? existing.orgId,
    orgName: metadata.orgName ?? existing.orgName,
  };

  // Deliberately no secret read here. `StorageService.push()` only writes SecretStorage when
  // `item.secrets` is a non-empty array, so passing `undefined` leaves the stored secret exactly
  // as it is. Reading the secret and writing it back was a real hazard: this runs on every
  // discovery pass (via `cacheOrganizationMetadata`), and a credential rotation completing
  // between the read and the push would have been silently overwritten with the old secret.
  await pushItem(updated, undefined);
  invalidateCache();
  return updated;
}
```

The comment is required. Without it the next maintainer sees a metadata writer that "forgets" to
carry the secrets forward and re-adds the read.

**Change 2 — `AtlasCredentialSessionRegistry`, the in-memory half.** `invalidate(credentialId)`
drops the cached session and the in-flight map entries, but a `resolveSession()` promise that is
already running still ends in `this.storeSession(...)` and repopulates the cache with the
pre-rotation session. Add a per-credential generation so a superseded resolve cannot write:

```typescript
/**
 * Bumped by `invalidate()` / `invalidateAll()`. A session resolve that started before the bump is
 * stale by definition - the secret it read may already have been replaced - so it is allowed to
 * finish, but not to become the cached session. Without this, rotating a credential and then
 * losing the race against an in-flight discovery pass leaves the old key in memory until the next
 * full `reset()`.
 */
private readonly generations = new Map<string, number>();

private storeSession(credentialId: string, session: AtlasSession, generation: number): AtlasSession {
    if (generation === (this.generations.get(credentialId) ?? 0)) {
        this.sessions.set(credentialId, session);
    }
    return session;
}
```

Today this is masked in the common path because `configureAtlasCredentials()` ends with
`discoveryService.reset()` (a full `invalidateAll()`), but `AtlasCredentialActionStep.update()`
relies on the narrow `sessionRegistry.invalidate(credentialId)` alone. Note that in the comment so
the dependency on `reset()` is not re-established by accident.

**Explicitly out of scope for this PR:** the per-credential write queue (Proposal A) and the
split-storage schema (Proposal B). File neither as blocking work; both only matter if concurrent
credential management across two VS Code windows becomes a supported scenario.

Tests to add (both cheap, both pin the corrected behaviour):

- Force `updateAtlasCredentialMetadata()` to complete after `replaceAtlasCredentialSecrets()` and
  assert the new secret survives.
- Invalidate a credential while `getSession()` is deferred, resolve it, and assert the registry
  cache stays empty rather than being repopulated with the stale session.

> ✅ **RESOLVED (dev/tnaum/atlas-discovery-review-iteration) — second-pass fix, no write queue.**
> Change 1: `updateAtlasCredentialMetadata()` now calls `pushItem(updated, undefined)` and no longer
> reads or writes the secret (`StorageService.push()` leaves SecretStorage untouched for empty
> `secrets`), with the required explanatory comment. Change 2: `AtlasCredentialSessionRegistry` gained
> a per-credential generation map; `resolveSession`/`performRefresh` snapshot the generation before
> their first `await` and pass it to `storeSession`, which only writes the in-memory cache when the
> generation still matches; `invalidate()`/`invalidateAll()` bump it. The per-credential write queue
> (Proposal A) and split-storage schema (Proposal B) were deliberately left out of scope.
> Fix: [atlasCredentialStore.ts](../../../../src/plugins/service-atlas-mongodb/credentials/atlasCredentialStore.ts),
> [AtlasCredentialSessionRegistry.ts](../../../../src/plugins/service-atlas-mongodb/auth/AtlasCredentialSessionRegistry.ts).
> Tests: rotated-secret-survives-metadata-update in the store suite, and the invalidate-mid-flight
> generation-guard test in the registry suite.

### LOW-1: External-link failures are silently discarded in the credential webview

Source: Independent review.

**Reassessment: Confirmed. Severity: Low (unchanged).** The failed action is part of the recovery
path for IP-access and permission errors, so silence is actionable usability debt. The user can
still open Atlas manually, and no local state is damaged.

Files:

- `src/webviews/documentdb/atlasCredentials/AtlasCredentialsView.tsx`
- `src/webviews/_integration/appRouter.ts`
- `src/utils/openUrl.ts`

`openLink()` fires `common.openUrl.mutate()` with `void` and no rejection handler. If the host
mutation rejects, the access-settings and setup-guide buttons do nothing and provide no feedback.
`openUrl()` also ignores the boolean returned by `vscode.env.openExternal()`, so a refused open is
reported as success. Existing tests cover URL parsing and log redaction, not the mutation or client
failure path.

**Proposal A: return the open result and handle both `false` and rejection in the webview.**

```typescript
export async function openUrl(url: string): Promise<boolean> {
  return vscode.env.openExternal(vscode.Uri.parse(url));
}
```

```typescript
try {
  const opened = await trpcClient.common.openUrl.mutate({ url });
  if (!opened) {
    setLinkError(l10n.t("We couldn't open this link."));
  }
} catch {
  setLinkError(l10n.t("We couldn't open this link."));
}
```

Why this helps: `false` is an expected API outcome rather than an exception, while transport and
host failures still take the rejection path. Both become visible in the existing MessageBar.

Pros:

- Preserves the distinction between refusal and an actual error.
- Keeps feedback in the surface where the user clicked the action.
- The common router remains reusable and does not choose UI on behalf of callers.

Cons:

- Webview call sites that need feedback must handle the result.
- Adds one small state transition to the credential component.

**Proposal B: make the extension host own failure feedback.**

```typescript
const opened = await vscode.env.openExternal(vscode.Uri.parse(url));
if (!opened) {
  void vscode.window.showErrorMessage(vscode.l10n.t("We couldn't open this link."));
}
```

Why this helps: every caller receives a consistent VS Code notification without adding client-side
state.

Pros:

- Covers command and webview callers from one utility.
- Smallest component change.

Cons:

- Couples a generic URL utility to presentation.
- A modal/toast is less contextual than the existing credential error MessageBar.
- Promise rejection before the utility handles the result still needs router-level treatment.

**Owner decision: handle failure in the extension host/router; no webview changes.** Change
`openUrl()` to return the `boolean` from `vscode.env.openExternal()`. The common router should catch
exceptions, show one localized VS Code error notification when the result is `false` or the call
throws, and return `true`/`false` to the caller.

```typescript
export async function openUrl(url: string): Promise<boolean> {
  return vscode.env.openExternal(vscode.Uri.parse(url));
}

// common.openUrl mutation
try {
  const opened = await openUrl(input.url);
  if (!opened) {
    void vscode.window.showErrorMessage(vscode.l10n.t("We couldn't open this link."));
  }
  return opened;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  ext.outputChannel.error(`[openUrl] Failed to open ${formatUrlForLogging(input.url)}: ${message}`);
  void vscode.window.showErrorMessage(vscode.l10n.t("We couldn't open this link."));
  return false;
}
```

Yes, the `boolean` is optional for current webviews to consume. Existing fire-and-forget mutation
calls can ignore the result because the extension host supplies the user feedback. Returning it
still keeps the router contract truthful and allows future callers or tests to react without
changing the host behavior. Add router tests for `true`, `false`, and rejection; a component test is
not needed for this chosen design.

**Second-pass assessment: confirmed. Severity: Low (unchanged).** `openUrl()` is still
`Promise<void>` discarding `openExternal`'s boolean, the router still does a bare `await openUrl(…)`,
and `AtlasCredentialsView.openLink` is still `void trpcClient.common.openUrl.mutate({ url })` with no
rejection handler. One implementation detail worth pinning in the router: keep
`formatUrlForLogging(input.url)` **after** the zod `isSupportedExternalUrl` refine, because
`formatUrlForLogging` constructs `new URL(value)` unguarded and would throw on an unparseable input.
The current ordering is correct; the new `try`/`catch` must not move the trace line above the
validation.

> ✅ **RESOLVED (dev/tnaum/atlas-discovery-review-iteration) — host-owned handling.** `openUrl()` now
> returns the `boolean` from `vscode.env.openExternal()`. The `common.openUrl` mutation catches
> exceptions, shows one localized "We couldn't open this link." notification when the result is
> `false` or the call throws, and returns the boolean; the trace/`formatUrlForLogging` line stays
> after the zod refine. No webview changes.
> Fix: [openUrl.ts](../../../../src/utils/openUrl.ts),
> [appRouter.ts](../../../../src/webviews/_integration/appRouter.ts).
> Tests: `openUrl` true/false in [openUrl.test.ts](../../../../src/utils/openUrl.test.ts).
> **Deviation:** the requested router-level notification tests were not added — there is no existing
> `appRouter` caller test harness and `appRouter` transitively imports the full webview router graph,
> so a bespoke harness was disproportionate for a Low finding. The util boolean contract plus type
> checking cover the substantive change; the router branch is trivial (try/catch + notification).

### LOW-2: The generic 403 fallback tells Service Account users to fix an API key

Source: Copilot reviewer, verified.

**Reassessment: Confirmed. Severity: Low (unchanged).** The fallback is factually wrong for one
supported auth method, but only when Atlas omits every useful detail from a `403`; the status and
recovery flow remain intact.

Discussion: https://github.com/microsoft/vscode-documentdb/pull/765#discussion_r3498997624

File: `src/plugins/service-atlas-mongodb/api/AtlasApiClient.ts`

When Atlas returns `403` without a detail body, the shared client says, "Verify your API key has
the required permissions." The same client serves Service Accounts, so that fallback can direct
those users to the wrong credential type.

**Proposal A: use a credential-neutral fallback.**

```typescript
vscode.l10n.t('Access denied. Verify this credential has the required permissions.');
```

Pros:

- Correct for API Keys and Service Accounts.
- One localized string and one test expectation.
- Avoids exposing authentication branching in generic error handling.

Cons:

- Less specific than naming the active credential type.

**Proposal B: branch on the session type.**

```typescript
const fallback =
  this.session.type === 'serviceaccount'
    ? vscode.l10n.t('Access denied. Verify this Service Account has the required permissions.')
    : vscode.l10n.t('Access denied. Verify this API Key has the required permissions.');
```

Pros:

- Gives the user the exact Atlas object to inspect.

Cons:

- Adds branches and translation combinations to a fallback used only when Atlas supplies no detail.

**Recommendation:** choose Proposal A. The recovery instruction is identical for both methods, so
neutral wording is accurate and simpler. Add one no-detail `403` test per session type.

**Second-pass assessment: confirmed, scope narrower than it reads. Severity: Low (unchanged).**
`handleErrorResponse` computes `detail = body.detail ?? body.reason ?? body.raw ?? ''`, so the
API-key wording only surfaces when Atlas returns a `403` with no `detail`, no `reason`, **and** no
non-JSON body — every populated response takes the `Access denied: {0}` branch instead. That is a
narrow trigger, which is why Low is right, but it is also why Proposal A is clearly the correct
choice: branching on session type to improve a message almost nobody sees is not worth the extra
translation combinations.

> ✅ **RESOLVED (dev/tnaum/atlas-discovery-review-iteration) — Proposal A.** The no-detail `403`
> fallback in `handleErrorResponse` now reads "Access denied. Verify this credential has the required
> permissions." (credential-neutral).
> Fix: [AtlasApiClient.ts](../../../../src/plugins/service-atlas-mongodb/api/AtlasApiClient.ts).
> Test: no-detail `403` neutral-message assertion in
> [AtlasApiClient.test.ts](../../../../src/plugins/service-atlas-mongodb/api/AtlasApiClient.test.ts).

### LOW-3: The cluster tooltip's labels and successful-connection sentence bypass localization

Source: Copilot reviewer, verified.

**Reassessment: Confirmed and broader than originally reported. Severity: Low (unchanged).**

Discussion: https://github.com/microsoft/vscode-documentdb/pull/765#discussion_r3498997649

File: `src/plugins/service-atlas-mongodb/discovery-tree/AtlasClusterItem.ts`

`buildTooltip()` appends the raw English sentence "Connection string available - expand to connect
and browse databases." It also hardcodes every field label: `State`, `Type`, `MongoDB`, `Tier`,
`Provider`, `Region`, and `Project`. The earlier review caught only the final sentence. State
explanations use `l10n.t()`, but the normal IDLE tooltip remains substantially English in localized
builds.

**Proposal A: localize every literal in place.**

```typescript
md.appendMarkdown(`- **${l10n.t('State')}:** ${escapeMarkdown(this.cluster.stateName)}\n`);
md.appendMarkdown(`- **${l10n.t('Type')}:** ${escapeMarkdown(this.cluster.clusterType)}\n`);
md.appendMarkdown(l10n.t('Connection string available - expand to connect and browse databases.'));
```

Apply the same label pattern to Tier, Provider, Region, Project, and the version label.

Pros:

- Direct, low-risk correction.
- Easy to compare against the current tooltip.

Cons:

- Repeats formatting and makes it easy for the next field to omit localization again.
- Translators control the label but not the surrounding Markdown punctuation.

**Proposal B: render a localized field list through one helper.**

```typescript
const fields: Array<[string, string | undefined]> = [
  [l10n.t('State'), this.cluster.stateName],
  [l10n.t('Type'), this.cluster.clusterType],
  [l10n.t('Server version'), this.cluster.mongoDBVersion],
  [l10n.t('Tier'), this.cluster.instanceSizeName],
  [l10n.t('Provider'), this.cluster.providerName],
  [l10n.t('Region'), this.cluster.regionName && this.formatRegion(this.cluster.regionName)],
  [l10n.t('Project'), this.cluster.projectName],
];

for (const [label, value] of fields) {
  if (value) md.appendMarkdown(`- **${label}:** ${escapeMarkdown(value)}\n`);
}
```

Pros:

- Makes localization the default for every tooltip field.
- Removes repeated conditionals and aligns the version terminology fix.

Cons:

- Slightly restructures a small method.
- Optional empty values need deliberate handling so required fields do not disappear accidentally.

**Recommendation:** choose Proposal B. The original review's narrow miss demonstrates why a single
localized field list is safer than correcting literals one by one. Localize the final sentence,
run `npm run l10n`, and test with a mocked translator that visibly transforms every label.

**Second-pass assessment: confirmed, and it is an internal inconsistency rather than an omission.
Severity: Low (unchanged).** The two sibling tree items added by the _same PR_ do it correctly:
`AtlasProjectItem.buildTooltip()` writes `` `- **${vscode.l10n.t('Organization')}:** …` `` and
`AtlasOrganizationItem.buildTooltip()` writes `` `- **${vscode.l10n.t('Organization ID')}:** …` ``.
Only `AtlasClusterItem` hardcodes its labels. That strengthens the case for Proposal B: the pattern
the reviewer would have to remember already exists two files away and was still not applied here, so
the fix should be structural rather than another round of literal-by-literal edits.

### LOW-4: The cluster tooltip uses "MongoDB" as a standalone product label

Source: Copilot reviewer, verified.

**Reassessment: Confirmed. Severity: Low (unchanged).** This violates the repository's explicit
terminology policy on every cluster tooltip, but it does not change behavior.

Discussion: https://github.com/microsoft/vscode-documentdb/pull/765#discussion_r3498997670

File: `src/plugins/service-atlas-mongodb/discovery-tree/AtlasClusterItem.ts`

The tooltip renders `MongoDB: v...`. Repository terminology requires "MongoDB API" or another
explicit compatibility/server-version description rather than "MongoDB" alone.

**Proposal A: label the value as the server version.**

```typescript
md.appendMarkdown(`- **${l10n.t('Server version')}:** ${escapeMarkdown(this.cluster.mongoDBVersion)}\n`);
```

Why this helps: Atlas's `mongoDBVersion` is the database server version reported for the cluster;
"Server version" describes the value without using "MongoDB" as a standalone product label.

Pros:

- Precise, localized, and minimal.
- Avoids implying that this is an API compatibility level.

Cons:

- The TypeScript property still mirrors Atlas's `mongoDBVersion` payload name.

**Proposal B: rename the internal model property at the API boundary.**

```typescript
return {
  // ...
  serverVersion: cluster.mongoDBVersion,
};
```

Pros:

- Internal code consistently uses domain-neutral terminology.
- Future UI labels are less likely to repeat the standalone product name.

Cons:

- Touches the model, factory, tooltip, and tests for no runtime benefit.
- Diverges from the Atlas response field name, making payload mapping less direct.

**Recommendation:** choose Proposal A. Keep the API-shaped property name at the boundary and fix
the user-facing terminology where it is rendered. Fold this into LOW-3's localized field list.

**Second-pass assessment: confirmed, and the scope should be widened. Severity: Low (unchanged).**
The tooltip is not the only terminology violation this PR introduces. `CreateDatabaseWizardContext.ts`
documents the new flag as:

```typescript
/**
 * When true, the wizard prompts for an initial collection name.
 * Required for standard MongoDB (Atlas) where dropping the last collection deletes the database.
 * Azure DocumentDB vCore does not need this.
 */
requiresInitialCollection?: boolean;
```

"standard MongoDB (Atlas)" uses MongoDB as a standalone product name, which the repository
instructions prohibit in code comments as well as user-facing strings. Fix both under this finding
so the terminology sweep is complete; the comment can say "the MongoDB API wire protocol as
implemented by Atlas" or simply describe the behaviour ("where dropping the last collection also
removes the database").

> ✅ **RESOLVED (dev/tnaum/atlas-discovery-review-iteration) — LOW-3 Proposal B + LOW-4 Proposal A.**
> `AtlasClusterItem.buildTooltip()` now renders one localized field list (`State`, `Type`,
> `Server version`, `Tier`, `Provider`, `Region`, `Project`), and the "Connection string available…"
> sentence is wrapped in `l10n.t()`. The `MongoDB: v…` line became `Server version: v…`, removing the
> standalone "MongoDB" product label while keeping the API-shaped `mongoDBVersion` property.
> `CreateDatabaseWizardContext.requiresInitialCollection`'s comment no longer says "standard MongoDB
> (Atlas)". `npm run l10n` runs at the final checklist step.
> Fix: [AtlasClusterItem.ts](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasClusterItem.ts),
> [CreateDatabaseWizardContext.ts](../../../../src/commands/createDatabase/CreateDatabaseWizardContext.ts).
> Tests: "Server version" / no-"MongoDB:" and localized-label assertions in
> [AtlasClusterItem.test.ts](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasClusterItem.test.ts).

### INFO-1: The cluster model drops the existing cluster-type union

Source: Copilot reviewer, partially fixed and still applicable.

**Reassessment: Confirmed. Severity: Informational (unchanged).** `AtlasCluster` already constrains
the payload, so current production call sites pass the right type. The wider factory input weakens
compile-time protection but does not create a runtime defect by itself.

Discussion: https://github.com/microsoft/vscode-documentdb/pull/765#discussion_r3498997729

Files:

- `src/plugins/service-atlas-mongodb/models/AtlasClusterModel.ts`
- `src/plugins/service-atlas-mongodb/models/AtlasProjectModel.ts`

`stateName` now uses `AtlasClusterState`, addressing half of the original comment, but
`clusterType` remains `string` in both `AtlasClusterModel` and the factory input even though
`AtlasClusterType` already describes the API contract.

**Proposal A: use the existing named union in both declarations.**

```typescript
import { type AtlasClusterState, type AtlasClusterType } from './AtlasProjectModel';

readonly clusterType: AtlasClusterType;
// factory input
clusterType: AtlasClusterType;
```

Pros:

- Small and explicit.
- Produces readable compiler errors and documentation.

Cons:

- The factory continues to repeat a hand-written subset of `AtlasCluster`.

**Proposal B: derive the field type from the API model.**

```typescript
import { type AtlasCluster } from './AtlasProjectModel';

readonly clusterType: AtlasCluster['clusterType'];
```

The factory can accept `AtlasCluster` or a `Pick<AtlasCluster, ...>` rather than restating each
field type.

Pros:

- Prevents the API and tree-model declarations from drifting.
- Can remove several duplicated field declarations if applied to the whole factory input.

Cons:

- Indexed-access and large `Pick` types are less readable than the named domain union.
- Accepting the whole API object couples the factory more tightly than necessary.

**Recommendation:** choose Proposal A. `AtlasClusterType` exists specifically as the readable
contract for this field; using it is clearer than deriving the same union indirectly. A build is
sufficient validation because this is compile-time hardening.

**Second-pass assessment: confirmed. Severity: Informational (unchanged).** `AtlasClusterModel`
still declares `readonly clusterType: string` and `createAtlasClusterModel`'s inline parameter
shape still declares `clusterType: string`, while `AtlasProjectModel.ts` exports
`AtlasClusterType = 'REPLICASET' | 'SHARDED' | 'GEOSHARDED'`. Worth noting that the _runtime_
version of this concern is a separate, larger issue: the union is never enforced against the actual
payload either, which is covered by
[NEW-7](#new-7-atlas-api-payloads-are-cast-never-validated).

> ✅ **RESOLVED (dev/tnaum/atlas-discovery-review-iteration) — Proposal A, folded into NEW-7.** Since
> NEW-7 already reopened these model files, `AtlasClusterModel.clusterType` and the
> `createAtlasClusterModel` factory input now use the `AtlasClusterType` union instead of `string`,
> as the reviewer suggested doing "whenever the touched model is next updated".
> Fix: [AtlasClusterModel.ts](../../../../src/plugins/service-atlas-mongodb/models/AtlasClusterModel.ts).

## Second-Pass Findings

Everything below was found in the second pass and was not reported in pass 1. Each item names the
exact code that produces it.

### NEW-1: A user-test prototype switch ships inside the credential-entry webview

**Severity as reported: High. Final severity after the owner decision: Informational — accepted, see
the FINAL DECISION subsection at the end of this finding.** The analysis below is retained because
it is the removal checklist for whoever exits preview.

Not a correctness or security failure, but it is user-visible on every add and update of an Atlas
credential, and its strings have already been exported for translation.

File: `src/webviews/documentdb/atlasCredentials/AtlasCredentialsView.tsx`

The component renders an experiment toggle above the entire flow:

```tsx
{/* USER-TEST PROTOTYPE: Remove this switch and badge with the footer experiment logic above. */}
<div className={styles.prototypeToggle}>
    <Switch checked={adaptiveFooterEnabled} label={l10n.t('Footer experiment')} … />
    <Badge … aria-label={l10n.t('Footer experiment is in preview')}>PREVIEW</Badge>
</div>
```

The file carries four `USER-TEST PROTOTYPE` markers, the first of which says the state, refs,
measurement callback, and `scrollAreaInlineFooter` class are all to be removed after user testing.
Both strings are already committed to the shipped bundle:

```jsonc
// l10n/bundle.l10n.json
"Footer experiment": "Footer experiment",
"Footer experiment is in preview": "Footer experiment is in preview",
```

Consequences: users adding an Atlas credential see an unexplained "Footer experiment / PREVIEW"
control on a security-sensitive screen; translators are asked to localise a throwaway A/B label;
and the strings must then be removed again, churning every language file.

**Proposal A: pick the winning layout and delete the experiment.** Remove the `Switch`, the `Badge`,
`adaptiveFooterEnabled`, `styles.prototypeToggle`, the unused `Switch`/`Badge` imports, and the
conditional in `updateFooterLayout`, keeping whichever branch the user testing selected. Then run
`npm run l10n` so the two strings leave the bundle.

- Pros: the shipped surface matches the intended design; no dead prototype state; the bundle is
  clean before translation.
- Cons: requires the user-testing result to be known now.

**Proposal B: keep both layouts but remove the user-facing control.** Retain
`adaptiveFooterEnabled` as a module constant and delete only the `Switch`, `Badge`, and their
strings.

- Pros: unblocks the release without waiting for the testing outcome; the comparison code stays
  available for a follow-up.
- Cons: leaves a dead branch and a `ResizeObserver` measurement path that nothing can reach, which
  is exactly the debt the prototype markers were meant to prevent.

**Recommendation: Proposal A.** A prototype toggle that survives into a release branch is how it
survives into a release. If the result genuinely is not known yet, take Proposal B **now** and open
a tracked follow-up, but do not merge with the control visible.

---

### NEW-1 — FINAL DECISION: accepted, no change

**Decision: keep the footer experiment as-is. Severity reduced from High to Informational.** This
ships as a **preview release**, which is exactly the audience a labelled `PREVIEW` A/B control is
for. The finding stood on "a release branch should not carry a user-test toggle"; that premise does
not apply here, so the finding does not.

Nothing to implement. Two notes for whoever exits preview:

- The four `USER-TEST PROTOTYPE` markers in `AtlasCredentialsView.tsx` are the complete removal
  checklist (state, root/footer refs, measurement callback, `scrollAreaInlineFooter`, the `Switch`,
  the `Badge`, and the `Switch`/`Badge` imports). Removing the control without them leaves an
  unreachable `ResizeObserver` branch.
- `'Footer experiment'` and `'Footer experiment is in preview'` are in `l10n/bundle.l10n.json` and
  must be removed with `npm run l10n` at the same time, so translators are not left maintaining a
  string that no longer renders.

### NEW-2: Four index context-menu commands were not extended for the Atlas experience

**Severity: Medium.** A whole feature area silently disappears for Atlas-discovered clusters, with
no error and no log line — precisely the failure mode the repository's dual-ID guidance calls out as
"silent bugs".

File: `package.json`

The PR adds `mongoDBAtlas` to twenty-one `experience_(…)` `when` clauses. Four were missed, and all
four are the index-level ones:

| Command                                                 | `when` clause                      |
| ------------------------------------------------------- | ---------------------------------- |
| `vscode-documentdb.command.hideIndex`                   | `experience_(documentDB\|mongoRU)` |
| `vscode-documentdb.command.unhideIndex`                 | `experience_(documentDB\|mongoRU)` |
| `vscode-documentdb.command.dropIndex`                   | `experience_(documentDB\|mongoRU)` |
| `vscode-documentdb.command.copyReference` (index scope) | `experience_(documentDB\|mongoRU)` |

Verification:

```console
$ grep -o 'experience_([^)]*)' package.json | sort | uniq -c
     21 experience_(documentDB|mongoRU|mongoDBAtlas)
      4 experience_(documentDB|mongoRU)
```

All four are scoped to `treeitem_index`, and `IndexItem` builds its context value as
`` `experience_${this.experience.api}` `` from the inherited cluster experience, which for an Atlas
cluster is `mongoDBAtlas`. So Hide Index, Unhide Index, Delete Index, and Copy Reference are absent
from the context menu on every Atlas cluster, while the twenty-one database/collection/document
actions all work.

**Proposal A: add `mongoDBAtlas` to the four remaining clauses.**

- Pros: one-line-per-entry, restores parity, matches what the other twenty-one already do.
- Cons: none; this is the same edit the PR already made everywhere else.

**Proposal B: assert the invariant in a test.** Add a small test over `package.json` that fails when
any `experience_(…)` clause omits an API that `experiencesArray` declares.

- Pros: the next experience added cannot repeat this; the mistake is invisible to `lint`, `build`,
  and the current suite, which is why it reached review.
- Cons: a test that reads `package.json` is unusual in this repository.

**Recommendation: Proposal A now, Proposal B as a small follow-up.** The omission is trivially
fixable, but nothing in CI would have caught it, and a fifth experience will eventually be added.

> ✅ **RESOLVED (dev/tnaum/atlas-discovery-review-iteration) — Proposal A.** Added `mongoDBAtlas` to the
> four remaining `treeitem_index` `when` clauses (hideIndex, unhideIndex, dropIndex, copyReference).
> All `experience_(…)` clauses now read `experience_(documentDB|mongoRU|mongoDBAtlas)` (25/25).
> Proposal B (a `package.json` invariant test) is left as the noted follow-up.
> Fix: [package.json](../../../../package.json).

### NEW-3: Project expansion raises a blocking modal that blames credentials for every failure kind

**Severity: Medium.** The reported premise was partly wrong — the modal itself is intended — but the
wording, the missing error text, and the `await` are all real. See the FINAL DECISION subsection at
the end of this finding for what to build.

Files:

- `src/plugins/service-atlas-mongodb/discovery-tree/AtlasProjectItem.ts`
- `src/plugins/service-atlas-mongodb/discovery-tree/showAtlasLoadFailure.ts`

`AtlasServiceRootItem` documents the intent as: "Whatever goes wrong across the credential fleet
collapses into a single recovery row, so one broken credential never blanks the healthy data and
never produces a storm of nodes or modals", and `classifyRecoveryAction()` exists so a network
failure says _retry_ rather than _revisit credentials_. Project expansion does the opposite:

```typescript
} catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await showAtlasLoadFailure(vscode.l10n.t('Failed to load MongoDB Atlas clusters.'), errorMessage);
    return [this.createRetryNode()];
}
```

```typescript
export async function showAtlasLoadFailure(failureMessage: string, errorMessage: string): Promise<void> {
  ext.outputChannel.appendLine(l10n.t('Failed to load MongoDB Atlas discovery: {0}', errorMessage));
  await window.showErrorMessage(failureMessage, {
    modal: true,
    detail: l10n.t('Revisit credentials and try again.'),
  });
}
```

Three problems compound:

1. It is **modal**, and it is `await`ed inside `getChildren()`, so the expansion does not resolve
   until it is dismissed. Expanding several projects queues several modals.
2. The `detail` is a fixed credential-blaming string for _every_ failure kind. A `429`, a dropped
   Wi-Fi connection, and a genuinely revoked key all produce "Revisit credentials and try again."
3. `errorMessage` is only written to the output channel; the modal never shows what actually
   happened, so the one place the user is looking carries the least information.

This is the tree-side twin of MEDIUM-3 and shares its root cause.

**Proposal A: classify, then choose the wording; keep the modal only for credential failures.**
Reuse `classifyAtlasError()` and pass the kind into `showAtlasLoadFailure`, so `network` and
`rateLimited` say "retry" and only `auth`/`forbidden` mention credentials.

- Pros: one shared classifier drives both the root row and the project row; the recovery verb
  becomes correct.
- Cons: still modal for some cases.

**Proposal B: drop the modal and let the retry node carry the message.** `createRetryNode()` already
returns a row; give it a tooltip built the same way `buildRecoveryTooltip()` builds the root's, and
keep the raw text in the output channel.

- Pros: matches the stated "no storm of modals" design exactly; non-blocking; consistent with how
  the root already reports fleet failures; nothing is lost because the details were never in the
  modal anyway.
- Cons: a quieter failure, which the author may have deliberately avoided for a scoped failure.

**Recommendation: Proposal B, with Proposal A's classification applied to the row label.** The root
already proves this pattern works, and a blocking modal per expanded project is the one behaviour
the surrounding design explicitly set out to avoid.

---

### NEW-3 — FINAL DECISION: Proposal A, with an explicit modal rule

**Decision: implement Proposal A. Proposal B is rejected — the modal is intended.** The finding was
partly built on a wrong premise: it read the root's "no storm of modals" comment as banning modals
outright. The intended rule is narrower, and it is about _who asked_:

| Trigger                                        | Failure surface                    |
| ---------------------------------------------- | ---------------------------------- |
| User expands a project node                    | Modal **plus** the retry node      |
| User clicks the "Click here to retry" node     | Modal **plus** the retry node      |
| User runs **Refresh** on the node or the tree  | Retry node only, **no modal**      |
| Atlas answered successfully with an empty list | `empty` placeholder, never a modal |

The parts of the finding that survive are real and must still be fixed: the modal's `detail` is a
fixed credential-blaming string for every failure kind, the actual error text never reaches the
user, and the call is `await`ed inside `getChildren()`.

**Change 1 — classify, and stop blaming credentials for transient failures.** Replace
`showAtlasLoadFailure`'s fixed detail with wording chosen from `classifyAtlasError()`, and include
the real error, matching what `KubernetesContextItem.createConnectionErrorChildren()` already does
in this repository:

```typescript
export function showAtlasLoadFailure(title: string, error: unknown, hint: string): void {
  const message = error instanceof Error ? error.message : String(error);
  ext.outputChannel.error(l10n.t('Failed to load MongoDB Atlas discovery: {0}', message));

  // `void`, not `await`: the Kubernetes plugin does the same. Awaiting a modal inside
  // `getChildren()` keeps the tree node spinning until the dialog is dismissed, and queues one
  // dialog per expanded project.
  void window.showErrorMessage(title, {
    modal: true,
    detail: `${hint}\n\n${l10n.t('Error: {0}', message)}`,
  });
}
```

The `hint` comes from the taxonomy the plugin already owns, so a dropped connection no longer tells
the user to re-enter a working key:

```typescript
function recoveryHintFor(kind: AtlasErrorKind): string {
  switch (kind) {
    case 'auth':
      return l10n.t('The stored credential was rejected. Update it, then try again.');
    case 'forbidden':
      return l10n.t(
        'The credential is signed in but lacks access to this project. Review its roles and IP access list in MongoDB Atlas.',
      );
    case 'rateLimited':
      return l10n.t('MongoDB Atlas asked us to slow down. Wait briefly, then try again.');
    case 'network':
      return l10n.t('MongoDB Atlas could not be reached. Check your connection or proxy settings, then try again.');
    default:
      return l10n.t('Try again. If this persists, check the output channel for details.');
  }
}
```

**Change 2 — suppress the modal on Refresh only.** `refreshTreeElement` calls `node.refresh(context)`
when the element defines it, while `retryAuthentication` (the "Click here to retry" handler) goes
straight to `resetNodeErrorState()` + provider `refresh(node)` and never touches the element. That
asymmetry is exactly the signal needed, so no new command or context plumbing is required — set a
one-shot flag in the element's own `refresh()`:

```typescript
/**
 * Set by {@link refresh} and consumed by the next {@link getChildren}.
 *
 * Refresh is a passive, whole-subtree action: the user is not asking about this project in
 * particular, so a failure belongs in the retry node, not in a dialog. Expanding the node, or
 * clicking "Click here to retry", *is* a question about this project and still answers with a
 * modal. `retryAuthentication` deliberately does not call this method, which is what keeps the
 * two paths distinguishable without extra plumbing.
 */
private suppressNextLoadModal = false;

public async refresh(_context: IActionContext): Promise<void> {
    this.suppressNextLoadModal = true;
    atlasTrace(`project "${this.project.name}": explicit refresh requested`);
    await this.discoveryService.sessionRegistry.refreshSession(this.ownerCredentialId);
    ext.discoveryBranchDataProvider.resetNodeErrorState(this.id);
    ext.discoveryBranchDataProvider.refresh(this);
}

async getChildren(): Promise<ExtTreeElementBase[]> {
    const quiet = this.suppressNextLoadModal;
    this.suppressNextLoadModal = false;   // one-shot; a later expand must show the modal again
    // …
}
```

Reset the flag at the top of `getChildren()` (not in a `finally` further down) so an early return or
a throw cannot leave a stale `true` that silences the next genuine expansion.

**Change 3 — same treatment for the no-session branch.** `getChildren()`'s
`if (!session)` path currently hardcodes "The credential for this project was rejected", which is
the same MEDIUM-3 collapse. Once MEDIUM-3 gives the session registry a typed failure, route that
branch through `recoveryHintFor()` as well; the two findings should land in one change.

Tests to add:

- `getChildren()` after `refresh()` → no `showErrorMessage` call, retry node still returned.
- `getChildren()` without a preceding `refresh()` → `showErrorMessage` called once.
- Two consecutive `getChildren()` calls after one `refresh()` → the second one shows the modal.
- A `network`-classified failure → the detail contains the retry wording, not the credential wording.

> ✅ **RESOLVED (dev/tnaum/atlas-discovery-review-iteration) — Proposal A, with MEDIUM-3.**
> `showAtlasLoadFailure(title, error, hint)` is now `void` (not awaited), logs the real error to the
> output channel, and renders the hint plus the error text; `recoveryHintFor(kind)` supplies the
> per-kind wording. `AtlasProjectItem.getChildren()` classifies the failure through
> `classifyAtlasError` and only shows the modal when the one-shot `suppressNextLoadModal` flag is
> clear; `refresh()` sets that flag (a passive Refresh), while `retryAuthentication` does not (an
> explicit retry still shows the modal). The flag is read and reset at the top of `getChildren()`.
> The no-session branch routes through `recoveryHintFor('auth')`, and `getSession`/`refreshSession`
> can now throw (MEDIUM-3), handled by the same catch/`.catch(() => undefined)`.
> Fix: [AtlasProjectItem.ts](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasProjectItem.ts),
> [showAtlasLoadFailure.ts](../../../../src/plugins/service-atlas-mongodb/discovery-tree/showAtlasLoadFailure.ts).
> Tests: modal-once on expand, no-modal-after-refresh, modal-again on the second expand, and
> network-wording assertion in
> [AtlasProjectItem.test.ts](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasProjectItem.test.ts).

### NEW-4: Digest authentication repeats the unauthenticated challenge on every request

**Severity: Medium.** It doubles Atlas Admin API traffic for every API Key credential, in a design
whose whole point is fan-out across credentials and projects, and it doubles it against the very
rate limit the code already has a taxonomy for.

File: `src/plugins/service-atlas-mongodb/api/AtlasApiClient.ts`

`requestOnce()` sends an unauthenticated `GET`, waits for the `401` challenge, then sends the real
request — **for every call**, including every page of every paginated list:

```typescript
const initialResponse = await fetch(url, { method: 'GET', headers, signal });
if (initialResponse.status === 401) {
    const challenge = parseDigestChallenge(wwwAuth);
    this.digestNonceCount++;
    …
    const authedResponse = await fetch(url, { method: 'GET', headers, signal });
```

The nonce-count field is the tell. `digestNonceCount` is an instance field incremented per request,
which is exactly the RFC 7616 mechanism for **reusing** a server nonce across subsequent requests —
but the challenge is discarded after each call, so a fresh nonce is fetched every time and the
counter never serves its purpose.

Cost: List mode with `N` projects issues roughly `2 × (2 + N)` requests per API Key credential
instead of `2 + N`. The owner's chosen MEDIUM-2 direction (always fetch clusters, for both view
modes) multiplies `N` by the credential count, so this lands on the more expensive design, not the
cheaper one.

**Proposal A: cache the challenge per client and reuse it with an incrementing `nc`.** Store the
parsed challenge, send the Digest header pre-emptively, and fall back to the challenge round-trip
only when the server answers `401` (stale nonce or first request).

```typescript
if (this.digestChallenge) {
    headers['Authorization'] = computeDigestHeader('GET', digestUri, …, this.digestChallenge, ++this.digestNonceCount);
}
const response = await fetch(url, { method: 'GET', headers, signal });
if (response.status === 401) {
    // Re-challenge: parse, reset the counter, and retry once.
}
```

- Pros: halves request volume on the steady-state path; uses `digestNonceCount` as intended;
  matches how conventional HTTP Digest clients behave; keeps a correct fallback for `stale=true`.
- Cons: adds one retry branch and a nonce-lifetime concern; needs the counter reset on a new nonce.

**Proposal B: leave the round-trip and reduce request count elsewhere.** Accept two requests per
call and instead avoid duplicate cluster listings (the snapshot already holds clusters that
`AtlasProjectItem` and `SelectAtlasClusterStep` re-fetch).

- Pros: no change to authentication code, which is the part with zero test coverage.
- Cons: does not address the multiplier; Service Account credentials would keep paying one request
  where API Key credentials pay two, so throttling behaviour stays auth-method dependent.

**Recommendation: Proposal A, implemented together with the WITHDRAWN-1 hardening.** Both touch the
same eight lines and both need the same first Digest unit test, so doing them separately means
writing that test twice. Assert: a pre-emptive `Authorization` header on the second request, a
correctly incremented `nc`, and a re-challenge on a `401` with `stale=true`.

> ✅ **RESOLVED (dev/tnaum/atlas-discovery-review-iteration), together with WITHDRAWN-1.** Added a
> `digestChallenge` field cached per client. `requestOnce()` now answers pre-emptively with the
> cached challenge and an incrementing `nc` (`++this.digestNonceCount`), only fetching a fresh
> unauthenticated challenge on the first request or on a `401` re-challenge (the counter resets to 0
> when a new nonce is adopted). This drops steady-state API Key traffic from two requests per call to
> one. The `(digest challenge answered)` trace line became `(digest)` because the challenge round-trip
> is no longer the common path.
> Fix: [src/plugins/service-atlas-mongodb/api/AtlasApiClient.ts](../../../../src/plugins/service-atlas-mongodb/api/AtlasApiClient.ts)
> (`DigestChallenge` exported from
> [AtlasDigestAuth.ts](../../../../src/plugins/service-atlas-mongodb/api/AtlasDigestAuth.ts)).
> Tests in [AtlasApiClient.test.ts](../../../../src/plugins/service-atlas-mongodb/api/AtlasApiClient.test.ts):
> pre-emptive reuse with `nc` advancing 1→2, and a stale-nonce re-challenge resetting `nc` (1,2,1).

### NEW-5: Non-connectable clusters are guarded in the wizard but not in the tree

**Severity: Low.** The user reaches an internal assertion message instead of an explanation; nothing
is corrupted and the tree recovers.

Files:

- `src/plugins/service-atlas-mongodb/discovery-tree/AtlasClusterItem.ts`
- `src/plugins/service-atlas-mongodb/models/AtlasClusterModel.ts`
- `src/plugins/service-atlas-mongodb/discovery-wizard/SelectAtlasSteps.ts`

`SelectAtlasClusterStep` handles this carefully: non-`IDLE` clusters become `unavailableCluster`
items with a per-state explanation, and a missing connection string raises a worded
`UserCancelledError`. The tree does none of it. `getTreeItem()` returns
`collapsibleState: Collapsed` unconditionally, and `authenticateAndConnect()` then reaches:

```typescript
nonNullValue(this.cluster.connectionString, 'cluster.connectionString', 'AtlasClusterItem.ts');
```

`buildTooltip()` already proves the value is known to be optional (`if (this.cluster.connectionString)`).
The same applies to `getCredentials()`, which backs "Save to Connections". The failure is contained —
`callWithTelemetryAndErrorHandling` catches it and the item falls back to its error-recovery
children — but the message the user sees is an internal invariant string, for a state the wizard
explains properly two files away.

Related: `createAtlasClusterModel()` dereferences `cluster.connectionStrings.standardSrv` and
`SelectAtlasSteps` dereferences `c.connectionStrings.standardSrv`, both without a guard, even though
`connectionStrings` is populated by the API and is not validated (see NEW-7).

**Proposal A: mirror the wizard's guard in the tree.** Render a non-`IDLE` or connection-string-less
cluster as `TreeItemCollapsibleState.None` and reuse `getStateExplanation()` in the tooltip.

- Pros: the two surfaces agree; the user gets the explanation that already exists; no new strings.
- Cons: a cluster that becomes `IDLE` needs a refresh before it is expandable, which is already true
  of everything else in the snapshot.

**Proposal B: keep it expandable and return an informative child row.** Detect the condition in
`authenticateAndConnect()` and surface `getStateExplanation()` instead of the assertion.

- Pros: no change to collapsible state; the affordance stays uniform.
- Cons: invites a click that can never succeed, which is what the wizard deliberately prevents.

**Recommendation: Proposal A.** The wizard already made this decision for the same data; the tree
should not disagree with it.

> ✅ **RESOLVED (dev/tnaum/atlas-discovery-review-iteration) — Proposal A.** `AtlasClusterItem` now
> renders a non-IDLE or connection-string-less cluster as `TreeItemCollapsibleState.None` via an
> `isConnectable()` helper, and the tooltip explains why (`getStateExplanation()` for a non-IDLE
> state, or a "does not expose a connection string yet" message for the connection-string-less case).
> `authenticateAndConnect()` and `getCredentials()` guard on `isConnectable()` and show a localized
> warning instead of tripping the internal `nonNullValue` assertion. The related unguarded
> `connectionStrings` dereferences are covered by NEW-7.
> Fix: [AtlasClusterItem.ts](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasClusterItem.ts).
> Tests: collapsibleState `Collapsed`/`None` cases in
> [AtlasClusterItem.test.ts](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasClusterItem.test.ts).

### NEW-6: The Atlas plugin is the only discovery provider without a journey correlation ID

**Severity: Low.** A telemetry blind spot rather than a user-visible defect, but it silently breaks
the one funnel metric the plugin's own code comments say they exist for.

Files:

- `src/plugins/service-atlas-mongodb/discovery-tree/AtlasServiceRootItem.ts`
- `src/plugins/service-atlas-mongodb/discovery-tree/AtlasProjectItem.ts`

Every other provider mints one at its root and threads it down:
`AzureServiceRootItem`, `AzureMongoRUServiceRootItem`, `AzureVMServiceRootItem`, and
`KubernetesKubeconfigSourceItem` all do `const journeyCorrelationId = randomUUID();`. Atlas passes an
empty string from both construction sites:

```typescript
return new AtlasClusterItem('', treeCluster, context, { … });   // AtlasServiceRootItem
return new AtlasClusterItem('', treeCluster, undefined, { … }); // AtlasProjectItem
```

`AtlasClusterItem` then guards with `if (this.journeyCorrelationId)`, so nothing is emitted, and
`addConnectionFromRegistry`'s `if (node.journeyCorrelationId)` and `trackJourneyCorrelationId()`
both find nothing. Atlas connections cannot be correlated across the discovery funnel while every
other source can.

**Proposal A: mint at the root and thread it through, matching the four existing providers.**

- Pros: identical to prior art; makes Atlas comparable with the other sources in dashboards.
- Cons: two constructor arguments to plumb, one of which passes through `AtlasOrganizationItem`.

**Proposal B: mint per `AtlasClusterItem`.**

- Pros: no plumbing.
- Cons: defeats the purpose — the ID is meant to correlate a _journey_ from root expansion to
  connection, not to label one node.

**Recommendation: Proposal A.** This is prior art that already exists four times in the repository;
diverging from it is not a design choice here, it is an omission.

> ✅ **RESOLVED (dev/tnaum/atlas-discovery-review-iteration) — Proposal A.** `AtlasServiceRootItem`
> mints a `journeyCorrelationId` (`randomUUID()`) and threads it through `AtlasOrganizationItem` and
> `AtlasProjectItem` to every `AtlasClusterItem`, plus the List-mode direct construction. Both the
> Tree and List paths now pass the ID instead of `''`, so Atlas connections correlate across the
> discovery funnel like the other providers.
> Fix: [AtlasServiceRootItem.ts](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasServiceRootItem.ts),
> [AtlasOrganizationItem.ts](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasOrganizationItem.ts),
> [AtlasProjectItem.ts](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasProjectItem.ts).

### NEW-7: Atlas API payloads are cast, never validated

**Severity: Low.** No confirmed reproduction, but the surface is wide and the mitigation is already
a dependency of this file's own router.

Files: `src/plugins/service-atlas-mongodb/api/AtlasApiClient.ts`, `models/AtlasClusterModel.ts`,
`discovery/AtlasDiscoveryService.ts`

Every Admin API response is `(await response.json()) as T`. Nothing checks that the payload matches
the declared interfaces, and several consumers dereference or sort on fields that would be
`undefined` if Atlas ever omitted them:

- `createAtlasClusterModel` → `cluster.connectionStrings.standardSrv` (throws if `connectionStrings`
  is absent, which is plausible for a cluster still being created);
- `mergeResults` → `a.organization.name.localeCompare(…)` and `a.cluster.name.localeCompare(…)`;
- `AtlasClusterItem.buildTooltip` → `escapeMarkdown(this.cluster.stateName)`;
- `AtlasClusterModel.stateName` is typed as the `AtlasClusterState` union but is only ever cast into
  it, so an unrecognised Atlas state silently becomes a value outside the union.

`zod` is already used at the tRPC boundary in `atlasCredentialsRouter.ts`, so the tool is present.

**Proposal A: validate at the API boundary with narrow schemas.** Parse list responses in
`requestAllPages`/`request` with `zod`, keeping schemas permissive (`.passthrough()`, optional
everything Atlas marks optional) so a new Atlas field never breaks discovery.

- Pros: one place to enforce the contract; unknown cluster states can be normalised to `UNKNOWN`,
  which the UI already renders; makes the declared interfaces true.
- Cons: schema drift becomes a maintenance item; over-strict schemas would turn an additive Atlas
  change into a discovery outage, so `.passthrough()` is not optional.

**Proposal B: guard only the dereferences that can throw.** Make `connectionStrings` optional in the
model, default `stateName` to `'UNKNOWN'`, and use `?? ''` in the sort comparators.

- Pros: much smaller; targets the three places that would actually throw.
- Cons: leaves the type declarations lying about what was verified.

**Recommendation: Proposal B for this PR, Proposal A tracked.** The full-boundary schema is the
right long-term shape but is a large addition to an already large PR; the three concrete
dereferences should be fixed now, and `connectionStrings` should be declared optional so the
compiler enforces the guard.

---

### NEW-7 — FINAL DECISION: Proposal B now, Proposal A tracked as a GitHub issue

**Decision: implement Proposal B in this PR, then file an issue for Proposal A.**

Implement now, in `AtlasProjectModel.ts` / `AtlasClusterModel.ts` / `AtlasDiscoveryService.ts`:

1. Declare `AtlasCluster.connectionStrings` as optional (`readonly connectionStrings?: AtlasConnectionStrings;`)
   so the compiler forces every dereference to be guarded. This turns the two unguarded accesses in
   `createAtlasClusterModel()` and `SelectAtlasSteps.getClusterItems()` into build errors rather
   than runtime hazards.
2. Normalise an unrecognised `stateName` to `'UNKNOWN'` at the model boundary. The UI already
   renders `UNKNOWN` with a label and an explanation, so this costs nothing and makes
   `AtlasClusterState` true instead of merely asserted.
3. Use `?? ''` in the three `localeCompare` comparators in `mergeResults()`.

```typescript
// Atlas is a live API and this model is built from a cast, not a validated payload. These three
// guards cover the fields a missing value would actually throw on; see the tracked issue for
// validating the whole boundary.
connectionString: cluster.connectionStrings?.standardSrv ?? cluster.connectionStrings?.standard,
stateName: ATLAS_CLUSTER_STATES.includes(cluster.stateName) ? cluster.stateName : 'UNKNOWN',
```

**Then file the issue** — see [ISSUE-1](#issue-1-validate-atlas-admin-api-payloads-at-the-boundary)
in "Follow-up Issues to File". Do not attempt the `zod` boundary in this PR.

> ✅ **RESOLVED (dev/tnaum/atlas-discovery-review-iteration) — Proposal B; INFO-1 folded in.**
> `AtlasCluster.connectionStrings` is now optional, turning the two unguarded dereferences
> (`createAtlasClusterModel`, `SelectAtlasSteps.getClusterItems`) into guarded `?.` accesses. A new
> exported `ATLAS_CLUSTER_STATES` array normalizes an unrecognized `stateName` to `'UNKNOWN'` at the
> model boundary, and the three `mergeResults` `localeCompare` comparators use `?? ''`. INFO-1 was
> folded in while the model was open: `AtlasClusterModel.clusterType` and the factory input now use
> the `AtlasClusterType` union instead of `string`. The `zod` boundary (Proposal A / ISSUE-1) was
> not attempted; it is noted in the executive summary as a follow-up.
> Fix: [AtlasProjectModel.ts](../../../../src/plugins/service-atlas-mongodb/models/AtlasProjectModel.ts),
> [AtlasClusterModel.ts](../../../../src/plugins/service-atlas-mongodb/models/AtlasClusterModel.ts),
> [AtlasDiscoveryService.ts](../../../../src/plugins/service-atlas-mongodb/discovery/AtlasDiscoveryService.ts),
> [SelectAtlasSteps.ts](../../../../src/plugins/service-atlas-mongodb/discovery-wizard/SelectAtlasSteps.ts).
> Tests: missing-connectionStrings and unrecognized-state cases in
> [AtlasClusterModel.test.ts](../../../../src/plugins/service-atlas-mongodb/models/AtlasClusterModel.test.ts).

### NEW-8: Terminal and shell titles lose their existing translations

**Severity: Low.** A localization-quality regression that no CI step detects. The owner's decision is
to remove the change rather than repair it; see the FINAL DECISION subsection at the end.

Files: `src/commands/openInteractiveShell/openInteractiveShell.ts`,
`src/documentdb/shell/DocumentDBShellPty.ts`

To make the shell say "MongoDB Atlas" for Atlas clusters, three message IDs were replaced by
placeholder-only ones:

```diff
- l10n.t('DocumentDB: {0}/{1}', connectionInfo.clusterDisplayName, connectionInfo.databaseName)
+ l10n.t('{0}: {1}/{2}', label, connectionInfo.clusterDisplayName, connectionInfo.databaseName)

- l10n.t('DocumentDB Shell: {0}', this._connectionInfo.clusterDisplayName)
+ l10n.t('{0} Shell: {1}', label, this._connectionInfo.clusterDisplayName)

- l10n.t('DocumentDB: {0}@{1}/{2}', …)
+ l10n.t('{0}: {1}@{2}/{3}', label, …)
```

Two effects: existing translations for the old IDs are orphaned, and `'{0}: {1}/{2}'` is an ID with
no translatable content and no context whatsoever — a translator cannot tell what it labels or
whether word order matters in their language.

**Proposal A: keep one message per brand.** Select the localized string by label rather than
interpolating the brand into the ID.

```typescript
const name = isAtlas
  ? l10n.t('MongoDB Atlas: {0}/{1}', clusterDisplayName, databaseName)
  : l10n.t('DocumentDB: {0}/{1}', clusterDisplayName, databaseName);
```

- Pros: the existing `DocumentDB: {0}/{1}` translations keep working; each ID is meaningful; word
  order is translatable per brand.
- Cons: two strings per site instead of one, and a third if another source is added.

**Proposal B: keep the interpolated ID but add a comment.** `vscode.l10n.t` supports a `comment`
field; use it to tell translators that `{0}` is a product name.

- Pros: one string; minimal diff.
- Cons: still discards the existing translations and still produces an ID with no content.

**Recommendation: Proposal A.** Brand names are exactly the case where interpolating into the
message ID costs more than it saves, and this PR is also the moment the old translations are lost.

---

### NEW-8 — FINAL DECISION: revert the shell labelling entirely

**Decision: neither proposal. Remove the change instead.** The shell is the DocumentDB shell; it is
the same shell whether the server behind it is Atlas or anything else, so renaming the terminal per
discovery source was scope the feature did not need. Reverting is also the only option that costs
nothing in translation: the four original message IDs come back and their existing translations
start working again.

Restore the base-branch text at all eight `shellLabel` touchpoints:

| File                                                        | Action                                                                                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/documentdb/shell/ShellSessionManager.ts`               | Delete the `shellLabel?: string` field from `ShellConnectionInfo`.                                                                                            |
| `src/commands/openInteractiveShell/openInteractiveShell.ts` | Delete both `const label = …` lines, the `shellLabel` computation in `extractConnectionInfo`, both `shellLabel,` properties, and the now-unused `API` import. |
| `src/documentdb/shell/DocumentDBShellPty.ts`                | Delete both `const label = …` lines.                                                                                                                          |

The exact strings to restore:

```typescript
// openInteractiveShell.ts, both call sites
l10n.t('DocumentDB: {0}/{1}', connectionInfo.clusterDisplayName, connectionInfo.databaseName);

// DocumentDBShellPty.ts, welcome banner
l10n.t('DocumentDB Shell: {0}', this._connectionInfo.clusterDisplayName);

// DocumentDBShellPty.ts, updateTerminalTitle(), with a username
l10n.t('DocumentDB: {0}@{1}/{2}', this._username, this._connectionInfo.clusterDisplayName, this._currentDatabase);

// DocumentDBShellPty.ts, updateTerminalTitle(), without a username
l10n.t('DocumentDB: {0}/{1}', this._connectionInfo.clusterDisplayName, this._currentDatabase);
```

Run `npm run l10n` afterwards so `'{0}: {1}/{2}'`, `'{0} Shell: {1}'`, and `'{0}: {1}@{2}/{3}'`
leave the bundle.

**Then file the issue** — see [ISSUE-2](#issue-2-make-the-interactive-shell-aware-of-its-target-platform).
The underlying idea (telling the user what they are connected to) is worth doing properly, as a
session summary such as "connected to `<cluster>` on `<platform>`", rather than as a terminal-title
prefix. Not in this PR.

> ✅ **RESOLVED (dev/tnaum/atlas-discovery-review-iteration) — reverted.** Removed the `shellLabel`
> field from `ShellConnectionInfo`, deleted the `shellLabel` computation and both properties in
> `openInteractiveShell.ts` (plus the now-unused `API` import), and deleted the two `const label = …`
> lines in `DocumentDBShellPty.ts`. All four original message IDs are restored: `DocumentDB: {0}/{1}`,
> `DocumentDB Shell: {0}`, `DocumentDB: {0}@{1}/{2}`. `npm run l10n` will remove the placeholder-only
> IDs at the final checklist step. ISSUE-2 is noted in the executive summary as a follow-up (not
> auto-filed).
> Fix: [openInteractiveShell.ts](../../../../src/commands/openInteractiveShell/openInteractiveShell.ts),
> [DocumentDBShellPty.ts](../../../../src/documentdb/shell/DocumentDBShellPty.ts),
> [ShellSessionManager.ts](../../../../src/documentdb/shell/ShellSessionManager.ts).

### NEW-9: `config.ts` evaluates `l10n.t()` at module load, against in-repo precedent

**Severity: Low.** Deferred to an extension-wide issue rather than fixed here; see the FINAL DECISION
subsection at the end.

File: `src/plugins/service-atlas-mongodb/config.ts`

```typescript
export const LABEL = l10n.t('MongoDB Atlas');
export const DESCRIPTION = l10n.t('Service Discovery for MongoDB Atlas');
export const WIZARD_TITLE = l10n.t('MongoDB Atlas Service Discovery');
```

The two Azure plugins do the same, so this is not novel — but the newest plugin in the repository
deliberately does not, and says why:

```typescript
// src/plugins/service-kubernetes/config.ts
/**
 * Display strings use getter functions to defer l10n.t() evaluation
 * until first access, avoiding module-load-time crashes if the
 * l10n subsystem isn't fully initialized during extension activation.
 */
export function getLabel(): string {
  return l10n.t('Kubernetes Clusters');
}
```

Atlas is more exposed than the Azure plugins because `ClustersExtension` constructs
`private readonly atlasDiscoveryProvider = new AtlasDiscoveryProvider();` as a **class field**, so
the module graph including `config.ts` is pulled in when `ClustersExtension` is constructed, whereas
the Azure providers are instantiated inside `activate()`.

**Proposal A: follow the Kubernetes pattern (`getLabel()`, `getDescription()`, `getWizardTitle()`).**

- Pros: matches the most recent, explicitly reasoned precedent; removes an activation-order
  dependency; a new plugin copying Atlas would inherit the safe pattern.
- Cons: touches every consumer of the three constants.

**Proposal B: leave it, consistent with the Azure plugins.**

- Pros: zero change; the pattern is already shipping twice.
- Cons: entrenches the pattern the repository has already decided against, and Atlas has the
  earliest instantiation of the four.

**Recommendation: Proposal A.** When a repository contains both an old pattern and a documented
replacement, new code should be written against the replacement.

---

### NEW-9 — FINAL DECISION: leave as-is, track extension-wide

**Decision: no change in this PR.** Atlas matches two of the four existing plugins; fixing one
plugin in isolation produces three inconsistent patterns instead of two, and the deferral question
is not Atlas-specific — it applies to every module-level `l10n.t()` in the extension.

**File the issue** — see [ISSUE-3](#issue-3-revisit-module-load-time-l10nt-evaluation-extension-wide).
That issue owns the sweep, including whether `getLabel()`-style deferral becomes the documented
convention or the Azure/Atlas constant form is confirmed as safe.

### NEW-10: Dead code and contract fields the implementation never produces

**Severity: Informational.**

- `AtlasClusterItem.getAtlasConsoleUrl()` is `public`, builds an unencoded URL, and has **no call
  sites** anywhere in `src/`. It is the remnant the Copilot review's URL-encoding comment referred
  to. Delete it; leaving an unencoded URL builder around invites its reuse.
- `AtlasCredentialError.retryable` is documented as "`false` only when retrying cannot possibly
  help (for example the credential was removed)", but every construction site in
  `AtlasDiscoveryService.ts` passes `retryable: true`. Either produce `false` for the removed-record
  case in `retryCredential()`, or drop the field and the comment.
- `persistCredential()`'s fallthrough comment — "The record disappeared while the webview was open;
  fall through and add it back" — describes an unreachable branch, because
  `validateUpdateIdentity()` already returns an `identity` error ("This credential no longer
  exists") before either submit mutation reaches `persistCredential`.

### NEW-11: Fleet-level credential actions recurse through `prompt()`

**Severity: Informational.**

File: `src/plugins/service-atlas-mongodb/credentialsManagement/SelectAtlasCredentialStep.ts`

Both "Retry all" and a cancelled "Add a credential…" re-enter the step with
`await this.prompt(context)`, so each round adds a frame instead of returning to the wizard loop. In
practice the depth is bounded by user patience, but a `GoBackError` raised from the QuickPick inside
a nested frame propagates through every outer frame to the wizard, so pressing Back after several
"Retry all" rounds leaves the list entirely rather than returning to it. A `for (;;)` loop inside
`prompt()` — the pattern `AtlasCredentialActionStep` and `SelectAtlasDatabaseUserStep` already use —
would give the same behaviour with a flat stack and predictable back navigation.

### NEW-12: The Service Account token response is used without checking its shape

**Severity: Informational.**

File: `src/plugins/service-atlas-mongodb/auth/AtlasServiceAccountClient.ts`

`return (await response.json()) as AtlasServiceAccountTokenResponse;` is unchecked. A `200` without
`expires_in` yields `Date.now() + undefined * 1000` → `NaN` → `expiresAt: "NaN"`, which
`isExpired()` treats as expired, so every request re-mints a token. A `200` without `access_token`
produces `Authorization: Bearer undefined`. Both degrade rather than crash, which is why this is
informational, but a two-field check would turn a confusing symptom into a clear error — and it is
the natural place to attach MEDIUM-3's typed token error.

### NEW-13: Unrelated behaviour changes are bundled into the Atlas commit

**Severity: Informational**, with one substantive sub-point worth resolving before merge.

The single `feat: add MongoDB Atlas discovery provider plugin` commit also changes core
database-creation behaviour and shell labelling:

- `ClustersClient.createDatabase(databaseName, collectionName?)` — a public signature change;
- `InitialCollectionNameStep` and `CreateDatabaseWizardContext.requiresInitialCollection` — a new
  prompt in the shared Create Database wizard;
- shell/terminal title changes (see NEW-8).

None of these are wrong on their own, but they are invisible from the PR title, they are not
described in the Atlas design docs, and a reviewer looking at an Atlas discovery PR has no reason to
scrutinise `createDatabase`.

The substantive sub-point: `requiresInitialCollection` is gated on
`node.experience.api === AtlasExperience.api`. That experience only exists on nodes in the
**Discovery** tree. Once the same Atlas cluster is saved into the Connections view, its experience is
no longer `mongoDBAtlas`, so Create Database silently reverts to the
`_dummy_collection_creation_forces_db_creation` path — the exact behaviour the new step was added to
avoid, on the exact same server. Either the gate needs to be a property of the connection rather
than of the discovery node, or the initial-collection prompt should be unconditional (it is harmless
for vCore, which simply gets a real first collection instead of a dummy one).

Also worth noting: `InitialCollectionNameStep` instantiates a whole `CollectionNameStep` purely to
borrow `validateInput`, and skips its async `validateNameAvailable` check. That is defensible for a
database that does not exist yet, but extracting the validator into a plain function would say so
more clearly than holding a wizard step as a field.

## Recommended Disposition

**Request changes before merge.** Every item below carries an owner decision; the sections above hold
the reasoning and the code. This section is the work order.

Read this first if you are the implementing agent:

- Where a finding has a `— FINAL DECISION:` subsection, **that subsection wins**. Earlier
  "Owner decision" / "Recommendation" paragraphs in the same finding are kept for context and are
  explicitly superseded. This applies to MEDIUM-2, MEDIUM-4, NEW-1, NEW-3, NEW-7, NEW-8, NEW-9.
- Comments requested in the decisions are part of the deliverable, not optional polish. Several of
  these fixes look like mistakes without them and will be "corrected" back into bugs.
- Do not widen scope. Items marked _deferred_ have GitHub issues instead; file them, do not build them.

### Blocking

| #   | Finding                       | Work                                                                                                                                                                                       |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **MEDIUM-1**                  | `myCtx.signal?.throwIfAborted()` immediately before `persistCredential()`, both auth methods. Note the optional chaining.                                                                  |
| 2   | **MEDIUM-2** (Proposal B)     | Serialize `listAll()` passes; `invalidate()` stops clearing `inflight`; add `DISCOVERY_TIMEOUT_MS`; add the abort/timeout branch to `classifyAtlasError()`. Keep all four comments.        |
| 3   | **MEDIUM-3 + NEW-3** together | One root cause. Give token failures a typed outcome, then drive both the tree modal's wording and the no-session branch from `classifyAtlasError()`. Add the refresh-vs-expand modal rule. |
| 4   | **NEW-2**                     | Add `mongoDBAtlas` to the four remaining `treeitem_index` `when` clauses in `package.json`.                                                                                                |
| 5   | **NEW-4 + WITHDRAWN-1**       | Cache the Digest challenge and reuse it with an incrementing `nc`; sign the full request-target. Same code, one new test file.                                                             |
| 6   | **NEW-8**                     | Revert the shell labelling at all eight `shellLabel` touchpoints; restore the four original message IDs; `npm run l10n`.                                                                   |

### Should land with the above

| #   | Finding                         | Work                                                                                                                   |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 7   | **MEDIUM-4** (now Low)          | `pushItem(updated, undefined)` in `updateAtlasCredentialMetadata`; generation guard on `storeSession`. No write queue. |
| 8   | **LOW-1**, **LOW-2**            | Host-owned link-failure handling; credential-neutral `403` fallback.                                                   |
| 9   | **LOW-3 + LOW-4**               | One localized tooltip field list using "Server version", plus the `requiresInitialCollection` comment terminology.     |
| 10  | **NEW-5**, **NEW-6**, **NEW-7** | Tree/wizard parity on non-connectable clusters; journey correlation ID; the three payload guards.                      |

### Accepted / no action

- **NEW-1** — the footer experiment ships; this is a preview release. Removal checklist recorded for
  the preview exit.
- **NEW-9** — `config.ts` stays consistent with the Azure plugins; tracked extension-wide instead.
- **INFO-1**, **NEW-10**–**NEW-13** — non-blocking. NEW-13's sub-point (`requiresInitialCollection`
  stops applying once an Atlas cluster is saved into Connections) still deserves an explicit
  yes/no, even if the answer is "accepted for now".

### Deferred to issues — file these, do not implement

1. [ISSUE-1](#issue-1-validate-atlas-admin-api-payloads-at-the-boundary) — `zod` validation of Atlas
   Admin API payloads (NEW-7 Proposal A).
2. [ISSUE-2](#issue-2-make-the-interactive-shell-aware-of-its-target-platform) — platform-aware
   interactive shell (replaces NEW-8's original intent).
3. [ISSUE-3](#issue-3-revisit-module-load-time-l10nt-evaluation-extension-wide) — extension-wide
   `l10n.t()` deferral review (NEW-9).

Also explicitly out of scope: the per-credential write queue (MEDIUM-4 Proposal A) and the
split-storage schema (MEDIUM-4 Proposal B). Neither is needed unless concurrent credential
management across two VS Code windows becomes supported.

### Before you finish

Per the repository checklist, run in order and do not stop until all five pass:
`npm run l10n` (strings changed in items 3, 5, 6, 8, 9) → `npm run prettier-fix` → `npm run lint` →
`npx jest --no-coverage` → `npm run build`.

## Follow-up Issues to File

Three issues, to be created on `microsoft/vscode-documentdb` after the implementation lands. Titles
and bodies are ready to paste.

### ISSUE-1: Validate Atlas Admin API payloads at the boundary

**Labels:** `enhancement`, `tech-debt`, `atlas`

> Every Atlas Admin API response in `src/plugins/service-atlas-mongodb/api/AtlasApiClient.ts` is
> returned as `(await response.json()) as T`. Nothing verifies that the payload matches the declared
> interfaces in `models/AtlasProjectModel.ts`, so the types are assertions rather than facts.
>
> PR #765 shipped targeted guards for the three places a missing field would actually throw
> (`connectionStrings` made optional, `stateName` normalised to `UNKNOWN`, `?? ''` in the
> `localeCompare` comparators). This issue covers the general fix.
>
> Proposal: parse list and single-resource responses with `zod` in `request()` /
> `requestAllPages()`. `zod` is already a dependency and is already used at the tRPC boundary in
> `atlasCredentialsRouter.ts`.
>
> **Hard requirement:** schemas must be permissive (`.passthrough()`, optional for everything Atlas
> marks optional). An over-strict schema would turn an additive Atlas API change into a total
> discovery outage, which is strictly worse than the current casts.
>
> Acceptance: unknown extra fields are preserved and ignored; a missing required field produces one
> classified, credential-scoped error instead of a thrown `TypeError`; existing
> `AtlasApiClient.test.ts` fixtures still pass unmodified.
>
> Origin: PR #765 review, finding NEW-7 Proposal A.

### ISSUE-2: Make the interactive shell aware of its target platform

**Labels:** `enhancement`, `shell`

> PR #765 briefly prefixed the terminal title with the discovery source ("MongoDB Atlas: …" instead
> of "DocumentDB: …"). That was reverted: the shell _is_ the DocumentDB shell regardless of which
> server it reaches, and encoding a brand into the terminal title also broke the existing
> localization of four message IDs.
>
> The underlying idea is still worth doing, but as session context rather than a title prefix. When
> a shell session starts, the welcome banner could state what it connected to and where it is
> hosted — for example "Connected to `<cluster>` on `<platform>`" — derived from the connection's
> origin rather than from the tree node that happened to launch it.
>
> Points to settle:
>
> - Where does the platform fact live? The launching tree node knows it; a saved connection in the
>   Connections view currently does not, so the same cluster would report differently depending on
>   how it was opened.
> - Banner only, or also `db.hello()`-style output in the session?
> - Keep the terminal title untouched — that is what made the first attempt costly.
>
> Origin: PR #765 review, finding NEW-8.

### ISSUE-3: Revisit module-load-time `l10n.t()` evaluation extension-wide

**Labels:** `tech-debt`, `localization`

> `src/plugins/service-kubernetes/config.ts` deliberately wraps its display strings in getter
> functions, documenting the reason: _"Display strings use getter functions to defer `l10n.t()`
> evaluation until first access, avoiding module-load-time crashes if the l10n subsystem isn't fully
> initialized during extension activation."_
>
> Three other discovery plugins (`service-azure-mongo-ru`, `service-azure-mongo-vcore`,
> `service-azure-vm`) and the new `service-atlas-mongodb` use module-level `export const LABEL =
l10n.t(…)` instead. PR #765 deliberately left Atlas consistent with the majority rather than
> creating a third pattern.
>
> This issue is the sweep, not a single-plugin fix:
>
> 1. Determine whether the Kubernetes comment describes a real, reproducible hazard on the currently
>    supported VS Code versions, or a defensive measure that is no longer needed.
> 2. If real: convert the remaining module-level `l10n.t()` call sites and add a lint rule or a test
>    so the pattern cannot come back. Note that `service-atlas-mongodb` has the earliest evaluation
>    of the four, because `ClustersExtension` instantiates `AtlasDiscoveryProvider` as a class field
>    rather than inside `activate()`.
> 3. If not real: simplify `service-kubernetes/config.ts` to constants and delete the comment, so
>    the repository stops carrying two contradictory conventions.
>
> Either outcome is fine; carrying both is not.
>
> Origin: PR #765 review, finding NEW-9.

## Copilot Reviewer Consolidation

Copilot submitted one review on 2026-06-30:
https://github.com/microsoft/vscode-documentdb/pull/765#pullrequestreview-4600653270

All six inline comments were re-read against the 2026-07-30 branch state.

| Discussion                                                                                                                           | Current assessment                                                                                                          | Severity / action               |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| [Wizard can continue with an undefined session](https://github.com/microsoft/vscode-documentdb/pull/765#discussion_r3498997591)      | Obsolete. `getDiscoveryWizard()` now awaits credential management and throws `UserCancelledError` when it returns `false`.  | Replied and resolved on GitHub. |
| [403 fallback mentions API key for Service Accounts](https://github.com/microsoft/vscode-documentdb/pull/765#discussion_r3498997624) | Still present; merged into LOW-2.                                                                                           | Low, open.                      |
| [Tooltip sentence is not localized](https://github.com/microsoft/vscode-documentdb/pull/765#discussion_r3498997649)                  | Still present; merged into LOW-3.                                                                                           | Low, open.                      |
| [Standalone MongoDB terminology](https://github.com/microsoft/vscode-documentdb/pull/765#discussion_r3498997670)                     | Still present; merged into LOW-4.                                                                                           | Low, open.                      |
| [Cluster console URL does not encode path values](https://github.com/microsoft/vscode-documentdb/pull/765#discussion_r3498997702)    | Obsolete after the deep-link refactor. `getAtlasConsoleUrl()` has no call sites; active links use `atlasDeepLinks` helpers. | Replied and resolved on GitHub. |
| [Cluster model should reuse unions](https://github.com/microsoft/vscode-documentdb/pull/765#discussion_r3498997729)                  | Partially fixed: state is typed, cluster type is not; merged into INFO-1.                                                   | Informational, open.            |

No duplicate Copilot comments were found beyond these six. Related descriptions were merged into
the findings above rather than repeated as separate issues.

**Second-pass note on the resolved URL-encoding comment.** The reply that closed
[discussion_r3498997702](https://github.com/microsoft/vscode-documentdb/pull/765#discussion_r3498997702)
is accurate — `getAtlasConsoleUrl()` genuinely has no call sites and the active deep links use
`encodeURIComponent`. But the unencoded builder is still in the file. "No call sites" is a reason to
delete it, not a reason to keep it; see NEW-10.

## Verified Design Decisions

Re-verified in the second pass against the branch source; all still hold.

- Multi-credential fan-out uses bounded concurrency and isolates failures with `Promise.allSettled()`.
- Organizations, projects, and clusters are deduplicated by Atlas identity while retaining every
  credential that can reach them.
- Secrets remain in SecretStorage-backed records and are not included in webview configuration or
  normal trace output.
- Atlas list endpoints now paginate to the documented 500-item maximum with a defensive page cap.
- Project-level cluster failures preserve healthy projects and credentials.

Additionally confirmed in the second pass:

- **Cluster ID discipline is correct.** `AtlasClusterItem` uses `this.cluster.clusterId` for
  `CredentialCache`, `ClustersClient`, and cleanup, and `treeId` only for tree identity, matching the
  repository's dual-ID rule. `createAtlasClusterModel` sanitises `/` out of both the project ID and
  the cluster name.
- **Deep links encode their path segments.** `buildAtlasAccessUrlFor` and `buildAtlasNetworkAccessUrl`
  both use `encodeURIComponent`. The unencoded builder the Copilot review flagged survives only as
  dead code (NEW-10).
- **Tooltips are untrusted.** Every `MarkdownString` sets `isTrusted = false` and passes values
  through `escapeMarkdown`.
- **Trace output cannot carry secrets.** `atlasTrace`/`atlasWarn` log paths, statuses, counts, and
  durations; credentials appear only as a label plus an eight-character record-ID prefix, and the
  `identityHint` is derived from the public key / client ID, never the secret half.
- **`SelectAtlasDatabaseUserStep` is well-behaved.** Bounded by `AbortSignal.timeout`, degrades to a
  plain username prompt on any failure, and never blocks sign-in.

## Validation

GitHub reports all five PR checks successful, including build/package, code quality/tests,
integration tests, API extraction, and CLA.

The repository-required local validation also passed after this review update:

```text
npm run prettier-fix  passed
npm run lint          passed

Test Suites: 179 passed, 179 total
Tests:       2905 passed, 2905 total
Snapshots:   4 passed, 4 total

npm run build         passed
```

Localization generation was not run because this review changed no extension-facing strings.

The full suite includes the focused Atlas API, discovery, and credential-router suites:

- `src/plugins/service-atlas-mongodb/api/AtlasApiClient.test.ts`
- `src/plugins/service-atlas-mongodb/discovery/AtlasDiscoveryService.test.ts`
- `src/webviews/documentdb/atlasCredentials/atlasCredentialsRouter.test.ts`

Green tests do not invalidate the active findings: there is no aborted deferred submission test,
no overlapping `listAll()`/forced-refresh test, no transient token-status classification test, and
no deferred credential-write interleaving test.

The second pass adds four more coverage gaps that explain why the findings above reached review with
a green suite:

- **No Digest test at all.** `AtlasApiClient.test.ts` covers the error envelope, diagnostic headers,
  pagination, and the Service Account refresh/`403` path. The API Key branch — challenge parsing,
  header construction, the signed request-target, and the request-per-call structure — has zero
  assertions (WITHDRAWN-1, NEW-4).
- **No `package.json` contribution test.** `lint`, `build`, and the Jest suite are all blind to a
  `when` clause that omits an experience, so NEW-2 could not have been caught by CI.
- **No component test for `AtlasCredentialsView.tsx`.** Nothing asserts what the credential screen
  renders, so a shipped `PREVIEW` control is invisible to CI (NEW-1). That is acceptable while it is
  intentional; it will not be once the preview exit removes it and nothing verifies it is gone.
- **No test asserts tree/wizard parity.** `SelectAtlasSteps` guards non-`IDLE` clusters and
  `AtlasClusterItem` does not; nothing compares the two surfaces (NEW-5).
