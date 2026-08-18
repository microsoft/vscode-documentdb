# Contributing to DocumentDB for VS Code

Thank you for your interest in contributing to the **DocumentDB for VS Code** extension. This guide helps you set up your development environment and configure Visual Studio Code to effectively contribute to the extension.

The document consists of seven sections:

1. [Branching Strategy](#1-branching-strategy)
2. [Machine Setup](#2-machine-setup)
3. [VS Code Configuration](#3-vs-code-configuration)
4. [PR Submission Checklist](#4-pr-submission-checklist)
5. [Documenting Work with AI](#5-documenting-work-with-ai)
6. [AI-Assisted Review Workflow](#6-ai-assisted-review-workflow)
7. [Release Process](#7-release-process)

## 1. Branching Strategy

### 1.1 Branch overview

| Branch               | Purpose                                                                                         | Force pushes  | Lifetime                                  |
| -------------------- | ----------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------- |
| `main`               | Default trunk. All PRs target it. Always open. Releases are tagged here.                        | No, protected | Long-lived                                |
| `dev/<user>/<topic>` | Personal working branches                                                                       | Allowed       | Short                                     |
| `feature/<name>`     | Shared collaboration on large features before they are ready for `main`                         | Discouraged   | Variable                                  |
| `release/<X.Y>`      | Created only when a patch must ship while `main` is not releasable. Branched off a release tag. | Discouraged   | Short (deleted after the patch is tagged) |

See [1.6 Force-push policy](#16-force-push-policy) for the rules behind the force-push column.

### 1.2 GitHub Actions

CI runs automatically on:

- **Push to `main` or a release branch** (`release/**`) — full build, tests, and packaging; build sizes cached for PR comparisons.
- **Pull requests targeting `main`, `release/**`, or `feature/**`** — full build, tests, packaging, and a code-quality report posted as a PR comment.
- **Manual dispatch** — use `workflow_dispatch` with `enforce_full_run` to run the full pipeline on any branch.

### 1.3 Releases

Releases are tags-first. Normally there are no release branches at all:

1. When the team is ready to release, a maintainer tags a chosen `main` commit, for example `v0.9.0`. Every release has a tag.
2. Later patch releases (`v0.9.1`, `v0.9.2`, and so on) normally tag later commits on `main` in the same way.

The tag is the immutable marker of what shipped, not the publication source: the Marketplace pipeline builds and publishes from the branch (see [§7.9](#79-publish-to-the-marketplace)). Tag the commit you intend to release, and release from that commit.

A `release/<X.Y>` branch is created for one scenario only: a quick patch release must ship while `main` is not yet in a releasable state. In that case:

1. Branch `release/<X.Y>` off the relevant release tag, for example off `v0.9.0`.
2. Apply the patch on that branch and open it as a PR to `release/<X.Y>`.
3. Tag the patch release (`v0.9.1`) on that branch and run the release pipeline against it.
4. Forward-merge the fix back into `main` so `main` stays up to date.
5. Delete the release branch. The tag preserves the release permanently, so deleting the branch is safe and loses nothing. If another patch is needed later, re-branch from the tag.

**The tag is the release.** If you have a PR you want in the upcoming release, merge it to `main` before the release is tagged. Once a version is tagged, new PRs merged to `main` target the _next_ release.

> **Example:** The team is preparing v0.9. A contributor submits PR #690, a small connection timeout fix the team wants to include. The maintainer merges #690 to `main`, then tags `v0.9.0` on that commit, so the fix is in. Later, a critical bug is found but `main` already contains half-finished work for v0.10. The maintainer branches `release/0.9` off the `v0.9.0` tag, applies the fix, tags `v0.9.1` from that branch, forward-merges the fix into `main`, and then deletes `release/0.9`.

### 1.4 Large features

Large features — those that span multiple PRs, touch core subsystems, or carry meaningful integration risk — live on a `feature/<name>` branch until they are merge-ready as a whole. A maintainer merges individual PRs into the feature branch as work progresses. When the feature is complete and validated end-to-end, a single PR from `feature/<name>` to `main` brings it in.

**Why this helps quality.** The real benefit is that every individual PR against the feature branch receives the full sweep of reviews, the same bar we apply anywhere else. Instead of one massive PR that is hard to review well, the work arrives as scoped, self-contained items that are easy to reason about. By the time the feature branch is ready, each component and contribution has already been reviewed on its own, so we have far more trust in the quality of the whole. The feature branch is still reviewed ahead of merging into `main`, but that final review builds on a foundation of already-vetted pieces rather than starting from scratch. This structure is not a gimmick to keep the process complex, it genuinely helps us keep the product's quality high.

> **Example:** The integrated shell was built across more than 10 dedicated PRs, each reviewed and merged into `feature/shell`. Once the feature was complete and validated as a whole, it landed on `main` in a single PR.

Before opening the final PR from a feature branch to `main`:

- [ ] All sub-tasks complete; no unresolved `TODO` markers in core paths
- [ ] Validated against a packaged VSIX (not only dev mode)
- [ ] Telemetry instrumented
- [ ] CHANGELOG / docs entry drafted
- [ ] Behind a setting (default off) if there is any doubt about stability
- [ ] Author commits to monitoring for fallout for ~1 week after merge

### 1.5 External contributions

All external PRs target `main` and are reviewed at the team's normal pace.

If a PR is approved but the team wants to defer merging — for example, to avoid introducing uncertainty during an ongoing release cycle — a maintainer will:

1. Mark the PR as **Draft**.
2. Apply the **`on-hold`** label.
3. Leave a short comment with the reason and expected timeline, e.g.: _"Approved — holding until v0.9 ships (~2 weeks). No action needed from you."_

To release the hold: remove the `on-hold` label and click **Ready for review**, then merge normally.

### 1.6 Force-push policy

Shared branches are collaboration surfaces, so an uncoordinated force push can destroy a collaborator's work. The rules below reflect that:

- **`dev/*`** (personal working branches): force pushes are **allowed**. This is where individuals work, so rebasing, squashing, and history cleanup are expected.
- **`feature/*`** and **`release/*`** (collaboration branches): force pushes are **discouraged but not blocked**. There are legitimate cases where a force push is needed to clean up history. When one is necessary, it MUST be coordinated with everyone working on that branch first.
- **`main`**: protected. No force pushes. PRs only.

The relaxed protection on `feature/*` and `release/*` is a deliberate escape hatch, not an invitation.

## 2. Machine Setup

> **Platform coverage:** The detailed setup instructions below are written for **Windows + WSL2**. Stub sections for [macOS](#22-macos-pending), [Windows (native)](#23-windows-native-pending), and [plain Linux](#24-linux-pending) are included but not yet filled in; Contributors on those platforms are warmly invited to submit a PR expanding those sections!

---

### 2.1. Windows + WSL2 _(documented)_

Follow these instructions to configure your machine for JavaScript/TypeScript development using Windows Subsystem for Linux (WSL2) and Visual Studio Code.

#### 2.1.1. Install Ubuntu 22.\* on Windows

- Install **Ubuntu 22.\*** from the Microsoft Store and launch it to configure your Linux user account.
  - Your development environment and tools will reside within `WSL2`.
  - VS Code integrates seamlessly with `WSL2` instances, enabling smooth development from your Windows machine.

#### 2.1.2. Update Ubuntu Packages

Open your Ubuntu terminal and run:

```bash
sudo apt update
sudo apt upgrade
```

#### 2.1.3. Install Node.js with FNM (Fast Node Manager)

`FNM` helps with installing and switching Node.js versions easily. This is useful for testing compatibility across different Node.js versions.

The minimum required versions are **Node.js 22.18.0** and **npm 10.0.0** (see `engines` in `package.json`).

Run the following commands:

```bash
curl -fsSL https://fnm.vercel.app/install | bash
source ~/.bashrc
fnm install 22.18.0
fnm use 22.18.0
fnm default 22.18.0
node --version   # should print v22.18.0 or later
npm --version    # should print 10.x or later
```

#### 2.1.4. Install TypeScript Globally (optional)

```bash
npm install -g typescript
```

---

### 2.2. macOS _(pending)_

> **Help wanted!** If you develop on macOS, please consider contributing setup instructions for this section. The general flow (install Node.js via a version manager such as `nvm` or `fnm`, clone the repo, `npm install && npm run build`) should be very similar to the WSL2 path above.

---

### 2.3. Windows (native) _(pending)_

> **Help wanted!** If you develop on Windows without WSL2, please consider contributing setup instructions for this section.

---

### 2.4. Linux _(pending)_

> **Help wanted!** If you develop on Linux natively, please consider contributing setup instructions for this section. The WSL2 Ubuntu steps above should translate almost verbatim.

## 3. VS Code Configuration

This section explains how to clone the **DocumentDB for VS Code** repository and set up Visual Studio Code for development and debugging.

### 3.1. Steps to Clone and Set Up Repository

1. Ensure you have completed the [Machine Setup](#2-machine-setup) steps.

2. Fork or directly clone the official repository:
   - [DocumentDB for VS Code (vscode-documentdb)](https://github.com/microsoft/vscode-documentdb)

   - Open your **WSL2** terminal and clone the repository:

```bash
cd ~
git clone https://github.com/microsoft/vscode-documentdb
```

3. Install dependencies and build the project:

```bash
cd ~/vscode-documentdb
npm install
npm run build
```

### 3.2. Launching and Debugging in VS Code

To effectively isolate development environments, it is beneficial to create and use a separate VS Code profile.

1. Open the cloned repository in VS Code:

```bash
cd ~/vscode-documentdb
code .
```

2. Start debugging the extension:
   - Switch to the `Run and Debug` panel.
   - Select `Launch Extension (webpack)`.
   - Press `F5`.

## 4. PR Submission Checklist

There are two cases. Work out which one you are in, then run **only** that list.

| Case                                                                                | Run                                                             |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Case 1 — still working** — any commit, any push, opening or updating a draft PR   | The fast loop ([§4.1](#41-case-1--still-working-the-fast-loop)) |
| **Case 2 — handing over** — marking a PR ready for review, or calling the work done | The full list ([§4.2](#42-case-2--handing-over-the-full-list))  |

A draft PR is **not** a hand-over. It exists to hold commits, CI, and discussion while the work is still moving, so stay on the fast loop until you mark the PR ready for review.

### 4.1. Case 1 — still working: the fast loop

```bash
npm run build                     # catches type errors
npx jest --no-coverage <path>     # only the tests covering what you touched
```

Nothing else. `l10n`, `prettier-fix`, `lint`, and `package` each cost minutes and say nothing about whether the change is correct.

### 4.2. Case 2 — handing over: the full list

All of these must pass locally. The same checks run in CI, so catching failures here saves time.

```bash
npm run l10n            # only if a vscode.l10n.t() string was added, changed, or removed
npm run prettier-fix
npm run lint
npx jest --no-coverage  # full suite
npm run build
npm run package         # catches bundling and missing-asset failures
```

Commit whatever these change, including regenerated files under `l10n/` and anything Prettier reformats.

### 4.3. Notes on individual steps

- **`npm run l10n`** regenerates the localization bundle from the strings passed to `vscode.l10n.t()`. **Never resolve a conflict in `l10n/bundle.l10n.json` by hand** — the file is generated. Take either side, or delete it, then re-run `npm run l10n` and commit the result.
- **`npm run prettier-fix`** covers Markdown as well as source, so documentation formatting does not drift whenever a file is touched. Fenced code blocks are left exactly as authored: they are often partial or illustrative, and reformatting them to the Markdown tab width would leave every example disagreeing with the code it documents.
- **`npm run package`** catches webpack bundling issues and missing assets that unit tests alone will not surface.

## 5. Documenting Work with AI

This section is for new contributors, code maintainers, and AI agents. It describes where documentation about work done with AI lives so that decisions and reasoning stay discoverable long after a PR merges.

The canonical location is `docs/ai-and-plans/`. Start at [`docs/ai-and-plans/README.md`](docs/ai-and-plans/README.md), which carries the feature index and the full layout rules.

Durable knowledge belongs to the feature that owns it. Iteration files preserve the plans, reviews, and implementation history of one round of work. Decisions that remain relevant across iterations are recorded in the feature's `decisions.md`. PR and commit links are kept as provenance; the PR number is no longer the navigation key.

### 5.1 Where a document goes

**Almost everything belongs to a feature.**

- **An existing feature** — `docs/ai-and-plans/features/<feature>/`. Durable documents (`design.md`, `decisions.md`, references, `future-work.md`) sit flat at the feature root. The history of one round of work goes in `iterations/NN-slug.md`, or `iterations/NN-slug/` once it grows past roughly three documents. Two documents for one iteration share the number and are told apart by a genre suffix, for example `01-item-counting-tree.md` and `01-item-counting-tree-review.md`.
- **A new feature** — create `docs/ai-and-plans/features/<slug>/` with a `README.md`. Pick a slug a contributor who has never seen the repo would guess; never an abbreviation or an invented umbrella term. Add it to the feature index in the knowledge-base README.
- **A document that touches several features** still belongs to one of them. File it under the feature it is the origin story or the implementation log of, and cross-link the siblings.
- **A document that genuinely belongs to no feature** is a single file at the root of `docs/ai-and-plans/`.

There is no `misc/`, no `general/`, and no bucket folder for "the rest". A folder named for the absence of a property invites exactly the judgment call this layout exists to remove.

Every document under `features/` carries frontmatter with at least `feature`, `kind`, and `status`; root-level documents carry `kind` and `status` only. `code:` globs on durable documents are the only route from a source path back to its rationale; add them where you can.

### 5.2 What a decision record must contain

The decision log must capture decisions **and the reasons behind each decision**. Recording the reasoning shortens review loops: a reviewer, human or agent, who can see why a choice was made often does not need to ask. The code alone is not enough — the context is what makes review efficient.

Entries in `decisions.md` are semantically immutable. Append new entries rather than rewriting old ones, and record a reversal as a new entry plus a status change in the table at the top. The "changed from the proposal?" column is the highest-signal content in the whole knowledge base: it records what the human changed about the agent's proposal.

### 5.3 Draft PRs

Work that is still in progress must be opened as a **draft** pull request. This prevents the automatic GitHub Copilot review from kicking in before it is wanted.

Documents do not wait for a PR number. The feature slug exists before the PR does, so write into the feature folder from the start.

### 5.4 Keep the feature docs current

If a PR changes behavior described in a feature's current documents, update `features/<feature>/README.md` (and `design.md` if applicable) in the same PR.

## 6. AI-Assisted Review Workflow

Contributors are expected to pre-review their own code with AI before requesting human review. The goal is to shorten the human PR-review loop by catching issues earlier. This is the repo maintainer's expectation, not optional polish. The stages below produce a structured review file that is committed into the relevant feature's `iterations/` folder under `docs/ai-and-plans/`.

> **Note:** Some of these prompts will be turned into skills in the near future. They are recorded here now for transparency and to help current contributors.

### 6.1 Stage 1: AI review pass (run by the contributor)

A multi-step review that produces a committed review markdown file stored in `docs/ai-and-plans/features/<feature>/iterations/`:

1. **Initial edge-case review** using a stronger model from one vendor. Every issue gets a severity level. Findings are written to the review markdown file in the PR folder.
2. **Merge the Copilot reviewer comments.** Pull the GitHub Copilot reviewer's comments from the PR, merge them into the same file, and reassess the severity of each. Keep a link to each reviewer comment so it can be referenced later in follow-up responses.
3. **Validation gate** using a stronger model from a different vendor than the first, at standard context. A 1M or extended context window is not needed here because everything is already scoped at this point, so the standard context window is sufficient. This gate verifies each finding against the codebase to confirm valid vs false positive, reassesses severity, and for each issue proposes one or more solutions with pros and cons and a recommended option. It filters out false assumptions made by the earlier passes.
4. **Independent sweep:** the model looks beyond the captured issues for additional risks not identified earlier, and proposes solutions for them too.

Output: a well-structured review file that must be checked in.

### 6.2 Stage 2: Author decisions

**This is the actual contribution, and it matters most.** The PR author reviews each suggestion in the review file and has the agent record the author's decision, with reasoning, inline in the review file. This is where the author is expected to invest real time. It is what lets future code maintainers understand why decisions were made. Recording these decisions with their reasoning is the maintainer's expectation.

### 6.3 Stage 3: Coding agent implements the fixes

Prompt guidance for the coding agent:

- Report progress inline for each work item.
- If it deviates from the task, document the reasoning.
- Move forward only when confidence is above 80 percent; otherwise stop and ask the operator.
- Commit each work item individually. No mass commits. For each: commit, push, then post a comment in the review markdown file summarizing what was done and why, with a link reference to the commit.
- Post the same comment on GitHub in the PR, one comment per pushed commit.
- If a fix addresses a comment from the Copilot reviewer, post the comment as a reply in the thread of that review.

### 6.4 Stage 4: Author final review

- The author reviews the changes. Looking at individual commits is easier, and the review file makes the changes visible.
- Then the author goes to the GitHub review page and ensures everything the Copilot reviewer asked for has been addressed, and resolves those discussions.

This process keeps the quality bar high.

### 6.5 Escape hatch: create issues instead of blocking the PR

For complex problems, or general problems the review discovers, the author is free to ask the agent to create an issue on the repo and summarize it. This makes sense especially for low-severity, nice-to-have items. It lets the PR move forward while keeping track of things that can be done in another iteration, and it is a good source of "good first issue" items for future contributors.

### 6.6 Reviewing UX and workflows with an agent (recommended, under evaluation)

> **Status:** This is a **recommendation**, not a hard rule. The workflow is currently in use and being evaluated, so treat it as a pattern to try and give feedback on rather than a fixed process.

The stages above target code review. UX and workflow review is different: the value comes from actually using the extension and walking real user journeys, not from reading a diff. The pattern is a **person paired with an agent** — you steer and report what you see, the agent verifies each claim against the code and keeps the log.

**Use the [`ux-pr-review`](.github/skills/ux-pr-review/SKILL.md) skill.** Ask an agent to "prepare a UX review for PR #NNN". It owns the procedure, the document template, the status legend, and the worked examples. None of that is repeated here, so there is only one copy to keep correct.

The gist, and the part that is yours rather than the agent's: **a UX review is worth what gets written down.** Every discovery, the decision taken on it, and the **reason** for that decision go into a running log committed to the feature's `iterations/` folder under `docs/ai-and-plans/`. Phase the work by user journey and close each phase out before starting the next, so the log stays readable and the agent's context stays lean. A decision recorded without its rationale gets re-litigated later by someone reading the code and wondering why.

## 7. Release Process

This section is for maintainers cutting a release. It is written so a maintainer, with or without an AI agent, can follow it end to end. The steps assume the release content has already been decided and the relevant PRs are merged to `main` (see [1.3 Releases](#13-releases)).

Throughout, `X.Y.Z` is the version being released, for example `0.9.2`.

### 7.1 Generate the changelog and release notes

Use the `writing-release-notes` skill to produce both the `CHANGELOG.md` entry and the `docs/release-notes/X.Y.md` release notes. The skill knows how to format and split the output; steer it when needed.

Gather the raw material from the milestone for this release:

- **All PRs merged into `main` with milestone `X.Y.Z` attached.**
- **All closed issues assigned to that same milestone.**

Ask the agent to deduplicate and merge the two lists: a single change is often represented by both an issue and its PR, and should appear only once. The skill can process these inputs, but it relies on good source material, so **PRs must have meaningful descriptions.** Thin or empty descriptions produce thin release notes and force manual rewriting.

Review the generated files and edit for accuracy before continuing.

### 7.2 Add screenshots

Release notes carry screenshots; the changelog does not. Take the screenshots by hand — only a person can drive the extension to the right state — then hand them to the agent and ask it to place them. Save them under `docs/release-notes/images/` named `X.Y.Z_feature_name.png`.

The `writing-release-notes` skill owns the exact markup and the width conventions (full-width versus dialog crops); see its `RELEASE-NOTES-FORMAT.md`. Do not hand-write the `<img>` tags.

### 7.3 Commit the notes

Commit the generated `CHANGELOG.md`, `docs/release-notes/X.Y.md`, and any images added in the previous step.

### 7.4 Bump the version

1. Update the `version` field in `package.json` to `X.Y.Z`.
2. Run `npm install` so the lock file (`package-lock.json`) is regenerated with the new version.

Running `npm install` here is required: bumping `package.json` alone leaves the lock file out of sync.

### 7.5 Create the announcement discussion

Based on the `docs/release-notes/X.Y.md` file, create a new discussion under **Discussions** on the GitHub repo. This is the user-facing announcement for the release.

An agent can create it for you. GitHub's REST API has no endpoint for discussions, so this goes through GraphQL. First look up the repository ID and the category you want:

```bash
gh api graphql -f query='
{
  repository(owner: "microsoft", name: "vscode-documentdb") {
    id
    discussionCategories(first: 20) { nodes { id name } }
  }
}'
```

Then create the discussion, using the release-notes body:

```bash
gh api graphql -f query='
mutation($repo: ID!, $cat: ID!, $title: String!, $body: String!) {
  createDiscussion(input: {repositoryId: $repo, categoryId: $cat, title: $title, body: $body}) {
    discussion { url }
  }
}' -f repo=<repository id> -f cat=<category id> -f title="vX.Y.Z" -f body="$(cat docs/release-notes/X.Y.md)" \
  --jq '.data.createDiscussion.discussion.url'
```

The mutation returns the discussion URL, which is what the next paragraph needs.

If this is **more than a patch release** (a new minor or major, `X.Y.0`), copy that URL into the `releaseNotesUrl` field in `package.json` so users see the announcement from inside the extension. For a plain patch release, leave `releaseNotesUrl` pointing at the current minor's announcement.

### 7.6 Commit the version bump

Commit `package.json`, the updated `package-lock.json`, and any `releaseNotesUrl` change together.

### 7.7 Build the signed artifact

Run the internal Azure DevOps **build** pipeline. It produces a **signed** `.vsix`. Download that artifact.

Always ship the signed artifact from the pipeline. A locally packaged `.vsix` is unsigned and must never be published or attached to a release.

### 7.8 Create the GitHub release

1. Create a release on GitHub with a new tag `vX.Y.Z`, pointing at the release commit on `main`.
2. Use this version's section of `CHANGELOG.md` as the release body.
3. Attach the **signed** `.vsix` downloaded in the previous step.
4. Save the release.

### 7.9 Publish to the Marketplace

Run the second internal Azure DevOps pipeline, the **release** pipeline, which publishes from `main` to the Visual Studio Marketplace. This is a separate pipeline from the build in §7.7: one produces and signs the artifact, the other ships it.

## You're Ready to Contribute! 🎉

You've now successfully set up your development environment and are ready to contribute to **DocumentDB for VS Code**. We appreciate your contributions!
