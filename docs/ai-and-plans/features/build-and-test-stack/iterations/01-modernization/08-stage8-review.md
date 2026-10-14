---
feature: build-and-test-stack
kind: review
status: active
---

# Stage 8 review: decided modernization findings

- **Date:** 2026-10-12.
- **Reviewer model:** GPT-6 Sol, independent review.
- **Range:** `d9b85811..8e27139d` on `dev/tnaum/modernization`; code at `8e27139d`.
- **Method:** Compared the 17 commits, their code diffs and the W1 to W17 records with the G7 decisions and relevant finding evidence. Read the affected verification, CI, package, webview and documentation paths; ran focused tests, no-emit checks, GitHub run queries and isolated archive probes. No commits, pushes or GitHub writes.

## Summary

Four findings: **0 critical, 0 high, 2 medium, 2 low, 0 info**. W3's new archive handling accounts for three. The remaining finding affects the default developer build task after W5. No finding requires reversing the G7 decisions.

## Findings

### S8-F01: archive package names can redirect extraction

- **Severity:** medium.
- **Validation:** A throwaway `.tgz` with `name: "../../../escaped"` and ordinary `package/` file entries made the verifier's own `extractFiles` call write `dist/index.js` outside the consumer's `node_modules`. The probe was confined to a disposable directory under `~/.cache/documentdb-modernization/review-scratch/`, which was deleted.
- **Where:** [check-packages.mjs](../../../../../../build/verification/package-checks/check-packages.mjs#L207), [tarball.cjs](../../../../../../build/verification/package-checks/tarball.cjs#L67).
- **What is wrong:** `extractFiles` checks each member relative to its supplied destination, but `entry.name` from the archive's `package.json` constructs that destination without validation. A name containing `..` moves it outside the consumer, potentially outside the temporary work directory. The reader's member-path guard does not protect against an archive-controlled extraction root. ADO-produced `npm pack` archives should have valid names; the `--archives` interface itself makes a stronger confinement claim than it enforces.
- **Solutions:** (1) Validate package names against npm's scoped/unscoped naming rules and require the resolved destination to remain under the intended `node_modules`. **Pros:** preserves the consumer layout and rejects malicious metadata. **Cons:** adds explicit name validation. (2) Derive safe temporary directory names independent of the manifest and map them to package entry points. **Pros:** separates archive identity from filesystem placement. **Cons:** complicates module resolution.
- **Recommended:** 1, with a malicious-manifest regression test on both path separators.
- **Author decision (operator, G8, 2026-10-12):** "agree". Fixed in `4cc5b0f2` with an exact allow-list of the six workspace package names and a destination guard, with tests.

### S8-F02: duplicate archive entries let validation inspect different bytes from the consumer

- **Severity:** medium.
- **Validation:** A throwaway tarball with two `package/package.json` entries gave `readTarball(...).files.find(...)` the first manifest, while `extractFiles` installed the second. The first exported an existing file; the installed manifest exported a missing file. Both reads and extraction succeeded. The files were removed after the probe.
- **Where:** [check-packages.mjs](../../../../../../build/verification/package-checks/check-packages.mjs#L200), [tarball.cjs](../../../../../../build/verification/package-checks/tarball.cjs#L51), [tarball.cjs](../../../../../../build/verification/package-checks/tarball.cjs#L70).
- **What is wrong:** The target check validates the first `package.json`, but extraction overwrites it with the last. A later unprobed export or `files` entry can therefore evade `packageTargetFailures` even though it is present in the installed manifest. Duplicate scripts can likewise be scanned after extraction using different bytes from their reported archive entries. Normal `npm pack` does not intentionally produce duplicate members, but the offline reader must not certify an ambiguous archive.
- **Solutions:** (1) Reject duplicate normalized member paths in `readTarball`. **Pros:** fail closed before probes; matches the single-file-per-path publication contract. **Cons:** rejects exotic tarballs with intentional overwrites. (2) Check only the last occurrence. **Pros:** matches extraction. **Cons:** leaves ambiguous bytes and tool-dependent behavior.
- **Recommended:** 1, with a duplicate-manifest negative control.
- **Author decision (operator, G8, 2026-10-12):** "agree". Fixed in `4cc5b0f2`: duplicate member paths are rejected, with a test.

### S8-F03: truncated tar members are accepted as complete files

- **Severity:** low.
- **Validation:** In a disposable archive, changed a member's octal size field to exceed the decompressed tar length. `readTarball` still returned that member with a shorter buffer and a SHA-256, rather than rejecting the malformed archive.
- **Where:** [tarball.cjs](../../../../../../build/verification/package-checks/tarball.cjs#L29).
- **What is wrong:** The parser slices the body before checking that `size` is a valid nonnegative integer or that the body and padding fit in the decompressed archive. `Buffer.subarray` silently clips an oversized range. A malformed archive can therefore be reported and, if the damaged member is outside the probed entry points, accepted as though it were complete. `gunzipSync` detects gzip corruption, not a tar header that lies about member size.
- **Solutions:** (1) Validate the octal field, header boundaries, body length and padded offset before accepting each member. **Pros:** fail closed on malformed tar. **Cons:** slightly more parser code and tests. (2) Use a maintained tar parser with equivalent strict checks. **Pros:** broader format coverage. **Cons:** changes the offline dependency story.
- **Recommended:** 1, with oversized and malformed-size controls.
- **Author decision (operator, G8, 2026-10-12):** "agree". Fixed in `4cc5b0f2`: size fields and member bounds are validated, with tests.

### S8-F04: the default VS Code build task no longer builds output

- **Severity:** low.
- **Validation:** Configuration inspection: the default build task still runs `npm run compile` (`tsc -watch`), while the root `tsconfig.json` now has `noEmit: true`. A direct root `npx tsc -p tsconfig.json --noEmit` passed. The separate `Watch` task and extension-host launch configuration still use Vite output in `dist/`.
- **Where:** [.vscode/tasks.json](../../../../../../.vscode/tasks.json#L5), [package.json](../../../../../../package.json#L67), [tsconfig.json](../../../../../../tsconfig.json#L6).
- **What is wrong:** After W5, the default VS Code build shortcut starts a long-running type-check with no emitted JavaScript, despite being labeled as the default build. `Watch` remains the working F5 launch prerequisite, but the build shortcut no longer produces runnable artifacts and `npm run compile` contradicts the repository's instruction to use `npm run build`.
- **Solutions:** (1) Point the default build task at the established Vite build/watch tasks and give the no-emit watcher a clearly named optional type-check task. **Pros:** restores the expected shortcut while keeping continuous diagnostics. **Cons:** changes task startup behavior. (2) Remove the default-build designation and document `Watch` as the build task. **Pros:** minimal change. **Cons:** removes the usual build shortcut.
- **Recommended:** 1, checking task readiness and F5 launch in VS Code.
- **Author decision (operator, G8, 2026-10-12):** "agreed". Fixed in `e396a92d`: `Watch` is the default build task and the type-check watcher is a separate task; F5 check pending.

## Checked And Sound

- W1 restored the existing `glob` override; W2 removed the baseline-only drift report and its corresponding control without removing required-file, runtime-asset or size-budget checks. The PR size report still reads the graph report rather than the deleted baseline.
- W3's packed-test and missing-target negatives passed; ADO packs exactly two selected tarballs and the added PowerShell step checks `$LASTEXITCODE` after `node`. General CI has no event-specific condition on package verification. The publish job retains `if: !inputs.dry_run`; only that job has the publishing environment, OIDC permission and non-dry-run `npm publish` steps.
- W4's TypeScript `node16`/`node18` caveat distinguishes compiler behavior from Node.js `require(esm)` support. W6's root and six package no-emit checks passed. W10's mock-identity test and W11's per-resolved-file cache tests passed; the optional argument preserves the default package layout. W12's BSON and lowered-import positive and negative tests passed, and W13's ambiguous-owner test passed. W7 to W9 and W15 to W17 were consistent with the recorded decisions, subject to the limits below.
- W8 points to the decision record and qualifies the old design. W14's three cited GitHub runs match their recorded head SHAs and job conclusions: `37021977737` and `37068033773` succeeded in four jobs, and `37051119892` failed Code Quality & Tests while the other three jobs were skipped. The notes distinguish operator attestation from observed runs. W16's 0.11.2 notes describe intended improvements without claiming the release already shipped.

## Verification Limits

- Focused `node --test` on the package-archive, L1, BSON and lowered-import tests: **62 passed**. Focused `npx vitest run` on mock identity, error helpers and shell API registry: **4 files, 23 tests passed**. Root `npx tsc -p tsconfig.json --noEmit` and `npm run typecheck:tests` (all six packages): **passed**. `git diff --check d9b85811..8e27139d`: **passed**.
- Did not run `npm run build` because its `prebuild` emits package `dist/` files, or packaging, install, full CI, ADO on Windows, the VS Code debugger, an L2 browser run or a publish dispatch. The ADO PowerShell and publishing gates are source-reviewed, not observed at this commit. The known Stage 8 follow-ups S8-N01 to S8-N04 remain recorded in the plan.
- This is Case 1 on a draft PR. The Case 2 suite, including `prettier-fix`, is deferred to the ready-for-review handoff. No temporary probe files remain in the checkout.
