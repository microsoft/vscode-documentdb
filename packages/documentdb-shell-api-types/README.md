# @vscode-documentdb/documentdb-shell-api-types

TypeScript type definitions and method-to-command mapping for the DocumentDB
shell API, used by the
[Azure DocumentDB VS Code extension](https://github.com/microsoft/vscode-documentdb)
to provide IntelliSense in scratchpad files.

## What this package provides

1. **`documentdb-shell-api.d.ts`** — TypeScript declarations for the DocumentDB
   shell API surface (database methods, collection methods, cursor methods, BSON
   constructors, and shell globals). Used by the extension's TS Server Plugin to
   inject type information into scratchpad files for autocompletion, hover
   documentation, and signature help.

2. **Method registry** — A structured mapping of every shell method to its
   underlying DocumentDB server command(s). Methods that are client-side only
   (e.g., `use()`, `help()`, `getSiblingDB()`) are flagged as `shellOnly`.

3. **Compatibility verification** — A script that checks the method registry
   against the official
   [Azure DocumentDB compatibility documentation](https://learn.microsoft.com/en-us/azure/documentdb/compatibility-query-language)
   to detect when the upstream support matrix changes.

## How the API surface was determined

Azure DocumentDB is a fully managed database service that uses the MongoDB wire
protocol. As stated in the
[official compatibility documentation](https://learn.microsoft.com/en-us/azure/documentdb/compatibility-query-language):

> "Client-side wrapper functions, such as `deleteMany()` and `updateMany()`,
> internally invoke the corresponding server commands (`delete()` and
> `update()`). Any function that relies on supported server commands is
> compatible with Azure DocumentDB."

The methods in this package were **manually selected** to provide a productive
scratchpad editing experience. Each method maps to a server-side command listed
as supported in the Azure DocumentDB compatibility matrix. All JSDoc
descriptions are original writing.

See [`typeDefs/README.md`](typeDefs/README.md) for the full list of reference
documentation pages.

## Scripts

| Script | Description |
|---|---|
| `npm run build` | Compile TypeScript sources |
| `npm run test` | Run unit tests (method registry) |
| `npm run verify` | Check method registry against official DocumentDB compatibility docs |

### Verification (`npm run verify`)

The `verify` script fetches the official Azure DocumentDB compatibility page,
extracts the Database Commands table, and checks that every server command
referenced by the shell API is still marked as supported.

**Output keys** (for CI `grep`/`contains` checks):

| Key | Meaning |
|---|---|
| `[SHELL-API-COMPATIBLE]` | All server commands verified as supported — no action needed |
| `[SHELL-API-INCOMPATIBLE]` | A referenced command is no longer supported — update the `.d.ts` |
| `[SHELL-API-UNSUPPORTED-COMMAND]` | Per-command detail for each incompatible command |
| `[SHELL-API-MISSING-COMMAND]` | A referenced command was not found in the docs table |
| `[SHELL-API-NEW-COMMANDS]` | New supported commands found that could be added to the API |

The script also generates a full report at
`resources/scraped/compatibility-commands.md` with supported/unsupported command
tables and the complete method-to-command mapping.

## Usage

```typescript
import {
  getShellApiDtsContent,
  SHELL_API_METHODS,
  getRequiredServerCommands,
  getMethodsByTarget,
} from '@vscode-documentdb/documentdb-shell-api-types';

// Get the .d.ts content as a string (for TS server plugin injection)
const dtsContent = getShellApiDtsContent();

// Get all methods for a specific target
const collectionMethods = getMethodsByTarget('collection');

// Get the list of server commands the shell API depends on
const serverCommands = getRequiredServerCommands();
```

## License

MIT — See [LICENSE.md](../../LICENSE.md) in the repository root.
