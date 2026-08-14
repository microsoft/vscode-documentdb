---
area: atlas-discovery
kind: research
status: active
created: 2026-07-24
code:
    - src/plugins/service-atlas-mongodb/**
verified: 2026-08-14
---

# Multi-credential Atlas discovery — feasibility POC plan & API research report

> **Status:** Research + design proposal (no production code yet).
> **Scope:** Step 0 (POC) of the [Iteration 3 open-work ledger](./iterations/03-ux-review.md#step-0--multi-credential-feasibility-poc-do-first),
> covering review items **#7** (multi-credential management), **#8** (org level + tree/list),
> and **#12** (credential identity/label lifecycle).
> **Audience:** engineers deciding whether to build multi-credential Atlas discovery, and
> whether the effort is proportionate to the value (this feature may be scrapped if the
> effort proves disproportionate — hence this up-front research).
> **Author aid:** file references use paths relative to this document so they resolve on GitHub.

---

## 0. TL;DR / recommendation

**Feasible, and lower-risk than expected.** The Atlas Admin API and the extension's existing
storage/tree infrastructure support everything the POC needs. The single most important
finding reframes the whole feature:

> **Each Atlas API Key and each Service Account belongs to exactly one organization, and can
> be granted access to _any subset_ of that org's projects (0…all, decided by its roles).**
> To see _N_ organizations you _must_ hold _N_ credentials — so multi-credential support is a
> prerequisite for multi-org support (item #8). But it is **not** a strict 1:1 "credential =
> org": within a single org you can legitimately hold several least-privilege credentials that
> each expose a _different subset_ of projects, and the org's full project set is their
> **union**. The data model must therefore key orgs/projects by Atlas ID and merge across
> credentials — see [§3.1](#31-credential-scoping--the-load-bearing-fact) and
> [§8 Q5](#8-answers-to-the-seven-poc-questions-ledger-step-0).

Recommended shape:

1. A **`AtlasCredentialStore`** built on the shared `StorageService` (the Kubernetes
   `sourceStore` pattern), holding _N_ credential records (non-secret metadata in `properties`,
   secrets in `SecretStorage`).
2. A **per-credential session/token layer** (`AtlasSessionManager` becomes one-per-credential,
   owned by the store) so token refresh, expiry, and auth-method are isolated.
3. A **single aggregation API** — `AtlasDiscoveryService.listAll()` — that fans out across
   credentials with `Promise.allSettled`, **never throws**, and returns
   `{ organizations, projects, clusters, credentialErrors }`. Partial failure of one
   credential never hides another's results.
4. **Parallel fan-out** across credentials (bounded by a concurrency limiter, cap ~4–5) is
   safe and ~8× faster than sequential — proven by [Experiment 3](#experiment-3--parallel-vs-sequential-fan-out).

**Effort:** medium. See [§11 effort & decision gates](#11-effort-estimate-decision-gates--scrap-criteria).
**Confidence in feasibility:** high (>90%). The blocking scope, aggregation, and error-taxonomy
assumptions passed the [live experiments](#102-experiments-requiring-a-live-atlas-account).

---

## 1. Why this research exists

The reviewer explicitly flagged this as an "API redesign" and the ledger deliberately puts a
**disposable POC first** so we validate the data/identity model before building UX on top of
it. If Atlas behaviour makes the model impractical (e.g. no stable identity, hostile rate
limits, or unavoidable all-or-nothing failure), we revise #7/#8 or scrap the feature rather
than sink UI effort into an unsupported assumption. This document does that validation on
paper and with isolated experiments, and lists the few checks that genuinely need a live
account.

---

## 2. Current architecture (single-session baseline)

| Concern        | Today                                                                         | File                                                                                                                                |
| -------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Session        | Exactly **one** `AtlasSession` (API key _or_ SA)                              | [AtlasSessionManager](../../../../src/plugins/service-atlas-mongodb/auth/AtlasSessionManager.ts)                                    |
| Secret storage | **Fixed single-slot keys** (`atlas-mongodb.apikey.publicKey`, …)              | [AtlasSessionManager.ts#L15-L20](../../../../src/plugins/service-atlas-mongodb/auth/AtlasSessionManager.ts#L15-L20)                 |
| API client     | One `AtlasApiClient` bound to one session; silent SA token refresh on 401/403 | [AtlasApiClient](../../../../src/plugins/service-atlas-mongodb/api/AtlasApiClient.ts)                                               |
| Tree root      | Fetches `listProjects()` + `listOrganizations()` for the single session       | [AtlasServiceRootItem](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasServiceRootItem.ts)                        |
| Recovery UX    | Per-session `sign-in` / `retry` / `update-credentials` error nodes            | [AtlasServiceRootItem.ts#L136-L170](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasServiceRootItem.ts#L136-L170) |

The single-slot secret keys are the structural blocker: they physically allow only one API key
and one Service Account. Everything else (client, tree, error nodes) is already
credential-agnostic enough to generalise.

---

## 3. Atlas Admin API — research findings

Sources: [Get Started with the Atlas Administration API](https://www.mongodb.com/docs/atlas/configure-api-access/),
[API Reference](https://www.mongodb.com/docs/atlas/api/atlas-admin-api-ref/),
[API Rate Limits](https://www.mongodb.com/docs/atlas/api/api-rate-limit/),
[API Authentication Methods](https://www.mongodb.com/docs/atlas/api/api-authentication/),
[Atlas User Roles](https://www.mongodb.com/docs/atlas/reference/user-roles/).

### 3.1 Credential scoping — the load-bearing fact

**API Keys and Service Accounts share one scoping model — the difference between them is only
the authentication _mechanism_ (Digest vs OAuth2), not scope.** The official wording is nearly
identical for both:

- Service accounts: _"Each service account belongs to **exactly one organization**, and you can
  grant it access to **any number of projects within that organization**."_
- API keys: _"Each pair of API keys belongs to **only one organization**, and can grant access
  to **any number of projects in that organization**."_
- The org boundary is hard: the credential _"must be a member of the organization that hosts the
  project. Otherwise, Atlas responds with a **401** error."_ ⇒ **to span _N_ orgs you need _N_
  credentials.**

**Which projects a credential can see is decided by its _roles_, not by whether it is a key or a
service account** ([user-roles](https://www.mongodb.com/docs/atlas/reference/user-roles/)):

| Role on the credential         | Projects visible via `GET /groups`                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `ORG_OWNER`                    | _"Project Owner access to **all projects** in the organization"_ → **every** project                              |
| `ORG_READ_ONLY`                | _"read-only access to the settings, users, and **projects in the organization**"_ → **every** project (read-only) |
| `ORG_MEMBER` (+ project roles) | _"can only access projects they have been **explicitly added to**"_ → **subset**                                  |
| project roles only (`GROUP_*`) | only the explicitly granted projects → **subset**                                                                 |

**Design implications (this corrects an earlier oversimplification):**

- A credential maps to **exactly one org** (hard) but to a **subset of that org's projects**
  (0…all, role-dependent). It is _not_ safe to treat "one credential" as "one whole org".
- Therefore **multiple credentials can share the same org** and each surface a _different_
  subset of projects; the org's full project list is their **union**. This is a legitimate,
  common least-privilege pattern (a scoped key per team/project instead of one org-owner key).
- Consequently the tree's org level must be keyed by **`orgId`** and **merge/dedup projects
  across all credentials** that resolve to that org, remembering which credential(s) can reach
  each project (drives ownership for subsequent API calls — POC Q5/Q6). It is _not_ a simple
  `credential → org node`.
- `GET /api/atlas/v2/orgs` for a credential returns the org(s) it belongs to (normally its one
  org); `GET /api/atlas/v2/groups` returns exactly the project subset above.

### 3.2 Authentication mechanics (already implemented, must go per-credential)

| Method          | Mechanism                                                   | Expiry                         | Refresh                                                                                                                      |
| --------------- | ----------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| API Key         | HTTP **Digest** (public key = user, private key = password) | Never expires                  | N/A — keys are long-lived                                                                                                    |
| Service Account | OAuth2 **client_credentials** → Bearer token                | **Access token: 3600 s (1 h)** | **Not refreshable.** Mint a _new_ token from `client_id`/`client_secret` at `POST https://cloud.mongodb.com/api/oauth/token` |

Confirmed from docs: _"The access token is valid for 1 hour (3600 seconds). You can't refresh
an access token. When this access token expires, repeat this step to generate a new one."_ The
current code already does exactly this in
[`tryRefreshServiceAccount`](../../../../src/plugins/service-atlas-mongodb/auth/AtlasSessionManager.ts#L291-L317)
and [`AtlasServiceAccountClient`](../../../../src/plugins/service-atlas-mongodb/auth/AtlasServiceAccountClient.ts).
The client secret itself has a separate, user-chosen expiry (months) — when it lapses, token
minting fails with a 401 and the credential needs re-entry.

### 3.3 Pagination

`results` + `totalCount` + `links` (`prev`/`next`/`self`). Query params: `pageNum` (1-based,
default 1), `itemsPerPage` (default 100, **max 500**), `includeCount`. The current client reads
only page 1 ([`AtlasApiClient.listProjects`](../../../../src/plugins/service-atlas-mongodb/api/AtlasApiClient.ts#L50-L53)),
which silently truncates accounts with >100 projects/clusters. **The aggregation layer should
follow `links.next` (or loop `pageNum`) — a latent bug worth fixing while we are here.**

### 3.4 Rate limits (Token Bucket) — parallelism is safe

Atlas rate-limits per **endpoint set** and **scope** (`USER`, `GROUP`, `ORGANIZATION`, `IP`),
each with its own bucket. The endpoints discovery uses:

| Endpoint                      | Scope     | Capacity | Refill      |
| ----------------------------- | --------- | -------- | ----------- |
| `GET /orgs` (list orgs)       | **USER**  | 300      | 100 / 60 s  |
| `GET /groups` (list projects) | **USER**  | 1200     | 500 / 60 s  |
| `GET /groups/{id}/clusters`   | **GROUP** | 10000    | 5000 / 60 s |

Because `/orgs` and `/groups` are **USER-scoped**, and a credential is its own programmatic
"user", **each credential has an independent bucket**. Fanning discovery out across _N_
credentials in parallel does **not** contend on a shared bucket. On 429 Atlas returns a
`Retry-After` header (and `RateLimit-Limit`/`RateLimit-Remaining`, which _may be absent_) and
an errorCode `RATE_LIMITED_TOKEN_BUCKET`. [Experiment 4](#experiment-4--token-bucket-headroom)
shows discovery spends ~1–2 tokens per credential per refresh — three orders of magnitude below
capacity. **Conclusion: parallel is fine; a bounded limiter and 429/Retry-After handling are
defensive, not load-bearing.**

### 3.5 Error model — distinguishing "empty" from "broken"

Error body fields: `detail`, `error` (int status), `errorCode` (stable constant), `parameters`,
`reason`. Two facts are critical for the "should I suggest a refresh?" UX:

- **An empty list is `200` with `results: []`, _not_ `404`.** So "no projects" is an
  authoritative, healthy answer — not an error. 404 is only returned when the _context_ does
  not exist (e.g. projects of a non-existent org).
- **An enforced IP Access List rejection is `403`.** Atlas only enforces an empty API Access
  List when the organization's **Require IP Access List for the Atlas Administration API**
  setting is enabled. If that setting is disabled, an empty list permits requests from any
  internet address; adding an entry makes the list restrictive. A credential can therefore be
  valid yet return `403` when the requirement is enabled or a non-matching entry exists. This is
  per-credential and recoverable by editing the Atlas API Access List — it must be reported as a
  credential error, not a global sign-out.

This lets the aggregation layer tag each credential result as one of:
`ok-with-data` · `ok-empty` · `auth-error(401)` · `forbidden(403)` · `rate-limited(429)` ·
`network/other`. The "suggest a refresh" affordance is only shown for the recoverable error
states, never for `ok-empty`.

---

## 4. Azure prior art in this repo — what to copy and what to avoid

(From a full read of `src/plugins/api-shared/azure/`; captured in repo memory.)

| Aspect                  | Azure implementation                                                                                                             | Verdict for Atlas                                                                                                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aggregation entry point | Single `getSubscriptions(true)` flattens all tenants → one list                                                                  | ✅ Copy the "one aggregation surface" idea                                                                                                                                                            |
| Fan-out                 | `Promise.all` over tenants for `isSignedIn` checks                                                                               | ❌ **All-or-nothing** — one failing tenant discards _every_ account ([SelectAccountStep.ts#L135-L182](../../../../src/plugins/api-shared/azure/credentialsManagement/SelectAccountStep.ts#L135-L182)) |
| Concurrency             | Shared limiter, cap 5, across wizard steps                                                                                       | ✅ Reuse [`createConcurrencyLimiter`](../../../../src/utils/concurrencyLimiter.ts)                                                                                                                    |
| Ordering gotcha         | `getTenants` + `getSubscriptions` **must be sequential** — running them in parallel returned incorrect data (documented in-code) | ⚠️ Heed within a credential; across credentials it doesn't apply                                                                                                                                      |
| Token refresh           | Delegated to `@microsoft/vscode-azext-azureauth` (opaque)                                                                        | ➖ Atlas has no such library; we own SA token minting (already do)                                                                                                                                    |
| Per-account error node  | **None** — a global "configure credentials" retry node only                                                                      | ❌ Weaker than Atlas's existing per-session nodes; **do better**                                                                                                                                      |

**Net:** Azure gives us the "single aggregation surface + concurrency limiter" pattern to copy,
and a concrete anti-pattern to avoid (`Promise.all` all-or-nothing, no per-account error
surface). Atlas's _existing_ per-session error nodes are already better than Azure's; we
generalise them to per-credential.

---

## 5. Proposed API-level design

### 5.1 Storage — `AtlasCredentialStore` (StorageService, K8s `sourceStore` pattern)

Model each credential as a `StorageItem` under `StorageService.get('atlas-mongodb-discovery')`
in a `credentials` workspace, mirroring [sourceStore.ts](../../../../src/plugins/service-kubernetes/sources/sourceStore.ts):

```ts
interface AtlasCredentialRecordProps extends Record<string, unknown> {
  readonly authMethod: 'apikey' | 'serviceaccount';
  readonly label?: string; // user-supplied friendly name (optional)
  readonly orgId?: string; // cached from first successful listOrgs()
  readonly orgName?: string; // cached; primary display label (see §5.5)
  readonly order: number; // stable display order
  readonly version: '1'; // schema version for future migrations
}
// secrets[] (SecretStorage-backed):
//   apikey        → { publicKey, privateKey }
//   serviceaccount→ { clientId, clientSecret, accessToken?, expiresAt? }
```

- **Stable ID:** a generated `randomUUID()` per credential (like K8s sources). Never derived
  from the secret, so rotating a key keeps the same record ID and the same tree paths / saved
  connections. (Answers POC Q1 + Q6.)
- **No migration:** Atlas discovery has never shipped, so the single-slot keys carry no user
  data; the new store starts clean (matches the ledger's note).
- In-memory cache with explicit invalidation, exactly like `sourceStore`.

### 5.2 Identity & per-credential session

Refactor `AtlasSessionManager` from a **singleton holding one session** into a
**per-credential instance** owned by the store, _or_ keep one manager but key all its state by
`credentialId` (a `Map<credentialId, AtlasSessionState>` + per-credential secret keys). Either
way:

- Each credential restores independently after reload (separate secret slots ⇒ no cross-write).
  (Answers POC Q2.)
- Each credential's SA token refresh is isolated: an expired token on credential A never
  touches credential B. (Answers POC Q3.)
- `AtlasApiClient` is already constructed _per session_
  ([AtlasServiceRootItem.ts#L49](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasServiceRootItem.ts#L49));
  we simply build one per credential.

### 5.3 The single "list everything" aggregation API

```ts
interface CredentialError {
  readonly credentialId: string;
  readonly label: string;
  readonly kind: 'auth' | 'forbidden' | 'rateLimited' | 'network' | 'other';
  readonly status?: number;
  readonly message: string;
  readonly retryable: boolean; // false only for unrecoverable/removed
}

interface AtlasDiscoverySnapshot {
  readonly organizations: Array<AtlasOrganization & { credentialId: string }>;
  readonly projects: Array<AtlasProject & { credentialId: string }>;
  readonly clusters: Array<AtlasCluster & { credentialId: string }>;
  readonly credentialErrors: CredentialError[]; // partial-failure descriptors
  readonly credentialsQueried: number;
}

class AtlasDiscoveryService {
  // Never throws. One call powers both tree modes and the wizard.
  async listAll(signal?: AbortSignal): Promise<AtlasDiscoverySnapshot>;
}
```

Implementation (validated by [Experiment 2](#experiment-2--single-list-all-api-with-per-credential-isolation)):

- Fan out across credentials with a **concurrency limiter (cap ~4–5)** wrapping
  `Promise.allSettled`.
- Within a credential: `listOrgs()` + `listProjects()` (parallel is fine here — they are
  different endpoints and different scopes), then clusters per project (bounded).
- A whole-credential auth failure is captured as a `CredentialError` and does **not** abort the
  fleet. A single project's cluster-list failure is captured at project scope.
- Reuse the existing silent SA-token-refresh-and-retry in `AtlasApiClient.request`
  [AtlasApiClient.ts#L100-L120](../../../../src/plugins/service-atlas-mongodb/api/AtlasApiClient.ts#L100-L120)
  — it already does the "refresh once, retry once, else surface" dance per credential.

### 5.4 Parallel vs sequential — decision

**Parallel across credentials, bounded.** Justification:

- Different credentials = different USER-scoped buckets ⇒ no shared rate limit (§3.4).
- ~8× wall-clock improvement for an 8-credential fleet ([Experiment 3](#experiment-3--parallel-vs-sequential-fan-out)).
- The Azure "sequential to avoid wrong data" gotcha is about `getTenants` vs
  `getSubscriptions` _within one provider_; it does not apply across independent Atlas
  credentials. **Keep org/projects sequencing sane _within_ a credential; parallelise
  _across_ credentials.**
- Cap the fan-out (limiter) purely as defence against a user with dozens of credentials, not
  because Atlas requires it.

### 5.5 Display label (POC Q4)

Atlas exposes **no user profile for Service Accounts** and only a programmatic identity for API
keys. Label resolution order:

1. **User-supplied label** captured in the add/edit webview (item #6) — always wins if present.
2. **Org name** from the first successful `listOrgs()` (cached in `orgName`). Meaningful and
   usually unique per credential — but note two credentials can share one org (§3.1), so the
   org name alone is **not guaranteed unique**; disambiguate with the role/key hint below when
   two labels collide.
3. **Fallbacks:** API key → `publicKey` prefix (e.g. `abcd1234…`); SA → `clientId` prefix.
   Never render the secret.

This also removes the current global `STATE_USER_DISPLAY_NAME`
([config.ts#L38](../../../../src/plugins/service-atlas-mongodb/config.ts#L38)), which is a
single-slot concept that cannot survive multi-credential.

### 5.6 Token-refresh maintenance across the fleet

- **On demand (lazy):** `getSession(credentialId)` checks SA expiry (existing
  [`isExpired`](../../../../src/plugins/service-atlas-mongodb/auth/AtlasSessionManager.ts#L319-L323),
  60 s skew) and mints a fresh token if needed. API keys need nothing.
- **On 401/403 during a request:** existing refresh-once-retry-once in `AtlasApiClient`.
- **No background timer needed:** tokens are only needed at discovery/expand time; minting is
  cheap (one POST) and the `oauth/token` endpoint is separate from the discovery buckets.
  Refreshing all credentials at once is safe (Experiment 4).

### 5.7 Auth-method strategy — offer both, default to Service Account, eye interactive OAuth

Sources: [API Authentication Methods](https://www.mongodb.com/docs/atlas/api/api-authentication/),
[Connect from the Atlas CLI](https://www.mongodb.com/docs/atlas/cli/current/connect-atlas-cli/),
[Rotate Service Account Secrets](https://www.mongodb.com/docs/atlas/tutorial/rotate-service-account-secrets/),
[Terraform provider](https://registry.terraform.io/providers/mongodb/mongodbatlas/latest/docs).

**Decision: keep both programmatic methods; make Service Account the recommended default and
API Key the simple fallback. Do _not_ collapse to a single method.** Rationale, grounded in
how MongoDB's own tools behave:

- MongoDB's own interactive tool (Atlas CLI) offers **three** methods with explicit use cases:
  `UserAccount` (browser device login) — _"best for non-programmatic use"_; `ServiceAccount` —
  programmatic/CI; `APIKeys` — programmatic, _"doesn't require manual login"_. Both the
  Terraform provider and the API docs mark **Service Accounts as recommended** and **API keys
  as a "legacy" method** (not deprecated — still fully supported).
- The two methods have **different lifecycles**, which is the whole reason to keep both:

  |               | Service Account                                                 | API Key                                |
  | ------------- | --------------------------------------------------------------- | -------------------------------------- |
  | Auth          | OAuth2 client_credentials → 1 h token                           | HTTP Digest, no token                  |
  | Secret expiry | **8 h – 365 d** (rotation required; Atlas alerts before expiry) | **Never expires**                      |
  | Posture       | Recommended, short-lived tokens, rotatable                      | Legacy, long-lived password-equivalent |
  | Best fit      | security-conscious / enterprise / org mandates SAs              | set-and-forget personal desktop use    |

- **Why both, not one:** (1) SAs are new (GA ~2024) — a large installed base still uses API
  keys; dropping them strands users. (2) Org policy varies — some orgs disable API-key
  creation, others standardize on them; supporting both means the tool works regardless.
  (3) The two paths **converge into one `AtlasApiClient`** right after auth (Bearer vs Digest
  header — already abstracted), so the second path is near-free. (4) Ecosystem parity — Atlas
  CLI and Terraform both support both.
- **UX obligation this creates:** because the SA client secret expires, the "recommended" path
  must **handle secret expiry gracefully** (detect it, surface a clean "re-enter credentials"
  recovery — the existing per-credential error nodes in §6 already cover this). Otherwise the
  recommended method becomes the more annoying one for a long-lived desktop tool.
- **Strategic note — the "ideal" third path is currently _blocked_, not just deferred:** the
  genuinely best single path for a **human-facing** UI tool would be the interactive
  **`UserAccount` browser-OAuth device flow** (what the Atlas UI and `atlas auth login` use):
  no stored secret, auto-refreshing session, and it spans **all** of the user's orgs/projects
  automatically — which would largely dissolve the multi-credential problem this document
  addresses. **However, there is no official way for a third-party application (this extension)
  to register as an OAuth app with Atlas**, so this flow **cannot be implemented today** — it is
  blocked on MongoDB providing public app registration, not merely on our effort. Until that
  exists, the two programmatic methods above are the only viable options, which is _why_ the
  multi-credential model and its UX ([§7](#7-credential-management--tree-ux-selected-design)) are
  necessary rather than optional.

---

## 6. Error reporting model — partial results with per-credential attribution

This is the crux of the reviewer's concern ("how do we report an error while still returning
all other data?") and the hardest UX question.

### 6.1 The principle

`listAll()` returns **data _and_ errors together**. The tree renders both:

- Healthy credentials → their org/project/cluster branches.
- Each failed credential → a scoped, actionable error node **under that credential's own org
  node** (or, in list mode, a top-level row), reusing the existing
  [`retry`/`update-credentials`/`sign-in` nodes](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasServiceRootItem.ts#L136-L170).

### 6.2 The "no projects → suggest refresh" problem, generalised

Today the logic is simple because there is one session: no projects ⇒ show an info node / suggest
retry ([AtlasServiceRootItem.ts#L96-L114](../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasServiceRootItem.ts#L96-L114)).
With many credentials this must become **per-credential**, and it must distinguish _authoritative
emptiness_ from _failure_ (enabled by §3.4's `200 []` vs `403`/`401`):

| Per-credential outcome   | Tree presentation                                                                                  | Suggest refresh?            |
| ------------------------ | -------------------------------------------------------------------------------------------------- | --------------------------- |
| `ok-with-data`           | org → projects → clusters                                                                          | no                          |
| `ok-empty` (`200`, `[]`) | org node + muted "No projects visible to this credential"                                          | **no** (it's a true answer) |
| `forbidden (403)`        | org node (if known) or credential row + "Access denied — check IP access list / roles" + **retry** | yes                         |
| `auth (401)`             | credential row + "Credentials rejected — update credentials" + **update**                          | yes (via update)            |
| `rateLimited (429)`      | credential row + "Rate limited — retry shortly" (honour `Retry-After`)                             | auto-retry after delay      |
| `network/other`          | credential row + generic + **retry**                                                               | yes                         |

A **fleet-level summary** is only shown when it adds signal, e.g. a status-bar / root
description like _"2 of 4 credentials failed to load"_, so the user notices partial degradation
without a modal per credential. Modals (the item #3 pattern) are reserved for the _single-
credential_ empty case to avoid modal storms.

### 6.3 How Azure answers the same question (and why we go further)

Azure's `getSubscriptions(true)` returns a flat list and, on a per-tenant auth problem, relies
on the auth library to prompt re-sign-in; the extension's own wizard uses `Promise.all` and
**collapses to an empty list on any failure** (§4). Azure's discovery tree shows a _single_
global "configure credentials" node, not per-tenant errors. Our proposal is deliberately
**stronger**: `allSettled` + per-credential error descriptors + per-credential retry nodes, so
one dead credential degrades gracefully instead of blanking the view. [Experiment 1](#experiment-1--aggregation-semantics)
demonstrates the concrete difference.

---

## 7. Credential management & tree UX (selected design)

> **Scope:** happy path **1–4 credential sets**, not 100+; large-fleet concerns (search, grouping,
> virtualization) are out of scope. Earlier tree-view approaches that were considered and
> **dropped** are preserved in §7.7 with the reason for each.

The selected design in one line: **credentials are managed in a QuickPick wizard (kept out of the
tree); the tree and list stay quiet on the happy path; a single `Click here to revisit
credentials` node appears whenever anything is wrong; and refresh simply retries everything.**

### 7.1 Principles (what was chosen)

- **Management lives outside the tree** — an Azure-style QuickPick wizard that launches the
  item-#6 webview to add / edit credentials (§7.2).
- **Quiet tree** — healthy nodes carry **no** `via <method>` descriptions; a cluster shows its
  **state only when it is not `IDLE`** (`Updating…`, `Paused`).
- **One consolidated error node** — on any credential failure the view shows a single actionable
  **`⚠ Click here to revisit credentials`** row. The label is short; the **tooltip** carries the
  detail (which credentials, and why). Clicking opens the management wizard (§7.2).
- **Identical in Tree and List modes** — the same error node appears in both; there is **no**
  view-mode switching or blocking (§7.4).
- **Empty state = the standard `empty` placeholder** already used in the Connections view
  (`$(indent)` icon, label `empty`, detail in the tooltip) — not a sentence (§7.3).
- **Refresh retries everything** — one refresh re-attempts every credential; no modals (§7.5).
- **Every row is a real resource or an action** — no bare informational nodes.

### 7.2 Credential management wizard (QuickPick + webview) — paths & flows

Management mirrors [`configureAzureCredentials`](../../../../src/plugins/api-shared/azure/credentialsManagement/configureAzureCredentials.ts).
Entry points: the discovery root's inline **gear** (the existing `manageCredentials` command),
the root context menu, and the **`Click here to revisit credentials`** error node (§7.3).

**The list (what you have):**

```text
Manage MongoDB Atlas Credentials
──────────────────────────────────────────────────────────
$(key)    Acme Corp — API Key             Signed in
$(cloud)  Beta Ltd — Service Account      ⚠ Secret expired
$(cloud)  Gamma Inc — Service Account     Signed in
──────────────────────────────────────────────────────────
$(add)      Add a credential…
$(sign-out) Sign out of all
$(close)    Exit
```

**Per-credential actions** (select a row → submenu, Azure's `TenantActionStep` shape):

```text
Beta Ltd — Service Account
──────────────────────────────────────────────────────────
$(refresh)    Retry
$(key)        Update credentials…     ▸ opens webview (edit)
$(trash)      Remove                  ▸ deletes only this credential's secrets
$(arrow-left) Back
```

**Add** launches the item-#6 webview, which gains a **method-choice first step** (the reviewer's
request) — the natural home for the "which should I use?" guidance from §5.7:

```text
┌ Add a MongoDB Atlas credential ─────────────────────────────┐
│  How do you want to connect?                                │
│                                                             │
│   ◉  Service Account   (recommended)                        │
│      OAuth2 client ID + secret. More secure; the secret     │
│      expires (8h–365d) and must be rotated periodically.    │
│                                                             │
│   ○  API Key   (legacy · simplest)                          │
│      Public + private key. Never expires — good for a       │
│      personal, set-and-forget setup.                        │
│                                                             │
│                               [ Cancel ]     [ Continue ▸ ] │
└─────────────────────────────────────────────────────────────┘
        │ Continue
        ▼
   Step 2: the method-specific form (existing AtlasCredentialsView),
           with inline "where to find this in Atlas" help + validation.
```

Keeping the chooser **inside** the webview (not a separate QuickPick) makes the whole add-flow one
guided surface, and lets the toggle live-swap the form fields + help text.

**Add flow (happy path + failure):**

```mermaid
flowchart TD
    Q["Manage Credentials QuickPick"] -->|"Add a credential…"| W1["Webview · choose method"]
    W1 -->|"Continue"| W2["Webview · enter secret, submit"]
    W2 --> V{"Validate host-side<br/>(listProjects)"}
    V -->|"200 OK"| OK["Store credential · toast · tree refreshes"]
    V -->|"401 / 403 / network"| ERR["Inline MessageBar in webview<br/>secret retained · webview stays open"]
    ERR -->|"correct & resubmit"| W2
    ERR -->|"close webview"| CX["Cancelled · nothing stored"]
```

- **Validation is host-side before storing** (§5.3): a Service Account that can mint a token but
  cannot `listProjects` is still rejected with an inline hint, so we never store a credential that
  cannot discover anything.
- **Failure keeps the webview open** with the entered secret retained, so the user fixes the
  Atlas-side issue (roles / IP access list) and resubmits — no restart.
- **Cancel / close stores nothing** and leaves any previously-working credential untouched.

**Recover an existing credential (from the error node):**

```mermaid
flowchart LR
    N["Tree/List: ⚠ Click here to revisit credentials"] --> Q["Manage Credentials QuickPick<br/>(failed credentials flagged)"]
    Q -->|"pick failed credential"| A["Retry · Update · Remove"]
    A -->|"Retry"| RT["re-run listAll for it · clears on success"]
    A -->|"Update credentials…"| WV["webview (edit) → validate → replace secret"]
    A -->|"Remove"| RM["drop credential · its nodes disappear"]
```

- **Update** replaces the stored secret only **after** the new one validates, so a failed update
  never destroys the previous working credential (§5.2, item #12). The Public Key or Client ID is
  the immutable identity of the record: edit mode displays that field disabled and allows only the
  Private Key or Client Secret to rotate. To use a different identity, remove the old entry and add
  a new credential.
- **Remove** deletes only that credential's secrets and its tree nodes; other credentials are
  untouched.
- **Sign out of all** clears every credential after a single confirm.

### 7.3 Tree mode — the quiet tree

The org level is the natural top level (each credential resolves to one org; §3.1); projects merge
across credentials by `orgId` (§3.1, §8 Q5). On the happy path the tree is **pure structure** — no
descriptions, cluster state shown only when it is not `IDLE`:

```text
🌩 MongoDB Atlas
├─ 🏢 Acme Corp
│  └─ 📁 Payments
│     └─ 🍃 payments-prod
├─ 🏢 Beta Ltd
│  ├─ 📁 Web
│  │  └─ 🍃 web-cluster
│  └─ 📁 Analytics
│     └─ 🍃 analytics-rs        Updating…    ← state shown only when not IDLE
└─ 🏢 Gamma Inc
   └─ 📁 Research
      └─ 🍃 research-flex
```

**On any credential failure — one node, not many.** All failing credentials collapse into a single
top row; the detail lives in its tooltip and in the wizard it opens:

```text
🌩 MongoDB Atlas
├─ ⚠ Click here to revisit credentials     ← tooltip: "2 credentials need attention:
├─ 🏢 Acme Corp                                Beta (session expired), Gamma (access denied)"
│  └─ 📁 Payments
│     └─ 🍃 payments-prod
└─ 🏢 Gamma Inc
   └─ 📁 Research
      └─ 🍃 research-flex
```

**Partially-affected org** (two credentials for one org, one fails). The org keeps rendering its
healthy projects; a **warning icon only** (no description) marks it, and the single error node
handles recovery:

```text
├─ 🏢 Acme Corp  ⚠          ← tooltip: "Some projects may be hidden — a credential for
│  ├─ 📁 Payments              this org needs attention. Click 'revisit credentials'."
│  └─ 📁 Web
```

- **≥ 1 healthy credential for the org** → it renders its (partial) merged projects + the warning
  icon; the error node handles recovery.
- **No healthy credential for the org** → its data is absent; only the error node represents it.
- **Attribution** uses the failed credential's **cached** `orgId`/`orgName` (§5.1); a project both
  credentials can see is deduped by `projectId` (§8 Q5).

**Empty** (a credential authenticates but sees no projects, `200 []`). Reuse the **`empty`
placeholder** from an empty folder in the Connections view — `$(indent)` icon, label `empty`,
explanation in the tooltip — nothing more:

```text
├─ 🏢 Delta Co
│  └─ $(indent) empty       ← tooltip: "This credential can't see any projects yet.
│                              Check its project access / roles in Atlas."
```

### 7.4 List mode — same error node, no switch

List mode (item #8) flattens to clusters with `org · project` in the description — that context
**stays** (it is useful). The quiet-tree rules apply equally: no per-cluster noise, and the **same**
`Click here to revisit credentials` node sits at the top when anything fails. No view switching, no
blocking.

**Happy path:**

```text
🌩 MongoDB Atlas   ☰ List
├─ 🍃 payments-prod    Acme Corp · Payments
├─ 🍃 web-cluster      Beta Ltd · Web
├─ 🍃 analytics-rs     Beta Ltd · Analytics     Updating…
└─ 🍃 research-flex    Gamma Inc · Research
```

**With a failure — identical error node, in place:**

```text
🌩 MongoDB Atlas   ☰ List
├─ ⚠ Click here to revisit credentials     ← same node as Tree mode; same tooltip + action
├─ 🍃 payments-prod    Acme Corp · Payments
└─ 🍃 research-flex    Gamma Inc · Research
```

Because the error node is just another row, List mode needs no special-casing — the earlier
"force Tree / disable List" workaround is dropped (§7.7). The empty state uses the same `empty`
placeholder as Tree mode.

### 7.5 Refresh & retry behavior

**Refresh retries everything.** A tree refresh re-runs `listAll()` across **all** credentials —
healthy and failed alike — and re-renders. No modals, no per-credential prompts: one click, whole
fleet re-attempted.

**Accepted trade-off.** Elsewhere the design deliberately gates retries behind the explicit error
node, so a persistently-failing credential is not hammered on every tree expansion. A manual
**refresh** intentionally bypasses that gate and retries all — including credentials the user has
not touched. For the 1–4 credential happy path this is fine: a refresh is a deliberate action, and
the cost is a handful of requests against independent per-credential rate buckets (§3.4). We accept
it as a **niche** trade-off rather than tracking per-credential retry-eligibility through a manual
refresh.

- **On expand / passive load** — a failed credential stays collapsed behind its error node and is
  **not** silently re-attempted (prevents retry storms).
- **On explicit refresh** — everything is re-attempted (the user asked for it).
- **On the error node → Retry** — only that one credential is re-attempted (§7.2).

### 7.6 Scenario catalog — what renders

At happy-path scale every state maps to a small set of renderings (building on §6.2). The
"two credentials, one org, one fails" case (§7.3) is the only one that keeps an org **partially**
visible; all other failures collapse to the single error node.

| Scenario                                | Tree mode                                                                | List mode                                       |
| --------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------- |
| all healthy                             | org → project → cluster (quiet)                                          | flat clusters, `org · project`                  |
| a cluster not `IDLE`                    | state shown on that cluster only                                         | state in the row                                |
| a credential `200 []` (no projects)     | org → `empty` placeholder                                                | (org absent from a flat list)                   |
| any credential `401` / `403` / network  | one `⚠ Click here to revisit credentials` node                           | the same node, at the top                       |
| one org, 2 creds, one fails             | org renders its healthy projects + **warning icon**; plus the error node | clusters from the healthy cred + the error node |
| org reachable via no healthy credential | its data is absent; plus the error node                                  | absent; plus the error node                     |
| whole fleet failed                      | only the error node under the root                                       | only the error node                             |

The error node's **tooltip** always enumerates the affected credentials and reasons; the **label**
never changes (`Click here to revisit credentials`), so the view stays quiet no matter how many
credentials failed.

### 7.7 Archive — tree-view approaches considered and dropped

Kept for the record. Each was viable; the operator chose the quieter model above.

**A1 — Verbose merged tree (descriptions + per-credential inline attention nodes).** The original
form of §7.3: healthy nodes carried `via API Key` / `via Service Account`, the root description
counted failures, and each failed credential expanded into its own attention node with child
**retry** + **update credentials** rows:

```text
🌩 MongoDB Atlas                         2 of 3 credentials need attention
├─ 🏢 Acme Corp                          via API Key
│  └─ 📁 Payments
│     └─ 🍃 payments-prod   IDLE
├─ ⚠ Beta Ltd — session expired          Service Account
│  ├─ ↻  Click here to retry
│  └─ 🔑 Click here to update credentials
└─ ⚠ Gamma Inc — access denied           Service Account
   └─ ↻  Click here to retry             (check IP access list / roles)
```

**Why dropped:** description noise — warnings accumulated across the root description **and** every
affected node **and** child action rows. Superseded by the single `Click here to revisit
credentials` node + tooltip (§7.3), with recovery handled in the wizard. _(In-situ recovery nodes
remain a possible progressive-disclosure enhancement — expand the single node into these on click
— but are not the default.)_

**A2 — List mode: auto-switch to Tree + disable List on error.** An earlier version of List mode
treated a flat
list as unable to host an error, so any failure forced Tree mode and greyed out the List toggle:

```text
🌩 MongoDB Atlas   ☰ List (unavailable)   2 of 3 credentials need attention
   ⓘ Switched to Tree view — resolve the flagged credentials to re-enable List view.
```

**Why dropped:** it was a "magic switch" — the layout changed under the user. Because the
consolidated error node is just another row, it drops into a flat list unchanged (§7.4), so List
mode needs no special-casing at all.

**A3 — Separate "group by credential" view mode, and a permanent credential level.** Considered
early and dropped before this iteration: a second toggle duplicated the existing item-#8 Tree/List
toggle, and a permanent credential root (a connection-manager level) added a hop the common
1-credential user never needed and duplicated the wizard. The org-keyed merged tree (§7.3) plus the
wizard (§7.2) cover both goals without either.

**A4 — Actionable deep-link empty node.** An earlier iteration proposed replacing the bare
"No projects visible" row with an actionable `🔗 Grant this credential access to a project…`
deep-link into the Atlas console (plus variants: fold into the parent tooltip, surface in the
wizard, or merge into the error node).

**Why dropped:** the operator chose the **existing `empty` placeholder** convention instead
(Connections view: `$(indent)` icon, label `empty`, detail in the tooltip; §7.3) — a deep-link URL
cannot always be constructed reliably, whereas `empty` is a known, quiet pattern already used in
the extension. The permissions hint lives in the tooltip.

---

## 8. Answers to the seven POC questions (ledger §Step 0)

1. **Stable non-secret ID + secrets in SecretStorage via StorageService?** ✅ Yes — `randomUUID`
   record ID, secrets in `secrets[]`, exactly the K8s `sourceStore` shape (§5.1).
2. **Independent restore after reload without cross-overwrite?** ✅ Yes — per-credential secret
   slots keyed by ID replace the fixed single-slot keys (§5.1–5.2).
3. **Independent per-credential discovery incl. SA token refresh, no global session?** ✅ Yes —
   per-credential session + per-credential `AtlasApiClient`; refresh isolated (§5.2, §5.6).
4. **Stable user-facing label without a user profile (esp. SA)?** ✅ Org name (cached) with
   user-label override and key/clientId-prefix fallback (§5.5).
5. **Duplicate org/project/cluster across credentials — merge, once+attribution, or per
   credential?** → **This is now a first-class case, not a rare one:** two least-privilege
   credentials can belong to the **same org** and expose overlapping or disjoint project subsets
   (§3.1). **Recommended:** key every resource by its Atlas ID (`orgId` / `projectId` /
   `clusterId`); the org node is keyed by `orgId` and its project children are the **union**
   across all credentials resolving to that org, deduped by `projectId`; each merged node
   remembers the **set of credentials** that can reach it and picks the first healthy one as the
   action owner. In **list mode / wizard**, dedup clusters by `clusterId` (or SRV string) the
   same way. Alternative (simpler for POC): no merge, group strictly per credential — accept that
   the same org/project may appear under two credentials. (See [alternatives](#12-alternatives).)
6. **Which credential owns a node / subsequent request, retained through refresh/retry/connect?**
   ✅ Every snapshot row carries `credentialId`; tree items store it; the wizard threads it into
   connection creation. Stable because the ID is secret-independent (§5.1).
7. **One valid + one expired/denied/removed — failure must not hide others.** ✅ `allSettled`
   aggregation with per-credential `CredentialError`; proven by [Experiment 1](#experiment-1--aggregation-semantics)
   and [Experiment 2](#experiment-2--single-list-all-api-with-per-credential-isolation).

---

## 9. Reference architecture (diagram)

```mermaid
flowchart TD
    Store["AtlasCredentialStore<br/>StorageService: N records"] --> Svc["AtlasDiscoveryService.listAll"]
    Svc -->|"Promise.allSettled + limiter cap ~5"| C1["Credential 1<br/>session + AtlasApiClient"]
    Svc --> C2["Credential 2 ..."]
    Svc --> Cn["Credential N"]
    C1 -->|"orgs + projects + clusters, or error"| Agg["Snapshot<br/>organizations / projects / clusters<br/>+ credentialErrors"]
    C2 --> Agg
    Cn --> Agg
    Agg --> Merge["Merge by Atlas ID<br/>orgId / projectId / clusterId<br/>(union across credentials)"]
    Merge --> Tree["Tree: org -> project -> cluster<br/>each node remembers owning credential(s)<br/>+ per-credential retry/update nodes"]
    Merge --> Wizard["Add-connection wizard<br/>dedup clusters by id"]
```

---

## 10. Experiments

### 10.1 Experiments performed in isolation (no live account, no secrets)

Run with `node experiment.mjs` (throwaway script kept out of the repo). Full script text is in
[Appendix A](#appendix-a--experiment-script). Verbatim results:

#### Experiment 1 — aggregation semantics

Models a fleet of 4 credentials (2 API keys + 2 SAs) with one 403 and one 401.

```
Promise.all         → {"ok":false,"reason":"401 Token expired / client secret rotated"}
Promise.allSettled  → {"orgs":2,"healthy":["Acme","Gamma"],
                       "failures":[{credentialId:k2,403},{credentialId:s2,401}]}
```

**Finding:** `Promise.all` loses _all_ data on the first rejection; `allSettled` yields the two
healthy orgs **and** two per-credential error descriptors. Validates §6.

#### Experiment 2 — single "list all" API with per-credential isolation

```
Aggregated in 140ms → {"orgs":["Acme","Gamma"],"projects":4,"clusters":4,
                        "errors":["credential:s2 (401)","credential:k2 (403)"]}
```

**Finding:** healthy credentials expand fully (2 orgs → 4 projects → 4 clusters); broken ones
surface as credential-scoped errors; **no throw escapes** `listAll()`. Validates §5.3.

#### Experiment 3 — parallel vs sequential fan-out

8 healthy credentials, 100 ms simulated latency each.

```
Sequential: 1604ms   Parallel(cap8): 201ms   speedup: 8.0x
```

**Finding:** parallel fan-out is ~8× faster; safe because USER-scoped buckets are
per-credential. Validates §5.4.

#### Experiment 4 — token-bucket headroom

```
4 credentials, one full "refresh all" = 1 /orgs + 1 /groups token PER credential (separate buckets).
50 back-to-back refreshes = 50/300 /orgs and 50/1200 /groups per credential — far below capacity.
```

**Finding:** rate limiting is a non-issue for discovery; the limiter and 429 handling are
defensive only. Validates §3.4.

### 10.2 Experiments requiring a live Atlas account

These cannot be run autonomously because the security policy forbids routing secrets. The
operator completed the blocking API-key and Service Account scope checks on 2026-07-25.

| #   | Hypothesis to confirm                                                                                                                                            | Method                                                                                                                                                                            | Status                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| L1  | A credential belongs to exactly one org; `/groups` returns only the project subset its roles allow (all for `ORG_OWNER`/`ORG_READ_ONLY`, else explicit projects) | Create keys in 2 orgs + a scoped `ORG_MEMBER` key; call `/orgs` and `/groups` with each; confirm 1 org each and the expected project subset                                       | **Passed:** different-org, same-org subset, healthy-empty, and Service Account parity observed |
| L2  | A valid credential rejected by an **enforced** API Access List returns **403**, not 401                                                                          | Enable the organization's API-access-list requirement or add a non-matching entry, omit the caller IP, and probe list plus detail calls for organizations, projects, and clusters | **Passed:** controlled non-match `403`, matching-IP `200`, and invalid-secret `401` observed   |
| L3  | `>100` projects paginate as documented via `links.next`                                                                                                          | **Not planned:** a representative live account is not feasible; implement pagination from the API contract and cover it with mocked multi-page tests instead                      | Mocked contract coverage required                                                              |
| L4  | SA token mint under concurrent refresh has no surprising throttle on `oauth/token`                                                                               | **Telemetry-deferred:** do not manufacture live load; instrument production token-mint throttling/failures and review observed frequency                                          | Production telemetry required                                                                  |
| L5  | Two least-privilege credentials in the **same** org expose overlapping/disjoint project subsets (merge/union path)                                               | Add 2 scoped keys to 1 org with different project roles; run `listAll()`; confirm the union merges by `projectId`                                                                 | **Passed:** overlapping and disjoint project sets produced the expected deduplicated union     |

> **Conclusion:** L1, L2, and L5 close the live feasibility gates. Proceed with production
> implementation and automated acceptance coverage. L3 will not be run live; use mocked
> pagination contract tests. L4 will be observed through privacy-reviewed production telemetry
> around token-mint throttling/failure classification instead of a synthetic live stress test.

#### Live evidence recorded 2026-07-25

The submitted reports cover these exact combinations. Resource identifiers below refer to the
stable fingerprints in the sanitized reports; no raw Atlas identifiers or secrets are recorded.

| Evidence | Organization/project setup                                                          | API Access List setup                                                 | Endpoint result                                                                                                                                     | Verdict                                                                                                               |
| -------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| L1-01    | Org-wide API keys in two organizations; two projects in organization A and one in B | Not under test                                                        | Each key returned one different organization; all organization/project details succeeded; cluster list/detail succeeded where a cluster existed     | **Passed:** different-organization attribution and detail retrieval                                                   |
| L1-02    | Org-wide key, one-project key, and no-project key in organization A                 | Not under test                                                        | All shared one org fingerprint; visible project counts were 2, 1, and 0; union contained two projects and overlap contained only the scoped project | **Passed:** role subset, overlap, deduplication, and healthy `200 []` emptiness                                       |
| L1-03    | Two scoped API keys in organization A, each assigned a different project            | Not under test                                                        | Each returned one distinct project under the same organization; union contained both and overlap was empty                                          | **Passed:** disjoint same-org union                                                                                   |
| L1-04    | API key and Service Account assigned the same project                               | Not under test                                                        | Both returned the same organization and project fingerprints; organization/project details and zero-result cluster lists succeeded                  | **Passed:** Service Account scope parity; cluster detail parity remains optional because this project had no cluster  |
| L2-01    | Org-wide API key with two projects                                                  | Empty API Access List while the organization requirement was disabled | Organization/project list and detail calls returned `200`; cluster list/detail returned `200` where data existed                                    | **Passed baseline:** empty non-required list is unrestricted; no detail-only restriction exists in the accepted state |
| L2-02    | Same valid key and roles as baseline                                                | Organization requirement enabled; only a non-matching IP allowed      | Both `/orgs` and `/groups` returned `403`; dependent detail and cluster probes could not run because no IDs were returned                           | **Passed rejection:** enforced non-match is forbidden, not authentication failure                                     |
| L2-03    | Same valid key and roles                                                            | Actual caller IP allowed                                              | All organization/project list and detail probes returned `200`; cluster list/detail returned `200` where data existed                               | **Passed recovery control:** changing only the allowlist restored access                                              |
| L2-04    | Same public key with intentionally invalid private key; caller IP allowed           | Matching IP                                                           | `/orgs` and `/groups` returned `401`                                                                                                                | **Passed auth control:** invalid credentials are distinguishable from enforced-list `403`                             |

#### L1/L2 assumption verdicts

- **Verified:** an API key in each tested organization returned exactly one organization.
- **Verified:** credentials from different organizations returned different organization
  fingerprints and independently attributed projects.
- **Verified:** project visibility is role-filtered; org-wide, one-project, disjoint-project, and
  no-project (`200 []`) scopes returned the expected subsets and deduplicated union.
- **Verified:** API-key and Service Account credentials with equivalent roles returned the same
  organization and project scope.
- **Disproved:** "caller IP absent from an empty API Access List" is sufficient to test rejection.
  It is unrestricted while the organization requirement is disabled.
- **Disproved:** no project membership should surface as `401` or `403`; the observed response is
  healthy `200 []`.
- **Verified for the controlled L2 run:** changing only the enforced allowlist produced `403`,
  and allowing the caller restored `200`. Production must still retain the generic
  `forbidden(403)` classification because unrelated role/authorization failures can also be
  forbidden.
- **Disproved in the accepted state:** list calls and their follow-up detail calls all succeeded;
  no detail-only restriction was observed. Under enforced rejection the list calls failed before
  resource IDs were available, so dependent detail calls were intentionally not attempted.

#### Residual live matrix

| Priority                | Combination                              | Minimum setup and expected evidence                                                                                                                                    | Purpose                                                                             |
| ----------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Optional parity**     | Service Account enforced non-match/match | Repeat L2-02 and L2-03 with the tested Service Account. Token mint may succeed while Admin API calls return `403`; allowing the caller should restore `200`.           | Confirms Service Account behavior through the Administration API refresh/retry path |
| **Optional parity**     | Service Account cluster detail           | Give the tested Service Account access to a project containing a cluster and rerun L1.                                                                                 | Exercises the only successful detail surface not reached in L1-04                   |
| **Optional diagnostic** | Authorization-forbidden detail call      | With a known resource ID outside a valid credential's role scope, call a detail endpoint and record `403`/`404`. Do not interpret either as IP-specific in production. | Documents provider behavior but does not block the generic forbidden UX             |

No remaining live check blocks implementation. The first two rows are recommended production
acceptance coverage; the final row is informational only.

---

## 11. Effort estimate, decision gates & scrap criteria

### 11.1 Effort (relative)

| Slice | What                                                                                                                            | Size |
| ----- | ------------------------------------------------------------------------------------------------------------------------------- | ---- |
| A     | `AtlasCredentialStore` on StorageService (copy `sourceStore`)                                                                   | S–M  |
| B     | Per-credential session/token refactor of `AtlasSessionManager`                                                                  | M    |
| C     | `AtlasDiscoveryService.listAll` aggregation + pagination fix                                                                    | M    |
| D     | Tree: `orgId`-keyed org nodes merging projects across credentials + per-credential error/retry nodes (list mode later, item #8) | M    |
| E     | Manage-credentials QuickPick (Azure-style) + wire to add/edit webview (item #6)                                                 | M    |
| F     | Wizard: dedup + credential attribution through connect                                                                          | S–M  |
| G     | Tests (unit for store/aggregation/error taxonomy) + l10n                                                                        | M    |

No slice is "L". The refactor (B) touches the most files but is mechanical (single-slot →
keyed-by-ID). The aggregation (C) is the intellectually load-bearing piece and is already
prototyped here.

### 11.2 Decision gates (build only if all hold)

1. **L1 passed:** each tested credential mapped to one org with stable role-authorized project
   subsets; same-org overlap/disjoint union and Service Account parity were observed.
2. **L2 passed:** enforced non-match `403`, matching-IP `200`, invalid-secret `401`, and healthy
   `200 []` emptiness are empirically distinguishable.
3. **Product direction confirmed:** keep multiple organizations visible simultaneously through
   the selected multi-credential design.

**Blocking open questions: none.** L3 mocked pagination coverage, L4 production telemetry, and
the residual Service Account parity checks are implementation or acceptance work; they do not
block starting slices A–C.

### 11.3 Scrap / de-scope criteria

- If L1 shows credentials cannot be stably attributed to an org **and** the same-org merge
  proves messy, **de-scope item #8's org tree** and ship item #7 as a flat, per-credential
  cluster list only.
- If the manage-credentials UX (E) balloons, ship the **store + aggregation (A–C)** behind the
  existing single-session UX first (invisible internal refactor), then add multi-credential UI
  as a fast follow. A–C alone fixes the pagination bug and the all-or-nothing risk with zero
  UX surface, so it is low-regret even if the feature is later cut.
- If none of the above and effort still feels disproportionate to demand, **scrap** — the
  single-credential path already works and this document is the sunk cost, not the UI.

---

## 12. Alternatives considered

1. **Keep one global session, add a "switch credential" command.** Cheapest, but defeats the
   reviewer's goal (see many orgs _at once_) and keeps the single-slot storage. Rejected as the
   primary path; acceptable **fallback** if item #8 is de-scoped.
2. **No merge, always per-credential grouping.** Simplest aggregation (skip the union in Q5):
   render each credential's org/project/cluster subtree independently, so the same org/project
   may appear more than once when credentials share an org. Good **POC-stage** choice to defer
   the merge; promote to the ID-keyed union (§8 Q5) once L5 confirms same-org overlap in practice.
3. **Bespoke secret store instead of `StorageService`.** Rejected — reinvents the K8s solution,
   more migration risk, no upside.
4. **Background token-refresh timer.** Rejected — lazy refresh at expand time is sufficient and
   avoids a lifecycle to manage (§5.6).
5. **Sequential fan-out** (Azure-style, for "safety"). Rejected — 8× slower for no benefit;
   the Azure ordering gotcha doesn't apply across independent credentials (§5.4).

---

## 13. Next actions

1. Land **slices A–C** as an internal refactor (no UX change): credential store,
   per-credential sessions, `listAll()` with pagination + `allSettled`. This is low-regret and
   independently valuable.
2. Then build the manage-credentials QuickPick (E) + wire the item-#6 webview, followed by the
   tree work (D) and item #8 modes.
3. Add the mocked L3 pagination contracts and L4 production telemetry while implementing the
   corresponding slices; treat residual Service Account L2/detail checks as acceptance coverage.

---

## Appendix A — experiment script

The isolated experiment (no secrets, no network) used for §10.1. Kept out of the repo; reproduced
here for auditability. Run with `node experiment.mjs` on Node ≥ 18.

```js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A tiny copy of src/utils/concurrencyLimiter.ts
function createConcurrencyLimiter({ concurrency }) {
  const cap = Number.isFinite(concurrency) ? Math.max(1, Math.floor(concurrency)) : 1;
  let active = 0;
  const waiters = [];
  const release = () => {
    active--;
    const resume = waiters.shift();
    if (resume) resume();
  };
  return async (fn) => {
    if (active >= cap) await new Promise((res) => waiters.push(res));
    active++;
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

class ApiError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

function makeCredential({ id, kind, orgName, latencyMs = 60, fail }) {
  return {
    id,
    kind,
    label: orgName ? `${orgName} (${kind})` : id,
    async listOrgs() {
      await sleep(latencyMs);
      if (fail) throw fail();
      return [{ id: `${id}-org`, name: orgName ?? `${id}-org` }];
    },
    async listProjects() {
      await sleep(latencyMs);
      if (fail) throw fail();
      return [
        { id: `${id}-p1`, name: `${orgName}-proj-A`, orgId: `${id}-org` },
        { id: `${id}-p2`, name: `${orgName}-proj-B`, orgId: `${id}-org` },
      ];
    },
    async listClusters(projectId) {
      await sleep(latencyMs);
      if (fail) throw fail();
      return [{ id: `${projectId}-c1`, name: `${projectId}-cluster` }];
    },
  };
}

// Fleet: 2 API keys + 2 Service Accounts, one of each broken (403 / 401).
function makeFleet() {
  return [
    makeCredential({ id: 'k1', kind: 'apikey', orgName: 'Acme', latencyMs: 50 }),
    makeCredential({
      id: 'k2',
      kind: 'apikey',
      orgName: 'Beta',
      latencyMs: 40,
      fail: () => new ApiError('Access denied (IP access list)', 403),
    }),
    makeCredential({ id: 's1', kind: 'serviceaccount', orgName: 'Gamma', latencyMs: 70 }),
    makeCredential({
      id: 's2',
      kind: 'serviceaccount',
      orgName: 'Delta',
      latencyMs: 30,
      fail: () => new ApiError('Token expired / client secret rotated', 401),
    }),
  ];
}

// EXPERIMENT 1 — Promise.all (all-or-nothing) vs Promise.allSettled (partial success)
async function experiment1() {
  const fleet = makeFleet();
  let a;
  try {
    const orgs = await Promise.all(fleet.map((c) => c.listOrgs()));
    a = { ok: true, orgs: orgs.flat().length };
  } catch (err) {
    a = { ok: false, reason: `${err.statusCode ?? ''} ${err.message}`.trim() };
  }
  console.log('Promise.all        →', JSON.stringify(a));

  const settled = await Promise.allSettled(fleet.map((c) => c.listOrgs()));
  const orgs = [],
    failures = [];
  settled.forEach((res, i) => {
    const cred = fleet[i];
    if (res.status === 'fulfilled') orgs.push(...res.value.map((o) => ({ ...o, credentialId: cred.id })));
    else
      failures.push({
        credentialId: cred.id,
        label: cred.label,
        error: res.reason.message,
        status: res.reason.statusCode,
      });
  });
  console.log(
    'Promise.allSettled →',
    JSON.stringify({ orgs: orgs.length, healthy: orgs.map((o) => o.name), failures }),
  );
}

// EXPERIMENT 2 — single "list all" API: never throws, returns data + per-credential errors
async function aggregateAll(fleet, { credentialConcurrency = 4, perCredConcurrency = 4 } = {}) {
  const credLimit = createConcurrencyLimiter({ concurrency: credentialConcurrency });
  const result = { orgs: [], projects: [], clusters: [], errors: [] };
  await Promise.all(
    fleet.map((cred) =>
      credLimit(async () => {
        try {
          const [orgs, projects] = await Promise.all([cred.listOrgs(), cred.listProjects()]);
          orgs.forEach((o) => result.orgs.push({ ...o, credentialId: cred.id }));
          const clusterLimit = createConcurrencyLimiter({ concurrency: perCredConcurrency });
          await Promise.all(
            projects.map((p) =>
              clusterLimit(async () => {
                result.projects.push({ ...p, credentialId: cred.id });
                try {
                  const clusters = await cred.listClusters(p.id);
                  clusters.forEach((c) => result.clusters.push({ ...c, projectId: p.id, credentialId: cred.id }));
                } catch (err) {
                  result.errors.push({
                    scope: 'project',
                    credentialId: cred.id,
                    projectId: p.id,
                    error: err.message,
                    status: err.statusCode,
                  });
                }
              }),
            ),
          );
        } catch (err) {
          result.errors.push({
            scope: 'credential',
            credentialId: cred.id,
            label: cred.label,
            error: err.message,
            status: err.statusCode,
          });
        }
      }),
    ),
  );
  return result;
}
async function experiment2() {
  const fleet = makeFleet();
  const t0 = Date.now();
  const agg = await aggregateAll(fleet);
  console.log(
    `Aggregated in ${Date.now() - t0}ms →`,
    JSON.stringify({
      orgs: agg.orgs.map((o) => o.name),
      projects: agg.projects.length,
      clusters: agg.clusters.length,
      errors: agg.errors.map((e) => `${e.scope}:${e.credentialId} (${e.status})`),
    }),
  );
}

// EXPERIMENT 3 — parallel vs sequential wall-clock (healthy fleet of 8)
async function experiment3() {
  const healthy = Array.from({ length: 8 }, (_, i) =>
    makeCredential({ id: `c${i}`, kind: i % 2 ? 'apikey' : 'serviceaccount', orgName: `Org${i}`, latencyMs: 100 }),
  );
  const tSeq = Date.now();
  for (const c of healthy) {
    await c.listOrgs();
    await c.listProjects();
  }
  const seqMs = Date.now() - tSeq;
  const tPar = Date.now();
  await aggregateAll(healthy, { credentialConcurrency: 8 });
  const parMs = Date.now() - tPar;
  console.log(`Sequential: ${seqMs}ms   Parallel(cap8): ${parMs}ms   speedup: ${(seqMs / parMs).toFixed(1)}x`);
}

// EXPERIMENT 4 — token-bucket headroom (USER scope is per-credential)
function experiment4() {
  const ORGS_CAPACITY = 300,
    GROUPS_CAPACITY = 1200,
    credentials = 4;
  console.log(
    `With ${credentials} credentials, one refresh spends 1 /orgs + 1 /groups token per credential (separate USER buckets).`,
  );
  console.log(
    `50 back-to-back refreshes = 50/${ORGS_CAPACITY} /orgs and 50/${GROUPS_CAPACITY} /groups per credential — far below capacity.`,
  );
}

await experiment1();
await experiment2();
await experiment3();
experiment4();
```

_Prepared as the Step-0 feasibility POC for MongoDB Atlas multi-credential discovery
(review items #7/#8/#12). Isolated experiments executed 2026-07-24. Live API-key evidence on
2026-07-25 partially verified L1 and established healthy-empty/unrestricted-list behavior, while
same-org aggregation, enforced-list L2 controls, detail probes, and Service Account parity remain
open. L3 is not planned as a live test; L4 is telemetry-deferred._
