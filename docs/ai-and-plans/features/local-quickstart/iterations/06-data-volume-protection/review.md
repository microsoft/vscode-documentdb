---
feature: local-quickstart
kind: review
status: active
prs: [958]
created: 2026-09-23
code:
  - src/services/localQuickStart/QuickStartService.ts
  - src/services/localQuickStart/ContainerRuntime.ts
  - src/webviews/documentdb/localQuickStart/LocalQuickStart.tsx
---

# PR #958 review — data volume protection (issue #946)

- **PR:** [#958](https://github.com/microsoft/vscode-documentdb/pull/958) · `fix/quickstart-volume-wipe-946-minimal`
- **Iteration:** [iteration.md](./iteration.md)
- **Reviewed:** 2026-09-23 (runs 1–2, against base `8ee38161`) and 2026-09-24 (run 3, head `50f6be68`
  against base `e0cda766`)
- **GitHub Copilot PR reviewer:** no comments on #958.

## How this review was run

1. **Copilot CLI, run 1** (`gpt-6-astra`, high effort). Focus: is #946 fully addressed, and is the
   UX/behavior change minimal. Three rounds until no new findings.
2. **Copilot CLI, run 2**, same focus. The trade-offs already decided in run 1 were listed in the
   prompt so they would not be re-raised. Two rounds; round 2 returned no findings.
3. **Claude self-review and real-Docker e2e** before the PR was marked ready.
4. **Stage 1 pass per CONTRIBUTING §6.1** on the rebased head: a Claude Opus 5.5 edge-case review
   with mutation testing, then an independent Copilot `gpt-6-astra` sweep. The §6.1 validation gate
   has not been run on these findings.

Copilot could not run tests in either CLI run, so its findings come from reading the source. Runs 1–2
were decided by the author's agent under the review skill's rules; the operator's instruction was
to keep the fix minimal (see the iteration's "Why a second PR").

## Resolved findings (runs 1–3)

| ID    | Source   | Sev | Finding                                                                                         | Verdict  | Resolution                                                       |
| ----- | -------- | --- | ----------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------- |
| C1-1  | run 1 R1 | P1  | Once the gate trips, the failed screen's **Retry setup** silently runs Start fresh              | Valid    | `5d119d12`: label **Start fresh** with the erase warning         |
| C1-2  | run 1 R1 | P2  | Container is removed before the port check and pull                                             | Rejected | Loses no data; moving it needs #952's own-port exception         |
| C1-3  | run 1 R1 | P3  | DATA-3 on the reuse path (foreign container mounts a volume we hold credentials for)            | Rejected | Out of scope; the issue's repro is the no-credentials path       |
| C1-4  | run 1 R1 | P3  | First setup without samples, then recreate with samples, gets none                              | Rejected | Rare; a "seeded" flag would add durable state                    |
| C1-5  | run 1 R2 | P1  | **Continue setup** (after Docker recovers) hides the erase warning                              | Valid    | `5d119d12`: `forcedFresh` takes precedence                       |
| C1-6  | run 1 R2 | P3  | Readiness timeout → Start over keeps credentials but not the volume, so no seed                 | Valid    | `5d119d12`: `reusesVolume = reusing && volumeOnDisk`             |
| C1-7  | run 1 R3 | P3  | Cancel/error cleanup keyed on `!reusing` leaves a new, unseeded volume behind                   | Valid    | `5d119d12`: cleanup keys on `!reusesVolume`                      |
| C2-1  | run 2 R1 | P1  | A volume created during the pull is deleted by a plain setup                                    | Valid    | `5d119d12`: re-check and throw; remove only if on disk           |
| C2-2  | run 2 R1 | P2  | Start fresh wipes, then fails on a port bound during the pull                                   | Rejected | The user already agreed to erase; Copilot accepted on round 2    |
| C2-3  | run 2 R1 | P3  | A fatal `removeVolume` skips the Docker-recovery UI because `activeDockerStage` is set too late | Valid    | `5d119d12`: set `'creating'` before the volume check             |
| E2E-1 | e2e      | P2  | A held volume shows only "Process exited with code 1"                                           | Valid    | `5d119d12` message; reworded and localized in `50f6be68`         |
| E2E-2 | e2e      | P3  | After a failed Start fresh, Configure's button reverts to "Start DocumentDB Local"              | Accepted | One extra click, no data loss; fixing means #952's state restore |

The Start fresh tests were also changed to run with the volume present (`volumeExists: true`), since
with no volume they passed without exercising the removal.

## Open findings (run 3, 2026-09-24)

Decided 2026-09-24. The operator delegated the calls; each was checked against the code and the `@microsoft/vscode-container-client` 0.5.4 source by a Claude Fable 5.1 validation pass. S1, S3 and S4 (with F2) landed in `09502369`.

### F1 — Low — Failed screen says "Delete Container" while its button says Start fresh

`credentialsUnavailable` (`quickStartMessages.ts:27-30`) tells the user to use "Delete Container".
The same screen's button is now **Start fresh**. In the new volume-only case there is no container,
so the text points at an action that isn't on screen. Pre-existing wording; #958's relabel makes the
mismatch visible. No data risk.

- Options:
  1. Give the setup gate its own message key that points at Start fresh. One new l10n string.
  2. Reword the shared key. The tree path has no Start fresh.
  3. Defer to a follow-up issue.
- Recommended: 1 or 3.

**Author decision:** defer to a follow-up issue. Wording only; `deleteContainer()` still removes the volume when no container exists (`QuickStartService.ts:1830-1840`), so the tree command the text names does work. The issue should note the wizard button is Start fresh and the tree command is Delete Container.

### F2 — Low — `volumeExists` echoes every host volume name into the output channel

`ContainerRuntime.ts:271-275` uses the runner's default `echoStdout = true`. Setup lists volumes up to
twice, and the names of unrelated projects' volumes land in the log users paste into issues.

- Recommended: `this.makeRunner([], undefined, false)`. This is the mechanism #951 added for
  `inspect`, and stderr is still logged.

**Author decision:** fix, folded into S4 (`volumeExists` runs with `echoStdout = false`).

### F3 — Low — A recreate doesn't seed a volume the first setup never seeded

This is the deliberate DATA-4 trade-off (C1-4), now stated in `design.md`. Examples: a best-effort
seed failed, or a timed-out container was adopted without Wait longer.

- Recommended: accept.

**Author decision:** accept. The documented DATA-4 trade-off.

### F4 — Low — The failed-screen relabel has no test

`LocalQuickStart.tsx:2293-2314` has no render test. A regression back to "Retry setup" over a
destructive run would not be caught. The wizard has no render-test harness today.

- Recommended: accept for this PR.

**Author decision:** accept. No render-test harness exists.

### S1 — High (Copilot) — Failure cleanup can remove a volume this run did not create

`QuickStartService.ts:981-985` removes the volume when `createAttempted && !reusesVolume`.
`createAttempted` is set before Docker creates anything, and `reusesVolume` comes from the check at
`:763`. Trigger:

1. A plain setup sees no volume at `:763`.
2. Another process creates `vscode-documentdb-local-data`.
3. Our `docker run` fails before creating a container, for example because an unlabelled container
   holds the name.
4. Cleanup removes the unmounted volume.

This is a new destructive path; `main` has no post-failure volume removal. The window is small:
between the check at `:763` and a `docker run` that fails without creating anything.

- Options:
  1. Keep the volume when ownership is uncertain. The smallest safe change, but some retries then
     go through the Start fresh gate.
  2. Establish ownership explicitly, e.g. only remove after `docker run` returned a container ID.
- Copilot recommends failing closed, plus a regression test with a volume that appears and a
  create that fails.

**Author decision:** fix, re-rated Medium. Docker refuses to remove a volume any container references, and moby reserves the container name before it creates named volumes, so a name conflict creates neither; a port-bind failure leaves a container the operation sweep finds. The exposure is only an unreferenced volume created in the window between `:763` and container create. Fix: track `ownsContainer` (true when `containerId` is set or the operation-labelled sweep finds an orphan) and remove the volume only when `ownsContainer && !reusesVolume`. Cost: a rare create that made a volume but no container sends the retry through Start fresh.

### S2 — Medium (Copilot) — Start fresh still wipes before two discoverable blockers

- (a) A port bound during the pull. Same as C2-2, already rejected.
- (b) An unlabelled container holding the name `vscode-documentdb-local`. `findManagedContainer()`
  filters by label, so neither the gate nor Configure sees it. Start fresh removes the volume, then
  `docker run` fails on the name.

Remaining holes in #946's "preflight before destruction", not regressions.

- Copilot recommends a post-pull port re-check and a strict same-name check before the removal.

**Author decision:** reject both. (a) is C2-2. (b): the user chose to erase. Consequence for the record: every retry fails on the same name until the user removes the foreign container by hand (with no ready record the retry skips the gate, since Start fresh already removed the volume); Docker's error names it, and #954 makes that message readable.

### S3 — Low (Copilot) — The cleanup test also passes under the old ordering

`proceeds for a truly-fresh alias and removes the volume its failed create left behind`
(`QuickStartService.test.ts:1716`) asserts one create and one removal, not their order. `main`'s
pre-create removal satisfies it too. This matches the run history: the test failed on `main` after
the first commit but not after the round-2 changes.

- Recommended: assert that the removal follows the failed create, or use a stateful fake that creates
  the volume.

**Author decision:** fix with S1, which breaks this test anyway (`provisionRuntime` shares one `listByLabel` fake between the gate and the sweep). Have the sweep return a container, assert `removeVolume` is called after `createAndRunContainer` via `invocationCallOrder`, and add the S1 regression: a failed create that leaves no container makes no `removeVolume` call. The test cannot model the volume appearing, because cleanup never re-checks it.

### S4 — Medium — Non-strict volume listing can bypass the DATA-1 gate

Found by the validation pass while checking #955, which adds the same `volumeExists` in strict mode.
`ContainerRuntime.makeRunner` hardcodes `strict: false`, and in `@microsoft/vscode-container-client`
0.5.4 `strict` only controls parsing. `parseListVolumesCommandOutput` silently drops a row that fails
its schema. The Docker CLI's rows always parse, but Podman behind a `docker` shim emits `Labels` as a
map, so the row is dropped and `volumeExists` returns false at both `:706` and `:763`. Setup then runs
new credentials against the old volume and readiness times out. The volume survives the timeout, but
Start over removes it, as does a Cancel during the initial attempt, even with the S1 fix, because a container existed. A non-zero exit still rejects, so only the parse path fails open.

The makeRunner comment that `strict` concerns stderr warnings is stale.

**Author decision:** fix. Add a `strict` parameter to `makeRunner` and call
`this.makeRunner([], undefined, false, true)` in `volumeExists`, which also covers F2. A bad row then
fails setup instead of wiping. #955 makes the same change with a different signature; whichever PR
merges second resolves the conflict.

## Verification

- Run 3, Claude: 20 suites / 362 tests passed in `src/services/localQuickStart` and
  `src/webviews/documentdb/localQuickStart`.
- Run 3, Copilot sweep: 99 tests passed.
- Mutations, run in a disposable worktree against `QuickStartService.test.ts` and
  `QuickStartProvisionDurability.test.ts`:

| Mutation                                      | Result   |
| --------------------------------------------- | -------- |
| `QuickStartService.ts` reverted to `e0cda766` | 6 failed |
| Gate without `volumeExists`                   | 2 failed |
| No mid-pull volume check                      | 1 failed |
| Seed even when reusing                        | 1 failed |
| Swallow the volume-removal failure            | 1 failed |
| Cleanup never removes the created volume      | 1 failed |

- Not run in the review: real Docker (see the iteration's Outcome for the e2e), Windows, the webview.
