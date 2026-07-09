# DocumentDB Local Quick Start — UX Review Pack

> **Who this is for:** anyone about to do a hands-on UX review of the **Local Quick Start** feature
> (installing/running a local DocumentDB container from inside VS Code), or anyone triaging the
> findings.
> **What this is:** a single catch-up document that captures a round of runtime UX feedback, states
> what the code _actually does today_ (verified against the current branch), and — for each item —
> offers a **suggestion** and a **status**. Items are **sorted by priority** (P0 → P3). Almost every
> item is **Open**: the operator must choose the direction.

- **Feature area:** `src/services/localQuickStart/`, `src/commands/localQuickStart/`,
  `src/tree/connections-view/LocalQuickStart/`, `src/webviews/documentdb/localQuickStart/`
- **Working branch:** `dev/tnaum/documentdb-quickstart-ux-review`
- **Related design docs:** [local-quickstart-v2.md](../../local-quickstart/local-quickstart-v2.md),
  [local-quickstart-poc/](../local-quickstart-poc/),
  [local-quickstart-multi-instance/](../local-quickstart-multi-instance/)
- **Scope:** the UX-facing surface (tree structure, wording, icons, the provisioning webview,
  lifecycle actions, error recovery). Backend/state-machine internals appear only where they explain
  a user-visible symptom.
- **Review date:** 2026-07-09

## How this review was run

A person exercised the real feature (install → run → stop → delete → break-it-externally) and dictated
observations; an AI assistant did the code-checking, root-cause tracing, and write-up. Each finding is
backed by the exact code path that produces the behavior, so a later implementation pass doesn't have
to re-derive it. Items are grouped and ordered **by priority**; each carries an **Observation** (what
the reviewer saw), a **Finding** (what the code does and why), a **Suggestion**, and a **Status**.
Heavier design questions with real trade-offs are pulled into [Open ideas](#open-ideas--options-pros--cons).

## Legend

### Priority

| Priority | Meaning                                            |
| -------- | -------------------------------------------------- |
| **P0**   | Blocking — the user gets stuck                     |
| **P1**   | Broken / misleading, or a consistency & safety gap |
| **P2**   | Polish, expectation, or a smaller feature gap      |
| **P3**   | Nice-to-have / cosmetic / acknowledged             |

### Status

| Status              | Meaning                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------- |
| 🟠 **Open**         | Recorded + analyzed; **the operator must choose the direction** (see the item's Suggestion) |
| 🟡 **Acknowledged** | Known and accepted; not planned now — may be revisited                                      |
| ✅ **Implemented**  | A change was made on this branch and verified                                               |

### Markers (inline)

| Marker            | Meaning                                                 |
| ----------------- | ------------------------------------------------------- |
| ⚠️ **Flag**       | Confirmed gap or bug                                    |
| 💡 **Suggestion** | A design/wording recommendation to react to             |
| 🔍 **Answered**   | A "how does this work?" question answered from the code |

> **For the operator:** almost everything below is **Open**. Each item states a recommended direction
> in its **Suggestion** (and, where there are real trade-offs, an entry under
> [Open ideas](#open-ideas--options-pros--cons)). Pick a direction per item; the review does not decide
> for you. Exactly **one** item is already **Implemented** (item 30). One is **Acknowledged** (item 27).

---

## The story in one paragraph

Local Quick Start adds a **`DocumentDB Local - Quick Start`** root node to the Connections view. From
an empty state a user clicks one row to open a **setup webview**, which checks Docker, pulls the image,
creates + starts a container, waits for readiness, and seeds sample data — reporting progress as a
stage checklist. Once running, the instance appears **inline** in the tree as a browsable cluster with
a Quick-Start-specific context menu (Start/Stop/Restart/Delete/Copy/View Logs). On upgrade, pre-existing
local "emulator" connections are migrated once into a regular folder. This review hammered the
_presentation and robustness_ of that journey. The two **P0** bugs are lifecycle dead ends (a
restart-time credential dead end and a silent no-op on Start after an external delete). The **P1** set
is the real header bug, two error-presentation anti-patterns (tree nodes and the webview hero both used
to display errors), plus destructive-action consistency and safety. The rest is polish, expectation,
data-model, and enhancement work. See [Appendix A](#appendix-a--current-webview-flow-reference) for the
webview flow.

---

## Priority index

| #   | Priority | Item                                                  | Status          |
| --- | -------- | ----------------------------------------------------- | --------------- |
| 1   | **P0**   | Credential-missing state is a restart dead end        | 🟠 Open         |
| 2   | **P0**   | External container delete → silent no-op on Start     | 🟠 Open         |
| 3   | **P1**   | Webview header stuck on "Setting up…"                 | 🟠 Open         |
| 4   | **P1**   | Tree nodes misused to display errors                  | 🟠 Open         |
| 5   | **P1**   | Error/status messages hijack the hero                 | 🟠 Open         |
| 6   | **P1**   | "Delete deletes data" vs "recreate/recover" clash     | 🟠 Open         |
| 7   | **P1**   | Copy Connection String silently copies the password   | 🟠 Open         |
| 8   | **P1**   | Delete bypasses the shared confirmation (+ em dashes) | 🟠 Open         |
| 9   | **P1**   | Only ever delete containers we created                | 🟠 Open         |
| 10  | **P2**   | Legacy migration folder hides in the sort             | 🟠 Open         |
| 11  | **P2**   | Phase out the "local connection" concept              | 🟠 Open         |
| 12  | **P2**   | "Checking Docker" is a bare spinner                   | 🟠 Open         |
| 13  | **P2**   | Advanced: creds toggle + ambiguous placeholders       | 🟠 Open         |
| 14  | **P2**   | "Cancel" implies a rollback it doesn't do             | 🟠 Open         |
| 15  | **P2**   | No "What was done" summary on completion              | 🟠 Open         |
| 16  | **P2**   | No upfront "first run takes a few minutes"            | 🟠 Open         |
| 17  | **P2**   | "Load sample data" is all-or-nothing                  | 🟠 Open         |
| 18  | **P2**   | "Waiting…" static for minutes                         | 🟠 Open         |
| 19  | **P2**   | No image-pull progress                                | 🟠 Open         |
| 20  | **P2**   | Running row lacks regular cluster commands            | 🟠 Open         |
| 21  | **P2**   | Credential storage is a bespoke plainer path          | 🟠 Open         |
| 22  | **P2**   | Always persistent — no ephemeral option               | 🟠 Open         |
| 23  | **P2**   | User delete must always drop the volume               | 🟠 Open         |
| 24  | **P2**   | Volumes not structurally linked to the image          | 🟠 Open         |
| 25  | **P2**   | Container keeps running after VS Code closes          | 🟠 Open         |
| 26  | **P2**   | Tree state changes not announced (accessibility)      | 🟠 Open         |
| 27  | **P3**   | Docker prereq only revealed after the click           | 🟡 Acknowledged |
| 28  | **P3**   | Generic `$(plug)` icon, no distinct identity          | 🟠 Open         |
| 29  | **P3**   | "Open terminal in the container"                      | 🟠 Open         |
| 30  | **P1\*** | Empty-state tree row reworded / "Learn more" dropped  | ✅ Implemented  |

> \* Item 30 was a P1-ish wording nit; it's the one item already shipped on this branch, so it's parked
> at the end under Implemented.

---

## P0 — Blocking (the user gets stuck)

### 1. Credential-missing state after a restart is a UI dead end (the demo incident) ⚠️

**Priority:** P0 · **Status:** 🟠 Open — operator to choose the direction (see Suggestion + Open idea O4).

**Observation (real incident, mid-review):** An instance was created via Quick Start, then stopped,
then its container/image were removed outside VS Code. After a **VS Code restart** the Quick Start node
showed the rocket _"Click here to start DocumentDB Local"_ row **plus** a warning row _"DocumentDB Local
has data on disk but its saved credentials are missing…"_ (truncated in the tree). There was **no way
from the UI** to delete the leftover container/volume or to start cleanly — no Delete node, no recreate
action. Recovery required manually removing the container and its volume with Docker, then refreshing.

**Finding:**

- On activation, `reconcile()` → `reconcileAlias()` hits **"Case 4"**: a labelled container (or a
  `ready` record) exists but the stored secret is unrecoverable, so it calls
  `setStatus(alias, InstanceState.Error, undefined, CREDENTIAL_UNAVAILABLE_MESSAGE)` with
  **`metadata: undefined`**. By design it **never** removes the container or volume (R2 data-safety: a
  lost secret doesn't prove the volume is disposable — the user must choose the wipe).
- Because `metadata` is `undefined`, `LocalQuickStartItem.getChildren()` skips every `metadata && …`
  branch and falls through to the **NotInstalled** branch, which renders the rocket action row **plus** a
  passive `treeItem_quickStartError` warning row carrying the message.
- ⚠️ That warning row has **no command and no context menu**, and the Delete command's `when` requires
  `treeItem_quickStartInstance` + a `state_*` token — which this surfaced state never carries. So
  **Delete is unreachable**, and unlike the true `Missing` row (which at least says "click to recreate")
  no recovery action is offered. The user is genuinely stuck.
- ⚠️ **Restart behavior specifically:** in-memory state is rebuilt from durable state on every reload, so
  this dead end **reproduces on every restart** — not a transient glitch. Clicking the rocket to "start
  fresh" doesn't help either: the on-disk volume + missing credentials block a clean provision, and
  item 2's silent-return path compounds it.
- **How we recovered (runbook):** removed the labelled container and its data volume directly with Docker
  (`docker rm -f vscode-documentdb-local` + `docker volume rm vscode-documentdb-local-data`), then
  refreshed; reconcile found nothing and returned to the clean NotInstalled empty state.

💡 **Suggestion:** The credential-unavailable state must be **actionable**, not a passive warning. Render
it like the `Missing` row — a real instance row (`treeItem_quickStartInstance` + a dedicated
`state_credentialsMissing` token) that exposes **Delete Container** (clean slate: container + volume +
stale records, via `deleteContainer()`, cf. item 23) and, where safe, **Recreate**. Keep R2 (never
_auto_-wipe) — but give the user a one-click way to _choose_ the wipe. Shares the recovery UX in Open
idea O4; a direct instance of item 4's principle.

### 2. A container deleted _outside_ VS Code isn't handled on Start (silent no-op) ⚠️

**Priority:** P0 · **Status:** 🟠 Open — operator to choose the direction (see Suggestion + Open idea O4).

**Observation (repro):** Created an instance via Quick Start, stopped it, then deleted the _container_
directly via Docker. Back in VS Code, clicking Start on the still-"Stopped"-looking row does nothing
visible — no dialog, no tree update — only the raw Docker error appears in the output channel:

```
$ docker container inspect --format '{{json .}}' 57f8311fd9ec…
Error response from daemon: No such container: 57f8311fd9ec…
```

**Finding — a specific, reproducible gap:**

- `ContainerRuntime.inspectContainer()` wraps the CLI call in `try { … } catch { return undefined; }`,
  swallowing "No such container" into `undefined`. But the shared `makeRunner()` still logs the command
  and streams the daemon's stderr to the channel — that's exactly the two lines the user saw (the
  extension's own inspect call, not a manual terminal session).
- `start()` calls `isManaged(id)` first, which returns `false` both when the container **isn't ours**
  _and_ when it's **gone** (`inspectContainer` → `undefined`). ⚠️ **`isManaged()` cannot distinguish
  "missing" from "not ours."**
- `start()`'s guard is `if (!id || !isManaged || !liveStateGuard(…)) return;`. Because `isManaged` already
  returned `false`, the `||` short-circuits and **`liveStateGuard()` never runs** — the very code that
  _would_ have handled this gracefully (it detects a `'missing'` live state, calls `refreshLiveState()`,
  and shows an info message). That path is well-built for the multi-window / external-stop case; it's just
  unreachable here.
- Net effect: `start()` early-returns silently, `setStatus` never fires, the tree never refreshes, and the
  stale "Stopped" row persists until something else (e.g. collapsing/expanding the node) triggers
  `refreshLiveState()` independently.
- There's already a good pattern for the related case: `refreshLiveState()` _does_ set `entry.missing = true`
  and the tree renders `Missing · click to recreate`. The gap is that the **lifecycle actions**
  (`start`/`stop`/`restart`) don't funnel through that missing-detection before giving up.

💡 **Suggestion:** Teach `start`/`stop`/`restart` to distinguish "no container found" from "found but not
ours" (a small change to `isManaged`, or a check ahead of it) and, on "missing," do what `liveStateGuard`
already does — refresh state to the `Missing` badge and surface a message with next steps: **Delete** and/or
**Recreate with same settings** (the existing `Missing` recreate flow + `getReusableCredentials()` likely
covers most of it — confirm once reachable). Options in Open idea O4.

---

## P1 — Broken / misleading, or consistency & safety

### 3. The webview header changes with state and gets stuck on "Setting up…" ⚠️

**Priority:** P1 · **Status:** 🟠 Open — operator to choose the direction.

**Observation:** The header should be static. Today it changes with status/progress/errors, and it
sometimes stays on "Setting up DocumentDB Local…" even when setup is actually complete.

**Finding** (in [LocalQuickStart.tsx](../../../../src/webviews/documentdb/localQuickStart/LocalQuickStart.tsx)):
the header ("hero") is rendered by a local `hero(title, subtitle)` helper called with **three different
literal titles** depending on `phase`: `'Docker is required'` (dockerNotReady), `'Setting up DocumentDB
Local…'` (**provisioning, success, _and_ failed all share this one call**), and `'Start DocumentDB Local'`
(review). Both halves of the observation are confirmed:

- ⚠️ The title genuinely changes across phases (three strings), reading as a jumpy header.
- ⚠️ **The "stuck" complaint is a real bug:** `success` and `failed` reuse the `provisioning` title
  verbatim, so "Setting up DocumentDB Local…" is still shown even once the instance is running or has
  definitively failed. Only the body below reflects the outcome — the header never catches up. (A
  phase/stage-aware `provisioningStatusMessage` exists but is only piped to a screen-reader-only live
  region, not shown visually.)

💡 **Suggestion:** Make the header a **single static string** for the whole panel lifecycle (e.g.
"DocumentDB Local"), and let the subtitle/body carry all state (elapsed timer, success/failure boxes
already exist). That satisfies "header should be static" and eliminates the stuck-text bug in one move. If
a dynamic header is preferred, it must at minimum branch on `success`/`failed` the way `dockerNotReady`
already does.

### 4. Tree nodes are misused to display errors (they should be actions, not dialogs) ⚠️💡

**Priority:** P1 · **Status:** 🟠 Open — operator to choose the direction.

**Observation:** A broader pattern problem exposed by the incident (item 1) — we render an **error message
as a tree node**. Leaf/error nodes should be **actions the user can take**, not a substitute for a dialog
or a status surface.

**Finding:**

- Several Quick Start states render a passive, non-actionable row purely to display text:
  `treeItem_quickStartError` (the credential-unavailable / error message, item 1), and the empty state also
  **appends** an error row when `status.state === Error && errorMessage`. These rows have no command and no
  menu — they exist only to show a string, which then **truncates** in the tree (the incident's "…saved
  credentials are miss…"), can't be copied, and competes visually with the real action row.
- This contradicts where the rest of the extension landed. The **Kubernetes discovery** review reached
  exactly this conclusion and reversed it: classified in-tree error-summary nodes were **removed** in favor
  of a **modal** (`showErrorMessage(…, { modal: true })`) plus a single actionable retry node. Quick Start
  currently repeats the anti-pattern the K8s feature already retired.

💡 **Suggestion:** Adopt the same rule feature-wide: **tree rows are actions; errors are dialogs / status.**
(a) surface an error/credential-unavailable condition as a **modal** (detail in the output channel), and
(b) keep **only actionable rows** in the tree (Delete / Recreate / Retry / "Click here to…"). This removes
the passive `treeItem_quickStartError` and the error-append row and directly fixes item 1's dead end. It
also rhymes with item 3 (the webview header carrying status it shouldn't) — the same "don't overload one
surface with state it isn't meant to hold" theme.

### 5. Error/status messages must leave the hero — show a content-area card; run a small UX experiment ⚠️💡

**Priority:** P1 · **Status:** 🟠 Open — operator to choose the direction (a UX experiment is requested).

**Observation:** We have error/status states (e.g. Docker missing). The core requirement: these messages
**must not live in the hero section** — the hero stays constant and the message becomes a **card in the
content area** with the actions the user can perform. Query Insights already has good building blocks — not
just the `MessageBar`, but the **richer composed card** shown when an RU user opens the Query Insights tab;
the two **could be combined**. Because it isn't obvious which shape reads best, whoever implements this
should **render a few options to compare**. We also need to decide **where Retry lives**.

**Finding:**

- ⚠️ Today an error is handled by switching to a **dedicated phase that replaces the hero**: `dockerNotReady`
  swaps the hero to _"Docker is required"_ and renders a bespoke full-screen layout (three readiness cards +
  a "How to fix" card + a bottom `Retry`); the `failed` phase similarly shows an error box with the hero
  **stuck** on _"Setting up…"_ (item 3). So the message is **coupled to the hero**.
- 🔍 **Query Insights ships two reusable shapes**, both leaving the header/title untouched:
  - **Concise inline `MessageBar`.**
    [`GetPerformanceInsightsCard.tsx`](../../../../src/webviews/documentdb/collectionView/components/queryInsightsTab/components/optimizationCards/custom/GetPerformanceInsightsCard.tsx)
    renders a Fluent `MessageBar` when `errorMessage` is set and **relabels its primary button to "Retry"**:
    `{errorMessage ? l10n.t('Retry') : l10n.t('Get AI Performance Insights')}`. The card title never changes.
    [`ImprovementCard.tsx`](../../../../src/webviews/documentdb/collectionView/components/queryInsightsTab/components/optimizationCards/ImprovementCard.tsx)
    uses the same `MessageBar intent="warning"` / `"success"` blocks for per-action state.
  - **Richer composed card (the RU-tab card).**
    [`QueryInsightsTab.tsx`](../../../../src/webviews/documentdb/collectionView/components/queryInsightsTab/QueryInsightsTab.tsx)
    (the `QUERY_INSIGHTS_PLATFORM_NOT_SUPPORTED_RU` branch) renders a **`MarkdownCardEx`** — icon + title +
    markdown body + a call-to-action — and **nests a `MessageBar` inside it** for the concise status line. So
    "card" and "message bar" are **already combined** there.

💡 **Suggestion:**

1. **Get the message out of the hero.** Keep the hero **static** (item 3) and render error/status as a
   **content-area card**, never as a hero swap or a full-screen phase. Applies to docker-not-ready and `failed`.
2. **Combine the two shapes, and experiment.** Render a few candidate variants to compare, e.g.: **A** plain
   `MessageBar` + inline Retry (lightest); **B** composed card (`MarkdownCardEx`-style: icon + title + body +
   actions); **C** combined (composed card **containing** a `MessageBar`, matching the RU tab). Test A/B/C
   against the real states (Docker missing, provisioning failed, readiness timeout) and pick per-state.
3. **Retry placement:** put `Retry` **on the chosen card**, next to the other recovery actions, following the
   Query Insights convention of relabeling the card's primary action to "Retry." The retry logic already
   exists (`loadDockerStatus` / `handleStart`); only its home changes.
4. Pairs with item 4 (tree side) — the same principle applied to the webview.

### 6. "Delete deletes data" vs "Recreate / recover" — resolve the contradiction ⚠️💡

**Priority:** P1 · **Status:** 🟠 Open — operator to choose the direction (a discussion is requested).

**Observation:** We tell the user that **deleting deletes the data** — so then what does **recreate /
recovery** mean? The two messages appear to contradict each other.

**Finding / the tension:**

- **Delete Container** is a permanent wipe: it removes the container **and the data volume** and all stored
  creds/records (items 8 / 23) — "this cannot be undone."
- The recovery flows for `Missing` / credential-unavailable (items 1 / 2) offer **"Recreate with same
  settings,"** meaningful only because the **data volume is kept** and stored credentials are reused
  (`getReusableCredentials`). "Recreate" = "the container vanished but your data on the volume survived;
  rebuild the container onto it."
- Both are true but the vocabulary collides: **Delete** = destroy the data (no recovery); **Recreate** =
  recover _because_ the data was not deleted (the container went away, not the volume).

💡 **Discussion / suggestion:** Make the model explicit by separating **container** from **data**:

- **Option (a) — one Delete that always wipes both (current).** Then "recreate" appears **only** when the
  _container_ was lost externally but the volume remains, and its copy must say _"your data on disk is intact
  — this rebuilds the container onto it,"_ never implying it undoes a Delete.
- **Option (b) — split the verbs:** **Remove container (keep data)** vs **Delete everything (container +
  data).** Then "recreate" pairs naturally with the keep-data path; no contradiction. Cleaner, more surface.

> Whichever is chosen, never present "recreate / recover" and "deleting deletes your data" as if they act on
> the **same** object. Pairs with Open idea O4 (recovery affordance) and O6 (volume model).

### 7. "Copy Connection String" is a separate impl and silently includes the password ⚠️

**Priority:** P1 · **Status:** 🟠 Open — operator to choose the direction.

**Observation:** Copy Connection String seems reimplemented for Quick Start and behaves slightly differently
— it doesn't ask whether to include the password.

**Finding:** Regular clusters use `copyConnectionString()`
([copyConnectionString.ts](../../../../src/commands/copyConnectionString/copyConnectionString.ts)), which
prompts via `showQuickPick` ("with password" vs "without password", gated by `canIncludeNativePassword()`)
and is well-tested. Quick Start uses a **separate, shorter** `copyQuickStartConnectionString()`
([localQuickStartCommands.ts](../../../../src/commands/localQuickStart/localQuickStartCommands.ts)) that
copies `metadata.connectionString` (password already embedded) **with no prompt** — a genuine behavioral
difference. ⚠️ A plaintext password always lands on the clipboard silently, which stands out given how
careful the rest of the feature is about credentials (masked logging, env-file instead of CLI args). There
is a _separate_ `copyQuickStartPassword()` command, but the connection-string action itself never asks.

💡 **Suggestion:** Reuse the regular command's QuickPick confirmation for parity (Quick Start always uses
native auth, so no extra branching is needed), or — if the extra click is unwanted for a one-click-local
flow — at minimum make the two commands' behavior a **conscious, documented** choice rather than an
incidental divergence.

### 8. "Delete Container" bypasses the shared confirmation and uses em dashes ⚠️

**Priority:** P1 · **Status:** 🟠 Open — operator to choose the direction.

**Observation:** The Delete Container modal is fine conceptually, but it should use the same delete
confirmation code path as other destructive actions (like in Settings), and shouldn't use em dashes.

**Finding:**

- ⚠️ Every other destructive command — [removeConnection](../../../../src/commands/removeConnection/removeConnection.ts),
  [deleteCollection](../../../../src/commands/deleteCollection/deleteCollection.ts),
  [deleteDatabase](../../../../src/commands/deleteDatabase/deleteDatabase.ts),
  [folder delete](../../../../src/commands/connections-view/deleteFolder/ConfirmDeleteStep.ts) — calls
  **`getConfirmationAsInSettings()`** ([getConfirmation.ts](../../../../src/utils/dialogs/getConfirmation.ts)),
  which honors the user's `confirmationStyle` setting (type-the-word / number challenge / click).
  `deleteQuickStartInstance()` instead calls **`getConfirmationWithClick()`** directly, ignoring that
  setting — the only _destructive_ command that does (the other direct callers are non-destructive:
  `hideIndex`/`unhideIndex`).
- ⚠️ Its two confirmation `detail` strings both contain a literal **em dash** ("…This cannot be undone — you
  can recreate…"). The character also appears across the feature's other strings (`LocalQuickStart.tsx`
  next-steps bullets, the item 18 timeout message).

💡 **Suggestion:** Switch Delete Container to **`getConfirmationAsInSettings()`** for consistency (decide the
confirmation word — a simple `delete` matches the other delete flows). Separately, do a **one-pass em-dash
sweep** of the whole feature's user-facing strings rather than fixing only the delete dialog.

### 9. We should only ever delete containers we created (pre-release safety) ⚠️

**Priority:** P1 · **Status:** 🟠 Open — operator to choose the direction (pre-release must-fix).

**Observation:** Not urgent now, but must be addressed **before final release**: we should be allowed to
delete **only** the containers we created.

**Finding:** 🔍 Removal is already label-guarded in the normal path — `deleteContainer()` only removes when
`entry.missing || isManaged(id)`, and `isManaged()` verifies the `vscode.documentdb.quickstart` label. But
there are softer spots: on `entry.missing` the label re-check is **skipped** (the id comes from metadata /
`findManagedContainer`, which filters by label, so it is _currently_ safe but relies on that invariant), and
`ContainerRuntime.removeContainer()` itself does **no** label check. As the feature grows (multi-instance,
user-named containers, more recovery flows), an id-based delete without a label re-verify is a latent risk.

💡 **Suggestion:** Before final release, make "ours" a **hard precondition on every removal** — re-verify the
`vscode.documentdb.quickstart` label immediately before `removeContainer` / `removeVolume`, regardless of the
`missing` shortcut, so no code path can ever remove a container or volume the extension didn't create.

---

## P2 — Polish, expectation, or feature gap

### 10. Legacy emulator connections migrate to a folder that can hide in the sort order ⚠️🔍

**Priority:** P2 · **Status:** 🟠 Open — operator to choose the direction (see Open idea O1).

**Observation:** Is the one-time migration of original "DocumentDB Local" emulator connections still
happening? What's the folder called? Sorting could place it somewhere unexpected.

**Finding:**

- 🔍 Yes, it's still active. The migration lives in
  [legacyEmulatorMigration.ts](../../../../src/services/legacyEmulatorMigration.ts), invoked from
  [ClustersExtension.ts](../../../../src/documentdb/ClustersExtension.ts) on every activation
  (`migrateLegacyEmulatorConnections`), guarded by a `globalState` flag so it runs once.
- 🔍 The destination folder is **`Local Connections (Legacy)`** (`LEGACY_FOLDER_BASE_NAME`), deterministic id
  `vscode-documentdb.legacyLocalConnectionsFolder`; a name clash is suffixed `(2)`, `(3)`, … It is a **normal**
  renamable/movable folder under the Clusters zone. Emulators-zone sub-folders are intentionally **flattened**
  into this one folder. The old `Emulators` zone/`LocalEmulatorsItem` node is kept as a read-only rollback
  until migration succeeds, then retired.
- ⚠️ **Why it can surprise:** root items are assembled Quick Start node → legacy emulator node (if un-migrated)
  → **all folders, alphabetically** → ungrouped connections → New Connection. Folders sort with a single
  `localeCompare(..., { numeric: true })` pass with **no special-casing**, so the legacy folder lands wherever
  "L…" falls — easy to miss right after an upgrade. No migration toast surfaced in this pass.

💡 **Suggestion:** Make the destination discoverable: (a) a **one-time toast** with a "Reveal" action; and/or
(b) a distinct badge/icon; and/or (c) pin it; the cheapest code-free option is (e) prefix the name with `_`.
See Open idea O1.

### 11. Phase out the "local connection" concept — a localhost connection is just a connection 💡

**Priority:** P2 · **Status:** 🟠 Open — operator to choose the direction (a cleanup epic, not one PR).

**Observation:** Ideally we **phase out** the notion of a special "local connection" entirely. A connection to
`localhost` is just a **regular connection that happens to point at localhost**. Once that lands there is no
separate "Local Connections" bucket, no emulator zone, no special-casing — which requires a **sweep of the
documentation, menus, commands, and wording**.

**Finding / scope:**

- Today the code still carries the legacy split: an `Emulators` storage zone, `LocalEmulatorsItem`,
  `emulatorConfiguration.isEmulator`, the migration to `Local Connections (Legacy)` (item 10), and the Quick
  Start managed instance (a bespoke non-standard node, item 20). Several menus / `when`-clauses key off
  `treeItem_LocalEmulators` and `isEmulator`.
- End state: a localhost connection is a normal `DocumentDBClusterItem` in the regular Clusters zone;
  "emulator-ness" (e.g. allow-invalid-TLS) becomes a **property of the connection**, not a separate class /
  zone / tree node.

💡 **Suggestion:** Track as an explicit **deprecation/cleanup epic**: (a) inventory every place that
special-cases "local/emulator"; (b) collapse them onto "a regular connection to localhost"; (c) keep only the
minimal per-connection flags a local target needs. Item 10's legacy folder and the Quick Start node (item 20)
both fold into this end state.

### 12. The initial "Checking Docker" loading should render chrome + skeleton cards (reuse the metric card) ⚠️💡

**Priority:** P2 · **Status:** 🟠 Open — operator to choose the direction.

**Observation:** The initial `loading` ("Checking Docker") state should behave like the **Query Insights**
view: the chrome renders immediately (title + header), and the cards behave like our **metrics cards** — a
**loading skeleton** while status resolves, then fill **independently** (backend split not needed now). Worth
**reusing the existing metric card** — it's accessible and has tooltip support.

**Finding:**

- ⚠️ The `loading` phase renders **only** `<Spinner label="Checking Docker…" />` in an otherwise empty panel —
  no hero, no cards (see Appendix A). When `getDockerStatus` resolves, the panel **snaps** to the full layout.
- 🔍 The readiness/config cards use a **local, simplified** `MetricCard` inline in `LocalQuickStart.tsx` — no
  skeleton, no tooltip, weaker a11y.
- 🔍 Query Insights ships a purpose-built, accessible card: **`MetricBase`** at
  [MetricBase.tsx](../../../../src/webviews/documentdb/collectionView/components/queryInsightsTab/components/metricsRow/MetricBase.tsx)
  — **loading skeleton** (`value === undefined` → `SkeletonItem`), null/unavailable placeholder, **tooltip
  explanations**, and a solid **accessibility** pattern (focusable card, aria-label, aria-hidden children).

💡 **Suggestion:** (1) Rework `loading` to render the **hero immediately** and the readiness cards in
**skeleton** state, each flipping to its value independently. (2) **Reuse `MetricBase`** instead of the local
`MetricCard` — it needs a small **extension** (a badge slot for the ✓/! readiness badge) and **relocation to a
shared** location (it's currently buried under `collectionView/queryInsightsTab/`; importing it into Quick
Start is the wrong dependency direction). Worth it: one accessible, tooltip-capable card shared across features.

### 13. Advanced panel: credentials should sit behind a toggle, and "placeholder = default" is ambiguous ⚠️💡

**Priority:** P2 · **Status:** 🟠 Open — operator to choose the direction (options to weigh below).

**Observation:** Username + password should be grouped **behind a toggle** — the user flips "override the
default" and only then specifies them. The ghost text **"auto"** is confusing (is it the default _value_?).
And the panel label says _"Leave any field blank to keep the automatic default,"_ yet the **Image tag** field
shows **"latest"** as ghost text — so how does the user "keep it blank"?

**Finding** (`renderAdvanced()` in `LocalQuickStart.tsx`):

- On a fresh provision (`!isRecreate`) the panel renders Port, Image tag, Username, Password (always visible) +
  a "Load sample data" switch, under "Leave any field blank to keep the automatic default."
- ⚠️ **Placeholder means two different things.** Port's placeholder is the literal default (`10260`), Image
  tag's is the literal default tag (`latest`) — but Username/Password use **`'auto'`**, a _description of
  behavior_. So "latest" reads as a set value, while "auto" reads as a mode; combined with "leave blank," the
  greyed-in `latest` makes it unclear whether the field is pre-filled or empty.
- 🔍 The credentials already follow a **both-or-neither** rule in `advValidation`; a toggle would encode that
  structurally.
- 🔍 On a recreate the credential/tag fields are already hidden — so this only concerns fresh provisioning.

💡 **Suggestion:** (1) **Group credentials behind a toggle** ("Override generated credentials," off by
default; off → a read-only "Auto-generated, stored securely" note; on → reveal both fields, required
together) — removes the `'auto'` ghost text entirely. (2) **Resolve the placeholder ambiguity**, options to
weigh: **A** drop literal-value placeholders and keep the default only in the `hint` line (cheapest, most
consistent); **B** pre-fill the actual default value and drop the "blank" concept; **C** a per-field "Use
default" affordance (heavier). Leaning **A**. Whichever is chosen, apply the **same** convention to every
Advanced field.

### 14. What does "Cancel" do mid-provision? Consider the verb "Abort" (no full rollback promise) ⚠️💡

**Priority:** P2 · **Status:** 🟠 Open — operator to choose the direction.

**Observation:** Investigate what **Cancel** does while provisioning is in progress. Do we **delete an image
that started downloading**, or just abort? A clean rollback is hard to promise, so **"Abort"** may be a cleaner
verb — "Cancel" implies cancel-and-roll-back.

**Finding** (traced in `provision()`, `QuickStartService.ts`): **abort, with partial cleanup — but the image is
kept.** On cancel (Cancel → `AbortSignal` → `onAbort` fires `cts.cancel()`):

- 🔍 The in-flight Docker command is **aborted** via the cancellation token — a `docker pull` stops promptly.
- 🔍 In `finally`, cleanup is **container-scoped only** (D12): a created container is stopped + removed; an
  uncaptured-id orphan is swept by label; the temp env-file is deleted; state resets `Provisioning →
NotInstalled`.
- ⚠️ **The image is never deleted.** Nothing calls `removeImage`; already-fetched layers **stay in Docker's
  cache** (by design — a resumable/cached pull makes the next attempt fast). So Cancel is a **partial** rollback:
  the container is removed, the image download is retained.

💡 **Suggestion:** (1) **Rename to "Abort"** (or "Stop setup") — "Cancel" over-promises. (2) **Say what's kept**
by the button ("Stops setup. The downloaded image is kept so a retry is faster."). (3) **Confirm per phase**
(pull/creating/starting/waiting) that nothing orphans besides the intentional image cache. (4) If a full
"remove everything incl. image" is ever wanted, make it a **separate explicit** action, never the default.

### 15. On completion, show a "What was done" summary card — below the content ⚠️💡

**Priority:** P2 · **Status:** 🟠 Open — operator to choose the direction.

**Observation:** When a deployment completes, the info card should render **below** the other content (not
above), and carry a **summary of what was done** — a table-ish block like the review screen's "what we'll do"
summary, but framed as **"What was done."**

**Finding:**

- The `review` phase already renders a summary (`renderSummary()` in `LocalQuickStart.tsx`) — a labeled
  key/value block (image, port, data, credentials, lifetime). The `success` phase instead shows a free-text
  success box + a "Next steps" list, with **no structured recap**, and that content sits high in the layout.
- Because the real values are only known **after** provisioning (a **port fallback** may have moved the
  instance off 10260), a recap is the natural place to surface them — today the actual port / credentials /
  connection string aren't summarized anywhere in-panel.

💡 **Suggestion:** Add a **"What was done"** summary card mirroring `renderSummary()`, rendered **below** the
next-steps / actions, listing the **actual** result: image + resolved tag, **actual bound port** (flag if it
differs from the default), data mode (persistent/ephemeral), credentials (auto/custom, stored securely), and
the connection string with its copy affordance. Gives a clean "review → result" symmetry and finally surfaces
the real port.

### 16. Set an upfront "the first run can take a few minutes" expectation 💡

**Priority:** P2 · **Status:** 🟠 Open — operator to choose the direction.

**Observation:** Whatever we can do to set expectations up front — a cold first run is genuinely long.

**Finding:** A first provision does a lot — Docker pull, container create/start, a readiness wait of up to
`READINESS_TIMEOUT_MS = 180_000` (3 min, item 18), plus first-run TLS cert generation and sample-data seeding.
The only time cue today is the elapsed counter ticking up.

💡 **Suggestion:** State the expectation before / at the start of provisioning — a one-liner on the review
screen ("The first run downloads the image and initializes the database; this can take a few minutes") and/or
a provisioning subtitle. Later runs are fast (image cached, item 14), so the copy can distinguish "first run"
from a restart.

### 17. "Load sample data" is all-or-nothing — add a choice of test data ⚠️💡

**Priority:** P2 · **Status:** 🟠 Open — operator to choose the direction.

**Observation:** The sample-data option is all-or-nothing today. We'll have to add **options to choose the test
data** (which dataset, or none).

**Finding:** `AdvancedQuickStartOptions.loadSampleData` is a single boolean; when true the image's built-in
init seeds one fixed `sampledb` (users / products / orders / analytics) once, post-readiness (exec-once).
There's no way to pick a dataset, see what it contains, or reseed later.

💡 **Suggestion:** Replace the boolean with a **dataset choice** (None / the current sample / future named sets),
ideally with a one-line description of each. Keep exec-once semantics per dataset; sets up a later
"reset/reseed." Scope depends on what datasets the image can provide — confirm with the image owners.

### 18. "Waiting for DocumentDB to accept connections" can sit static for minutes ⚠️

**Priority:** P2 · **Status:** 🟠 Open — operator to choose the direction.

**Observation:** This message could be reworded, or show intermediate progress as sub-info, since it can take a
while.

**Finding:** The stage label is `'Waiting for DocumentDB to accept connections'`. It wraps `waitForReadiness()`
in `QuickStartService.ts`, which polls the wire protocol with a **`READINESS_TIMEOUT_MS = 180_000` (3 min)**
budget and a 3 s per-attempt timeout. During that window the stage row shows only a spinner + the same static
label — ⚠️ **no in-panel sub-status**. Logs stream to the output channel via `followLogs` the whole time, just
not in the panel. On timeout a distinct `ReadinessTimeoutError` (kept separate so the container is preserved for
"Wait longer") shows the `failed`/`timedOut` message (contains an em dash — item 8).

💡 **Suggestion:** Add a lightweight **sub-info line** while active — an **in-stage elapsed timer** and/or a
rotating reassurance after N seconds ("first run generates TLS certs, this can take a minute"). Consider
surfacing "View Docker output" _during_ this stage (it currently only appears at the bottom).

### 19. No structured progress while the image downloads ⚠️

**Priority:** P2 · **Status:** 🟠 Open — operator to choose the direction (see Open idea O2).

**Observation:** Do we track progress while the image is pulled? It's a long-running op too.

**Finding:** ⚠️ No. `provision()` yields one `active` event (`'Pulling the official image…'`), awaits
`pullImage()`, then one `done` event — nothing in between. `ContainerRuntime.pullImage()`
([ContainerRuntime.ts](../../../../src/services/localQuickStart/ContainerRuntime.ts)) runs `docker pull`
through the shared CLI shell-runner, piping stdout/stderr **only** to the output channel. Docker's per-layer
progress is visible only as raw channel text, never in the webview — a spinner + static label for the whole
pull, same as item 18.

💡 **Suggestion:** Give the pull an **indeterminate but alive** treatment — a Fluent UI **indeterminate
`ProgressBar`** + a small live **"N of M layers"** sub-label (count distinct layer ids vs. `Pull complete`
lines). Full options in Open idea O2.

### 20. The running-instance row doesn't share regular cluster context commands 🔍

**Priority:** P2 · **Status:** 🟠 Open — operator to choose the direction (see Open idea O3).

**Observation:** The running managed instance doesn't share context-menu commands with regular clusters. Do we
still extend the cluster base class? If not, what would break if we did?

**Finding:**

- 🔍 Yes — `QuickStartClusterItem extends DocumentDBClusterItem`. It overrides `getTreeItem()` only to force the
  state-aware description and reuses the base for icon/tooltip/browsing.
- 🔍 Regular commands don't appear because the **contextValue is fully replaced, not extended:** the constructor
  sets `contextValue = createContextValue([INSTANCE_CONTEXT, stateToken])` — `treeItem_quickStartInstance` +
  `state_running` — discarding the base's `treeitem_documentdbcluster` token every regular-cluster `when`-clause
  matches on. Deliberate (show Quick Start lifecycle actions "instead of the generic cluster menus").
- 🔍 **What would break if kept too:** the generic commands assume a **stored** connection (`removeConnection`,
  `moveItems`/`renameConnection`, `update*` all hit storage). The Quick Start instance is **in-memory only**, so
  those would act on a record that doesn't exist — silent no-ops/exceptions — unless each special-cased this row.
  So full replacement avoids a bug class, but throws out useful storage-independent commands (e.g. "Open in Shell").

💡 **Suggestion:** Keep the curated menu, but **add back storage-independent commands explicitly** ("Open in
Shell" / "New Query"). The clean version is splitting the base contextValue into storage vs connection subsets —
Open idea O3.

### 21. Credential storage: reuse the extension's secure-storage patterns 💡

**Priority:** P2 · **Status:** 🟠 Open — operator to choose the direction.

**Observation:** Flag the plaintext-password posture. Everything else is careful (masked logs, env-files), yet
the generated password is embedded in the stored connection string and is one-click copyable/visible. **Think
about clean storage** — can we use our **storage services**? There's solid secret-management already; we can
**replicate / copy** those patterns. No big refactor needed.

**Finding:**

- Quick Start stores its connection string (credentials embedded) via `ext.secretStorage` under a per-alias key
  (`secretKey(alias)`) and primes `CredentialCache` from it — a bespoke path, separate from how regular
  connections handle secrets.
- The extension already has a mature secure-storage layer (`ConnectionStorageService` + its credential/secret
  handling), with established patterns for storing/retrieving credentials cleanly and gating exposure. Quick
  Start doesn't reuse it (by design it's "not stored in any zone," item 20), so it re-implements a thinner version.

💡 **Suggestion:** Align Quick Start's credential handling with the existing secure-storage patterns — reuse
`ConnectionStorageService`'s secret mechanisms or **copy the same approach** (replicating is fine). Goal: one
consistent, audited way to store/expose local credentials. Ties into item 11: if local instances become regular
connections, they inherit this storage naturally.

### 22. Persistence is always on — there's no "ephemeral / no-persistence" option 💡

**Priority:** P2 · **Status:** 🟠 Open — operator to choose the direction (see Open idea O6).

**Observation:** Our default is a persistent data volume. That should be a **toggle** — sometimes a user wants a
throwaway instance with no persistence.

**Finding:** 🔍 `AdvancedQuickStartOptions`
([quickStartTypes.ts](../../../../src/services/localQuickStart/quickStartTypes.ts)) exposes `port`, `username`,
`password`, `imageTag`, `loadSampleData` — but **no persistence flag**. `createAndRunContainer()` **always**
mounts a named volume (`volumeName(alias)` at `QUICK_START_DATA_PATH`). Every instance is persistent by
construction; no way to opt out.

💡 **Suggestion:** Add an Advanced toggle **"Persist data across restarts"** (default **on**). When **off**,
create the container **without** the named-volume mount so data lives only in the writable layer and is gone on
delete — good for throwaway trials. Trade-offs in Open idea O6.

### 23. A user-initiated delete must always delete the data volume ⚠️

**Priority:** P2 · **Status:** 🟠 Open — operator to choose the direction.

**Observation:** When the user deletes a container, we should for sure delete the persisted volume as well.

**Finding:** 🔍 The explicit **Delete Container** path already does this: `deleteContainer()` calls
`removeVolume(volumeName(alias))` alongside the secret / globalState / registry cleanup — an intentional "full
clean slate." Two caveats: (a) the credential-unavailable **reconcile** path deliberately does **not** touch the
volume (R2, item 1), correct for an automatic path but it means the _user-initiated_ delete must remain the thing
that wipes it; (b) once item 1 makes the credential-unavailable state actionable, its Delete must route through
this same volume-removing path.

💡 **Suggestion:** Keep explicit Delete = remove container **+ volume** (already the case). Ensure every
**user-initiated** delete surface funnels through `deleteContainer()` so a volume is never orphaned. Automatic /
reconcile paths keep R2 (never auto-wipe without the user choosing it).

### 24. Data volumes should be linked to the image — no shared data volumes 💡

**Priority:** P2 · **Status:** 🟠 Open — operator to choose the direction (see Open idea O6).

**Observation:** Our persisted volumes should be **linked to the image**. We won't share data volumes across
images; advanced users can do that themselves.

**Finding:** 🔍 Today the volume is keyed to the **alias** (`${alias}-data`), independent of the image. To stay
safe, the service **pins the image to the volume**: on a recreate it reuses the stored `imageRef` rather than
the user's requested tag, and custom image/creds are ignored on a Missing-recreate — so an existing volume isn't
opened by a different image version that could corrupt it. So the intent ("one image ↔ one volume") is enforced
by _runtime pinning_, but the volume is not _named/keyed_ by image.

💡 **Suggestion:** Make the linkage **structural** — key or label the volume by its image so "one image ↔ one
data volume" is guaranteed even if the pinning logic changes. Do **not** implement cross-image volume sharing;
leave that to advanced users operating Docker directly.

### 25. The container keeps running after VS Code closes — decide the desired behavior ⚠️💡

**Priority:** P2 · **Status:** 🟠 Open — genuinely undecided; needs a pros/cons evaluation (Open idea O7).

**Observation:** Non-standard for an extension-managed local resource (a user may expect it to stop like a dev
server), and can leave an orphaned container holding a port + RAM.

**Finding:** By design the instance is durable across window reloads — `reconcile()` re-adopts a still-running
container on activation (item 1) — and the success screen explicitly says it "keeps running after VS Code
closes." There's no "stop on exit" option and no prompt on close.

💡 **Suggestion:** Treat as an **open decision** — pros/cons in Open idea O7. Don't change behavior without
deciding; whatever is chosen should be **explicit** (a setting and/or clear copy) rather than implicit.

### 26. Tree state transitions aren't announced — accessibility work item (post-redesign; discuss with Tomasz) ⚠️

**Priority:** P2 · **Status:** 🟠 Open — sequenced work item; **owner/approach to be agreed with Tomasz.**

**Observation:** The webview is carefully accessible, but the **tree** state rows (Starting / Stopping / Missing
/ Running) change only their `description` text + icon, with no live-region announcement, so screen-reader users
don't hear the instance change state. This should be worked on **once the webview redesigns finish**, applying
our **learnings from past accessibility testing**. **Discuss with Tomasz.**

**Finding:** State changes fire `onDidChangeStatus` → `refresh()`, re-rendering the row, but VS Code tree views
have no built-in live region, so a `description` change (e.g. "Starting…" → "Running · localhost:10260") is
silent to assistive tech. The webview, by contrast, uses `Announcer` / `aria-live` deliberately.

💡 **Suggestion (requirement, sequenced):** After the webview redesign lands, do a dedicated accessibility pass on
the tree — announce meaningful state transitions (within VS Code tree API limits), carry state in accessible
labels, and apply the patterns from prior accessibility testing. **Owner / priority / approach to be agreed with
Tomasz** before implementation.

---

## P3 — Nice-to-have / cosmetic / acknowledged

### 27. Docker prerequisite is only revealed after opening the webview 🔍

**Priority:** P3 · **Status:** 🟡 Acknowledged — "it is what it is" for now; may be revisited.

**Observation:** The empty-state row invites "Click here to start DocumentDB Local," but the hard **Docker
requirement** only surfaces once the webview opens (the `dockerNotReady` screen). Recorded so it isn't
re-discovered later as a surprise.

**Finding:** The tree node / action row carries no hint that Docker is required; the prerequisite check
(`getDockerStatus`) runs only after the panel opens, so a user without Docker commits to the click before
learning they need it.

💡 **Suggestion (acknowledged / not planned now):** If ever revisited, signal the prerequisite earlier — a node
tooltip / description ("Requires Docker") or a hover.

### 28. Icons are all inherited/generic — nothing marks "this is the Quick Start instance" 🔍💡

**Priority:** P3 · **Status:** 🟠 Open — operator to choose the direction.

**Observation:** How are the icons chosen for the Quick Start instances?

**Finding:** 🔍 No bespoke icon set. **Root node:** the extension's product icon. **Running row:** no override —
inherits `DocumentDBClusterItem`'s logic, which picks `$(plug)` when `emulatorConfiguration.isEmulator` is true
(always, for Quick Start), so it gets **the same `$(plug)`** as any other "emulator" connection (including the
item 10 migrated legacy connections). **State rows:** generic `ThemeIcon`s (`loading~spin`, `circle-outline`,
`warning`). **Empty-state rows:** `rocket` and `link-external`.

💡 **Suggestion:** Give the managed instance a **distinct, state-independent identity** — e.g. reuse the
**rocket** (the feature's motif) for the instance row, so users can tell "the Quick-Start-managed one" apart at
a glance. Low priority, but cheap.

### 29. "Open terminal in the container" — feasible, no blocker 🔍💡

**Priority:** P3 · **Status:** 🟠 Open — operator to choose the direction (see Open idea O5).

**Observation:** Would a command to open a terminal inside the Docker container make sense? Can we do it?

**Finding:** 🔍 Feasible, no blocker. The repo already uses `vscode.window.createTerminal(...)`; for a plain
"shell into the container" the standard pattern is
`createTerminal({ name, shellPath: 'docker', shellArgs: ['exec', '-it', containerId, '/bin/bash'] })` (with a
`/bin/sh` fallback) — Docker drives the TTY, no custom pty required. The container id is already tracked
(`metadata.containerId`), and Docker is already a hard dependency.

💡 **Suggestion:** Add an **"Open in Terminal"** context-menu command gated on `state_running`, trying `bash`
then falling back to `sh`. Details in Open idea O5.

---

## Implemented

### 30. Empty-state tree rows: reword the action, drop "Learn more" ✅

**Priority:** P1\* (wording) · **Status:** ✅ Implemented on this branch.

**Observation:** The rows shown when there's no managed instance yet should be reworded — the action row should
read like "Click here to…" — and "Learn more" could be dropped from the list.

**Finding:** Both rows were built in `LocalQuickStartItem.getChildren()`
([LocalQuickStartItem.ts](../../../../src/tree/connections-view/LocalQuickStart/LocalQuickStartItem.ts)) for the
`NotInstalled` state: an action row (rocket, `treeItem_quickStartAction`) and a separate "Learn more…" row
(`link-external`, `treeItem_quickStartLearnMore`, opening `https://github.com/microsoft/documentdb`). No
`view/item/context` entry existed for either, so there was **no existing context-menu** to move "Learn more"
into.

✅ **Implemented (updated 2026-07-09):**

- The action row is now labeled **`'Click here to start DocumentDB Local'`** (the wording was iterated a couple
  of times: `'Quick Start — Install & try DocumentDB locally'` → `'Click here to install & try DocumentDB
locally'` → the current, shorter **`'Click here to start DocumentDB Local'`**). Verified against the current
  code in `getChildren()`'s `NotInstalled` branch.
- The `'Learn more…'` row (`treeItem_quickStartLearnMore`) was **removed** from the empty state. It is **not**
  relocated to a context menu (no menu plumbing exists yet), so the external repo link is no longer reachable
  from the tree.
- Files: [LocalQuickStartItem.ts](../../../../src/tree/connections-view/LocalQuickStart/LocalQuickStartItem.ts),
  [l10n/bundle.l10n.json](../../../../l10n/bundle.l10n.json). Verified via `l10n` / `prettier` / `lint` / full
  Jest suite / `build`.

💡 **Remaining (Open, low priority):** Decide whether "Learn more" comes back as a context-menu entry on the
parent `DocumentDB Local - Quick Start` node (a new `view/item/context` gated on `treeItem_localQuickStart`), or
is dropped for good in favor of the walkthrough/README.

---

## Open ideas — options, pros & cons

Genuinely open design questions with real trade-offs. Recommendations are suggestions to react to, not decisions.

### O1. Surfacing the legacy migration folder (item 10)

| Option                                        | Pros                                                                                                                                                   | Cons                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| **A. One-time toast + "Reveal" action**       | Loud exactly once, at the moment it matters; non-blocking                                                                                              | Transient; a user who dismisses it still has to find the folder                     |
| **B. Distinct folder icon/description badge** | Persistent visual marker; no extra flow                                                                                                                | Adds a special-case to folder rendering; mild clutter                               |
| **C. Pin to a fixed position (first/last)**   | Predictable location regardless of name                                                                                                                | Breaks the pure-alphabetical model; users may still not notice it                   |
| **D. Do nothing (current)**                   | Zero code                                                                                                                                              | Folder hides in the alphabetical sort; confusing post-upgrade                       |
| **E. Prefix the folder name with `_`**        | Dead-cheap: `_` sorts before letters, so `_Local Connections (Legacy)` floats to the top of the alphabetical list with **zero** rendering/sort changes | Cosmetic leading `_` in the name; a user can rename it away; not as loud as a toast |

> 💡 **Suggested:** **A**, optionally with **B**. If a code-free quick win is preferred first, **E** (prefix the
> name with `_`) reliably pins it to the top of the existing `localeCompare(..., { numeric: true })` order with
> no sort/render changes, and composes fine with A/B.

### O2. Image-pull progress indicator (item 19)

| Option                                                         | Pros                                                        | Cons                                                                           |
| -------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **A. Spinner + static label (current)**                        | Zero work                                                   | Looks frozen for tens of seconds on a cold pull                                |
| **B. Indeterminate `ProgressBar` + "N of M layers" sub-label** | Alive + honest; reuses existing components; modest plumbing | Layer count parsed from free-form CLI text (small regex); no true %            |
| **C. Docker Engine API / `dockerode` structured pull**         | Real per-layer byte totals → an actual percentage           | Larger change; new dependency/route away from the CLI-wrapper approach         |
| **D. "Dot per completed layer" row**                           | Visually pleasant for small bounded step counts             | Total layer count unknown until pull starts → row grows/shrinks, reads jittery |

> 💡 **Suggested:** **B** near-term (alive UI without the C rework), with **C** as the "if we want a real
> percentage" follow-up. Avoid **D** — the unknown-until-runtime layer count makes the dot row jitter.

### O3. Cluster commands on the Quick Start row (item 20)

| Option                                                            | Pros                                                              | Cons                                                                     |
| ----------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **A. Curated menu only (current)**                                | No risk of storage commands acting on an in-memory item           | Loses genuinely useful storage-independent commands (e.g. Open in Shell) |
| **B. Add specific storage-independent commands explicitly**       | Gains the useful ones; still no storage-command risk              | Each command re-declared with a Quick-Start `when`-clause                |
| **C. Split base contextValue into storage vs connection subsets** | Clean, reusable; Quick Start opts into the connection-only subset | Touches the base cluster item + every command's `when`; larger refactor  |

> 💡 **Suggested:** **B** now (add "Open in Shell"/"New Query"), keep **C** as the eventual clean-up if more
> items want the same split.

### O4. External-delete / Missing recovery affordance (items 1 & 2)

| Option                                                             | Pros                                                             | Cons                                                                   |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **A. Silent early-return (current)**                               | —                                                                | Looks broken; stale row; error only in the output channel              |
| **B. Detect missing → set Missing badge + info message**           | Reuses the existing `Missing` rendering + `liveStateGuard` style | User still has to choose the next step                                 |
| **C. B + actionable prompt: Delete / Recreate with same settings** | One-click recovery; matches the "click to recreate" Missing row  | Slightly more logic; must confirm `getReusableCredentials()` covers it |

> 💡 **Suggested:** **C**. Turns a silent dead-end into self-service recovery; most machinery already exists —
> the work is mainly routing `start`/`stop`/`restart` into it instead of early-returning.

### O5. Open terminal in container (item 29)

| Option                                                   | Pros                                           | Cons                                                       |
| -------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------- |
| **A. `createTerminal` with `docker exec -it … bash`**    | Simplest; Docker drives the TTY; no custom pty | Assumes `bash` in the image                                |
| **B. A + `/bin/sh` fallback**                            | Works even on minimal images                   | Two-attempt logic (or a probe)                             |
| **C. Custom `Pseudoterminal` like the integrated shell** | Full control over I/O                          | Overkill for "just give me a shell"; more code to maintain |

> 💡 **Suggested:** **B** — the standard, low-maintenance pattern, gated on `state_running`. Reserve **C** only if
> we later want to parse/relay the shell I/O.

### O6. Persistence & the volume model (items 22 / 23 / 24)

Three related choices about the on-disk data volume. They interact: an "ephemeral" option only makes sense once
delete reliably wipes the volume, and both are cleaner if the volume is tied to its image.

| Question                   | Options                                                                                               | Suggested                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Persist vs ephemeral**   | (A) Always persist (current). (B) Advanced toggle, default persist. (C) Prompt each run.              | **B** — a default-on "Persist data across restarts" toggle; no mount when off.                  |
| **Delete → volume**        | (A) Delete container only. (B) Delete container **+ volume** on user delete (current explicit path).  | **B**, applied to _every_ user-initiated delete (incl. the future credential-missing Delete).   |
| **Volume ↔ image linkage** | (A) Alias-keyed volume + runtime image pinning (current). (B) Structurally key/label volume by image. | **B** — make "one image ↔ one volume" structural; no cross-image sharing (advanced users only). |

> 💡 **Suggested overall:** default stays "persistent, clean-delete, image-pinned" so the zero-decision path is
> unchanged; add the **ephemeral toggle**, make the **volume↔image link structural**, and never share data
> volumes across images. Pre-release, pair with item 9 (only ever remove containers/volumes we created).

### O7. Should the container stop when VS Code closes? (item 25)

| Option                                | Pros                                                                             | Cons                                                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **A. Keep running (current)**         | Survives reloads/crashes; instant to resume; matches "a local server you manage" | Orphaned container holds a port + RAM after close; surprising for users expecting tool-scoped lifetime; can pile up over time |
| **B. Stop on VS Code exit**           | Tool-scoped lifetime (like a dev server); no orphans; frees the port             | Loses "always-on local DB"; restart cost each session; needs a reliable shutdown hook (VS Code exit cleanup isn't guaranteed) |
| **C. Setting, default keep (+ copy)** | User chooses; safe default; makes the current behavior explicit                  | A setting adds surface                                                                                                        |

> 💡 **Suggested (for evaluation):** Lean **C** — keep the always-on default (safer, data-preserving, and
> `reconcile()` already relies on it), but add a **setting** ("Stop the local instance when VS Code closes") and
> make the always-on behavior **explicit** in the UI. Genuinely open — evaluate against how users actually treat
> the instance (throwaway vs always-on).

---

## Appendix A — current webview flow (reference)

The setup panel is one React component driven by a `Phase` state machine
(`'loading' | 'review' | 'dockerNotReady' | 'provisioning' | 'success' | 'failed'` in
[LocalQuickStart.tsx](../../../../src/webviews/documentdb/localQuickStart/LocalQuickStart.tsx)). On open it
queries `getDockerStatus`, then branches:

```text
        panel opens
             |
             v
     +-----------------+   getDockerStatus()
     |    loading      |------------------------------.
     | (BARE spinner:  |                              |
     |  "Checking      |            Docker not ready   v
     |   Docker..."    |          +----------------------------+
     |  no hero/cards) |--------->|      dockerNotReady        |
     +-----------------+          | hero "Docker is required"  |
             |                    | 3 readiness cards          |
         Docker ready             | (CLI / daemon / platform)  |
             |                    | + "How to fix" + [Retry] ---+  (re-query)
             |                    +----------------------------+
             |
     ready & canResumeReadiness?  --- yes --> jump to [failed / timedOut] (resume a prior
             |                                          timed-out container: Wait longer / Start over)
             | no
             v
     +-----------------+   [Start DocumentDB Local]
     |     review      |----------------------------.
     | hero "Start     |                            |
     |  DocumentDB     |                            v
     |  Local"         |                 +----------------------+
     | 4 config cards  |                 |    provisioning      |
     | (Image / Port / |                 | hero "Setting up..." |
     |  Data / Security|                 | elapsed timer        |
     | + Advanced      | <-- [Edit       | stage checklist:     |
     |   (collapsed))  |     settings] --| checking > pulling > |
     | + [Start]       |                 | creating > starting >|
     +-----------------+                 | waiting > done       |
             ^                           | [Cancel] [View output]|
             |                           +----------+-----------+
             | [Start over]           success |    | failed / timeout
             |                                v    v
             |                    +-----------+  +----------------------+
             +------------------- |  success  |  |       failed         |
                                  | Next steps|  | error box            |
                                  | [Open] [Copy] | [Retry][Edit] OR     |
                                  | [Close]   |  | [Wait longer][Start  |
                                  +-----------+  |  over] (on timeout)   |
                                                 +----------------------+
```

Phase-by-phase:

- **loading** — **only** a full-panel `<Spinner label="Checking Docker…" />` (no hero/cards; item 12).
- **dockerNotReady** — `hero("Docker is required")` + three readiness cards (Docker CLI / daemon / Platform, each
  with a ✓/! badge) + a "How to fix" card + `Retry`.
- **review** — `hero("Start DocumentDB Local")` + four config cards (Image / Port / Data / Security) + a summary +
  a collapsed **Advanced** panel + `Start DocumentDB Local`.
- **provisioning** — `hero("Setting up DocumentDB Local…")` + elapsed timer + the stage checklist (checking →
  pulling → creating → starting → waiting → done) + `Cancel` + `View Docker output`.
- **success** — header still reads "Setting up…" (bug, item 3) + a success box + Next steps + `Open Connection` /
  `Copy Connection String` / `Close`.
- **failed** — header still reads "Setting up…" (item 3) + an error box + either `Retry` / `Edit settings`, or (on
  a readiness timeout) `Wait longer` / `Start over`.
