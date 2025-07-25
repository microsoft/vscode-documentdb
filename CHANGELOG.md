# Change Log

## 0.2.3

### New Features & Improvements

- **Connection Focus Enhancement**: Newly created connections are automatically selected and focused in the Connections View. If a connection already exists, the existing one is highlighted for better user awareness. [#122](https://github.com/microsoft/vscode-documentdb/issues/122)

### Fixes

- **JSON Schema Stability**: Improved JSON schema handling in the "Collection View" to prevent worker errors during rapid refresh operations. [#202](https://github.com/microsoft/vscode-documentdb/pull/202)
- **Complex Password Handling**: Improved connection string parsing and URL handler to properly support complex passwords with special characters. [#190](https://github.com/microsoft/vscode-documentdb/issues/190)
- **Dependency Updates**: Updated and removed obsolete dependencies to improve security and performance. [#167](https://github.com/microsoft/vscode-documentdb/issues/167)
- **Development Tooling**: Modernized ESLint, Prettier, and TypeScript configurations with updated dependencies and ES2023 target support. [#168](https://github.com/microsoft/vscode-documentdb/issues/168)

## 0.2.2

### New Features & Improvements

- **Data Migration Preview Support**: Introduced a new, experimental migration framework supporting extensible provider-based migrations. Enables advanced data movement scenarios across environments. Early adopters can join via GitHub. [#161](https://github.com/microsoft/vscode-documentdb/pull/161)
- **Connection URL Handling**: Added support for deep linking into the extension via `vscode://` URLs, allowing pre-configured database connections and navigation to specific collections. [#148](https://github.com/microsoft/vscode-documentdb/issues/148)
- **Import Performance Boost**: Imports are now buffered for significantly faster document loading. This greatly improves performance, especially for large datasets. _(Note: Currently disabled for Azure Cosmos DB for MongoDB (RU) until resource limit detection is refined.)_ [#130](https://github.com/microsoft/vscode-documentdb/issues/130)

### Fixes

- **Connection String Duplication**: Users are now notified if they attempt to add a connection string that already exists. [#88](https://github.com/microsoft/vscode-documentdb/issues/88)
- **Service Discovery UX**: Improved guidance after login in Azure Service Discovery — users now receive clear feedback and prompts following authentication. [#91](https://github.com/microsoft/vscode-documentdb/issues/91)
- **Challenge Dialog on macOS**: Fixed an issue where both default and active buttons were visually marked during confirmation dialogs, potentially leading to accidental confirmations. [#128](https://github.com/microsoft/vscode-documentdb/issues/128)
- **VM Discovery Port Customization**: Users can now specify a custom port when connecting via Azure VM discovery. [#85](https://github.com/microsoft/vscode-documentdb/issues/85)
- **Context Menu Cleanup**: Disabled default Cut/Copy/Paste options in table and tree views where those actions are not applicable. [#81](https://github.com/microsoft/vscode-documentdb/issues/81)
- **Language Server Conflict**: Resolved duplicate CodeLens actions caused by conflict with Azure Databases extension. [#109](https://github.com/microsoft/vscode-documentdb/issues/109)

## 0.2.1

### Fixes

- Fixed inconsistent icons between Connections and Discovery Views. [#84](https://github.com/ms/vscode-documentdb/issues/84)
- Updated Extension Output Console to use standard naming conventions. [#80](https://github.com/ms/vscode-documentdb/issues/80)
- Added missing hover labels for UI buttons. [#90](https://github.com/ms/vscode-documentdb/issues/90)
- Improved shell password handling for PowerShell and added detection for other terminal options. [#106](https://github.com/ms/vscode-documentdb/issues/106)

## 0.2.0 - First Public Preview Release

- Support for DocumentDB and MongoDB databases.
- Universal DoumentDB and MongoDB connectivity using connection strings.
- Built in Service Discovery with an extensible API:
  - Support for Azure Cosmos DB for MongoDB (vCore)
  - Support for Virtual Machines on Azure with a user-specified `tag`

- UI for executing find queries, with table, tree, and JSON views.
- UI for creating, viewing, and editing documents in a separate tab.
- Import and Export capability: JSON format
- MongoDB Scrapbook support for executing queries and managing databases.
