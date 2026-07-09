# DocumentDB Local Quick Start — UX Review Pack

> **Who this is for:** anyone about to do a hands-on UX review of the **Local Quick Start** feature
> (installing/running a local DocumentDB container from inside VS Code), or anyone reading back how
> the review unfolded.
> **What this is:** a single catch-up document that captures a round of runtime UX feedback on the
> feature, states what the code _actually does today_ (verified against the current branch), groups
> the findings by user journey, and — for each — offers a **suggestion** the team can react to.
> Most items are still open discovery notes; where a quick, low-risk fix was applied it is stamped.

- **Feature area:** `src/services/localQuickStart/`, `src/commands/localQuickStart/`,
  `src/tree/connections-view/LocalQuickStart/`, `src/webviews/documentdb/localQuickStart/`
- **Working branch:** `dev/tnaum/documentdb-quickstart-ux-review`
- **Related design docs:** [local-quickstart-v2.md](../../local-quickstart/local-quickstart-v2.md),
  [local-quickstart-poc/](../local-quickstart-poc/),
  [local-quickstart-multi-instance/](../local-quickstart-multi-instance/)
- **Scope of this doc:** the UX-facing surface (tree structure, wording, icons, the provisioning
  webview, lifecycle actions, error recovery). Deeper backend/state-machine internals are only
  discussed where they explain a user-visible symptom.
- **Review date:** 2026-07-09

## How this review was run

This is a **runtime UX pass**: a person exercised the real feature (install → run → stop → delete →
break-it-externally) and dictated observations, and an AI assistant did the code-checking, root-cause
tracing, and write-up. The intent is that each finding is backed by the exact code path that produces
the behavior, so a later triage/implementation pass doesn't have to re-derive it.

The sections below are organized **by user journey** (upgrade, first run, the setup webview, the
running instance, destructive actions, lifecycle robustness, possible additions) rather than by the
order the feedback happened to arrive. Each item leads with a one-line **Verdict**, then records the
**Observation** (what the reviewer saw), the **Finding** (what the code actually does and why), and a
**Suggestion** (a concrete, reactable recommendation — not a decision). Heavier design questions with
real trade-offs are pulled into [§13 Open ideas](#13-open-ideas--options-pros--cons) at the end.

## Legend

| Marker             | Meaning                                                                     |
| ------------------ | --------------------------------------------------------------------------- |
| ✅ **Fix applied** | A quick, low-risk change was made on this branch and verified               |
| ⚠️ **Flag**        | Confirmed gap or bug; needs a decision/fix in a follow-up                   |
| 💡 **Suggestion**  | A design/wording recommendation for the team to react to                    |
| 🔍 **Answered**    | A "how does this work?" question, answered from the code (no change needed) |

---

## 1. The story in one paragraph

Local Quick Start adds a **`DocumentDB Local - Quick Start`** root node to the Connections view. From
an empty state a user clicks one row to open a **setup webview**, which checks Docker, pulls the
image, creates + starts a container, waits for readiness, and seeds sample data — reporting progress
as a stage checklist. Once running, the instance appears **inline** in the tree as a browsable
cluster with a Quick-Start-specific context menu (Start/Stop/Restart/Delete/Copy/View Logs). On
upgrade, pre-existing local "emulator" connections are migrated once into a regular folder. This
review hammered the _presentation and robustness_ of that journey: how the migration folder is named
and sorted, how the empty-state rows read, how honest and stable the setup webview's header/progress
is, how the running instance's menu and icons compare to regular clusters, whether destructive
actions match the rest of the extension, and — the one hard bug — what happens when the container is
deleted **outside** VS Code. Most items are wording/consistency polish; one (§4 header) is a real
"stuck UI" bug; one (§9 external delete) is a silent-failure bug with a clear root cause.

---

## 2. Upgrade & migration (existing users)

### 2.1 Legacy emulator connections migrate to a folder that can hide in the sort order ⚠️ 🔍

**Observation:** Is the one-time migration of original "DocumentDB Local" emulator connections still
happening? What's the folder called? Sorting could place it somewhere unexpected and cause confusion.

**Finding:**

- 🔍 Yes, it's still active. The migration lives in
  [legacyEmulatorMigration.ts](../../../../src/services/legacyEmulatorMigration.ts), invoked from
  [ClustersExtension.ts](../../../../src/documentdb/ClustersExtension.ts) on every activation
  (`migrateLegacyEmulatorConnections`), guarded by a `globalState` flag
  (`documentdb.localQuickStart.legacyEmulatorMigration.completed`) so it runs once.
- 🔍 The destination folder is named **`Local Connections (Legacy)`** (`LEGACY_FOLDER_BASE_NAME`),
  deterministic id `vscode-documentdb.legacyLocalConnectionsFolder`. If a user already has a root
  folder with that exact name, it's suffixed `(2)`, `(3)`, … It is a **normal** renamable/movable
  folder under the regular Clusters zone — not pinned or reserved. Emulators-zone sub-folders are
  intentionally **flattened** into this single folder (documented scope cut, not a bug). The old
  `Emulators` zone/`LocalEmulatorsItem` node is kept as a read-only rollback until migration
  succeeds, then retired (`isLegacyEmulatorMigrationComplete()` gate in
  [ConnectionsBranchDataProvider.ts](../../../../src/tree/connections-view/ConnectionsBranchDataProvider.ts)).
- ⚠️ **Why it can surprise:** root items are assembled in a fixed order (Quick Start node → legacy
  emulator node if un-migrated → **all folders, alphabetically** → ungrouped connections → New
  Connection). Folders sort with a single `localeCompare(..., { numeric: true })` pass with **no
  special-casing** for the legacy folder, so it lands wherever "L…" falls among the user's other
  folder names — easy to miss right after an upgrade, since nothing marks it as "your old stuff
  moved here." No migration toast surfaced in this pass (a search for a notification tied to
  `MIGRATION_COMPLETED_KEY` found none).

💡 **Suggestion:** Make the destination discoverable rather than relying on alphabetical luck. Cheapest
first: (a) a **one-time toast** after a successful migration ("N local connections were moved to
_Local Connections (Legacy)_") with a "Reveal" action; optionally (b) a distinct folder **description
badge/icon** so it stands out; and/or (c) pin it to a fixed position among folders (first or last).
See [§13.1](#131-surfacing-the-legacy-migration-folder) for the options weighed.

---

## 3. First run — the empty Quick Start node

### 3.1 Empty-state tree rows: reword the action, drop "Learn more" ✅

**Observation:** The rows shown when there's no managed instance yet should be reworded — the action
row should read like "Click here to…" — and "Learn more" could be dropped from the list (it could
live in the node's context menu instead).

**Finding:** Both rows are built in `LocalQuickStartItem.getChildren()`
([LocalQuickStartItem.ts](../../../../src/tree/connections-view/LocalQuickStart/LocalQuickStartItem.ts))
for the `NotInstalled` state: an action row (rocket, `treeItem_quickStartAction`, opens the webview)
and a separate "Learn more…" row (`link-external`, `treeItem_quickStartLearnMore`, opens
`https://github.com/microsoft/documentdb`). Neither row has any `view/item/context` entry in
`package.json`, so there is **no existing context-menu** to move "Learn more" into — that would be new
plumbing. The action label/command is also reused by the `Missing` state (see §9), so wording should
stay consistent across both.

✅ **Fix applied (2026-07-09):** Implemented the quick half of this directly, in `getChildren()`'s
`NotInstalled` branch:

- Action row relabeled `'Quick Start — Install & try DocumentDB locally'` →
  **`'Click here to install & try DocumentDB locally'`**.
- The `'Learn more…'` row (`treeItem_quickStartLearnMore`) was **removed** from the empty state. It is
  **not** relocated to a context menu (deferred — no menu plumbing exists yet), so the external repo
  link is no longer reachable from the tree until/unless it's re-added.

💡 **Suggestion (remaining):** Decide whether "Learn more" comes back as a context-menu entry on the
parent `DocumentDB Local - Quick Start` node (a new `view/item/context` gated on
`treeItem_localQuickStart`), or is dropped for good in favor of the walkthrough/README. Low priority.

---

## 4. The setup webview — header stability

### 4.1 The webview header changes with state and gets stuck on "Setting up…" ⚠️

**Observation:** The header should be static. Today it changes with status/progress/errors, which is
unexpected — and it sometimes stays on "Setting up DocumentDB Local…" even when setup is actually
complete.

**Finding** (in [LocalQuickStart.tsx](../../../../src/webviews/documentdb/localQuickStart/LocalQuickStart.tsx)):
the header ("hero") is rendered by a local `hero(title, subtitle)` helper called with **three
different literal titles** depending on `phase`: `'Docker is required'` (dockerNotReady),
`'Setting up DocumentDB Local…'` (**provisioning, success, _and_ failed all share this one call**),
and `'Start DocumentDB Local'` (review). Both halves of the observation are confirmed:

- ⚠️ The title genuinely changes across phases (three strings), reading as a jumpy header.
- ⚠️ **The "stuck" complaint is a real bug:** `success` and `failed` reuse the `provisioning` title
  verbatim, so "Setting up DocumentDB Local…" is still shown even once the instance is running or has
  definitively failed. Only the body below (success/error box, stage checklist, buttons) reflects the
  outcome — the header never catches up. (A phase/stage-aware `provisioningStatusMessage` exists but
  is only piped to a screen-reader-only live region, not shown visually.)

💡 **Suggestion:** Make the header a **single static string** for the whole panel lifecycle (e.g.
"DocumentDB Local" or "Local Quick Start"), and let the subtitle/body carry all state (elapsed timer,
success/failure boxes already exist). That satisfies "header should be static" and eliminates the
stuck-text bug in one move. If a dynamic header is preferred, it must at minimum branch on
`success`/`failed` the way the `dockerNotReady` screen already does.

---

## 5. The setup webview — the "waiting" stage

### 5.1 "Waiting for DocumentDB to accept connections" can sit static for minutes ⚠️

**Observation:** This message could be reworded, or show some intermediate progress as sub-info, since
it can take a while.

**Finding:** The stage label is `'Waiting for DocumentDB to accept connections'`. It wraps
`waitForReadiness()` in [QuickStartService.ts](../../../../src/services/localQuickStart/QuickStartService.ts),
which polls the wire protocol with a **`READINESS_TIMEOUT_MS = 180_000` (3 min)** budget and a 3 s
per-attempt timeout. During that window the stage row shows only a spinner + the same static label —
⚠️ **no in-panel sub-status** (attempt count, elapsed-in-stage, remaining). The information _does_
exist: logs stream to the "DocumentDB Local Quick Start" output channel via `followLogs` the whole
time, just not surfaced in the panel. On timeout a distinct `ReadinessTimeoutError` (kept separate so
the container is preserved for "Wait longer") shows the `failed`/`timedOut` message. (That message and
several others here contain em dashes — see §8.1.)

💡 **Suggestion:** Add a lightweight **sub-info line** under this stage while it's active — cheapest is
an **in-stage elapsed timer** ("still initializing… 0:45") and/or a rotating reassurance after N
seconds ("first run generates TLS certs, this can take a minute"). Also consider surfacing the "View
Docker output" link _during_ this stage (it currently only appears at the bottom of the panel). A
reword should stay accurate for both a cold first run and a plain restart, since both funnel through
this stage.

---

## 6. The setup webview — image pull progress

### 6.1 No structured progress while the image downloads ⚠️

**Observation:** Do we track progress while the image is pulled? It's a long-running op too.

**Finding:** ⚠️ No. `provision()` yields one `active` event (`'Pulling the official image…'`), awaits
`pullImage()`, then one `done` event — nothing in between. `ContainerRuntime.pullImage()`
([ContainerRuntime.ts](../../../../src/services/localQuickStart/ContainerRuntime.ts)) runs `docker
pull` through the shared CLI shell-runner, piping stdout/stderr **only** to the output channel
(masked, line-buffered). Docker's per-layer progress (`Downloading`/`Extracting`/`Pull complete`) is
therefore visible only as raw channel text, never in the webview — the panel shows a spinner +
static label for the entire pull, same as §5.

💡 **Suggestion:** Give the pull an **indeterminate but alive** treatment. Since a true 0–100% isn't
known up front without a bigger rework, pair a Fluent UI **indeterminate `ProgressBar`** with a small
live **"N of M layers"** sub-label (derivable by counting distinct layer ids vs. `Pull complete`
lines). This needs modest plumbing (a progress callback on `pullImage`/`IContainerRuntime`, extra
`StageEvent` fields, webview rendering). Full options, including a Docker-Engine-API/`dockerode`
route for real byte totals and why a literal "dot per layer" reads as jittery, are in
[§13.2](#132-image-pull-progress-indicator).

---

## 7. The running instance in the tree

### 7.1 The running-instance row doesn't share regular cluster context commands 🔍

**Observation:** The running managed instance doesn't share context-menu commands with regular
clusters. Do we still extend the cluster base class? If not, what would break if we did?

**Finding:**

- 🔍 Yes — `QuickStartClusterItem extends DocumentDBClusterItem`
  ([LocalQuickStartItem.ts](../../../../src/tree/connections-view/LocalQuickStart/LocalQuickStartItem.ts)).
  It overrides `getTreeItem()` only to force the state-aware description, and reuses the base for
  icon/tooltip/browsing.
- 🔍 The reason regular commands don't appear: the **contextValue is fully replaced, not extended.**
  The constructor sets `contextValue = createContextValue([INSTANCE_CONTEXT, stateToken])` — i.e.
  `treeItem_quickStartInstance` + `state_running` — discarding the base's `treeitem_documentdbcluster`
  token that every regular-cluster `view/item/context` `when`-clause matches on. This is deliberate
  (class comment: show Quick Start lifecycle actions "instead of the generic cluster menus").
- 🔍 **What would break if the base contextValue were kept too:** the generic commands assume a
  **stored** connection — `removeConnection` deletes a storage record, `moveItems`/`renameConnection`
  hit `ConnectionStorageService`, `update*` open storage wizards. The Quick Start instance is
  explicitly **in-memory only** (not in any storage zone), so those commands would act on a record
  that doesn't exist — silent no-ops at best, orphaned-state/exceptions at worst — unless each learned
  to special-case this row. So full replacement avoids a bug class, but also throws out genuinely
  useful storage-independent commands (e.g. "Open in Shell").

💡 **Suggestion:** Keep the curated menu, but **add back the storage-independent commands explicitly**
(most valuable: "Open in Shell" / "New Query" against the running instance). The clean version of
this is splitting the base contextValue into a storage-dependent subset and a connection-only subset
so Quick Start can opt into the latter — weighed in [§13.3](#133-cluster-commands-on-the-quick-start-row).

### 7.2 "Copy Connection String" is a separate impl and silently includes the password ⚠️

**Observation:** Copy Connection String seems reimplemented for Quick Start and behaves slightly
differently — it doesn't ask whether to include the password.

**Finding:** Regular clusters use `copyConnectionString()`
([copyConnectionString.ts](../../../../src/commands/copyConnectionString/copyConnectionString.ts)),
which prompts via `showQuickPick` ("with password" vs "without password", gated by
`canIncludeNativePassword()`) and is well-tested. Quick Start uses a **separate, shorter**
`copyQuickStartConnectionString()`
([localQuickStartCommands.ts](../../../../src/commands/localQuickStart/localQuickStartCommands.ts))
that copies `metadata.connectionString` (password already embedded) **with no prompt** — a genuine
behavioral difference, not just styling. ⚠️ A plaintext password always lands on the clipboard
silently, which stands out given how careful the rest of the feature is about credentials (masked
logging, env-file instead of CLI args). There is a _separate_ `copyQuickStartPassword()` command, but
the connection-string action itself never asks.

💡 **Suggestion:** Reuse the regular command's QuickPick confirmation for parity (Quick Start always
uses native auth, so no extra branching is needed), or — if the extra click is unwanted for a
one-click-local flow — at minimum make the two commands' behavior a **conscious, documented** choice
rather than an incidental divergence.

### 7.3 Icons are all inherited/generic — nothing marks "this is the Quick Start instance" 🔍💡

**Observation:** How are the icons chosen for the Quick Start instances?

**Finding:** 🔍 There's no bespoke icon set:

- **Root node:** the extension's product icon (`vscode-documentdb-icon-*.svg`).
- **Running row:** no override — inherits `DocumentDBClusterItem`'s logic, which picks `$(plug)` when
  `emulatorConfiguration.isEmulator` is true (always, for Quick Start) else `$(server-environment)`.
  So the running instance gets **the same `$(plug)`** as any other connection flagged as an emulator
  (including the §2.1 migrated legacy connections). Nothing visually distinguishes "the managed
  Quick Start instance."
- **State rows** (Starting/Stopping/Stopped/Error/Missing): generic `ThemeIcon`s (`loading~spin`,
  `circle-outline`, `warning` with theme colors).
- **Empty-state rows:** `rocket` and `link-external`.

💡 **Suggestion:** Give the managed instance a **distinct, state-independent identity** — e.g. reuse
the **rocket** (already the feature's motif on the root/action rows) for the instance row, or a
dedicated brand mark, so users can tell "the Quick-Start-managed one" apart from a manually-flagged
emulator at a glance. Low priority, but cheap.

---

## 8. Destructive actions

### 8.1 "Delete Container" bypasses the shared confirmation and uses em dashes ⚠️

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
  setting — it's the only _destructive_ command that does (the other direct callers are
  non-destructive: `hideIndex`/`unhideIndex`).
- ⚠️ Its two confirmation `detail` strings both contain a literal **em dash** ("…This cannot be undone
  — you can recreate…"). The character also appears across the feature's other strings
  (`LocalQuickStart.tsx` next-steps bullets, the §5 timeout message).

💡 **Suggestion:** Switch Delete Container to **`getConfirmationAsInSettings()`** for consistency (decide
the confirmation word — there's no "type the container name" concept yet, so a simple word like
`delete` matches the other delete flows). Separately, do a **one-pass em-dash sweep** of the whole
feature's user-facing strings rather than fixing only the delete dialog.

---

## 9. Lifecycle robustness & error recovery

### 9.1 A container deleted _outside_ VS Code isn't handled on Start (silent no-op) ⚠️

**Observation (repro):** Created an instance via Quick Start, stopped it, then deleted the _container_
directly via Docker. Back in VS Code, clicking Start on the still-"Stopped"-looking row does nothing
visible — no dialog, no tree update — only the raw Docker error appears in the output channel:

```
$ docker container inspect --format '{{json .}}' 57f8311fd9ec…
Error response from daemon: No such container: 57f8311fd9ec…
```

**Finding — a specific, reproducible gap:**

- `ContainerRuntime.inspectContainer()` wraps the CLI call in `try { … } catch { return undefined; }`,
  swallowing "No such container" into `undefined`. But the shared `makeRunner()` still logs the
  command and streams the daemon's stderr to the channel — that's exactly the two lines the user saw
  (the extension's own inspect call, not a manual terminal session).
- `start()` calls `isManaged(id)` first, which returns `false` both when the container **isn't ours**
  _and_ when it's **gone** (`inspectContainer` → `undefined`). ⚠️ **`isManaged()` cannot distinguish
  "missing" from "not ours."**
- `start()`'s guard is `if (!id || !isManaged || !liveStateGuard(…)) return;`. Because `isManaged`
  already returned `false`, the `||` short-circuits and **`liveStateGuard()` never runs** — which is
  the very code that _would_ have handled this gracefully (it detects a `'missing'` live state, calls
  `refreshLiveState()`, and shows an info message). That path is well-built for the multi-window /
  external-stop case; it's just unreachable here.
- Net effect: `start()` early-returns silently, `setStatus` never fires, the tree never refreshes, and
  the stale "Stopped" row persists until something else (e.g. collapsing/expanding the node) triggers
  `refreshLiveState()` independently.
- Note there's already a good pattern for the related case: `refreshLiveState()` _does_ set
  `entry.missing = true` and the tree already renders `Missing · click to recreate`. The gap is that
  the **lifecycle actions** (`start`/`stop`/`restart`) don't funnel through that missing-detection
  before giving up.

💡 **Suggestion:** Teach `start`/`stop`/`restart` to distinguish "no container found" from "found but
not ours" (a small change to `isManaged`, or a check ahead of it) and, on "missing," do what
`liveStateGuard` already does for the multi-window case — refresh state to the `Missing` badge and
surface a message with next steps: **Delete** (clean up stale metadata/volume) and/or **Recreate with
same settings** (the existing `Missing` row's recreate flow + `getReusableCredentials()` in
`provision()` likely already covers most of this — worth confirming it's sufficient once reachable
from the lifecycle actions). Full UX options in [§13.4](#134-external-deletemissing-recovery-affordance).

---

## 10. Possible additions

### 10.1 "Open terminal in the container" — feasible, no blocker 🔍💡

**Observation:** Would a command to open a terminal inside the Docker container make sense? Can we do
it?

**Finding:** 🔍 Feasible, no blocker.

- The repo already uses `vscode.window.createTerminal(...)` for terminal-backed commands
  ([openInteractiveShell.ts](../../../../src/commands/openInteractiveShell/openInteractiveShell.ts)),
  though that uses a custom `Pseudoterminal` for the integrated shell — more than needed here.
- For a plain "shell into the container," the standard pattern is
  `createTerminal({ name, shellPath: 'docker', shellArgs: ['exec', '-it', containerId, '/bin/bash'] })`
  (with a `/bin/sh` fallback) — Docker drives the TTY, no custom pty required.
- The container id is already tracked (`metadata.containerId`, via `getStatus()`), so no new state is
  needed. `ContainerRuntime.execShellInContainer()` exists but is non-interactive (channel output),
  so a new small command calling `createTerminal` directly is the better fit. Docker is already a hard
  dependency, so no new prerequisite.

💡 **Suggestion:** Add an **"Open in Terminal"** context-menu command gated on `state_running` (a
stopped container can't `exec`), trying `bash` then falling back to `sh`. Small, self-contained, and a
natural power-user affordance. Open details (menu group/icon, shell fallback prompt) in
[§13.5](#135-open-terminal-in-container).

---

## 11. Consolidated flags & suggestions (read this before testing)

| §    | Item                                            | Verdict                  | Suggested next step                                                                                                     |
| ---- | ----------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 2.1  | Legacy migration folder discoverability         | ⚠️ Flag                  | One-time toast + "Reveal"; optional distinct badge/pin ([§13.1](#131-surfacing-the-legacy-migration-folder))            |
| 3.1  | Empty-state wording / drop "Learn more"         | ✅ Fix applied           | Decide if "Learn more" returns as a context-menu entry                                                                  |
| 4.1  | Webview header changes / stuck on "Setting up"  | ⚠️ Flag (real bug)       | Make the header a single static string; body carries state                                                              |
| 5.1  | "Waiting for connections" static for minutes    | ⚠️ Flag                  | Add in-stage elapsed/sub-info; surface "View output" earlier                                                            |
| 6.1  | No image-pull progress                          | ⚠️ Flag                  | Indeterminate `ProgressBar` + "N of M layers" ([§13.2](#132-image-pull-progress-indicator))                             |
| 7.1  | Running row lacks regular cluster commands      | 🔍 Answered (deliberate) | Add back storage-independent commands explicitly ([§13.3](#133-cluster-commands-on-the-quick-start-row))                |
| 7.2  | Copy Connection String silently adds password   | ⚠️ Flag                  | Reuse the regular QuickPick confirmation, or document the divergence                                                    |
| 7.3  | Generic `$(plug)` icon, no distinct identity    | 🔍 Answered              | Give the instance a distinct icon (reuse the rocket motif)                                                              |
| 8.1  | Delete bypasses shared confirmation + em dashes | ⚠️ Flag                  | Switch to `getConfirmationAsInSettings()`; sweep em dashes feature-wide                                                 |
| 9.1  | External container delete not handled on Start  | ⚠️ Flag (real bug)       | Distinguish missing vs not-ours; route to Missing + recovery ([§13.4](#134-external-deletemissing-recovery-affordance)) |
| 10.1 | "Open terminal in container"                    | 🔍 Feasible              | Add `state_running` "Open in Terminal" command ([§13.5](#135-open-terminal-in-container))                               |

---

## 12. Applied changes on this branch

- **§3.1** — empty-state action row relabeled to "Click here to install & try DocumentDB locally"; the
  "Learn more…" row removed. Files: [LocalQuickStartItem.ts](../../../../src/tree/connections-view/LocalQuickStart/LocalQuickStartItem.ts),
  [l10n/bundle.l10n.json](../../../../l10n/bundle.l10n.json). Verified via `l10n` / `prettier` / `lint`
  / full Jest suite / `build`.

Everything else in this document is a discovery note or suggestion — no other code was changed.

---

## 13. Open ideas — options, pros & cons

These are the genuinely open design questions with real trade-offs. Recommendations are suggestions
for the team to react to, not decisions.

### 13.1 Surfacing the legacy migration folder (§2.1)

| Option                                        | Pros                                                      | Cons                                                              |
| --------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------- |
| **A. One-time toast + "Reveal" action**       | Loud exactly once, at the moment it matters; non-blocking | Transient; a user who dismisses it still has to find the folder   |
| **B. Distinct folder icon/description badge** | Persistent visual marker; no extra flow                   | Adds a special-case to folder rendering; mild clutter             |
| **C. Pin to a fixed position (first/last)**   | Predictable location regardless of name                   | Breaks the pure-alphabetical model; users may still not notice it |
| **D. Do nothing (current)**                   | Zero code                                                 | Folder hides in the alphabetical sort; confusing post-upgrade     |

> 💡 **Suggested:** **A**, optionally with **B**. The toast solves the "I didn't know my connections
> moved" moment directly; a subtle badge helps the user re-find it later without breaking the sort.

### 13.2 Image-pull progress indicator (§6.1)

| Option                                                         | Pros                                                        | Cons                                                                           |
| -------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **A. Spinner + static label (current)**                        | Zero work                                                   | Looks frozen for tens of seconds on a cold pull                                |
| **B. Indeterminate `ProgressBar` + "N of M layers" sub-label** | Alive + honest; reuses existing components; modest plumbing | Layer count parsed from free-form CLI text (small regex); no true %            |
| **C. Docker Engine API / `dockerode` structured pull**         | Real per-layer byte totals → an actual percentage           | Larger change; new dependency/route away from the CLI-wrapper approach         |
| **D. "Dot per completed layer" row**                           | Visually pleasant for small bounded step counts             | Total layer count unknown until pull starts → row grows/shrinks, reads jittery |

> 💡 **Suggested:** **B** as the near-term win (alive UI without the C rework), with **C** noted as the
> "if we want a real percentage" follow-up. Avoid **D** — the unknown-until-runtime layer count makes
> the dot row jitter.

### 13.3 Cluster commands on the Quick Start row (§7.1)

| Option                                                            | Pros                                                              | Cons                                                                     |
| ----------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **A. Curated menu only (current)**                                | No risk of storage commands acting on an in-memory item           | Loses genuinely useful storage-independent commands (e.g. Open in Shell) |
| **B. Add specific storage-independent commands explicitly**       | Gains the useful ones; still no storage-command risk              | Each command re-declared with a Quick-Start `when`-clause                |
| **C. Split base contextValue into storage vs connection subsets** | Clean, reusable; Quick Start opts into the connection-only subset | Touches the base cluster item + every command's `when`; larger refactor  |

> 💡 **Suggested:** **B** now (add "Open in Shell"/"New Query" against the running instance), keep **C**
> as the eventual clean-up if more items want the same split.

### 13.4 External-delete / Missing recovery affordance (§9.1)

| Option                                                             | Pros                                                             | Cons                                                                   |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **A. Silent early-return (current)**                               | —                                                                | Looks broken; stale row; error only in the output channel              |
| **B. Detect missing → set Missing badge + info message**           | Reuses the existing `Missing` rendering + `liveStateGuard` style | User still has to choose the next step                                 |
| **C. B + actionable prompt: Delete / Recreate with same settings** | One-click recovery; matches the "click to recreate" Missing row  | Slightly more logic; must confirm `getReusableCredentials()` covers it |

> 💡 **Suggested:** **C**. It turns a silent dead-end into a self-service recovery, and most of the
> machinery (Missing rendering, credential reuse in `provision()`) already exists — the work is mainly
> routing `start`/`stop`/`restart` into it instead of early-returning.

### 13.5 Open terminal in container (§10.1)

| Option                                                   | Pros                                           | Cons                                                       |
| -------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------- |
| **A. `createTerminal` with `docker exec -it … bash`**    | Simplest; Docker drives the TTY; no custom pty | Assumes `bash` in the image                                |
| **B. A + `/bin/sh` fallback**                            | Works even on minimal images                   | Two-attempt logic (or a probe)                             |
| **C. Custom `Pseudoterminal` like the integrated shell** | Full control over I/O                          | Overkill for "just give me a shell"; more code to maintain |

> 💡 **Suggested:** **B** — the standard, low-maintenance pattern, gated on `state_running`. Reserve **C**
> only if we later want to parse/relay the shell I/O.
