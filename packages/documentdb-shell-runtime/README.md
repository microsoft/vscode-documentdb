# @microsoft/documentdb-vscode-shell-runtime

Shell runtime for the DocumentDB VS Code extension — provides sandboxed JavaScript evaluation, shell command handling, and result formatting for both the **Query Playground** (scratchpad) and the **Interactive Shell** (REPL).

## What It Does

- **JavaScript evaluation** — executes user code in a sandboxed `vm.Context` against a target database
- **Command interception** — routes shell commands (`help`, `exit`, `cls`) before evaluation
- **Result transformation** — normalizes evaluation results into a protocol-agnostic `ShellEvaluationResult`
- **Help text** — generates DocumentDB-specific help output
- **Service provider** — bridges the evaluation engine to the MongoDB Node.js driver

## Eval Modes

The runtime supports two modes via the `persistent` option:

| Mode               | `persistent`      | Used By           | Behavior                                                                                                                                                                   |
| ------------------ | ----------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh context      | `false` (default) | Query Playground  | New `ShellInstanceState` + `vm.Context` per `evaluate()` call. No variable leakage between runs.                                                                           |
| Persistent context | `true`            | Interactive Shell | Reuses the same `ShellInstanceState`, `ShellEvaluator`, and `vm.Context` across calls. Variables, cursor state (`it`), and the `db` reference persist between evaluations. |

## Components

| File                        | Role                                                                          |
| --------------------------- | ----------------------------------------------------------------------------- |
| `DocumentDBShellRuntime`    | Main entry point — `evaluate(code, databaseName, options)`                    |
| `CommandInterceptor`        | Pre-eval command routing (regex-based detection)                              |
| `ResultTransformer`         | Post-eval result normalization (cursor iteration, `cursorHasMore` extraction) |
| `DocumentDBServiceProvider` | Evaluation engine ↔ MongoDB driver bridge (leverages `@mongosh` internals)    |
| `HelpProvider`              | Help text generation                                                          |
| `types.ts`                  | Public API types (`ShellEvaluationResult`, `ShellRuntimeOptions`, etc.)       |

## Usage

```typescript
import { DocumentDBShellRuntime } from '@microsoft/documentdb-vscode-shell-runtime';

// Fresh context (playground mode — default)
const playground = new DocumentDBShellRuntime(mongoClient, {
  onConsoleOutput: (output) => console.log(output),
});
const result = await playground.evaluate('db.users.find({})', 'myDatabase');

// Persistent context (interactive shell mode)
const shell = new DocumentDBShellRuntime(mongoClient, callbacks, {
  persistent: true,
});
await shell.evaluate('const x = 1', 'myDatabase');
await shell.evaluate('x + 1', 'myDatabase'); // returns 2 — variable survived

shell.dispose();
```

The caller owns the `MongoClient` lifecycle — the runtime only uses it.
