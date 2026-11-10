---
feature: local-quickstart
kind: review
status: active
prs: []
created: 2026-11-10
code:
  - src/services/localQuickStart/**
  - src/webviews/documentdb/localQuickStart/**
  - src/commands/localQuickStart/openLocalQuickStart.ts
  - build/verification/browser/scenarios.ts
---

# Preferred engine implementation review

## Scope and method

Implementation of the approved [iteration 12](./12-preferred-engine-and-podman-start.md),
stacked on `dev/tnaum/quickstart-setup-stage-details-pr` (#1072), not `main`.

The leader used the lead workflow from #1073. Opus 5.5 planned the interfaces and reviewed
the risky logic after each phase. A fresh `gpt-6.1-sol` code-review agent then performed
an independent whole-feature sweep; Opus 5.5 challenged and validated its findings against
the implementation. Review was read-only; separate coding agents implemented corrections.
The source plan records phase commits, decisions, confidence and focused checks.

The operator requested the implementation and repeated checks/fixes until green.
The dispositions below are the leader's implementation decisions within that scope,
not a claim that the operator personally reviewed the findings. Human review remains due.

## Phase-review corrections

| Phase | Finding                                                                                           | Disposition                                                                     |
| ----- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| P1    | Ephemeral legacy lookup cached as instance ownership prevented retry after installing Podman      | Fixed before `deecc32f`; only real ownership is cached                          |
| P2    | Pinned readiness discarded the run's original preference and fallback evidence                    | Fixed before `7f5ad767`; overlay a clone after the runtime memo                 |
| P3    | Metadata-only wizard opening fabricated live container metadata and mutated credential state      | Fixed before `346dc9cd`; shared live state is not fabricated                    |
| P5    | Shim launches could clear Docker provider memory; click-time machine changes appeared unavailable | Fixed before `165bc3d1f`; actual action controls memory and races enter polling |
| P5    | An initially starting Podman machine required a manual check instead of automatic waiting         | Fixed before `165bc3d1f`; read-only polling runs once per execution generation  |

## Independent sweep and validated dispositions

All four findings were validated against current code by Opus 5.5 at 88–92% confidence.
They are meaningful incorrect behavior in supported workflows, not broad severe failures.

| ID  | Severity | Finding                                                                                     | Decision and reason                                                                                                                                  | State                          |
| --- | -------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| R1  | Medium   | A provisioning lease could leave an engine pin after rollback                               | Fix: keep lease routing pinned while active, but cache only durable ready-record/container ownership so fresh preferences work after failure         | Fixed in `2ccb3eb86`; verified |
| R2  | Medium   | A post-check status query reconstructed selection from the lease and lost fallback evidence | Fix: send the captured checking snapshot on checking events; consume it directly and preserve readiness telemetry in the existing subscription event | Fixed in `2ccb3eb86`; verified |
| R3  | Medium   | A successful checking snapshot survived into later executions                               | Fix: clear per-execution readiness when starting a new stream, but retain it for Wait longer                                                         | Fixed in `2ccb3eb86`; verified |
| R4  | Medium   | Configure's engine lock did not update after an external instance change or deletion        | Fix: include metadata-only ownership in instance updates and their dedupe key; update the UI without rerunning wizard initialization                 | Fixed in `2ccb3eb86`; verified |

P6 review also identified guessed telemetry when an older/synthetic snapshot has no
preference evidence. The accepted correction omits unknown fields. Adding a new pinned-mode
telemetry classification was not part of the approved plan and is not included.

The final cross-window correction was reproduced by four failing service regressions
before implementation. Ownership is retained for ready records and real live containers,
but is not inferred from lease-only records or stale metadata after deletion. Opus
approved the corrected routing at 85% confidence. Eight additional regressions preserve
the legitimate ownership cases, and the final Case 1 build and 1,191 focused tests passed.
The three initially failing new scenario fixtures were corrected without changing
production behavior; their nine theme routes and 36 assertions passed in a real browser.

## Verification

| Check                             | First round                                                                                         | Final result                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Case 1 build and focused tests    | Passed; 1,164 tests                                                                                 | Passed; 1,191 tests, 30 files          |
| Localization generation and check | Passed                                                                                              | Passed                                 |
| Prettier                          | Passed                                                                                              | Passed                                 |
| Lint                              | Five unsafe-assignment errors in touched files                                                      | Passed after typed-fixture corrections |
| Case 2 build                      | Passed                                                                                              | Passed                                 |
| `typecheck:tests`                 | Passed                                                                                              | Passed separately                      |
| Full Vitest suite                 | 8,493 passed, one skipped, 388 files                                                                | 8,520 passed, one skipped, 388 files   |
| Package                           | Passed                                                                                              | Passed                                 |
| Browser scenarios, three themes   | First runner exposed fixture/evidence failures and a missing external timer in the tool environment | 66 routes, 240 assertions, zero errors |
| Real remote Podman lifecycle      | Passed                                                                                              | Passed                                 |

The real lifecycle smoke test used the real service/runtime and Podman 6.1.4 with isolated
in-memory host state and secrets. Provisioning, authenticated wire readiness, lease/record
ownership, stop/start/reconcile, opposite-preference management and normal deletion passed.
Independent CLI checks confirmed cleanup of the exact test container and volume and
preservation of pre-existing resources. Sample data was disabled.

The smoke test was repeated after the final service corrections: one integration test
passed in 44.11 seconds, captured checking readiness was verified, and the exact test
container/volume and all harness/credential files were confirmed absent afterward.
The temporary browser scenario server was stopped.

The final verification round ran all ten Case 1 + Case 2 commands in sequence and passed.
Earlier lint failures were not counted as green; the final annotation-only correction is
`214f694d4`. Only documentation/reporting and PR provenance were finalized afterward.
The full model/role usage, token breakdown, timing scope and optimization note are in
the [source work-item document](./12-preferred-engine-and-podman-start.md#lead-usage-snapshot).

## Manual checks and remaining operator decisions

1. Native macOS/Windows: initialize a Podman machine, leave it stopped, choose Podman and
   execute setup. Confirm the named start action, output, waiting and cancellation behavior.
   This cannot be live-tested from the WSL extension host.
2. WSL using a Windows-shared Podman socket needs Windows-machine guidance rather than native
   socket guidance. The approved platform gate remains unchanged; connection-specific wording
   is explicitly deferred in the source plan rather than silently added.
3. Human author review of these dispositions and the native-start workflow remains due.
   The PR stays draft even when automated checks are green.
