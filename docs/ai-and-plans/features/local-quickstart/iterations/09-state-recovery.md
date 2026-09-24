---
feature: local-quickstart
kind: iteration
status: active
prs: [955]
created: 2026-09-24
code:
  - src/services/localQuickStart/QuickStartService.ts
  - src/services/localQuickStart/QuickStartDiagnosticsProvider.ts
  - src/services/localQuickStart/quickStartTypes.ts
  - src/webviews/documentdb/localQuickStart/LocalQuickStart.tsx
  - src/webviews/documentdb/localQuickStart/localQuickStartRouter.ts
---

# 09 — State that matches Docker after a crash, Start over or outside changes

> The instance record, lease and stored credentials were not cleared or re-read when the container
> went away some other way, so the tree and the wizard described an instance that no longer existed.
> Fixes the seven bugs in issue #950.

**Branch:** `dev/guanzhousong/quickstart-state-recovery-950` · **Issue:** #950 · **PR:** #955

Written on 2026-09-24, while the PR is open. No plan document preceded it: the issue's **Expected**
notes were the plan, and are quoted below. Reasons that no commit, code comment or PR text records
are marked _(inferred)_.

`0a07272f` _Fix Quick Start state after a crash, Start over or outside changes_ carries all seven
items. It was written against `fa7bcbf5` as `6ebed743`, then rebased onto `main` after #958, #954 and
#953 merged; see [Rebase onto #958 and #953](#rebase-onto-958-and-953).

## Why

Found testing v0.10.2 on WSL2 with Docker Desktop 29.8, image 0.117.0.

| ID      | Sev | Bug                                                                                                                           |
| ------- | --- | ----------------------------------------------------------------------------------------------------------------------------- |
| STATE-1 | P2  | After the password is lost, deleting the container and volume outside VS Code keeps the instance CredentialsMissing for good  |
| STATE-2 | P2  | Extension host dies between `docker run` and the secret write: orphan container, Provisioning for 20 min, then Set up refused |
| STATE-3 | P2  | Start over after a readiness timeout leaves the password and lease; a reload shows Provisioning with nothing behind it        |
| STATE-4 | P2  | On WSL + Docker Desktop, Start reports Running while another process holds the port                                           |
| STATE-5 | P3  | Wait longer is still offered after Delete                                                                                     |
| STATE-6 | P3  | "Your data is preserved" is shown when the volume was deleted too                                                             |
| STATE-7 | P3  | Container removed while VS Code was closed: the tree offers Set up instead of Recreate/Delete                                 |

## The one decision: refresh only changes what is shown

**Plan (#950, STATE-1).** "With no container and no volume, clear the record and treat it as a fresh
setup."

**Deviation.** Refresh never deletes the record or the credentials. When the container and the
volume are both gone, the instance is marked `dataRemoved`: the tree shows it as not set up, and
Configure explains why. Docker pointed at another engine or context looks exactly the same, and
deleting on refresh would lock the user out of their data once they switched back.

Setup then treats it as new. It keeps the stored credentials unless the user sets custom ones, so
the original engine's instance still opens after a switch back. With custom ones, the old record
stays until setup succeeds. The new credentials are saved just before `docker run` and put back if
the run fails or is cancelled; only a crash mid-run leaves the new ones.

| Option                                               | Verdict                                                                             |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Delete the record and secret on refresh              | Rejected. A Docker context switch would cost the user their credentials.            |
| Show as not set up; setup decides, keeping the creds | **Chosen.** Nothing is lost until the user acts, and the wizard says what happened. |

## STATE-1 — Stuck in CredentialsMissing

**Done.** Setup's safety check lets a `ready` record through when both its container and its volume
are gone, instead of refusing with `credentialsUnavailable`. Refresh re-checks a CredentialsMissing
instance and moves it to not set up once its container and volume are both gone, so Configure no
longer warns about erasing data that is not there.

## STATE-2 — A crash between `docker run` and the secret write

**Plan (#950).** "Write the secret before `docker run`. Or, on activation, remove a container whose
operation label matches the expired lease and has no secret."

**Done, first option.** The credentials are stored right before `docker run`, after anything that
removes the previous instance. A host killed once the container exists now leaves a container a
reload adopts.

Moving the write earlier had two consequences the PR also handles:

- The loser of a two-window create race now reaches the restore. `rollBackAttempt` puts back the
  previous credentials and releases the lease only while the stored value is still this run's own.
  A recreate reuses the stored credentials, so an equal value is no proof of that: when another
  window has replaced the kept container, Start over skips the rollback and adopts that container.
- `reconcile()` skips an alias with an operation running in this window. Otherwise a reconcile
  mid-provision adopts the run's own half-made container.

**Second option not taken.** _(inferred)_ It deletes a container that, with the secret written
first, a reload can simply adopt.

## STATE-3 — Start over left the secret and lease behind

**Plan (#950).** "Also delete the secret and the record, or restore the previous secret the way the
failure path does."

**Done, second option.** `discardTimedOutInstance` runs the same `rollBackAttempt` as a failed
attempt, then re-derives the instance's state. A fresh attempt returns to not set up with its
credentials, lease and volume gone. A recreate keeps its data and previous credentials and settles
as Missing.

Two additions:

- If Docker cannot remove the container, Start over keeps everything, starts the container again so
  Wait longer still has something to wait for, and says so. Dropping the credentials there would
  leave a container nothing can open once Docker answers.
- A failed removal counts as "already gone" only when a lookup succeeds and finds no container with
  that id or name. A replacement another window created is adopted instead, and its volume and
  credentials are left alone.

## STATE-4 — Start reported Running on a port another process held

**Plan (#950).** "Start (and Restart) run the same `isPortFree` pre-check that Set up uses, and fail
with `portInUse`."

**Done.** Start and Restart run setup's port check and leave the instance stopped when the port is
taken. Restart checks only after its stop, because until then the container itself holds the port.
The check retries three times, 500 ms apart, because Docker Desktop frees a stopped container's port
a moment after `docker stop` returns.

**Deviation: a notification, not `portInUse`.** _(inferred)_ Start and Restart are tree actions, not
wizard stages, so there is no stage to carry the message key. Each has its own wording: "was not
started because port N is already in use" and "was stopped but not started again because port N is
in use".

## STATE-5 — Wait longer after Delete

**Done.** Delete clears the retained readiness state. The wizard's status subscription drops the
timed-out view when that state goes away while the instance is not in Error. Start over with nothing
left to discard now returns to setup instead of doing nothing.

## STATE-6 — "Your data is preserved" when it was not

**Done.** Before promising the data back, the missing-container path checks the volume. With the
volume gone too, the notification says the container and its data were removed and offers **Set up
DocumentDB Local**. The connection diagnostics and the wizard's Missing notice no longer promise the
volume is reused. The notice now reads "no longer exists" rather than "was removed outside VS
Code", because Start over on a recreate lands there too.

## STATE-7 — Set up offered instead of Recreate/Delete after a restart

**Plan (#950).** "Hydrate `metadata` from the `ready` record when the container is missing, or render
the missing row from `status.missing` alone."

**Done, first option.** Reconcile rebuilds the metadata from the record and the stored credentials.
The container id went with the container, so the metadata uses the container name. Two neighbouring
cases are now decided here too: a `ready` record without stored credentials is CredentialsMissing up
front, rather than refused after the Set up click, and one whose volume is gone is `dataRemoved`.

## Rebase onto #958 and #953

#958 (issue #946) merged first. It added the same strict `volumeExists`, moved setup's volume removal
to after the port check and the pull, and made a bare volume block setup like a record does. The
conflicts were resolved like this:

- `ContainerRuntime.volumeExists`: #958's version. It was the same strict listing.
- Setup's safety check: #958's rule stays (a container, a `ready` record or a volume this profile
  cannot open blocks setup), with this PR's exception for a record whose container and volume are
  both gone.
- This PR's early volume removal was dropped; #958's removal after the pull covers it.
- The credential write moved to after #958's removal. Written before it, a Start fresh would delete
  the credentials it had just stored and, on failure, restore the old ones for erased data.
- Once Start fresh has erased the old data it drops the old record and takes the provisioning lease.
  Before the rebase this happened by ordering; #958 moved the removal past the lease step.
- Test fakes keep #958's default of no volume. Tests of an instance whose data is still there now
  say so explicitly. One PR test ("a timed-out recreate is not reported Running") passed only by
  accident under that default and was fixed, and a test for a successful Start fresh was added.

#953 (issue #949) merged next. Its only conflict: it stopped trimming custom credentials before
deciding whether the user set them. This PR's `wantsCustomCredentials` follows it, so both checks
agree.

# Outcome

**Verified.**

- Before the rebase, the PR's code quality check (l10n, ESLint, Prettier) passed on `6ebed743`.
- After the rebase onto #953: `tsc --noEmit`, ESLint and `l10n:check` are clean, and the 627 tests in
  the Quick Start service, webview and tree suites pass. The full Jest run passes except `injectStyles` in
  `packages/vscode-ext-webview-fluentui`, a jsdom failure in a package this PR does not touch.
- Each STATE item has a unit test driving `provision()` or the lifecycle methods through a fake
  runtime.
- The local review (Claude, R1–R5) drove the service against Docker Desktop 29.8 on macOS, stubbing
  only the image pull and the Docker readiness check. A setup abandoned right after `docker run` is
  adopted as Running by the next reconcile (STATE-2). Start with the port held leaves the container
  stopped and names the port (STATE-4). A removed container with its volume kept shows Missing; with
  the volume gone too it shows as not set up, record and credentials kept (STATE-1, STATE-6). With
  the daemon unreachable, refresh and reconcile change nothing. Once the container and volume are
  back, the DocumentDB Local node's Refresh adopts them again. The port was free within 1 ms of
  `docker stop` there, so the retry was not needed.

**Not verified.**

- STATE-4 on WSL + Docker Desktop. That the port frees late there, which the retry allows for, is
  the author's account.
- A real second Docker engine or context. The switch back was simulated by recreating the container
  and volume on one daemon.
- The open wizard leaving its timed-out view after Delete (STATE-5). Traced in code only.
- Windows.

**Left open.**

- A record and credentials whose container and volume are gone stay stored until the user runs setup
  or Delete. This is deliberate (see the decision above).

# Lessons for the next change to Quick Start state

- **"Gone" from Docker is ambiguous.** A deleted volume and a Docker pointed somewhere else answer the
  same way. Show the state; delete only on a user action.
- **Moving a durable write earlier changes who reaches its rollback.** Writing the secret before
  `docker run` fixed STATE-2 but let a losing window's rollback run too, so the rollback now checks
  the stored value is still its own.
