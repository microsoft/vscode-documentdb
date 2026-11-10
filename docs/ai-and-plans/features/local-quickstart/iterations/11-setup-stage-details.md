---
feature: local-quickstart
kind: plan
status: active
prs: [1065]
created: 2026-11-10
code:
  - src/webviews/documentdb/localQuickStart/LocalQuickStart.tsx
  - src/webviews/documentdb/localQuickStart/dockerReadinessPresentation.ts
  - src/services/localQuickStart/quickStartTypes.ts
  - src/services/localQuickStart/QuickStartService.ts
  - src/services/localQuickStart/ContainerRuntime.ts
  - src/webviews/documentdb/connectionDiagnostics/DiagnosticsRowDetails.tsx
  - packages/vscode-ext-webview-fluentui/src/components/StatusList/
---

# 11 — Details on the Set up stages

> **Accepted 2026-11-10.** The operator accepted the plan with every recommendation in
> [§9](#9-questions-resolved-2026-11-10), and one change: **no step durations** (§3.6). It ships as
> a PR stacked on #1065. The Set up step's status list gets the per-row **Details**
> disclosure that Diagnose connection already uses, so interested and advanced users can see what
> each stage actually did: which engine, which image and digest, which container and volume, which
> port, how readiness was confirmed, and whether sample data loaded. The default view does not
> change: the labels stay fixed, there is one evidence line, and Details start collapsed.

- **Builds on:** `StatusListItem.disclosure` and the `StatusListDetails*` building blocks
  (package 1.3.0), merged from `main` with #1066.
- **Stacked on:** #1065 (`dev/guanzhousong/quickstart-podman-fallback`). The PR for this plan
  targets that branch, not `main`.
- **Must not collide with:** [iteration 10](./10-container-runtime-transparency.md) W5 (parked),
  which owns the wording of the check table. See [Sequencing](#6-sequencing).

## 1. What Diagnose connection does, and why

Sources: [connectivity-troubleshooter decisions](../../connectivity-troubleshooter/decisions.md),
the [StatusList README "Details content"](../../../../../packages/vscode-ext-webview-fluentui/src/components/StatusList/README.md#details-content),
and `ConnectionDiagnostics.tsx` / `DiagnosticsRowDetails.tsx`.

| Aspect            | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                         | Decided in                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| When a row has it | Only **settled** rows (done, warning, error, skipped) that have something to show. Pending and active rows never have it. A row with a warning or error status **always** has details that explain it.                                                                                                                                                                                                                           | 0039                                        |
| Toggle            | "Details", `placement: 'detail'` (end of the evidence line, so the label stays a plain heading). `toggleLabel` = "Details for {row}". `toggleDescription` = the most severe finding, so a screen reader hears the reason without expanding.                                                                                                                                                                                      | 0039, WI-19                                 |
| State             | Controlled `Set<rowId>`. A new run collapses every row. `toggleRef` plus a focus fallback, because a row loses its disclosure when it resets.                                                                                                                                                                                                                                                                                    | 0039                                        |
| Content order     | Findings first (`StatusListDetailsMessage`, ordered error → warning → info, with title, explanation and "Next: …"), then evidence (`StatusListDetailsSection` per host, `StatusListDetailsFacts` term/value).                                                                                                                                                                                                                    | 0039, README                                |
| What evidence     | Connection settings and every option (secrets shown as "(hidden)", option source noted); SRV and TXT; per-host DNS alias chain and addresses with class; TCP connected and failed addresses; TLS protocol, subject, issuer, expiry, host-name match, trust; server type, replica set, version, wire compatibility, mechanisms; auth method, mechanism, user, clouds, sub-steps; commands run with outcome, ping, database count. | 0039, 0049, 0052, 0053                      |
| Timings           | Each settled row that ran shows a duration in an outline, squared `Badge` in `aside`, with no slow or fast rating, formatted for the locale. `highlightRowsOnHover` is on. Details repeat a time only where it adds information: per host when there are two or more hosts, per address when there were two or more attempts.                                                                                                    | 0050 (+ WI-33); **not adopted here** (§3.6) |
| Data contract     | The host sends **codes and structured facts**. The webview owns every sentence, and `formatEvidence.ts` and `DiagnosticsRowDetails.tsx` localize them. A fact is emitted only when it was actually established.                                                                                                                                                                                                                  | 0010, 0029.3, 0031                          |
| Styling           | Nothing custom. The package owns the frame (rule, indent, base200 type, motion). The consumer owns only the stack gap (`spacingVerticalM`). Code-like values go in `<code>`, secondary notes are muted ``s, and a bare `<Text>` is never used.                                                                                                                                                                                   | package README                              |
| Guiding rule      | Never show an incorrect answer. Leaving out a detail is better than showing a wrong one.                                                                                                                                                                                                                                                                                                                                         | repo memory, 0039 open items                |

Diagnose connection copied the fixed row list and the `·` evidence line from Local Quick Start
(decision 0029: "look at how documentdb local deals with this"). This plan brings the Details back
the other way.

## 2. What Local Quick Start shows today

- Five fixed stages (`PROVISION_STAGES`): Checking container engine, Pulling official image,
  Creating container, Starting container, Waiting for DocumentDB to accept connections. The same
  list appears in **Set up** (`StatusList "Setup progress"`) and in **Done** (`"Completed setup steps"`).
- **Only the first row has a detail line** (`checkStageDetail`, from `DockerDetailSegment[]`),
  plus "Last checked …" and a "Check Docker again" link when it failed. The other four rows show
  nothing.
- Below the list there is a `MessageBlock` for the failure, and, only for an engine problem, an
  `Accordion` titled **"What the Docker check found"**, built by `buildDockerDetailRows()` with its own
  `dl` styles (`dockerDetails*`). This accordion has every limitation the Details content guidance
  was written to remove: it sits outside the row it describes, has its own type and borders, and
  only appears on failure. The [fluentui package README](../../webview-fluentui-package/README.md)
  names it as a "separately styled" list that was not migrated because it is not inside a
  `StatusList`.
- `StageEvent` carries no per-stage facts, only `message`, `boundPort`, `timedOut`,
  `dockerReadiness` and `canReuseExistingData` on terminal events. Yet `QuickStartService.provision()`
  already holds most of the facts an advanced user would want (see §3).

## 3. Proposed Details, per stage

The facts listed are the evidence. Findings (`StatusListDetailsMessage`) are used only where noted.
**Bold** marks facts the service does not have today.

### 3.1 Checking container engine

Source: `DockerReadiness` (already in the webview) and new `checking` facts from the service.

| Term                   | Value (example)                                             | Source / note                                                                   |
| ---------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Check result           | Ready / Problem found / Could not tell                      | `outcome`                                                                       |
| Detected problem       | Docker access denied                                        | `failureKind`, only when not ready                                              |
| Command                | `docker` 27.3.1 · `podman` 5.8.3                            | `cli`, `cliVersion` (wording owned by W5)                                       |
| Engine                 | Running / Not answering                                     | `daemonReachable` (replaces "Docker daemon", W5)                                |
| Server version         | 27.3.1                                                      | `serverVersion` (W2)                                                            |
| Provider               | Docker Desktop · Podman · Podman (through the Docker CLI)   | `provider` + muted note from `providerEvidence` / `engineEvidence` (W5 wording) |
| Endpoint               | Unix socket (from `DOCKER_HOST`)                            | `endpointKind`, `endpointSource`                                                |
| Socket access          | Not in the `docker` group                                   | `permissionDetail`, only when present                                           |
| Containers run on      | Linux arm64                                                 | `osType`, `daemonArchitecture`                                                  |
| This machine           | WSL, x64                                                    | `environment`, `arch`                                                           |
| Container host         | This machine / WSL / remote                                 | `executionTarget`                                                               |
| **Port**               | `10260` free on `127.0.0.1`                                 | **new**: `isPortFree(chosenPort)` already runs in this stage                    |
| **Previous container** | Removed `vscode-documentdb-local` (`3f2a…`) for a clean run | **new**: `findManagedContainer` and `removeContainer` already run in this stage |
| Checked                | 2 minutes ago · Diagnostic reference `ab12…`                | `checkedAtMs`, `diagnosticFingerprint`                                          |

- The "how it was established" notes from `buildDockerDetailRows` stay, as muted secondary text
  inside the value (README role: "Secondary note inside a value"). They are what makes this table
  useful to an advanced user.
- **Remove the Accordion.** Its content moves into this row's disclosure. The failure
  `MessageBlock` and its actions stay below the list (see Q2).
- Every row starts collapsed, including a failed check (Q3).

### 3.2 Pulling official image

| Term              | Value (example)                                                              | Source                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Image             | `ghcr.io/…/documentdb-local:latest` (custom tag) / (kept from existing data) | `imageRef`, `usedCustomImage`, `reusing` — all known today                                                                          |
| **Result**        | Downloaded · Updated · Already up to date                                    | **new**: inspect the image before and after the pull and compare IDs. Omit when either inspect failed.                              |
| **Image ID**      | `sha256:9c1e…` (short)                                                       | **new**: `client.inspectImages` (add `inspectImage` to `IContainerRuntime`)                                                         |
| **Digest**        | `sha256:41d0…`                                                               | **new**: `repoDigests[0]`                                                                                                           |
| **Image version** | 0.116.0                                                                      | **new, verify first**: only if the published image carries an OCI `org.opencontainers.image.version` label. Otherwise leave it out. |
| **Created**       | 2026-10-28                                                                   | **new, verify** that the field is returned by both the Docker and Podman clients                                                    |

Do **not** parse `docker pull` stdout ("Status: Image is up to date…"): it differs between Docker
and Podman and between versions, and a wrong parse would break the guiding rule.

### 3.3 Creating container

| Term         | Value (example)                                                              | Source                                                                     |
| ------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Container    | `vscode-documentdb-local` `3f2a9b1c…`                                        | `containerName(alias)`, `containerId`                                      |
| Port mapping | `localhost:10260` → container `10260`                                        | `chosenPort`, `QUICK_START_PORT`                                           |
| Data volume  | `<volumeName>` at `/data` (new · kept existing data · replaced, Start fresh) | `volumeName(alias)`, `QUICK_START_DATA_PATH`, `reusesVolume`, `startFresh` |
| User         | `docuser`                                                                    | `credentials.username` (custom or generated)                               |
| Password     | (hidden) · passed in a temporary file, deleted after create                  | Same "(hidden)" convention as Diagnose connection. Never the value.        |

### 3.4 Starting container

| Term       | Value (example)                                 | Source                                                                                                          |
| ---------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| State      | Running                                         | `inspected.status` (only when inspect succeeded)                                                                |
| Started    | 10:42:17                                        | `inspected.startedAt`                                                                                           |
| Bound port | `10260`                                         | `getBoundHostPort(inspected)`. Say "(as requested)" when inspect could not report it and the fallback was used. |
| Logs       | Streaming to the setup log · **View setup log** | `followLogs` (the link calls the existing `showOutput`)                                                         |

### 3.5 Waiting for DocumentDB to accept connections

| Term            | Value (example)                                                                          | Source                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Endpoint        | `localhost:10260`, TLS (self-signed certificate accepted)                                | `composeConnectionString` options. Show the facts, **never** the connection string.                           |
| **Probe**       | `ping` on `admin` answered after **7 attempts**                                          | **new**: `waitForReadiness` returns `{ attempts }`                                                            |
| **Server**      | DocumentDB 0.106.0 · API compatibility 7.0                                               | **new, optional**: one best-effort `hello` on the client that just pinged (Q8). Reuse `apiCompatibilityText`. |
| **Sample data** | Loaded · Not requested · Not loaded, existing data kept · **Not loaded** (see setup log) | **new**: `seedSampleData` today swallows failures into the Output channel only                                |
| Saved as        | "DocumentDB Local" in the Connections view · credentials in VS Code secret storage       | `displayName`                                                                                                 |

**Sample data that was requested but not loaded** is a real gap today: setup reports success and
the user finds an empty database. Details get an info message ("Sample data was not loaded",
next step "View setup log"), and the success `MessageBlock` gets one sentence saying so. The row
stays `done` (Q5).

On a **readiness timeout or exited container**, the existing `MessageBlock` keeps the
explanation and the actions. Details add the evidence: attempts, the last probe error (masked,
`QuickStartMessage.detail` style), and the exit code plus last log line when the container exited.

### 3.6 No step durations

**Operator decision, 2026-11-10: this feature does not include timings for the steps.** Unlike
Diagnose connection (decision 0050), the stages show no duration badge (`aside`), Details contain
no "Took" fact, and `StageEvent` gains no `durationMs`. `highlightRowsOnHover` is not needed
either: 0050 introduced it so a badge at the far edge of a wide list could be matched to its row,
and these rows have no badge.

This applies to step durations only. The other facts in §3 that come with a time stay: when the
container check ran ("Last checked", Q4) and when the container started (§3.4, a clock time, not
a duration).

## 4. Data contract

Mirror the Diagnose connection split: the service reports facts, the surface words them (already
the rule for `QuickStartMessage` and `DockerDetailSegment`).

```ts
// quickStartTypes.ts — illustrative, names to be settled in review
export type StageFacts =
    | { kind: 'checking'; port: number; portFree: boolean; removedContainerId?: string }
    | { kind: 'pulling'; imageRef: string; imageOrigin: 'default' | 'custom' | 'reused';
        result?: 'downloaded' | 'updated' | 'upToDate'; imageId?: string; digest?: string; imageVersion?: string }
    | { kind: 'creating'; containerName: string; containerId?: string; hostPort: number; containerPort: number;
        volumeName: string; dataPath: string; volume: 'new' | 'reused' | 'replaced'; username: string }
    | { kind: 'starting'; state?: string; startedAtMs?: number; boundPort: number; boundPortReported: boolean }
    | { kind: 'waiting'; attempts?: number; serverVersion?: string; maxWireVersion?: number;
        sampleData: 'loaded' | 'notRequested' | 'keptExisting' | 'failed'; lastProbeError?: string };

export interface StageEvent {
    // …existing fields…
    readonly facts?: StageFacts;
}
```

Rules:

- **Allow-list every field.** `InspectContainersItem.environmentVariables` holds `USERNAME` and
  `PASSWORD`, so never forward an inspect result, only the picked fields. Mask free text
  (`lastProbeError`) with the run's `secrets`, as `QuickStartMessage.detail` already is.
- **Optional means unknown.** A field is set only when it was established, and the view leaves out
  a fact rather than writing "unknown" (the `DockerDetailSegment` rule).
- **No new telemetry from facts by default.** Image IDs, digests and container IDs are not
  telemetry material.
- A pure `stageDetailsPresentation.ts` (like `dockerReadinessPresentation.ts`) turns
  `StageFacts` + `DockerReadiness` into view models, so the mapping is unit-tested without React.

## 5. Webview changes

- One `SetupStageRow` component, shared by the Set up and Done lists, wrapping `StatusListItem`
  with `disclosure` (`placement: 'detail'`, "Details", "Details for {stage}"), and
  `toggleDescription` for an error stage (its message title).
- One `SetupStageDetails` content component, built only from `StatusListDetailsFacts`,
  `StatusListDetailsSection` and `StatusListDetailsMessage`, plus `<code>` and muted spans. No
  `makeStyles` beyond the root stack gap. Delete `dockerDetails*`, `dockerAccordion*` and the
  `Accordion` imports once they are unused.
- Keep per-run stage facts in state (`Record<ProvisionStage, StageFacts | undefined>`). **Retry setup**, **Start over** and **Wait longer** clear the facts of the stages they
  re-run. Every new run collapses all rows, as in Diagnose connection.
- Do not persist facts across a panel reopen. Decision [0003](../decisions.md#0003--concept-f-docker-verified-as-the-first-setup-stage)
  deleted `getDockerLastCheckedAtMs` because remembered evidence can be stale. The same reasoning
  applies here.
- Focus: the checking row loses its disclosure while "Check Docker again" runs (the row turns
  `active`). Pass `toggleRef` and fall back to the footer's primary button, as `useFocusFallback`
  does in Diagnose connection.
- The detail line on a failed check gets long: evidence · Last checked … · Check Docker again,
  then Details. "Last checked" stays on the line, and Details add the absolute time and the
  diagnostic reference (Q4).

## 6. Sequencing

### Execution record — 2026-11-10

Operator instruction: implement this accepted plan, use Opus 5.5 for the work-item
plan, run Case 1 and Case 2 until green, and create a PR against the current
`dev/guanzhousong/quickstart-podman-fallback` branch. Work starts at
2026-11-10 06:34:52 UTC on `dev/tnaum/quickstart-setup-stage-details`.
The pre-existing untracked Podman archive is outside this work.

| Item | Scope | Model and reason | Prerequisite | Status |
| ---- | ----- | ---------------- | ------------ | ------ |
| P1 | Shared checking-row disclosure, focus/reset behavior; remove accordion | Terra: self-contained webview migration | — | Queued |
| P2 | Typed runtime image inspection, per-stage facts, non-readiness presentation | Sol: host/webview contract and runtime lifecycle | P1 | Queued |
| P3 | Readiness attempts, best-effort hello, sample-data outcomes and success sentence | Sol: readiness lifecycle and cross-module behavior | P2 | Queued |
| P4 | Aggregate disclosure telemetry, browser scenarios, docs and decision record | Sol: session lifecycle and cross-module verification | P3 | Queued |

Contract review advised by Opus 5.5 (high confidence): store terminal facts by
`facts.kind`, not `event.stage`; preserve mid-setup Docker failure evidence on the
owning failed row; leave W5 wording untouched; use the accepted absolute check
timestamp inside Details. Unknown optional facts are omitted. Inspect results are
allow-listed; never forward raw records or environment variables. Image creation
dates must be validated from actual source fields, not the client's synthesized
date. Readiness facts can omit sample-data outcome before finalization; `hello`
failure must not retry a successful ping. These refine the illustrative internal
contract without changing persisted data, authentication, or the accepted UI.

The leader chose sequential ownership and the four commits above (confidence
100%: phases overlap in service, presentation, and scenario files). No additional
work items, W5 redesign, step timings, or optional hardening are in scope.

1. **A PR stacked on #1065.** Branch from `dev/guanzhousong/quickstart-podman-fallback` and open
   the PR against that branch, not `main`. When #1065 merges, retarget it to `main`. Keep the
   branch rebased or merged on top of #1065 while it is open.
2. **P1 (webview only, no host change):** `SetupStageRow` and `SetupStageDetails`. Move the check
   table into the checking row's disclosure with the **current** wording (or W5's, if W5 has landed
   on the base branch by then). Remove the Accordion. This is the lowest-risk change and delivers
   the most visible result.
3. **P2:** `StageFacts` for checking, pulling, creating, starting and waiting, plus `inspectImage`
   on the runtime.
4. **P3:** sample-data outcome (the Details message and the success-block sentence), readiness
   attempts, and the optional server version.
5. **P4:** Details telemetry (Q7), docs and decision record (below).

Each phase is a separate commit. Case 1 applies per commit; Case 2 applies at hand-over.

## 7. Tests

- `stageDetailsPresentation.test.ts`: one case per stage and per optional fact being absent.
  Podman, Docker, and Docker CLI connected to Podman for the checking stage. **Password, connection
  string and env never appear** in any view model.
- `QuickStartService.test.ts`: `facts` on each `done` event, and no `durationMs` anywhere. A pull with a
  failed before or after inspect sets no `result`. `seedSampleData` failure → `sampleData: 'failed'`
  while the run still succeeds. No env var is forwarded from a mock inspect that contains
  `PASSWORD`.
- L2 browser scenarios (`build/verification/browser/scenarios.ts`): new `success-details`
  (all rows expanded), `failed-check-details` and `success-sample-data-not-loaded`. Update the `docker-missing-*` scenarios, which lose
  the "What the Docker check found" accordion. Run all three themes with
  `npx vitest run --config build/verification/browser/vitest.config.ts build/verification/browser/scenarios.test.ts`.
- Accessibility pass with the `detecting-accessibility-issues` skill: toggle names, the region named
  by its toggle, and no focus loss when a re-check removes the disclosure.

## 8. Docs to update when implemented

- `local-quickstart/README.md` (timeline row) and `design.md` (Set up step).
- `local-quickstart/decisions.md`: a new entry, "Set up stages expand to show what each stage did",
  amending 0003's single failure surface. Details carry evidence only; the `MessageBlock` stays the
  place for explanations and actions. Record that step durations were left out by the operator,
  as a deliberate difference from Diagnose connection's 0050.
- `webview-fluentui-package/README.md`: the "details building blocks have one consumer" note
  becomes two consumers, and Local Quick Start is no longer listed as unmigrated.
- User manual: the Local Quick Start page gets one short paragraph about Details.

## 9. Questions (resolved 2026-11-10)

**Resolved:** the operator accepted every recommendation below. Q6 no longer covers durations,
because the feature has none (§3.6).

Each question lists its options with their pros and cons, then a recommendation. Facts the options
rely on were checked against the code on 2026-11-10. Three recommendations changed from the first
draft of this plan after that check (Q3, Q4, Q5); each says so.

| #   | Question                                                   | Recommendation                                                                       |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Q1  | Which rows get Details?                                    | **A.** Every settled row that has facts                                              |
| Q2  | Where does a failure's explanation live?                   | **A.** It stays in the `MessageBlock`; Details carry evidence only                   |
| Q3  | Does a failed stage's Details start expanded?              | **A.** No; everything starts collapsed _(changed)_                                   |
| Q4  | Where does "Last checked …" go?                            | **A.** It stays on the detail line _(changed)_                                       |
| Q5  | How is "sample data requested but not loaded" shown?       | **D.** An info message in Details plus one sentence in the success block _(changed)_ |
| Q6  | Do Details appear on the Done list?                        | **A.** Yes                                                                           |
| Q7  | Is opening Details recorded in telemetry?                  | **C.** Session aggregates on the existing `wizard.close` event                       |
| Q8  | Does setup ask the server for its version after readiness? | **B.** One best-effort `hello` on the client that pinged                             |

### Q1 — Which rows get Details?

Decision 0039 left "whether healthy rows should offer details at all" open for Diagnose connection.
The package README warns: "A toggle on every row trains people to ignore it."

- **A. Every settled row that has facts.** No toggle on pending or active rows, and none on a row
  that settled before it established anything (for example a stage that failed at once).
  - Pros: it is what was asked for: interested users can inspect any stage, including a
    successful one. The rule is the same for all five rows, so it is easy to learn and to test.
  - Cons: five toggles on a successful run. A user who never cares sees five more links.
- **B. Only rows with an error.** This is roughly today's accordion, moved into the row.
  - Pros: least visual change. A toggle always means "something to look at".
  - Cons: it does not meet the request. A successful run, where curiosity is high ("which image,
    how long did the pull take?"), shows nothing.
- **C. Only the checking row.**
  - Pros: smallest change: a pure migration of the accordion.
  - Cons: it leaves out the facts the request is about (image, container, volume, readiness).

**Recommendation: A.** The toggle sits at the end of the detail line in the detail line's size
(`placement: 'detail'`), so it does not compete with the labels, and every row starts collapsed. Mitigating the README's
concern is a matter of content: a row offers Details only when it has facts, never an empty region.

### Q2 — Where does a failure's explanation live?

In Diagnose connection (0039) the row's Details hold the findings: title, explanation and "Next:".
Local Quick Start has a `MessageBlock` below the list that explains the failure and carries its
actions: Retry setup, Wait longer, Start over, Copy command, Start Docker, View setup log.
Decision 0003 chose "exactly one failure surface".

- **A. The explanation stays in the `MessageBlock`; Details carry evidence only.**
  - Pros: no change to the failure flow that 0003 and iteration 07 settled. The explanation and the
    buttons that act on it stay together and visible without a click. Smallest risk to the
    `docker-missing-*` and timeout scenarios.
  - Cons: unlike Diagnose connection, the row's Details on an error row describe _what happened_
    but not _why it matters_. 0039's rule ("a row with a warning or error always has details that
    explain it") is met by the block below, not by the Details.
- **B. The explanation moves into Details as a finding; the `MessageBlock` keeps only the actions.**
  - Pros: the same model as Diagnose connection: one way to read a failed row across both panels.
  - Cons: the explanation becomes hidden behind a collapsed toggle, or, if auto-expanded (Q3), it
    pushes the actions down. The recovery command and its Copy button need the explanation beside
    them. It reopens a settled decision (0003) for consistency alone.
- **C. Both: the explanation in the block and repeated as a finding in Details.**
  - Pros: each surface reads on its own.
  - Cons: the same text twice on one screen, and two places to keep in sync per failure key.

**Recommendation: A.** The `MessageBlock` is where the user acts, so the reason belongs there. On an
error row, `toggleDescription` carries the failure's title, so a screen reader user hears the
reason on the toggle without expanding it, as in 0039.

### Q3 — Does a failed stage's Details start expanded?

Checked: today's "What the Docker check found" `Accordion` starts **collapsed** (no
`defaultOpenItems`). Diagnose connection never auto-expands (0039 left it open). The failure
`MessageBlock` and its actions render **below** the status list.

- **A. Every row starts collapsed, including a failed one.**
  - Pros: same as today's accordion and as Diagnose connection. The actions in the
    `MessageBlock` stay where the user expects them, directly under the list. The layout of a failed
    run does not jump when the failure arrives.
  - Cons: the accordion had a prominent, brand-coloured header; a "Details" link at the end of a
    detail line is less noticeable, so fewer users may find the evidence.
- **B. A failed stage starts expanded.**
  - Pros: evidence immediately visible at the point of failure.
  - Cons: the expanded region pushes the `MessageBlock` and its buttons down, often below the fold
    in a short panel. The region opening when the failure arrives is the layout shift that 0028 and
    0029 were written to avoid.
- **C. Expanded for the checking stage only.** This was the first draft's recommendation.
  - Pros: the place where users most need the evidence (engine problems).
  - Cons: the same push-down as B, on the failure with the most actions (install, start, copy a
    command). It is also inconsistent across rows.

**Recommendation: A** _(changed from C)_. The first draft assumed the accordion was open by default;
it is not. If discoverability turns out to be a problem, the cheaper fix is a sentence in the
failure `MessageBlock` ("Details on the stage above show what the check found"), not
auto-expansion.

### Q4 — Where does "Last checked …" go?

Today a failed check's detail line reads: evidence · Last checked … · Check Docker again. The code
says why: "When the evidence was gathered belongs next to the evidence, not at the foot of the
block" (`stageMetaFor` in `LocalQuickStart.tsx`). Adding Details puts one more item on that line.

- **A. It stays on the detail line.** Details add the absolute local time and the diagnostic
  reference.
  - Pros: keeps the deliberate choice in the code. How old the evidence is decides whether to press
    "Check Docker again", so the two belong together. The `detail` placement wraps the toggle like a
    word, so a long line never covers text.
  - Cons: the failed line is long: up to five segments, a link and the toggle. On a narrow panel it
    wraps to two lines.
- **B. It moves into Details as a "Checked" fact.** This was the first draft's recommendation.
  - Pros: a shorter, calmer line.
  - Cons: the staleness signal gets hidden at the moment it matters, and it undoes an explicit
    choice.
- **C. It moves into the failure `MessageBlock`.**
  - Pros: next to the other recovery actions.
  - Cons: it is separated from the evidence it dates. Diagnose connection puts its "Checked … ago"
    in its result area (0045), so there is precedent, but there the whole run is dated, not one row.

**Recommendation: A** _(changed from B)_. Check it in the L2 screenshots at a narrow width. If the
line is unreadable there, shorten the evidence segments rather than moving the date.

### Q5 — How is "sample data requested but not loaded" shown?

Checked: `seedSampleData` swallows the failure into the setup log, the run reports success, and the
user finds an empty database. `StageStatus` deliberately excludes `warning`. The Done list
hard-codes `status="done"`. In the package, `warning` means "succeeded, but you may not proceed".

- **A. An info message in the waiting row's Details only.** This was the first draft's
  recommendation.
  - Pros: no status change, no new surface.
  - Cons: it is hidden behind a collapsed toggle, so the user still discovers the empty database by
    surprise. That does not close the gap it was meant to close.
- **B. A `warning` status on the waiting row.**
  - Pros: visible on the row without a click.
  - Cons: it misuses the vocabulary. The user _can_ proceed; the instance works. It needs
    `StageStatus` and the hard-coded Done list to change, and it puts a warning glyph above an
    "All set" message.
- **C. One sentence in the success `MessageBlock` only**, for example "Sample data was not loaded.
  View setup log for the reason."
  - Pros: shown where the user reads the result, before they open an empty database.
  - Cons: a new success variant and a string. No evidence on the row.
- **D. A and C together.**
  - Pros: the visible sentence tells the user; Details hold the evidence (requested, not loaded,
    the masked reason).
  - Cons: the most work: a host fact, a presentation case, a string and a scenario.

**Recommendation: D** _(changed from A)_. The next step must stay accurate: there is no "load sample
data" command today, so it points to the setup log rather than suggesting a retry.

### Q6 — Do Details appear on the Done list?

Checked: the Done list is only reached after a live run in the same panel. `openLocalQuickStart`
opens at Introduction or Configure, never at Done. So the facts in memory always belong to the run
on screen.

- **A. Yes.** The Done list uses the same `SetupStageRow` as the Set up list.
  - Pros: Done is when curiosity is highest ("which image did I get, which volume holds my data?").
    One component, so the lists cannot drift apart.
  - Cons: the Done screen gets five toggles above "All set" and the next steps.
- **B. Set up only; the Done list stays plain.**
  - Pros: a quiet success screen.
  - Cons: the facts disappear the moment setup succeeds, which is exactly when a user would look.

**Recommendation: A.** The rows start collapsed, so the success screen looks the same until a
user asks for more.

### Q7 — Is opening Details recorded in telemetry?

Checked: Diagnose connection records no expansions. Local Quick Start already has a journey
(`documentDB.quickstart.wizard.step` and `.wizard.close`, keyed by `quickStartSessionId`), and
`.close` carries session aggregates such as `setupAttemptCount` and `waitLongerCount`.

- **A. No telemetry.**
  - Pros: nothing to classify or maintain. Same as Diagnose connection.
  - Cons: no way to learn whether advanced users use the feature, or which stage they inspect, so
    the Q1 trade-off cannot be revisited with data.
- **B. A new event per expansion.**
  - Pros: exact timing and order of expansions.
  - Cons: noisy. A new event also needs classification before it reaches dashboards, and data
    starts only from that day (classification is not backfilled).
- **C. Aggregates on the existing `wizard.close` event:** a `detailsOpenedStages` property (the
  sorted, bounded stage ids opened at least once) and a `detailsOpenCount` measurement.
  - Pros: one row per session, joined to the existing journey, with no new event. A bounded
    vocabulary, no free text.
  - Cons: no per-run attribution when a session has several attempts. A panel that crashes before
    `close` loses the data, as the other `close` aggregates already do.
- **D. A property on `wizard.step`.**
  - Pros: tied to the step the user left.
  - Cons: expansions on Done have no following step event, so the most interesting case is lost.

**Recommendation: C.** Name the fields without "error" or "exception": the azext whole-error
masking redacts any property named that way. Follow the `telemetry-instrumentation` skill when
implementing.

### Q8 — Does setup ask the server for its version after readiness?

Checked: `waitForReadiness` opens a `MongoClient`, runs `ping` on `admin`, and closes the client in
`finally`. Diagnose connection reads the DocumentDB version from `hello`'s
`internal.documentdb_versions` and the API compatibility from `maxWireVersion`
(`packages/documentdb-js-connection-diagnostics/src/checks/hello.ts`).

- **A. No extra command.** Details show the image facts from §3.2 only.
  - Pros: no change to the readiness loop. Nothing new can fail.
  - Cons: no server-side confirmation of what is actually running. The image version depends on
    an OCI label that may not exist.
- **B. One `hello` on the same client, right after a successful `ping` and before `close`,
  best-effort.**
  - Pros: one local round trip. It reports the running server's DocumentDB version and API
    compatibility, with the same parsing and wording (`apiCompatibilityText`) as Diagnose
    connection.
  - Cons: a little more code in a sensitive loop. It must never fail or delay setup: wrap it, and
    on failure leave the facts out (a silent-catch meter, as elsewhere in the service).
- **C. `buildInfo` instead of `hello`.**
  - Pros: one `version` field.
  - Cons: what that field means on DocumentDB, compared with `documentdb_versions`, is not
    verified for the Local image. The guiding rule forbids showing it as "DocumentDB version"
    until it is.
- **D. Read the image's OCI version label only** (§3.2).
  - Pros: no network.
  - Cons: it describes the image, not the server, and only if the label is published.

**Recommendation: B**, verified against the published image before it ships. If `hello` does not
return `internal.documentdb_versions` there, show only API compatibility and leave out the version
fact.
