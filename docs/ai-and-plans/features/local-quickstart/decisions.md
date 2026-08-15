---
feature: local-quickstart
kind: decisions
status: active
verified: 2026-08-14
---

# Local Quick Start — Decisions

> The decisions that shaped Local Quick Start, and what was rejected on the way.

| #    | Decision                                             | Status              | Changed from the proposal?                | Date       | PR   |
| ---- | ---------------------------------------------------- | ------------------- | ----------------------------------------- | ---------- | ---- |
| 0001 | Single managed instance, ownership-bounded           | Superseded by 0002  | Accepted as proposed                      | 2026-06-25 | —    |
| 0002 | Multiple managed instances in v1                     | Accepted            | Reverses 0001 after owner review          | 2026-07-06 | —    |
| 0003 | Concept F — Docker verified as the first setup stage | Accepted (modified) | Dedicated readiness page dropped entirely | 2026-08-03 | #798 |

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

| Topic                                                 | v1 decision                                                                                                                            | Deferred to |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Multiple **managed** instances                        | **No.** One managed instance; the rocket entry hides after setup.                                                                      | v1.2        |
| Multiple **image versions** side by side              | **No.**                                                                                                                                | v1.2        |
| Listing the user's own (unlabelled) containers        | **No.** They connect via the regular new-connection wizard at `localhost:<port>`. Quick Start does not own them.                        | —           |
| **Adopt-existing-container** flow                     | **No** as a general feature. The only adoption v1 performs is re-recognizing **its own labelled** container after a reload (reconcile). | v1.2        |
| **Auto-discovery** of unmanaged DocumentDB containers | **No** — and when built, it belongs to the **generic connections** experience, not Quick Start.                                         | v1.2        |
| **Name / port collision safety**                      | **Yes — required in v1.**                                                                                                              | —           |

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
