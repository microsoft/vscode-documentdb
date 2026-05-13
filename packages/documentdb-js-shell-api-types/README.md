# @documentdb-js/shell-api-types

[DocumentDB](https://documentdb.io/) is an open-source document database built on PostgreSQL, with native BSON support, rich indexing, and vector search. It uses the MongoDB-compatible wire protocol, runs locally with Docker, and is MIT licensed.

This package provides TypeScript type definitions and a structured method-to-command registry for the DocumentDB shell API — everything needed to build IntelliSense, documentation tooling, or compatibility checks for the DocumentDB shell surface.

> **Pre-1.0 notice** — The API may change between minor versions until `1.0.0` is released.
> If you depend on this package and need stability guarantees sooner, please
> [open an issue](https://github.com/microsoft/vscode-documentdb/issues) and let us know.

## What This Package Provides

1. **`documentdb-shell-api.d.ts`** — TypeScript declarations for the DocumentDB
   shell API surface (database methods, collection methods, cursor methods, BSON
   constructors, and shell globals). Can be injected into a TS Server Plugin
   for autocompletion, hover documentation, and signature help.

2. **Method registry** — A structured mapping of every shell method to its
   underlying DocumentDB server command(s). Methods that are client-side only
   (e.g., `use()`, `help()`, `getSiblingDB()`) are flagged as `shellOnly`.

3. **Compatibility verification** — A script that checks the method registry
   against the official
   [DocumentDB compatibility documentation](https://learn.microsoft.com/en-us/azure/documentdb/compatibility-query-language)
   to detect when the upstream support matrix changes.

## How the API Surface Was Determined

DocumentDB uses the MongoDB wire protocol. As stated in the
[official compatibility documentation](https://learn.microsoft.com/en-us/azure/documentdb/compatibility-query-language):

> "Client-side wrapper functions, such as `deleteMany()` and `updateMany()`,
> internally invoke the corresponding server commands (`delete()` and
> `update()`). Any function that relies on supported server commands is
> compatible with Azure DocumentDB."

The methods in this package were **manually selected** to provide a productive
shell editing experience. Each method maps to a server-side command listed
as supported in the DocumentDB compatibility matrix. All JSDoc
descriptions are original writing.

See [`typeDefs/README.md`](typeDefs/README.md) for the full list of reference
documentation pages.

## Installation

```bash
npm install @documentdb-js/shell-api-types
```

## Usage

```typescript
import {
  getShellApiDtsContent,
  SHELL_API_METHODS,
  getRequiredServerCommands,
  getMethodsByTarget,
} from '@documentdb-js/shell-api-types';

// Get the .d.ts content as a string (for TS server plugin injection)
const dtsContent = getShellApiDtsContent();

// Get all methods for a specific target
const collectionMethods = getMethodsByTarget('collection');

// Get the list of server commands the shell API depends on
const serverCommands = getRequiredServerCommands();
```

## Scripts

| Script           | Description                                                          |
| ---------------- | -------------------------------------------------------------------- |
| `npm run build`  | Compile TypeScript sources                                           |
| `npm run test`   | Run unit tests (method registry)                                     |
| `npm run verify` | Check method registry against official DocumentDB compatibility docs |

### Verification (`npm run verify`)

The `verify` script fetches the official DocumentDB compatibility page,
extracts the Database Commands table, and checks that every server command
referenced by the shell API is still marked as supported.

**Output keys** (for CI `grep`/`contains` checks):

| Key                               | Meaning                                                          |
| --------------------------------- | ---------------------------------------------------------------- |
| `[SHELL-API-COMPATIBLE]`          | All server commands verified as supported — no action needed     |
| `[SHELL-API-INCOMPATIBLE]`        | A referenced command is no longer supported — update the `.d.ts` |
| `[SHELL-API-UNSUPPORTED-COMMAND]` | Per-command detail for each incompatible command                 |
| `[SHELL-API-MISSING-COMMAND]`     | A referenced command was not found in the docs table             |
| `[SHELL-API-NEW-COMMANDS]`        | New supported commands found that could be added to the API      |

The script also generates a full report at
`resources/scraped/compatibility-commands.md` with supported/unsupported command
tables and the complete method-to-command mapping.

## Origin

This package was developed while building features for the [DocumentDB VS Code extension](https://github.com/microsoft/vscode-documentdb), which remains the primary consumer. The package is designed to be useful in any tooling that needs DocumentDB shell API type information or method metadata.

## License

[MIT](LICENSE.md)
