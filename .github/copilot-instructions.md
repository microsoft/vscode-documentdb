# GitHub Copilot Instructions for vscode-documentdb

VS Code Extension for Azure Cosmos DB and the MongoDB API. TypeScript (strict mode), React webviews, Jest testing.

## Critical Build Commands

| Command                | Purpose                                                      |
| ---------------------- | ------------------------------------------------------------ |
| `npm run build`        | **Build the project** (use this, NOT `npm run compile`)      |
| `npm run lint`         | Check for linting errors                                     |
| `npm run prettier-fix` | Format code                                                  |
| `npm run l10n`         | Update localization files after changing user-facing strings |

> ⚠️ **NEVER use `npm run compile`** - always use `npm run build` to build the project.

## PR Completion Checklist

Before finishing work on a PR, agents **must** run the following steps in order:

1. **Localization** — If any user-facing strings were added, modified, or removed, run:
   ```bash
   npm run l10n
   ```
2. **Formatting** — Run Prettier to ensure all files meet formatting standards:
   ```bash
   npm run prettier-fix
   ```
3. **Linting** — Run ESLint to confirm there are no linting errors:
   ```bash
   npm run lint
   ```

> ⚠️ **An agent must not finish or terminate until all three steps above have been run and pass successfully.** Skipping these steps leads to CI failures.

## Git Safety

- **Never use `git add -f`** to force-add files. If `git add` refuses a file, it is likely in `.gitignore` for a reason (e.g., `docs/plan/`, `docs/analysis/`, build outputs). Do NOT override this with `-f`.
- When `git add` warns that a path is ignored, **stop and inform the user** instead of force-adding.
- Files in `docs/plan/` and `docs/analysis/` are **local planning documents** that must not be committed to the repository.

## Project Structure

| Folder          | Purpose                                    |
| --------------- | ------------------------------------------ |
| `src/`          | Main extension source code                 |
| `src/webviews/` | React web view components                  |
| `src/commands/` | Command handlers (one folder per command)  |
| `src/services/` | Singleton services                         |
| `src/tree/`     | Tree view data providers                   |
| `api/`          | Separate Node.js project for extension API |
| `l10n/`         | Localization files                         |
| `test/`         | Jest tests                                 |

## Branching

- **`next`**: Target branch for PRs (default)
- **`main`**: Production releases only

## TypeScript Guidelines

- **Never use `any`** - use `unknown` with type guards
- **Prefer `interface`** for object shapes, `type` for unions
- **Always specify return types** for functions
- **Use `vscode.l10n.t()`** for all user-facing strings

```typescript
// ✅ Good - Interface with explicit types
interface ConnectionConfig {
  readonly host: string;
  readonly port: number;
}

// ✅ Good - Named function with return type
export function createConnection(config: ConnectionConfig): Promise<Connection> {
  // implementation
}

// ✅ Good - Localized user-facing string with safe error handling
try {
  await operation();
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  void vscode.window.showErrorMessage(vscode.l10n.t('Failed to connect: {0}', errorMessage));
}
```

## Null Safety

Use `nonNullProp()`, `nonNullValue()`, `nonNullOrEmptyValue()` from `src/utils/nonNull.ts`:

```typescript
// ✅ Good - Use nonNull helpers for internal validation
const connectionString = nonNullProp(
  selectedItem.cluster,
  'connectionString',
  'selectedItem.cluster.connectionString',
  'ExecuteStep.ts',
);

// ✅ Good - Manual check for user-facing validation with l10n
if (!userInput.connectionString) {
  void vscode.window.showErrorMessage(vscode.l10n.t('Connection string is required'));
  return;
}
```

## Error Handling

When accessing error properties in catch blocks or error handlers, always check if the error is an instance of `Error` before accessing `.message`:

```typescript
// ✅ Good - Type-safe error message extraction
try {
  await someOperation();
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  void vscode.window.showErrorMessage(vscode.l10n.t('Operation failed: {0}', errorMessage));
}

// ✅ Good - In promise catch handlers
void task.start().catch((error) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  void vscode.window.showErrorMessage(vscode.l10n.t('Failed to start: {0}', errorMessage));
});

// ❌ Bad - Direct access to error.message (eslint error)
catch (error) {
  void vscode.window.showErrorMessage(vscode.l10n.t('Failed: {0}', error.message)); // Unsafe!
}
```

## Command Pattern

Each command gets its own folder under `src/commands/`:

```
src/commands/yourCommand/
├── YourCommandWizardContext.ts   # Wizard state interface
├── PromptXStep.ts                # User input steps
├── ExecuteStep.ts                # Final execution
└── yourCommand.ts                # Main orchestration
```

## Security

- Never log passwords, tokens, or connection strings
- Use VS Code's secure storage for credentials
- Validate all user inputs

## Cluster ID Architecture (Dual ID Pattern)

> ⚠️ **CRITICAL**: Using the wrong ID causes silent bugs that only appear when users move connections between folders.

Cluster models have **two distinct ID properties** with different purposes:

| Property    | Purpose                          | Stable?                   | Use For                             |
| ----------- | -------------------------------- | ------------------------- | ----------------------------------- |
| `treeId`    | VS Code TreeView element path    | ❌ Changes on folder move | `this.id`, child item paths         |
| `clusterId` | Cache key (credentials, clients) | ✅ Always stable          | `CredentialCache`, `ClustersClient` |

### Quick Reference

```typescript
// ✅ Tree element identification
this.id = cluster.treeId;

// ✅ Cache operations - ALWAYS use clusterId
CredentialCache.hasCredentials(cluster.clusterId);
ClustersClient.getClient(cluster.clusterId);

// ❌ WRONG - breaks when connection moves to a folder
CredentialCache.hasCredentials(this.id); // BUG!
```

### Model Types

- **`ConnectionClusterModel`** - Connections View (has `storageId`)
- **`AzureClusterModel`** - Azure/Discovery Views (has `azureResourceId`)
- **`BaseClusterModel`** - Shared interface (use for generic code)

For Discovery View, both `treeId` and `clusterId` are sanitized (all `/` replaced with `_`). The original Azure Resource ID is stored in `AzureClusterModel.azureResourceId` for Azure API calls.

> 💡 **Extensibility**: If adding a non-Azure discovery source (e.g., AWS, GCP), consider creating a new model type (e.g., `AwsClusterModel`) extending `BaseClusterModel` with source-specific metadata.

See `src/tree/models/BaseClusterModel.ts` and `docs/analysis/08-cluster-model-simplification-plan.md` for details.

## Terminology

This is a **DocumentDB** extension that uses the **MongoDB-compatible wire protocol**.

- Use **"DocumentDB"** when referring to the database service itself.
- Use **"MongoDB API"** or **"DocumentDB API"** when referring to the wire protocol, query language, or API compatibility layer.
- **Never use "MongoDB" alone** as a product name in code, comments, docs, or user-facing strings.

| ✅ Do                                                | ❌ Don't                         |
| ---------------------------------------------------- | -------------------------------- |
| `// Query operators supported by the DocumentDB API` | `// MongoDB query operators`     |
| `// BSON types per the MongoDB API spec`             | `// Uses MongoDB's $match stage` |
| `documentdbQuery` (variable name)                    | `mongoQuery`                     |

This applies to: code comments, JSDoc/TSDoc, naming (prefer `documentdb` prefix), user-facing strings, docs, and test descriptions.

## TDD Contract Tests

Test suites prefixed with `TDD:` (e.g., `describe('TDD: Completion Behavior', ...)`) are **behavior contracts** written before the implementation. If a `TDD:` test fails after a code change:

1. **Do NOT automatically fix the test.**
2. **Stop and ask the user** whether the behavior change is intentional.
3. The user decides: update the contract (test) or fix the implementation.

This applies to any test whose name starts with `TDD:`, regardless of folder location.

## Additional Patterns

For detailed patterns, see:

- [instructions/typescript.instructions.md](instructions/typescript.instructions.md) - TypeScript patterns and anti-patterns
- [instructions/wizard.instructions.md](instructions/wizard.instructions.md) - AzureWizard implementation details
