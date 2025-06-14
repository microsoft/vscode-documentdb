<!-- Learn More Section Badge or Breadcrumb -->

> **Learn More** &mdash; [Back to Learn More Index](./index.md)

---

# Data Migrations in DocumentDB for VS Code

**DocumentDB for VS Code** provides a powerful and extensible data migration framework that enables seamless data movement between different database systems, cloud platforms, and local environments. This feature is designed to simplify complex migration scenarios while maintaining full control over the migration process.

> **⚠️ Experimental Feature**
>
> Data migrations are currently an **experimental feature** in active development. The API and user interface may change as we refine the functionality based on community feedback. Once the API stabilizes, it will be published to npm for easier integration.
>
> **Interested in the preview?** We're looking for early adopters to help shape this feature. If you'd like to join the preview phase, please reach out to us through our [GitHub discussions](https://github.com/microsoft/vscode-documentdb/discussions) or [create an issue](https://github.com/microsoft/vscode-documentdb/issues).

## How Data Migrations Work

The migration system in DocumentDB for VS Code is built on a **provider-based architecture**. Each migration provider is a specialized extension that understands how to handle migrations for specific platforms, tools, or migration scenarios.

### The Migration Workflow

1. **Provider Registration**: Migration providers register themselves with the DocumentDB extension
2. **Discovery**: When you right-click on a database connection, available migration providers are discovered
3. **Action Selection**: Providers can offer multiple migration actions (e.g., "Migrate to ABC", "Sync with Local")
4. **Authentication**: Providers handle their own authentication requirements
5. **Execution**: The selected migration action is executed with full context about your database connection

This approach ensures that each migration provider can focus on its specific domain expertise while leveraging the DocumentDB extension's connection management and UI capabilities.

## Key Benefits

### Unified Experience

All migration operations are accessible directly from your database connections in the DocumentDB sidebar. No need to switch between different tools or remember complex command-line syntax.

### Context-Aware Operations

Migration providers receive full context about your database connection, including:

- Connection string details
- Current database and collection selection
- Authentication state
- Extended properties for custom scenarios

### Extensible Architecture

The plugin system allows third-party developers to create specialized migration providers for their specific needs, platforms, or tools.

### Flexible Authentication

Each provider can implement its own authentication strategy, from simple API keys to complex OAuth flows, ensuring compatibility with various platforms and security requirements.

# Migration API Overview

The DocumentDB Migration API provides a clean, TypeScript-based interface for building migration providers. The API is designed to be both powerful and approachable for developers.

### Core Components

#### MigrationProvider Interface

The main interface that all migration providers must implement:

```typescript
export interface MigrationProvider {
  // Basic identification
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly iconPath?: vscode.Uri | vscode.ThemeIcon;

  // Optional documentation
  getLearnMoreUrl?(): string | undefined;

  // Authentication requirements (optional)
  requiresAuthentication?: boolean;

  // Core functionality
  getAvailableActions(options?: ActionsOptions): Promise<MigrationProviderPickItem[]>;
  executeAction(options?: ActionsOptions, id?: string): Promise<void>;
}
```

#### ActionsOptions Interface

Provides context about the current database connection:

```typescript
export interface ActionsOptions {
  connectionString?: string;
  databaseName?: string;
  collectionName?: string;

  // Future-proof extensibility
  extendedProperties?: { [key: string]: string | undefined };
}
```

#### MigrationProviderPickItem Interface

Represents individual migration actions:

```typescript
export interface MigrationProviderPickItem extends vscode.QuickPickItem {
  id: string;
  requiresAuthentication?: boolean;
}
```

### Provider Action Workflow

Migration providers can implement two different workflows:

#### Multiple Actions Workflow

When `getAvailableActions()` returns one or more actions, users will see a selection dialog with the available options. After selecting an action, `executeAction()` is called with the selected action's `id`.

#### Direct Action Workflow

When `getAvailableActions()` returns an empty array, selecting the provider from the list will directly call `executeAction()` with no `id` parameter, executing the provider's default action immediately.

This flexibility allows providers to either offer multiple specialized operations or provide a single, streamlined migration experience.

### Getting Started with the API

To use the Migration API in your extension, you'll need to:

1. **Install the API package** (will be published to npm)
2. **Get the API instance** from the DocumentDB extension
3. **Register your provider** with the migration service

#### Example: Basic Migration Provider

```typescript
import * as vscode from 'vscode';
import { getDocumentDBExtensionApi } from '@ms-azuretools/vscode-documentdb-api'; // Will be published to npm

export async function activate(context: vscode.ExtensionContext) {
  try {
    // Get the DocumentDB extension API
    const api = await getDocumentDBExtensionApi(context, '0.1.0');

    // Create and register your migration provider
    const myProvider = new MyMigrationProvider();
    api.migration.registerProvider(myProvider);

    console.log('Migration provider registered successfully');
  } catch (error) {
    console.error('Failed to register migration provider:', error);
  }
}

class MyMigrationProvider implements MigrationProvider {
  readonly id = 'my-extension.cluster-migration';
  readonly label = 'Cluster Migration';
  readonly description = 'Migrate data to another cluster';
  readonly iconPath = new vscode.ThemeIcon('database');

  async getAvailableActions(options?: ActionsOptions): Promise<MigrationProviderPickItem[]> {
    return [
      {
        id: 'migrate-current-collection',
        label: 'Migrate Current Collection',
        description: 'Migrate the selected collection to target cluster',
      },
      {
        id: 'migrate-entire-database',
        label: 'Migrate Entire Database',
        description: 'Migrate all collections in the database to target cluster',
      },
    ];
  }

  async executeAction(options?: ActionsOptions, id?: string): Promise<void> {
    switch (id) {
      case 'migrate-current-collection':
        await this.migrateCollection(options);
        break;
      case 'migrate-entire-database':
        await this.migrateDatabase(options);
        break;
      default:
        // Default action when no specific action is selected
        await this.migrateCollection(options);
    }
  }

  private async migrateCollection(options?: ActionsOptions): Promise<void> {
    // Implementation for migrating a single collection
    const collectionName = options?.collectionName || 'default';
    vscode.window.showInformationMessage(`Migrating collection: ${collectionName}`);
    // ... migration logic here
  }

  private async migrateDatabase(options?: ActionsOptions): Promise<void> {
    // Implementation for migrating entire database
    const databaseName = options?.databaseName || 'default';
    vscode.window.showInformationMessage(`Migrating database: ${databaseName}`);
    // ... migration logic here
  }
}
```

## Advanced Scenarios

### Authentication Support

Migration providers can specify whether they require user authentication to access full connection details. This is useful when the provider needs authenticated access to both source and target systems. Providers can specify authentication requirements either for the default action (using the `requiresAuthentication` property) or for individual actions (using the same property on `MigrationProviderPickItem`).

### Context-Aware Actions

Providers can customize available actions based on the current context:

```typescript
async getAvailableActions(options?: ActionsOptions): Promise<MigrationProviderPickItem[]> {
    const actions: MigrationProviderPickItem[] = [];

    // Add different actions based on context
    if (options?.collectionName) {
        actions.push({
            id: 'migrate-collection',
            label: `Migrate Collection: ${options.collectionName}`,
            description: 'Migrate only the selected collection'
        });
    }

    if (options?.databaseName) {
        actions.push({
            id: 'migrate-database',
            label: `Migrate Database: ${options.databaseName}`,
            description: 'Migrate the entire database'
        });
    }

    // Always offer full migration
    actions.push({
        id: 'migrate-all',
        label: 'Full Migration',
        description: 'Migrate all databases and collections'
    });

    return actions;
}
```

### Extended Properties

Use extended properties for custom configuration:

```typescript
async executeAction(options?: ActionsOptions, id?: string): Promise<void> {
    // Access custom properties
    const customSetting = options?.extendedProperties?.['customSetting'];
    const batchSize = parseInt(options?.extendedProperties?.['batchSize'] || '1000');

    // Use in migration logic
    await this.performMigration({
        connectionString: options?.connectionString,
        batchSize: batchSize,
        customSetting: customSetting
    });
}
```

## API Access and Whitelisting

> **⚠️ Preview Phase Restrictions**
>
> During the experimental phase, access to the Migration API is restricted to whitelisted extensions. This ensures stability and allows us to gather focused feedback from early adopters.

To access the API, your extension must be added to the whitelist in the DocumentDB extension. The current process is:

1. **Reach out to us** through [GitHub discussions](https://github.com/microsoft/vscode-documentdb/discussions)
2. **Provide your extension ID** and a brief description of your migration provider
3. **We'll add your extension** to the whitelist and provide guidance
4. **Test and provide feedback** to help us improve the API

Once the experimental phase concludes, the API will be open to all extensions without restrictions.

## API Reference

### Core Interfaces

#### `MigrationProvider`

The main interface for migration providers.

**Properties:**

- `id: string` - Unique identifier for the provider
- `label: string` - Display name shown to users
- `description: string` - Brief description of the provider's functionality
- `iconPath?: vscode.Uri | vscode.ThemeIcon` - Optional icon for the provider
- `requiresAuthentication?: boolean` - Whether the provider requires authentication

**Methods:**

- `getLearnMoreUrl?(): string | undefined` - Optional URL to documentation
- `getAvailableActions(options?: ActionsOptions): Promise<MigrationProviderPickItem[]>` - Returns available actions
- `executeAction(options?: ActionsOptions, id?: string): Promise<void>` - Executes the specified action

#### `ActionsOptions`

Context information passed to migration providers.

**Properties:**

- `connectionString?: string` - Database connection string
- `databaseName?: string` - Currently selected database
- `collectionName?: string` - Currently selected collection
- `extendedProperties?: { [key: string]: string | undefined }` - Custom properties

#### `MigrationProviderPickItem`

Represents an individual migration action.

**Properties:**

- `id: string` - Unique identifier for the action
- `label: string` - Display name for the action
- `description?: string` - Optional description
- `requiresAuthentication?: boolean` - Whether this specific action requires authentication

### API Access

#### `getDocumentDBExtensionApi(context, version)`

Main entry point for accessing the DocumentDB extension API.

**Parameters:**

- `context: vscode.ExtensionContext` - Your extension's context
- `version: string` - Required API version

**Returns:** `Promise<DocumentDBExtensionApi>`

**Example:**

```typescript
const api = await getDocumentDBExtensionApi(context, '0.1.0');
```

## Get Involved

The Data Migration feature is being developed in close collaboration with the community. Here's how you can get involved:

### Join the Preview

If you're interested in building migration providers or using the API, reach out to us:

- **GitHub Discussions**: [Join the conversation](https://github.com/microsoft/vscode-documentdb/discussions)
- **Issues**: [Report bugs or request features](https://github.com/microsoft/vscode-documentdb/issues)
- **Community**: Share your use cases and migration scenarios

### Provide Feedback

Your feedback shapes the future of this feature:

- **API Design**: Help us refine the interfaces and workflows
- **Use Cases**: Share your migration scenarios and requirements
- **Documentation**: Suggest improvements to this documentation

### Contribute

Once you're part of the preview program:

- **Build Providers**: Create migration providers for your favorite platforms
- **Share Examples**: Contribute example implementations
- **Improve Documentation**: Help us create better guides and tutorials
