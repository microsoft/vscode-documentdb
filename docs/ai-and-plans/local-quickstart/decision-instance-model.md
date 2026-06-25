# Decision: Instance model — single managed instance, ownership-bounded (v1)

**Status:** Accepted (production v1) · **Date:** 2026-06-25
**Scope:** Production v1 of Local Quick Start (not the POC).
**Design doc:** [`local-quickstart-v2.md`](./local-quickstart-v2.md) (§10.1 labels, §10.2
existing-container conflict, §13.10 attach, §15 roadmap, decision log).
**Raised by:** German Eichberger (xgerman) in design review — "manage multiple
containers / versions" and "connect to a retained test container."

## Questions

1. Should Quick Start manage **multiple** local DocumentDB containers (e.g. several
   instances, or multiple image versions side by side)?
2. If the user already created DocumentDB containers **another way** (CLI, `docker run`,
   a test harness), should Quick Start **list / adopt / manage** them?

## Decision

For **v1**, Quick Start manages **exactly one** instance and only ever touches
containers **it created**, recognized by the Docker label `vscode.documentdb.quickstart=1`
(§10.1). Concretely:

| Topic | v1 decision | Deferred to |
| ----- | ----------- | ----------- |
| Multiple **managed** instances | **No.** One managed instance; the rocket entry hides after setup. | v1.2 (§15) |
| Multiple **image versions** side by side | **No.** | v1.2 (§15) |
| Listing the user's **own** (unlabelled) containers inside Quick Start | **No.** They connect via the **regular new-connection wizard** at `localhost:<port>` — "Attach stays first-class" (§13.10). Quick Start does not own them. | — |
| **Adopt-existing-container** flow | **No** as a general feature. The *only* adoption v1 performs is re-recognizing **its own labelled** container after a reload (reconcile). | v1.2 (§15) |
| **Auto-discovery** of unmanaged DocumentDB containers | **No** — and when built, it belongs to the **generic connections** experience, not Quick Start. | v1.2 (§15) |
| **Name / port collision safety** | **Yes — required in v1.** See "What v1 must do" below (sharpens §10.2). | — |

This ratifies the design doc's existing position (§15: "Single managed instance";
decision log: "Single instance in v1; labels keep the model forward-compatible;
multi-instance + multi-version are v1.2") and records the reasoning below.

## Rationale

1. **The value proposition is "zero decisions."** Quick Start exists to go from an empty
   machine to an open, browsable local DB in one click. Supporting N instances
   re-introduces exactly the decisions it removes (which one? alias? port?) and multiplies
   port allocation, credential storage, tree shape, reconciliation, and multi-window
   coordination by N. Users who genuinely need N custom containers are already well served
   by their own `docker run` + the regular wizard.

2. **Ownership boundary = trust + safety.** The clean, defensible mental model is *Quick
   Start only manages containers it created (label-gated).* The moment it lists or acts on
   containers it did not create, a stray Stop/Delete can destroy something the user cares
   about, and it must guess "is this even DocumentDB? what port? what TLS?" That ambiguity
   is a support and trust liability. Recognition is therefore **label-based, never**
   name/image/port-based (§10.1).

3. **Credentials make adoption hollow anyway.** Quick Start auto-generates and stores the
   container's credentials. For a hand-run container it cannot know the `--username` /
   `--password` the user chose, so it could never populate a working connection. "Listing"
   such a container degrades to "here's a thing, go type your own creds" — which **is** the
   regular new-connection wizard. So discovery rightly lives in the generic connections
   experience, not here.

4. **Deferring is cheap because the model is already forward-compatible.** Because
   recognition is by label (not by the fixed name/port), adding multi-instance or
   adopt-existing in v1.2 needs **no data migration** — it is purely additive. That is the
   whole reason the design chose labels.

## What v1 must do (the one concrete work item)

Even with a single instance, v1 must handle a pre-existing container that holds the planned
name **or** the planned port, without clobbering it (§10.2):

- **Labelled as ours** (`vscode.documentdb.quickstart=1`) → re-adopt / reconcile it (the
  managed instance reappears in the tree). This is *not* general adoption — only our own
  container.
- **Unlabelled** (someone else's container holds the name, or the port is taken) → **never
  recreate over it.** Validate **both** identifiers up front (the connection/cluster name in
  the Connections view **and** the Docker container name), reject with a **clear inline
  error**, and point the user to the regular wizard / a port change. Matches the PostgreSQL
  reference, which refuses on a duplicate of either identifier.

This is the only part of this topic that is in-scope for v1 implementation.

## v1.2 extension shape (recorded so deferral is provably safe)

- **Discovered (unmanaged) containers:** a **read-only** section populated by `docker ps`
  filtered on the DocumentDB image; each row shows name / port / status; the only action is
  **Connect**, which opens the regular wizard pre-filled with `localhost:<port>` (user
  supplies credentials). No Stop/Delete — these are not owned.
- **Multiple managed instances:** the Quick Start node becomes a parent of N label-tagged
  rows, each carrying a unique `vscode.documentdb.alias`; the provision flow gains an
  alias + port step; credentials are keyed per-alias in SecretStorage; tree / lifecycle /
  reconcile iterate the labelled set instead of taking the first match.

Both are additive on top of today's label model.

## Current implementation note (starting point)

Today's code (POC) is strictly single-instance and assumes the first labelled match:
fixed container name/alias `vscode-documentdb-local`, a singleton cache key
`QUICK_START_CLUSTER_ID = 'quickstart-local-documentdb'`, and
`findManagedContainer()` returns `list[0]`. The unlabelled-collision safety above is **not
yet implemented** and is the concrete v1 hardening item this decision identifies.

## Consequences

- **Users:** one-click path stays decision-free; power users attach their own containers via
  the regular wizard; nobody's hand-run container is ever modified by Quick Start.
- **Engineering:** v1 surface stays small; the label model makes multi-instance / adopt /
  discovery clean v1.2 additions with no migration.
- **Review:** answers German's points with a documented rationale and a forward path
  (scheduled to v1.2; labels make it free to add) — see the design-doc decision log.
