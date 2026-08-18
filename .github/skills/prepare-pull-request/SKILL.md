---
name: prepare-pull-request
description: Get a branch ready to open as a draft pull request, or ready to move from draft to review. Use when the operator says "prepare a PR", "open a draft PR", "I'm ready to open a PR", "check my branch before I push", "is this ready for review", or asks what is still missing before requesting review. Covers base branch, draft status, description quality, milestone, feature documentation, and commit hygiene. The full verification suite runs only at ready-for-review, never when opening a draft. Does NOT perform the AI code review itself (see CONTRIBUTING.md §6.1-6.5) — but does check that it has run — nor UX review (see ux-pr-review) or cutting a release (see CONTRIBUTING.md §7).
---

# Prepare a Pull Request

## Two cases, two different amounts of work

These are the same two cases as in `.github/copilot-instructions.md`. Establish which one
you are in before doing anything.

| Case                                  | What it is                                                                    | Verification |
| ------------------------------------- | ----------------------------------------------------------------------------- | ------------ |
| **Case 1 — opening a draft PR**       | Work is still in progress. The PR exists to hold commits, CI, and discussion. | Fast loop    |
| **Case 2 — draft → ready for review** | Handing the work to a human. This is the gate.                                | Full list    |

The commands are **not** repeated here. They are in the "Verification: two cases" section
of `.github/copilot-instructions.md`, which is already in your context. This skill covers
what that section does not.

## When to Use

- The operator asks to open a draft PR → **Case 1**.
- The operator asks to finalize, mark ready, or asks what is still missing → **Case 2**.
- The operator asks to "prepare a PR" without saying which → ask. Assuming Case 2 when
  they meant Case 1 wastes several minutes of checks.

Do **not** run this after every commit. Run it when you are opening a PR, or moving one
to review. Only Case 2 is a hand-over.

---

# Case 1 — Opening a draft PR

Four steps, none of them expensive.

## 1.1 Base branch

All PRs target `main`. The exceptions, per `CONTRIBUTING.md` §1.1:

| Situation                                             | Base             |
| ----------------------------------------------------- | ---------------- |
| Normal work                                           | `main`           |
| Part of a larger shared effort                        | `feature/<name>` |
| A patch that must ship while `main` is not releasable | `release/<X.Y>`  |

If the branch was cut from something other than its intended base, say so and stop.
Do not rebase a shared branch without asking.

## 1.2 Open it as a draft

Always open as a **draft**. This keeps the automatic Copilot review from running before it
is wanted, and it is what signals that the verification suite is not due yet.

A draft PR is cheap and worth opening early: it gives CI somewhere to run and the operator
somewhere to comment. Do not wait for the work to be finished.

## 1.3 The description is load-bearing

Release notes are generated from merged PR descriptions and closed issues
(`CONTRIBUTING.md` §7.1). A thin description produces a thin release note and forces a
maintainer to rewrite it by hand months later, without the context you have now.

In **Case 1** a skeleton is enough: what this is for, and what is not done yet. Fill it in
properly in Case 2, when the scope has stopped moving.

There is no PR template in this repository, so write:

- **What changed**, in a sentence a user would recognize, not a summary of the diff.
- **Why**, including the option that was rejected if a reasonable reader would ask.
- **Scope** — what is deliberately _not_ in this PR.
- **Validation** — what was covered by tests, and what still needs a human. Name the
  manual steps explicitly if any remain.
- **Links** — the issue it closes, and the feature folder under
  `docs/ai-and-plans/features/` where the reasoning lives.

Ask the operator for anything you cannot derive from the branch. Never invent a rationale.

## 1.4 Commit hygiene

- One commit per work item. No mass commits.
- Commit messages say **why**, not just what. The diff already says what.
- Pure moves are committed separately from content edits, so `git log --follow` survives.
- Never `git add -f`. If a path is ignored it is ignored for a reason; stop and tell the
  operator.
- Never hand-merge `l10n/bundle.l10n.json`. Take either side and re-run `npm run l10n`.

---

# Case 2 — Draft → ready for review

Everything above still applies, plus the following. **This is where the verification suite
runs, and it runs once.**

## 2.1 Milestone and issue links

Attach the milestone for the release this is intended for. The release process gathers
material by milestone, so an unmilestoned PR is invisible to it.

`gh pr edit --milestone` does **not** work against this repository. It fails with a
Projects-classic deprecation error from GitHub's GraphQL API, which has nothing to do with
the milestone. Use the REST issues endpoint instead — pull requests are issues for this
purpose:

```bash
# find the milestone id (--paginate: the list is longer than one page)
gh api repos/microsoft/vscode-documentdb/milestones --paginate \
  --jq '.[] | "\(.number)  \(.title)"'

gh api repos/microsoft/vscode-documentdb/issues/<pr-number> -X PATCH \
  -F milestone=<milestone-id> --jq '.milestone.title'
```

Use `Closes #NNN` for issues this resolves, so they close on merge and appear in the same
release gathering.

## 2.2 Feature documentation

Per `CONTRIBUTING.md` §5, durable knowledge belongs to the feature that owns it.

- If this PR changed a **decision, constraint, or intended design** recorded in a
  feature's current documents — or if you already know one of them has become materially
  misleading — update `docs/ai-and-plans/features/<feature>/README.md` (and `design.md`
  if applicable) **in this PR**. These documents record intent, not exact behavior, so do
  not sweep them for drift.
- If a design choice was made that a future reader would question, add it to that
  feature's `decisions.md` — with the reasoning, and with the "changed from the proposal?"
  column filled in when the operator overrode a proposal. Deviations from the plan belong
  here; minor choices made along the way do not.
- Plans, reviews, and logs for this round of work go in
  `features/<feature>/iterations/NN-slug.md`.
- If no feature fits, create one. Pick a slug a newcomer would guess, add a `README.md`,
  and list it in the index at `docs/ai-and-plans/README.md`. The narrow exception is a
  document that genuinely belongs to no feature: that is a single file at the root of
  `docs/ai-and-plans/`. Do not invent a feature to hold it.

Check `code:` globs in any frontmatter you touched actually resolve against the
repository. A glob that matches nothing fails silently and still looks authoritative.

## 2.3 The AI pre-review must have happened

`CONTRIBUTING.md` §6 makes the AI pre-review a condition of requesting human review, not
optional polish. This skill does not run it — it checks that it was run.

Confirm both:

- A review file for this round of work is committed under
  `docs/ai-and-plans/features/<feature>/iterations/`.
- The author's decisions on the findings are recorded in it (§6.2), not just the findings.

If either is missing, **stop and tell the operator §6 is outstanding.** Do not mark the PR
ready to "unblock" it, and do not write the author's decisions on their behalf — §6.2 is
the part that only the author can do.

## 2.4 Hand-over

**Now** run Case 2 from `.github/copilot-instructions.md`. Once, here, not earlier.
Then report:

- What is done and what remains.
- Anything you could not verify, and why.
- Any question you had to answer by assumption, so the operator can correct it.

Do not mark the PR ready for review with a failing or unrun step.

## Related

- `.github/copilot-instructions.md` — the two verification cases and their commands
- [CONTRIBUTING.md](../../../CONTRIBUTING.md) §4 (checklist), §5 (documenting work), §6 (AI review workflow)
- [ux-pr-review](../ux-pr-review/SKILL.md) — hands-on UX and workflow review
- [review-external-pr](../review-external-pr/SKILL.md) — triaging a community contribution
- [writing-release-notes](../writing-release-notes/SKILL.md) — what good descriptions feed into
