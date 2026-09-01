---
name: backport
description: Backport changes (the current branch, a PR, another branch, or specific commits/SHAs) onto a target branch — typically a short-lived release branch such as `release/0.10.1`. Use when the user says "backport this", "backport PR #123", "cherry-pick to <branch>", or asks to port commits onto a release branch. Handles stashing uncommitted work, branch creation, cherry-picking with conflict handling, validation, pushing, and opening the PR.
---

# Backport Skill

Create a backport pull request that applies changes from a source (the current branch, a PR, another branch, or specific commits) onto a target branch — interactively, from the local workspace.

> Adapted for this repository from the `backport` skill in [microsoft/vscode-cosmosdb](https://github.com/microsoft/vscode-cosmosdb/blob/main/.github/skills/backport/SKILL.md). See [Credit](#credit).

## Before anything: is a backport the right move here?

This repository is **tags-first** ([CONTRIBUTING §1.3](../../../CONTRIBUTING.md#13-releases)). A release is a tag on `main`, and most of the time **no release branch exists at all**. That changes when a backport is appropriate:

- **Normal patch flow — not a backport.** A `release/<X.Y.Z>` branch is cut off a release tag only when a patch must ship while `main` is not releasable. The fix is authored **on that branch**, tagged there, and then **forward-merged into `main`**. Direction is release → main.
- **Backport — the exception.** The fix already merged to `main`, a `release/*` branch exists for the patch, and the fix must also ship in that patch. Direction is main → release.

If the user asks to backport but no `release/*` branch exists, **stop and say so**. Do not create one — release branches are cut and deleted by a maintainer as part of the release process, never by this skill.

After the patch is tagged, the fix must exist on `main` too. If the backport's source was `main`, that is already true; otherwise remind the user to forward-merge.

## Repository specifics

These differ from the upstream skill this was adapted from — follow the values here.

| Topic                  | This repository                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| Release branches       | `release/<X.Y.Z>`, named for the version it ships (e.g. `release/0.10.1`) — never `rel/*`      |
| Backport branch prefix | `dev/<user>/…` per [CONTRIBUTING §1.1](../../../CONTRIBUTING.md#11-branch-overview)            |
| Build command          | `npm run build` — **never `npm run compile`**, which is `tsc -watch` and never exits           |
| Tests                  | `npm run jesttest`                                                                             |
| Localization           | English only: `l10n/bundle.l10n.json` + `package.nls.json`. No translated language files exist |
| Force pushes           | Never here. `main` is protected; `release/*` force pushes require coordination (§1.6)          |

## Inputs to resolve

Before running any git commands, determine:

1. **Source** — one of: the **current branch** (default when the user says "backport this"), a **PR number**, a **branch name**, or **commit SHA(s) / a range**.
2. **Target branch** — an existing branch on `origin`. List candidates with `git branch -r --list 'origin/release/*'`. The rule is `release/<X.Y.Z>` (e.g. `release/0.10.1`), but read the real list rather than assuming a shape — older branches predate the rule. If none match, fall back to `git branch -r` and ask. **Refuse the source's own base branch** — a backport onto the same base is a no-op. Verify the target exists on `origin` before proceeding.
3. **Squash** — only if the user explicitly asks. Default: no squash.

If anything is ambiguous, ask once before touching the working tree.

## Workflow

Execute these phases in order. Stop and report on any error.

### Phase A — Pre-flight and safety

1. Verify tooling: `git --version`, `gh --version`, `gh auth status`. If `gh` is missing or unauthenticated, abort with a clear message. **Cloud-agent override:** see [Running as the GitHub cloud agent](#running-as-the-github-cloud-agent).
2. Capture state: original branch (`git rev-parse --abbrev-ref HEAD`), `git status --porcelain`, and any unpushed commits.
3. **If source ≠ current branch and the working tree is dirty** (including untracked files): `git stash push -u -m "backport-skill autostash <ISO-timestamp>"`, then record the stash ref (`git stash list -1 --format=%gd`) so it can be restored in Phase G.
4. **If source = current branch**: do not stash. Warn about uncommitted changes that will not be included, and confirm before proceeding.
5. `git fetch origin <target>`. Abort if the target does not exist on `origin`.

### Phase B — Resolve the commit list

- **PR source**: `gh pr view <num> --json number,title,body,headRefName,baseRefName,mergeCommit,commits,state`. If the command fails, abort and show the PR number and the `gh` error. Then branch on `state`:
    - `MERGED` — prefer the squash-merge commit if it was squash-merged; otherwise use the listed commits in order.
    - `OPEN` — warn that the work may be incomplete, and confirm before proceeding.
    - `CLOSED` (not merged) — warn that the work may have been abandoned or superseded, and confirm.
- **Branch source**: `git log --reverse --format=%H origin/<target>..<branch>`.
- **SHA(s) / range**: use as given, validated with `git cat-file -e <sha>`.

Show the resolved list (count plus short log) and confirm before continuing.

### Phase C — Create the backport branch

- **Branch name**: `dev/<user>/backport-<id>-to-<target-slug>` for local runs, matching this repo's `dev/<user>/<topic>` convention. Use the `copilot/` prefix **only** when running as the GitHub.com cloud agent.
    - `<user>` is the current user's branch handle — reuse the one from their existing branches (`git branch --list 'dev/*'`) rather than inventing one.
    - `<id>` is the PR number, the source branch's last segment, or a short SHA.
    - `<target-slug>` is the target with **every** `/` replaced by `-`. Compute it, don't hand-write it (shell: `target_slug="${target//\//-}"`). So `release/0.10.1` → `release-0.10.1`.
    - **Full example:** PR #898 onto `release/0.10.1` gives `dev/tnaum/backport-898-to-release-0.10.1`.
    - **Verify before checkout:** the name must contain exactly two `/` (after `dev` and after `<user>`). A third means the slug was not applied — recompute it.
- **Collision handling** (local *or* `origin/<branch>` exists): ask the user — *overwrite* (delete local and remote, recreate) or *use a numeric suffix* (`-2`, `-3`, …). Never silently overwrite.
- `git checkout -b <name> origin/<target>`.

### Phase D — Cherry-pick

- **Squash**: `git merge --squash <source>`, then `git commit -m "Backport #<n>: <original-title>"`.
- **Otherwise**: `git cherry-pick <sha…>` in order.

**Conflict policy (relaxed but safe):**

> **Cloud-agent override:** auto-resolve only the trivial cases below; for anything ambiguous, do **not** invent a resolution — commit the conflict markers as a `WIP:` commit and mark the PR draft. Skip steps 3 and 4.

1. On conflict, run `git status` and `git diff` to inspect.
2. **Auto-resolve only trivial cases:**
    - *Import-order*: only the order of `import` / `require` differs; identifiers are identical.
    - *Formatting-only*: whitespace, trailing comma, or semicolon differences with no change to identifiers, literals, or control flow.
    - *Additive non-overlapping hunks*: one side adds lines, the other is unchanged in that region.
    - *Pure deletions on one side*: one side deletes a block the other leaves untouched, and the block is not referenced by code added on either side.

    After resolving, verify with `git diff --check` and `! grep -R '<<<<<<<' -- .` before staging.

3. **For anything ambiguous** (semantic overlap, both sides meaningfully changed the same hunk, version or lockfile bumps, generated files such as `l10n/bundle.l10n.json`): stop, present the conflicting files and hunks, and offer:
    - *Resolve manually and continue* — wait, then `git add` + `git cherry-pick --continue`.
    - *Abort* — `git cherry-pick --abort`, delete the backport branch, restore (Phase G).
    - *Squash and retry* — only when there is more than one commit, the current run was not already squash, and the conflicting commit is not the last. Abort, delete the branch, restart from Phase C with squash enabled.
4. Record every conflict and its resolution for the PR body.

### Phase E — Local validation (recommended)

A cherry-pick onto an older release branch often compiles on the source's base but breaks on the target — different dependencies, removed APIs, stricter lint rules. Catch that before pushing.

1. Ask whether to run validation. Default: **yes**. Offer to skip for speed.
2. If yes: the working tree switched branches and may have been mutated, so `node_modules` is likely stale — **start with `npm install`**. Then run the repository's checklist ([CONTRIBUTING §4](../../../CONTRIBUTING.md#4-pr-submission-checklist)) in this order:

    ```bash
    npm run l10n
    npm run prettier-fix
    npm run lint
    npm run jesttest
    npm run build
    npm run package
    ```

    Use `npm run build`. **Never `npm run compile`** — it is a watch task and will hang the run.

    Run `npm run l10n` even when the cherry-pick has no obvious user-facing strings: the target branch can carry pre-existing drift that CI's `l10n:check` will fail on. If the bundle changes, commit it separately as `chore: regenerate l10n bundle` before the Phase F push.

    Unlike the upstream repository this skill came from, there are **no translated language files** here — the extension ships English only. There is nothing to reconcile from the source's base branch, so skip any translation-pulling step.

3. On failure: surface the errors and stop. Treat fixes as another round of conflict resolution — change only what is needed, never pile on unrelated edits. Once green, continue.
4. If the user skips validation, note that in the PR body so reviewers know CI is the first gate.

### Phase F — Push and open the PR

1. `git push -u origin <branch>` — **never** `--force` or `--force-with-lease`. If the push fails, surface the full error; for permission or branch-protection failures, advise checking repository settings and do not retry with force flags. Then go to Phase G failure cleanup.
2. Write the PR body **to a file** and pass it with `--body-file`. Prefer the editor's file-creation tool; with a shell heredoc, write to the OS temp directory **outside the repo** (`"${TMPDIR:-/tmp}/backport-body.md"`, or `"$env:TEMP\backport-body.md"` on Windows PowerShell) and delete it afterwards. Then:

    ```bash
    gh pr create --base <target> --head <branch> --title "[<target>] <original-title>" --body-file <path> --draft
    ```

    **Always `--body-file`, never inline `--body "…"`** — the shell eats backticks, `$`, and quotes, and literal `\n` sequences print verbatim.

    Body authoring rules:
    - **Real newlines only.** Never write the two characters `\n` to mean a line break.
    - **Do not hard-wrap sentences.** Keep each paragraph or bullet on one line, separated by a blank line. GitHub honors single newlines as hard breaks in PR descriptions, so wrapped prose renders broken mid-sentence.
    - **No task-list checkboxes** (`- [ ]` / `- [x]`). GitHub turns them into a progress bar, and pre-checked boxes falsely imply a reviewer checklist is done. Use plain `-` bullets.
    - **Title** must start with the target branch in square brackets — e.g. `[release/0.10.1] Fix tree refresh race` — keeping the rest identical to the original PR title (or the first commit subject).
    - **Contents:** `Backport of #<n>` (or the branch / SHA list), the original PR description when applicable, a **Conflicts resolved** section listing each file with a one-line description, and the validation result.
3. Open it as a **draft** when conflicts were non-trivial or validation was skipped, per [CONTRIBUTING §5.3](../../../CONTRIBUTING.md#53-draft-prs-and-bootstrapping-the-pr-number). Mark it ready once it is clean.
4. `gh pr view --web` to open it in the browser.

### Phase G — Cleanup

- **On success**: `git checkout <originalBranch>`; if Phase A.3 created a stash, `git stash pop <stashRef>`. Print the new PR URL.
- **On failure or user-requested abort**: leave the backport branch and the stash intact. Print the stash ref and the recovery commands (`git checkout <originalBranch> && git stash pop <stashRef>`).

## Constraints

- Refuse the source's own base branch as the target. Any other existing `origin` branch is allowed, including `main` when it is not the source's base.
- Never use `--force` / `--force-with-lease`. `main` is protected and `release/*` force pushes must be coordinated with everyone on the branch ([CONTRIBUTING §1.6](../../../CONTRIBUTING.md#16-force-push-policy)).
- Never create or delete a `release/*` branch — that is the maintainer's release process.
- Preserve original commit messages during cherry-pick.
- Do not modify files beyond what conflict resolution or cherry-pick-induced validation failures require.
- Never silently overwrite an existing local or remote branch.
- Never auto-resolve ambiguous conflicts; always ask.
- Never restore the autostash on failure — leave it for the user to inspect.
- Branch slug: replace **every** `/` in the target with `-`; compute it rather than hand-copying.
- PR body: always `--body-file`, never inline. No literal `\n`, no hard-wrapped sentences, no checkboxes.

## Reporting

When done, summarize: source, target, backport branch name, and commits cherry-picked; conflicts and how each was resolved; whether validation ran and its result; the new PR URL; whether the original branch and stash were restored; and, when relevant, that the fix still needs forward-merging into `main`.

## Running as the GitHub cloud agent

When this skill runs inside the GitHub Copilot cloud agent rather than a local workspace:

- **No interactive prompts.** Resolve everything from the request body and repository state up front; if a required input is missing or ambiguous, stop and report rather than guess.
- **Do not abort on `gh auth status` failure** (overrides Phase A.1). Push auth comes from the platform's credential helper and the PR is opened by the platform. For PR-metadata commands, retry once as `GH_TOKEN="$GITHUB_TOKEN" gh pr edit …`; if that fails, use the REST API (`gh api -X PATCH repos/{owner}/{repo}/pulls/{number} -f base=<target> …`); if even that is impossible, state in the body which fields — **especially the base branch** — still need setting, so the PR does not silently target `main`.
- **Branch naming**: `copilot/backport-<id>-to-<target-slug>`, because the cloud agent can only push `copilot/` branches. The slug rule is unchanged.
- **Skip Phase A.3** — the checkout is ephemeral; there is no working tree to preserve.
- **Apply the Phase D cloud-agent override** — commit conflict markers as `WIP:` and mark the PR draft.
- **Skip Phase E** — CI is the validation gate; do not burn Actions minutes on `npm install` and a build.
- **Skip `gh pr create`** — the platform opens the PR. Use `gh pr edit --base <target> --title "[<target>] <original-title>" --body-file <path>` with the same body rules.
- **Skip Phase G's** stash restore and branch checkout.

All other constraints apply unchanged.

## Credit

Adapted from the `backport` skill in [microsoft/vscode-cosmosdb](https://github.com/microsoft/vscode-cosmosdb) (`.github/skills/backport/SKILL.md`), with thanks to that team. Changes made for this repository: release-branch naming and the tags-first release model, `dev/<user>/…` backport branch names, this repo's validation commands, removal of the translated-language-file reconciliation (this extension ships English only), and the `npm run compile` watch-task warning.
