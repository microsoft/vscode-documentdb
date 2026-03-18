# TDD Behavior Tests

This folder contains **behavior-driven TDD tests** for the `documentdb-query`
autocompletion system. These tests define the expected behavior contract — they
were written BEFORE the implementation and drive the design.

## Important: TDD Contract

> **⚠️ LLM/Agent Instruction:**
> These tests represent intentional behavior specifications. If a test in this
> folder fails after a code change, **do NOT automatically fix the test**.
> Instead, alert the user that a TDD behavior contract has been violated.
> The failure likely means the implementation change broke an expected behavior.
> The user must decide whether to update the test (changing the contract) or
> fix the implementation.

## Test Files

| File | What it tests |
|------|---------------|
| `completionBehavior.test.ts` | Which completion categories appear at each cursor position, sorting order, and snippet wrapping |

## Specification

See [readme.completionBehavior.md](readme.completionBehavior.md) for the full
behavior specification with ASCII art examples.

## Why a separate folder?

These tests verify cross-cutting **behavior** (the completion matrix), not a
single class or module. They sit at the `documentdbQuery/tdd/` level because
they test the combined output of `cursorContext`, `createCompletionItems`,
`mapCompletionItems`, and `completionKnowledge` working together.
