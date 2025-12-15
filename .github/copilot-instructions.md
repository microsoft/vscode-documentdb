# GitHub Copilot Instructions for vscode-documentdb

This document provides comprehensive guidelines and context for GitHub Copilot to assist contributors working on the **DocumentDB for VS Code** repository.

---

## Context

- **Project Type**: VS Code Extension + API Host for Plugins to this VS Code Extension
- **Language**: TypeScript (strict mode enabled)
- **Framework / Libraries**:
  - React for web views (exclusively in `/src/webviews/`)
  - VS Code Extension APIs
  - MongoDB drivers and Azure SDK
  - Webpack for bundling
  - Jest for testing

---

## 1. Branching Strategy

### Branch Types

- **`main`**: Production-ready code. All releases are tagged here.
- **`next`**: Staging for the upcoming release. Pull requests should be created against this branch unless explicitly stated otherwise.
- **`dev/<user>/<feature>`**: Individual feature branches for personal development.
- **`feature/<big-feature>`**: Shared branches for large features requiring collaboration.

### Pull Request Guidelines

- Pull requests should generally target the `next` branch.
- Changes merged into `next` will be reviewed and manually merged into `main` during the release process.
- PRs targeting `main` are reserved for hotfixes or release-specific changes.
- Ensure all automated checks pass before requesting a review.

---

## 2. Repository Structure

### Core Folders

- **`api/`**: Contains API-related code. This folder has its own `package.json` and is a separate Node.js project used to expose APIs for the VS Code extension.
- **`src/`**: The main source code for the VS Code extension.
  - **`src/webviews/`**: Contains web view components built with React.
  - **`src/commands/`**: Command handlers for the VS Code extension. Always create a folder with the command name, and then the handler in that folder.
  - **`src/services/`**: Contains singleton services and utility functions.
  - **`src/utils/`**: Utility functions and helpers.
  - **`src/tree/`**: Tree view components for the VS Code extension.
    - **`src/tree/connections-view/`**: Contains tree branch data provider for the Connections View.
    - **`src/tree/discovery-view/`**: Contains tree branch data provider for the Discovery View.
    - **`src/tree/documentdb/`**: Contains shared tree items for all tree views (related to DocumentDB).
  - **`src/documentdb/`**: Core DocumentDB/MongoDB functionality and models.
  - **`src/plugins/`**: Plugin architecture and implementations.
  - **`src/extension.ts`**: The entry point for the VS Code extension.
- **`l10n/`**: Localization files and scripts.
- **`test/`**: Test files and utilities.
- **`docs/`**: Documentation files related to the project. Used to generate documentation.
- **`package.json`**: Defines dependencies, scripts, and metadata for the project.

---

## 3. Contribution Guidelines

### Pre-Commit Checklist

- Follow the branching strategy outlined above.
- Ensure all tests pass locally before pushing changes.
- Use l10n for any user-facing strings with `vscode.l10n.t()`.
- Use `npm run prettier-fix` to format your code before committing.
- Use `npm run lint` to check for linting errors.
- Use `npm run build` to ensure the project builds successfully.
- Use `npm run l10n` to update localization files in case you change any user-facing strings.
- Ensure TypeScript compilation passes without errors.

---

## 4. TypeScript Coding Guidelines

### Strict TypeScript Practices

- **Never use `any`** - Use proper types, `unknown`, or create specific interfaces.
- **Prefer `interface` over `type`** for object shapes and extensible contracts.
- **Use `type` for unions, primitives, and computed types**.
- **Always specify return types** for functions, especially public APIs.
- **Use generic constraints** with `extends` for type safety.
- **Prefer `const assertions`** for literal types: `as const`.

### Function and Class Patterns

```typescript
// ✅ Good - Named function with explicit return type
export function createConnection(config: ConnectionConfig): Promise<Connection> {
  // implementation
}

// ✅ Good - Interface for object shapes
interface ConnectionConfig {
  readonly host: string;
  readonly port: number;
  readonly database?: string;
}

// ✅ Good - Prefer enums over type unions for well-defined sets of constants
enum ConnectionStatus {
  Connected = 'connected',
  Disconnected = 'disconnected',
  Error = 'error',
}

enum ConnectionMode {
  ConnectionString,
  ServiceDiscovery,
}

// ✅ Good - Type for computed types and flexible unions
type EventMap = Record<string, (...args: unknown[]) => void>;

// ✅ Good - Generic with constraints
function createService<T extends BaseService>(ServiceClass: new () => T): T {
  return new ServiceClass();
}
```

### Error Handling Patterns

- **Always use typed error handling** with custom error classes.
- **Use `Result<T, E>` pattern** for operations that can fail.
- **Wrap VS Code APIs** with proper error boundaries.

```typescript
// ✅ Good - Custom error classes
export class DocumentDBConnectionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'DocumentDBConnectionError';
  }
}

// ✅ Good - Result pattern
type Result<T, E = Error> = { success: true; data: T } | { success: false; error: E };
```

### VS Code Extension Patterns

- **Use proper VS Code API types** from `@types/vscode`.
- **Implement proper disposal** for disposables with `vscode.Disposable`.
- **Use command registration patterns** with proper error handling.
- **Leverage VS Code's theming** and l10n systems.

```typescript
// ✅ Good - Command registration
export function registerCommands(context: vscode.ExtensionContext): void {
  const disposables = [
    vscode.commands.registerCommand('documentdb.connect', async (item) => {
      try {
        await handleConnect(item);
      } catch (error) {
        void vscode.window.showErrorMessage(vscode.l10n.t('Failed to connect: {0}', error.message));
      }
    }),
  ];

  context.subscriptions.push(...disposables);
}
```

### Async/Await Best Practices

- **Always use `async/await`** over Promises chains.
- **Handle errors with try/catch** blocks.
- **Use `Promise.allSettled()`** for parallel operations that can fail independently.
- **Avoid `void` except for fire-and-forget operations**.

### Import/Export Patterns

- **Use named exports** for better tree-shaking and IDE support.
- **Group imports** by type: Node.js built-ins, third-party, local.
- **Use barrel exports** (`index.ts`) for clean module interfaces.

```typescript
// ✅ Good - Import grouping
import * as path from 'path';
import * as vscode from 'vscode';

import { ConnectionManager } from '../services/ConnectionManager';
import { DocumentDBError } from '../utils/errors';

import type { ConnectionConfig, DatabaseInfo } from './types';
```

### Anti-Patterns to Avoid

- ❌ **Never use `any`** - Use `unknown` and type guards instead.
- ❌ **Don't use `function` declarations** - Use `const` with arrow functions or named function expressions.
- ❌ **Avoid nested ternaries** - Use proper if/else or switch statements.
- ❌ **Don't ignore Promise rejections** - Always handle errors.
- ❌ **Avoid mutations** - Prefer immutable operations.
- ❌ **Don't use `@ts-ignore`** - Fix the underlying type issue.
- ❌ **Avoid large switch statements** - Use object maps or polymorphism.

```typescript
// ❌ Bad
const result: any = await someOperation();

// ✅ Good
const result: unknown = await someOperation();
if (isConnectionResult(result)) {
  // now result is properly typed
}

// ❌ Bad
function processData(data: any) {
  return data.something?.else;
}

// ✅ Good
function processData(data: unknown): string | undefined {
  if (isDataObject(data) && typeof data.something?.else === 'string') {
    return data.something.else;
  }
  return undefined;
}
```

---

## 5. Testing Guidelines

### Testing Frameworks

- Use `Jest` for unit and integration tests.
- Use `@types/jest` for TypeScript support.

### Testing Structure

- Keep tests in the same directory structure as the code they test.
- Test business logic in services; mock dependencies using `jest.mock()` for unit tests.
- Use descriptive test names that explain the expected behavior.
- Group related tests with `describe` blocks.

### Testing Patterns

```typescript
// ✅ Good - Descriptive test structure
describe('ConnectionManager', () => {
  describe('when connecting to DocumentDB', () => {
    it('should return connection for valid credentials', async () => {
      // Arrange
      const config: ConnectionConfig = {
        host: 'localhost',
        port: 27017,
      };

      // Act
      const result = await connectionManager.connect(config);

      // Assert
      expect(result.success).toBe(true);
    });
  });
});
```

---

## 6. Code Organization and Architecture

### Service Layer Pattern

- Use singleton services for shared functionality.
- Implement proper dependency injection patterns.
- Keep services focused on single responsibilities.

### Command Pattern

- Each command should have its own folder under `src/commands/`.
- Implement proper error handling and user feedback.
- Use VS Code's progress API for long-running operations.

### Wizard Implementation Pattern

When implementing wizards (multi-step user flows), follow the established pattern used in commands like `renameConnection` and `updateCredentials`:

**Required Files Structure:**

```
src/commands/yourCommand/
├── YourCommandWizardContext.ts      # Wizard state/data interface
├── PromptXStep.ts                   # User input collection steps
├── PromptYStep.ts                   # Additional prompt steps as needed
├── ExecuteStep.ts                   # Final execution logic
└── yourCommand.ts                   # Main wizard orchestration
```

**Implementation Pattern:**

1. **Context File** (`*WizardContext.ts`): Define the wizard's state and data

```typescript
export interface YourCommandWizardContext extends IActionContext {
  // Target item details
  targetId: string;

  // User input properties
  userInput?: string;
  validatedData?: SomeType;
}
```

2. **Prompt Steps** (`Prompt*Step.ts`): Collect user input with validation

```typescript
export class PromptUserInputStep extends AzureWizardPromptStep<YourCommandWizardContext> {
  public async prompt(context: YourCommandWizardContext): Promise<void> {
    const userInput = await context.ui.showInputBox({
      prompt: vscode.l10n.t('Enter your input'),
      validateInput: (input) => this.validateInput(input),
      asyncValidationTask: (input) => this.asyncValidate(context, input),
    });

    context.userInput = userInput.trim();
  }

  public shouldPrompt(): boolean {
    return true;
  }
}
```

3. **Execute Step** (`ExecuteStep.ts`): Perform the final operation

```typescript
export class ExecuteStep extends AzureWizardExecuteStep<YourCommandWizardContext> {
  public priority: number = 100;

  public async execute(context: YourCommandWizardContext): Promise<void> {
    // Perform the actual operation using context data
    await performOperation(context);
  }

  public shouldExecute(context: YourCommandWizardContext): boolean {
    return !!context.userInput; // Validate required data exists
  }
}
```

4. **Main Wizard File** (`yourCommand.ts`): Orchestrate the wizard flow

```typescript
export async function yourCommand(context: IActionContext, targetItem: SomeItem): Promise<void> {
  const wizardContext: YourCommandWizardContext = {
    ...context,
    targetId: targetItem.id,
  };

  const wizard = new AzureWizard(wizardContext, {
    title: vscode.l10n.t('Your Command Title'),
    promptSteps: [new PromptUserInputStep()],
    executeSteps: [new ExecuteStep()],
  });

  await wizard.prompt();
  await wizard.execute();

  // Refresh relevant views if needed
  await refreshView(context, Views.ConnectionsView);
}
```

### Wizard Back Navigation and Context Persistence

When users navigate back in a wizard (via `GoBackError`), the `AzureWizard` framework resets context properties. Understanding this behavior is critical for proper wizard implementation.

#### How AzureWizard Handles Back Navigation

When a step throws `GoBackError`, the wizard:

1. Pops steps from the finished stack until finding the previous prompted step
2. **Resets context properties** to what existed before that step's `prompt()` ran
3. Re-runs the step's `prompt()` method

**Critical Implementation Detail**: Before each step's `prompt()` runs, the wizard captures `propertiesBeforePrompt`:

```javascript
// From AzureWizard.js - this runs for EACH step before prompt()
step.propertiesBeforePrompt = Object.keys(this._context).filter((k) => !isNullOrUndefined(this._context[k])); // Only non-null/undefined values!
```

When going back, properties NOT in `propertiesBeforePrompt` are set to `undefined`:

```javascript
// From AzureWizard.js goBack() method
for (const key of Object.keys(this._context)) {
  if (!step.propertiesBeforePrompt.find((p) => p === key)) {
    this._context[key] = undefined; // Property gets cleared!
  }
}
```

#### Making Context Properties Survive Back Navigation

To ensure a context property survives when users navigate back, you must initialize it with a **non-null, non-undefined value** in the wizard context creation:

```typescript
// ❌ Bad - Property will be cleared on back navigation
const wizardContext: MyWizardContext = {
  ...context,
  cachedData: undefined, // undefined is filtered out of propertiesBeforePrompt!
};

// ❌ Bad - Property not initialized, same problem
const wizardContext: MyWizardContext = {
  ...context,
  // cachedData not set - will be undefined
};

// ✅ Good - Property will survive back navigation (using empty array)
const wizardContext: MyWizardContext = {
  ...context,
  cachedData: [], // Empty array is not null/undefined, captured in propertiesBeforePrompt
};

// ✅ Good - Property will survive back navigation (using empty object)
const wizardContext: MyWizardContext = {
  ...context,
  cachedConfig: {}, // Empty object is not null/undefined
};

// ✅ Good - Property will survive back navigation (using empty string)
const wizardContext: MyWizardContext = {
  ...context,
  cachedId: '', // Empty string is not null/undefined
};

// ✅ Good - Property will survive back navigation (using zero)
const wizardContext: MyWizardContext = {
  ...context,
  retryCount: 0, // Zero is not null/undefined
};

// ✅ Good - Property will survive back navigation (using false)
const wizardContext: MyWizardContext = {
  ...context,
  hasBeenValidated: false, // false is not null/undefined
};
```

#### Pattern for Cached Data with Back Navigation Support

When you need to cache expensive data (like API calls) that should survive back navigation:

1. **Context Interface**: Make the property required with a non-nullable type

```typescript
export interface MyWizardContext extends IActionContext {
  // Required - initialized with non-null/undefined value to survive back navigation
  cachedItems: CachedItem[];

  // Optional - user selections that may be cleared
  selectedItem?: SomeItem;
}
```

2. **Wizard Initialization**: Initialize with a non-null/undefined value

```typescript
const wizardContext: MyWizardContext = {
  ...context,
  cachedItems: [], // Any non-null/undefined value survives back navigation
};
```

3. **Step Implementation**: Check appropriately for the initial value

```typescript
public async prompt(context: MyWizardContext): Promise<void> {
  const getQuickPickItems = async () => {
    // Check for initial empty value (array uses .length, string uses === '', etc.)
    if (context.cachedItems.length === 0) {
      context.cachedItems = await this.fetchExpensiveData();
    }
    return context.cachedItems.map(item => ({ label: item.name }));
  };

  await context.ui.showQuickPick(getQuickPickItems(), { /* options */ });
}
```

4. **Clearing Cache**: Reset to the initial non-null/undefined value

```typescript
// When you need to invalidate the cache (e.g., after a mutation)
context.cachedItems = []; // Reset to initial value, not undefined!
```

#### Using GoBackError in Steps

To navigate back programmatically from a step:

```typescript
import { GoBackError } from '@microsoft/vscode-azext-utils';

public async prompt(context: MyWizardContext): Promise<void> {
  const result = await context.ui.showQuickPick(items, options);

  if (result.isBackOption) {
    // Clear step-specific selections before going back
    context.selectedItem = undefined;
    throw new GoBackError();
  }

  // Process selection...
}
```

### Tree View Architecture

- Use proper data providers that implement `vscode.TreeDataProvider`.
- Implement refresh mechanisms with event emitters.
- Use proper icons and theming support.

---

## 7. Localization (l10n)

- **Always use `vscode.l10n.t()`** for user-facing strings.
- **Use descriptive keys** that explain the context.
- **Include placeholders** for dynamic content.
- **Run `npm run l10n`** after adding new strings.

```typescript
// ✅ Good - Proper l10n usage
const message = vscode.l10n.t(
  'Connected to {0} database with {1} collections',
  databaseName,
  collectionCount.toString(),
);
```

---

## 8. Performance and Best Practices

- **Use lazy loading** for heavy operations.
- **Implement proper caching** for expensive computations.
- **Use VS Code's built-in APIs** for file operations and UI.
- **Minimize bundle size** by avoiding unnecessary dependencies.
- **Use proper disposal patterns** to prevent memory leaks.

---

## 9. Security Guidelines

- **Never log sensitive information** (passwords, tokens, connection strings).
- **Use VS Code's secure storage** for credentials.
- **Validate all user inputs** before processing.
- **Use proper error messages** that don't leak sensitive details.

---

## 10. Additional Notes

- Use `next` as the default branch for new features and fixes.
- Avoid committing directly to `main` unless explicitly instructed.
- Ensure compatibility with Node.js version specified in `.nvmrc`.
- Follow the project's ESLint configuration for consistent code style.
- Use webpack for bundling and ensure proper tree-shaking.

---

## Null Safety with nonNull Helpers

**Always use the nonNull utility functions** from `src/utils/nonNull.ts` instead of manual null checks for better error reporting and debugging.

#### Available Functions

- **`nonNullProp()`**: Extract and validate object properties
- **`nonNullValue()`**: Validate any value is not null/undefined
- **`nonNullOrEmptyValue()`**: Validate strings are not null/undefined/empty

#### Parameter Guidelines

Both `message` and `details` parameters are **required** for all nonNull functions:

- **`message`**: Use the actual member access or assignment LHS from your code. Since this is open source, use real variable names:
  - Member access: `'selectedItem.cluster.connectionString'`
  - Wizard context: `'wizardContext.password'`
  - Local variables: `'connectionString.match(...)'`

- **`details`**: Use the actual file base name where the code is located:
  - Examples: `'ExecuteStep.ts'`, `'ConnectionItem.ts'`, `'DatabaseTreeItem.ts'`
  - Keep it short, use the actual file name, don't create constants

#### Usage Examples

```typescript
// ✅ Good - Property extraction with validation
const connectionString = nonNullProp(
  selectedItem.cluster,
  'connectionString',
  'selectedItem.cluster.connectionString',
  'ExecuteStep.ts',
);

// ✅ Good - Value validation
const validatedConnection = nonNullValue(await getConnection(id), 'getConnection(id)', 'ConnectionManager.ts');

// ✅ Good - String validation (not empty)
const databaseName = nonNullOrEmptyValue(
  wizardContext.databaseName,
  'wizardContext.databaseName',
  'CreateDatabaseStep.ts',
);

// ✅ Good - Manual null check for user-facing validation
if (!userInput.connectionString) {
  void vscode.window.showErrorMessage(vscode.l10n.t('Connection string is required'));
  return;
}

// ❌ Bad - Manual null checks for internal validation (use nonNull helpers instead)
if (!selectedItem.cluster.connectionString) {
  throw new Error('Connection string is required'); // This should use nonNullProp
}

// ❌ Bad - Generic parameter values
const value = nonNullValue(data, 'some value', 'file.ts');
```

**When to use each approach:**

- **Use nonNull helpers**: For internal validation where you expect the value to exist (programming errors)
- **Use manual checks**: For user-facing validation with localized error messages shown to users
