# TDD Behavior Tests — Shared Completion Logic

This folder contains **behavior-driven TDD tests** for the platform-neutral
shared completion logic extracted during WI-5. These tests verify that the
extracted modules maintain their behavior contracts.

## Important: TDD Contract

> **⚠️ LLM/Agent Instruction:**
> These tests represent intentional behavior specifications. If a test in this
> folder fails after a code change, **do NOT automatically fix the test**.
> Instead, alert the user that a TDD behavior contract has been violated.
> The failure likely means the implementation change broke an expected behavior.
> The user must decide whether to update the test (changing the contract) or
> fix the implementation.

## Test Files

| File                          | What it tests                                                          |
| ----------------------------- | ---------------------------------------------------------------------- |
| `sharedCompletionLogic.test.ts` | Sort prefixes, type suggestion data, JS global definitions, snippet utils |

## Specification

See the Step 7 plan document (`docs/plan/07-scratchpad-completion-provider.md`)
WI-5 for the extraction scope and WI-2/WI-4 Phase 2.2 for the completion
specification tables (O1–O5 sort ordering contracts).
