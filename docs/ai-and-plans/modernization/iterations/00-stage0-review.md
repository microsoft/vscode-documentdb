---
kind: review
status: historical
---

> Re-evaluated against the merged branch in Stage 7: see [07-stage-reviews-reevaluation.md](./07-stage-reviews-reevaluation.md).

# Stage 0 AI review

Reviewer: **GPT-6 Sol**, as specified in the execution plan. Reviewed implementation commit
`e100be7d`, relative to the preparatory main merge `35622214`. The review was read-only; it ran a
scoped collision probe, not another build or full test suite.

## Findings

### F01: webpack chunk IDs crossed compilation boundaries

**Severity: medium.** The original inspector merged the host and browser compilation's numeric
chunk IDs. A missing host chunk could therefore resolve against a browser-only chunk with the same
ID. Matching output hashes did not establish which compilation owned that reference.

**Resolution: landed in `c1d29535`.** Chunk references now resolve only against the
compilation whose hash inventory owns the referencing JavaScript file. Missing/ambiguous ownership
fails explicitly. A regression test reproduces the collision, proves rejection, then checks valid
ownership and ambiguous ownership. All six inspector tests, final-VSIX inspection, and the four
repacked negative controls passed after this change.

### F02: standalone worker proof bypassed Monaco's editor integration

**Severity: medium.** The original browser harness constructed a worker at a hard-coded packaged
URL and called `doValidation` directly. That proved the worker could respond, but not that the
rendered editor started or communicated with its configured worker. A disconnected editor could
still pass.

**Resolution: completed in `c1d29535` and `0be05e8c`.** The standalone worker is removed. The helper edits each rendered
Monaco textbox, reconstructs the production worker's synchronized model, and requires a correlated
response for that model containing the probe text. Collection View uses its actual editor-worker
Unicode-highlighting response; its main-thread query validator is not counted as worker proof.
Document View requires a configured JSON-worker validation response with diagnostics.

The original browser passes are evidence for rendering, CSS, and packaged worker capability, but
are superseded as proof of editor-worker integration. Parent reruns exposed navigation/readiness
failures; `0be05e8c` activates the page, waits for bounded actual readiness, focuses the editor and
verifies selection before entering the probe, without changing CSP/product code or skipping errors.

The final all-five run passed on the corrected VSIX
`1a9ed2a78bbbfc5221221d65c2a2495c98a4a37668b048e8dcdd9cb4c966a541` at 2026-10-02 08:21 UTC.
Both editor-originated round-trips passed; the CSS-negative case produced seven expected failures
with otherwise clean diagnostics. The final local build, 30 native tests and 45 browser Jest tests
passed. Compact metadata and six reports persist in the execution session's
`s0-l2-final-vsix-1a9e` directory.

## Verification limits and outstanding gates

- The reviewer did not repeat the author's complete L1/L2 checks.
- Real installed-host L3, including the injected partial-activation failure, passed in GitHub
  Actions run [36979370550](https://github.com/microsoft/vscode-documentdb/actions/runs/36979370550)
  at `a6689e76`.
- ADO is operator-run; only its offline, pre-signing wiring was changed.
- The installed-VSIX G0 manual checklist has not passed.
- Current browser graphs have zero BSON implementations. Allowing zero there, while requiring one
  in the host/worker and rejecting duplicates everywhere, is an explicit baseline deviation awaiting
  operator confirmation.
- PR #880 remains draft. This is the per-stage AI review, not the final CONTRIBUTING Case 2
  ready-for-review pre-review/handover.

## Post-review real-host findings

GitHub Actions progressed beyond the initial offline checks:

- `c37882ea`: code quality, product tests, packaging and L1 passed. Electron failed before host
  startup because the extracted SUID sandbox helper could not run on Linux Actions.
- `afc08faa`: the Linux-Actions-only launch correction allowed installed activation and the probe
  to complete. Captured logs exposed a trace-manifest classification false positive and a genuine
  SchemaStore/output-channel disposal ordering defect.
- `ffac8111`: the false positive is fixed without suppressing genuine errors. Schema disposal is
  registered before its logging dependency, preserving other subscription ordering. Twenty-nine
  schema tests and twenty-two activation tests passed, as did the local build and rebuilt-artifact
  L1 positive/negative checks. Actual positive/negative host CI is pending.
- `a6689e76`: the injector resolves the extensionless production entry through Node before checking
  realpath containment. Twenty-four offline activation tests passed. Run
  [36979370550](https://github.com/microsoft/vscode-documentdb/actions/runs/36979370550) passed all
  CI jobs, including genuine positive activation with clean logs and genuine late-command-complete
  negative activation rejected for the injected swallowed error.

This lifecycle fix was not in the original reviewed implementation. The author verified it with
targeted regression tests and captured real-host evidence; the original GPT-6 Sol review is not
claimed to have covered this later product change. It was a narrow, explicitly recorded extension
of Stage 0 needed to retain a strict log gate, not an excuse to ignore shutdown errors.
