---
name: flagging-fresh-dependencies
description: Flags npm dependencies published to the public registry within the last N days (default 7) and traces each one to the PR that added it, its approver, and merge time. Use when asked to check for fresh or recently released dependencies, audit lockfile updates (Dependabot bumps), decide what to revert or hold back, or answer "when was this version published, which PR added it, who approved it".
---

# Flagging Fresh Dependencies

Recently published versions are risky here for two reasons: supply-chain exposure, and the Azure Artifacts feed (`.azure-pipelines/.npmrc`) may not have synced them yet, so CI fails with `npm error 404 ... Cannot find the file <pkg>-<ver>.tgz in package ... in feed 'vscode-documentdb'`. Dependabot bumps land within hours of a release, so this happens regularly.

## Step 1 — Scan (script)

```bash
node .github/skills/flagging-fresh-dependencies/scripts/find-fresh-dependencies.mjs
```

Scans `package-lock.json` and `api/package-lock.json` against the public npm registry (takes ~20 s for ~1,800 versions; publish time comes from the registry `time` map, which is authoritative). Prints each fresh `name@version` with age, UTC publish time, prod/dev scope, and the dependency chain to a declared dependency (`via`).

| Option            | Purpose                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `[lockfile ...]`  | Explicit lockfiles, e.g. one from `git show origin/main:package-lock.json`               |
| `--days N`        | Window size (default 7)                                                                  |
| `--now <ISO>`     | Fixed reference time (use the user's current time for exact ages)                        |
| `--json`          | Machine-readable output                                                                  |
| `--fail-on-fresh` | Exit 1 if anything is fresh (exit 3 = lookup failures, result incomplete; 2 = bad usage) |

Zero results is a valid answer: say so, with the counts printed by the script. If exit code is 3, rerun before concluding anything.

To check what `main` would bring in, scan the lockfile from `origin/main` instead of the working tree.

## Step 2 — Trace each fresh package (LLM, use `gh`/`git`)

For every hit, find who introduced that exact version. Do not use `git blame` on the current file only; search history for the resolved tarball:

```bash
# Commits that added/removed this exact version (oldest first). The first one is the bump.
git log --all --reverse --date=iso-strict --format='%H%x09%aI%x09%an%x09%s' \
  -S'<name>-<version>.tgz' -- package-lock.json

# PR(s) containing that commit
gh api repos/microsoft/vscode-documentdb/commits/<sha>/pulls \
  --jq '.[] | {number,title,merged_at,html_url}'

# Approvals and merge
gh pr view <n> --repo microsoft/vscode-documentdb \
  --json title,author,reviewDecision,reviews,mergedAt,mergedBy,mergeCommit
```

Gotchas:

- Dependabot PRs are merged as **merge commits**: the branch commit (`-S` hit) differs from the merge commit (`mergeCommit`). Both belong to the same PR; use the commit-to-PR API above.
- A `-S` hit can also be a later commit that re-touched the lockfile (e.g. a rebase or "baseline checkpoint"). The bump is the earliest commit in history that adds the version.
- Approver = a review with `state: APPROVED` (with `commit.oid` and `submittedAt`). `COMMENTED` reviews (including Copilot's "wasn't able to review any files") are **not** approvals. `mergedBy` may differ from the approver.
- A transitive dependency can also arrive via a PR that changed a different package (`via` shows the parent). Report the PR that actually changed the lockfile line, not the one for the parent name.
- Report times in UTC and the user's local time, and compute deltas (publish → lock commit → approval → merge) from the raw timestamps.

## Step 3 — Report

One row per fresh package:

| Package | Published (UTC) | Age | Scope / via | Added by (PR, commit time) | Approved by (time) | Merged by (time) |
| ------- | --------------- | --- | ----------- | -------------------------- | ------------------ | ---------------- |

Then the notable timing (e.g. "bumped 3 h 44 min after publish; approved 10 s before merge") and, when relevant, the feed-404 implication. Do not modify anything unless asked.

## If asked to revert

Use a branch (the user named `dev/tnaum/dependency-update` before) and revert the whole PR, since bumps pull in sibling packages (a `browserslist` bump also moves `caniuse-lite`, `electron-to-chromium`, `node-releases`, ...):

```bash
git revert -m 1 <merge-commit-sha>   # revert the merge commit of the Dependabot PR
```

Re-run the script afterwards to confirm the window is clean. Dependabot may re-propose the same bump; mention it.
