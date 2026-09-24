---
feature: local-quickstart
kind: iteration
status: active
prs: [954]
created: 2026-09-24
code:
    - src/services/localQuickStart/dockerCommand.ts
    - src/services/localQuickStart/ContainerRuntime.ts
    - src/services/localQuickStart/QuickStartService.ts
    - src/services/localQuickStart/quickStartMessages.ts
    - src/services/localQuickStart/DockerReadinessService.ts
    - src/services/localQuickStart/dockerReadinessClassification.ts
    - src/webviews/documentdb/localQuickStart/dockerReadinessPresentation.ts
---

# 07 — Setup failures explained instead of exit codes

> Docker's own error now reaches the user, the readiness wait stops as soon as waiting cannot help,
> and a hung `docker run` is bounded and actually killed. Fixes the five bugs in issue #948.

**Branch:** `dev/guanzhousong/quickstart-setup-failures-948` · **Issue:** #948 · **PR:** #954

Written after the work, on 2026-09-24. No plan document preceded it: the issue's **Expected** notes
were the plan, and are quoted below as written. Reasons that no commit, code comment or PR text
records are marked _(inferred)_. The branch is rebased onto `main` after #958 merged, and hashes are
the rebased ones; the PR thread cites `2ea0f7f9` by its old hash, `21f018ff`. In the rebase, the
create stage keeps #958's data-volume check ahead of it.

`88473791` _Explain Local Quick Start setup failures instead of exit codes_ carries all five items.
Later commits are named at the item they changed.

## Why

Found testing v0.10.2 on WSL2 with Docker Desktop 29.8, image 0.117.0.

| ID    | Sev | Bug                                                                                                                               |
| ----- | --- | --------------------------------------------------------------------------------------------------------------------------------- |
| ERR-1 | P2  | Every Docker CLI failure during pull/create is reported as `Process exited with code N`. `isPortAllocationFailure` never matches. |
| ERR-2 | P2  | Readiness keeps retrying for 180 s when the container is dead or auth is rejected, then offers Wait longer                        |
| ERR-3 | P3  | No deadline on the creating stage. Cancel leaves the `docker container run` CLI process orphaned.                                 |
| ERR-4 | P2  | Docker CLI not installed (Linux/WSL) is reported as "Docker daemon unreachable"                                                   |
| ERR-5 | P3  | A temp dir containing `'` breaks `docker run`: `Process exited with code 2`                                                       |

## ERR-1 — Docker's stderr never reached the user

**Plan (#948).** "Capture stderr for pull and create the way `dockerProbes.ts` `CapturingTeeWritable`
already does for probes. Then the port case maps to `portInUse`, and the others show Docker's first
error line."

**Done in `88473791`.** Pull, run and start go through a new runner, `runDockerCommand`. A non-zero
exit rejects with `DockerCommandError`: its message is Docker's first error line, and its `stderr`
keeps the rest with secrets masked. `isPortAllocationFailure` now reads that stderr, so a port taken
mid-pull lands on `portInUse`, and a name clash or a paused container shows Docker's own line.

Two additions the plan did not ask for:

- `imageNotFound` names the tag and sends the user to Configure, but only for a tag the user typed.
  For the default image there is nothing to fix in Configure, so Docker's line stands. A bare "not
  found" does not count: a missing credential helper also says "executable file not found".
- The image ref goes into the stage's telemetry `valuesToMask`, because Docker's error lines quote
  the tag the user typed.

**Deviation: a new runner, not a stderr tee on the library runner.** The tee the issue points at
would have fixed this item on its own; the probes already do it. It could not fix ERR-3: the library
runner exposes neither stderr nor the child's pid, and `docker run` ignores the SIGTERM its
tree-kill sends. One runner that keeps stderr, takes a deadline and escalates to SIGKILL covers both.

**`ebc655df`** _Keep healthy Docker re-check output out of the setup log._ After a Docker-stage
failure, setup re-checks readiness to tell "Docker went away" from a failed command. The re-check
now suppresses the command echo, so a healthy `docker info` dump no longer buries the real error.

**`4785ba09`** _Stub runDockerCommand in the output-channel echo test._ The rebase brought in #951's
`ContainerRuntime.test.ts`, which fakes the library runner. Commands that now go through
`runDockerCommand` bypassed that fake, so the test stubs the new runner as well.

## ERR-2 — A dead container or refused credentials waited out 180 s

**Plan (#948).**

- "Inspect the container between attempts. If it has exited, fail at once with the exit code and
  the last log lines."
- "Treat auth and SASLprep errors as terminal."
- "Offer Wait longer only when the container is running and the error is still connection-level."

**Done in `88473791`.** `waitForReadiness` inspects the container after every failed probe (quiet,
cancellable, 10 s bound). An exited container ends the wait as `containerExited`, with the exit code
and the entrypoint's last `ERROR`/`FATAL` line. A SASLprep rejection ends it as
`passwordNotSupported`, a server refusal (code 18) as `credentialsRejected`. A timeout, and its Wait
longer, now only means the container is up but not yet accepting connections.

`ReadinessFailedError.message` is only the message key: the user-facing reason can quote a custom
username, and error messages reach telemetry.

**Deviation: a server refusal has to repeat before it is final.** SASLprep fails on the client and
cannot change, so it is final at once. A server refusal is final on the second consecutive attempt,
in case an image starts its gateway before the user exists.

**Deviation: one log line, not "the last log lines".** Only a line that starts with the severity
counts: a healthy gateway also logs timestamped `ERROR` lines (a dropped IPv6 probe) that would
misexplain a `docker kill`. The full tail is already in the setup log, which streams the container's
output during the wait.

**Deviation: failing fast when Docker goes away mid-wait was built, then taken out.** `88473791`
also ended the wait when the inspect failed and a readiness re-check said Docker was gone, keeping
the container and its saved credentials. `799e9d25` _Keep Quick Start setup changes to what #948
needs_ removed it: a failed inspect means "keep waiting", as before.

| Option                                        | Verdict                                                                                                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fail fast and discard, like any other failure | Rejected in `88473791`. Teardown cannot reach the container, and dropping its credentials leaves it unopenable once Docker is back.                 |
| Fail fast, keep the container and credentials | Built in `88473791`, removed in `799e9d25`. It means deciding what to do with a container and credentials we cannot reach, which #948 does not ask. |
| Keep waiting, as before                       | **Chosen.** Docker vanishing mid-wait still ends in the 180 s timeout and Wait longer.                                                              |

**Deviation: credential messages follow what Configure can still edit.** `88473791` switched to
`savedCredentialsRejected` when setup reused existing data. `799e9d25` widened it: after Wait longer
it always applies, because the timeout that led there kept the credentials and data, and Configure
then hides the credential fields. `passwordNotSupported` switches the same way.

**Wording, `2ea0f7f9`** _Align Quick Start failure guidance with the wizard_, pushed by the
maintainer during review. Sign-in failures read "We could not sign in…". The saved-credentials
message names the Configure option, "Erase the existing data and start empty", and warns that it
permanently deletes all data. `containerExited` ends with "View the setup log for details."

## ERR-3 — A hung `docker run` hung setup, and Cancel orphaned it

**Plan (#948).** "A create-stage deadline with a clear message, and on cancel, kill the child if it
doesn't exit."

**Done in `88473791`.** `docker run` gets 90 s, then `createTimedOut`: try again, choose another
port, or restart Docker. On the deadline or on Cancel, the runner sends SIGTERM to the whole process
group, SIGKILL after 3 s, and settles only once the process is gone. It targets the group rather
than the shell, because the shell can die on SIGTERM while the `docker` it started keeps the output
pipes open. Windows uses `taskkill /T /F`.

**Deviation: fewer commands are bounded.** `88473791` gave every start, stop, remove, volume remove
and listing a 60 s bound, since setup's cleanup runs them right after a timed-out `docker run`,
against the same daemon, and unbounded they would keep setup from ever reporting the timeout.
`799e9d25` narrowed that to the cleanup after a timed-out create; Start, Stop and Delete keep no
deadline, as before. The recorded reason is scope: only what #948 needs.

## ERR-4 — A missing CLI reported as "daemon unreachable"

**Plan (#948).** "Treat the shell's exit 127 as 'CLI missing', so the user gets `dockerCliMissing`
and the install guidance."

**Done in `88473791`.** `ENOENT`, `sh`'s 127 and `cmd.exe`'s 9009 all mean "CLI missing", in both
the readiness service and the failure classifier.

**Addition: WSL gets its own install guidance.** Docker Desktop's WSL integration being off looks
exactly like no Docker at all, so the guidance names it before suggesting Docker Engine.

## ERR-5 — An apostrophe in the temp dir broke `docker run`

**Plan (#948).** "Escape `'` as `'\''` before handing the path over, or write the env file under a
directory whose path we control."

**Done in `88473791`**, with the first option. Every Quick Start Docker command, the readiness probes
included, now runs through a shell whose `quote()` closes the quote around each apostrophe
(`'it'\''s'`). `Bash.quote()` wrote `'it\'s'`, which bash rejects.

**Second option not taken.** _(inferred)_ The quoting fix covers every strong-quoted argument, not
only the env-file path, and any directory we pick still sits under a home directory that can
contain `'`.

## Not in the issue: lifecycle failures raise a notification

**Done in `88473791`.** A failed Start, Stop, Restart or Delete, or a container that exits right
after Start or Restart, now shows an error notification with **View setup log**. Before, the tree
row only turned to Error and the reason was visible nowhere. This is new UI surface, called out in
the PR. It is also how the issue's paused-container repro now explains itself.

**Wording, `2ea0f7f9`.** "We could not start DocumentDB Local: … View the setup log for details.",
and likewise for the other operations.

# Outcome

**Verified.**

- CI was green before the rebases (`eb226eb9`): build and package, lint, Prettier and l10n, unit
  and integration tests. After rebasing onto `main` with #958: `npm run build`, `npm run lint` and
  the 21 Quick Start suites (408 tests) pass locally.
- The maintainer ran the full local ladder at `21f018ff` (now `2ea0f7f9`): l10n, Prettier, lint,
  276 suites / 4,257 tests / 4 snapshots, build, package.
- The runner tests spawn real child processes through a real shell. They cover stderr kept and
  masked, an apostrophe path passing through intact, and a child that ignores SIGTERM being killed
  on the deadline, on Cancel, and when the shell exits but leaves it holding the pipes.
- The stderr fixtures for the four ERR-1 repros are verbatim Docker 29.8 output.

**Not verified.**

- Windows: `cmd.exe` quoting, exit code 9009, and `taskkill`. CI is Ubuntu-only and the runner tests
  skip on `win32`.
- The WSL install guidance on a real WSL host.
- End-to-end re-runs of the issue's repros against a Docker daemon are not recorded on this branch.
  _TODO (author): list the ones re-run, or say none were._

**Left open.**

- Docker vanishing mid-wait still ends in the 180 s timeout and Wait longer (ERR-2).
- A paused container still shows as Stopped in the tree; only Start now says why.
- Configure should refuse the values behind ERR-2's repros (a reserved username, an emoji password, a
  64-character username). Tracked in #949.

# Lessons for the next change that shells out to a CLI

- **A shell in between changes what failure looks like.** A missing binary is exit 127 (9009 on
  `cmd.exe`), never `ENOENT`, and a signal sent to the shell does not reach the process it started.
  ERR-3 and ERR-4 were both this.
- **Mock the error the dependency actually throws.** `isPortAllocationFailure` shipped dead: the real
  runner rejected with a bare exit code, while the only test mocked an error whose message already
  held Docker's text. The new test rejects with `DockerCommandError` and the stderr Docker 29.8
  actually prints.
