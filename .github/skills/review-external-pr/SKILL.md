---
name: review-external-pr
description: Prepare an external contributor's PR for maintainer review by redirecting it into a dedicated review branch, then merging and creating a new finalization PR targeting next. Use when triaging/reviewing contributor PRs, merging external PRs with maintainer changes, or setting up a review workflow for incoming community contributions.
---

# Review External PR Workflow

Redirects an external contributor's PR into a `reviews/` staging branch so a maintainer can inspect, add changes, then merge everything into `next` cleanly.

## When to Use

- An external contributor opened a PR targeting `next` and you want to add changes before merging
- You want to formally review and finalize a community contribution
- You want the contributor to get proper merge credit while still controlling what lands in `next`

## Workflow Steps

### 1. Gather PR Info

```bash
gh pr view <PR_NUMBER> --json title,author,headRefName,baseRefName,body
```

Note the **PR number**, **title**, and **author login** — you'll need them for branch naming and PR descriptions.

### 2. Create the Review Branch

Branch naming format: `reviews/<helpful-name>-original-pr-<number>`

```bash
git fetch origin
git checkout -b reviews/<helpful-name>-original-pr-<PR_NUMBER> origin/next
git push origin reviews/<helpful-name>-original-pr-<PR_NUMBER>
```

Example: `reviews/copy-reference-original-pr-545`

### 3. Retarget the Contributor's PR

> ⚠️ **Known issue**: `gh pr edit --base` may emit a deprecation warning about Projects (classic). This is a cosmetic warning only — the base branch change succeeds regardless. Verify with `gh pr view <PR_NUMBER> --json baseRefName`.

```bash
gh pr edit <PR_NUMBER> --base reviews/<helpful-name>-original-pr-<PR_NUMBER>
```

Verify:

```bash
gh pr view <PR_NUMBER> --json baseRefName
```

### 4. Merge the Contributor's PR

Once the base is updated and the PR is ready:

```bash
gh pr merge <PR_NUMBER> --squash
```

Or approve + merge via the GitHub UI to trigger any required status checks.

### 5. Create the Finalization PR

Pull the merged review branch, then open a new PR from it to `next`:

```bash
git checkout reviews/<helpful-name>-original-pr-<PR_NUMBER>
git pull origin reviews/<helpful-name>-original-pr-<PR_NUMBER>
```

Create the PR:

```bash
gh pr create \
  --base next \
  --head reviews/<helpful-name>-original-pr-<PR_NUMBER> \
  --title "<original title> [reviewed]" \
  --body "This PR finalizes the review of the contribution originally submitted by @<author_login> in #<PR_NUMBER>.

Original PR: <PR_URL>"
```

### 6. Comment on the Original PR

Go back to the contributor's original (now merged) PR and leave a comment linking to the finalization PR:

```bash
gh pr comment <ORIGINAL_PR_NUMBER> \
  --body "Thank you for the contribution! The review is continuing in #<NEW_PR_NUMBER> where maintainer changes will be finalized before merging to \`next\`."
```

## Summary

| Step | Action                                     | Result                                    |
| ---- | ------------------------------------------ | ----------------------------------------- |
| 1    | Gather PR info                             | Know PR number, title, author             |
| 2    | Create `reviews/...` branch off `next`     | Staging branch ready                      |
| 3    | Retarget contributor's PR to review branch | Their diff is scoped to review branch     |
| 4    | Merge contributor's PR                     | Contributor gets merge credit             |
| 5    | Create finalization PR to `next`           | Maintainer controls what lands in `next`  |
| 6    | Comment on original PR with link to new PR | Contributor is informed, thread is linked |
