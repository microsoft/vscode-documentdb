# PR #886 review: Add managed identity authentication

**PR:** [microsoft/vscode-documentdb#886](https://github.com/microsoft/vscode-documentdb/pull/886)
**Head:** `dev/tnaum/managed-identities` → **Base:** `release/0.10.0`
**Merge base:** `c8e35105` · 25 commits · 98 files · +6288 / -961
**Reviewed:** 2026-08-13
**Reviewer:** agent-assisted code review

---

## Scope of this review

The diff against the merge base touches 102 paths, but a large share of them are **formatting-only
Prettier churn in Markdown files** (`docs/ai-and-plans/PRs/**`, `docs/localization.md`,
`src/webviews/**/README.md`, `src/services/taskService/UI/README.md`, and similar). Those were
skipped deliberately: they carry no behavioural content.

What was actually reviewed:

- `src/documentdb/auth/**` (the new managed identity core, 10 new files)
- `src/documentdb/wizards/authenticate/SelectManagedIdentityStep.ts`
- `src/documentdb/CredentialCache.ts`, `src/documentdb/ClustersClient.ts`
- `src/services/connectionStorageService.ts`
- `src/commands/newConnection/**`, `src/commands/updateCredentials/**`,
  `src/commands/copyConnectionString/**`, `src/commands/addConnectionFromRegistry/**`
- `src/tree/connections-view/DocumentDBClusterItem.ts`,
  `src/tree/azure-resources-view/documentdb/VCoreResourceItem.ts`,
  `src/plugins/service-azure-mongo-vcore/**`
- `src/documentdb/playground/**`, `src/documentdb/shell/**`
- `docs/ai-and-plans/managed-identities/**` (plan, decisions, research, implementation log,
  validation checklist), `docs/user-manual/connect-with-managed-identity.md`

Verification performed locally:

| Check                                                           | Result                                    |
| --------------------------------------------------------------- | ----------------------------------------- |
| `npx jest --no-coverage` over the managed identity test surface | 14 suites, **163 tests, all passing**     |
| `npm run build`                                                 | **Passes**, no type errors                |
| l10n bundle completeness for the new strings                    | **Complete**, all 24 new strings present  |
| Em dash / en dash convention in new files                       | **Clean** (only pre-existing files match) |
| `@azure/identity` declared as a runtime dependency              | **Yes**, `~4.13.0` under `dependencies`   |

---

## Verdict

**Approve with changes.** The design work behind this is unusually thorough, the code follows it
closely, and the test surface is real rather than decorative. Nothing here is architecturally wrong.

There is, however, **one Medium finding that quietly disables the feature's own headline diagnostic**
(F1), and it should be fixed before merge because the cross-tenant error message is one of the two
things this PR exists to deliver. Everything else is either a consistency issue that can be
scheduled, or trivia.

### Findings at a glance

| ID  | Severity     | Finding                                                                                    | Fix before merge?      |
| --- | ------------ | ------------------------------------------------------------------------------------------ | ---------------------- |
| F1  | **Medium**   | Tenant metadata is discarded when a connection is switched to or saved as managed identity | **Yes**                |
| F2  | **Medium**   | Two token-acquisition paths with different caching and duplicated logic                    | Recommended            |
| F3  | **Medium**   | An explicit pasted string can select a method the host never offered                       | Recommended            |
| F4  | Low / Medium | Transient network failures are reported as "no managed identity on this machine"           | Recommended            |
| F5  | Low          | "Recently used" identities are only recorded from one of four entry points                 | No, follow-up          |
| F6  | Low          | The `CredentialCache` inference change alters behaviour for **all** auth methods           | No, but call it out    |
| F7  | **Blocker**  | `package.json` version is pinned to `0.10.0-managed-identity`                              | **Yes**                |
| F8  | Low          | New secret slot added without a storage version bump                                       | No, document it        |
| C1  | Low          | Copilot: JWT payload decoded as `base64` rather than `base64url`                           | Optional (false alarm) |
| C2  | Low          | Copilot: user manual says "three things", lists four                                       | **Yes** (one line)     |
| C3  | Low          | Copilot: harness test replaces `process.env` wholesale                                     | Recommended            |

---

## F1. Tenant metadata is discarded when a connection becomes a managed identity connection

**Severity: Medium.** Correctness and diagnosability, in the exact scenario the feature was built for.

### Evidence

`verifyManagedIdentityTenant()` is the proactive cross-tenant check, and it is deliberately
conservative: it only runs when the cluster's tenant is known.

```ts
// src/documentdb/auth/managedIdentityTenant.ts
if (!clusterTenantId) {
  return;
}
```

The tenant reaches it as `this.clusterCredentials.entraIdConfig?.tenantId`
(`ManagedIdentityAuthHandler.configureAuth`). But two write paths delete exactly that value the
moment a connection becomes a managed identity connection:

```ts
// src/commands/updateCredentials/ExecuteStep.ts
} else if (authMethod === AuthMethodId.ManagedIdentity) {
    connectionCredentials.secrets.nativeAuthConfig = undefined;
    connectionCredentials.secrets.entraIdAuthConfig = undefined;   // <- tenant ID gone
    connectionCredentials.secrets.managedIdentityAuthConfig = context.managedIdentityAuthConfig ?? {};
}
```

```ts
// src/tree/connections-view/DocumentDBClusterItem.ts, "save credentials" branch
connection.secrets = {
    connectionString: connectionString.toString(),
    nativeAuthConfig: /* ... */,
    managedIdentityAuthConfig: managedIdentityAuthConfig,
    // entraIdAuthConfig is absent, so the whole secrets object is replaced without it
};
```

The second one is **pre-existing** (the object was already rebuilt without `entraIdAuthConfig`), but
this PR is what makes it consequential.

### Impact

A cluster imported from Azure Resources or Discovery carries `entraIdAuthConfig.tenantId` from its
subscription. Switch it to managed identity through **Update Credentials**, or connect once and tick
"save credentials", and that tenant ID is gone from storage. From the next window reload onward:

- `verifyManagedIdentityTenant()` returns early every time.
- A genuine cross-tenant failure surfaces as the cluster's generic authentication error, which names
  no cause. That is precisely the dead end the feature promises to turn into a sentence.
- Switching the connection back to Entra ID later has also lost its tenant pinning.

Note this is invisible in the current tests, because the tenant helper is unit-tested in isolation
and never exercised across a storage round trip.

### Approaches

| #   | Approach                                                                                                                                                                                     | Pros                                                                                                                                            | Cons                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | **Preserve `entraIdAuthConfig` when the method is `ManagedIdentity`** in both write paths (stop clearing it in `updateCredentials/ExecuteStep`, carry it through in `DocumentDBClusterItem`) | Smallest diff, ~4 lines; fixes both paths; keeps the tenant available if the user switches back to Entra ID                                     | Slightly muddies the "one config per method" invariant the surrounding code is trying to hold                                                                 |
| B   | **Add `tenantId` to `ManagedIdentityAuthConfig`** and populate it wherever the cluster tenant is known                                                                                       | Cleanest ownership: the managed identity config carries everything the managed identity handler needs; no reliance on a sibling method's config | New persisted field means a new `SecretIndex` slot and a storage change; touches ARM, Discovery, Connections and the wizard contexts; larger review surface   |
| C   | **Read the tenant from the cluster model at connect time** instead of from stored secrets (`AzureClusterModel.azureResourceId` already encodes it)                                           | No storage change at all; always fresh                                                                                                          | Only works for Azure Resources / Discovery nodes; Connections view items have no cluster model to read from, so the gap stays for the most common entry point |
| D   | Accept the gap and drop the claim from the docs                                                                                                                                              | Zero code                                                                                                                                       | Throws away the single most valuable diagnostic in the PR; the user manual already promises it                                                                |

### Recommendation: **A now, B as a follow-up.**

A is a four-line change that restores the behaviour the design intended, and it is safe: the Entra
config holds no secret, only `tenantId` and `subscriptionId`. Add one regression test that saves a
managed identity connection with an Entra tenant, reloads it through
`ConnectionStorageService` → `CredentialCache`, and asserts `entraIdConfig.tenantId` survives.

B is the right long-term shape but should not gate this PR; file it alongside the D4 follow-up issue.

---

## F2. Two token paths, two caches, duplicated logic

**Severity: Medium.** Consistency and performance, not correctness.

### Evidence

`managedIdentityTokenProvider.ts` exists specifically to guarantee one credential and one token cache
per window, and its own comment says so:

```ts
/**
 * One credential per identity, for the lifetime of the window.
 * ... for managed identity a cache miss is a real network round trip to the identity endpoint ...
 */
const credentialsByClientId = new Map<string, TokenCredential>();
```

The Playground and the Interactive Shell use it. `ManagedIdentityAuthHandler` does not:

```ts
// src/documentdb/auth/ManagedIdentityAuthHandler.ts
const { ManagedIdentityCredential } = await import('@azure/identity');
const credential = clientId ? new ManagedIdentityCredential({ clientId }) : new ManagedIdentityCredential();
```

A fresh credential, and therefore a fresh empty token cache, is created on **every** `configureAuth()`
call, i.e. on every `ClustersClient` initialisation. The two paths also duplicate the identical
try/catch, `reportManagedIdentityTokenFailure`, `describeManagedIdentityError` and
`verifyManagedIdentityTenant` sequence.

### Impact

- Extra IMDS round trips on every reconnect, expand-node retry, and multi-cluster session. Not
  user-visible on a healthy VM, but it is exactly the cost the token provider was written to avoid.
- Two places to keep in sync. A future change to the error mapping or the tenant check has to be
  applied twice, and there is nothing in the code that says so.

### Approaches

| #   | Approach                                                                                                                   | Pros                                                                           | Cons                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | **Make the handler call `getManagedIdentityAccessToken()`** and keep only the `MongoClientOptions` assembly in the handler | Single credential cache, single error/telemetry/tenant path, ~25 lines deleted | The provider returns `expiresOnTimestamp`, so the handler still owns `expiresInSecondsFromTimestamp`. Fine, but the seam has to be drawn deliberately |
| B   | Leave both, add a comment explaining why                                                                                   | Zero risk                                                                      | The comment would have to say "for no reason", because there is no reason; drift is inevitable                                                        |
| C   | Move `expiresInSecondsFromTimestamp` into the provider too and have it return `expiresInSeconds`                           | Handler shrinks to pure option assembly                                        | The Playground/Shell callers do not need `expiresInSeconds` in that form, so it would be dead weight for them                                         |

### Recommendation: **A.**

It deletes code, removes a class of future drift, and the existing
`ManagedIdentityAuthHandler.test.ts` already mocks `@azure/identity` at the module level, so it will
keep working with only a mock-target change. `expiresInSecondsFromTimestamp` stays in the handler.

---

## F3. An explicit pasted connection string can select a method the host never offered

**Severity: Medium.** State consistency, low likelihood.

### Evidence

In `PromptConnectionStringStep.prompt()` the method is selected from the hint **before** the host is
classified, and the two never reconcile:

```ts
if (managedIdentityHint.confidence === 'explicit') {
  context.selectedAuthenticationMethod = AuthMethodId.ManagedIdentity; // unconditional
}
// ... 30 lines later ...
const supportedAuthMethods: AuthMethodId[] = [AuthMethodId.NativeAuth];
if (hasDomainSuffix(AzureDomains.vCore, ...parsedConnectionString.hosts)) {
  supportedAuthMethods.push(AuthMethodId.MicrosoftEntraID);
  supportedAuthMethods.push(AuthMethodId.ManagedIdentity); // host-gated
}
```

Paste an `ENVIRONMENT:azure` string that points at a **non-vCore** host (self-hosted DocumentDB, a
private endpoint with a custom domain, a CNAME) and the record is persisted with
`selectedAuthMethod = ManagedIdentity` while `availableAuthMethods` is `[NativeAuth, NoAuth]`.

`PromptAuthMethodStep.shouldPrompt()` is `!context.selectedAuthenticationMethod`, so the user is
never asked and never sees the mismatch.

### Impact

- The connection itself still works: `ClustersClient` switches on `selectedAuthMethod`, not on the
  available list. So this is not a functional break.
- `updateCredentials()` only re-adds `ManagedIdentity` for vCore hosts, so a user who switches such a
  connection to Native auth **cannot switch it back** without recreating it.
- Any future consumer that treats `availableAuthMethods` as authoritative gets an inconsistent record.

Note that private endpoints are a realistic managed identity scenario, which is what lifts this above
"theoretical".

### Approaches

| #   | Approach                                                                                                            | Pros                                                                                                      | Cons                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | **Push `ManagedIdentity` into `supportedAuthMethods` whenever a hint was detected**, regardless of host             | One line; the record is always self-consistent; matches the reality that the user explicitly asked for it | Widens where the method is listed slightly beyond the "offered wherever Entra ID is offered" rule in §6 of the plan                                                     |
| B   | **Only honour the explicit hint when the host is vCore**, otherwise downgrade it to `weak` and let the user confirm | Keeps the availability rule pure                                                                          | Breaks the documented promise that the Microsoft Learn string "just works" when pasted, for anyone behind a private endpoint; also the least predictable of the options |
| C   | Move the host classification above the hint block and gate on it                                                    | Same effect as B with clearer code                                                                        | Same behavioural downside as B                                                                                                                                          |
| D   | Do nothing, note it in the validation checklist                                                                     | Zero risk today                                                                                           | Leaves an unreachable state that will be reported as a bug eventually                                                                                                   |

### Recommendation: **A**, plus one unit test on `PromptConnectionStringStep` asserting that an

explicit hint always leaves `ManagedIdentity` in `availableAuthenticationMethods`.

Reasoning: the user pasted a string that says, in the vendor's own documented syntax, "use the
machine identity". Refusing to list the method they just asked for, because we do not recognise their
hostname, is the extension being clever at the user's expense. Update §6 of `managed-identities.md`
to record the amended rule: _offered wherever Entra ID is offered, **or** wherever the connection
string explicitly asked for it._

---

## F4. Transient network failures are reported as a permanent host misconfiguration

**Severity: Low / Medium.** Error-message accuracy.

### Evidence

```ts
// src/documentdb/auth/managedIdentityErrors.ts
if (
  haystack.includes('network unreachable') ||
  haystack.includes('network_error') ||
  haystack.includes('is unavailable') ||
  haystack.includes('econnrefused') ||
  haystack.includes('ehostunreach') ||
  haystack.includes('enetunreach') ||
  haystack.includes('etimedout') ||
  haystack.includes('timed out')
) {
  return 'noEndpoint';
}
```

`noEndpoint` renders as:

> No managed identity is available on this machine. Managed identity authentication requires VS Code
> to be running on an Azure resource, such as an Azure VM, with an identity assigned.

`ETIMEDOUT` and "timed out" on an Azure VM that **does** have an identity mean the IMDS call was slow
or a proxy interfered, not that the host is not Azure. The message sends the user to check the wrong
thing. The ordering also matters: an MSAL message containing both "identity not found" and a
transport hint is classified by whichever substring appears in the earlier branch, and "not assigned"
is checked before the network group.

Second-order: `ambiguous` and `not assigned` are broad enough to match unrelated wording. The file
acknowledges this and says matching "is defensive and always falls through", which is fair, but the
consequence is a confidently wrong sentence rather than a vague one.

### Approaches

| #   | Approach                                                                                                                                                                                                                                                                                                        | Pros                                                                         | Cons                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| A   | **Split `noEndpoint` into `noEndpoint` and `endpointUnreachable`**; keep `ECONNREFUSED`/`EHOSTUNREACH`/`ENETUNREACH`/"no managed identity endpoint" as `noEndpoint`, move `ETIMEDOUT`/"timed out"/"network_error" to the new reason with a "could not be reached, this is usually transient, try again" message | Accurate for both cases; new telemetry reason is genuinely useful for triage | One new string to localize, one new telemetry value, small test update                                  |
| B   | **Soften the single message** to "No managed identity could be obtained on this machine. Either VS Code is not running on an Azure resource with an identity assigned, or the identity endpoint could not be reached."                                                                                          | One string change, no new reason                                             | Longer sentence that hedges; telemetry still cannot tell the two apart, which is the more valuable half |
| C   | Leave it; the harness test pins the observed shapes                                                                                                                                                                                                                                                             | Zero effort                                                                  | The harness pins the _shapes_, not the _appropriateness_ of the mapping; it would pass unchanged        |

### Recommendation: **A.**

The telemetry split is the real prize: "is this feature failing because people are not on Azure, or
because IMDS is flaky behind their proxy?" is a question the current single bucket cannot answer, and
it is exactly the question that will be asked after release.

---

## F5. "Recently used" identities are recorded from only one of four entry points

**Severity: Low.** UX consistency.

`rememberManagedIdentity()` has exactly one call site:

```
src/commands/newConnection/ExecuteStep.ts:242
```

`SelectManagedIdentityStep` is wired into four flows: New Connection, Update Credentials,
Azure Resources (`VCoreResourceItem`), and Discovery (`DocumentDBResourceItem`). Three of them never
record the chosen client ID, so the MRU list the step advertises stays empty for users who connect
primarily from the Azure or Discovery views, which, given the feature is Azure-only, is likely the
majority.

### Approaches

| #   | Approach                                                                    | Pros                                                                    | Cons                                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | Call `rememberManagedIdentity()` from the other three execute/connect paths | Explicit, matches the existing style                                    | Four call sites to keep in sync, easy to forget in the fifth flow                                                                                                                     |
| B   | **Record inside `SelectManagedIdentityStep.applyClientId()`**               | One place, impossible to forget, automatically covers any future wizard | Records an intent rather than a success: a user who picks an ID and then cancels the wizard still gets it in the list. For a convenience MRU that is arguably fine and arguably wrong |
| C   | Leave it, file a follow-up                                                  | Zero risk now                                                           | The step will look broken to Azure-view users on day one                                                                                                                              |

### Recommendation: **B.**

The list is explicitly documented as "purely a convenience list, and losing it is harmless"; the
symmetric statement is that gaining a stale entry is harmless too. One place beats four. If the
cancel case bothers the reviewer, take A and add the missing calls. It is not worth a long debate,
but it should not ship as-is.

---

## F6. The `CredentialCache` inference change affects every auth method, not just managed identity

**Severity: Low.** Behaviour change hidden inside a feature PR.

```ts
// before: only NoAuth was honoured explicitly; everything else fell through to inference
if (explicitMethod === AuthMethodId.NoAuth) { ... }

// after: any known persisted method wins over inference
if (isSupportedAuthMethod(explicitMethod)) {
    selectedAuthMethod = explicitMethod;
}
```

The justification is sound and well commented: a managed identity connection discovered through ARM
legitimately carries an `entraIdAuthConfig`, so inference genuinely cannot distinguish the two. And
`CredentialCache.test.ts` adds regression coverage for the new ladder.

But the blast radius is every stored connection. Any record whose `selectedAuthMethod` disagrees with
its secrets, for instance one written by an older code path and later edited, now resolves
differently than it did in 0.9.x.

**Recommendation:** no code change. Call it out explicitly in the PR description and in the release
notes, and add one line to `manual-validation-checklist.md`: _open an existing Native and an existing
Entra ID connection created on 0.9.x and confirm both still connect._ This is cheap insurance for a
change that is otherwise invisible in a diff titled "managed identity".

---

## F7. Version string must be reverted before merge

**Severity: Blocker (trivial).**

```json
// package.json
"version": "0.10.0-managed-identity",
```

From commit `8a386ca9 chore version bump for testing`. `package-lock.json` carries it too. The PR
targets `release/0.10.0`, so this must go back to `0.10.0` (or whatever the release branch holds).

**Recommendation:** revert `8a386ca9` before merge. No alternatives worth listing.

---

## F8. New secret slot added without a storage version bump

**Severity: Low.** Forward compatibility.

`SecretIndex.ManagedIdentityClientId = 5` is added to the v3.0 secrets array while `version` stays
`'3.0'`. The sentinel design (`'system-assigned'` vs a GUID vs absent) is correct and well reasoned,
and the contract tests cover all three states.

The consequence is only on **downgrade**: an older extension reading the same record sees an
unrecognised `selectedAuthMethod: 'ManagedIdentity'`, fails `isSupportedAuthMethod`, and falls back
through the old inference ladder. It will not crash, but it will silently connect as something else
or prompt for a password on a connection that has none.

### Approaches

| #   | Approach                                                                | Pros                                                                         | Cons                                                                                                  |
| --- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| A   | **Do nothing, document it**                                             | Correct in practice: array slots are additive and readers use `?? undefined` | Downgrade behaviour is undefined-ish and undocumented                                                 |
| B   | Bump the storage version to `3.1`                                       | Explicit signal                                                              | Every reader switch needs a new case for no functional gain; the format did not actually change shape |
| C   | Have older versions refuse records with an unknown `selectedAuthMethod` | Safest downgrade                                                             | Requires a change in an already-released version, so it is not actionable                             |

### Recommendation: **A.**

Add two lines to `decisions.md` recording that slot 5 is additive within `3.0` and what a downgrade
does. Nobody should spend a version bump on this.

---

## Copilot reviewer comments

Three inline comments were left by `copilot-pull-request-reviewer[bot]`. Assessment and proposed
resolution for each.

### C1. `readTenantIdFromAccessToken` decodes with `'base64'` instead of `'base64url'`

> `readTenantIdFromAccessToken` decodes the JWT payload using `'base64'`, but access tokens are
> base64url-encoded. This can fail to parse real tokens (especially those containing `-`/`_`),
> causing the tenant-mismatch diagnostic to silently never trigger.
>
> Source: `src/documentdb/auth/managedIdentityTenant.ts:23`

**Assessment: technically incorrect as stated, worth acting on anyway. Severity Low.**

Node's `'base64'` decoder explicitly accepts the URL-safe alphabet. This is documented behaviour, not
an accident (`Buffer` docs, `'base64'`: _"Also supports URL and Filename Safe Alphabet as specified
in RFC 4648, Section 5"_). Verified empirically on the repo's Node:

```
base64url:            eyJ0aWQiOiJhYWFhLWJiYmIiLCJ4IjoiPz8_Pz8-Pj4-Pn5-fn4ifQ
contains - or _:      true
Buffer.from(x,'base64').toString():  {"tid":"aaaa-bbbb","x":"?????>>>>>~~~~"}
```

So the claimed failure mode, a tenant claim that silently never parses, does not occur. The
diagnostic is not broken by this.

That said, the reviewer is right that the code is relying on a leniency it never states, and
`'base64url'` is the precise spelling for a JWT segment. The change is free.

**Proposed resolution:** use `'base64url'`, and add a JWT fixture containing `-`/`_` in the payload to
`managedIdentityTenant.test.ts` so the behaviour is pinned either way.

```ts
const decoded: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString());
```

Reply to the bot noting that Node's `'base64'` already handles the URL-safe alphabet, so the stated
impact does not apply, but the explicit spelling is being adopted for clarity.

---

### C2. User manual says "Three things" but lists four prerequisites

> The text says "Three things" / "all three" but the checklist enumerates four prerequisites
> (items 1–4). This is confusing for readers and makes it unclear whether one item is optional.
>
> Source: `docs/user-manual/connect-with-managed-identity.md:30`

**Assessment: valid. Severity Low, but fix it: it is one line in a page that will be linked from an
error message.**

Confirmed in the file: the sentence reads _"Three things have to be in place, and all three are
outside VS Code:"_ followed by four numbered items. Item 4 (same tenant) was almost certainly added
after the sentence was written, since it corresponds to the later `41e13926 Detect and explain a
cross-tenant managed identity failure` commit.

**Proposed resolution:** change the lead-in to

```markdown
Four things have to be in place, and all four are outside VS Code:
```

Prefer the number over a vaguer "The following must be in place": the count is a useful signal to a
reader skimming a troubleshooting page, and it is trivially maintainable. Also worth a quick scan of
the rest of the page for any other "three" that drifted.

---

### C3. Harness test replaces `process.env` wholesale

> Restoring the environment via `process.env = { ...originalEnv }` replaces Node's special
> `process.env` object with a plain object. This can leak env changes across tests and can break
> other code that relies on `process.env` semantics. Prefer mutating the existing object
> (delete added keys + `Object.assign`).
>
> Source: `src/documentdb/auth/managedIdentityEndpoint.harness.test.ts:81`

**Assessment: valid. Severity Low, test-only, but the reasoning is correct.**

`process.env` is a proxy over the real process environment. Assigning to it swaps in a plain object,
after which writes no longer reach `getenv`/child processes. In this suite nothing depends on that,
which is why the tests pass, but the suite runs under a shared Jest worker, so any later test in the
same worker that spawns a process or reads the environment natively inherits a degraded
`process.env`. That is a genuinely unpleasant class of cross-test flake, and it costs three lines to
avoid.

**Proposed resolution:** mutate in place.

```ts
afterEach(async () => {
  if (server) {
    /* ... unchanged ... */
  }

  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, originalEnv);
});
```

An alternative is to reach for a helper library, but adding a dependency for one `afterEach` in one
harness is not worth it. The loop is self-explanatory and stays local to the file that needs it.

---

## What the PR gets right

Worth recording, because these are the parts a future reviewer should not second-guess.

- **The plan-to-code fidelity is high.** `managed-identities.md`, `decisions.md` and
  `implementation-log.md` are not decoration: the code matches the design, including the awkward
  bits, and the divergences are logged rather than hidden.
- **`{}` vs `undefined` for the system-assigned identity** is handled consistently at every layer
  (wizard context, cache, storage sentinel), and it is commented at each one. This is the kind of
  detail that normally rots into a bug three months later.
- **`stripManagedIdentityMarkers` runs before the credential-stripping block.** The plan flagged this
  as "the single easiest thing to get wrong" and it was, correctly, not got wrong.
- **The identity-endpoint harness is real testing.** Driving the genuine `ManagedIdentityCredential`
  against a local HTTP server to pin observed MSAL error shapes is a substantially better answer than
  mocking the classifier's inputs, and the file explains exactly why it exists.
- **Copy/paste round-trip is asserted as a unit**, so the two halves of D1/D1a cannot drift apart
  silently.
- **The client ID is masked** (`context.valuesToMask.push(...)`) and kept out of telemetry, with only
  `managedIdentityKind: 'user' | 'system'` reported. Correct call: it is not a secret, but it is a
  stable tenant-scoped identifier.
- **The dynamic `await import('@azure/identity')`** keeps MSAL off the activation path in all three
  consumers.
- **No new VS Code settings**, per D5. The temptation to add a "managed identity client ID" setting
  must have been considerable.

---

## Pre-merge checklist

Ordered by what should block the merge.

1. **F7**: revert the `0.10.0-managed-identity` version bump (`package.json`, `package-lock.json`).
2. **F1**: stop discarding `entraIdAuthConfig` for managed identity connections, in
   `updateCredentials/ExecuteStep.ts` and `DocumentDBClusterItem.ts`; add a storage round-trip
   regression test.
3. **C2**: "Three things" → "Four things" in the user manual.
4. **F3**: always list `ManagedIdentity` in `availableAuthenticationMethods` when a hint was
   detected; amend §6 of `managed-identities.md`.
5. **F2**: route `ManagedIdentityAuthHandler` through `getManagedIdentityAccessToken()`.
6. **F4**: split the unreachable-endpoint reason out of `noEndpoint`.
7. **C3**: mutate `process.env` in place in the harness `afterEach`.
8. **C1**: `'base64url'` plus a fixture; reply to the bot correcting the stated impact.
9. **F5**: record the MRU entry inside `SelectManagedIdentityStep.applyClientId()`.
10. **F6 / F8**: documentation only: note the `CredentialCache` ladder change in the release notes
    and add the 0.9.x-connection regression line to `manual-validation-checklist.md`; record the
    additive slot-5 decision in `decisions.md`.

Then the standard five: `npm run l10n`, `npm run prettier-fix`, `npm run lint`,
`npx jest --no-coverage`, `npm run build`.

Finally, the whole thing still depends on **`manual-validation-checklist.md` being executed on a real
Azure VM**. No amount of harness testing substitutes for the multi-identity IMDS response, which is
the failure this PR was written to fix.
