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
deleted **outside** VS Code. Most items are wording/consistency polish; one (§4.2 header) is a real
"stuck UI" bug; §9 collects the harder robustness failures — a silent no-op on Start after an external
delete, and a **restart dead end** when saved credentials go missing (hit live during the review) that
also exposed a broader anti-pattern: **tree nodes used as error dialogs**. §8 adds the data/volume
model questions (ephemeral toggle, delete-drops-volume, image-linked volumes, delete-only-our-containers).

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

## 4. The setup webview — flow, loading & header

### 4.1 Current flow — what the webview shows, and when 🔍

**Observation:** It should be clear what the setup webview renders at each step, so reviewers know
which screen a finding refers to.

**Finding:** The panel is one React component driven by a `Phase` state machine
(`'loading' | 'review' | 'dockerNotReady' | 'provisioning' | 'success' | 'failed'` in
[LocalQuickStart.tsx](../../../../src/webviews/documentdb/localQuickStart/LocalQuickStart.tsx)). On
open it queries `getDockerStatus`, then branches:

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

Phase-by-phase, what is actually rendered:

- **loading** — **only** a full-panel `<Spinner label="Checking Docker…" />`. No hero/title, no cards
  — the whole panel is the spinner until `getDockerStatus` resolves, then it snaps to the next
  layout (see §4.3).
- **dockerNotReady** — `hero("Docker is required")` + **three** readiness cards (Docker CLI / Docker
  daemon / Platform, each with a ✓/! badge) + a "How to fix" card + `Retry`.
- **review** — `hero("Start DocumentDB Local")` + **four** config cards (Image / Port / Data /
  Security) + a summary + a collapsed **Advanced** panel + `Start DocumentDB Local`.
- **provisioning** — `hero("Setting up DocumentDB Local…")` + elapsed timer + the stage checklist
  (checking → pulling → creating → starting → waiting → done) + `Cancel` + `View Docker output`.
- **success** — header still reads "Setting up…" (bug, §4.2) + a success box + Next steps +
  `Open Connection` / `Copy Connection String` / `Close`.
- **failed** — header still reads "Setting up…" (§4.2) + an error box + either `Retry` / `Edit
settings`, or (on a readiness timeout) `Wait longer` / `Start over`.

### 4.2 The webview header changes with state and gets stuck on "Setting up…" ⚠️

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

### 4.3 The initial "Checking Docker" loading should render chrome + skeleton cards (reuse the metric card) ⚠️💡

**Observation:** The initial `loading` ("Checking Docker") state should be reworked to behave like the
**Query Insights** view: the webview chrome renders immediately (title + header/hero), and the four
cards behave like our **metrics cards** — they show a **loading skeleton** while status resolves, then
fill **independently** (at least from a UX perspective; we don't care about splitting the backend now,
that's for later). Worth **reusing the existing metric card** — it's accessible and has tooltip
support, a better experience.

**Finding:**

- ⚠️ The `loading` phase renders **only** `<Spinner label="Checking Docker…" />` inside an otherwise
  empty panel — no hero/title, no cards (§4.1). When `getDockerStatus` resolves, the panel **snaps**
  from a bare spinner to the full `dockerNotReady`/`review` layout, which is the jump the observation
  describes. Query Insights, by contrast, renders its header + metric row up front and lets the
  individual metrics resolve into place.
- 🔍 The readiness/config cards use a **local, simplified** `MetricCard` defined inline in
  [LocalQuickStart.tsx](../../../../src/webviews/documentdb/localQuickStart/LocalQuickStart.tsx)
  (a plain `Card` with label + value + optional badge) — **no skeleton, no tooltip, weaker a11y.**
- 🔍 Query Insights already ships a purpose-built, accessible metric card: **`MetricBase`** at
  [MetricBase.tsx](../../../../src/webviews/documentdb/collectionView/components/queryInsightsTab/components/metricsRow/MetricBase.tsx).
  It supports a **loading skeleton** (`value === undefined` → `SkeletonItem`), a **null/unavailable**
  placeholder, **tooltip explanations** (`tooltipExplanation`), and a solid **accessibility** pattern
  (keyboard-focusable card, an `aria-label` carrying label + value + tooltip, `aria-hidden` children
  to avoid double announcement). That's exactly the skeleton + tooltip + a11y behavior the
  observation asks for.

💡 **Suggestion:**

1. Rework `loading` so it renders the **hero/header immediately** (like every other phase, and like
   Query Insights), then renders the readiness cards in **skeleton** state, each flipping to its
   value independently as status resolves — no need to split the backend; from the UX side a card can
   go skeleton → value on its own.
2. **Reuse `MetricBase`** instead of the local `MetricCard`. It's accessible and has tooltip +
   skeleton support out of the box — a better experience than the inline card. Two bits of work: (a) a
   small **extension** (e.g. a badge slot for the ✓/! status badge the readiness cards use), and (b)
   **relocation to a shared** webview location — it currently lives buried under
   `collectionView/queryInsightsTab/`, and importing a query-insights-internal component into the
   Quick Start webview is the wrong dependency direction. The move + small extension is worth it: one
   accessible, tooltip-capable metric card shared across features.

### 4.4 Advanced panel: credentials should sit behind a toggle, and "placeholder = default" is ambiguous ⚠️💡

**Observation:** In the Advanced section, username + password should be grouped **behind a toggle** —
the user flips "override the default" and only then specifies a username and password. The current
ghost text **"auto"** is confusing (is it the default _value_?). More generally, the panel label says
_"Leave any field blank to keep the automatic default,"_ yet the **Image tag** field shows **"latest"**
as ghost text — so how is the user meant to "keep it blank"? The person who addresses this should
**think through the options**.

**Finding** (Advanced panel in
[LocalQuickStart.tsx](../../../../src/webviews/documentdb/localQuickStart/LocalQuickStart.tsx),
`renderAdvanced()`):

- On a fresh provision (`!isRecreate`) the panel renders Port, Image tag, Username, Password (each
  always visible) + a "Load sample data" switch, under the label _"Leave any field blank to keep the
  automatic default."_
- ⚠️ **Placeholder means two different things across fields.** Port's placeholder is the literal
  default value (`10260`), Image tag's is the literal default tag (`latest`) — but Username/Password
  use the word **`'auto'`**, which is a _description of behavior_ ("will be auto-generated"), not a
  value you'd type. So "latest" reads as if a value is already set, while "auto" reads as a mode.
  Combined with "leave blank to keep the default," the greyed-in `latest` makes it genuinely unclear
  whether the field is pre-filled or empty — the exact confusion the observation calls out.
- 🔍 The credentials already follow a **both-or-neither** rule in `advValidation`
  (_"Enter both a username and a password, or leave both blank to auto-generate."_). A toggle would
  encode that rule structurally instead of leaving it to a validation error after the fact.
- 🔍 On a recreate (`isRecreate`) the credential/tag fields are already hidden and replaced by a note
  that the original credentials/image are reused — so this only concerns the fresh-provision path.

💡 **Suggestion:**

1. **Group credentials behind a toggle.** Add an "Override generated credentials" (or "Set my own
   username & password") switch, **off** by default. Off → show a short read-only note
   ("Auto-generated, stored securely," matching the summary card); On → reveal both fields, required
   together (reuses the existing both-or-neither validation). This removes the ambiguous `'auto'`
   ghost text entirely and makes "I want to override" an explicit, discoverable action.
2. **Resolve the "placeholder = default value" ambiguity** — options for whoever implements it to weigh
   (the goal: a user can always tell "blank = default" from "I typed a value"):
   - **A. Drop literal-value placeholders.** Leave the input visually empty (or a neutral
     "Default") and keep the real default only in the `hint` line under the field (the panel already
     renders _"Default {port}"_ / _"Default “latest”"_ / _"Default: auto-generated"_). Then "leave
     blank = default" is honest: the box looks empty, the hint states the default. Cheapest and most
     consistent.
   - **B. Pre-fill the actual default value** (not a placeholder) and let the user edit it. No "blank"
     concept at all — what you see is what runs. But then the "leave blank" label must go and empty
     must be re-validated/normalized.
   - **C. Per-field "Use default" affordance** (checkbox/toggle per field). Most explicit, but heavier
     and busier than A for a panel that already has one toggle model in suggestion 1.
   - **Leaning A** for consistency + minimal work, paired with suggestion 1 so credentials leave the
     grid entirely. Whichever is chosen, apply the **same** convention to every Advanced field so
     placeholder never sometimes-means-value and sometimes-means-mode.

### 4.5 Error/status messages must leave the hero — show a content-area card; run a small UX experiment ⚠️💡

**Observation:** We have error/status states (e.g. Docker missing). The core requirement: these
messages **must not live in the hero section** — the hero stays constant and the message becomes a
**card in the content area** with the actions the user can perform. Query Insights already has good
building blocks for this — not just the `MessageBar`, but the **richer composed card** shown when an
RU user opens the Query Insights tab; the two **could be combined**. Because it isn't obvious which
shape reads best, whoever implements this should **render a few options to compare** (a UX
experiment), and we also need to decide **where the Retry action lives** — there's no good home for it
in today's model.

**Finding:**

- ⚠️ Today an error is handled by switching to a **dedicated phase that replaces the hero**:
  `dockerNotReady` swaps the hero to _"Docker is required"_ and renders a bespoke full-screen layout
  (three readiness cards + a "How to fix" card + a bottom `Retry` that calls `loadDockerStatus`); the
  `failed` phase similarly shows an error box with the hero **stuck** on _"Setting up…"_ (§4.2). So the
  message is **coupled to the hero** — exactly what the observation wants to stop. (A `Retry` _does_
  exist on the docker-not-ready screen, but only as part of that full-screen error phase, not as an
  inline card action.)
- 🔍 **Query Insights already ships two reusable shapes** — both leave the surrounding header/title
  untouched and put the message in the content area:
  - **Concise inline `MessageBar`.**
    [`GetPerformanceInsightsCard.tsx`](../../../../src/webviews/documentdb/collectionView/components/queryInsightsTab/components/optimizationCards/custom/GetPerformanceInsightsCard.tsx)
    renders a Fluent **`MessageBar`** (`MessageBarBody` + `MessageBarTitle`) when `errorMessage` is set
    and **relabels its primary button to "Retry"** — the same handler doubles as retry:
    `{errorMessage ? l10n.t('Retry') : l10n.t('Get AI Performance Insights')}`. The card title never
    changes.
    [`ImprovementCard.tsx`](../../../../src/webviews/documentdb/collectionView/components/queryInsightsTab/components/optimizationCards/ImprovementCard.tsx)
    uses the same `MessageBar intent="warning"` / `intent="success"` blocks for per-action state.
  - **Richer composed card (the RU-tab card the observation refers to).** When an RU user opens Query
    Insights, [`QueryInsightsTab.tsx`](../../../../src/webviews/documentdb/collectionView/components/queryInsightsTab/QueryInsightsTab.tsx)
    (the `QUERY_INSIGHTS_PLATFORM_NOT_SUPPORTED_RU` branch) renders a **`MarkdownCardEx`** — an
    icon + title (_"Query Insights Not Available"_) + a markdown body explaining _why_ and a
    call-to-action (links to start a GitHub discussion) — and **nests a `MessageBar` inside it** for
    the concise one-line status. So the "card" and the "message bar" are **already combined** there:
    the composed card is the container, the `MessageBar` is the crisp summary line within it.

💡 **Suggestion:**

1. **Get the message out of the hero.** Keep the hero **static** (per §4.2) and render error/status as
   a **content-area card**, never as a hero-text swap or a `dockerNotReady`/`failed` full-screen phase
   that hijacks the title. Applies to docker-not-ready and provisioning `failed`.
2. **Combine the two shapes, and experiment.** The RU card shows the pattern to reuse: a composed
   titled card (icon + title + short explanation + actions) that **contains** a `MessageBar` for the
   crisp status line. Because the right density isn't obvious, whoever implements this should **render
   a few candidate variants to compare** rather than pick one blindly, e.g.:
   - **Option A — plain `MessageBar`** with an inline `Retry` (lightest; good for transient errors).
   - **Option B — composed card** (`MarkdownCardEx`-style: icon + title + body + action buttons), no
     separate bar (richest; good for "Docker is required" with fix steps + links).
   - **Option C — combined** (composed card **containing** a `MessageBar`), matching the RU tab.
     Render A/B/C against the real states (Docker missing, provisioning failed, readiness timeout) and
     pick per-state — a lightweight bar may suit `failed`, while docker-not-ready likely wants the richer
     card with fix links.
3. **Retry placement:** put `Retry` **on the chosen card**, next to the other recovery actions (Install
   Docker / Troubleshooting; Edit settings / Wait longer / Start over), following the Query Insights
   convention of **relabeling the card's primary action to "Retry"** when an error is present — not a
   separate bottom-of-panel button. The retry logic already exists (`loadDockerStatus` / `handleStart`);
   only its _home_ changes.
4. This pairs with **§9.3** (tree side: errors are actions/dialogs, not passive nodes) — the same
   principle on the webview: **a message is an actionable content card, not a state that hijacks the
   hero.** A shared, reusable error/status card (composed card + optional `MessageBar` + primary/Retry
   - links) would serve docker-not-ready and `failed` and keep the hero constant.

### 4.6 What does "Cancel" do mid-provision? Consider the verb "Abort" (no full rollback promise) ⚠️💡

**Observation (work item):** Investigate what **Cancel** actually does when clicked while provisioning
is in progress. Do we **delete an image that has started downloading**, or just abort? A clean
rollback is hard to implement (and to promise), so **"Abort"** may be a cleaner verb — "Cancel" implies
cancel-and-roll-back, which we can't reliably guarantee.

**Finding** (traced in `provision()`,
[QuickStartService.ts](../../../../src/services/localQuickStart/QuickStartService.ts)): the answer is
**"abort, with partial cleanup—but the image is kept."** On cancel (the panel's `Cancel` button aborts
the provisioning subscription → `AbortSignal` → `onAbort` fires `cts.cancel()`):

- 🔍 The in-flight Docker command is **aborted** via the cancellation token — a `docker pull` in
  progress stops promptly.
- 🔍 In `finally`, cleanup is **container-scoped only** (decision D12): if a container was created it's
  stopped + removed; if a create was attempted but the id wasn't captured, an orphan is swept by
  label; the temp env-file is deleted; state resets `Provisioning → NotInstalled`.
- ⚠️ **The image is never deleted.** Nothing calls a `removeImage`; whatever layers `docker pull`
  already fetched **stay in Docker's local cache** (by design — a resumable/cached pull makes the next
  attempt fast). So Cancel is a **partial** rollback: the half-created _container_ is removed, but the
  partially-/fully-downloaded _image_ is retained.
- Net: "Cancel" today reads as "undo everything," but we only undo the container, not the download. The
  retained image cache is arguably the _right_ behavior (fast retry) — it just isn't what "Cancel"
  promises.

💡 **Suggestion:**

1. **Rename the verb to "Abort"** (or "Stop setup") to set honest expectations: we stop the in-progress
   operation and remove any half-created container, but we **don't** promise to erase everything — the
   cached image layers are kept intentionally. "Cancel" over-promises a rollback we don't perform.
2. **Say what's kept**, right by the button: a one-liner like _"Stops setup. The downloaded image is
   kept so a retry is faster."_ removes the ambiguity the observation raises.
3. **Confirm the behavior per phase** as part of the work item (pull / creating / starting / waiting):
   verify no orphaned resources survive _besides_ the intentional image cache, and that a mid-pull
   abort leaves nothing half-written except cached layers. Decide explicitly that keeping the image is
   desired (it is, for retry speed) and document it.
4. If a true "remove everything including the image" is ever wanted, make it a **separate, explicit**
   action (e.g. an "Abort and clean up" secondary), never the default — deleting cached layers on every
   cancel would make retries slow and is the "clean rollback is tough" case the observation flags.

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

## 8. Destructive actions & the data / volume model

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

### 8.2 Persistence is always on — there's no "ephemeral / no-persistence" option 💡

**Observation:** Our default is a persistent data volume. That should be a **toggle** — sometimes a
user wants a throwaway instance with no persistence.

**Finding:** 🔍 `AdvancedQuickStartOptions`
([quickStartTypes.ts](../../../../src/services/localQuickStart/quickStartTypes.ts)) exposes `port`,
`username`, `password`, `imageTag`, and `loadSampleData` — but **no persistence flag**.
`createAndRunContainer()` **always** mounts a named volume (`volumeName(alias)` at
`QUICK_START_DATA_PATH`). So every instance is persistent by construction; there is no way to opt out
of the on-disk volume.

💡 **Suggestion:** Add an Advanced toggle **"Persist data across restarts"** (default **on**, keeping
the current zero-decision behavior). When **off**, create the container **without** the named-volume
mount so data lives only in the container's writable layer and is gone on delete — useful for quick
throwaway trials and clean repros. Trade-offs in [§13.6](#136-persistence--the-volume-model).

### 8.3 A user-initiated delete must always delete the data volume ⚠️

**Observation:** When the user deletes a container, we should for sure delete the persisted volume as
well.

**Finding:** 🔍 The explicit **Delete Container** path already does this: `deleteContainer()`
([QuickStartService.ts](../../../../src/services/localQuickStart/QuickStartService.ts)) calls
`removeVolume(volumeName(alias))` alongside the secret / globalState / registry cleanup — an
intentional "full clean slate." Two caveats to stamp: (a) the credential-unavailable **reconcile**
path deliberately does **not** touch the volume (R2 data-safety — see §9.2), which is correct for an
_automatic_ path but means the _user-initiated_ delete must remain the thing that wipes it; (b) once
§9.2 makes the credential-unavailable state actionable, its Delete must route through this same
volume-removing path.

💡 **Suggestion:** Keep explicit Delete = remove container **+ volume** (already the case). Ensure
every **user-initiated** delete surface (including the future credential-unavailable / Missing Delete)
funnels through `deleteContainer()` so a volume is never orphaned. Automatic / reconcile paths keep
R2 (never auto-wipe without the user choosing it).

### 8.4 Data volumes should be linked to the image — no shared data volumes 💡

**Observation:** Our persisted volumes should be **linked to the image**. We won't share data volumes
across images; advanced users can do that themselves.

**Finding:** 🔍 Today the volume is keyed to the **alias** (`${alias}-data`), independent of the
image. To stay safe, the service **pins the image to the volume**: on a recreate it reuses the stored
`imageRef` (from in-memory metadata → `globalState` → default) rather than the user's requested tag,
and custom image/creds are ignored on a Missing-recreate — precisely so an existing volume isn't
opened by a different (possibly older) image version that could corrupt it. So the intent ("one image
↔ one volume") is enforced by _runtime pinning_, but the volume is not _named/keyed_ by image, and
there is no model for multiple images each owning their own volume.

💡 **Suggestion:** Make the linkage **structural**, not just runtime — key or label the volume by its
image (or record the image on the volume) so "one image ↔ one data volume" is guaranteed even if the
pinning logic changes. Do **not** implement cross-image volume sharing; leave that to advanced users
operating Docker directly. This also sets up a cleaner story if multi-instance / multi-image lands.

### 8.5 We should only ever delete containers we created (pre-release safety) ⚠️

**Observation:** Keep as a review note — not urgent now, but must be addressed **before final
release**: we should be allowed to delete **only** the containers we created.

**Finding:** 🔍 Removal is already label-guarded in the normal path — `deleteContainer()` only removes
when `entry.missing || isManaged(id)`, and `isManaged()` verifies the `vscode.documentdb.quickstart`
label. But there are softer spots: on `entry.missing` the label re-check is **skipped** (the id comes
from metadata / `findManagedContainer`, which filters by label, so it is _currently_ safe but relies
on that invariant), and `ContainerRuntime.removeContainer()` itself does **no** label check. As the
feature grows (multi-instance, user-named containers, more recovery flows), an id-based delete without
a label re-verify is a latent risk of removing something we didn't create.

💡 **Suggestion:** Before final release, make "ours" a **hard precondition on every removal** —
re-verify the `vscode.documentdb.quickstart` label immediately before `removeContainer` /
`removeVolume`, regardless of the `missing` shortcut, so no code path can ever remove a container or
volume the extension didn't create.

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

### 9.2 Credential-unavailable state after a restart is a UI dead end (the demo incident) ⚠️

**Observation (real incident, mid-review):** An instance was created via Quick Start, then stopped,
then its container/image were removed outside VS Code. After a **VS Code restart** the Quick Start
node showed the rocket _"Click here to start DocumentDB locally"_ row **plus** a warning row
_"DocumentDB Local has data on disk but its saved credentials are missing…"_ (truncated in the tree).
There was **no way from the UI** to delete the leftover container/volume or to start cleanly — no
Delete node, no recreate action. Recovery required manually removing the container and its volume with
Docker, then refreshing.

**Finding:**

- On activation, `reconcile()` → `reconcileAlias()` hits **"Case 4"**: a labelled container (or a
  `ready` record) exists but the stored secret is unrecoverable, so it calls
  `setStatus(alias, InstanceState.Error, undefined, CREDENTIAL_UNAVAILABLE_MESSAGE)` with
  **`metadata: undefined`**. By design it **never** removes the container or volume (R2 data-safety: a
  lost secret doesn't prove the volume is disposable — the user must choose the wipe).
- Because `metadata` is `undefined`, `LocalQuickStartItem.getChildren()` skips every `metadata && …`
  branch and falls through to the **NotInstalled** branch, which renders the rocket action row **plus**
  a passive `treeItem_quickStartError` warning row carrying the message.
- ⚠️ That warning row has **no command and no context menu**, and the Delete command's `when` requires
  `treeItem_quickStartInstance` + a `state_*` token — which this surfaced state never carries. So
  **Delete is unreachable**, and unlike the true `Missing` row (which at least says "click to
  recreate") no recovery action is offered. The user is genuinely stuck in the UI.
- ⚠️ **Restart behavior specifically:** in-memory state is rebuilt from durable state on every reload,
  so this dead end **reproduces on every restart** — it is not a transient glitch. The
  volume-plus-missing-secret combination persists, so each launch re-surfaces the same non-actionable
  warning. (Clicking the rocket to "start fresh" doesn't help either: the on-disk volume + missing
  credentials block a clean provision, and §9.1's silent-return path compounds it.)
- **How we recovered (for the runbook):** removed the labelled container and its data volume directly
  with Docker (`docker rm -f vscode-documentdb-local` + `docker volume rm vscode-documentdb-local-data`),
  then refreshed the view; reconcile found nothing and returned to the clean NotInstalled empty state.

💡 **Suggestion:** The credential-unavailable state must be **actionable**, not a passive warning. Render
it like the `Missing` row — a real instance row (`treeItem_quickStartInstance` + a dedicated
`state_credentialsMissing` token) that exposes **Delete Container** (clean slate: container + volume +
stale records, via `deleteContainer()` per §8.3) and, where safe, **Recreate**. Keep R2 (never
_auto_-wipe) — but give the user a one-click way to _choose_ the wipe. This should share the recovery
UX in [§13.4](#134-external-deletemissing-recovery-affordance), and is a direct instance of the §9.3
principle below.

### 9.3 Tree nodes are misused to display errors (they should be actions, not dialogs) ⚠️💡

**Observation:** This incident exposed a broader pattern problem — we render an **error message as a
tree node**. Leaf/error nodes in a tree should be **actions the user can take**, not a substitute for
a dialog or a status surface.

**Finding:**

- Several Quick Start states render a passive, non-actionable row purely to display text:
  `treeItem_quickStartError` (the credential-unavailable / error message, §9.2), and the empty state
  also **appends** an error row when `status.state === Error && errorMessage`. These rows have no
  command and no menu — they exist only to show a string, which then **truncates** in the tree (the
  incident's "…saved credentials are miss…"), can't be copied, and competes visually with the real
  action row.
- This contradicts where the rest of the extension landed. The **Kubernetes discovery** review
  reached exactly this conclusion and reversed it: classified in-tree error-summary nodes were
  **removed** in favor of a **modal** (`showErrorMessage(…, { modal: true })`) plus a single
  actionable retry node — see that review's §F/#19 iteration 2 and its post-merge reconciliation note.
  Quick Start currently repeats the anti-pattern the K8s feature already retired.

💡 **Suggestion:** Adopt the same rule feature-wide: **tree rows are actions; errors are dialogs /
status.** Concretely: (a) surface an error/credential-unavailable condition as a **modal** (with detail
in the output channel), and (b) keep **only actionable rows** in the tree (Delete / Recreate / Retry /
"Click here to…"). This removes the passive `treeItem_quickStartError` and the error-append row, and it
directly fixes §9.2's dead end. It also rhymes with §4.2 (the webview header carrying status it
shouldn't) — the same "don't overload one surface with state it isn't meant to hold" theme.

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

| §    | Item                                                 | Verdict                  | Suggested next step                                                                                                                 |
| ---- | ---------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 2.1  | Legacy migration folder discoverability              | ⚠️ Flag                  | One-time toast + "Reveal"; optional distinct badge/pin ([§13.1](#131-surfacing-the-legacy-migration-folder))                        |
| 3.1  | Empty-state wording / drop "Learn more"              | ✅ Fix applied           | Decide if "Learn more" returns as a context-menu entry                                                                              |
| 4.2  | Webview header changes / stuck on "Setting up"       | ⚠️ Flag (real bug)       | Make the header a single static string; body carries state                                                                          |
| 4.3  | "Checking Docker" loading is a bare spinner          | ⚠️ Flag / 💡 Suggestion  | Render header + skeleton cards; reuse & relocate the Query Insights `MetricBase`                                                    |
| 4.4  | Advanced: creds not behind a toggle; placeholders    | ⚠️ Flag / 💡 Suggestion  | Toggle to reveal user/pass; drop literal-value placeholders (keep in `hint`)                                                        |
| 4.5  | Errors swap the hero / full-screen phase             | ⚠️ Flag / 💡 Suggestion  | Move messages out of the hero to a content card; combine `MessageBar` + composed RU-style card; experiment A/B/C; Retry on the card |
| 4.6  | "Cancel" mid-provision: partial rollback, image kept | ⚠️ Flag / 💡 Suggestion  | Rename to "Abort"; state the image is kept; confirm per-phase cleanup                                                               |
| 5.1  | "Waiting for connections" static for minutes         | ⚠️ Flag                  | Add in-stage elapsed/sub-info; surface "View output" earlier                                                                        |
| 6.1  | No image-pull progress                               | ⚠️ Flag                  | Indeterminate `ProgressBar` + "N of M layers" ([§13.2](#132-image-pull-progress-indicator))                                         |
| 7.1  | Running row lacks regular cluster commands           | 🔍 Answered (deliberate) | Add back storage-independent commands explicitly ([§13.3](#133-cluster-commands-on-the-quick-start-row))                            |
| 7.2  | Copy Connection String silently adds password        | ⚠️ Flag                  | Reuse the regular QuickPick confirmation, or document the divergence                                                                |
| 7.3  | Generic `$(plug)` icon, no distinct identity         | 🔍 Answered              | Give the instance a distinct icon (reuse the rocket motif)                                                                          |
| 8.1  | Delete bypasses shared confirmation + em dashes      | ⚠️ Flag                  | Switch to `getConfirmationAsInSettings()`; sweep em dashes feature-wide                                                             |
| 8.2  | Persistence always on — no ephemeral option          | 💡 Suggestion            | Add an Advanced "Persist data" toggle (default on) ([§13.6](#136-persistence--the-volume-model))                                    |
| 8.3  | User delete must always drop the volume              | ⚠️ Flag                  | Route every user-initiated delete through `deleteContainer()` (volume incl.)                                                        |
| 8.4  | Volumes not structurally linked to the image         | 💡 Suggestion            | Key/label the volume by image; no cross-image sharing                                                                               |
| 8.5  | Delete only containers we created                    | ⚠️ Flag (pre-release)    | Re-verify the Quick Start label immediately before every remove                                                                     |
| 9.1  | External container delete not handled on Start       | ⚠️ Flag (real bug)       | Distinguish missing vs not-ours; route to Missing + recovery ([§13.4](#134-external-deletemissing-recovery-affordance))             |
| 9.2  | Credential-unavailable state is a restart dead end   | ⚠️ Flag (real bug)       | Make it an actionable instance row (Delete / Recreate); shares [§13.4](#134-external-deletemissing-recovery-affordance)             |
| 9.3  | Tree nodes misused as error dialogs                  | ⚠️ Flag (pattern)        | Errors → modal + output channel; tree rows are actions only                                                                         |
| 10.1 | "Open terminal in container"                         | 🔍 Feasible              | Add `state_running` "Open in Terminal" command ([§13.5](#135-open-terminal-in-container))                                           |

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

| Option                                        | Pros                                                                                                                                                   | Cons                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| **A. One-time toast + "Reveal" action**       | Loud exactly once, at the moment it matters; non-blocking                                                                                              | Transient; a user who dismisses it still has to find the folder                     |
| **B. Distinct folder icon/description badge** | Persistent visual marker; no extra flow                                                                                                                | Adds a special-case to folder rendering; mild clutter                               |
| **C. Pin to a fixed position (first/last)**   | Predictable location regardless of name                                                                                                                | Breaks the pure-alphabetical model; users may still not notice it                   |
| **D. Do nothing (current)**                   | Zero code                                                                                                                                              | Folder hides in the alphabetical sort; confusing post-upgrade                       |
| **E. Prefix the folder name with `_`**        | Dead-cheap: `_` sorts before letters, so `_Local Connections (Legacy)` floats to the top of the alphabetical list with **zero** rendering/sort changes | Cosmetic leading `_` in the name; a user can rename it away; not as loud as a toast |

> 💡 **Suggested:** **A**, optionally with **B**. The toast solves the "I didn't know my connections
> moved" moment directly; a subtle badge helps the user re-find it later without breaking the sort.
> If a code-free quick win is preferred first, **E** (prefix the name with `_`) reliably pins it to the
> top of the existing `localeCompare(..., { numeric: true })` order with no sort/render changes, and
> composes fine with A/B.

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

### 13.6 Persistence & the volume model (§8.2 / §8.3 / §8.4)

Three related choices about how the on-disk data volume behaves. They interact: an "ephemeral" option
only makes sense once delete reliably wipes the volume, and both are cleaner if the volume is tied to
its image.

| Question                   | Options                                                                                               | Suggested                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Persist vs ephemeral**   | (A) Always persist (current). (B) Advanced toggle, default persist. (C) Prompt each run.              | **B** — a default-on "Persist data across restarts" toggle; no mount when off.                  |
| **Delete → volume**        | (A) Delete container only. (B) Delete container **+ volume** on user delete (current explicit path).  | **B**, applied to _every_ user-initiated delete (incl. the future credential-missing Delete).   |
| **Volume ↔ image linkage** | (A) Alias-keyed volume + runtime image pinning (current). (B) Structurally key/label volume by image. | **B** — make "one image ↔ one volume" structural; no cross-image sharing (advanced users only). |

> 💡 **Suggested overall:** default stays "persistent, clean-delete, image-pinned" so the zero-decision
> path is unchanged; add the **ephemeral toggle** for throwaway trials, make the **volume↔image link
> structural**, and never share data volumes across images (advanced users can wire that up in Docker
> themselves). Pre-release, pair this with §8.5 (only ever remove containers/volumes we created).
