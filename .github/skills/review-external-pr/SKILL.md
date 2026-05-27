---
name: review-external-pr
description: Triage an external contributor's PR and prepare it for merge. Detects push permission, base branch, draft state, size, and history quality, then picks one of three paths (review-only, direct push to contributor branch, or a `reviews/` staging branch). Use when triaging or reviewing a community PR, deciding whether maintainer changes are needed, choosing a merge strategy (squash/merge/rebase), or merging an external contribution.
---

# Review External PR Workflow

A triage-first workflow for handling community PRs. The skill **inspects first, asks two questions, then executes**. It never creates branches preemptively.

## When to Use

- A contributor PR is open and you want to review and merge it
- Trigger phrases: "prepare this external PR", "review PR #N", "let's review this contribution", or invocation while the user is on a `pr/<owner>/<PR_NUMBER>` branch (created by `gh pr checkout`)
- You want a recommendation on push path and merge strategy before doing anything

## Phase 1 — Triage (read-only, no prompts)

### Identify the PR

Resolve, in order:

1. The PR number the user mentioned.
2. Current branch matches `pr/<owner>/<PR_NUMBER>` → extract `<PR_NUMBER>`.
3. `gh pr status` → active PR for current branch.

### Fetch metadata in one call

```bash
gh pr view <PR_NUMBER> --json number,title,author,url,state,isDraft,\
headRefName,baseRefName,headRepositoryOwner,maintainerCanModify,\
mergeable,mergeStateStatus,additions,deletions,changedFiles,commits,labels
```

### Derive signals

| Signal          | Rule                                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----- | -------------- | ---- | ------ | ----- |
| `canPushToHead` | `headRepositoryOwner.login == "microsoft"` OR `maintainerCanModify`                                                           |
| `baseBranch`    | `baseRefName` (do **not** hardcode `main`)                                                                                    |
| `isDraft`       | warn if `true`                                                                                                                |
| `mergeable`     | warn if `mergeable != "MERGEABLE"` (values: `MERGEABLE`, `CONFLICTING`, `UNKNOWN`)                                            |
| `mergeReady`    | warn if `mergeStateStatus` is not `CLEAN` (other values: `DIRTY`, `BLOCKED`, `BEHIND`, `UNSTABLE`, `HAS_HOOKS`, `UNKNOWN`)    |
| `commitCount`   | `commits.length`                                                                                                              |
| `messyHistory`  | any `commits[].messageHeadline` (the first line of the commit message, returned by `gh pr view --json commits`) matches `/wip | fixup | address review | typo | merge( | $)/i` |
| `changedLines`  | `additions + deletions`                                                                                                       |
| `sizeBucket`    | small ≤ 50 changed lines, medium ≤ 300, large > 300 (uses `changedLines`)                                                     |

### Squash recommendation

| Condition                                         | Recommend                                               |
| ------------------------------------------------- | ------------------------------------------------------- |
| `commitCount == 1`                                | **No squash** (rebase or merge) — history already clean |
| `commitCount ≤ 3` AND no messy subjects AND small | Ask, **default no squash**                              |
| `commitCount > 3` OR messy subjects detected      | **Squash** (default)                                    |

### Print the triage report

```
PR #<PR_NUMBER> — <title>
  Author:        <login>  (<fork|same-repo>)
  Base:          <baseBranch>
  State:         <state>, <draft?>, mergeable=<mergeable>, mergeStateStatus=<mergeStateStatus>
  Push to head:  <✅ allowed reason | ❌ blocked reason>
  Size:          +<additions> / -<deletions> across <changedFiles> file(s), <commitCount> commit(s)
  History:       <clean | messy: "<sample messageHeadline>">

Recommendation:
  • Path:  <direct push | reviews/ branch | review-only>
  • Merge: <--squash | --merge | --rebase> (<reason>)
```

Stop here and present the report.

## Phase 2 — Two questions

Ask **only** these. Pre-select the recommended option.

### Q1: Do you need to add changes before merging?

- **No** → Path A (review & merge)
- **Yes, small tweaks** → Path B (direct push) if `canPushToHead`, otherwise Path C
- **Yes, heavy rework / contributor unresponsive** → Path C (`reviews/` staging branch)

If `canPushToHead == false`, omit the "direct push" option and explain: _"Contributor disabled maintainer edits; we must use a `reviews/` branch."_

### Q2: Merge strategy?

Offer `--squash`, `--merge`, `--rebase` with the recommended option marked. Justify the default in one short sentence (e.g., _"4 commits including 'fix typo' — squash recommended"_).

## Phase 3 — Execute

Run commands non-interactively, echoing each one. After merge, print a one-line summary with the merged commit/PR URL.

### Path A — Review & merge (no maintainer changes)

```bash
gh pr checkout <PR_NUMBER>                  # optional, for local inspection
# review, leave comments via the PR UI or `gh pr review`
gh pr merge <PR_NUMBER> --<strategy>        # against the PR's actual base
```

### Path B — Direct push to the contributor's branch

Requires `canPushToHead == true`.

```bash
gh pr checkout <PR_NUMBER>                  # sets up a remote tracking the fork branch
# make changes, commit
git push                                    # updates the existing PR in place
gh pr merge <PR_NUMBER> --<strategy>
```

The existing PR updates in place; the contributor keeps authorship of their commits and maintainer commits are attributed to the maintainer. No second PR is needed.

### Path C — `reviews/` staging branch

Use when push to head is blocked, or when the maintainer explicitly wants to isolate rework.

**Branch slug sanitization** — derive `<slug>` from the PR title:

1. Lowercase.
2. Replace every run of non-`[a-z0-9]` characters with a single `-`.
3. Trim leading/trailing `-`.
4. Truncate to 30 characters; trim trailing `-` again if the cut left one.

Example: `"fix(tree): sort _id_ index first / cleanup"` → `fix-tree-sort-id-index-first-c`.

Full branch name: `reviews/<slug>-pr-<PR_NUMBER>`.

```bash
git fetch origin
git checkout -b reviews/<slug>-pr-<PR_NUMBER> origin/<baseBranch>
git push -u origin reviews/<slug>-pr-<PR_NUMBER>
```

Retarget the contributor's PR:

```bash
gh pr edit <PR_NUMBER> --base reviews/<slug>-pr-<PR_NUMBER>
gh pr view <PR_NUMBER> --json baseRefName    # verify
```

> ⚠️ `gh pr edit --base` may print a deprecation warning about Projects (classic). Cosmetic only — the base change succeeds.

Merge the contributor's PR into the review branch:

```bash
gh pr merge <PR_NUMBER> --<strategy>
```

Pull and create the finalization PR back to the original base:

```bash
git checkout reviews/<slug>-pr-<PR_NUMBER>
git pull origin reviews/<slug>-pr-<PR_NUMBER>

gh pr create \
  --base <baseBranch> \
  --head reviews/<slug>-pr-<PR_NUMBER> \
  --title "<original title> [reviewed]" \
  --body "Finalizes review of @<author>'s contribution in #<PR_NUMBER>.

Original PR: <PR_URL>"
```

Comment on the original PR:

```bash
gh pr comment <PR_NUMBER> \
  --body "Thanks for the contribution! Review continues in #<NEW_PR_NUMBER> where maintainer changes are finalized before merging to \`<baseBranch>\`."
```

## Merge Strategy Reference

| Strategy   | When to use                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------------- |
| `--squash` | Default for messy/multi-commit external PRs. One revert undoes the change. Contributor still gets authorship credit. |
| `--merge`  | Large feature where individual commits are meaningful and worth preserving.                                          |
| `--rebase` | Single clean commit, or a series of clean atomic commits you want linear on the base.                                |

## Hard Rules

- **Never** hardcode `main` as the base — always read `baseRefName`.
- **Never** create a `reviews/` branch in Phase 1.
- **Never** force-push to a contributor's branch.
- If the PR is a **draft**, refuse to merge and report it back to the maintainer.
- If `mergeable == "CONFLICTING"` or `mergeStateStatus != "CLEAN"`, stop and surface that before any merge command.

## Summary

| Phase | What happens                                               | Output                      |
| ----- | ---------------------------------------------------------- | --------------------------- |
| 1     | Read PR metadata, derive push capability + recommendations | Triage report               |
| 2     | Ask Q1 (path) and Q2 (merge strategy)                      | Decision                    |
| 3     | Execute the chosen path with the chosen merge strategy     | Merged PR / finalization PR |
