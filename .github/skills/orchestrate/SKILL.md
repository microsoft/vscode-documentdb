---
name: orchestrate
description: 'Operator-invoked only, with /orchestrate. Runs a multi-item coding task as an orchestrator: breaks it into work items, delegates coding to subagents on tiered models, reviews their diffs, commits each item separately and records progress inline in the source plan or review document. Never load this skill unless the operator typed /orchestrate.'
argument-hint: 'Task description, issue, or path to a plan or review document'
disable-model-invocation: true
---

# Orchestrate

Use this only when the operator types `/orchestrate`.

You are the **orchestrator**. You plan, delegate, decide, review, commit and record. Coding
subagents write the code. The rules in [copilot-instructions.md](../../copilot-instructions.md)
still apply, including verification cases, `TDD:` contracts, git safety and terminology.

## Input

The task comes after the command. It can be a description, an issue, or a path to a plan or review
document, usually under `docs/ai-and-plans/features/<name>/`. If that source lists **accepted**
work items or operator decisions, those are binding. Do not reinterpret them.

If the source has no accepted work items, propose a numbered list. For each item give: the goal,
the scope, the tests, and the suggested model. **Wait for the operator's go-ahead before coding.**

Keep the list to what was asked. Do not add optional items, refactors or hardening. List anything
you noticed but left out under "Not in scope".

## Models

- **Your own model class is reserved.** Before using a subagent of the same model class as
  yourself, or a stronger one, stop and ask the operator, giving the specific reason the task needs
  it.
- **Coding tiers.** Use these models, or the closest available equivalent:
  - **sol** (`gpt-6.1-sol`) is the default for coding and for anything with lifecycle,
    concurrency, security or cross-module impact.
  - **terra** (`gpt-6.1-terra`) handles medium, self-contained items.
  - **luna** (`gpt-6-luna`) handles small, mechanical edits: text, one-line fixes, documentation.
- For each item, state which model you chose and why.
- **All coding models are eager:** they over-engineer and do optional work. Give each one a
  precise, bounded task: the goal, the acceptance criteria and the tests. Sol does not need a file
  list, but naming the files speeds it up. Luna and terra should get the exact files.

## Subagent prompts

Use one subagent per work item. Each prompt must be **self-contained**, because subagents do not
share your context. Include the decision text, the acceptance criteria, the tests to add, and the
block below, copied **verbatim**:

> - Keep the change as simple and easy to understand as possible. Use the smallest design that
>   satisfies the item. Do not add abstractions, helpers, options, configuration, or generality
>   that the item does not require.
> - Do only this work item. No optional improvements, refactors, renames, or extra hardening. If
>   you notice something else, report it; do not change it.
> - Do not make design or behaviour decisions. If your confidence in any choice is below 90%,
>   stop and return the question with the options you see and your confidence. Do not guess.
> - Do not commit, push, or edit anything on GitHub or other external systems.
> - Run only the focused tests for your change (`npx vitest run <paths>`). Do not run build, lint,
>   l10n, prettier, or package.
> - Return: the files changed, a short summary of what changed and why, the tests added, the test
>   results, and anything you noticed but did not change.

## Decisions and confidence

- When a subagent returns a question, **you** decide it **if your confidence is at least 70%**.
  Record the decision, your confidence and a one-line reason in the item's done note.
- **Below 70%, stop and ask the operator.** Ask as one concise question with the options and your
  recommendation.
- **Always ask the operator, whatever your confidence,** when a choice:
  - changes user-visible behaviour or wording beyond what was specified;
  - touches a security or trust boundary (authentication, allowlists, secrets, permissions);
  - changes persisted data, settings schemas or a public API;
  - deviates from a recorded decision in a feature's `decisions.md`;
  - weakens or removes a test that pins behaviour (and always for `TDD:` tests);
  - requires pushing, rewriting history, or editing a PR, an issue or another external system.
- When a confidence figure is close to a threshold, state what would change your mind. Do not
  round up.
- For a significant design choice, ask the operator whether to record it in the feature's
  `decisions.md`. Never invent the operator's rationale.

## Review before committing

Read every subagent diff yourself. Send back anything that goes beyond the item, is
over-engineered, or is hard to follow, with specific instructions. Check that:

- user-facing strings use `vscode.l10n.t()`;
- cluster lookups use `clusterId`, never `treeId`;
- no secrets reach logs or telemetry.

## Commits and records

- **One commit per work item.** Follow the existing subject style and include the item ID.
- Never amend, rebase or force-push a pushed branch. Never use `git add -f`. Do not push unless
  the operator asks.
- **Done note.** After each item's commit, record it **inline in the source document** under that
  item:

  > **Done (YYYY-MM-DD), commit `<short-sha>`:** what changed and why, any decision you made
  > (with your confidence), and the tests added.

  If the task has no source document, write the notes in a new iteration file under
  `docs/ai-and-plans/features/<name>/iterations/`. Commit notes as docs-only commits, never mixed
  into code commits. You may batch several notes into one docs commit.

## Checks

Use the two verification cases in `copilot-instructions.md`. You decide when to run what. **Do not
run checks after every commit.**

- **Case 1** (build plus focused Vitest runs): run it after larger items or after a batch of
  items.
- **Case 2:** run the full list **once, at the end**, when the work is being handed over for
  review, or when the PR is already out of draft.
- If a check changes files (prettier, l10n), commit those changes separately (`chore: …`).
- Report exactly which checks ran and their results. Never imply the full suite passed if it did
  not run.

## Finish

End with a short report:

- each work item, its commit SHA, and its model;
- the decisions you made, with confidence;
- the questions you escalated;
- the checks you ran and their results;
- open questions for the operator.
