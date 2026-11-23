---
feature: connection-lifecycle
kind: review
status: active
created: 2026-11-23
---

# PR3 pre-review: client identity and lifecycle

Reviewed [PR #1113](https://github.com/microsoft/vscode-documentdb/pull/1113) at `657c9b2cf`,
against `96085c1dd`. GPT-6.2-Sol performed the initial review and Claude Opus 5.5 validated
the findings. The operator approved the dispositions on 2026-11-23.

| Finding | Approved disposition |
| --- | --- |
| Canceling the decoded-password retry could invalidate a startup shared by another caller. | Fix in PR3 (90% advisor confidence). Treat the canceled wait like the first attempt: record cancellation without showing another failure modal or evicting the shared client or credentials. |
| The passive index-count badge could start or replace a client. | Fix in PR3 (95%). Apply the existing background restriction to the count, not to explicit Indexes expansion. |
| A changed Kubernetes forwarded port could cause an identity mismatch if the old closed binding is still cached. | Defer stable tunnel fingerprints to [#1105](https://github.com/microsoft/vscode-documentdb/issues/1105) (85% confidence in the finding). Keep the identity check in place, per [decision 0009](../decisions.md#0009-kubernetes-tunnel-recovery-cluster-id-case-handling-and-wider-network-resilience-testing-move-to-1105). |

## Implementation and verification

- `e751df24b` (`gpt-6.2-sol`) preserves the shared startup and credentials when the
  decoded-password wait is canceled. Its regression checks cancellation reporting, the existing
  pre-retry eviction, and the absence of failure UI or cleanup after the canceled wait.
- `db01f24a5` (`gpt-6.2-sol`) marks only the passive index count as background. Tests pin
  the background flag and preserve the foreground expansion call.
- The operator approved keeping the fingerprint check unchanged and deferring stable tunnel
  fingerprints. The feature decisions and both plans record this limitation.

Case 1: the build and 95 focused tests passed with both fixes. Full Case 2 verification is
pending.
