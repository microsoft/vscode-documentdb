---
feature: local-quickstart
kind: iteration
status: active
prs: [958]
created: 2026-09-23
code:
  - src/services/localQuickStart/QuickStartService.ts
  - src/services/localQuickStart/ContainerRuntime.ts
  - src/services/localQuickStart/QuickStartService.test.ts
  - src/services/localQuickStart/QuickStartProvisionDurability.test.ts
  - src/webviews/documentdb/localQuickStart/LocalQuickStart.tsx
---

# 06 — Setup never wipes data before it can succeed (issue #946)

> Setup removed the `vscode-documentdb-local-data` volume before the port check and the image pull,
> and removed it even when this profile had no record of it. The fix moves the removal to just before
> `docker run`, and puts a volume this profile can't open behind the existing Start fresh gate.

- **Issue:** [#946](https://github.com/microsoft/vscode-documentdb/issues/946) (DATA-1 to DATA-4)
- **PR:** [#958](https://github.com/microsoft/vscode-documentdb/pull/958) · `fix/quickstart-volume-wipe-946-minimal`
- **Supersedes:** [#952](https://github.com/microsoft/vscode-documentdb/pull/952), closed unmerged
- **Review record:** [review.md](./review.md)

## Why

Issue #946, found on v0.10.2 against DocumentDB Local 0.117.0:

| ID     | Sev | Bug                                                                                                  |
| ------ | --- | ---------------------------------------------------------------------------------------------------- |
| DATA-1 | P1  | A plain **Set up** force-deletes an existing data volume it has no record of                         |
| DATA-2 | P2  | **Start fresh** deletes the container and volume, then fails on a busy port or a bad tag             |
| DATA-3 | P3  | A volume mounted by a foreign container is silently shared, because the removal error is eaten       |
| DATA-4 | P3  | The "already seeded" check looks for `sampledb`; 0.117 seeds `StoreData`, so every recreate re-seeds |

One root cause covers DATA-1 and DATA-2. `provision()` pre-cleaned the volume
(`QuickStartService.ts:716-727` on `main`) before the port check and the pull. It was gated on
"no managed container and no `ready` record" on the assumption that such a volume could not exist.
It can: `docker container prune` keeps volumes, and another VS Code profile, Insiders vs Stable, a
reinstall or lost `globalState` all leave a volume with no record.

## Why a second PR

[#952](https://github.com/microsoft/vscode-documentdb/pull/952) fixed all four bugs in 9 files,
+972/−148. Besides the fix it:

- detected a leftover volume at reconcile time, so the tree showed "Review setup" before any click
- restored the exact pre-run tree state after a failed or cancelled run (`settleFailure`)
- added a "Review setup" failed-screen footer (`lastRunStartFresh`)
- added a holder pre-check naming the container that mounts the volume (`listContainersUsingVolume`)
- re-checked the port after the pull (`isPortAvailable`)
- added new message keys and a "Kept from the existing instance" sample-data row

The operator closed it on 2026-09-23 and restarted from `main`:

> I want to fix this issue, but the UI/UX/behavior change should be minimal, less change the
> better. And I want you remind you this feature is to let user TRY documentdb quickly, not a
> production db or serious use case.

The whole bug comes down to one mistake: `provision()` deletes data before it knows setup will
succeed. Most of #952 hardened edge cases that a try-it tool does not need. #958 at `50f6be68` was +228/−96 over
8 files, two of them docs.

**Rejected: skip the DATA-1 gate and keep deleting a leftover volume, only later.** Smaller still,
but the issue's stated expectation is "never delete a volume this run didn't create". The agent
recommended keeping the gate and the operator accepted.

## Work items

Commit hashes are post-rebase (the branch was rebased onto `e0cda766` on 2026-09-24). The
pre-rebase hashes appear in PR comments: `d384ac4a` → `c1664319`, `d0ad8a7c` → `5d119d12`,
`8527c82b` → `50f6be68`.

### 1. Move the volume removal to just before `docker run` (DATA-2)

Plan: a pure move of the existing `removeVolume` from before the port check to after the pull.

**Done.** `c1664319` Quick Start: never wipe data before setup can succeed (#946). The removal now sits
after `writeEnvFile`, a `throwIfAborted`, the port check and the pull
(`QuickStartService.ts:775-791`). `5d119d12` later made it run only if the volume is actually on disk. A failed port check,
pull or Cancel before that point leaves the volume untouched.

**Kept: the container is still removed before the port check.** Its removal loses no data (the volume
and credentials survive), and the port pre-check relies on our own container being gone. Moving it
would need a "port held by our own container" exception, which is #952's `isPortAvailable`.
Copilot raised this in both review runs; it was rejected both times.

**Deviation: a failed removal is now fatal (DATA-3).** The plan skipped DATA-3 as unlikely for a
try-it tool. Once the removal was the last step before `docker run`, swallowing its error meant new
credentials starting against the old cluster. Docker refuses to remove a volume another container
mounts, so making the error fatal covers the issue's DATA-3 repro without #952's holder pre-check.
Rejected: #952's `listContainersUsingVolume` pre-check, because it adds a Docker call and a message
key to name a container that Docker's own error already names.

**Deviation: a volume that appears during the pull stops a plain setup.** Found by the second Copilot
run: the gate saw no volume, but one existed by the time of the removal, and a plain Set up would
have removed it. `5d119d12` re-checks right before removal and throws unless Start fresh was chosen
(`QuickStartService.ts:763-771`). Rejected: #952's `VolumeAppearedError` mapping to
`CredentialsMissing`, because a plain error and Back cover this rare case without a new state path.

### 2. Put a record-less volume behind the existing gate (DATA-1)

Plan: add `volumeExists()` to the gate as a third condition, so the flow is `main`'s own
`credentialsUnavailable` → `CredentialsMissing` → Start fresh. No new UI.

**Done.** `c1664319`. `ContainerRuntime.volumeExists()` lists volumes and rejects when Docker can't
answer, so a Docker error is never read as "absent" (`ContainerRuntime.ts:271-275`). The gate is
`existing || hasReadyRecord || volumeExists` (`QuickStartService.ts:706`).

Required side piece: a fresh run that fails after `docker run` would otherwise leave behind a volume
that trips the gate on the user's own retry. The `finally` block removes a volume this run's
`docker run` created (`:981-985`), and Docker refuses to remove a volume a container still references, even with `--force`.

**Deviation: the failed-screen button is relabelled.** The plan said no UI change. Copilot run 1 (P1)
showed that once the gate trips, the instance is `CredentialsMissing`, so `forcedFresh` is true, and
the failed screen's **Retry setup** silently ran a Start fresh. The label was fine before the gate;
the gate made it destructive. `5d119d12` shows **Start fresh** with Configure's erase warning
(`LocalQuickStart.tsx:2293-2314`), and `forcedFresh` takes precedence over **Continue setup** (run 1,
round 2). Both strings already existed. Rejected: #952's "Review setup" footer plus a
`lastRunStartFresh` flag, because it adds a button and state where a truthful label is enough.

### 3. Seed only into a new volume (DATA-4)

Plan: seed when not reusing; delete `sampleDataExists` and the `sampledb` constant.

**Done.** `c1664319`. The rule no longer depends on the database name the image uses.

**Deviation: key it on the volume, not the credentials.** Copilot run 1 (round 2) showed that retained
credentials don't prove the volume survived: Start over after a readiness timeout removes the volume
but keeps credentials, so `!reusing` skipped the seed on a brand-new volume. `5d119d12` adds
`reusesVolume = reusing && volumeOnDisk` (`:774`), which drives seeding (`:870`, `:1076`), failure
cleanup (`:981`, round 3) and Start over (`:1242`). An interim version treated a Docker error during
that check as "exists"; it was replaced by the strict check, so a Docker error fails setup instead.

**Accepted consequence.** A first setup without samples, followed by a recreate with samples, gets
no samples. Rejected: a durable "seeded" flag on the instance record, which adds persisted state and
migration for a rare case. `design.md` now states this rule.

### 4. Wording, localization and docs (maintainer)

**Done.** `50f6be68` Clarify and localize Quick Start data-protection errors (Tomasz Naumowicz). The
e2e-driven removal message in `5d119d12` said "remove that container and try again"; it now says to
check whether another container uses the volume, and never suggests deleting one. Both new errors
are `l10n.t()` strings. Added the test `explains a failed volume removal without suggesting that
another container be deleted`, the README "Existing data is preserved" constraint, and corrected
`design.md`'s seeding text.

### 5. Close the gaps from the 2026-09-24 review

Not in the original plan. The run-3 review ([S1, S3, S4](./review.md#open-findings-run-3-2026-09-24))
found two ways the fix could still remove a volume it didn't create.

**Done.** `09502369` Quick Start: keep volumes setup can't prove it created.

- **S1.** Failure cleanup removes the volume only when this run got a container: `docker run` returned
  an ID, or the operation-labelled sweep found one. Before, `createAttempted` alone was enough, so a
  failed `docker run` that created nothing could remove a volume another process made after the last
  check. Rejected: re-checking the volume in cleanup, since existence says nothing about who made it.
- **S4.** `volumeExists` parses strictly and no longer echoes the volume list (F2). Non-strict parsing
  drops rows that don't match the schema (Podman behind a `docker` shim), which read as "absent" and
  bypassed the gate. `makeRunner` gains a `strict` parameter; its comment claimed `strict` was about
  stderr, which was wrong.
- **S3.** The cleanup test now has the sweep return a container and asserts the removal follows the
  failed create. A new test covers a failed create with no container: the volume is left alone.

Mutation check: restoring the `createAttempted` condition fails the new test. No test pins strict
parsing; it would need a fake of the container-client runner.

**Accepted residual race (Copilot, 2026-09-24).** A container does not prove the volume is ours
either. If another process creates the volume between the check at `:763` and `docker run`, our
container mounts it, and a Cancel afterwards removes both. Closing it needs volume ownership, for
example creating the volume with this run's operation label before `docker run`. That is a new
runtime API and more state for a millisecond window that needs another process creating this exact
name. Rejected for this PR.

# Outcome

**Verified.**

- The new tests for DATA-1, DATA-2 and DATA-4 fail on `main`. With `main`'s `QuickStartService.ts` and
  `ContainerRuntime.ts`, 5 of 257 Quick Start tests failed:
  - `never wipes a data volume it has no record or credentials for`
  - both cases of `keeps the data volume when "Start fresh" fails because %s`
  - `leaves alone a data volume that appeared while the image downloaded`
  - `does not seed a reused data volume`
- Mutation run at `50f6be68`. Reverting `QuickStartService.ts` fails 6 tests. Each of these fails 1–2:
  gate without `volumeExists`, no mid-pull check, seeding a reused volume, swallowing the removal error,
  no cleanup of a created volume.
- After `09502369`: 20 suites / 363 tests in `src/services/localQuickStart` and
  `src/webviews/documentdb/localQuickStart`, `tsc` (no `src/` errors) and ESLint pass.
- Tomasz ran the full local suite at `8527c82b` (275 suites, 4,218 tests, 4 snapshots) plus l10n,
  lint, build and package. After the rebase, 273 Quick Start tests and `tsc` passed; CI is green.
- Real Docker, 43/43 checks, at `d0ad8a7c`-era code. The setup was macOS arm64, image
  `documentdb-local:latest`, and stable VS Code over CDP with fresh profiles.

| Scenario                                                        | Result                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------- |
| Leftover volume with a marker, plain Set up (DATA-1)            | Refused before the pull; marker intact; button is Start fresh |
| Start fresh, port 10263 busy (DATA-2)                           | Fails; marker intact                                          |
| Start fresh, tag `0.117.0-nope` (DATA-2)                        | Fails; marker intact                                          |
| Start fresh while another container mounts the volume (DATA-3)  | Stops; marker intact; holder still running                    |
| Start fresh succeeds                                            | Old data erased; samples seeded once                          |
| Recreate onto a kept volume after dropping `StoreData` (DATA-4) | `StoreData` not restored; user data kept                      |
| Credentials kept, volume gone                                   | Seeds into the new volume                                     |
| Cancel after `docker run`                                       | Removes only its own volume; retry succeeds                   |
| Volume created during the pull                                  | Setup stops; volume survives                                  |

The e2e found the raw "Process exited with code 1" on a held volume, fixed in `5d119d12`.

**Not verified.**

- Windows/WSL, the platform in the issue.
- Tomasz's reworded messages under real Docker.
- Docker dying between the gate and the removal.
- The **Continue setup** → Start fresh label after a Docker recovery; it is covered only by code reading.
- Readiness timeout followed by Start over.
- The failed-screen relabel has no test; the wizard has no render-test harness.

**Left as is.**

- After a failed Start fresh, Configure's button reverts to "Start DocumentDB Local". It costs one
  extra click and no data. Fixing it means tracking and restoring instance state, the complexity cut
  from #952.
- A port bound during the pull still fails a Start fresh after the wipe. The user already agreed to
  erase that data, and the issue's DATA-2 repro (port busy before setup) is covered.
- Open review findings are listed in the [review record](./review.md).
- [#956](https://github.com/microsoft/vscode-documentdb/issues/956), a removed container showing "Set
  up" after a reload, predates this work. [#955](https://github.com/microsoft/vscode-documentdb/pull/955)
  fixes it (STATE-7).
