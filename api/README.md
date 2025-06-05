# DocumentDB Extension API

⚠️ **Warning**: This is an experimental API for a feature currently in development. It is intended for internal use only. The API is unstable and subject to rapid changes, which may break compatibility without notice.

This package provides the Extension API for integrating with the VS Code DocumentDB extension.

## Installation

```bash
npm install --save-dev @microsoft/vscode-documentdb-api
```

## Usage

```typescript
import {
  getDocumentDBExtensionApi,
  MigrationProvider,
  MigrationProviderPickItem,
  ActionsOptions,
} from '@microsoft/vscode-documentdb-api';

export async function activate(context: vscode.ExtensionContext) {
  // Get the DocumentDB extension API
  const api = await getDocumentDBExtensionApi(context, '0.1.0');

  // Create your migration provider
  const myProvider: MigrationProvider = {
    id: 'my-provider',
    label: 'My Migration Provider',
    description: 'Migrates data from X to Y',

    async getAvailableActions(options?: ActionsOptions): Promise<MigrationProviderPickItem[]> {
      // Return available actions for the user to choose from
      return [
        {
          id: 'import-data',
          label: 'Import Data',
          description: 'Import data from source to destination',
        },
        {
          id: 'export-data',
          label: 'Export Data',
          description: 'Export data from source',
        },
      ];
    },

    async executeAction(id?: string): Promise<void> {
      // Execute the selected action
      switch (id) {
        case 'import-data':
          // Perform import operation
          break;
        case 'export-data':
          // Perform export operation
          break;
        default:
          // Handle default action or no action selected
          break;
      }
    },

    getLearnMoreUrl() {
      return 'https://example.com/learn-more';
    },
  };

  // Register your provider
  api.migration.registerProvider(myProvider);
}
```

## API Reference

### MigrationProvider

A migration provider must implement the following interface:

**Required Properties:**

- `id`: Unique identifier for the provider (internal use, not shown to users)
- `label`: Display name shown to users
- `description`: Brief description of what the provider does

**Optional Properties:**

- `iconPath`: Icon for the provider (can be a URI, theme icon, or light/dark icon pair)

**Required Methods:**

- `getAvailableActions(options?: ActionsOptions)`: Returns a list of actions the user can choose from
- `executeAction(id?: string)`: Executes the selected action or a default action

**Optional Methods:**

- `getLearnMoreUrl()`: Returns a URL for more information about the provider

### Workflow

The migration provider workflow follows these steps:

1. **Get Available Actions**: The system calls `getAvailableActions()` to retrieve a list of possible operations
2. **User Selection**: If actions are returned, they are presented to the user for selection
3. **Execute Action**: The system calls `executeAction()` with the selected action's ID
4. **Default Execution**: If `getAvailableActions()` returns an empty array, `executeAction()` is called immediately without parameters

### Supporting Interfaces

#### MigrationProviderPickItem

Extends VS Code's `QuickPickItem` with an additional `id` property:

```typescript
interface MigrationProviderPickItem extends vscode.QuickPickItem {
  id: string;
}
```

#### ActionsOptions

Optional parameters to customize available actions:

```typescript
interface ActionsOptions {
  connectionString?: string;
  databaseName?: string;
  collectionName?: string;
  extendedProperties?: { [key: string]: string | undefined };
}
```
