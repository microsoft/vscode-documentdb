---
description: 'AzureWizard implementation patterns for multi-step user flows'
applyTo: 'src/commands/**/*.ts'
---

# Wizard Implementation Pattern

When implementing wizards (multi-step user flows), follow this established pattern.

## Required File Structure

```
src/commands/yourCommand/
├── YourCommandWizardContext.ts   # Wizard state interface
├── PromptXStep.ts                # User input steps
├── ExecuteStep.ts                # Final execution
└── yourCommand.ts                # Main orchestration
```

## Implementation Steps

### 1. Context Interface

```typescript
export interface YourCommandWizardContext extends IActionContext {
  targetId: string;
  userInput?: string;
  validatedData?: SomeType;
}
```

### 2. Prompt Steps

```typescript
export class PromptUserInputStep extends AzureWizardPromptStep<YourCommandWizardContext> {
  public async prompt(context: YourCommandWizardContext): Promise<void> {
    const userInput = await context.ui.showInputBox({
      prompt: vscode.l10n.t('Enter your input'),
      validateInput: (input) => this.validateInput(input),
    });
    context.userInput = userInput.trim();
  }

  public shouldPrompt(): boolean {
    return true;
  }
}
```

### 3. Execute Step

```typescript
export class ExecuteStep extends AzureWizardExecuteStep<YourCommandWizardContext> {
  public priority: number = 100;

  public async execute(context: YourCommandWizardContext): Promise<void> {
    await performOperation(context);
  }

  public shouldExecute(context: YourCommandWizardContext): boolean {
    return !!context.userInput;
  }
}
```

### 4. Main Wizard

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
  await refreshView(context, Views.ConnectionsView);
}
```

## Back Navigation & Context Persistence

When users navigate back (`GoBackError`), the wizard **resets context properties** to what existed before that step's `prompt()` ran.

### Critical Rule

Properties set to `null` or `undefined` are **not captured** and will be cleared on back navigation.

| ❌ Won't Survive Back   | ✅ Will Survive Back  |
| ----------------------- | --------------------- |
| `cachedData: undefined` | `cachedData: []`      |
| Property not set        | `cachedConfig: {}`    |
|                         | `cachedId: ''`        |
|                         | `retryCount: 0`       |
|                         | `hasValidated: false` |

### Pattern for Cached Data

```typescript
// Context interface - make required with non-nullable type
export interface MyWizardContext extends IActionContext {
  cachedItems: CachedItem[];  // Required, non-optional
  selectedItem?: SomeItem;     // Optional - will be cleared on back
}

// Wizard initialization - use non-null/undefined initial value
const wizardContext: MyWizardContext = {
  ...context,
  cachedItems: [],  // Empty array survives back navigation
};

// Step implementation - check for initial empty value
public async prompt(context: MyWizardContext): Promise<void> {
  if (context.cachedItems.length === 0) {
    context.cachedItems = await this.fetchExpensiveData();
  }
  // Use cached data...
}

// Clearing cache - reset to initial value, NOT undefined
context.cachedItems = [];  // ✅ Correct
context.cachedItems = undefined;  // ❌ Wrong - will break back navigation
```

### Using GoBackError

```typescript
import { GoBackError } from '@microsoft/vscode-azext-utils';

public async prompt(context: MyWizardContext): Promise<void> {
  const result = await context.ui.showQuickPick(items, options);

  if (result.isBackOption) {
    context.selectedItem = undefined;  // Clear step-specific selections
    throw new GoBackError();
  }
}
```
