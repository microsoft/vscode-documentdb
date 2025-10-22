# Change Log

## 0.5.1

### Fixes

- **Connection String Parsing**: Resolved an issue where connection strings containing special characters (e.g., `@`) in query parameters, such as those from Azure Cosmos DB (`appName=@myaccount@`), would fail to parse. The connection string parser now properly sanitizes query parameters before parsing, ensuring reliable connections. [#314](https://github.com/microsoft/vscode-documentdb/issues/314), [#316](https://github.com/microsoft/vscode-documentdb/pull/316)

## 0.5.0

### New Features & Improvements

- **Enhanced Microsoft Entra ID Support**: Overhauled Microsoft Entra ID integration for Azure Cosmos DB for MongoDB (vCore) to fully support multi-account and multi-tenant environments, enabling uninterrupted workflows for developers working across different organizations. This includes multi-account management and multi-tenant filtering. [#277](https://github.com/microsoft/vscode-documentdb/pull/277), [#285](https://github.com/microsoft/vscode-documentdb/issues/285), [#284](https://github.com/microsoft/vscode-documentdb/issues/284), [#265](https://github.com/microsoft/vscode-documentdb/issues/265), [#243](https://github.com/microsoft/vscode-documentdb/issues/243)
- **New "Help and Feedback" View**: Added a new view to the extension sidebar, providing a central place to access documentation, see the changelog, report issues, and request features. [#289](https://github.com/microsoft/vscode-documentdb/pull/289)

### Fixes

- **Password Re-entry on Shell Launch**: Fixed a regression where users with saved credentials were still prompted for a password when launching the shell. [#285](https://github.com/microsoft/vscode-documentdb/issues/285)
- **Tenant Information in Service Discovery**: Resolved an issue where the extension would fail to respect the tenant context when interacting with Azure resources from a non-default tenant. [#276](https://github.com/microsoft/vscode-documentdb/issues/276)
- **Connection Authentication Update**: Corrected a failure that occurred when updating a connection's authentication method from Entra ID to a username/password. [#284](https://github.com/microsoft/vscode-documentdb/issues/284)

## 0.4.1

### Improvement

- **Walkthrough Welcome Screen & Sidebar Icon Discovery**: The walkthrough welcome screen behavior has been updated to help users notice the updated extension icon in the VS Code sidebar. This change highlights the new branding so users can find the extension more easily from the environment they already use. [#253](https://github.com/microsoft/vscode-documentdb/pull/253)

## 0.4.0

### New Features & Improvements

- **Deep Azure Integration**: Introduces deep integration with the Azure Resources extension, providing a unified experience for discovering and managing Azure Cosmos DB for MongoDB (RU and vCore) resources directly within the Azure view. [#58](https://github.com/microsoft/vscode-documentdb/issues/58)
- **Service Discovery for MongoDB (RU)**: Adds a new service discovery provider for Azure Cosmos DB for MongoDB (RU) resources, enabling effortless connection and authentication through the Discovery View. [#244](https://github.com/microsoft/vscode-documentdb/issues/244)
- **Official DocumentDB Logo**: Updated the extension's icon and branding to use the official DocumentDB logo for better brand recognition and consistency. [#246](https://github.com/microsoft/vscode-documentdb/pull/246)

### Fixes

- **Connection String Password Support**: Restored support for passwords when creating new connections using a connection string, fixing a regression that affected certain configurations. [#247](https://github.com/microsoft/vscode-documentdb/pull/247)
- **Improved Debugging Information**: Enhanced internal error handling for `nonNull` checks to include file context, making it easier to diagnose and triage issues. [#236](https://github.com/microsoft/vscode-documentdb/pull/236)

## 0.3.1

### Fixes

- **Tree View Stability**: Improved the stability of the Connections View when adding or removing databases and collections. This change prevents internal warnings that could occur when displaying temporary items in the tree. [#233](https://github.com/microsoft/vscode-documentdb/pull/233)

## 0.3.0

### New Features & Improvements

- **Entra ID Authentication for Azure Cosmos DB for MongoDB (vCore)**: Added support for Microsoft Entra ID (formerly Azure AD) as an authentication method. This allows for secure, passwordless connections and is integrated into the service discovery and connection workflows. [#123](https://github.com/microsoft/vscode-documentdb/issues/123)

## 0.2.4

### New Features & Improvements

- **UUID Query Support**: Enabled querying for documents using UUIDs in MongoDB clusters, addressing a key workflow limitation for users with UUID-based identifiers. [#172](https://github.com/microsoft/vscode-documentdb/issues/172)

### Fixes

- **Azure Discovery Update**: Migrated to the new `@azure/arm-mongocluster` package for improved Azure vCore/DocumentDB discovery. [#194](https://github.com/microsoft/vscode-documentdb/issues/194)
- **Development Tooling**: Updated build pipelines to support extension signing, preparing for automated releases to the VS Code Marketplace. [#163](https://github.com/microsoft/vscode-documentdb/issues/163)

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
