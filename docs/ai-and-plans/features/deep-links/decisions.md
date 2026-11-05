---
feature: deep-links
kind: decisions
status: active
prs: [898]
created: 2026-08-24
---

# Deep Links — Decisions

> The decisions that shaped the deep-link vocabulary, and what was rejected on the way.

| #    | Decision                                            | Status              | Changed from the proposal?                    | Date       | PR   |
| ---- | --------------------------------------------------- | ------------------- | --------------------------------------------- | ---------- | ---- |
| 0001 | The action goes in the path, not the query          | Accepted            | Accepted as proposed                          | 2026-08-24 | #898 |
| 0002 | An empty path means `connect`, forever              | Accepted            | Accepted as proposed                          | 2026-08-24 | #898 |
| 0003 | The action list is hand-written, never the registry | Accepted            | Raised from an implementation note to a rule  | 2026-08-24 | #898 |
| 0004 | `local` names the product, not the internal command | Accepted            | Retained during maintainer review             | 2026-08-24 | #898 |
| 0005 | `local` opens the wizard without a confirmation     | Superseded by D0007 | Reversed after maintainer review              | 2026-08-24 | #898 |
| 0006 | Local links model the resource type                 | Accepted            | Added during maintainer review                | 2026-09-01 | #898 |
| 0007 | Local links show one lightweight confirmation       | Accepted            | Reversed 0005 during maintainer review        | 2026-09-01 | #898 |
| 0008 | Azure resource links use `/connect/azure`           | Accepted            | Renamed from `/discovery/azure` by maintainer | 2026-11-05 | —    |
| 0009 | Azure links resolve through our Discovery tree      | Accepted            | Accepted as proposed                          | 2026-11-05 | —    |
| 0010 | The resource ID selects vCore or RU; we handle both | Accepted            | Accepted as proposed                          | 2026-11-05 | —    |
| 0011 | Azure links change visibility filters permanently   | Accepted            | Changed from a session-only proposal          | 2026-11-05 | —    |
| 0012 | Azure links confirm like `/local`                   | Accepted            | Accepted as proposed                          | 2026-11-05 | —    |
| 0013 | `open=` names the surface; `dashboard` always opens | Accepted            | Override of the setting added by maintainer   | 2026-11-05 | —    |
| 0014 | `open=` applies to `/connect` as well               | Accepted            | Accepted as proposed                          | 2026-11-05 | —    |
| 0015 | An Azure link always expands the cluster node       | Accepted            | Orchestrator's collapsed variant reversed     | 2026-11-05 | —    |

> Entries below are **semantically** immutable: append new entries rather than rewriting old ones,
> and record reversals as a new entry plus a status change above. Heading text is frozen once
> written — a retitle means a new decision.

**Status vocabulary** (closed set of seven):

`Proposed` · `Open` · `Accepted` · `Accepted (modified)` · `Deferred` · `Superseded by D#` ·
`Rejected`

---

## 0001 — The action goes in the path, not the query

**Status:** Accepted · **Date:** 2026-08-24 · **Raised by:** maintainer request for "a command switch … with some good nomenclature"

### Question

The handler could only connect. To do anything else — open the DocumentDB Local wizard, later reach
a discovery plugin — a link needs to name an action. Where does that name live?

### Decision

In the path: `vscode://ms-azuretools.vscode-documentdb/<action>?<parameters>`.

### Reasoning

The query answers _how_ to perform an action. Putting _which_ action in the same bag means every
future reader has to know which keys are the verb and which are its arguments, and the distinction
is invisible in the URL itself.

The path also gives the discovery plugins somewhere to live. The handler's original JSDoc already
anticipated them — "other modes … will be handled by our discoverability plugins" — and there are
five. `/discovery/<provider>` is a natural sub-route; `?action=discovery&provider=…` is a flat
namespace pretending to be a hierarchical one.

It matches how other VS Code extensions route, too (`vscode://ms-vscode.remote-repositories/open?url=…`),
so it is the shape a contributor is likely to expect.

### Rejected alternatives

- **`?action=<verb>`** — one parsing path and no path handling, which is genuinely simpler. Rejected
  because it conflates the verb with its arguments and cannot namespace the plugins without
  inventing a convention inside the query (`provider` only meaningful when `action=discovery`),
  which is the ambiguity this decision exists to avoid.
- **A separate URI authority per action** — VS Code fixes the authority to the extension id.

---

## 0002 — An empty path means `connect`, forever

**Status:** Accepted · **Date:** 2026-08-24 · **Raised by:** backward-compatibility analysis

### Question

Adding a verb changes the shape of every link. What happens to links already published?

### Decision

An empty path is `connect`. Not deprecated, not warned about — a permanent, supported spelling.

### Reasoning

`globalUriHandler` dispatched on `uri.query` alone and never read `uri.path`, so **every link ever
published has an empty path.** That is what makes the change safe, and it also means the legacy form
must keep working indefinitely: a link in a blog post, a tutorial, or a customer's internal wiki
cannot be recalled or updated.

Treating this as a migration with a sunset would be a promise the extension cannot keep, because it
does not know where the links are.

### Consequence

`connect` is the one action that can never be renamed or removed, since it is what silence means.

---

## 0003 — The action list is hand-written, never the command registry

**Status:** Accepted · **Date:** 2026-08-24 · **Raised by:** review of what a "command switch" would expose

### Question

The extension already contributes a command for everything a link might plausibly want. Should the
switch map the URL's verb onto a command id?

### Decision

No. `DEEP_LINK_VERBS` is a hand-written array, and dispatch is an exhaustive `switch` over it.

### Reasoning

A URL arriving from outside VS Code is untrusted input — anyone who can get a user to click a link
supplies it. Among the extension's contributed commands are:

| Command                                | What a link could do            |
| -------------------------------------- | ------------------------------- |
| `localQuickStart.delete`               | delete the user's container     |
| `localQuickStart.copyPassword`         | put a password on the clipboard |
| `localQuickStart.copyConnectionString` | exfiltrate a connection string  |

A registry-backed switch reaches all of them, and would keep reaching every command added later —
the vulnerability would be introduced by someone contributing an unrelated feature, months after
this code was reviewed. An allow-list fails the other way: a new action does nothing until someone
adds it deliberately.

Recording this as a decision rather than a comment is the point. "Look up the command id" is the
obvious simplification of this code, and the reason not to is not visible from the code itself.

### How it is enforced

`src/vscodeUriHandler.test.ts` asserts that `/delete`, `/copyPassword`,
`/localQuickStart.delete`, `/vscode-documentdb.command.localQuickStart.delete` and `/../local` are
all refused and reach nothing.

---

## 0004 — `local` names the product, not the internal command

**Status:** Accepted · **Date:** 2026-08-24 · **Raised by:** the maintainer's emphasis on nomenclature

### Question

The wizard's command id is `vscode-documentdb.command.localQuickStart.open`, its title is "Set up
DocumentDB Local", and the product is "DocumentDB Local". Should the public verb be `local`,
`localQuickStart`, or `quickstart`?

### Decision

`local`.

### Reasoning

Internal ids are implementation detail and get refactored; "DocumentDB Local" is the product name a
user has already seen on the website that sent them. A public URL vocabulary that tracks internal
naming inherits every future rename as a broken link.

`quickstart` describes the wizard rather than the destination, and would read oddly once the same
verb is wanted for an instance that already exists.

### Open

**This is the decision the maintainer asked for and has not yet given.** The alternative worth his
opinion is whether public verbs should deliberately mirror internal command ids for
discoverability, which would make this `localquickstart`. Recorded as Accepted rather than Proposed
because a shipping default is needed and this one is reversible while the action is new — but it is
the first thing to raise.

### Resolution

Maintainer review retained `/local` as the public verb and placed the local resource type in the
next path segment. `/local` remains shorthand for the default resource type.

---

## 0005 — `local` opens the wizard without a confirmation

**Status:** Superseded by D0007 · **Date:** 2026-08-24 · **Raised by:** implementation

### Question

`connect` shows a modal before adding a connection, gated on `showUrlHandlingConfirmations`. Should
`local` show one too?

### Decision

No. `/local` opens the wizard directly.

### Reasoning

The `connect` confirmations exist because that path stores a connection and its secret **before the
user sees any UI** — the modal is the only place to decline. The wizard is itself that place: it
opens on an introduction step, provisions nothing until the user walks it, and can be closed.

A modal in front of it would put two consecutive prompts between a website's "Open in VS Code"
button and the thing it promised, which is precisely the friction this link exists to remove.

### Revisit if

An action is added that changes state before showing UI. That action needs a confirmation, and the
reasoning above is the test to apply — not "does `connect` have one".

---

## 0006 — Local links model the resource type

**Status:** Accepted · **Date:** 2026-09-01 · **Raised by:** maintainer review

### Question

Should `/local` identify only an action, or should it also leave room to identify which local
product the user wants to set up?

### Decision

The first qualifier identifies the local resource type. `/local/documentdb` explicitly names
DocumentDB Local, while `/local` remains equivalent shorthand that defaults to `documentdb`.

Only allow-listed resource types are accepted. Unknown types and additional qualifiers are rejected.

### Reasoning

`local` describes a family of setup actions rather than one implementation forever. Keeping the
resource type in the path leaves room for a future local offering without introducing another
top-level verb or changing links that already use `/local`.

The qualifier was previously parsed but ignored, which meant `/local/anything` silently opened the
DocumentDB Local wizard. Validation makes the public URL describe the action it will actually take.

### Consequence

Resource type keywords are matched case-insensitively, like verbs, because both are public URL
vocabulary rather than user data.

---

## 0007 — Local links show one lightweight confirmation

**Status:** Accepted · **Date:** 2026-09-01 · **Raised by:** maintainer review

### Question

Should an external link open the DocumentDB Local setup webview without confirmation because the
wizard begins on a non-mutating introduction page?

### Decision

Show one concise modal confirmation before opening the wizard when
`documentDB.confirmations.showUrlHandlingConfirmations` is enabled. Dismissing it cancels the
request. When the setting is disabled, the wizard opens directly.

### Reasoning

Opening a webview from an external link can still be surprising even when it does not immediately
change state. One confirmation gives the user control without copying the connection flow's
multiple-step confirmation sequence.

### Revisit if

User testing shows that the confirmation adds friction without helping users understand or control
the transition into VS Code.

---

## 0008 — Azure resource links use `/connect/azure`

**Status:** Accepted · **Date:** 2026-11-05 · **Raised by:** Azure portal "Open in VS Code" scenario

### Question

The Azure portal can identify an Azure DocumentDB or Azure Cosmos DB for MongoDB (RU) resource by
its ARM resource ID, but often cannot hand over a connection string. A link has to name an action
that takes a resource ID. Which path does it use?

### Decision

`vscode://ms-azuretools.vscode-documentdb/connect/azure?resourceId=…`.

The first qualifier of `/connect` names **how the target is located**. `/connect` with no qualifier
keeps meaning "connect with a connection string" (D0002). `azure` is matched case-insensitively,
like the local resource type (D0006).

Each variant accepts its own locator only:

| Path             | Locator                           | Shared arguments                 |
| ---------------- | --------------------------------- | -------------------------------- |
| `/connect`       | `connectionString`                | `database`, `collection`, `open` |
| `/connect/azure` | `resourceId`, optional `tenantId` | `database`, `collection`, `open` |

A link that mixes them, such as a `connectionString` on `/connect/azure` or a `resourceId` on
`/connect`, is refused.

### Reasoning

Both variants do the same thing for the user: connect, then optionally navigate. The user does not
care that the Azure variant goes through service discovery; that is how we find the cluster, not
what the link asks for. D0004 already says public vocabulary names the user's intent rather than
an internal mechanism.

The shape repeats `/local` and `/local/documentdb`: an action plus a qualifier that narrows it. It
also leaves room for other sources (`/connect/kubernetes`, `/connect/atlas`) without another
top-level action.

It breaks nothing. `/connect` currently refuses any qualifier ("Use /connect"), so no published
link has one.

Refusing mixed locators avoids the ambiguity vscode-cosmosdb has, where `resourceId` silently wins
when both it and `cs` are supplied.

### Rejected alternatives

- **`/discovery/azure`** — the first proposal, filling the namespace the README reserved for
  discovery plugins. Rejected by the maintainer because the link connects, and "discovery" names
  the mechanism rather than the outcome.
- **`/discovery/<provider-id>`** (`azure-mongo-vcore-discovery`) — exposes internal ids that get
  refactored, against D0004.
- **Explicit `/connect/azure-documentdb` and `/connect/azure-mongo-ru`** — the resource ID already
  says which one it is (D0010), so the path would repeat it and need a mismatch check.
- **`?resourceId=` on `/connect`, as vscode-cosmosdb does** — puts the "how to locate" choice in
  the query, which D0001 rejected for the verb for the same reason, and makes the precedence
  between two locators a hidden rule.

---

## 0009 — Azure links resolve through our Discovery tree

**Status:** Accepted · **Date:** 2026-11-05 · **Raised by:** comparison with vscode-cosmosdb

### Question

Once a link names an Azure resource, how do we get from the ARM ID to an open connection?

### Decision

Through the Azure service discovery plugins and the Discovery view: find the subscription, make
the resource visible, reveal its cluster node in the Discovery view, and let that node connect as
it does when the user expands it. Nothing is saved to the Connections View.

### Reasoning

We own every part of that path: the subscription provider, the tenant filter, provider visibility,
the tree and its node identity. The cluster node already handles Entra ID and native credentials,
error translation and the dashboard. A deep link then behaves exactly like the user browsing to the
cluster.

The Collection View and credentials look clusters up through a tree data provider
(`findClusterNodeByClusterId`), so a tree node has to exist anyway.

### Rejected alternatives

- **Reveal through the Azure Resources view (`rgApiV2.resources.revealAzureResource`), as
  vscode-cosmosdb does.** Their implementation reads the current selection afterwards, which can
  be stale; fails on hidden subscriptions and on the wrong tenant
  ([microsoft/vscode-cosmosdb#2686](https://github.com/microsoft/vscode-cosmosdb/issues/2686), open);
  and its fix depends on an unreleased Azure Resources API
  ([microsoft/vscode-cosmosdb#3460](https://github.com/microsoft/vscode-cosmosdb/pull/3460),
  [microsoft/vscode-azureresourcegroups#1991](https://github.com/microsoft/vscode-azureresourcegroups/pull/1991)).
  Our Azure Resources integration is also behind a rollout check and would add a second extension
  to the critical path.
- **Fetch the cluster from ARM and connect without a tree node.** Every downstream surface
  resolves the cluster through a tree provider, so this would need a parallel identity path.
- **Save a Connections View entry.** Azure resources are reached through Azure identity; storing a
  copy duplicates the discovery entry and goes stale when the resource changes.

---

## 0010 — The resource ID selects vCore or RU; we handle both

**Status:** Accepted · **Date:** 2026-11-05 · **Raised by:** maintainer

### Question

Two discovery plugins cover Azure: Azure DocumentDB (`Microsoft.DocumentDB/mongoClusters`) and
Azure Cosmos DB for MongoDB RU (`Microsoft.DocumentDB/databaseAccounts`, kind `MongoDB`). Which do
Azure links cover, and how does a link pick one?

### Decision

Both. The provider and resource type in the resource ID select the plugin. `databaseAccounts` is
accepted only after ARM confirms the account's kind is `MongoDB`. Any other resource type is
refused.

### Reasoning

vscode-cosmosdb's URI handler accepts only `databaseAccounts`, routes them to the NoSQL experience,
and has no handoff to this extension, so a portal link for a MongoDB RU account has nowhere useful
to go today. We already discover RU accounts, so handling them is a matter of routing.

Deriving the plugin from the resource ID means the portal sends one value it always has, and a link
cannot name a plugin that disagrees with the resource.

### Rejected alternatives

- **vCore only.** Leaves RU portal users without a working link.
- **Leave RU to vscode-cosmosdb.** It does not handle Mongo RU.

---

## 0011 — Azure links change visibility filters permanently

**Status:** Accepted · **Date:** 2026-11-05 · **Raised by:** maintainer

### Question

The requested resource may be hidden: its discovery provider hidden, its tenant filtered, or its
subscription not selected. Should the link unhide it only for this session, or change the filter?

### Decision

Change the filter permanently, the same change the user would make by hand:

- show the hidden discovery provider (`showDiscoveryProvider`)
- remove the tenant from the unselected tenants (`removeUnselectedTenant`)
- add `tenantId/subscriptionId` to the selected subscriptions, but only when a selection exists;
  an empty selection already means "all subscriptions"

The confirmation (D0012) lists each change before it happens.

### Reasoning

The user followed a link to a resource they work with. Showing it in their tree is the expected
result, and a session-only state would make it disappear on the next window, which looks like a
bug.

A permanent change uses the existing filter code, so there is no second visibility model to keep
consistent.

### Consequence

The subscription filter is the Azure Resources setting `azureResourceGroups.selectedSubscriptions`.
Adding a subscription also makes it appear in the Azure Resources view. The confirmation must say
so. The tenant filter and provider visibility are stored by this extension and affect only it.

### Rejected alternatives

- **Session-only visibility**, as proposed for vscode-cosmosdb in
  [microsoft/vscode-cosmosdb#3460](https://github.com/microsoft/vscode-cosmosdb/pull/3460). It
  avoids touching a shared setting, but needs an in-memory overlay across three filters and makes
  the resource vanish on reload.
- **Refuse and ask the user to change filters.** Turns a one-click portal link into a manual
  configuration task.

---

## 0012 — Azure links confirm like `/local`

**Status:** Accepted · **Date:** 2026-11-05 · **Raised by:** maintainer

### Question

`/connect` always confirms before adding a connection, regardless of the setting. Does
`/connect/azure` need the same?

### Decision

One confirmation, shown when `documentDB.confirmations.showUrlHandlingConfirmations` is enabled,
like `/local` (D0007). It names the resource, resource group, subscription, database, collection,
the surface that will open, and any filter changes (D0011).

### Reasoning

The `/connect` confirmation is unconditional because that link carries a secret and stores it
before the user sees any UI. An Azure link carries no secret: it names a resource the user can
reach only with their own Azure identity, and it saves no connection.

### Revisit if

Users are surprised by filter changes made while confirmations are disabled. The alternative is
to always confirm when a filter will change.

---

## 0013 — `open=` names the surface; `dashboard` always opens

**Status:** Accepted · **Date:** 2026-11-05 · **Raised by:** maintainer ("open the shell" deep-link idea)

### Question

A link may want something other than the tree or the Collection View, such as the shell. How does
it ask, and how does that interact with the Cluster Dashboard, which already opens on its own?

### Decision

An optional `open` argument with a hand-written allow-list: `dashboard` and `shell`. Without it,
behavior is unchanged: reveal the target and open the Collection View when a collection is given.

- `open=dashboard` opens the Cluster Dashboard, scoped to `database` when given, **even when
  `documentDB.userInterface.showDashboardOnConnect` is off**. The link's open is recorded as
  `activationSource: 'deepLink'`.
- `open=shell` opens the interactive shell, scoped to `database` when given.
- `collection` together with `open` is refused, because only the Collection View has a
  collection scope.
- A link never carries a script, query or command for the shell or any other surface.

### Reasoning

The dashboard already opens automatically the first time a cluster node connects
(`ClusterItemBase`, `autoOpenOnConnect`, default on), and revealing a cluster with `expand: true`
triggers it. An explicit request must not depend on that setting, or the link does nothing for
users who turned it off. When the setting is on, the explicit open reuses the existing panel
(`panelReused`), so nothing opens twice.

A distinct activation source keeps link-driven opens apart from automatic ones, which the
dashboards count as exposure rather than a deliberate open.

The allow-list follows D0003: a value names a surface the extension decided is safe to open from
someone else's web page.

### Rejected alternatives

- **Respect `showDashboardOnConnect` for `open=dashboard`.** The link would silently do nothing.
- **Suppress the automatic dashboard when a link asks for something else.** Possible later; it
  needs a per-connection flag into the reveal, and today `/connect` already shows the dashboard
  before the Collection View.
- **`open=collection`.** Redundant: a `collection` argument already means it.

---

## 0014 — `open=` applies to `/connect` as well

**Status:** Accepted · **Date:** 2026-11-05 · **Raised by:** maintainer

### Decision

`/connect?connectionString=…&open=shell` and `open=dashboard` work as in D0013. The argument means
the same thing on every `/connect` variant.

### Reasoning

Both variants end at the same cluster node, so the surface they can open does not depend on how
the cluster was located. One vocabulary is simpler to document and to build links for.

---

## 0015 — An Azure link always expands the cluster node

**Status:** Accepted · **Date:** 2026-11-05 · **Raised by:** implementation of WI8, corrected by maintainer

### Question

`/connect/azure` reveals the cluster node in the Discovery view, and expanding that node runs its
normal connect flow, including the authentication quick pick. Should the link expand the node in
every case, or only once the connection is known to have worked?

### Decision

Reveal the cluster node once with `expand: true` in every case. That expansion is the only thing
that connects. Afterwards, if no client exists for the cluster's `clusterId`, stop: the node has
already shown what went wrong, and it stays expanded with whatever the tree shows (recovery actions
after a failure, nothing after a cancel). Database and collection nodes are then found with
`findNodeById` under the real node ids, without fetching the cluster's children again.

### Reasoning

The maintainer expects the node to be expanded in every scenario, and the authentication prompt
that the expansion shows is expected, because the user has to choose how to connect.

This needs no second connect path: in VS Code, `TreeView.reveal(…, { expand: true })` waits for the
expansion, which waits for the node's children request to the extension host
(`MainThreadTreeViews.reveal` → `TreeView.expand` → `AsyncDataTree.expand` awaits the node's
refresh). When `reveal` resolves, the connect attempt has finished, so checking for a client is
reliable.

### Rejected alternatives

- **Reveal collapsed, run `getChildren` from the link handler, expand only on success.** The first
  implementation did this to keep a cancelled connect from being retried by a later expansion.
  Rejected because it leaves the node collapsed after a failure or cancel, and because it rested on
  the assumption that `reveal` does not wait for the expansion, which is wrong.
