---
name: prepare-pull-request
description: Get a branch ready to open as a draft pull request, or ready to move from draft to review. Use when the operator says "prepare a PR", "open a draft PR", "I'm ready to open a PR", "check my branch before I push", "is this ready for review", or asks what is still missing before requesting review. Covers base branch, draft status, description quality, milestone, feature documentation, and commit hygiene. The full verification suite runs only at ready-for-review, never when opening a draft. Does NOT cover the AI code review itself (see CONTRIBUTING.md §6.1-6.5), UX review (see ux-pr-review), or cutting a release (see CONTRIBUTING.md §7).
---

# Prepare a Pull Request

## Two moments, two different amounts of work

Most of the cost in this skill belongs to **one** of them. Establish which one you are in
before doing anything.

| Moment                           | What it is                                                                    | Verification             |
| -------------------------------- | ----------------------------------------------------------------------------- | ------------------------ |
| **A — Opening a draft PR**       | Work is still in progress. The PR exists to hold commits, CI, and discussion. | **None.** Fast loop only |
| **B — Draft → ready for review** | Handing the work to a human. This is the gate.                                | Full hand-over list      |

> ⚠️ **Do not run the verification suite when opening a draft.** `l10n`,
> `prettier-fix`, `lint`, the full Jest suite and `package` cost minutes each and say
> nothing about work that is still moving. A branch that opens a draft early and pushes
> twenty times would otherwise pay that twenty times over. While the PR is a draft, the
> loop is `npm run build` plus the tests covering what was touched — nothing else.

The verification commands themselves are **not** repeated here. They live in the
"Verification: what to run, and when" section of `.github/copilot-instructions.md`, which
is already in your context. This skill covers what that section does not.

## When to Use

- The operator asks to open a draft PR → **moment A**.
- The operator asks to finalize, mark ready, or asks what is still missing → **moment B**.
- The operator asks to "prepare a PR" without saying which → ask. Assuming B when they
  meant A wastes several minutes of checks.

Do **not** run this after every commit. Both moments are hand-over steps.

---

# Moment A — Opening a draft PR

Four steps, none of them expensive.

## A1. Base branch

All PRs target `main`. The exceptions, per `CONTRIBUTING.md` §1.1:

| Situation                                             | Base             |
| ----------------------------------------------------- | ---------------- |
| Normal work                                           | `main`           |
| Part of a larger shared effort                        | `feature/<name>` |
| A patch that must ship while `main` is not releasable | `release/<X.Y>`  |

If the branch was cut from something other than its intended base, say so and stop.
Do not rebase a shared branch without asking.

## A2. Open it as a draft

Always open as a **draft**. This keeps the automatic Copilot review from running before it
is wanted, and it is what signals that the verification suite is not due yet.

A draft PR is cheap and worth opening early: it gives CI somewhere to run and the operator
somewhere to comment. Do not wait for the work to be finished.

## A3. The description is load-bearing

Release notes are generated from merged PR descriptions and closed issues
(`CONTRIBUTING.md` §7.1). A thin description produces a thin release note and forces a
maintainer to rewrite it by hand months later, without the context you have now.

At **moment A** a skeleton is enough: what this is for, and what is not done yet. Fill it
in properly at moment B, when the scope has stopped moving.

There is no PR template in this repository, so write:

- **What changed**, in a sentence a user would recognize, not a summary of the diff.
- **Why**, including the option that was rejected if a reasonable reader would ask.
- **Scope** — what is deliberately _not_ in this PR.
- **Validation** — what was covered by tests, and what still needs a human. Name the
  manual steps explicitly if any remain.
- **Links** — the issue it closes, and the feature folder under
  `docs/ai-and-plans/features/` where the reasoning lives.

Ask the operator for anything you cannot derive from the branch. Never invent a rationale.

## A4. Commit hygiene

- One commit per work item. No mass commits.
- Commit messages say **why**, not just what. The diff already says what.
- Pure moves are committed separately from content edits, so `git log --follow` survives.
- Never `git add -f`. If a path is ignored it is ignored for a reason; stop and tell the
  operator.
- Never hand-merge `l10n/bundle.l10n.json`. Take either side and re-run `npm run l10n`.

---

# Moment B — Draft → ready for review

Everything above still applies, plus the following. **This is where the verification suite
runs, and it runs once.**

## B1. Milestone and issue links

Attach the milestone for the release this is intended for. The release process gathers
material by milestone, so an unmilestoned PR is invisible to it.

Use `Closes #NNN` for issues this resolves, so they close on merge and appear in the same
release gathering.

## B2. Feature documentation

Per `CONTRIBUTING.md` §5, durable knowledge belongs to the feature that owns it.

- If this PR changed behavior described in a feature's current documents, update
  `docs/ai-and-plans/features/<feature>/README.md` (and `design.md` if applicable) **in
  this PR**.
- If a design choice was made that a future reader would question, add it to that
  feature's `decisions.md` — with the reasoning, and with the "changed from the proposal?"
  column filled in when the operator overrode a proposal.
- Plans, reviews, and logs for this round of work go in
  `features/<feature>/iterations/NN-slug.md`.
- If no feature fits, create one. Pick a slug a newcomer would guess, add a `README.md`,
  and list it in the index at `docs/ai-and-plans/README.md`.

Check `code:` globs in any frontmatter you touched actually resolve against the
repository. A glob that matches nothing fails silently and still looks authoritative.

## B3. Hand-over

**Now** run the hand-over verification list from `.github/copilot-instructions.md` —
localization, formatting, linting, the full test suite, build, package. Once, here, not
earlier. Then report:

- What is done and what remains.
- Anything you could not verify, and why.
- Any question you had to answer by assumption, so the operator can correct it.

Do not mark the PR ready, or report the work as finished, with a failing or unrun step.

## Related

- `.github/copilot-instructions.md` — the verification commands and when to run them
- [CONTRIBUTING.md](../../../CONTRIBUTING.md) §4 (checklist), §5 (documenting work), §6 (AI review workflow)
- [ux-pr-review](../ux-pr-review/SKILL.md) — hands-on UX and workflow review
- [review-external-pr](../review-external-pr/SKILL.md) — triaging a community contribution
- [writing-release-notes](../writing-release-notes/SKILL.md) — what good descriptions feed into
