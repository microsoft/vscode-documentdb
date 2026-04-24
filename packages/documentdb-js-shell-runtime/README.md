# @documentdb-js/shell-runtime

Sandboxed JavaScript evaluation engine for [Azure DocumentDB](https://learn.microsoft.com/en-us/azure/documentdb/) — provides shell command handling, result transformation, and help generation. Supports both single-shot evaluation (playground/scratchpad style) and persistent REPL sessions (interactive shell style).

> **Pre-1.0 notice** — The API may change between minor versions until `1.0.0` is released.
> If you depend on this package and need stability guarantees sooner, please
> [open an issue](https://github.com/microsoft/vscode-documentdb/issues) and let us know.

## Features

- **JavaScript evaluation** — executes user code in a sandboxed `vm.Context` against a target database
- **Command interception** — routes shell commands (`help`, `exit`, `cls`) before evaluation
- **Result transformation** — normalizes evaluation results into a protocol-agnostic `ShellEvaluationResult`
- **Help text** — generates DocumentDB-specific help output
- **Service provider** — bridges the evaluation engine to the MongoDB Node.js driver

## Installation

```bash
npm install @documentdb-js/shell-runtime
```

Requires `mongodb` ≥ 6.0.0 as a peer dependency.

## Eval Modes

The runtime supports two modes via the `persistent` option:

| Mode               | `persistent`      | Behavior                                                                                                                                                                   |
| ------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh context      | `false` (default) | New `ShellInstanceState` + `vm.Context` per `evaluate()` call. No variable leakage between runs.                                                                           |
| Persistent context | `true`            | Reuses the same `ShellInstanceState`, `ShellEvaluator`, and `vm.Context` across calls. Variables, cursor state (`it`), and the `db` reference persist between evaluations. |

## Usage

```typescript
import { MongoClient } from 'mongodb';
import { DocumentDBShellRuntime } from '@documentdb-js/shell-runtime';

// The caller owns the MongoClient — create, connect, and close it yourself.
// The runtime never opens or closes the connection.
const mongoClient = new MongoClient(connectionString);
await mongoClient.connect();

// Constructor signature:
//   new DocumentDBShellRuntime(mongoClient, callbacks?, options?)
//
//   callbacks: { onConsoleOutput?, onLog? }
//   options:   { persistent?, productName?, displayBatchSize? }

// Fresh context (playground mode — default)
const playground = new DocumentDBShellRuntime(mongoClient, {
  onConsoleOutput: (output) => console.log(output),
});
const result = await playground.evaluate('db.users.find({})', 'myDatabase');

// Persistent context (interactive shell mode)
const shell = new DocumentDBShellRuntime(
  mongoClient,
  { onConsoleOutput: (output) => console.log(output) }, // callbacks
  { persistent: true }, // options
);
await shell.evaluate('const x = 1', 'myDatabase');
await shell.evaluate('x + 1', 'myDatabase'); // returns 2 — variable survived

// Dispose the runtime when done — this does NOT close the MongoClient.
shell.dispose();

// Close the MongoClient when the session is over.
// The runtime intentionally never closes it, so the same client
// can be reused across multiple evaluate() calls and runtime instances.
await mongoClient.close();
```

## Components

| File                        | Role                                                                          |
| --------------------------- | ----------------------------------------------------------------------------- |
| `DocumentDBShellRuntime`    | Main entry point — `evaluate(code, databaseName, options)`                    |
| `CommandInterceptor`        | Pre-eval command routing (regex-based detection)                              |
| `ResultTransformer`         | Post-eval result normalization (cursor iteration, `cursorHasMore` extraction) |
| `DocumentDBServiceProvider` | Evaluation engine ↔ MongoDB driver bridge (leverages `@mongosh` internals)    |
| `HelpProvider`              | Help text generation                                                          |
| `types.ts`                  | Public API types (`ShellEvaluationResult`, `ShellRuntimeOptions`, etc.)       |

## Origin

This package was developed as part of the [Azure DocumentDB VS Code extension](https://github.com/microsoft/vscode-documentdb), which uses it to power the Query Playground and Interactive Shell features. The extension remains the primary consumer, but the runtime is designed to work with any Node.js application that has a `MongoClient` and needs to evaluate shell-style JavaScript against a DocumentDB database.

## License

[MIT](LICENSE.md)
