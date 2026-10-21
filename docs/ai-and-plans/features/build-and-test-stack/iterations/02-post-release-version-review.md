---
feature: build-and-test-stack
kind: review
status: active
prs: [1042]
created: 2026-10-21
---

# Post-release version automation review

- **PR:** [#1042](https://github.com/microsoft/vscode-documentdb/pull/1042).
- **Reviewed commit:** `37df67839a25bbf503c4faddf517eaabe3bcc82c`.
- **Scope:** release filtering, the root-only version bump and its integration tests, rerun behavior,
  pull-request action inputs and outputs, explicit full-CI dispatch, merge requirements, and related
  contributor and feature documentation.
- **Method:** direct diff and code review; checked the pinned pull-request action's declared outputs,
  the repository's required checks, CI logs, and GitHub's token-trigger rules. The local build and all
  13 release-automation integration tests passed during the review.
- **Author instruction:** after receiving the review, the operator requested: "good, document and fix
  fixable issues according to the contributing md file."

## F01: pipeline inventory formatting fails the required merge gate

- **Severity:** low; merge-blocking CI failure, not a release-automation logic defect.
- **Where:** the GitHub Actions inventory table in [pipelines.md](../pipelines.md#github-actions-githubworkflows).
- **Evidence:** [CI run 39589761800](https://github.com/microsoft/vscode-documentdb/actions/runs/39589761800),
  [static-check job](https://github.com/microsoft/vscode-documentdb/actions/runs/39589761800/job/119187582908).
  Prettier reports only `docs/ai-and-plans/features/build-and-test-stack/pipelines.md`.
  The final quality check reports `l10n=success, lint=success, prettier=failure`, causing both
  `Static checks` and the required `Merge gate` to fail.
- **Recommended fix:** format the affected Markdown document with the repository's existing Prettier
  configuration. This repairs the required check without changing workflow behavior.
- **Author decision:** fix under the operator's instruction above. The confirmed formatting failure
  is the fixable issue from the review; no new product or workflow design decision is required.
- **Implementation:** F01 fixed in
  [d9dc4d09](https://github.com/microsoft/vscode-documentdb/commit/d9dc4d09):
  formatted the pipeline inventory table to restore the required Prettier check, without changing
  release-automation behavior. Targeted formatting, the Case 1 build, and all 13 release-automation
  integration tests passed. The fix was committed and pushed separately under CONTRIBUTING section 6.3.
- **Validation:** `npm run build` passed; `node --test .github/scripts/bump-version.test.cjs`
  passed all 13 tests. The focused Prettier check passed for the affected guide, this review record,
  and the feature README; `git diff --check` passed. The repository-wide `prettier-fix` command
  was not run because the PR remains a draft.

## C01: bot pull-request creation remains an operational check

- **Classification:** verification limitation, not a confirmed code defect.
- **Evidence:** the workflow-permissions endpoint returned HTTP 403 with the available credentials.
  No live bump run was performed, so actual bot PR creation and the subsequent CI dispatch have not
  been exercised together.
- **Disposition:** leave repository settings and live automation unchanged. The operator authorized
  fixing confirmed issues, not publishing a release or creating a test bump PR. Existing
  [release instructions](../../../../../CONTRIBUTING.md#78-create-the-github-release) already describe
  the required Actions PR-creation permission and the catch-up command.
- **Remaining check:** a maintainer must confirm Actions may create pull requests and observe the
  first intended bump run after merge.

## Review stages and handoff

- The initial direct review found no blocking logic defects.
- The active PR had no inline review threads or GitHub Copilot reviewer findings to merge when
  checked on 2026-10-21. Its only timeline feedback was the CI report.
- This record does not claim completion of the different-vendor validation gate or independent
  sweep in [CONTRIBUTING.md section 6.1](../../../../../CONTRIBUTING.md#61-stage-1-ai-review-pass-run-by-the-contributor).
  Those stages remain prerequisites before requesting human review.
- Keep PR #1042 in draft: this is **Case 1**, not a ready-for-review handoff. The full Case 2
  checks, including repository-wide `prettier-fix`, remain deferred until that handoff.

## Outcome

The confirmed formatting failure is fixed, validated locally, and pushed without changing the
automation implementation. F01 records the implementation commit and verification inline.
The review record and its feature-index link accompany the fix, and implementation comments are
posted on the PR. Live bot permissions and end-to-end operation remain explicitly unverified.
PR #1042 remains a draft; this is not a claim that the full pre-review or Case 2 checks have run.
