---
feature: e2e-testing
kind: readme
status: planned
created: 2026-10-14
---

# E2E testing

**Status:** planned for the iteration after build-and-test modernization.

The next iteration turns the current artifact checks into a small installed-workbench E2E system.
It inherits:

- the L2 production harness, whose useful coverage should move into E2E;
- L2-dev typed scenarios, with assertions wired into CI and screenshots kept as artifacts;
- L3 installed-VSIX activation, extended into focused Extension Host integration journeys;
- real `vscode-webview://` coverage for resources, workers, themes, and host messages;
- cold-start URI, Azure discovery, telemetry dispatch, and macOS coverage gaps recorded by the
  modernization review.

The suite is intentionally separate from the completed Vite and Vitest migration. Its runtime,
fixtures, tags, notification path, and installed-VSIX lanes need their own implementation and
review.

## Binding decisions

- [0002: CI runs verification in tiers](../build-and-test-stack/decisions.md#0002-ci-runs-verification-in-tiers-and-reports-what-it-ran-and-why): E2E joins the full tier, never runs on draft PRs, and reports every job or skip reason in the combined CI comment.
- [0003: negative controls are path-scoped](../build-and-test-stack/decisions.md#0003-negative-controls-run-when-their-check-changes-not-every-pr): proofs that checks can fail run when their check changes and in full runs, not on every PR push.

## Starting point

The research, candidate architecture, test-count guidance, and rejected alternatives are in
[strategy.md](./strategy.md). The current build and test layers are documented in the
[build-and-test-stack README](../build-and-test-stack/README.md).
