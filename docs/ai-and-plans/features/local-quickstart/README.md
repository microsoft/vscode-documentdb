---
feature: local-quickstart
kind: notes
status: active
prs: [653, 798, 876]
verified: 2026-08-14
code:
    - src/commands/localQuickStart/**
    - src/services/localQuickStart/**
    - src/tree/connections-view/LocalQuickStart/**
    - src/webviews/documentdb/localQuickStart/**
    - src/webviews/documentdb/localQuickStartView/**
---

# Local Quick Start

**Status:** shipped 0.10.0 · **Verified:** 2026-08-14

> Where the design of "run DocumentDB locally from inside VS Code" came from, and why it looks the
> way it does.

Local Quick Start takes a user from an empty machine to an open, browsable local DocumentDB in one
click: it provisions a labelled Docker container, generates and stores its credentials, waits for
wire-protocol readiness, and surfaces the instance in the Connections view.

It is **not** a general Docker manager. It only ever touches containers it created, recognized by
the label `vscode.documentdb.quickstart=1`. Containers the user started by hand connect through the
regular new-connection wizard instead ([0001](./decisions.md#0001--single-managed-instance-ownership-bounded)).

## Code map

- `src/services/localQuickStart/**` — the service: container runtime wrapper, Docker readiness
  probes and classification, provisioning state machine, credentials, output masking
- `src/commands/localQuickStart/**` — commands and contributions
- `src/tree/connections-view/LocalQuickStart/**` — the tree node and its lifecycle actions
- `src/webviews/documentdb/localQuickStart/**`, `.../localQuickStartView/**` — the setup wizard

## User docs

- [docs/user-manual/local-quick-start.md](../../../user-manual/local-quick-start.md)
- [docs/user-manual/local-connection-documentdb-local.md](../../../user-manual/local-connection-documentdb-local.md)

## Related skills

- [.github/skills/error-translation](../../../../.github/skills/error-translation/SKILL.md) —
  how infrastructure-caused failures become messages users can act on. Local Quick Start is the
  original consumer of that machinery.

## Architecture (intent — code is authoritative for behavior)

- **Ownership is label-gated.** Recognition is by Docker label, never by container name, image, or
  port. This is what makes the instance model extensible without data migration.
- **Identity is an alias.** Each managed instance has an immutable alias (also the container name
  and the `vscode.documentdb.alias` label) plus an editable display name. The alias is the stable
  key for the container, the volume, the port reservation, the credentials in SecretStorage, and the
  cluster cache lookups. Never key a cache on the tree id.
- **Docker readiness is a setup stage, not a separate concept.** The wizard runs
  `Introduction → Configure → Set up → Done`; `Checking Docker` is stage 1 of Set up and is the only
  place Docker problems are reported ([0003](./decisions.md#0003--concept-f-docker-verified-as-the-first-setup-stage)).
- **Providers are neutral.** Docker Engine and Docker Desktop are both supported. The prerequisite
  is a Docker CLI that can reach a Linux-container daemon from the extension host.
- **Collision safety is non-negotiable.** A pre-existing container holding a planned name or port is
  never recreated over. Ours gets re-adopted; anything else is rejected with an inline error.

## Timeline

| Date       | PR   | What changed                                                 | Docs                                                                                     |
| ---------- | ---- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 2026-06-15 | #653 | Initial design, benchmarked against the PostgreSQL extension | [iterations/01-initial-design.md](./iterations/01-initial-design.md)                     |
| 2026-06-22 | —    | POC scope, plan, and 5-agent review                          | [iterations/02-poc/](./iterations/02-poc/)                                               |
| 2026-06-25 | —    | Instance model locked to one instance                        | [decisions.md#0001](./decisions.md#0001--single-managed-instance-ownership-bounded)      |
| 2026-06-26 | —    | v1 production-readiness gap analysis                         | [v1-readiness-gaps.md](./v1-readiness-gaps.md)                                           |
| 2026-07-06 | —    | Single → multi instance reversal                             | [decisions.md#0002](./decisions.md#0002--multiple-managed-instances-in-v1-reconstructed) |
| 2026-08-02 | —    | Provider-neutral Docker readiness                            | [iterations/04-ui-redesign/](./iterations/04-ui-redesign/)                               |
| 2026-08-04 | #798 | UI redesign shipped (Concept F)                              | [iterations/04-ui-redesign/](./iterations/04-ui-redesign/)                               |
| 2026-08-09 | #876 | State sync + infrastructure error translation                | [iterations/05-error-translation.md](./iterations/05-error-translation.md)               |

## Decisions

See [decisions.md](./decisions.md). Three entries: the single-instance model (0001, superseded), its
reversal to multi-instance (0002), and the Concept F wizard information architecture (0003).

## Open gaps

- [v1-readiness-gaps.md](./v1-readiness-gaps.md) is the ranked gap list from demo-POC to shippable
  v1, ordered by user stakes rather than effort.
- Two follow-ups were deferred deliberately in the UI redesign and are recorded in
  [iterations/04-ui-redesign/ui-redesign-decisions.md](./iterations/04-ui-redesign/ui-redesign-decisions.md#known-follow-ups):
  `runStream` in `LocalQuickStart.tsx` does not await the previous unsubscribe before subscribing
  again, and the error row the tree adds after a wizard failure may not belong there at all.
- Deferred from 0001 and still not built: discovery of unmanaged DocumentDB containers, which
  belongs to the generic connections experience rather than here.

## Reading order for newcomers

1. This README
2. [design.md](./design.md) — the current UX and architecture design (iteration 2)
3. [decisions.md](./decisions.md) — why the model is what it is

`design-iteration-1.md` and everything under `iterations/` is history. Read a specific iteration
only when you need provenance for a particular behavior.
