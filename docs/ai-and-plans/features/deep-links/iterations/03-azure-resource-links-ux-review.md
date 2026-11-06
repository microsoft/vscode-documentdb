---
feature: deep-links
kind: ux-review
status: historical
prs: [1067]
created: 2026-11-06
---

# Azure resource links and open targets - UX Review Pack

> **Start here:** [presentation walkthrough](#appendix-a---presentation-walkthrough).
> Every dialog's detail text is shown in full, not hidden behind a disclosure.
> Government/China and SRV variants are bundled with **OR**, rather than a mock for every
> combination. Evaluation notes sit **beside each presentation**, with a cross-cutting pass
> [at the end](#appendix-b---language-and-consistency-evaluation).

- **PR / branch:** [#1067](https://github.com/microsoft/vscode-documentdb/pull/1067) /
  `dev/tnaum/url-handler-improvmements`.
- **Reviewed source:** `d75d3eb57713926507a60604d06437e60457c49e`, 2026-11-06.
- **Feature area:** [URI handler](../../../../../src/vscodeUriHandler.ts),
  [Azure link flow](../../../../../src/deepLinks/handleAzureResourceLink.ts),
  [Discovery reveal](../../../../../src/tree/discovery-view/discoveryViewHelpers.ts).
- **Related intent:** [feature overview](../README.md), [decisions](../decisions.md),
  [public URL contract](../../../../user-manual/how-to-construct-url.md),
  [sovereign clouds](../../sovereign-clouds/README.md),
  [SRV fallback](../../srv-dns-fallback/README.md).
- **Scope:** external links, consent, sign-in, filters, progress, navigation, connection
  failures, expanded details, and recovery. Downstream dashboard/Collection View internals
  are not a full review of those features.

## How this review was run

This is a **source-backed preparation and language-evaluation pass**, not a report of
hands-on testing. No Azure resource, sovereign-cloud account, DNS failure, or installed
VS Code dialog was exercised. The source and relevant existing test cases were inspected;
the tests were not run for this documentation-only change.

**Reading the presentations:**

- Text blocks reproduce the extension's English strings with synthetic target values.
  `review-cluster`, `Review subscription`, `app`, `orders`, and the repeated-digit GUIDs
  below are examples, not real resources or account data.
- A field such as `<raw error.message>` is explicitly variable upstream text, **not**
  invented Microsoft/driver wording. Representative raw DNS errors are labeled as such.
- **OR** separates alternatives; it is not text the extension displays. Optional lines
  are described outside the text blocks.
- **Current** means wired to that exact call path. **Conditional diagnostic** means the
  wording exists, but appears only when a caller invokes the diagnostics service and a
  provider recognizes the failure. A first connection does **not** necessarily get it.
- The presentation labels "Title", "Detail", and "Primary action" are review annotations,
  not extra UI labels. VS Code supplies standard dismissal controls; their appearance and
  the rendering of long details still need a real-workbench check.
- Recommendations are **suggestions**, not approved wording or implemented changes.
  The operator has not made decisions on these items.

## Legend

### Priority

| Priority | Meaning |
| --- | --- |
| **P0** | Blocking - the user gets stuck |
| **P1** | Broken / misleading, or a consistency & safety gap |
| **P2** | Polish, expectation, or a smaller feature gap |
| **P3** | Nice-to-have / cosmetic / acknowledged |

### Status

| Status | Meaning |
| --- | --- |
| 🟠 **Open** | Recorded + analyzed; recommendation remains a suggestion |
| 🟡 **Open (soft)** | Open, but depends on an investigation or is "as-is" |
| ✅ **Implemented** | Changed and verified, with a Decision and commit link |
| 🚫 **Closed** | Won't fix, with a mandatory reason |
| 🔗 **Tracked** | Deferred to a linked repository issue |

### Markers

| Marker | Meaning |
| --- | --- |
| ⚠️ **Flag** | Confirmed gap or bug in the source; runtime impact still needs confirmation |
| 💡 **Suggestion** | Design/wording recommendation to react to |
| 🔍 **Answered** | A behavior question answered from the code |

Open items remain in the ledger until fixed, explicitly closed, or moved to an issue.
Priority is provisional until the operator walks the journeys.

## User interaction map

```mermaid
flowchart TD
    A[Click external DocumentDB link] --> V{Route and parameters valid?}
    V -- no --> E1([Error notification + output; no modal])
    V -- Azure resource --> AC{Open Azure resource?}
    AC -- dismiss --> STOP([Stop before sign-in or lookup])
    AC -- Open or confirmations off --> SI{Azure sign-in / tenant sign-in}
    SI -- dismiss --> STOP
    SI -- subscription unavailable --> E2([Error notification + Manage Azure accounts])
    SI -- resolved --> ARM[Read Azure resource]
    ARM -- error --> E1
    ARM --> FC{Filters need changing?}
    FC -- yes, confirmations on --> FD{Change filters and open?}
    FD -- dismiss --> STOP
    FD -- accept --> SAVE[Persist visibility changes]
    FC -- yes, confirmations off --> SAVE
    FC -- no --> REVEAL[Reveal Discovery cluster]
    SAVE --> REVEAL
    REVEAL -- missing --> E1
    REVEAL --> CONNECT[Expand and connect; credential prompts if needed]
    V -- connection string --> NEW{Already saved?}
    NEW -- no --> ADD{Add and open connection? Always asks}
    ADD -- dismiss --> STOP
    ADD -- accept --> TLS{Eligible local TLS exception requested?}
    TLS -- yes --> TC{Turn off validation / Keep validation on}
    TC -- dismiss --> STOP
    TC -- choose --> STORE[Save connection]
    TLS -- no --> STORE
    NEW -- yes --> OC{Open connection? Unless confirmations off}
    OC -- dismiss --> STOP
    OC -- accept or skipped --> CR[Reveal Connections destination]
    STORE --> CR
    CR -- swallowed reveal error --> SILENT([Potential silent stop; pre-existing])
    CR --> CONNECT
    CONNECT -- first connection fails --> E3([Generic modal + raw detail + Retry])
    CONNECT -- cached connection fails --> E4([Diagnostic or generic modal + raw detail + Retry])
    CONNECT -- succeeds --> AUTO[Optional automatic Cluster Dashboard]
    AUTO --> DEST{Requested destination}
    DEST -- none / database --> TREE([Expanded cluster / database selected])
    DEST -- collection --> COLL([Collection View])
    DEST -- dashboard --> DASH([Cluster Dashboard; setting override])
    DEST -- shell --> SH([Interactive shell; independent worker connection])
    DEST -- database / collection missing --> E5([Ambiguous error notification])
    SH -- worker fails --> SE([Terminal error + diagnostic + notification; retry by command])
    V -- local --> LC{Open setup? Unless confirmations off}
    LC -- dismiss --> STOP
    LC -- accept or skipped --> LW([DocumentDB Local setup wizard])
```

### Interaction inventory

| Entry / action | Terminal state and recovery | Presentation |
| --- | --- | --- |
| Azure resource link, vCore **OR** RU | Discovery cluster expanded, not saved to Connections; optional destination | [A1](#a1---azure-resource-consent), [A10](#a10---success-and-cancellation-end-states) |
| New connection-string link, explicit **OR** legacy empty path | Consent, optional TLS decision, saved connection, tree/destination; save survives a later connect failure | [A2](#a2---new-connection-consent-always-shown), [A4](#a4---tls-exception) |
| Existing connection-string link | Reuse saved connection; one open confirmation unless disabled | [A3](#a3---existing-connection-consent) |
| Sign in / Sign in to tenant | External authentication UI, then continue; dismiss stops | [A5](#a5---azure-account-and-tenant-sign-in) |
| Manage Azure accounts | Opens the provider's account-management flow; does not automatically retry the URL | [A12](#a12---azure-lookup-and-access-failures) |
| Change filters and open | Persistent provider/tenant/subscription visibility changes, then reveal | [A6](#a6---filter-change-consent) |
| Cancel Azure progress | Stops at the next cancellation checkpoint; earlier effects can remain | [A7](#a7---progress-and-cancel) |
| Choose auth method / identity / username / password | Shared connection wizard; supplied or cached values can skip prompts | [A8](#a8---database-authentication-prompts) |
| Dashboard / shell / collection destination | Panel or terminal; database-scoped when requested | [A10](#a10---success-and-cancellation-end-states), [A17](#a17---shell-worker-failure-after-a-successful-tree-connect) |
| Malformed link / wrong Azure resource / missing destination | Error notification, sometimes after partial successful work | [A11](#a11---invalid-link-messages-bundled), [A12](#a12---azure-lookup-and-access-failures), [A13](#a13---missing-database-or-collection) |
| Failed connect / failed database listing | Modal and clickable Retry; extra recovery varies by view/phase | [A14](#a14---connection-error-shells-and-recovery) |
| Click Retry / update credentials / open shell | Retry parent expansion / edit saved credentials / open terminal | [A14](#a14---connection-error-shells-and-recovery) |
| SRV failure / Government or China sign-in failure | Generic or explained message according to call path, not just error type | [A15](#a15---srv-dns-failures-fully-expanded), [A16](#a16---government-china-and-other-entra-failures-fully-expanded) |
| Local link (regression control) | Existing setup wizard; no provisioning just from accepting the URL | [A9](#a9---local-link-regression-control) |

## The story in one paragraph

The PR lets a link identify an Azure resource without embedding a connection string and
lets either connect route request a dashboard or shell. The target-aware confirmations,
credential-free Azure locator, and explicit local TLS choice are good foundations.
The main risk is not one bad sentence: similar failures receive different explanation
quality and surfaces depending on whether this is a first connection, cached connection,
tree lookup, or shell startup. This pack shows those differences without requiring access
to Government/China or manufacturing every DNS failure.

## Priority index

**10 source-backed Flags: 3 P1, 7 P2.** No P0 established by this preparation; that is not
a claim that runtime testing found no blockers. Shared/pre-existing gaps are identified
so they do not silently become requirements for this PR.

| ID | Priority | Item | Origin | Status |
| --- | --- | --- | --- | --- |
| F01 | **P1** | First-connect paths bypass readable SRV/Entra diagnostics | Shared/pre-existing, newly reached by Azure links | 🟠 Open |
| F02 | **P1** | Missing target message suggests a connection failure even after connecting | New Azure path reuses inherited text | 🟠 Open |
| F03 | **P1** | Blocking failures alternate between modal, toast, and silent stop | Mixed new/shared | 🟠 Open |
| F04 | **P2** | Action labels, titles, and surface names drift | Mixed new/shared | 🟠 Open |
| F05 | **P2** | Filter prompt omits persistence and no-rollback consequences | New presentation, intentional persistent design | 🟠 Open |
| F06 | **P2** | Progress cancellation waits for operations; some waits have no status | Mixed new/shared | 🟠 Open |
| F07 | **P2** | "Opens: Shell/Collection View" omits automatic dashboard | Shared behavior exposed by new destinations | 🟠 Open |
| F08 | **P2** | Some failures lack a next step or overstate what was established | New messages plus inherited validation wording | 🟠 Open |
| F09 | **P2** | Long diagnostic headings, jargon, and literal formatting reduce readability | Shared/pre-existing | 🟠 Open |
| F10 | **P2** | Saved connection in a folder can silently fail to reveal | Explicitly acknowledged pre-existing limitation | 🟠 Open |

## P0 - Blocking (the user gets stuck)

No P0 established. Real-workbench checks remain open, particularly cold tree activation,
focus, long dialogs, and error recovery.

## P1 - Broken / misleading, or consistency & safety

### F01. First connection can miss the helpful diagnosis ⚠️

**Priority:** P1 · **Status:** 🟠 Open

**Observation:** Source-derived; [A14](#a14---connection-error-shells-and-recovery) shows
the generic first-connect modal, while [A15](#a15---srv-dns-failures-fully-expanded) and
[A16](#a16---government-china-and-other-entra-failures-fully-expanded) show richer text
available on diagnostic-aware paths.

**Finding:** The [saved-connection failure helper](../../../../../src/documentdb/auth/urlEncodedPassword.ts#L88),
[vCore connect catch](../../../../../src/plugins/service-azure-mongo-vcore/discovery-tree/documentdb/DocumentDBResourceItem.ts#L197),
and [RU connect catch](../../../../../src/plugins/service-azure-mongo-ru/discovery-tree/documentdb/MongoRUResourceItem.ts#L140)
do not call diagnostics. [Cached connect](../../../../../src/tree/documentdb/ClusterItemBase.ts#L298)
and [shell startup](../../../../../src/documentdb/shell/DocumentDBShellPty.ts#L609) do.
Having a saved connection is not the same as having cached credentials.

💡 **Suggestion:** Reuse the diagnostics service at those rendering sites, retaining raw
detail and the decoded-password retry. No provider should show UI or mutate the error.

### F02. Missing target is reported as an uncertain connection failure ⚠️

**Priority:** P1 · **Status:** 🟠 Open

**Observation:** [A13](#a13---missing-database-or-collection) can appear after the cluster
has connected and even after an automatic dashboard has opened.

**Finding:** [Azure database/collection lookup](../../../../../src/tree/discovery-view/discoveryViewHelpers.ts#L160)
checks for a connected client first, but then uses the same ambiguous text as the
[connection-string target checks](../../../../../src/vscodeUriHandler.ts#L686).

💡 **Suggestion:** Name the database or collection that could not be found and the parent
where it was sought. Say "could not find", not "does not exist", when permissions or a
failed child listing could also explain absence.

### F03. Failure surface depends on implementation layer ⚠️

**Priority:** P1 · **Status:** 🟠 Open

**Observation:** See the [failure-surface comparison](#a18---failure-surface-comparison).

**Finding:** The [global handler](../../../../../src/vscodeUriHandler.ts#L141) uses the SDK's
non-modal error handling. Cluster connection failures use modals.
[Shared descendant diagnostics](../../../../../src/tree/BaseExtendedTreeDataProvider.ts#L618)
append the raw cause to a toast instead of using detail. Some Connections reveal errors
are [swallowed](../../../../../src/tree/api/revealConnectionsViewElement.ts#L13).

💡 **Suggestion:** Agree a rule for a user-blocking URL journey: actionable modal plus raw
detail/output, with tree children reserved for recovery actions. Treat deliberate
cancellation and background work separately. The shell's terminal-plus-toast is a useful
surface-specific exception, not necessarily something to turn into a modal.

## P2 - Polish, expectation, or feature gap

<a id="f04"></a>

### F04. The same action has several labels ⚠️

**Priority:** P2 · **Status:** 🟠 Open

**Observation:** Inline comparisons in [A1](#a1---azure-resource-consent),
[A3](#a3---existing-connection-consent), and [A8](#a8---database-authentication-prompts).

**Finding:** `Open`, `Yes, open connection`, `Open setup`, `Shell`, and
`Open Interactive Shell` coexist. The auth wizard also mixes title case and sentence
case. Sources are linked beside those presentations.

💡 **Suggestion:** Use short verb actions (`Open`, `Add and open`, `Open setup`) and a
shared destination vocabulary (`Cluster Dashboard`, `Collection View`, `Interactive
Shell`). Preserve official Azure product names.

### F05. Permanent filter changes sound like temporary navigation ⚠️

**Priority:** P2 · **Status:** 🟠 Open

**Observation:** [A6](#a6---filter-change-consent) lists effects, but not their duration.

**Finding:** [Visibility writes](../../../../../src/deepLinks/azureVisibility.ts#L46) persist.
The [flow](../../../../../src/deepLinks/handleAzureResourceLink.ts#L194) has no rollback if a
later connection fails or progress is cancelled.

💡 **Suggestion:** State that changes remain until changed back, and where to undo them.
Keep the accepted persistent-filter design; this is a disclosure recommendation, not a
proposal to silently change that design.

### F06. Cancel is checkpoint-based, not an immediate abort ⚠️

**Priority:** P2 · **Status:** 🟠 Open

**Observation:** [A7](#a7---progress-and-cancel) has a cancellable Azure notification.

**Finding:** The [outer flow](../../../../../src/deepLinks/handleAzureResourceLink.ts#L94)
checks its token after awaited phases; it does not pass that token into subscription
resolution, ARM reads, filter application, or reveal. The cluster has a separate connection
cancel mechanism. Readiness waits can also occur before the next stage message.

💡 **Suggestion:** Verify the latency with a slow request. Propagate cancellation where
supported; otherwise make waiting/stopping states honest. Do not promise rollback of
completed filter changes.

<a id="f07"></a>

### F07. The declared destination is not always the only surface opened ⚠️

**Priority:** P2 · **Status:** 🟠 Open

**Observation:** [A10](#a10---success-and-cancellation-end-states) includes a default-on
automatic dashboard before a shell or Collection View.

**Finding:** [Cluster expansion](../../../../../src/tree/documentdb/ClusterItemBase.ts#L391)
opens the dashboard on a new successful connection when the setting is enabled; the
[URI handler](../../../../../src/vscodeUriHandler.ts#L218) opens the explicit target later.

💡 **Suggestion:** Either explain the additional dashboard or agree whether explicit
destinations should suppress it. The latter is a behavior/design decision, not a copy fix.
Check keyboard focus and the selected database scope, including whether the automatic
cluster-wide and requested database-scoped dashboard coexist.

### F08. Error wording is unevenly actionable and certain ⚠️

**Priority:** P2 · **Status:** 🟠 Open

**Observation:** [A11](#a11---invalid-link-messages-bundled) and
[A12](#a12---azure-lookup-and-access-failures) contain both repair instructions and bare
diagnoses.

**Finding:** Resource/tenant ID validation has no format hint; not-found/unauthorized
resource errors have no next step. "None of your signed-in Azure accounts can access"
is inferred from no matching subscription in the selected environment, not a direct
test of every account's access in every cloud.

💡 **Suggestion:** Use "Could not find this subscription among your signed-in accounts"
and mention account, tenant, and selected Azure cloud. Add one concrete repair action
to bare validation/resource errors.

### F09. Diagnostic content is useful but too heavy for a modal headline ⚠️

**Priority:** P2 · **Status:** 🟠 Open

**Observation:** [SRV explanations](#a15---srv-dns-failures-fully-expanded) and
[Entra explanations](#a16---government-china-and-other-entra-failures-fully-expanded)
can occupy the entire main message.

**Finding:** [Cluster modals](../../../../../src/tree/documentdb/ClusterItemBase.ts#L321)
use the whole diagnosis as the main message and raw error as detail. SRV strings contain
literal backticks; these are plain VS Code message strings, not Markdown. Entra strings
mix "native DocumentDB authentication", "tenant", and "sign-in resource" with picker labels
such as "Username and Password".

💡 **Suggestion:** Front-load one plain-language sentence and one next step. Align
authentication names with the picker. Consider a separate structured presentation later;
do not truncate away the cause or invent unverified cloud advice.

### F10. A saved connection in a folder can look like nothing happened ⚠️

**Priority:** P2 · **Status:** 🟠 Open

**Observation:** [A10](#a10---success-and-cancellation-end-states) includes a nested saved
connection as a separate regression check.

**Finding:** The [URI handler's own limitation note](../../../../../src/vscodeUriHandler.ts#L634)
acknowledges the flat reveal path. The
[reveal helper](../../../../../src/tree/api/revealConnectionsViewElement.ts#L13) catches
lookup/reveal failures and records telemetry without user feedback. A subsequent
`open=` can return when no client exists; a collection check can instead produce A13.

💡 **Suggestion:** Keep this explicitly separate as a pre-existing follow-up. At minimum,
confirm the destination was not reached rather than reporting successful navigation.

## P3 - Nice-to-have / cosmetic / acknowledged

No separate P3 items seeded. Small wording observations are kept inline with the relevant
screen rather than inflating the priority ledger.

## Implemented

No UX fixes made by this pass. Production strings and behavior are unchanged.

## Iteration log

### Preparation pass

| Work | Outcome |
| --- | --- |
| Interaction map and expanded message inventory | Source-backed; ready for operator walkthrough |
| Inline language/consistency pass | F01-F10 open; no operator decisions invented |
| Live visual, keyboard, screen-reader, and sovereign-cloud checks | Not performed |
| Follow-on fixes | Await operator choices; record reasons before changing behavior |

## Open ideas - options, pros & cons

### O1. Explicit destination versus automatic dashboard (F07)

| Option | Pros | Cons |
| --- | --- | --- |
| Keep both and disclose | Preserves current global preference | More UI than the link explicitly names |
| Suppress auto-open only for explicit destinations | One predictable destination | Changes the meaning of the auto-open preference in this context |

💡 **Suggested:** Decide after exercising shell and Collection View with the setting on.
No accepted decision is changed by this preparation.

### O2. Rich diagnosis versus generic connection heading (F01, F09)

| Option | Pros | Cons |
| --- | --- | --- |
| Use the existing diagnostic-as-heading pattern everywhere | Smallest consistency fix; guidance becomes available | Long main messages remain |
| Introduce a short heading plus diagnosis and raw details | Easier to scan | Needs a shared presentation design, not just replacing a string |

💡 **Suggested:** First close the missing-diagnosis gap using existing mechanisms; assess
layout separately in the real workbench.

## Appendix A - presentation walkthrough

### A1 - Azure resource consent

**Trigger:** valid `/connect/azure` link, confirmations enabled. This happens **before**
sign-in and ARM lookup, so the name is the one supplied by the link, not yet verified.
Source: [confirmation builder](../../../../../src/deepLinks/handleAzureResourceLink.ts#L40).

**Current informational modal**

**Title:** `Open Azure resource?`  
**Primary action:** `Open`

```text
A link wants to open this Azure resource in VS Code.

Resource: review-cluster (Azure DocumentDB)
Resource group: review-rg
Subscription ID: 11111111-1111-1111-1111-111111111111
Database: app
Opens: Shell

Note: You can disable these URL handling confirmations in the extension settings.
```

**OR:** `Resource: review-account (Azure Cosmos DB for MongoDB (RU))`.

**Destination variants:** omit `Database: app` for a cluster-level link. Replace
`Opens: Shell` with `Opens: Cluster Dashboard` for `open=dashboard`. For a collection,
show `Collection: orders` after the database and `Opens: Collection View`. For a bare
cluster/database link there is **no** `Opens:` line. `collection` and `open` cannot coexist.

🔍 **Evaluation:** Good concrete target identity and no credentials in the locator.
No cloud or tenant is listed here, even if a tenant hint was supplied; the link itself
does not select a cloud. 💡 A short "Connects in the Discovery view" line would explain
what "open" does when there is no explicit panel destination. Align `Shell` with
`Open Interactive Shell` ([F04](#f04)).
See [F07](#f07) for
the additional automatic dashboard.

### A2 - New connection consent (always shown)

**Trigger:** `/connect` or legacy empty path, no saved duplicate. Always shown, even when
URL confirmations are disabled. Source:
[add-and-open builder](../../../../../src/vscodeUriHandler.ts#L490).

**Current informational modal**

**Title:** `Add and open connection?`  
**Primary action:** `Add and open`

```text
A link wants to add this DocumentDB connection and open it in VS Code.

Connection: review-user@localhost:27017
Database: app
Opens: Cluster Dashboard

A new connection will be added to your Connections View.
You might be asked for credentials to establish the connection.
```

**OR:** omit database/destination, use `Opens: Shell`, or add `Collection: orders` with
`Opens: Collection View`. The connection label comes from sorted hosts and an optional
username; it is not a displayed password or full connection string.

For a non-loopback target whose URL asks to bypass certificate validation, this paragraph
is inserted before "A new connection...":

```text
This link asked to turn off TLS certificate validation. The request was ignored, and certificate validation stays on.
```

🔍 **Evaluation:** Clearly combines consent to save and open; correctly does not promise
that this mandatory prompt can be disabled. 💡 `Connections View` here versus
`Discovery view` elsewhere has inconsistent capitalization ([F04](#f04)).
Saving happens before connecting; users should understand that a failed connection can
still leave a saved item. The ignored-TLS paragraph is appropriately explicit and calm.

### A3 - Existing connection consent

Source: [existing-connection builder](../../../../../src/vscodeUriHandler.ts#L602).

**Current informational modal**, skipped when URL confirmations are disabled.

**Title:** `Open connection?`  
**Primary action:** `Yes, open connection`

```text
A link wants to open a DocumentDB connection in VS Code.

Connection: Saved review connection
Database: app
Opens: Shell

You might be asked for credentials to establish the connection.

Note: You can disable these URL handling confirmations in the extension settings.
```

**OR:** same optional database/collection/destination lines as A2. The name is the saved
connection's name, not necessarily the hostname displayed for a new connection.

⚠️ **Evaluation, F04:** Same action as A1's `Open`, different button grammar.
💡 Prefer `Open` for both. The saved name is useful recognition, but adding a non-secret
host summary could make the actual target clearer. Existing duplicates use saved
credentials/settings; an incoming TLS-bypass request does not replace those settings.

### A4 - TLS exception

**Trigger:** new connection, bypass requested, **all** hosts loopback. Shown after A2,
independently of the URL-confirmation setting.
Source: [TLS consent](../../../../../src/vscodeUriHandler.ts#L530).

**Current warning modal**

**Title:** `Turn off certificate validation?`  
**Actions:** `Turn off validation` / `Keep validation on`

```text
This link asks to turn off TLS certificate validation.

Connection: review-user@localhost:27017
Database: app

Without certificate validation, the identity of the server is not verified. Only turn it off for a local emulator or test instance you trust.
```

**OR:** collection line when supplied; no database/collection lines for a cluster target.
Dismissal aborts before saving. `Keep validation on` continues with validation enabled.
Private-network, single-label, and `.local` hosts do not qualify just because they look local.

🔍 **Evaluation:** Good explicit trade-off and a safe continuation, not a forced binary
choice between weakening validation and abandoning the task. 💡 For F04, decide whether
the shorter button should retain the word "certificate" to match the title. Do not
weaken the consent or silently honor a remote bypass request.

### A5 - Azure account and tenant sign-in

Source: [subscription resolution](../../../../../src/deepLinks/azureSubscription.ts#L55).
These are management-plane Azure sign-ins, separate from database authentication.

**Current informational modal, when signed out**

**Title:** `Sign in`  
**Primary action:** `Sign in`

```text
Sign in to Azure to open review-cluster.
```

**OR: no matching subscription and a tenant hint is present**

**Title:** `Sign in to tenant`  
**Primary action:** `Sign in to tenant`

```text
None of your signed-in Azure accounts can access subscription 11111111-1111-1111-1111-111111111111.
The link names tenant 22222222-2222-2222-2222-222222222222. Sign in to that tenant to continue.
```

The tenant prompt is offered once, then subscriptions are queried again. Without a tenant
hint, no tenant prompt is offered. Dismissal stops the flow; an accepted sign-in delegates
its account-picker/browser UI to Azure authentication, whose exact strings are not owned here.

⚠️ **Evaluation, F08:** "None ... can access" is stronger than "no matching subscription
was returned", especially with a wrong selected cloud or stale sign-in.
💡 Prefer "We could not find this subscription among your signed-in accounts."
`Sign in to Azure` would be a more informative first title than `Sign in`.
Explain tenant as "organization (tenant)" on first use if the audience includes newcomers.

### A6 - Filter-change consent

**Trigger:** provider hidden **OR** tenant hidden **OR** subscription excluded. A single
modal bundles whichever changes apply; no need to test all seven combinations.
Source: [filter prompt](../../../../../src/deepLinks/handleAzureResourceLink.ts#L141).

**Current informational modal**

**Title:** `Change filters?`  
**Primary action:** `Change filters and open`

```text
To show review-cluster, the extension needs to change your filters:
• The Azure DocumentDB discovery provider will be shown in the Discovery view.
• Tenant 22222222-2222-2222-2222-222222222222 will no longer be hidden by your tenant filter.
• Subscription Review subscription will be added to your Azure subscription filter. This also shows it in the Azure Resources view.

Note: You can disable these URL handling confirmations in the extension settings.
```

**OR:** `Azure Cosmos DB for MongoDB (RU)` instead of `Azure DocumentDB`; absent changes
simply omit their bullet. No change means no prompt. With URL confirmations off, needed
changes are still applied, but **neither** Azure consent modal is shown.

⚠️ **Evaluation, F05:** Good disclosure that another extension's Azure Resources view
changes too. Missing: these are **persistent**, not just for opening this one link, and
a later cancellation or connection failure does not restore the old filters.
💡 Add "These changes remain until you change the filters again" plus an undo location.
`Subscription Review subscription` is grammatical but awkward without quotation marks.
Consider "Show this resource?" / "Update filters and open" if users do not think in providers.

### A7 - Progress and Cancel

Sources: [Azure progress](../../../../../src/deepLinks/handleAzureResourceLink.ts#L94),
[subscription stages](../../../../../src/deepLinks/azureSubscription.ts#L51),
[reveal stages](../../../../../src/tree/discovery-view/discoveryViewHelpers.ts#L90),
[connection-string progress](../../../../../src/vscodeUriHandler.ts#L645),
[delayed connection progress](../../../../../src/tree/documentdb/ClusterItemBase.ts#L191).

| Current surface | Title | Stage text / behavior |
| --- | --- | --- |
| Azure notification | `Opening from Azure` | Cancellable; stages below |
| Azure stage | | `Checking Azure sign-in…` |
| Azure stage | | `Looking for the subscription…` |
| Azure stage, only tenant retry | | `Signing in to tenant…` |
| Azure stage | | `Reading the resource from Azure…` |
| Azure stage, only filter writes | | `Updating filters…` |
| Discovery stage | | `Loading subscriptions…` |
| Discovery stage | | `Loading clusters…` |
| Discovery stage | | `Connecting…` |
| Discovery stage, if requested | | `Opening the database…` |
| Discovery stage, if requested | | `Opening the collection…` |
| Connection-string notification | `Opening DocumentDB connection…` | Not cancellable; no per-phase message here |
| Shared delayed connection notification | `Connecting to "review-cluster"…` | Separate cancellable connection attempt |
| Tree view | Loading animation | Also shown during reveal |

⚠️ **Evaluation, F06:** Concrete stages improve on a fixed spinner, but Azure's Cancel
does not abort the current network request or close an active auth prompt. It is checked
between phases. The separate connect notification has its own cancellation mechanism.
The Connections outer spinner is non-cancellable even when inner connect can be cancelled.
💡 Exercise slow sign-in/ARM/connection phases and distinguish "stopping after this step"
from an immediate abort. "Opening Azure resource…" would align the two outer titles.
Readiness waits before the next report can leave a stale stage visible.

### A8 - Database authentication prompts

The Azure management account being signed in does **not** mean database credentials are
already available. The vCore route reuses the shared wizard; RU retrieves credentials
through its Azure helper rather than showing this same vCore wizard.
Sources: [vCore wizard](../../../../../src/plugins/service-azure-mongo-vcore/discovery-tree/documentdb/DocumentDBResourceItem.ts#L229),
[auth picker](../../../../../src/documentdb/wizards/authenticate/ChooseAuthMethodStep.ts#L74),
[identity picker](../../../../../src/documentdb/wizards/authenticate/SelectEntraTokenSourceStep.ts#L137),
[username](../../../../../src/documentdb/wizards/authenticate/ProvideUsernameStep.ts#L13),
[password](../../../../../src/documentdb/wizards/authenticate/ProvidePasswordStep.ts#L14),
[method labels](../../../../../src/documentdb/auth/AuthMethod.ts#L46).

| Current UI | Text |
| --- | --- |
| Wizard orchestration title | `Authenticate to Connect with Your DocumentDB Cluster` |
| Prompt title | `Authenticate to connect with your DocumentDB cluster` |
| Method placeholder | `Select an authentication method for "review-cluster"` |
| Method option / detail | `Username and Password` / `Authenticate using a username and password` |
| OR method option / detail | `Microsoft Entra ID` / `Sign in with your account, or use an identity assigned to this machine` |
| OR method option, when available | `No Authentication` / `Connect without a username or password` |
| Identity placeholder, when applicable | `Select the identity to use for this connection` |
| Username prompt | `Please provide the username for "review-cluster":` |
| Username placeholder | `Username for review-cluster` |
| Username validation | `Username cannot be empty` |
| Password prompt | `You need to provide the password for "review-user" in order to continue. Your password will not be stored.` |
| Password placeholder | `Password for review-user@review-cluster` |

Prompts can be skipped when a method or credentials are already supplied. Password entry
is masked; the tables do not imply every user sees every step.

⚠️ **Evaluation, F04/F09:** Two title capitalizations for the same flow; repeated
"authenticate" is more formal than the surrounding "connect" / "sign in".
💡 Use one sentence-case title such as "Connect to your DocumentDB cluster".
The password promise is appropriate to the discovery wizard, not a promise that a new
connection-string URL containing credentials is never saved. Keep those contexts distinct.
The later diagnostic workaround "native DocumentDB authentication" should map to the
visible `Username and Password` option.

### A9 - Local-link regression control

Source: [local consent](../../../../../src/vscodeUriHandler.ts#L369).

**Current informational modal**, for `/local` **OR** `/local/documentdb`, unless confirmations
are disabled.

**Title:** `This link wants to open the DocumentDB Local setup in VS Code.`  
**Primary action:** `Open setup`

```text
Note: You can disable these URL handling confirmations in the extension settings.
```

Accepting opens the existing setup wizard; it does not itself provision a container.

🔍 **Evaluation, F04:** This title contains the sentence that Azure/new-connection
dialogs put in detail. 💡 Consider the same question-title pattern (`Open DocumentDB
Local setup?`) in a later copy pass. Keep this as a regression control, not a review of
all Local setup screens.

### A10 - Success and cancellation end states

Sources: [Azure destination](../../../../../src/vscodeUriHandler.ts#L218),
[connection-string destination](../../../../../src/vscodeUriHandler.ts#L678),
[Discovery expansion](../../../../../src/tree/discovery-view/discoveryViewHelpers.ts#L139),
[automatic dashboard](../../../../../src/tree/documentdb/ClusterItemBase.ts#L391),
[dashboard scoping](../../../../../src/commands/openClusterDashboard/openClusterDashboard.ts#L130),
[shell scoping](../../../../../src/commands/openInteractiveShell/openInteractiveShell.ts#L133).

| Request / action | What users actually end up with |
| --- | --- |
| Azure link without a destination | Discovery cluster selected and expanded; auth/connect runs; no saved Connections item |
| Connection-string link without a destination | Saved/reused Connections item selected and expanded |
| `database=app` | Database selected/expanded if found |
| `database=app&collection=orders` | Collection selected and Collection View opened; no extra Collection View confirmation |
| `open=dashboard` | Explicit Cluster Dashboard opens even if auto-open is disabled; database-scoped if named |
| `open=shell` | Terminal opens, database-scoped if named; otherwise default database `test`; no URL-supplied script runs |
| New successful cluster expansion, auto-open enabled | A cluster-wide dashboard can open before any explicit destination |
| Explicit dashboard for an already open matching cluster/database scope | Existing panel reused; a database-scoped request need not be the same panel as an automatic cluster-wide dashboard |
| Dismiss A1/A2/A3/A4/A9 | Stop at that decision; A2/A4 stop before the new connection is saved |
| Dismiss sign-in | Stop; no "cancelled" error toast intended |
| Dismiss filter consent | No visibility writes by this flow; completed sign-in remains |
| Cancel Azure progress after visibility writes | Earlier filter changes remain; later target opening is skipped at the next checkpoint |
| Connection fails after A2 save | Saved connection remains; failure modal/recovery actions |
| Plain existing connection in a folder cannot be revealed | Can stop with no visible error; pre-existing flat-path limitation |

⚠️ **Evaluation, F07:** `Opens: Shell` describes the requested destination but not an
automatic dashboard appearing first. Check the final keyboard focus, not just whether
both panels exist. 💡 Avoid introducing a success toast by default when selection/panel
opening is already clear; add feedback where the requested destination was not reached.

⚠️ **Evaluation, F10:** A fast silent return after a swallowed reveal error looks like
"the link did nothing". This is an inherited gap, not evidence that the new Azure path
has the same folder problem.

### A11 - Invalid-link messages (bundled)

**Current:** non-modal error notification through the SDK; output records the error.
These failures normally precede saving, sign-in, or connecting.
Sources: [route checks](../../../../../src/vscodeUriHandler.ts#L193),
[parameter checks](../../../../../src/vscodeUriHandler.ts#L811),
[Azure ID parser](../../../../../src/deepLinks/azureResourceLink.ts#L24).

| Trigger (**OR** alternatives) | Full current message | Inline evaluation |
| --- | --- | --- |
| Unknown action | This DocumentDB link asks for an action the extension does not recognize. It may have been written for a newer version — check for an update, or verify the link. | Useful next steps. F09: only this family uses an em dash; prefer a period for the established error-writing style. |
| `/connect/other` **OR** extra qualifier | This DocumentDB connection link has an invalid path. Use /connect or /connect/azure. | Clear concrete repair. |
| `/local/documentdb/extra` | This DocumentDB Local link has an invalid path. Use /local or /local/documentdb. | Consistent with connect-path repair. |
| Unsupported local resource type | This DocumentDB Local link asks for an unsupported resource type. Supported resource types: documentdb. | Actionable but "resource type" is link-author jargon. |
| Missing connection string | A DocumentDB deep-link was opened without a connection string. Ensure the link includes a connectionString query parameter. | F04/F09: "deep-link" versus "link"; useful key name for authors. Prefer "This link is missing..." |
| Wrong connection-string scheme | Invalid connection string format. It should start with "mongodb://" or "mongodb+srv://" | Useful repair; F04: missing final period versus sibling messages. |
| Missing resource ID | A DocumentDB Azure link was opened without a resource ID. Ensure the link includes a resourceId query parameter. | Good parallelism with connectionString, though "This Azure link..." is shorter. |
| `resourceId`/`tenantId` on `/connect` **OR** `connectionString` on `/connect/azure` | This DocumentDB link combines arguments for different link types. Use connectionString with /connect, or resourceId and tenantId with /connect/azure. | Helpful; tenantId is optional, which "and" may not make clear. |
| Unsupported `open` | This DocumentDB link asks to open something the extension does not support. Supported values for open: dashboard, shell. | Actionable for link authors. |
| `collection` plus `open` | This DocumentDB link cannot combine a collection with the open parameter. Remove one of them. | Clear conflict and recovery. |
| Collection without database, Azure | This DocumentDB link specifies a collection without a database. Add a database parameter. | Clear. |
| Collection without database, connection string | This DocumentDB link specifies a collection without a database. Add a database parameter or include the database in the connection string. | Correctly gives the extra connection-string alternative. |
| Malformed ARM resource ID | This DocumentDB link has an invalid Azure resource ID. | F08: no expected shape or help action. |
| Unsupported ARM resource type **OR** child resource | This link points to an Azure resource type the DocumentDB extension cannot open. | F08: name supported cluster/account kinds or link to the URL guide. |
| Invalid tenant GUID | This DocumentDB link has an invalid Azure tenant ID. | F08: explain expected GUID or advise copying from Azure. |

The SDK uses the thrown string directly for a single-line error. If an upstream error
contains line breaks, the SDK instead shows:

```text
An error has occurred. Check output window for more details.
```

and opens the output channel. This is **not** a modal with an expandable detail field.
The extension suppresses the generic `Report an Issue` button at activation.
The installed `@microsoft/vscode-azext-utils@4.1.0` error renderer was inspected: it calls
`window.showErrorMessage` without modal options. This is a dependency observation, not
an installed-workbench test. The
[extension registration](../../../../../src/extension.ts#L104) suppresses the generic
issue-reporting button.

⚠️ **Evaluation, F03/F09:** Same external action, but validation failures get a toast
while connection failures get a modal. Multiline raw errors lose their specific headline
entirely in the toast. Also, "output window" differs from the extension's usual "output
channel" vocabulary. The SDK wording is dependency-owned, not a new PR string.

### A12 - Azure lookup and access failures

**Current:** error notification plus output, not the A14 modal. A failed operation does
not automatically restart after account management.
Sources: [subscription resolution](../../../../../src/deepLinks/azureSubscription.ts#L117),
[resource read](../../../../../src/deepLinks/azureResource.ts#L40).

| Failure (**OR** alternatives) | Full current message | Extension action / inline evaluation |
| --- | --- | --- |
| Provider unavailable | Azure discovery is not available. | F08: no recovery direction. Suggest enabling/updating the extension or retrying after reload as appropriate to the cause. |
| Subscription not returned, after optional tenant retry | None of your signed-in Azure accounts can access subscription 11111111-1111-1111-1111-111111111111. | `Manage Azure accounts`. F08: useful action, but overstates access evidence and omits cloud selection. |
| ResourceNotFound **OR** ResourceGroupNotFound | The Azure resource review-cluster was not found in subscription Review subscription. | F08: advise checking subscription/resource group/link and whether it was deleted. |
| AuthorizationFailed | Your Azure account cannot read the Azure resource review-cluster. | F08: advise another account or requesting read access from the resource administrator. |
| RU-shaped resource ID points to a different Cosmos API | This Azure Cosmos DB account does not use the MongoDB API. | Correct API terminology. Add supported API or resource-selection guidance. |
| Other ARM/auth failure | `<upstream error.message>` | Variable text; multiline errors use A11's generic output-directed notification. Do not assume a translated 403/404 for every upstream code shape. |

🔍 **Evaluation:** Management-plane success is not database connectivity success. A
Government/China user can pass subscription/resource discovery and still fail at A16.
No Government-specific ARM error is authored by this PR; do not mock one as if it were.
The Azure authentication provider/environment supplies management endpoints.

### A13 - Missing database or collection

**Current error notification**

```text
URL handling aborted. Connection was unsuccessful or the specified database/collection does not exist.
```

Sources: [Azure target lookup](../../../../../src/tree/discovery-view/discoveryViewHelpers.ts#L174),
[connection-string target lookup](../../../../../src/vscodeUriHandler.ts#L686).

**OR:** the cluster itself could not be found in Discovery after ARM lookup:

```text
Could not find review-cluster in the Discovery view. It may have been deleted, or a filter may still hide it.
```

Source: [cluster lookup](../../../../../src/tree/discovery-view/discoveryViewHelpers.ts#L126).

⚠️ **Evaluation, F02:** The first message conflates connection, database, and collection
failure even when Azure's connected-client check already passed. "URL handling aborted"
describes implementation, not the user's goal.
💡 Suggested direction: `Could not find collection "orders" in database "app". Check the
name and your access, then try the link again.` Use a database-specific alternative when
the database lookup failed. This is proposed copy, **not current output**.

⚠️ **Evaluation, F08:** The cluster message appropriately says "may", but should give an
action such as refreshing Discovery or checking visibility. A failed resource list could
also precede this message; confirm whether two notifications appear in that live journey.

### A14 - Connection-error shells and recovery

#### First connection: current modal

Applies to a new **OR** already saved connection without cached credentials, and to first
vCore **OR** RU discovery connects that reach their connect-failure catch.
Sources: [saved helper](../../../../../src/documentdb/auth/urlEncodedPassword.ts#L98),
[vCore](../../../../../src/plugins/service-azure-mongo-vcore/discovery-tree/documentdb/DocumentDBResourceItem.ts#L197),
[RU](../../../../../src/plugins/service-azure-mongo-ru/discovery-tree/documentdb/MongoRUResourceItem.ts#L140).

**Title:** `Failed to connect to "review-cluster"`  
**Detail, fully shown:**

```text
Revisit connection details and try again.

Error: <raw error.message>
```

For an SRV error, for example, the last line can be the representative raw text:

```text
Error: querySrv EBADRESP _mongodb._tcp.review-cluster.example.test
```

For a Government sign-in rejection it can instead contain the provider's raw
`AADSTS65002` text or `platform_broker_error` text. Exact external text varies and is
not fabricated here. **The friendly A15/A16 diagnostic paragraph is not added by these
first-connect catches.**

⚠️ **Evaluation, F01:** "Revisit connection details" is particularly unhelpful when only
Microsoft can resolve a preauthorization gap or the problem is DNS.
💡 Show the matching diagnosis, retaining raw text as detail.

#### Saved native-auth connection: optional decoded-password variant

Only when the password looks URL-encoded, the saved-connection helper appends:

```text
💡 Your password appears to contain URL-encoded characters (e.g. %40 instead of @). This often happens when copying a password from a connection string URL. Would you like to retry with the decoded version?
```

**Action:** `Try with Decoded Password`. A failed retry shows the generic first-connect
modal again. A successful retry offers a **non-modal** message:

```text
Connected to "review-cluster" using the decoded password. Would you like to update your saved credentials?
```

**Action:** `Update Saved Password`.
Source: [retry/save flow](../../../../../src/tree/connections-view/DocumentDBClusterItem.ts#L255).

🔍 **Evaluation:** Explicit retry consent avoids guessing credentials silently.
💡 F04: sentence-case actions (`Try with decoded password`, `Update saved password`)
would align with newer dialogs. This variant belongs to saved native authentication;
do not imply Azure discovery offers it too.

#### Cached connection: current modal

Source: [cached failure](../../../../../src/tree/documentdb/ClusterItemBase.ts#L298).

**Main message:** the **entire recognized A15/A16 diagnosis**, **OR**
`Failed to connect to "review-cluster"` when none applies.

**Detail:** `<raw error.message>` directly, with **no** "Revisit..." or `Error:` prefix.

#### Connected but listing databases fails: current modal

Source: [listDatabases failure](../../../../../src/tree/documentdb/ClusterItemBase.ts#L354).

**Main message:** the diagnosis, **OR** `Failed to load databases for "review-cluster"`.  
**Detail:** `<raw error.message>` directly.

**Recovery children after failure**

| Phase / view | Current actionable rows |
| --- | --- |
| Cluster connection failure | `Click here to retry` |
| Post-connect database-list failure | `Click here to retry` **and** `Click here to open the shell` |
| Saved Connections cluster failure | Provider additionally offers `Click here to update credentials` |
| Azure Discovery cluster failure | No matching saved-connection update-credentials row is injected by that provider |

Sources: [retry](../../../../../src/tree/api/retryNode.ts#L45),
[phase-specific actions](../../../../../src/tree/documentdb/ClusterItemBase.ts#L225),
[Connections-only action](../../../../../src/tree/connections-view/ConnectionsBranchDataProvider.ts#L125).

⚠️ **Evaluation, F01/F03:** Diagnostic quality and detail framing change with cache
state, which users cannot see. Tree recovery rows correctly contain **actions**, not
truncated error summaries. An explanation saying "Use Update Credentials" should be
checked against the commands actually available on the affected Discovery node; do not
infer that every view has the saved-connection action.

### A15 - SRV DNS failures, fully expanded

`SRV`, not `SVR`, is the connection-string/DNS term. These variants cover a failing
`mongodb+srv://` connection without requiring a broken router/VPN in the review environment.
Sources: [SRV diagnosis](../../../../../src/documentdb/srv/SrvDnsDiagnosticsProvider.ts#L17),
[fallback error selection](../../../../../packages/documentdb-js-srv-resolver/src/resolveSrvForDriver.ts#L177),
[driver preparation](../../../../../src/documentdb/srv/prepareDriverConnectionString.ts#L66).

**Important wiring:** on a first connection, insert the raw variant into A14's generic
detail. The full explanations below are **conditional diagnostic main messages** on a
diagnostic-aware path, such as a cached connection, database-list failure, or shell.
Earlier source-specific providers can take precedence, or the service can fall back to
the original error. The existence of a rule is not a guarantee of its display.

#### Unreadable DNS reply: EBADRESP OR EFORMERR

**Conditional diagnostic main message, complete current text:**

```text
The SRV record for this connection could not be resolved: the DNS reply could not be read. This often happens with home routers and some VPN or corporate DNS servers. Use a non-SRV `mongodb://` connection string, or a different DNS server. See https://microsoft.github.io/vscode-documentdb/user-manual/troubleshooting-srv-dns for troubleshooting.
```

**Modal detail, representative raw text:**

```text
querySrv EBADRESP _mongodb._tcp.review-cluster.example.test
```

**OR:** `querySrv EFORMERR _mongodb._tcp.review-cluster.example.test`.

⚠️ **Inline evaluation, F09:** Good uncertain cause and actionable alternatives.
But the whole paragraph/URL is a long modal main message, and backticks are literal,
not code formatting here. 💡 Lead with "We could not read the DNS response for this
connection", then give the next action. Explain "non-SRV" as a standard connection
string if needed. Do not advise arbitrary public DNS for a private endpoint.

#### DNS query refused: ECONNREFUSED

**Conditional diagnostic main message, complete current text:**

```text
The SRV record for this connection could not be resolved: the DNS server refused the query. Check your network's DNS settings, or use a non-SRV `mongodb://` connection string. See https://microsoft.github.io/vscode-documentdb/user-manual/troubleshooting-srv-dns for troubleshooting.
```

**Modal detail, representative raw text:**

```text
querySrv ECONNREFUSED _mongodb._tcp.review-cluster.example.test
```

🔍 **Inline evaluation:** This specifically requires an SRV query failure; a database
socket `connect ECONNREFUSED` is **not** proof that DNS refused anything.
💡 F09: "Your DNS server refused the connection lookup" is plainer, but keep the raw code.

#### Other DNS/network/auth errors: no generic SRV explanation

**Representative raw alternatives, not fixed extension strings:**

```text
querySrv ENOTFOUND _mongodb._tcp.review-cluster.example.test
```

**OR:** a `querySrv ETIMEOUT`, database socket refusal, TLS error, or authentication
failure. The SRV provider does not translate these codes into the two paragraphs above.
If no other provider explains them, the current generic A14 heading remains.

**Fallback validation errors** can also remain technical. Examples defined in the
[resolver rewrite](../../../../../packages/documentdb-js-srv-resolver/src/srvUriRewrite.ts#L144):

```text
Server record does not share hostname with parent URI
```

**OR**

```text
No addresses found at host
```

**OR**

```text
Multiple text records not allowed
```

⚠️ **Inline evaluation, F08/F09:** These are plausible end-user details, not friendly
repair guidance. Do not pretend every broken `+srv` URL produces the improved diagnosis.
An error at connection-string parsing may instead surface as an SDK notification before
A14. Preserve the difference between invalid input, DNS lookup, and server connection.

#### SRV fallback succeeds

**Current:** no warning/error dialog solely for fallback success. The connection proceeds;
trace output records the fallback and the persisted URL remains `mongodb+srv://`.
If fallback DNS fails after an eligible probe failure, the resolver generally reports
the original probe error; rewrite validation failures report their own error.

🔍 **Inline evaluation:** Quiet successful recovery is reasonable; do not mock a failure
dialog just because fallback ran. A successful connection does not prove that the user's
normal DNS resolution was unaffected.

### A16 - Government, China, and other Entra failures, fully expanded

These are shared Azure DocumentDB authentication behaviors, **not new cloud-specific
strings authored by #1067**. The rule table is
[entraErrorRules](../../../../../src/documentdb/auth/entraErrors/entraErrorRules.ts#L26);
[classification](../../../../../src/documentdb/auth/entraErrors/classifyEntraError.ts#L15)
prefers known AADSTS codes/recognized phrases over an opaque broker wrapper.
[Recent failure context](../../../../../src/documentdb/auth/entraErrors/EntraDiagnosticsProvider.ts#L35)
distinguishes known cloud/authentication context from an unknown one.

**Presentation rule for every variant below:**

1. First vCore/saved connect reaching the generic catch: A14 title plus
   `Revisit connection details and try again.`, blank line, `Error: <raw provider text>`.
   **The classified paragraph below is currently absent.**
2. Diagnostic-aware cached connect: the entire classified paragraph is the **main
   message**; detail is the original provider/driver `error.message`.
3. Shell startup: terminal raw failure plus explanation and a notification, as in A17.
4. No matching rule/context: no invented cloud-specific diagnosis; use the raw fallback.

The exact AADSTS sentences emitted by Microsoft can change. Codes/conditions identify
the variant here; `<raw provider text>` is deliberately not a fabricated service reply.
All classified paragraphs below include their actual documentation URL.

#### Microsoft preauthorization: AADSTS65002 OR recognized preauthorization phrase

**Conditional diagnostic, complete current text:**

```text
Microsoft Entra ID sign-in for Azure DocumentDB appears to require Microsoft to preauthorize VS Code. Only Microsoft can change this, not you or your tenant administrator. Use native DocumentDB authentication or managed identity on an Azure VM as a workaround, and report this on GitHub. See https://microsoft.github.io/vscode-documentdb/user-manual/sovereign-clouds
```

🔍 **Inline evaluation:** Good ownership: does not blame a tenant admin for a Microsoft
configuration gap. ⚠️ F01 is particularly important here because the first-time path can
hide this guidance. 💡 F09: say "Username and Password authentication" to match the
picker, and qualify that managed identity requires a suitable Azure VM and permissions.
Keep the workaround conditional rather than promising every user can use it.

#### Opaque broker failure, with recent non-public-cloud token failure

**Conditional diagnostic, Government variant:**

```text
Sign-in failed in Azure US Government. If the sign-in window showed AADSTS65002 ("must be configured via preauthorization"), Microsoft Entra ID sign-in for Azure DocumentDB is not enabled yet for VS Code in this cloud. Only Microsoft can change this, not you or your tenant administrator. Use native DocumentDB authentication or managed identity on an Azure VM as a workaround, and report this on GitHub. See https://microsoft.github.io/vscode-documentdb/user-manual/sovereign-clouds
```

**OR:** `Azure China` **OR** `a custom cloud` replaces `Azure US Government`.
The condition is recent recorded token failure plus non-public cloud, not simply having
the environment setting on Government/China. A recognized AADSTS code takes its own rule.

🔍 **Inline evaluation:** The **if** is essential: an opaque broker error alone does not
establish preauthorization failure. 💡 F09: this is the longest headline in the pack;
lead with "Check the code in the sign-in window" and keep the conditional explanation
below it in any future presentation redesign.

#### Opaque broker failure, without that contextual evidence

**Conditional diagnostic, public/unknown context:**

```text
The sign-in window reported an error without details. Check the error code shown in that window, or open Developer: Show Logs... > Microsoft Authentication in VS Code. Your IT help desk can help interpret the code; if the problem persists, report it on GitHub. See https://microsoft.github.io/vscode-documentdb/user-manual/sovereign-clouds
```

**OR:** for known Government/China/custom context without a recent token failure,
`Microsoft Sovereign Cloud Authentication` replaces `Microsoft Authentication`.

🔍 **Inline evaluation:** Appropriately avoids assuming a cause. 💡 F09: the command
path is useful but dense; quote the command/channel names clearly. The explanation is
for an opaque sign-in failure, not proof that the database is unavailable.

#### Cloud/resource mismatch: AADSTS500011

**Conditional diagnostic, interactive sign-in:**

```text
The selected Azure cloud very likely does not match the cluster. Check the "microsoft-sovereign-cloud.environment" setting. If it already matches, report this on GitHub or ask your tenant administrator to check whether the sign-in resource is available in your tenant. See https://microsoft.github.io/vscode-documentdb/user-manual/sovereign-clouds
```

**OR, managed identity context:**

```text
The managed identity token very likely targets a different Azure cloud than the cluster. If "documentDB.customEnvironment.ossrdbmsEndpoint" is set, check its value or clear it. Then verify that the virtual machine and the cluster are in the same Azure cloud. If both are correct, report this on GitHub or ask your tenant administrator to check whether the resource is available in your tenant. See https://microsoft.github.io/vscode-documentdb/user-manual/sovereign-clouds
```

🔍 **Inline evaluation:** Good distinction: a VM token does not follow interactive
VS Code cloud selection. 💡 F09: "very likely" is cautious but still quite strong;
retain the alternate tenant-resource explanation and do not direct managed identity
users to change the interactive sign-in setting as a universal repair.

#### Invalid sign-in resource: AADSTS50001

```text
The requested Microsoft Entra sign-in resource does not appear to be valid for this cloud. If "documentDB.customEnvironment.ossrdbmsEndpoint" is set, check its value with your cloud administrator. Otherwise, report this on GitHub so the extension maintainers can investigate. See https://microsoft.github.io/vscode-documentdb/user-manual/sovereign-clouds
```

💡 **Inline evaluation, F09:** The next step is specific, but "sign-in resource" is
expert terminology. A short parenthetical explaining the token's target service would
help without changing the technical setting name.

#### Account or tenant: AADSTS50020 OR AADSTS90072

```text
This account does not appear to be a member or guest of the organization that owns the cluster. Use Update Credentials to choose another account or tenant, or ask that organization's administrator to grant access. See https://microsoft.github.io/vscode-documentdb/user-manual/sovereign-clouds
```

💡 **Inline evaluation, F01/F09:** Helpful organization-based explanation, but verify
where `Update Credentials` is reachable for Discovery, not only saved Connections.
Prefer the actual visible command label and a location.

#### Application or tenant not found: AADSTS700016 OR AADSTS90002

```text
The sign-in application could not be found in the directory, usually because the wrong Azure cloud or tenant is selected. Check "microsoft-sovereign-cloud.environment" and use Update Credentials to choose the cluster's tenant. If both are correct, ask your tenant administrator or report this on GitHub. See https://microsoft.github.io/vscode-documentdb/user-manual/sovereign-clouds
```

**OR**

```text
The tenant does not appear to exist in the selected Azure cloud. Check "microsoft-sovereign-cloud.environment" and use Update Credentials to select the right tenant. Your organization's administrator can confirm which cloud and tenant to use. See https://microsoft.github.io/vscode-documentdb/user-manual/sovereign-clouds
```

💡 **Inline evaluation, F09:** Action order is good: check cloud, then tenant, then ask
for help. "Directory", "organization", and "tenant" drift within the family; define the
relationship once rather than assuming they are equally familiar.

#### Cross-cloud policy: AADSTS1000104

```text
Sign-in appears to be blocked because the account is from another Azure cloud. Sign in with an account from the cluster's cloud, or ask the organizations' administrators to check their cross-cloud access settings. See https://microsoft.github.io/vscode-documentdb/user-manual/sovereign-clouds
```

🔍 **Inline evaluation:** Correctly distinguishes an account from another cloud from
merely selecting the wrong cloud setting. 💡 F09: "organizations' administrators" is
harder to parse than "the administrators of both organizations".

#### Organization policy or verification: AADSTS53003 OR 50076 OR 50079

```text
Your organization's policy appears to have blocked this sign-in. Contact your IT help desk with code AADSTS53003 and the time of the failure so they can check the sign-in policy. See https://microsoft.github.io/vscode-documentdb/user-manual/sovereign-clouds
```

**OR**

```text
Microsoft Entra ID appears to require additional verification. Sign in again and complete the verification requested by your organization. If you cannot complete it, contact your IT help desk. See https://microsoft.github.io/vscode-documentdb/user-manual/sovereign-clouds
```

🔍 **Inline evaluation:** Strongest actionability in this family: policy case gives
the code and time to share; verification tells the user what to try. Do not replace these
with a generic "check credentials". These can occur in public Azure too.

#### OIDC trusted-host rejection

```text
The driver does not appear to allow this cluster host for Microsoft Entra ID authentication. For a custom DNS endpoint, verify the trusted DocumentDB service hostname suffix with your cloud administrator and set "documentDB.customEnvironment.hostnameSuffix" in user settings. Only trust your service's domain, then connect again. See https://microsoft.github.io/vscode-documentdb/user-manual/sovereign-clouds
```

**Raw detail:** the driver's `Host '...' is not valid for OIDC authentication with
ALLOWED_HOSTS of '...'` message; actual host/list values vary.

🔍 **Inline evaluation:** Useful trust boundary and explicit **user settings** location.
💡 F09: OIDC/hostname suffix are specialist terms; keep the trusted-domain warning even
if simplifying the opening sentence.

#### Other recognized AADSTS code

Example substitution `12345`; this is an illustrative code, not a claim about a real
Microsoft failure assigned to this scenario:

```text
Microsoft Entra ID rejected the sign-in (AADSTS12345). See https://login.microsoftonline.com/error?code=12345 for details and ask your tenant administrator or IT help desk for help. Report this on GitHub if it persists. See https://microsoft.github.io/vscode-documentdb/user-manual/sovereign-clouds
```

💡 **Inline evaluation, F09:** Good fallback retaining the code. Two URLs and two help
destinations are a lot for a heading; present a clear first action if the UI is redesigned.

#### Cloud resolution fails before a token can be requested

These messages come from [token-resource resolution](../../../../../src/documentdb/auth/documentdbTokenResource.ts#L119),
not from AADSTS classification. On the first-connect path they appear inside A14's
`Error: ...` detail; with no diagnosis, cached connect uses its generic title and this raw
detail. The structured diagnostic `details` object is **not** printed as a user-visible
cloud-settings dump.

**Known cluster cloud differs from interactive sign-in cloud:**

```text
This cluster is in Azure US Government, but VS Code is signed in to Azure (public cloud). Change the "microsoft-sovereign-cloud.environment" setting to the cloud of the cluster, then connect again.
```

**OR:** `Azure China` for the cluster; the signed-in label can be another known cloud
or `a custom cloud`.

🔍 **Inline evaluation:** Concrete and actionable. 💡 F09: "VS Code is signed in to"
actually describes the selected/resolved cloud audience here; "VS Code is configured for"
may be more accurate before a sign-in has succeeded.

**Custom-cloud definition cannot be read:**

```text
The VS Code custom cloud definition could not be read. Configure "microsoft-sovereign-cloud.customEnvironment" with all six required fields: name, portalUrl, managementEndpointUrl, resourceManagerEndpointUrl, activeDirectoryEndpointUrl, activeDirectoryResourceId. Then connect again.
```

💡 **Inline evaluation, F09:** Accurate repair for an administrator, overwhelming as an
inline user instruction. Keep the required-field list in details/help, not the headline.

**Custom cloud's token resource cannot be determined:**

```text
VS Code is signed in to a custom cloud, and we could not find which Microsoft Entra resource to request a token for. Set "documentDB.customEnvironment.ossrdbmsEndpoint" to the open-source database resource of your cloud, usually "https://ossrdbms-aad.database.<your-cloud-domain>". Your cloud operator or Azure administrator can tell you the exact value.
```

💡 **Inline evaluation, F09:** Good that no public-cloud value is silently substituted.
Make clear that `<your-cloud-domain>` is a placeholder, not a value users should paste.
"Open-source database resource" needs a short explanation for non-administrators.

**Invalid explicit token-resource setting:**

```text
"documentDB.customEnvironment.ossrdbmsEndpoint" must be an HTTPS resource such as "https://ossrdbms-aad.database.usgovcloudapi.net", with no path or "/.default". Clear the setting to use automatic resource selection.
```

🔍 **Inline evaluation:** Good exact shape and reversible repair.
💡 Clarify "with no path or trailing '/.default'" so "or" is not misread as permitting
that suffix.

**Managed identity, unrecognized host cloud and no usable VM-cloud evidence:**

```text
We could not determine which Azure cloud this virtual machine is in, so we do not know which Microsoft Entra resource to request a token for. Set "documentDB.customEnvironment.ossrdbmsEndpoint" to the open-source database resource of your cloud, for example "https://ossrdbms-aad.database.usgovcloudapi.net".
```

💡 **Inline evaluation, F09:** The Government value is an example, not a universal fix
for China/custom clouds. Explicitly say "use your cloud's value" and direct uncertain
users to their cloud administrator.

**Connection hosts span known Azure clouds:**

```text
The host names of this cluster belong to more than one Azure cloud (azure.com, azure.us, azure.cn). A connection can use only one cloud. Check the connection string, then connect again.
```

🔍 **Inline evaluation:** Clear cause and next step; no need for a separate mock per
cloud pair. This is input validation, not a Microsoft-side outage.

### A17 - Shell worker failure after a successful tree connect

A link reaches the terminal only after tree connect succeeds. The shell starts an
independent worker, which can fail even though the tree just connected.
Source: [shell startup catch](../../../../../src/documentdb/shell/DocumentDBShellPty.ts#L595).

**Current terminal sequence, representative EBADRESP raw error and full SRV diagnosis:**

```text
Failed to connect: querySrv EBADRESP _mongodb._tcp.review-cluster.example.test
The SRV record for this connection could not be resolved: the DNS reply could not be read. This often happens with home routers and some VPN or corporate DNS servers. Use a non-SRV `mongodb://` connection string, or a different DNS server. See https://microsoft.github.io/vscode-documentdb/user-manual/troubleshooting-srv-dns for troubleshooting.
Run a command to try connecting again, or close this terminal.
```

**Also:** a non-modal error notification containing the same diagnosis. Without a
diagnosis, that notification is `Failed to connect to "review-cluster": <error message>`.
Raw errors are retained in output with secret redaction. Terminal colors/prefix decoration
are intentionally not simulated by the text block.

**OR:** replace the DNS failure and diagnosis with the relevant A16 provider failure and
classified explanation. If no provider matches, omit the explanatory line. A
`SettingsHintError` can add its existing settings-link hint.

🔍 **Evaluation, F03:** Terminal-plus-notification is reasonable because the terminal
could be hidden. The terminal stays open with a specific retry instruction.
⚠️ F01: the shell can explain a problem that the tree's first-connect catch did not.
💡 F09: language should remain the same across those surfaces even if layout differs.

### A18 - Failure-surface comparison

| Failure class | Current surface | Detail / recovery | Evaluation |
| --- | --- | --- | --- |
| Bad route/parameter/resource ID | SDK notification + output | Error text; no authored detail field | F03: differs from blocking connect modal |
| No matching Azure subscription | SDK notification + output | `Manage Azure accounts`; no automatic URL retry | Good action, F08 certainty/next-step wording |
| ARM read failure | SDK notification + output | Translated known cases, otherwise upstream text | F03/F08 |
| Missing Discovery cluster/database/collection | SDK notification + output | Current A13 message; cluster may remain revealed/connected | F02, possibly secondary notification after tree error |
| First cluster connection failure | Modal + output + Retry | Generic title, raw detail | F01 |
| Cached cluster connection failure | Modal + output + Retry | Diagnosis when available, raw detail | Useful baseline for F01 |
| Database-list failure after connect | Modal + output + Retry/Open shell | Diagnosis when available, raw detail | Correctly distinguishes operation when no diagnosis |
| Diagnosed descendant failure through base provider | Non-modal notification | Diagnosis and raw cause concatenated in parentheses | F03: same cause, different surface/readability |
| Connections reveal lookup/reveal error | Telemetry, no direct message | May later become a target error, or stop silently | F10 |
| Multiline error through SDK | Generic notification + opened output | Full raw error only in output | F03/F09 |
| Shell worker connection failure | Terminal + notification + output | Raw failure, diagnosis, retry instruction | Intentional surface-specific exception to assess |
| Deliberate user dismissal | Stop, normally no failure notification | Prior completed sign-in/filter writes can remain | Correct quiet cancellation; F05/F06 disclosure |

This is a comparison of source paths, not a promise that one click shows every row.
The shared base-provider descendant path and folder-reveal behavior predate this PR.

## Appendix B - language and consistency evaluation

**Verdict:** locally understandable, but **not yet consistent end to end**. Target
identity and consent are stronger than the failure/recovery story. The most important
improvement is making the *same explanation available*, not just making buttons match.
Every recommendation below is also attached to the relevant presentation above.

| Dimension | Evaluation | Where to react |
| --- | --- | --- |
| Main actions | `Open` versus `Yes, open connection`; other actions mix sentence/title case | A1-A4, A14; F04 |
| Destination names | `Shell` versus manifest `Open Interactive Shell`; `Connections View` versus `Discovery view` | A1-A3, A8; F04 |
| Goal-oriented language | `URL handling aborted`, `deep-link`, and `discovery provider` expose machinery | A6, A11, A13; F08/F09 |
| Error certainty | Resource errors are direct; Entra is appropriately cautious; subscription failure overstates evidence | A5, A12, A16; F08 |
| Actionability | Some errors give exact repairs, others stop at "invalid" or "not available" | A11-A13; F08 |
| Authentication vocabulary | `Username and Password` versus `native DocumentDB authentication`; organization/directory/tenant drift | A8, A16; F09 |
| Message structure | First connect uses generic headline + advice + raw error; cached connect uses long diagnosis + raw error | A14-A16; F01/F09 |
| Formatting | Em dash in one validation message, inconsistent final punctuation, literal SRV backticks | A11, A15; F04/F09 |
| Help destinations | Documentation links are useful, but long raw URLs dominate some headings | A15-A16; F09 |
| Consent consequences | Save is explicit; cross-view filter change is explicit, permanence is not | A2, A6, A10; F05 |
| Progress honesty | Azure stages are informative; Cancel latency and nested spinners need live assessment | A7; F06 |
| Final destination | Visible navigation is preferable to a gratuitous success toast, but extra dashboard and silent reveal gaps need attention | A10; F07/F10 |

### Suggested hands-on sequence

Use the real extension for what can be exercised; read A15/A16 as source-derived
presentations for unavailable environments. Do not treat those transcripts as cloud/DNS
runtime verification.

1. **New local test connection:** consent, deny/accept, TLS keep-on/turn-off/dismiss.
   Observe whether any saved item remains after each decision. Use only a disposable
   local target.
2. **Existing saved connection:** one root-level item, then one in a folder. Check both
   URL-confirmation settings and final keyboard focus.
3. **Available public Azure resource:** bare link **OR** database **OR** collection
   **OR** dashboard **OR** shell. Use a real resource you can access, not this document's
   synthetic GUIDs. Test vCore and RU if available; otherwise mark the other untested.
4. **Visibility:** hide the provider **OR** tenant **OR** subscription. One run with all
   applicable bullets is enough to review copy. Check the Azure Resources view effect,
   dismissal, and persistence after later failure/cancellation.
5. **Account paths:** signed out **OR** wrong tenant **OR** inaccessible subscription.
   Check sign-in dismissal and `Manage Azure accounts`. Do not mislabel this as a
   Government test.
6. **Target absence:** valid cluster plus missing database **OR** missing collection.
   Observe whether earlier connect/dashboard success contradicts the final wording.
7. **Available failure:** a disposable unavailable local endpoint can demonstrate A14's
   generic detail layout, but does not validate SRV or Entra translation. Read A15/A16
   for those exact authored variants instead of forcing network-wide DNS changes.
8. **Explicit destination:** auto-dashboard on **OR** off, shell **OR** database-scoped
   dashboard **OR** Collection View. Check focus, panel reuse, and scope.
9. **Visual/accessibility checks:** long details in Government/broker and SRV examples,
   keyboard dismissal/default action, readable raw errors, copyability, light/dark/high
   contrast. These remain unverified in a source-only preparation.

### Constructing review links

Use the [public URL guide](../../../../user-manual/how-to-construct-url.md) for encoding.
The following is a link-construction recipe, not an instruction to connect to fabricated
resources or put real credentials into a shared document:

```javascript
const prefix = 'vscode://ms-azuretools.vscode-documentdb';
const twice = (value) => encodeURIComponent(encodeURIComponent(value));

// Use a disposable local target; no username/password is embedded here.
const local = `${prefix}/connect?connectionString=${twice('mongodb://localhost:27017')}`;
const shell = `${local}&open=shell`;
const collection = `${local}&database=${twice('app')}&collection=${twice('orders')}`;

// Substitute an Azure resource ID you actually have permission to review.
const azure = (resourceId) =>
    `${prefix}/connect/azure?resourceId=${encodeURIComponent(resourceId)}`;

// Safe validation-only journeys: no database target is contacted.
const unsupportedAction = `${prefix}/unsupported`;
const missingResourceId = `${prefix}/connect/azure`;
const invalidTenant = `${prefix}/connect/azure?resourceId=${encodeURIComponent(
    '/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/review-rg/providers/Microsoft.DocumentDB/mongoClusters/review-cluster',
)}&tenantId=not-a-guid`;
```

### Verification and hand-off boundary

- Document-only preparation; no production code, localized strings, filters, or credentials
  changed.
- **Case 1 (still working), not a ready-for-review handoff.** No request was made to mark
  the PR ready. Full Case 2 checks, including `prettier-fix`, were not run for this pack.
- Source fidelity and local document links were checked. No build/runtime suite was needed
  for documentation-only changes; no cloud/DNS/installed-workbench success is claimed.
- The [implementation AI review](./03-azure-resource-links-review.md) is separate evidence;
  this UX preparation is not a replacement or a claim that PR handoff gates passed.
- Start the hands-on investigation from A1-A10 and report observations by presentation
  number. A15/A16 already expose the hard-to-reproduce message variants for inline review.
