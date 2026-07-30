# PR #765 Code Review: MongoDB Atlas Discovery Provider

Review date: 2026-07-30

PR: https://github.com/microsoft/vscode-documentdb/pull/765

Base: `release/0.10.0`

## Severity Summary

| Severity      | Count | Notes                                                                                         |
| ------------- | ----: | --------------------------------------------------------------------------------------------- |
| Critical      |     0 | No extension-wide, destructive, or secret-disclosure failures found.                          |
| High          |     0 | The earlier Digest-authentication finding was withdrawn after live validation.                |
| Medium        |     4 | Cancellation and concurrent writes can persist stale secrets; discovery and auth errors race. |
| Low           |     4 | One silent recovery-action failure and three user-facing consistency issues.                  |
| Informational |     1 | One model type-safety cleanup.                                                                |

## Review Scope

The review compares `feature/atlas-discovery` with the PR's actual base,
`release/0.10.0`. It covers the Atlas Admin API and authentication, credential storage,
multi-credential discovery aggregation, tree and connection flows, credential-management webview,
tRPC boundary, database and shell integration, package registration, tests, and workflow changes.

The design history in `docs/ai-and-plans/PRs/733-atlas-mongodb-discovery/` was consulted to avoid
reporting intentional multi-credential, partial-failure, tree/list, and recovery behavior as bugs.

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

**Owner decision: use complete internal snapshots plus Proposal A's generation guard.** Dynamic
cluster loading is not required. Discovery should first collect the complete internal data set for
each credential - organizations, projects, clusters, and typed failures - and merge it into one
immutable snapshot. Tree and List modes should then be presentation projections over that same
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

### MEDIUM-4: Concurrent credential writes can restore stale secrets after rotation or sign-out

Source: Independent follow-up review.

**Assessment: New finding. Severity: Medium.** The race can undo a validated secret rotation or
recreate an item after sign-out, which is a data-integrity failure. It requires overlapping storage
operations, so its likelihood is lower than the deterministic cancellation and error-classification
paths above.

Files:

- `src/plugins/service-atlas-mongodb/credentials/atlasCredentialStore.ts`
- `src/plugins/service-atlas-mongodb/auth/AtlasCredentialSessionRegistry.ts`
- `src/webviews/documentdb/atlasCredentials/atlasCredentialsRouter.ts`

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

## Recommended Disposition

**Request changes before merge.** The four Medium findings cover cancellation semantics, stale
discovery commits, incorrect Service Account recovery, and credential-store integrity; each affects
a normal user flow or persistent state and should be resolved before release. The withdrawn Digest
finding is not a severity basis for this disposition, but its RFC-alignment hardening is included
because the owner selected it for this PR.

Preferred implementation set:

1. WITHDRAWN-1 hardening: sign the full request-target to align with RFC 7616.
2. MEDIUM-1: let verification finish, then check `ctx.signal` immediately before persistence.
3. MEDIUM-2: always build a complete internal snapshot, project it for Tree/List, and generation-guard commits.
4. MEDIUM-3: retain raw output-channel diagnostics while mapping token failures to broad UI categories.
5. MEDIUM-4 Proposal A: serialize every read-modify-write and removal operation per credential ID.
6. LOW-1 host-owned handling and LOW-2 Proposal A: return link outcomes, notify in the router, and use neutral `403` wording.
7. LOW-3 Proposal B with LOW-4 Proposal A: render one localized tooltip field list using "Server version."

This set is preferred because it corrects the current behavior without redesigning when verified
credentials are committed or migrating the credential storage schema. It deliberately accepts
verification work completing after cancellation and the higher initial API cost of complete
discovery snapshots in exchange for simpler boundaries and one presentation-independent data
model. INFO-1 is non-blocking and can use Proposal A whenever the touched model is next updated.

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

## Verified Design Decisions

- Multi-credential fan-out uses bounded concurrency and isolates failures with `Promise.allSettled()`.
- Organizations, projects, and clusters are deduplicated by Atlas identity while retaining every
  credential that can reach them.
- Secrets remain in SecretStorage-backed records and are not included in webview configuration or
  normal trace output.
- Atlas list endpoints now paginate to the documented 500-item maximum with a defensive page cap.
- Project-level cluster failures preserve healthy projects and credentials.

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
