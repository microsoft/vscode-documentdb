# DocumentDB Local Quick Start — UX Review Notes

**Feature area:** `src/services/localQuickStart/`, `src/commands/localQuickStart/`,
`src/tree/connections-view/LocalQuickStart/`, `src/webviews/documentdb/localQuickStart/`
**Related design docs:** `docs/ai-and-plans/local-quickstart/local-quickstart-v2.md`,
`docs/ai-and-plans/PRs/local-quickstart-poc/`, `docs/ai-and-plans/PRs/local-quickstart-multi-instance/`
**Review date:** 2026-07-09

## What this document is

This is a running log of manager (Tomaz) runtime observations on the Local Quick Start feature,
each enhanced with code research: exact locations, why the current behavior happens, and related
context or prior decisions. **Nothing in this document has been fixed yet** — findings are
discovery notes to inform a later triage/implementation pass. Severity/priority calls and actual
fixes are deliberately deferred to that follow-up.

---

## 1. Legacy emulator connections migration folder

**Observation:** Is the one-time migration of original "DocumentDB Local" emulator connections to
a new folder still happening? What's the folder called? Sorting could place it somewhere
unexpected.

**Code findings:**

- The one-time migration lives in [src/services/legacyEmulatorMigration.ts](../../../../src/services/legacyEmulatorMigration.ts),
  invoked from [src/documentdb/ClustersExtension.ts](../../../../src/documentdb/ClustersExtension.ts)
  on every activation (`migrateLegacyEmulatorConnections`), guarded by a `globalState` flag
  (`documentdb.localQuickStart.legacyEmulatorMigration.completed`) so it only runs once. Yes, it is
  still active code — nothing has removed it.
- Destination folder name: **`Local Connections (Legacy)`** (`LEGACY_FOLDER_BASE_NAME`), with a
  deterministic id (`vscode-documentdb.legacyLocalConnectionsFolder`) so retries reuse the same
  folder instead of duplicating it. If a user already has a root folder with that exact name, the
  migration suffixes it `(2)`, `(3)`, … (`uniqueLegacyFolderName()`).
- The folder is created directly under the **root of the regular Clusters/Connections zone** — it
  is a normal, renamable, movable folder like any user-created one, not a pinned/reserved node.
  Emulators-zone sub-folders are intentionally **flattened**: every migrated connection lands
  directly in this one folder (documented as a deliberate scope cut, not a bug).
- The legacy `Emulators` storage zone (and its `LocalEmulatorsItem` tree node) is kept as a
  read-only rollback path until migration succeeds, then the tree node is retired — see the
  `isLegacyEmulatorMigrationComplete()` gate in
  [ConnectionsBranchDataProvider.ts](../../../../src/tree/connections-view/ConnectionsBranchDataProvider.ts) (root items array).

**Why sorting can surprise:** Root-level items are assembled in `ConnectionsBranchDataProvider.getRootItems()`
in this fixed order: `LocalQuickStartItem` → (legacy `LocalEmulatorsItem`, if migration not yet
complete) → **all cluster folders, alphabetically** → **all ungrouped connections, alphabetically**
→ `New Connection` placeholder. Folders are sorted with a single
`localeCompare(..., { numeric: true })` pass across _all_ root folders — there is no special-casing
that pins "Local Connections (Legacy)" to the top or bottom. So depending on the user's other
folder names, it can land anywhere in the alphabetical list (e.g. between "Azure" and "Backups"),
which is easy to miss on a first look since nothing visually marks it as "this is where your old
stuff went."

**Open questions for later:** Should this folder be visually distinguished (icon, description
badge) or pinned to a fixed position (e.g., always first/last among folders) so users don't have to
hunt for it after upgrading? Should there be a one-time toast/notification pointing at it instead of
relying on the user noticing it in an alphabetical list? (The migration code comment doesn't
mention a toast — worth confirming whether one exists elsewhere; a search for a notification tied to
`MIGRATION_COMPLETED_KEY` didn't surface one in this pass.)

---

## 2. "Delete Container" confirmation doesn't match the standard delete flow

**Observation:** The Delete Container modal is fine as a concept, but it should use the same delete
confirmation code path as other destructive actions (e.g., in Settings), and should not use
em dashes.

**Code findings:**

- Standard destructive commands — [removeConnection.ts](../../../../src/commands/removeConnection/removeConnection.ts),
  [deleteCollection.ts](../../../../src/commands/deleteCollection/deleteCollection.ts),
  [deleteDatabase.ts](../../../../src/commands/deleteDatabase/deleteDatabase.ts),
  [ConfirmDeleteStep.ts](../../../../src/commands/connections-view/deleteFolder/ConfirmDeleteStep.ts) —
  all call **`getConfirmationAsInSettings()`** from
  [src/utils/dialogs/getConfirmation.ts](../../../../src/utils/dialogs/getConfirmation.ts). That
  function reads the `ext.settingsKeys.confirmationStyle` VS Code setting and dispatches to one of
  three styles: type-the-word, a number challenge, or a plain click-confirm — i.e. "confirm like in
  settings" is a user-configurable, shared code path.
- `deleteQuickStartInstance()` in
  [localQuickStartCommands.ts](../../../../src/commands/localQuickStart/localQuickStartCommands.ts)
  instead calls **`getConfirmationWithClick()`** directly — the click-only style, unconditionally,
  ignoring the user's configured `confirmationStyle`. It's the odd one out; the only other callers
  of `getConfirmationWithClick` directly (bypassing the setting) are `hideIndex`/`unhideIndex`
  (non-destructive, reversible operations) and two spots in `QueryInsightsAIService.ts` — none of
  which are "delete data permanently" operations like this one.
- Em dashes: the two confirmation `detail` strings in `deleteQuickStartInstance` both contain a
  literal em dash — `'…This cannot be undone — you can recreate a fresh instance…'` — plus one in a
  code comment above it. Same character also appears in several other user-facing strings in this
  feature (e.g., `LocalQuickStart.tsx` next-steps bullets: `'Open Connection — browse your
databases…'`, `'Copy Connection String — use it from…'`, and the "waiting" timeout message
  `'…may still be initializing — keep waiting, view the logs, or start over.'`). Worth a sweep of
  the whole feature, not just the delete dialog, if em dashes are to be eliminated consistently.

**Open questions for later:** Should Delete Container switch to `getConfirmationAsInSettings` (word
confirmation would ask the user to type something — worth deciding what word, since there's no
existing "type container name" concept for Quick Start)? Should the whole feature's strings be
swept for em dashes/other punctuation-style consistency in one pass rather than piecemeal?

---

## 3. Empty Quick Start list — tree item wording

**Observation:** The tree items shown when there's no managed instance yet should be reworded. The
action row should say something like "Click here to…". "Learn more" could be dropped from the list
and instead live in the context menu of the local node.

**Code findings:** Both rows are built in `LocalQuickStartItem.getChildren()`
([LocalQuickStartItem.ts](../../../../src/tree/connections-view/LocalQuickStart/LocalQuickStartItem.ts))
for the `NotInstalled` state (no metadata yet):

- Action row: label `l10n.t('Quick Start — Install & try DocumentDB locally')`, rocket icon,
  `contextValue: 'treeItem_quickStartAction'`, bound to command
  `vscode-documentdb.command.localQuickStart.open`.
- Learn-more row: label `l10n.t('Learn more…')`, `link-external` icon,
  `contextValue: 'treeItem_quickStartLearnMore'`, bound to `vscode.open` with a hardcoded URL to
  `https://github.com/microsoft/documentdb`.
- Also note: this same action label/icon/command (`treeItem_quickStartAction` /
  `localQuickStart.open`) is reused for the `Missing` state's alternate rendering path (see finding
  #12 below) — any rewording of the "click to do X" phrasing should stay consistent across both
  surfaces.
- Neither row currently has **any** `view/item/context` entry in `package.json` — a search for
  `treeItem_localQuickStart`, `treeItem_quickStartAction`, or `treeItem_quickStartLearnMore` in
  `package.json` returns no matches. So today "Learn more" only exists as its own list row; there is
  no existing context-menu wiring to move it into, moving it to the parent
  (`treeItem_localQuickStart`) node's context menu would be new plumbing, not a small toggle.

**Open questions for later:** Confirm exact copy for the action row (e.g. "Click here to install
DocumentDB locally with Quick Start" — needs to stay short for a tree row). Decide whether "Learn
more" moves to the parent `DocumentDB Local - Quick Start` node's context menu (new `view/item/context`
entry gated on `treeItem_localQuickStart`) or is dropped from the tree entirely in favor of the
walkthrough/README.

**Fix applied (2026-07-09):** Implemented the quick, low-risk half of this finding directly (the
"move Learn more into the parent context menu" question above is still open/deferred — this only
covers the reword + drop):

- Action row label changed from `'Quick Start — Install & try DocumentDB locally'` to
  `'Click here to install & try DocumentDB locally'`.
- The separate `'Learn more…'` row (`contextValue: 'treeItem_quickStartLearnMore'`) was removed
  entirely from the `NotInstalled` empty state — it is not (yet) relocated to a context menu; that
  part of the original ask is left as an open item above, since no `view/item/context` plumbing
  exists for `treeItem_localQuickStart` today (would be new work, not a move).
- Both changes are in
  [LocalQuickStartItem.ts](../../../../src/tree/connections-view/LocalQuickStart/LocalQuickStartItem.ts),
  `getChildren()`'s `NotInstalled` branch. The `Missing` state's row (finding #11) still reuses the
  `treeItem_quickStartAction` contextValue/command but keeps its own distinct label
  (`'Missing · click to recreate'`) — unaffected by this change.
- Not done as part of this quick fix: the `treeItem_quickStartLearnMore` contextValue is no longer
  referenced anywhere, and the external link (`https://github.com/microsoft/documentdb`) is no
  longer reachable from the tree at all until/unless it's re-added via a context menu.

---

## 4. Webview header changes with state and can get stuck

**Observation:** The header should be static; today it changes depending on status/progress/errors,
which is unexpected. It sometimes gets stuck on "Setting up DocumentDB Local…" even when the
operation is actually complete.

**Code findings** (all in
[LocalQuickStart.tsx](../../../../src/webviews/documentdb/localQuickStart/LocalQuickStart.tsx)):

- The header ("hero") is rendered by a local `hero(title, subtitle)` helper, called **three
  separate times** with different literal titles depending on `phase`:
  - `phase === 'dockerNotReady'` → `l10n.t('Docker is required')`
  - `phase === 'provisioning' || phase === 'success' || phase === 'failed'` → **the same call**,
    `l10n.t('Setting up DocumentDB Local…')`, with the subtitle showing the elapsed timer only
    while `phase === 'provisioning'` (empty string otherwise)
  - `phase === 'review'` (the initial screen) → `l10n.t('Start DocumentDB Local')`
- This confirms both parts of the observation exactly:
  1. The header text does change across phases (three different literal strings), which reads as
     inconsistent/jumping if a user watches the panel through a full run.
  2. **The "stuck" complaint is a real bug, not perception**: `success` and `failed` reuse the exact
     same title as `provisioning` — "Setting up DocumentDB Local…" is still shown even once the
     instance is fully running (`phase === 'success'`) or once setup has definitively failed
     (`phase === 'failed'`). Only the content _below_ the header (the `successBox`/`errorBox`, the
     stage checklist, and the action buttons) reflects the actual outcome — the header itself never
     catches up.
- There is a `provisioningStatusMessage` computed a few lines above (derived from the active stage
  label) that IS phase/stage-aware and correctly blanks itself out once any stage errors — but it's
  only surfaced to screen readers via a visually-hidden `aria-live` region, not shown visually.

**Open questions for later:** Should the header become a single static string for the whole
provisioning/success/failed lifecycle (e.g. "DocumentDB Local"), with all state communicated via
subtitle/body instead? Or should it explicitly branch on `success`/`failed` like the review/error
screens already do for `dockerNotReady`?

---

## 5. "Waiting for DocumentDB to accept connections" wording / intermediate progress

**Observation:** This message could be reworded, or show some intermediate progress as a sub-info,
since it can take time.

**Code findings:**

- Stage label: `STAGE_LABELS.waiting = l10n.t('Waiting for DocumentDB to accept connections')` in
  `LocalQuickStart.tsx`. The service-side stage message is
  `'Waiting for DocumentDB to accept connections…'` in
  [QuickStartService.ts](../../../../src/services/localQuickStart/QuickStartService.ts) (`provision()`,
  `--- waiting ---` section).
- This stage wraps `waitForReadiness()`, which polls the wire protocol (a real MongoClient
  connection attempt) with a `READINESS_TIMEOUT_MS = 180_000` (3 minutes) budget and a
  `PROBE_SERVER_SELECTION_TIMEOUT_MS = 3_000` per attempt — i.e. it can legitimately retry for up to
  3 minutes with no visible change other than the elapsed-time counter in the (currently static,
  see #4) header subtitle.
- There is no intermediate sub-status during this stage today — the stage row just shows a spinner
  - the same static label the whole time; the per-attempt retry count / time remaining isn't
    surfaced. Logs _do_ stream to the "DocumentDB Local Quick Start" output channel during this window
    (via `followLogs`, started right after `docker start`), so the information exists, just not
    in-panel.
- On timeout, a distinct `ReadinessTimeoutError` is raised (kept separate from hard failures
  specifically so the container is preserved and "Wait longer" can resume it) — the `failed` phase
  with `timedOut === true` shows a dedicated message: `'The container is running, but DocumentDB has
not accepted connections yet. It may still be initializing — keep waiting, view the logs, or start
over.'` (contains another em dash — see #2).

**Open questions for later:** What sub-info would be useful here — elapsed time within the stage,
attempt count, a rotating "still working" hint after N seconds, or a link to "View Docker output"
surfaced earlier instead of only at the bottom of the panel? Any reword should stay accurate for
both a fresh pull-to-ready cold start and a plain restart (both funnel through the same stage).

---

## 6. Image pull/download progress tracking

**Observation:** Do we track progress while the image is downloaded? That's a long-running
operation too.

**Code findings:**

- `provision()` yields exactly one `active` `StageEvent` for the pulling stage — `stageEvent('pulling',
'active', 'Pulling the official image…')` — then `await this.runtime.pullImage(imageRef,
cts.token)`, then one `done` event. No intermediate events are yielded between those two.
- `ContainerRuntime.pullImage()` ([ContainerRuntime.ts](../../../../src/services/localQuickStart/ContainerRuntime.ts))
  runs `docker pull` through the shared CLI shell-runner (`@microsoft/vscode-container-client`'s
  `DockerClient`), with `stdout`/`stderr` piped only to the output channel via
  `MaskedChannelWritable` (line-buffered + secret-masked). Nothing from that stream is captured,
  parsed, or forwarded back to the caller — so per-layer Docker progress (`Downloading`,
  `Verifying Checksum`, `Extracting`, `Pull complete`, etc., one line per layer per event when not
  attached to a TTY) is visible **only** in the raw output channel text, never in the webview.
- So: no, there is no structured progress tracking for the pull today, confirming the observation.
  The webview shows a spinner + static label for however long the pull takes, same as "waiting" (#5).

**Ideas for indeterminate/step progress (no fix applied, just candidates to discuss):**

- Docker's plain-text pull output (non-TTY) already gives one line per layer per status
  transition, including a `"<layer-id>: Pull complete"` line once each layer finishes. Since the
  number of layers isn't known until Docker starts announcing "Pulling fs layer" lines, a
  precise percentage isn't available up front, but a **running count of "N of M layers pulled"**
  is derivable simply by tracking, per pull, how many distinct layer ids have been seen so far
  (M, growing) vs. how many have reached `Pull complete` (N) — that only requires
  `ContainerRuntime.pullImage` to accept an optional line/progress callback instead of writing
  straight to the channel, and forwarding parsed counts as extra `StageEvent` fields (mirroring how
  `boundPort`/`timedOut` already ride along on `StageEvent` for other stages).
  - **Caveat:** because non-TTY docker pull is a plain scrolling text stream, not a JSON event
    stream, layer counting means resurrecting a small regex parser over free-form CLI text. It'd be
    more robust (and would expose _actual_ byte totals per layer, since Docker does know each
    layer's compressed size) to switch this specific call to the Docker Engine API's pull endpoint
    directly (e.g. via `dockerode`'s `docker.pull()`, which streams structured JSON progress events
    with `id`, `status`, and `progressDetail: { current, total }` per layer) rather than parsing CLI
    text — a larger change than the current CLI-wrapper approach, worth flagging as a design
    decision rather than a quick tweak.
- On the visual side, since a true 0–100% isn't known in advance without that JSON-stream rework,
  an **indeterminate `ProgressBar`** (Fluent UI v9 `ProgressBar` with no `value` prop renders as an
  animated indeterminate bar) reads better than a static spinner for a stage that can run tens of
  seconds, and is already a component this design system ships — no new dependency. Layered under
  it, a small live sub-label like "Downloading… (3 of 6 layers)" would satisfy the "some kind of
  progress" ask without needing byte-accurate totals — that count is the cheap parse described
  above, not the JSON-stream rework.
- A literal "dot per completed layer" (e.g. a row of small filled/empty dots) is visually appealing
  for a small, bounded number of steps, but is a poor fit here specifically because the total layer
  count isn't known until the pull starts announcing them — the dot row would have to grow/shrink
  as new layers appear, which reads as jittery. The numeric "N of M" counter (or an indeterminate
  bar with that counter as a sub-label) avoids that problem while still being honest about what we
  actually know.
- Either option is a genuine, if modest, plumbing change (new callback param on `pullImage` /
  `IContainerRuntime`, a new `StageEvent` shape, and webview rendering), not a copy tweak — worth
  scoping separately from the wording-only findings above.

---

## 7. Running-container tree item doesn't share cluster context commands

**Observation:** The tree item for a running managed instance doesn't share context menu commands
with regular clusters. Do we still extend the cluster item base class? If not, what would break if
we did?

**Code findings:**

- Yes, it still extends the base class: `QuickStartClusterItem extends DocumentDBClusterItem` in
  [LocalQuickStartItem.ts](../../../../src/tree/connections-view/LocalQuickStart/LocalQuickStartItem.ts).
  It overrides `getTreeItem()` only to force the state-aware description text, and reuses the base
  class for icon, tooltip, and (critically) all the actual cluster-browsing behavior — the comment
  on the class explicitly says browsing "reuses the base `DocumentDBClusterItem`."
- The reason regular cluster context commands don't show up: the **contextValue is fully replaced**,
  not extended. The constructor sets
  `this.contextValue = createContextValue([INSTANCE_CONTEXT, stateToken])` — i.e.
  `treeItem_quickStartInstance` + `state_running` (etc.) — which **discards** whatever contextValue
  the base `DocumentDBClusterItem` constructor/`getTreeItem()` would normally compute (which
  includes the `treeitem_documentdbcluster` token). Every regular-cluster `view/item/context` entry
  in `package.json` gates on `viewItem =~ /\btreeitem_documentdbcluster\b/i` (e.g.
  `updateConnectionString`, `updateCredentials`, `renameConnection`, `moveItems`,
  `removeConnection`) — none of those `when` clauses match a Quick Start row, since that token is
  never present on it.
- This looks deliberate, not an oversight: the class-level comment says the Quick Start node
  "carr[ies] a Quick-Start-specific context value so the instance shows Quick Start lifecycle
  actions **instead of** the generic cluster menus." The `INSTANCE_CONTEXT` token instead gates the
  Quick Start–specific commands (`start`/`stop`/`restart`/`delete`/`copyConnectionString`/
  `copyPassword`/`viewLogs`), each `when`-clause requiring both `treeItem_quickStartInstance` and a
  specific `state_*` token (see `package.json`, `view/item/context` for
  `vscode-documentdb.command.localQuickStart.*`).
- **What would likely break if the base contextValue were also kept (appended rather than
  replaced):** the generic cluster commands assume storage-backed operations — `removeConnection`
  deletes a _stored connection record_, `moveItems`/`renameConnection` operate against
  `ConnectionStorageService`, `updateConnectionString`/`updateCredentials` open storage-editing
  wizards. The Quick Start instance is explicitly **not** stored in any zone (the model comment says
  "the Quick Start managed instance is in-memory (CredentialCache-based) and not stored in any
  zone"). Enabling those commands as-is would let a user try to "rename"/"move to folder"/"delete
  connection" an item that has no storage record to act on — likely a silent no-op at best, or an
  exception/orphaned-state at worst, unless each of those commands were also taught to special-case
  the Quick Start row. So the current full-replacement approach avoids a class of bugs, but at the
  cost of losing genuinely useful, storage-independent commands too, e.g. "Open in Shell" / "New
  Query" style commands if any are gated only on `treeitem_documentdbcluster` without also touching
  storage — worth an inventory of exactly which cluster commands are storage-dependent vs. purely
  connection-based, since only the latter could be safely re-enabled.

**Open questions for later:** Would it be worth splitting the base contextValue into a
storage-dependent subset and a connection-only subset, so Quick Start could opt into the latter? Or
is a curated, Quick-Start-specific menu (as today) actually the right long-term shape, just missing
a few commands (e.g., "Open in Shell") that should be added explicitly rather than inherited?

---

## 8. Copy Connection String is a separate, slightly different implementation

**Observation:** Copy Connection String appears to be reimplemented for Quick Start and behaves
slightly differently — it doesn't ask whether to include the password.

**Code findings:**

- Regular clusters: `copyConnectionString()` in
  [copyConnectionString.ts](../../../../src/commands/copyConnectionString/copyConnectionString.ts)
  calls `context.ui.showQuickPick` with two options — "The connection string will not include the
  password" vs. "...will include the password" — gated by `canIncludeNativePassword()`, only
  prompting when native-auth credentials are actually present. Well tested (see
  `copyConnectionString.test.ts`, e.g. "picks WITH/WITHOUT password" cases).
- Quick Start: `copyQuickStartConnectionString()` in
  [localQuickStartCommands.ts](../../../../src/commands/localQuickStart/localQuickStartCommands.ts)
  is a completely separate, much shorter function — it reads `metadata.connectionString` (which
  already has the generated username/password embedded from `composeConnectionString()`) and copies
  it directly to the clipboard with no prompt at all. There's a **separate** `copyQuickStartPassword()`
  command for copying just the password, but the "copy connection string" action always includes the
  password silently.
- This is a genuine behavioral difference, not just a styling one: for a regular cluster, a user is
  asked each time whether the clipboard should carry the plaintext password; for the Quick Start
  instance, the password always goes to the clipboard silently whenever "Copy Connection String" is
  used. Given Quick Start's own design docs are otherwise careful about credential handling (masked
  output-channel logging, env-file instead of CLI args, etc. — see `outputMasking.ts` and the
  `D14`/masking comments throughout `QuickStartService.ts`), this asymmetry stands out.

**Open questions for later:** Should Quick Start's "Copy Connection String" reuse the same
QuickPick-based confirmation as the regular command (auto-answering "Quick Start always uses native
auth" without extra branching), for parity and because it's also copying a plaintext password to the
clipboard?

---

## 9. "Open terminal in the Docker container" — feasibility

**Observation:** Would it make sense to add a command to open a terminal inside the Docker
container? Can this be done?

**Code findings / feasibility:**

- The repo already has precedent for terminal-backed commands:
  [openInteractiveShell.ts](../../../../src/commands/openInteractiveShell/openInteractiveShell.ts)
  calls `vscode.window.createTerminal({ name, pty, iconPath })` with a custom
  `DocumentDBShellPty` (`vscode.Pseudoterminal`) for the integrated mongosh-style shell — that's a
  more elaborate mechanism (a custom pty implementation) built for a different purpose (parsing/
  relaying shell I/O), not required here.
- For a plain "shell into the container" command, the much simpler standard VS Code pattern is
  `vscode.window.createTerminal({ name, shellPath: 'docker', shellArgs: ['exec', '-it', containerId,
'/bin/bash'] })` (with a `/bin/sh` fallback if `bash` isn't present in the image) — this is exactly
  how other Docker-focused VS Code extensions expose "Attach Shell"/"Open in Terminal". No custom
  pty is needed since Docker itself drives the interactive TTY.
- The container id is already tracked in-memory (`InstanceRuntimeState.metadata.containerId`) and
  exposed via `QuickStartService.getStatus().metadata`, so the command would have everything it
  needs without new state plumbing. `ContainerRuntime` already has `execShellInContainer()`, but
  that's a fire-and-forget non-interactive `docker exec` used for the sample-data init script — it
  writes to the output channel, not a live TTY, so it isn't directly reusable for an interactive
  terminal; a new, simple command function (not a `ContainerRuntime` method) would be the more
  natural fit, calling `createTerminal` directly the way `openInteractiveShell` does.
- No fundamental blocker found: Docker is already a hard dependency for this whole feature, so
  requiring `docker` on PATH for this command adds no new dependency. The main design questions are
  which state(s) it should be enabled for (`state_running` only, presumably — a stopped container
  can't `exec` into it) and what shell to try first.

**Open questions for later:** Confirm which context-menu group/icon this would use, and whether it's
worth a fallback prompt if `bash` isn't in the image (the DocumentDB image's shell availability
wasn't checked in this pass).

---

## 10. How are the Quick Start tree icons chosen?

**Observation:** How are the icons chosen for the Quick Start DocumentDB instances?

**Code findings:** There's no bespoke Quick Start icon set — every icon is either the generic
extension logo or inherited/generic VS Code `ThemeIcon`s, reused from existing logic:

- **Root node** (`DocumentDB Local - Quick Start`): the extension's own product icon —
  `vscode-documentdb-icon-{light,dark}-themes.svg` from `getResourcesPath()` — same icon used
  elsewhere for the extension/product identity, not specific to Quick Start.
- **Running instance row** (`QuickStartClusterItem`): no icon override at all — it falls through to
  the inherited `DocumentDBClusterItem.getTreeItem()` icon logic, which picks
  `$(plug)` **iff** `cluster.emulatorConfiguration?.isEmulator` is true, else `$(server-environment)`.
  Since the Quick Start model always sets `emulatorConfiguration: { isEmulator: true, ... }` (see
  `LocalQuickStartItem.getChildren()`), the running row always gets `$(plug)` — the exact same icon
  any other connection flagged as an "emulator" gets (including the legacy migrated connections in
  finding #1, which also carry `isEmulator: true`). There is nothing that visually distinguishes "the
  one managed-by-Quick-Start instance" from "any other connection someone marked as an emulator."
- **Non-running state rows** (Starting/Stopping/Stopped/Error/Missing): plain generic VS Code
  `ThemeIcon`s chosen per state in `LocalQuickStartItem.getChildren()` —
  `loading~spin` (Starting/Stopping/Provisioning), `circle-outline` (Stopped), `warning` with
  `list.errorForeground`/`list.warningForeground` theme color (Error/Missing). None of these relate
  to cluster icons at all; they're the same generic vocabulary used for background-task rows
  elsewhere in the extension.
- **Empty-state rows:** `rocket` (action) and `link-external` (Learn more) — again generic
  `ThemeIcon`s, not custom art.

**Open questions for later:** Is `$(plug)` (shared with any manually-flagged "emulator" connection)
an acceptable representation for the one managed local instance, or should Quick Start rows carry a
distinct icon (e.g. reusing the rocket used for the root node/action row) so the "this is the
Quick-Start-managed one" identity is visually obvious at a glance, independent of state?

---

## 11. Deleted-externally container isn't handled when the user tries "Start"

**Observation (repro):** Created an instance via Quick Start, stopped it, then deleted the
_container_ directly via Docker (outside VS Code). Back in VS Code, clicking Start on the (still
"Stopped"-looking) tree row does nothing visible — no error dialog, no tree update — only the raw
Docker error appears in the "DocumentDB Local Quick Start" output channel:

```
$ docker container inspect --format '{{json .}}' 57f8311fd9ec77aed5483b6ef36da22890f8a71e1057073f884273ba89c68248
Error response from daemon: No such container: 57f8311fd9ec77aed5483b6ef36da22890f8a71e1057073f884273ba89c68248
```

**Code findings — this traces to a specific, reproducible gap, not vague flakiness:**

- `ContainerRuntime.inspectContainer()` ([ContainerRuntime.ts](../../../../src/services/localQuickStart/ContainerRuntime.ts))
  wraps the CLI call in `try { ... } catch { return undefined; }` — it deliberately swallows _all_
  errors, including "No such container," into a plain `undefined` return. That's a reasonable
  existence-check contract on its own. But every call is still run through the shared
  `makeRunner()`, whose `onCommand` callback unconditionally logs `'$ ' + command` to the output
  channel _before_ running, and whose `stdErrPipe` streams the daemon's stderr response into the
  same channel regardless of whether the caller ends up treating the failure as "expected." That's
  exactly the two lines the user saw — this is the extension's own inspect call being logged, not a
  manual terminal session.
- `start()` (`QuickStartService.ts`) calls `this.isManaged(id, alias)` before doing anything else:
  ```ts
  private async isManaged(containerId, alias) {
      const item = await this.runtime.inspectContainer(containerId);
      if (!item || item.labels?.[QUICK_START_LABEL_KEY] !== '1') return false;
      return this.aliasMatches(...);
  }
  ```
  When the container has been removed, `inspectContainer` returns `undefined` → `isManaged` returns
  `false` — **the exact same `false` it would return for "this container exists but isn't ours."**
  `isManaged()` cannot distinguish "gone" from "not managed by us."
- Back in `start()`:
  ```ts
  if (!id || !(await this.isManaged(id, alias)) || !(await this.liveStateGuard(id, ['stopped']))) {
    return;
  }
  ```
  Because `isManaged` already returned `false`, the `||` short-circuits — **`liveStateGuard()` is
  never even called** for this scenario. That matters because `liveStateGuard` is the piece of code
  that _would_ have handled this gracefully: it explicitly checks for a `'missing'` live state, calls
  `refreshLiveState()`, and shows `vscode.window.showInformationMessage(...)` telling the user the
  instance changed in another window. That path exists and is well-built for _other_ window /
  external-stop scenarios — it's just unreachable here because `isManaged` gates in front of it and
  returns the same "false" for two different situations.
- Net effect: `start()`'s whole body becomes a silent early `return` — no `setStatus(...)` call, so
  `statusEmitter` never fires, so `ConnectionsBranchDataProvider.refresh()` (wired in
  `ClustersExtension.ts` via `QuickStartService.onDidChangeStatus`) never runs, so the tree keeps
  showing the stale "Stopped" row indefinitely until something else (e.g. expanding/collapsing the
  node, which re-triggers `LocalQuickStartItem.getChildren()` → `refreshLiveState()`) happens to
  refresh it independently.
- Worth noting there's already a very similar, well-designed pattern for a related case:
  `refreshLiveState()` itself _does_ correctly set `entry.missing = true` and fire the status event
  when a periodic/tree-driven check finds the container gone — and the tree already has full
  rendering support for that (`Missing · click to recreate`, bound to reopen the Quick Start panel,
  which re-provisions). The gap is specifically that the **lifecycle actions** (`start`/`stop`/
  `restart`, and to a lesser extent `deleteContainer`, which has its own separate fallback lookup)
  don't funnel through that same "missing" detection before giving up.

**Open questions for later (explicitly deferred — discuss when fixing):**

- Should `isManaged()` (or a new check ahead of it in `start`/`stop`/`restart`) distinguish "no
  container found" from "found but not ours," and in the former case do what `liveStateGuard`
  already does for the multi-window case — refresh live state + surface a message — rather than
  silently returning?
- What should the message/options be? The user's suggestion: tell them the container wasn't found
  (possibly deleted), and offer next steps — Delete (clean up the stale metadata/volume) and/or
  "reload with same settings" (re-provision using the same image/credentials, similar to how the
  existing `Missing` row already offers "click to recreate"). Note the `Missing` row's recreate flow
  and the reuse-credentials path in `provision()` (`getReusableCredentials`) may already cover most
  of "reload with same settings" — worth checking whether that flow is sufficient once actually
  reachable from `start()`/`stop()`/`restart()`, or needs its own affordance.

---

## Summary table

| #   | Topic                                             | Status                                                                                                                                      |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Legacy migration folder name/placement            | Confirmed: `Local Connections (Legacy)`, alphabetically sorted with no pinning                                                              |
| 2   | Delete Container confirmation + em dashes         | Confirmed: bypasses `getConfirmationAsInSettings`; em dashes present in multiple strings                                                    |
| 3   | Empty-state tree row wording/Learn-more placement | **Fix applied:** reworded to "Click here to install & try DocumentDB locally"; "Learn more" row dropped (context-menu relocation left open) |
| 4   | Webview header instability / stuck text           | Confirmed real bug: `success`/`failed` reuse the `provisioning` header verbatim                                                             |
| 5   | "Waiting for connections" wording/sub-progress    | Confirmed: static label for up to 3 minutes, no sub-status shown in-panel                                                                   |
| 6   | Image pull progress tracking                      | Confirmed: none; ideas drafted (layer counter, indeterminate `ProgressBar`)                                                                 |
| 7   | Running-instance row vs. cluster context commands | Confirmed deliberate contextValue replacement; discussed what would break if merged                                                         |
| 8   | Copy Connection String reimplementation           | Confirmed: separate function, no password-inclusion prompt unlike regular clusters                                                          |
| 9   | Open terminal in container                        | Feasible via `createTerminal` + `docker exec -it`; no blocker found                                                                         |
| 10  | Icon selection logic                              | Confirmed: no bespoke icons; inherited/generic `ThemeIcon`s throughout                                                                      |
| 11  | Externally-deleted container not handled on Start | Root cause found: `isManaged()` conflates "missing" with "not ours," bypassing the existing `liveStateGuard` missing-state handling         |
