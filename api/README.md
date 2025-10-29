# DocumentDB Extension API

⚠️ **Warning**: This is an experimental API for a feature currently in development. It is intended for internal use only. The API is unstable and subject to rapid changes, which may break compatibility without notice.

This package provides the Extension API for integrating with the VS Code DocumentDB extension.

## API Versioning

- **v0.3.0 (Latest)**: The current and only supported version. It requires the extension context for provider registration and enforces a one-provider-per-extension rule.
- **v0.2.0 (Deprecated)**: This version is deprecated and will be removed in a future release. New integrations should not use it.

## Installation

```bash
npm install --save-dev vscode-documentdb-api-experimental-beta
```

## Usage (v0.3.0)

```typescript
import * as vscode from 'vscode';
import {
  getDocumentDBExtensionApi,
  type DocumentDBExtensionApiV030, // Import the v0.3.0 API interface
  type MigrationProvider,
  type MigrationProviderPickItem,
  type ActionsOptions,
} from 'vscode-documentdb-api-experimental-beta';

export async function activate(context: vscode.ExtensionContext) {
  // Get the DocumentDB extension API and cast it to the v0.3.0 type
  const api = (await getDocumentDBExtensionApi(context, '0.3.0')) as DocumentDBExtensionApiV030;

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

    async executeAction(options?: ActionsOptions, id?: string): Promise<void> {
      // Execute the selected action
      // Use options for context like connection details
      switch (id) {
        case 'import-data':
          // Perform import operation using options.connectionString, etc.
          break;
        case 'export-data':
          // Perform export operation using options.databaseName, etc.
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

  // Register your provider using the extension context.
  // Note: Each extension can only register one provider.
  api.migration.registerProvider(context, myProvider);
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

- `getAvailableActions(options?: ActionsOptions)`: Returns a list of actions the user can choose from.
- `executeAction(id?: string)`: Executes the selected action or a default action.

**Optional Properties:**

- `requiresAuthentication`: Indicates if authentication is required for the default operation (when no custom actions are provided).

**Optional Methods:**

- `getLearnMoreUrl()`: Returns a URL for more information about the provider.

### Workflow

The migration provider workflow follows these steps:

1.  **Get Available Actions**: The system calls `getAvailableActions()` to retrieve a list of possible operations.
2.  **User Selection**: If actions are returned, they are presented to the user for selection.
3.  **Execute Action**: The system calls `executeAction()` with the selected action's ID.
4.  **Default Execution**: If `getAvailableActions()` returns an empty array, `executeAction()` is called immediately without parameters.

### Supporting Interfaces

#### MigrationProviderPickItem

Extends VS Code's `QuickPickItem` with additional properties:

```typescript
interface MigrationProviderPickItem extends vscode.QuickPickItem {
  id: string;
  requiresAuthentication?: boolean; // Indicates if authentication is required for this action
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

## Authentication Support

The API supports flexible authentication requirements at both the provider and action levels:

### Provider-Level Authentication

Use the `requiresAuthentication` property on the provider for default operations:

```typescript
const provider: MigrationProvider = {
  id: 'my-provider',
  label: 'My Provider',
  description: 'Provider requiring authentication',
  requiresAuthentication: true, // Auth required for default action

  async getAvailableActions(): Promise<MigrationProviderPickItem[]> {
    return []; // No custom actions, uses default
  },

  async executeAction(): Promise<void> {
    // This will only be called after authentication is verified
  },
};
```

### Action-Level Authentication

Individual actions can specify their own authentication requirements:

```typescript
const provider: MigrationProvider = {
  id: 'flexible-provider',
  label: 'Flexible Provider',
  description: 'Provider with mixed authentication requirements',

  async getAvailableActions(): Promise<MigrationProviderPickItem[]> {
    return [
      {
        id: 'public-action',
        label: 'Public Action',
        description: 'No authentication required',
        requiresAuthentication: false,
      },
      {
        id: 'private-action',
        label: 'Private Action',
        description: 'Authentication required',
        requiresAuthentication: true,
      },
    ];
  },

  async executeAction(options?: ActionsOptions, id?: string): Promise<void> {
    // Handle actions based on their authentication requirements
    // Use options for context like connection details
  },
};
```

### Combined Authentication

Both provider and action-level authentication can be used together:

```typescript
const provider: MigrationProvider = {
  id: 'combined-provider',
  label: 'Combined Provider',
  description: 'Uses both authentication levels',
  requiresAuthentication: true, // Default action requires auth

  async getAvailableActions(): Promise<MigrationProviderPickItem[]> {
    return [
      {
        id: 'demo',
        label: 'Demo Mode',
        description: 'No authentication needed for demo',
        requiresAuthentication: false,
      },
      {
        id: 'full-migration',
        label: 'Full Migration',
        description: 'Full migration with authentication',
        requiresAuthentication: true,
      },
    ];
  },

  async executeAction(options?: ActionsOptions, id?: string): Promise<void> {
    // Both default and custom actions handled appropriately
    // Access context via options parameter
  },
};
```
