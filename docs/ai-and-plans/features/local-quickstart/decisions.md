---
feature: local-quickstart
kind: decisions
status: active
verified: 2026-08-14
---

# Local Quick Start — Decisions

> The decisions that shaped Local Quick Start, and what was rejected on the way.

| #    | Decision                                               | Status              | Changed from the proposal?                       | Date       | PR    |
| ---- | ------------------------------------------------------ | ------------------- | ------------------------------------------------ | ---------- | ----- |
| 0001 | Single managed instance, ownership-bounded             | Superseded by 0002  | Accepted as proposed                             | 2026-06-25 | —     |
| 0002 | Multiple managed instances in v1                       | Accepted            | Reverses 0001 after owner review                 | 2026-07-06 | —     |
| 0003 | Concept F — Docker verified as the first setup stage   | Accepted (modified) | Dedicated readiness page dropped entirely        | 2026-08-03 | #798  |
| 0004 | Explicit cluster-command opt-ins for managed nodes     | Accepted            | Capability split deferred                        | 2026-08-09 | #876  |
| 0005 | Restore missing credentials from the managed container | Accepted            | Error-node tree flow deferred                    | 2026-09-29 | #979  |
| 0006 | Wizard journey telemetry and correlation ids           | Accepted            | Quick Start lineage id not added                 | 2026-09-29 | #979  |
| 0007 | Image usage telemetry follows VS Code's setting        | Accepted            | Accepted as proposed                             | 2026-10-15 | #1018 |
| 0008 | Set up stages expand to show what each stage did       | Accepted            | Amends 0003's single failure surface             | 2026-11-10 | —     |
| 0009 | Preferred engine and instance ownership                | Accepted            | Configure is check-free; Docker is fresh default | 2026-11-10 | —     |
| 0010 | Platform-gated Podman machine startup                  | Accepted            | Button only for eligible macOS/Windows machines  | 2026-11-10 | —     |

> Entries below are **semantically** immutable: append new entries rather than
> rewriting old ones, and record reversals as a new entry plus a status change
> above. Editing for typos, broken links, or added verification metadata is fine.
> Heading text is frozen once written — a retitle means a new decision.
>
> Entries marked **(reconstructed)** were written during the 2026-08 migration
> from earlier plan and design documents. They record what was decided at the
> time, not the original wording; each links to its source evidence.

**Status vocabulary** (closed set of seven):

`Proposed` · `Open` · `Accepted` · `Accepted (modified)` · `Deferred` ·
`Superseded by D#` · `Rejected`

---

## 0001 — Single managed instance, ownership-bounded

**Status:** Superseded by 0002 · **Date:** 2026-06-25 · **Raised by:** German Eichberger (xgerman) in design review
**Evidence:** [design.md](./design.md) §10.1 labels, §10.2 existing-container conflict, §13.10 attach, §15 roadmap

### Question

1. Should Quick Start manage **multiple** local DocumentDB containers (several instances, or
   several image versions side by side)?
2. If the user already created DocumentDB containers **another way** (CLI, `docker run`, a test
   harness), should Quick Start list, adopt, or manage them?

### Options considered

| Topic                                                 | v1 decision                                                                                                                             | Deferred to |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Multiple **managed** instances                        | **No.** One managed instance; the rocket entry hides after setup.                                                                       | v1.2        |
| Multiple **image versions** side by side              | **No.**                                                                                                                                 | v1.2        |
| Listing the user's own (unlabelled) containers        | **No.** They connect via the regular new-connection wizard at `localhost:<port>`. Quick Start does not own them.                        | —           |
| **Adopt-existing-container** flow                     | **No** as a general feature. The only adoption v1 performs is re-recognizing **its own labelled** container after a reload (reconcile). | v1.2        |
| **Auto-discovery** of unmanaged DocumentDB containers | **No** — and when built, it belongs to the **generic connections** experience, not Quick Start.                                         | v1.2        |
| **Name / port collision safety**                      | **Yes — required in v1.**                                                                                                               | —           |

### Decision

For **v1**, Quick Start manages **exactly one** instance and only ever touches containers **it
created**, recognized by the Docker label `vscode.documentdb.quickstart=1`.

Re-affirmed on 2026-06-30 during hands-on manual testing, framed by user personas, and **held**: the
advanced "validate before deploying" persona is the strongest case for multi-version, but their need
is met more cheaply by image-tag selection on the single managed instance plus attaching their own
side-by-side `docker run` containers through the regular wizard.

### Why

1. **The value proposition is "zero decisions."** Supporting N instances re-introduces exactly the
   decisions Quick Start removes (which one? alias? port?) and multiplies port allocation,
   credential storage, tree shape, reconciliation, and multi-window coordination by N.
2. **Ownership boundary = trust and safety.** The moment Quick Start acts on containers it did not
   create, a stray Stop or Delete can destroy something the user cares about. Recognition is
   therefore **label-based, never** name/image/port-based.
3. **Credentials make adoption hollow anyway.** For a hand-run container Quick Start cannot know the
   `--username` / `--password` the user chose, so "listing" it degrades to "here's a thing, go type
   your own credentials" — which **is** the regular new-connection wizard.
4. **Deferring is cheap because the model is already forward-compatible.** Because recognition is by
   label, adding multi-instance or adopt-existing later needs **no data migration**.

### Consequences

- **Users:** the one-click path stays decision-free; power users attach their own containers via the
  regular wizard; nobody's hand-run container is ever modified by Quick Start.
- **Engineering:** the v1 surface stays small. The one concrete work item this decision identifies
  is collision safety. A pre-existing container holding the planned **name** or **port** must never
  be clobbered: labelled as ours, re-adopt it; unlabelled, reject with a clear inline error and
  point at the regular wizard or a port change.

---

## 0002 — Multiple managed instances in v1 _(reconstructed)_

**Status:** Accepted · **Date:** 2026-07-06 · **Raised by:** repo owner
**Evidence:** [iterations/03-multi-instance/implementation-plan.md](./iterations/03-multi-instance/implementation-plan.md) §2 "Decision reversal"

### Question

Should the single-instance limit locked by 0001 ship in v1, given the concrete use cases raised in
design review (compare image vX against vY; isolate project A from project B)?

### Options considered

- **Hold 0001** — ship a single-instance v1 and add multi-instance in v1.2 as an additive change.
- **Reverse 0001** — build full multi-instance in v1, before shipping.

### Decision

Build **full multi-instance in v1**. A user can create, browse, and manage **N** independent local
DocumentDB instances side by side, each with its own container, volume, port, and credentials.

The first instance stays one click: the provisioning panel pre-fills a default name and no naming
step is required. A persistent "＋ New instance" row adds further instances.

### Why

The label model that 0001 preserved is exactly what makes the reversal cheap. `containerName(DEFAULT_ALIAS)`
and `volumeName(DEFAULT_ALIAS)` equal the previous constants, so an existing container and volume
are adopted with **no rename**, and only two persisted keys exist, so migration is complete after
re-keying them. Five independent plan reviewers verified the identity/keying model, backward
compatibility, and migration completeness before implementation started.

### Consequences

- The non-goals of 0001 **survive the reversal**: adopting unlabelled or hand-run containers is
  still out, recognition stays label-only, and auto-discovery still belongs to the generic
  connections experience.
- Each instance carries an immutable **alias** (a slug, which is also the Docker container name and
  the `vscode.documentdb.alias` label) plus an editable **display name**. The alias is the stable
  key for names, credentials, and cache lookups.

---

## 0003 — Concept F: Docker verified as the first setup stage

**Status:** Accepted (modified) · **Date:** 2026-08-03 · **PR:** #798
**Evidence:** [iterations/04-ui-redesign/ui-redesign-decisions.md](./iterations/04-ui-redesign/ui-redesign-decisions.md) — "Fresh alternatives" and "Finalization"

### Question

Where should Docker readiness live in the setup wizard? Every earlier concept assumed readiness was
a _topic_ that needed somewhere to live: a page of its own, or a persistent band.

### Options considered

| Concept | Where readiness lives            | Steps | Chrome added | Outcome         |
| ------- | -------------------------------- | ----- | ------------ | --------------- |
| A       | Its own page                     | 5     | none         | Rejected        |
| B       | Status block above the settings  | 4     | none         | Superseded by G |
| C       | Wizard band above the page       | 4     | persistent   | Rejected        |
| D       | —                                | —     | —            | Dropped with B  |
| E       | Bottom of the Introduction page  | 4     | none         | Runner-up       |
| F       | First stage of the Set up list   | 4     | none         | **Selected**    |
| G       | First row of the Configure table | 4     | none         | Rejected        |

### Decision

**Concept F.** The readiness concept is deleted entirely and the existing five-stage setup list owns
it, with `Checking Docker` as stage 1. There is exactly **one** failure surface, one vocabulary for
"something went wrong", and no readiness UI to place, size, or keep in sync.

Modified during implementation: the dedicated readiness page was not merely deprioritized, it was
removed as a concept, and `getDockerLastCheckedAtMs` was deleted with it because a remembered
timestamp could report evidence that was days old.

**Amendment, 2026-11-09:** The operator requested a neutral stage heading. Stage 1 now reads
`Checking container engine`.

### Why

F is the strongest simplification available. Both A and C must design a healthy-state readiness
display that the great majority of users glance at once and never act on. The accepted cost is that
the user configures before learning Docker is unusable, so a failure wastes the configuration step:
F optimizes the common case and accepts a longer path in the uncommon one.

### Consequences

- **Docker recovery has three explicit scopes,** because one control was previously doing three
  jobs: `Check Docker again` re-runs only the check, `Continue setup` runs setup once the check
  stage is no longer failing, and `Retry setup` runs everything again. Nothing auto-starts a run the
  user did not ask for.
- **The expectation note lives in the footer,** directly above the primary button, so it cannot
  scroll away from the control it describes.
- **Names come from constants, not prose.** The plan text is formatted from `QUICK_START_CONTAINER_NAME`,
  so what the wizard promises and what `docker ps` shows cannot drift apart.
- **Chrome is Atlas's, not a variant of it.** `AtlasCredentialsView.tsx` is the reference
  implementation, and the breadcrumb was extracted to `WizardBreadcrumb.tsx` so there is one
  implementation instead of three copies.
- The design lab (`QuickStartDesignLab.tsx`, its controller, command, and `package.json`
  contribution) was removed once the design was implemented. The iteration document is the surviving
  record.
- A and C remain the reference points for anyone who later argues that readiness needs a stable,
  addressable location or must stay visible across pages.

---

## 0004 — Explicit cluster-command opt-ins for managed nodes _(reconstructed)_

**Status:** Accepted · **Date:** 2026-08-09 · **PR:** #876
**Evidence:** commit `d971af0e` and
[iterations/04-ui-redesign/code-review-2026-08-04.md](./iterations/04-ui-redesign/code-review-2026-08-04.md)
§9.1 and §8

### Question

Should the running Local Quick Start instance inherit the standard
`treeItem_documentdbcluster` context value and therefore receive every cluster command, or should
compatible commands be contributed explicitly?

### Options considered

1. **Inherit `treeItem_documentdbcluster`.** This removes duplicate menu contributions, but the
   context currently also enables commands that resolve their target through
   `ConnectionStorageService`.
2. **Opt in compatible commands individually.** This duplicates contribution entries, but a new
   generic cluster command cannot reach the managed node without an explicit compatibility
   decision.
3. **Separate cluster capability from storage ownership.** Keep `treeItem_documentdbcluster` for
   browsable cluster behavior and introduce a distinct context value for commands that require a
   persisted connection record.

### Decision

Use **explicit command opt-ins** until the menu contexts distinguish cluster capability from
connection-storage ownership.

The running row is a real `ClusterItemBase` implementation and may opt into commands that consume
that contract, including Create Database, Cluster Dashboard, Open Interactive Shell, and Refresh.
Every opt-in must also require `state_running`; stopped and transitional rows are lifecycle rows
without a cluster model to dereference.

Do not give the managed node `treeItem_documentdbcluster` under the current menu taxonomy. Local
Quick Start owns its credentials and lifecycle state through `QuickStartService`; it has no record
in `ConnectionStorageService`. The broad context value would also expose rename, move, remove,
credential editing, connection-string editing, and Data Migration paths whose storage assumptions
do not hold for this node.

### Why

The implementation difference is **ownership**, not database behavior. Once running, the node can
connect and browse through the shared cluster abstraction. What differs is where its durable state
and credentials live, and the fact that non-running states are not cluster nodes at all.

The standard context value currently combines two capabilities that are not equivalent:

- "this is a browsable cluster"; and
- "this is a persisted Connections-view record."

Failing closed is safer while those meanings remain combined. It prevents future storage-backed
commands from silently appearing on a service-owned node, at the accepted cost of duplicate menu
entries for compatible cluster commands.

### Consequences and deferred replacement

- `package.json` is the explicit compatibility list. Its Local Quick Start contribution tests must
  pin both commands that are enabled and storage-backed commands that remain excluded.
- Lifecycle commands, including copying credentials while stopped, remain Quick Start-specific.
- **Deferred future work:** split the overloaded context contract. Add a positive context value for
  persisted connection records and require it for storage-backed commands. Then preserve
  `treeItem_documentdbcluster` on the running managed node, remove the duplicated compatible-command
  contributions, and retain explicit state gating only where non-running lifecycle rows require it.
- That replacement must audit Copy Connection String separately: the generic cluster command can
  serve the running node, while the Quick Start command must remain available on a stopped row.

---

## 0005 - Restore missing credentials from the managed container

**Status:** Accepted · **Date:** 2026-09-29 · **PR:** #979 · **Raised by:** the operator while
testing #979
**Evidence:** `QuickStartService.reconcileAlias` and `recoverCredentialsFromContainer`;
`openLocalQuickStart` and the initial phase in `LocalQuickStart.tsx`

### Question

A managed container can exist while this VS Code has no saved credentials for it. The tree then
shows "Review setup", the wizard opened on Introduction without saying why, and the only way forward
was Start fresh, which erases the data. How should this state be handled?

### How it happens

Docker is shared by everything on the machine. The Quick Start record and its secret live in VS Code
extension storage, which is separate for each profile and each installation. Any second VS Code that
talks to the same Docker daemon finds a labelled container it has no password for:

- The F5 development host runs with `--profile=noExtensionsProfile`, while the installed extension
  runs in the default profile. This is the most common case for contributors.
- Stable and Insiders, other VS Code based editors, portable mode, `--user-data-dir`, or a reinstall
  that wiped user data.
- An OS keyring change on Linux or WSL. The secret can no longer be decrypted, but the
  `globalState` record survives.

An interrupted setup is not a cause: the secret is written before `docker run`.

### Options considered

| Option                                                                                                                                  | Effort          | For the user                                                                        | Outcome               |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------- | --------------------- |
| **A.** Open the wizard on Configure, where the warning and Start fresh are                                                              | Small           | No longer lands on an unrelated page                                                | **Accepted**          |
| **B.** Repeat the warning on Introduction                                                                                               | Small           | Duplicated text                                                                     | Rejected, A covers it |
| **C.** Explain the state in the tree row (description, tooltip)                                                                         | Small           | Clearer row, same dead end                                                          | Not done              |
| **D.** Read the credentials back from the container's environment (`docker inspect`) and adopt it                                       | Small           | Zero clicks, data kept                                                              | **Accepted**          |
| **E.** Let the user type the username and password on Configure                                                                         | Medium          | Rarely usable, see below                                                            | Rejected              |
| **F.** Show the cluster node with error nodes "Update credentials" (reusing the update-credentials wizard, starting empty) and "Delete" | Small to medium | Consistent with saved connections, but Update credentials has the same problem as E | Deferred              |

### Decision

1. **D.** When reconcile finds a labelled container with no stored secret and no fresh provisioning
   lease, it reads `USERNAME` and `PASSWORD` from the container's environment, builds the connection
   string, stores it, and adopts the container through the normal path. Only when that fails does the
   instance become `CredentialsMissing`.
2. **A.** For whatever is still `CredentialsMissing`, the wizard opens on Configure. The host passes
   the hydrated instance status at open time, so the warning is visible on first paint. This changes
   the premise of I2-3 in iteration 04, which placed the warning on Configure because the tree did not
   link to the wizard in this state. The "Review setup" row now does.

### Why

- **The credentials are generated.** Most users never saw them, so any option that asks for them
  (E, and Update credentials in F) mostly ends in Delete, which erases the data.
- **Reading them back grants no new access.** Setup passes them with `--env-file`, which keeps them
  off the command line but not out of `docker inspect` (design review R35). Anyone who can reach the
  daemon can already read them. `inspectContainer` does not echo its output, and the recovered values
  are never logged.
- **It fixes the cause, not the symptom,** with no new UI, commands, or menus.

### Consequences

- Recovery runs only during reconcile (lazy hydration and an explicit refresh), never in the
  per-render live refresh, and never while a provisioning lease is fresh.
- The port comes from the bound port of a running container, then the published port in
  `HostConfig.PortBindings` for a stopped one, then the stored record, then the default.
- The credentials are not verified before adoption. If someone changed the password inside the
  database, connecting fails and the normal connection error handling applies.
- If storing the secret fails (a broken keyring), the instance stays `CredentialsMissing`.
- Two profiles can now share one instance. A Delete in one leaves the other with a record whose
  container is gone, which the existing Missing and data-removed states already cover.
- Still `CredentialsMissing` after this: the container was removed but the data volume or record is
  left, so there is nothing to inspect. A covers that case.
- Revisit F if telemetry shows users still reach `CredentialsMissing` regularly.
- Telemetry for these paths:
  - `documentDB.quickstart.reconcile`, one event per deep reconcile (`trigger` is `hydration` or
    `refresh`), counts each outcome as `outcome_<name>`: `adopted`, `restored`, `credentialsMissing`,
    `credentialsMissingNoContainer`, `missing`, `dataRemoved`, `scavenged`, `provisioning`,
    `notInstalled`. A failed restore adds `restoreFailed_noCredentials` or
    `restoreFailed_storeFailed`.
  - `connect` for the managed instance carries `credentialsRestored`, so the result shows whether
    restored credentials actually work.
  - The wizard open command carries `instanceState`. `documentDB.quickstart.provision` carries
    `priorState`, `startFresh` and `refusedCredentialsUnavailable`. The Delete command carries
    `priorState`. Together they show what users choose once an instance is `CredentialsMissing`.

---

## 0006 - Wizard journey telemetry and correlation ids

**Status:** Accepted · **Date:** 2026-09-29 · **PR:** #979 · **Raised by:** the operator while
reviewing the recovery telemetry in #979
**Evidence:** `wizardTelemetry.ts`, `localQuickStartRouter.ts`, `openLocalQuickStart.ts`;
[design.md](./design.md) §14; [telemetry-correlation-ids.md](../../telemetry-correlation-ids.md)

### Question

Telemetry showed how often the wizard was opened and how each setup run ended, but not how people
move through the wizard, where they leave it, or where they opened it from. Which events and which
ids should record that?

### Decision

1. **One `quickStartSessionId` per wizard panel.** The open command creates it, the controller keeps
   a session for the panel on the extension host, and every event the panel produces carries it:
   the open command, the tRPC procedure events, `documentDB.quickstart.wizard.step` for each phase
   change (with its `trigger`), and `documentDB.quickstart.wizard.close` when the panel is disposed.
   This follows the Cluster Dashboard's `dashboardSessionId`.
2. **The per-run id is `provisionCorrelationId`.** It was named `journeyCorrelationId` but identified
   one setup run. Renamed outright, with no transition period sending both names, because no
   telemetry analysis relies on it yet.
3. **`activationSource` on the open command** names the tree row, notification, deep link, or
   `commandPalette` that opened the wizard. The name is the one most commands already use.
4. **Outcomes never depend on `wizard.close`.** Setup results come from
   `documentDB.quickstart.provision`, sent when a run ends. The close event is a summary
   (`lastStep`, `closeReason`, totals) and may be missing when VS Code is closed or killed with the
   panel open; the last `wizard.step` of the session still says where the user stopped.
5. **No Quick Start `journeyCorrelationId`.** The repo uses that name for lineage created at a tree
   root, and Quick Start does not create one.

### Alternatives considered

- **Call the wizard session `journeyCorrelationId`.** Rejected: elsewhere that name means tree
  lineage that spans commands, and the copy-paste feature already rejected reusing it for a single
  operation. One journey can also open the wizard more than once.
- **Use the session id as the journey id only when no lineage exists.** Rejected: the same property
  would mean lineage in some events and one panel in others.
- **Send both the old and new name for the per-run id.** Rejected: nothing queries it yet.
- **Have the Quick Start tree node create a lineage id.** Not done: the questions it would answer
  (did setup lead to use, where was the wizard opened from) are answered by the `provision` and
  `connect` events in the same VS Code session and by `activationSource`. The tree rebuilds that
  node on refresh, so the id would change often, and the action rows would need extra arguments.
- **Let the webview send the close event.** Rejected: a webview that is being closed cannot
  reliably send anything, so the extension host keeps the session and reports the close.

### Consequences

- A session with an open event but no close event means the window went away with the panel open.
- A phase change made just before the tab closes can be lost in transit, so `lastStep` may show the
  step before it.
- The ids used across the extension, and a draft rule for choosing one, are collected in
  [telemetry-correlation-ids.md](../../telemetry-correlation-ids.md) for a later pass.

## 0007 - Image usage telemetry follows VS Code's setting

**Status:** Accepted · **Date:** 2026-10-15 · **PR:** #1018 · **Raised by:** the operator after
testing Quick Start with `documentdb-local:pg17-1.0-rc2`
**Evidence:** `QuickStartService.ts` (`writeEnvFile`); the image's `usage_telemetry.sh` and
`/home/documentdb/PRIVACY.md`

### Question

From 1.0-rc2 the documentdb-local image reports its version, platform and CPU architecture to
`documentdb.gateway.scarf.sh` at startup and hourly, unless `DOCUMENTDB_USAGE_TELEMETRY=false`,
`NO_ANALYTICS` or `DO_NOT_TRACK` is set. Quick Start set none of them, so a user with VS Code
telemetry off still got a container that reports. Should Quick Start opt out?

### Decision

Opt out exactly when VS Code telemetry is off: setup writes `DOCUMENTDB_USAGE_TELEMETRY=false` into
the container's env-file when `vscode.env.isTelemetryEnabled` is false. The user already chose a
telemetry level in VS Code, and a container the extension creates on their behalf should respect
that choice rather than ask again.

### Alternatives considered

- **Always opt out.** Not chosen: it ignores users who allow telemetry, and the project would never
  count Quick Start deployments.
- **Ask in the wizard.** Not chosen: a second consent prompt for a choice the user already made.

### Consequences

- The setting is read when the container is created. A container keeps it across Stop, Start and
  Restart, until it is recreated.
- Images before rc2 ignore the variable.
- The Configure step says so in its footer note, after what Start does, linking the image's
  [privacy statement](https://github.com/documentdb/documentdb/blob/main/documentdb-local/PRIVACY.md).

## 0008 - Set up stages expand to show what each stage did

**Status:** Accepted · **Date:** 2026-11-10 · **PR:** — · **Raised by:** the operator
**Evidence:** [iterations/11-setup-stage-details.md](./iterations/11-setup-stage-details.md) §§7–9

### Decision

The operator accepted Details on each settled stage with facts, on both Set up and Done. Details
start collapsed and contain evidence only. This amends 0003's single failure surface: the
`MessageBlock` remains the visible home for explanations and recovery actions, while the checking
row's Details replaces the old Docker-check accordion. The relative last-checked time stays on the
checking row.

If requested sample data was not loaded, success remains success; the success block says so and
the waiting row's Details contains an informational message pointing to the setup log.

The operator deliberately left out step durations, unlike Diagnose connection's
[0050](../connectivity-troubleshooter/decisions.md#0050--each-row-shows-its-duration-in-a-squared-badge-the-list-shades-the-row-under-the-pointer),
and accepted session aggregates on the existing
`wizard.close` event: the bounded, sorted stages opened and the number of openings. No new event
per opening is sent.

### Amendment, 2026-11-10

The operator explicitly requested the eight changes in the
[setup-stage follow-up](./iterations/11-setup-stage-details-followup.md). Checking Details no
longer includes explanatory notes; it reports both CLI executables' PATH presence without
claiming the unselected engine was probed. Settled rows with Details have concise factual summaries.
Long image and container IDs retain full values in mouse and keyboard tooltips, and Updated includes
the previous image ID when already available. Active pulling shows the known image and origin and
the latest bounded engine-output line when available, without an invented completion estimate.
The decision to omit durations remains unchanged.

The operator later clarified that stacking engine output below the image caused the layout shift.
Active pulling therefore uses one non-wrapping line: image and origin before output arrives, then
engine output instead of the already-selected image. Long text is ellipsized visually, not removed
from the DOM; its full value remains in the title and setup log. This supersedes the earlier
two-line active-pull presentation.

### Typography simplification, 2026-11-10

The operator approved uniform styling below the unchanged main stage labels: regular base200
proportional text for summaries, fact labels, values and links, without monospace. Ordinary text
shares the primary foreground; links keep their action colour and focus treatment. Supplementary
context stays muted at the same size, weight and font. Important qualifications, specifically an
unconfirmed port marked "As requested", remain in the primary foreground rather than being treated
as incidental context.

This is a deliberate Local Quick Start exception to the shared Details defaults for code-like
values and secondary-colour fact terms. It does not change Diagnose connection or package-wide
styling. Context notes use VS Code's description foreground with a Fluent secondary-colour fallback,
since the existing dark theme can give primary and secondary foregrounds the same colour. High
contrast follows its theme's description colour rather than forcing opacity or an arbitrary gray.
No evidence, disclosure controls, full-ID tooltips or severity semantics are removed.

---

## 0009 — Preferred engine and instance ownership

**Status:** Accepted · **Date:** 2026-11-10 · **PR:** —

**Evidence:** [iteration 12](./iterations/12-preferred-engine-and-podman-start.md) §§3.1–3.4, Q1–Q5 and Q7

### Question

How should a fresh setup choose between Docker and Podman without checking availability in
Configure, while keeping existing instance data attached to its engine?

### Decision

1. Configure always puts a **Container engine** row first, with Docker and Podman as static choices
   and no engine checks or availability hints. A fresh form defaults to Docker; the preference is
   not persisted.
2. During execution, check both CLIs and use the preferred one if its CLI is on `PATH`. Fall back
   only when that CLI is missing. An installed but stopped engine remains selected. If neither CLI
   is present, report the preferred engine as missing.
3. Store `engineCli` on the instance and provisioning lease. Lifecycle, reconciliation, and
   recreation—including Start fresh—use that recorded owner; a different preference never moves the
   instance or its volume.
4. A legacy record without `engineCli` remains unrecorded in Configure and resolves using today's
   CLI order only during execution. It is not inferred or written during Configure.
5. A start action is offered only for the engine selected for that run. Podman runs neither read
   nor write provider memory and ignore Docker provider memory, Docker Desktop evidence, and Docker
   start actions. Docker's existing provider-memory behavior is unchanged.

### Why

The approved resolutions keep Configure independent of machine availability, prevent a stopped
preferred engine from silently placing data in another engine, and treat the recorded engine as a
fact about where the instance's container and volume live. Podman provider memory would be stale;
preserving Docker's existing memory avoids changing Docker recovery behavior. See the approved
options and trade-offs in [iteration 12](./iterations/12-preferred-engine-and-podman-start.md).

---

## 0010 — Platform-gated Podman machine startup

**Status:** Accepted · **Date:** 2026-11-10 · **PR:** —

**Evidence:** [iteration 12](./iterations/12-preferred-engine-and-podman-start.md) §§3.5–3.6, Q5–Q6

### Question

When should Quick Start offer to start Podman, and which machine should the action target?

### Decision

1. Offer **Start Podman machine** only on macOS and Windows, after a failed readiness check when a
   stopped machine is identified. Start the machine marked `Default: true` by name; if none is
   marked default, use the sole machine. If several machines have no default, or the machine is
   already starting, show no button.
2. The button starts only the selected run's Podman machine and runs only after an explicit click.
   If no machine exists, initialization remains manual. Ambiguous selection remains manual, with
   guidance naming the machines.
3. Linux and WSL get copy-only `systemctl --user start podman.socket` guidance and no machine-start
   button. Remote sessions get no local start action.

### Why

The approved platform gate reflects that Podman uses a machine on macOS and Windows, while Linux
and WSL run Podman natively. A remote engine is not on the local machine. The default-or-sole rule
targets the machine Podman uses without choosing among ambiguous machines. See
[iteration 12](./iterations/12-preferred-engine-and-podman-start.md) for the approved alternatives
and source verification.
