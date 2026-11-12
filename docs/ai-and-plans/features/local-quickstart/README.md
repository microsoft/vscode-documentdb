---
feature: local-quickstart
kind: notes
status: active
prs: [653, 798, 876, 958, 954, 953, 955, 979, 1076]
verified: 2026-08-14
code:
  - src/commands/localQuickStart/**
  - src/services/localQuickStart/**
  - src/tree/connections-view/LocalQuickStart/**
  - src/webviews/documentdb/localQuickStart/**
---

# Local Quick Start

**Core status:** shipped 0.10.0 · **Verified:** 2026-08-14

> Where the design of "run DocumentDB locally from inside VS Code" came from, and why it looks the
> way it does.

Local Quick Start provisions a labelled container, generates and stores its credentials, waits for
wire-protocol readiness, and surfaces the instance in the Connections view. The approved engine
flow offers Docker and Podman in Configure without checking availability, defaults fresh forms to
Docker, and does not persist the preference. During execution, setup detects both CLIs, uses the
preferred CLI when it is installed, and falls back to the other only when it is missing and the
other CLI is installed. Each instance records its owning engine, which remains fixed for lifecycle
actions and recreation, including Start fresh.

The approved engine preference and Podman startup behavior are recorded in
[iteration 12](./iterations/12-preferred-engine-and-podman-start.md); implementation progress is
tracked there. On macOS and Windows, an explicit **Start Podman machine** action is available only
for a stopped default machine or the sole machine. Initialization and ambiguous machine selection
remain manual. Linux and WSL receive copy-only guidance chosen from the address in Podman's error
(user socket, or a Windows machine from WSL); an unreachable remote Podman host gets no start
action, and remote sessions do not start a
local engine.

It is **not** a general Docker manager. It only ever touches containers it created, recognized by
the label `vscode.documentdb.quickstart=1`. Containers the user started by hand connect through the
regular new-connection wizard instead ([0001](./decisions.md#0001--single-managed-instance-ownership-bounded)).

## Code map

- `src/services/localQuickStart/**` — the service: container runtime wrapper, CLI readiness probes
  and engine classification, provisioning state machine, credentials, output masking
- `src/commands/localQuickStart/**` — commands and contributions
- `src/tree/connections-view/LocalQuickStart/**` — the tree node and its lifecycle actions
- `src/webviews/documentdb/localQuickStart/**` — the setup wizard

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
- **Engine readiness is a setup stage, not a separate concept.** The wizard runs
  `Introduction → Configure → Set up → Done`; the stage 1 heading is `Checking container engine`
  ([0003](./decisions.md#0003--concept-f-docker-verified-as-the-first-setup-stage)). Redesigned
  findings and engine-specific guides are pending W5; the detail includes raw CLI version output
  and names the missing preferred CLI when setup falls back.
- **Settled setup stages offer evidence in Details.** Rows with facts start collapsed on both Set up
  and Done and have concise factual summaries; explanations and recovery actions remain in the
  failure block. Full image and container IDs are available through mouse and keyboard tooltips.
  Below the unchanged main labels, summaries, facts and links use one regular proportional text
  style; only optional context is muted, while important qualifications remain prominent.
  Checking reports which Docker and Podman executables are on PATH, probes only the selected engine,
  and records the preferred engine and any fallback in Details. Active pulling uses one
  non-wrapping summary line: known image and origin initially, replaced by bounded engine output
  when available, not an estimated percentage. Sample-data loading failure is also called out on
  success. No step durations are recorded
  ([0008](./decisions.md#0008---set-up-stages-expand-to-show-what-each-stage-did)).
- **Engine preference and ownership.** Configure's first row is a check-free Container engine
  preference; Docker is the fresh default, and the preference itself is not persisted. Execution
  checks both CLIs and falls back to the other only when the preferred CLI is missing and the other
  is installed, not when the preferred engine is stopped. An instance's recorded engine owns its
  container and data volume, including
  on recreate; legacy records are resolved only during execution and are not guessed in Configure.
  Podman runs neither read nor write provider memory and ignore Docker evidence, while Docker's
  existing provider-memory behavior is unchanged.
- **Engine-specific recovery.** Only the selected engine can receive a start action. On macOS and
  Windows, a stopped default Podman machine (or the sole machine) can be started by explicit click.
  A missing machine must be initialized manually; an ambiguous machine choice remains manual.
  Linux and WSL get copy-only Podman guidance chosen from the address in Podman's error
  ([0012](./decisions.md#0012--podman-guidance-follows-the-address-in-its-error)), with no
  machine-start button, and remote
  sessions never start a local engine. See the approved details in
  [iteration 12](./iterations/12-preferred-engine-and-podman-start.md).
- **Provider identification.** Docker Engine and Docker Desktop are supported. When positive
  evidence identifies Podman behind the Docker CLI, the tree can label it
  **Podman (through the Docker CLI)**. Tree details use the server version, and host errors use
  neutral container-engine wording where appropriate.
- **Collision safety is non-negotiable.** A pre-existing container holding a planned name or port is
  never recreated over. Ours gets re-adopted; anything else is rejected with an inline error.
- **Existing data is preserved.** A managed container with no stored credentials has them restored
  from its own environment ([0005](./decisions.md#0005---restore-missing-credentials-from-the-managed-container)).
  A volume without recoverable credentials requires an explicit Start fresh. Its removal waits until the port check and image download succeed. Sample data is
  loaded only into a new volume, so recreating an instance does not restore documents the user deleted.
- **Refresh reports; it does not clean up.** If the recorded engine or container is unavailable, the
  record and credentials stay until setup or Delete. The tree does not silently switch an instance
  to another engine.

## Timeline

| Date       | PR    | What changed                                                                                                                         | Docs                                                                                                                                                                            |
| ---------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-06-15 | #653  | Initial design, benchmarked against the PostgreSQL extension                                                                         | [iterations/01-initial-design.md](./iterations/01-initial-design.md)                                                                                                            |
| 2026-06-22 | —     | POC scope, plan, and 5-agent review                                                                                                  | [iterations/02-poc/](./iterations/02-poc/)                                                                                                                                      |
| 2026-06-25 | —     | Instance model locked to one instance                                                                                                | [decisions.md#0001](./decisions.md#0001--single-managed-instance-ownership-bounded)                                                                                             |
| 2026-06-26 | —     | v1 production-readiness gap analysis                                                                                                 | [v1-readiness-gaps.md](./v1-readiness-gaps.md)                                                                                                                                  |
| 2026-07-06 | —     | Single → multi instance reversal                                                                                                     | [decisions.md#0002](./decisions.md#0002--multiple-managed-instances-in-v1-reconstructed)                                                                                        |
| 2026-08-02 | —     | Provider-neutral Docker readiness                                                                                                    | [iterations/04-ui-redesign/](./iterations/04-ui-redesign/)                                                                                                                      |
| 2026-08-04 | #798  | UI redesign shipped (Concept F)                                                                                                      | [iterations/04-ui-redesign/](./iterations/04-ui-redesign/)                                                                                                                      |
| 2026-08-09 | #876  | State sync + infrastructure error translation                                                                                        | [iterations/05-error-translation.md](./iterations/05-error-translation.md)                                                                                                      |
| 2026-09-23 | #958  | Setup never wipes a data volume before it can succeed (#946)                                                                         | [iterations/06-data-volume-protection/](./iterations/06-data-volume-protection/)                                                                                                |
| 2026-09-24 | #954  | Setup failures show Docker's error, not an exit code                                                                                 | [iterations/07-setup-failures.md](./iterations/07-setup-failures.md)                                                                                                            |
| 2026-09-24 | #953  | Reject credentials and ports setup can't honor (#949)                                                                                | [iterations/08-input-validation.md](./iterations/08-input-validation.md)                                                                                                        |
| 2026-09-24 | #955  | Tree and wizard stop showing a stale instance (#950)                                                                                 | [iterations/09-state-recovery.md](./iterations/09-state-recovery.md)                                                                                                            |
| 2026-09-29 | #979  | Restore missing credentials from the container                                                                                       | [decisions.md#0005](./decisions.md#0005---restore-missing-credentials-from-the-managed-container)                                                                               |
| 2026-09-29 | #979  | Wizard journey telemetry and correlation ids                                                                                         | [decisions.md#0006](./decisions.md#0006---wizard-journey-telemetry-and-correlation-ids)                                                                                         |
| 2026-10-15 | #1018 | Image usage telemetry follows VS Code's setting                                                                                      | [decisions.md#0007](./decisions.md#0007---image-usage-telemetry-follows-vs-codes-setting)                                                                                       |
| 2026-11-09 | —     | Partial container-runtime transparency; W1/W5/W8 pending                                                                             | [iterations/10-container-runtime-transparency.md](./iterations/10-container-runtime-transparency.md); [user manual](../../../user-manual/local-quick-start.md)                  |
| 2026-11-10 | —     | Details on settled Set up and Done stages; no step durations                                                                         | [iterations/11-setup-stage-details.md](./iterations/11-setup-stage-details.md)                                                                                                  |
| 2026-11-10 | #1076 | Preferred engine, owning-engine lifecycle safety and platform-gated Podman startup; all P1–P6 phases and final verification complete | [iterations/12-preferred-engine-and-podman-start.md](./iterations/12-preferred-engine-and-podman-start.md), [review](./iterations/13-preferred-engine-implementation-review.md) |
| 2026-11-12 | #1076 | Podman guidance follows the address in its error (WSL Windows machine, remote host, user socket)                                     | [iterations/14-podman-connection-detection.md](./iterations/14-podman-connection-detection.md)                                                                                  |

## Decisions

See [decisions.md](./decisions.md). Twelve entries: the single-instance model (0001, superseded), its
reversal to multi-instance (0002), the Concept F wizard information architecture (0003), the
managed-node cluster-command context boundary plus its deferred replacement (0004), restoring
missing credentials from the managed container (0005), the wizard journey telemetry and its
correlation ids (0006), image usage telemetry following VS Code's setting (0007), Details on
settled setup stages (0008), preferred-engine ownership and platform-gated Podman startup
(0009–0011), and Podman guidance from the address in its error (0012).

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

`design-iteration-1.md` and implemented or superseded iterations are history. Read a specific
iteration only when you need provenance for a particular behavior. Iteration 12 is an approved,
not-yet-implemented plan; its intended behavior must not be mistaken for current product behavior.
