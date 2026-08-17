---
name: prepare-pull-request
description: Get a branch ready to open as a pull request, or ready to move from draft to review. Use when the operator says "prepare a PR", "I'm ready to open a PR", "check my branch before I push", "is this ready for review", or asks what is still missing before requesting review. Covers base branch, draft status, description quality, milestone, feature documentation, and commit hygiene. Does NOT cover the AI code review itself (see CONTRIBUTING.md §6.1-6.5), UX review (see ux-pr-review), or cutting a release (see CONTRIBUTING.md §7).
---

# Prepare a Pull Request

Everything that has to be true before a pull request is opened, or before a draft is
marked ready for review.

The verification commands are **not** repeated here. They live in the "Verification: what
to run, and when" section of `.github/copilot-instructions.md`, which is already loaded in
your context. Run the hand-over list from there. This skill covers the things that list
does not.

## When to Use

- The operator asks to prepare, open, or finalize a pull request.
- A draft PR is about to be marked ready for review.
- The operator asks what is still missing before requesting review.

Do **not** run this after every commit. It is a hand-over step.

---

## 1. Base branch

All PRs target `main`. The exceptions, per `CONTRIBUTING.md` §1.1:

| Situation                                             | Base             |
| ----------------------------------------------------- | ---------------- |
| Normal work                                           | `main`           |
| Part of a larger shared effort                        | `feature/<name>` |
| A patch that must ship while `main` is not releasable | `release/<X.Y>`  |

If the branch was cut from something other than its intended base, say so and stop.
Do not rebase a shared branch without asking.

## 2. Draft first

Open as a **draft**. This keeps the automatic Copilot review from running before it is
wanted. Move to ready only when the rest of this list passes.

## 3. The description is load-bearing

Release notes are generated from merged PR descriptions and closed issues
(`CONTRIBUTING.md` §7.1). A thin description produces a thin release note and forces a
maintainer to rewrite it by hand months later, without the context you have now.

There is no PR template in this repository, so write:

- **What changed**, in a sentence a user would recognize, not a summary of the diff.
- **Why**, including the option that was rejected if a reasonable reader would ask.
- **Scope** — what is deliberately _not_ in this PR.
- **Validation** — what was covered by tests, and what still needs a human. Name the
  manual steps explicitly if any remain.
- **Links** — the issue it closes, and the feature folder under
  `docs/ai-and-plans/features/` where the reasoning lives.

Ask the operator for anything you cannot derive from the branch. Never invent a rationale.

## 4. Milestone and issue links

Attach the milestone for the release this is intended for. The release process gathers
material by milestone, so an unmilestoned PR is invisible to it.

Use `Closes #NNN` for issues this resolves, so they close on merge and appear in the same
release gathering.

## 5. Feature documentation

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

## 6. Commit hygiene

- One commit per work item. No mass commits.
- Commit messages say **why**, not just what. The diff already says what.
- Pure moves are committed separately from content edits, so `git log --follow` survives.
- Never `git add -f`. If a path is ignored it is ignored for a reason; stop and tell the
  operator.
- Never hand-merge `l10n/bundle.l10n.json`. Take either side and re-run `npm run l10n`.

## 7. Hand-over

Run the hand-over verification list from `.github/copilot-instructions.md` — localization,
formatting, linting, the full test suite, build, package — then report:

- What is done and what remains.
- Anything you could not verify, and why.
- Any question you had to answer by assumption, so the operator can correct it.

Do not report the work as finished with a failing or unrun step.

## Related

- `.github/copilot-instructions.md` — the verification commands and when to run them
- [CONTRIBUTING.md](../../../CONTRIBUTING.md) §4 (checklist), §5 (documenting work), §6 (AI review workflow)
- [ux-pr-review](../ux-pr-review/SKILL.md) — hands-on UX and workflow review
- [review-external-pr](../review-external-pr/SKILL.md) — triaging a community contribution
- [writing-release-notes](../writing-release-notes/SKILL.md) — what good descriptions feed into
