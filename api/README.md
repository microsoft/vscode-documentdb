# DocumentDB Extension API

⚠️ **Warning**: This is an experimental API for a feature currently in development. It is intended for internal use only. The API is unstable and subject to rapid changes, which may break compatibility without notice.

This package provides the Extension API for integrating with the VS Code DocumentDB extension.

## Installation

```bash
npm install --save-dev @microsoft/vscode-documentdb-api
```

## Usage

```typescript
import { getDocumentDBExtensionApi, MigrationProvider } from '@microsoft/vscode-documentdb-api';

export async function activate(context: vscode.ExtensionContext) {
  // Get the DocumentDB extension API
  const api = await getDocumentDBExtensionApi(context, '0.1.0');

  // Create your migration provider
  const myProvider: MigrationProvider = {
    id: 'my-provider',
    label: 'My Migration Provider',
    description: 'Migrates data from X to Y',

    async activate() {
      // Initialize your provider
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

- `id`: Unique identifier for the provider
- `label`: Display name shown to users
- `description`: Brief description of what the provider does
- `iconPath` (optional): Icon for the provider
- `activate()`: Called when the provider needs to be initialized
- `getLearnMoreUrl()` (optional): Returns a URL for more information
