# @documentdb-js/shell-runtime

[DocumentDB](https://documentdb.io/) is an open-source document database built on PostgreSQL, with native BSON support, rich indexing, and vector search. It uses the MongoDB-compatible wire protocol, runs locally with Docker, and is MIT licensed.

This package is a sandboxed JavaScript evaluation engine for DocumentDB — provides shell command handling, result transformation, and help generation. Supports both single-shot evaluation (playground/scratchpad style) and persistent REPL sessions (interactive shell style).

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

This package was developed while building features for the [DocumentDB VS Code extension](https://github.com/microsoft/vscode-documentdb), which remains the primary consumer. The runtime is designed to work with any Node.js application that has a `MongoClient` and needs to evaluate shell-style JavaScript against a DocumentDB database.

## Versioning & Publishing

This package lives in the [microsoft/vscode-documentdb](https://github.com/microsoft/vscode-documentdb) monorepo and is published manually via a GitHub Actions workflow using npm Trusted Publishing.

**Why the `version` in `package.json` ends in `-dev`:**

Between releases, the on-disk version is intentionally suffixed with `-dev` (for example `0.8.2-dev`) to make it obvious that the source on `main` is **not** the same as what's published on npm. External consumers who pin a real range like `"^0.8.1"` will resolve to the latest released version on npm (e.g. `0.8.1`), not to this in-progress dev state — because `0.8.2-dev` is a pre-release and pre-releases don't satisfy a normal range.

**Release flow (maintainers):**

1. Workspace is at `X.Y.Z-dev` during normal development.
2. When ready to publish: bump the version in `package.json` to the final `X.Y.Z` (drop `-dev`), commit, merge to `main`.
3. Trigger the [`Publish @documentdb-js packages`](https://github.com/microsoft/vscode-documentdb/actions/workflows/npm-publish-documentdb-js.yml) workflow and approve the deployment gate.
4. After the publish succeeds, bump to the next `X.Y.(Z+1)-dev` to start the next dev cycle.

**Source maps:**

The published tarball includes the original TypeScript sources alongside the compiled JavaScript and source maps. Consumers can step into this package's code with a debugger and see the original `.ts` files instead of just the compiled `.js`.

## License

[MIT](LICENSE.md)
