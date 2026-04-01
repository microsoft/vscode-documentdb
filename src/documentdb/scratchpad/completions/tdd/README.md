# TDD Behavior Tests — Scratchpad Completions

This folder contains **behavior-driven TDD tests** for the scratchpad
autocompletion system. These tests define the expected behavior contract.

## Important: TDD Contract

> **⚠️ LLM/Agent Instruction:**
> These tests represent intentional behavior specifications. If a test in this
> folder fails after a code change, **do NOT automatically fix the test**.
> Instead, alert the user that a TDD behavior contract has been violated.
> The failure likely means the implementation change broke an expected behavior.
> The user must decide whether to update the test (changing the contract) or
> fix the implementation.

## Test Files

| File                                | What it tests                                        |
| ----------------------------------- | ---------------------------------------------------- |
| `scratchpadContextDetector.test.ts` | JS-level cursor context detection (Stage 1)          |
| `dynamicSchemaIntegration.test.ts`  | CollectionNameCache, schema-driven completions       |
| `hoverAndEdgeCases.test.ts`         | HoverProvider content, edge case context detection   |

Note: Completion registry tests (`scratchpadCompletionBehavior.test.ts`) were
removed — the static registry was replaced by the `@vscode-documentdb/documentdb-shell-api-types`
package and the TS Server Plugin (Layer 1). The package has its own tests.

## Specification

See the Step 7 plan document (`docs/plan/07-scratchpad-completion-provider.md`)
Phase 2.2 for the full completion specification tables (S1–S6, Q1–Q8, O1–O5, E1–E5).
