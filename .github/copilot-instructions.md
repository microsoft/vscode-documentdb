# GitHub Copilot Instructions for vscode-documentdb

VS Code Extension for Azure Cosmos DB and MongoDB. TypeScript (strict mode), React webviews, Jest testing.

## Critical Build Commands

| Command                | Purpose                                                      |
| ---------------------- | ------------------------------------------------------------ |
| `npm run build`        | **Build the project** (use this, NOT `npm run compile`)      |
| `npm run lint`         | Check for linting errors                                     |
| `npm run prettier-fix` | Format code                                                  |
| `npm run l10n`         | Update localization files after changing user-facing strings |

> ⚠️ **NEVER use `npm run compile`** - always use `npm run build` to build the project.

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

// ✅ Good - Localized user-facing string
void vscode.window.showErrorMessage(vscode.l10n.t('Failed to connect: {0}', error.message));
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

## Additional Patterns

For detailed patterns, see:

- [instructions/typescript.instructions.md](instructions/typescript.instructions.md) - TypeScript patterns and anti-patterns
- [instructions/wizard.instructions.md](instructions/wizard.instructions.md) - AzureWizard implementation details
