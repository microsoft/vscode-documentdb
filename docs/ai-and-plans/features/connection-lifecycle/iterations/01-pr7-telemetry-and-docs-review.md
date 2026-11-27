# PR7 pre-review: Connection recovery telemetry and docs

[PR #1135](https://github.com/microsoft/vscode-documentdb/pull/1135) · WI-9 and WI-10 · reviewed head `668ead86a`

Claude Opus 5.5 performed the first pass. OpenAI GPT-6.2-Sol independently validated the
findings and added two. That run used long context; the standard-context verification
required by CONTRIBUTING §6.1 remains open. There were no Copilot threads when checked.
Neither reviewer found a runtime issue in the bounded renewal emitter. Neither ran the
queries against live data.

## F1. The baseline can show a false drop in classified failures (high for WI-9)

The original before/after query used error fields that the new tree `connect` path masks but
the baseline did not. The
same failure can move to the unclassified bucket without any change in its frequency.
Tree expansion can also return recovery actions as a normal result.

**Recommendation:** Compare only stable RPC procedures and versions that share the same
`causeType` scheme, with the same exposure rules for both cohorts. Keep unclassified
counts visible and label tree data as descriptive, not comparable. If no comparable
cohort has enough exposure, report insufficient evidence. Do not change runtime
telemetry or relax redaction.

**Author decision:** Approved as recommended. Limit the rate comparison to stable RPC
scopes; do not add a telemetry field or change redaction.

**Fixed:** [`fe91067a8`](https://github.com/microsoft/vscode-documentdb/commit/fe91067a8)
limits the classified comparison to two database RPCs and uses `causeType` alone. Tree
events stay descriptive, and unclassified failures remain visible.

**Superseded by Copilot follow-up:** The RPCs can also return typed unavailability normally,
which is reported as SDK success. The operator [deferred the comparison](../decisions.md#0020-defer-the-cross-release-comparison-of-late-failures)
and retained descriptive telemetry for 1.2.0.

## F2. Disconnect does not wait behind an active task (medium)

The [release notes](../../../../release-notes/1.2.md) say Disconnect waits, and the
[manual](../../../../user-manual/connecting-to-databases.md#disconnect-and-reconnect)
does not explicitly tell the user to retry. The command refuses teardown and leaves
both the task and the connection running.

**Recommendation:** State in both pages that the user must try Disconnect again after
the task finishes or is stopped. No command change.

**Author decision:** Approved as recommended. Clarify that the user must retry Disconnect.

**Fixed:** [`f7607d039`](https://github.com/microsoft/vscode-documentdb/commit/f7607d039)
explains in both pages that the task and connection keep running and the user must retry.

## F3. Recovery rows can inflate replacement success counts (medium)

The [replacement query](../telemetry.md) excludes cached failures, but a first failed
tree expansion can return recovery rows while its event still reports success. It can
already carry the replacement generation at that point.

**Recommendation:** Exclude both first-time and cached recovery rows. Count confirmed
recovery only for operations whose success indicates that database work succeeded.

**Author decision:** Approved as recommended. Do not count first-time or cached recovery
rows as successful replacement operations.

**Fixed:** [`fe91067a8`](https://github.com/microsoft/vscode-documentdb/commit/fe91067a8)
counts only successful cluster expansions on a replacement generation, excluding both
first-time and cached recovery rows.

## F4. A retained Dashboard can still require Retry (medium)

The [manual](../../../../user-manual/connecting-to-databases.md#disconnect-and-reconnect)
and [release notes](../../../../release-notes/1.2.md) imply that only other views need
Retry. The Dashboard retries automatically only if reconnect opens the already
bound panel. Auto-open can be disabled.

**Recommendation:** Describe the conditional automatic retry and tell users to select
**Retry** if the Dashboard stays disabled. No behavior change.

**Author decision:** Approved as recommended. Clarify when a retained Dashboard still
needs Retry.

**Fixed:** [`f7607d039`](https://github.com/microsoft/vscode-documentdb/commit/f7607d039)
explains that the existing Dashboard retries automatically only when Reconnect opens it.
If it stays disabled, select **Retry**.

## Remaining handoff requirements

A second validation attempt could not verify its context tier or vendor and did not
review the changes. PR7 remains in draft until standard-context validation is confirmed.
Live query and ingestion verification remains pending for CP-5.

Local Case 2 passed: formatting, localization check, lint, build, strict workspace
test type-checking, 9,963 tests across 444 suites (one skipped), and VSIX packaging.
No localization strings changed in PR7.
