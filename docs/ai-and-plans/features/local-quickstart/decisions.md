---
feature: local-quickstart
kind: decisions
status: active
verified: 2026-08-14
---

# Local Quick Start — Decisions

> The decisions that shaped Local Quick Start, and what was rejected on the way.

| #    | Decision                                               | Status              | Changed from the proposal?                | Date       | PR   |
| ---- | ------------------------------------------------------ | ------------------- | ----------------------------------------- | ---------- | ---- |
| 0001 | Single managed instance, ownership-bounded             | Superseded by 0002  | Accepted as proposed                      | 2026-06-25 | —    |
| 0002 | Multiple managed instances in v1                       | Accepted            | Reverses 0001 after owner review          | 2026-07-06 | —    |
| 0003 | Concept F — Docker verified as the first setup stage   | Accepted (modified) | Dedicated readiness page dropped entirely | 2026-08-03 | #798 |
| 0004 | Explicit cluster-command opt-ins for managed nodes     | Accepted            | Capability split deferred                 | 2026-08-09 | #876 |
| 0005 | Restore missing credentials from the managed container | Accepted            | Error-node tree flow deferred             | 2026-09-29 | #979 |

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
