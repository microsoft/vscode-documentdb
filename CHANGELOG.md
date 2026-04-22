# Change Log

## 0.7.4

### New Features & Improvements

- **URL-Encoded Password Detection**: When a connection attempt fails and the password contains URL-encoded characters, the extension now offers a "Retry with Decoded Password" option. If the retry succeeds, the decoded password can be saved. [#444](https://github.com/microsoft/vscode-documentdb/issues/444), [#594](https://github.com/microsoft/vscode-documentdb/pull/594)
- **Rich Markdown Tooltips**: Cluster, database, and collection tree items in the Connections view now show rich markdown tooltips on hover, displaying useful details (host, auth method, document count, storage size) without requiring expansion or connection. [#579](https://github.com/microsoft/vscode-documentdb/issues/579), [#588](https://github.com/microsoft/vscode-documentdb/pull/588)
- **Copy Reference Context Menu**: Adds a "Copy Reference…" right-click option to database, collection, and index nodes with a QuickPick format picker. Databases offer name, shell command (`use dbName`), or qualified name; collections offer name, namespace, shell reference, or `db.getCollection()` form; indexes offer name, key definition, or shell command. Names with special characters automatically use safe escaping. [#545](https://github.com/microsoft/vscode-documentdb/pull/545), [#587](https://github.com/microsoft/vscode-documentdb/pull/587)

### Documentation

- **Improved CONTRIBUTING.md**: Adds a PR submission checklist, corrects Node/npm version requirements, and adds multi-platform setup stubs. [#565](https://github.com/microsoft/vscode-documentdb/pull/565)

### Dependencies

- **Dependency Updates**: Bumps `handlebars` (4.7.8 → 4.7.9), `lodash` (4.17.23 → 4.18.1), `lodash` and `@microsoft/api-extractor` in `/api`, and `follow-redirects` (1.15.11 → 1.16.0). [#552](https://github.com/microsoft/vscode-documentdb/pull/552), [#556](https://github.com/microsoft/vscode-documentdb/pull/556), [#558](https://github.com/microsoft/vscode-documentdb/pull/558), [#586](https://github.com/microsoft/vscode-documentdb/pull/586)

## 0.7.3

### New Features

- **Cancellable Connection**: Users can now cancel in-progress cluster connection attempts via the progress notification. [#529](https://github.com/microsoft/vscode-documentdb/pull/529)

### Improvements

- **Dependency Updates**: Upgrades Node.js from 20 to 22 and bumps `undici`, `handlebars`, `brace-expansion`, `picomatch`, and `flatted` to their latest versions. [#523](https://github.com/microsoft/vscode-documentdb/pull/523), [#534](https://github.com/microsoft/vscode-documentdb/pull/534), [#537](https://github.com/microsoft/vscode-documentdb/pull/537), [#539](https://github.com/microsoft/vscode-documentdb/pull/539), [#541](https://github.com/microsoft/vscode-documentdb/pull/541), [#542](https://github.com/microsoft/vscode-documentdb/pull/542)
- **Telemetry Improvements**: Refines connection and discovery action telemetry with more specific, actionable diagnostic properties. [#544](https://github.com/microsoft/vscode-documentdb/pull/544)

## 0.7.2

### Improvements

- **Data Migration Discoverability**: The "Data Migration…" menu is now always visible on cluster nodes and introduces announced providers infrastructure to help users discover and install migration extensions from the Marketplace. [#515](https://github.com/microsoft/vscode-documentdb/pull/515)
- **Reconnect Prompt After Credential Update**: Offers a reconnect prompt when updating credentials from an error recovery node, so users no longer need to manually retry the connection. [#504](https://github.com/microsoft/vscode-documentdb/pull/504)
- **Experimental AI Query Generation Setting**: Adds `documentDB.experimental.enableAIQueryGeneration` setting to control the AI query generation feature, disabled by default. Reports experimental feature status via activation telemetry. [#503](https://github.com/microsoft/vscode-documentdb/pull/503)
- **tRPC Upgrade and Abort Signal Support**: Upgrades `@trpc/client` and `@trpc/server` to v11.10.0 and adds `AbortSignal`-based cancellation for webview operations. [#320](https://github.com/microsoft/vscode-documentdb/issues/320), [#502](https://github.com/microsoft/vscode-documentdb/pull/502)
- **Connection String Validation**: Adds defensive trimming (including BOM, NBSP) at all input entry points and simplifies credential validation to avoid unnecessary parse/serialize round-trips. [#511](https://github.com/microsoft/vscode-documentdb/pull/511)
- **Feedback Collection Documentation**: Documents how the extension collects user feedback and its relation to VS Code's global telemetry setting in the README. [#509](https://github.com/microsoft/vscode-documentdb/pull/509)

### Security

- **Dependency Updates**: Updates `minimatch` (3.1.2 → 3.1.4), `qs`, and `body-parser` to address security vulnerabilities. [#505](https://github.com/microsoft/vscode-documentdb/pull/505), [#514](https://github.com/microsoft/vscode-documentdb/pull/514)

## 0.7.1 _skipped_

Version 0.7.1 was reserved for an internal validation build and was not released on the Marketplace.

## 0.7.0

### New Features

- **Collection Copy and Paste**: Adds lightweight data migration to copy collections across databases and connections, with conflict resolution options and throttling-aware batching. [#63](https://github.com/microsoft/vscode-documentdb/issues/63), [#170](https://github.com/microsoft/vscode-documentdb/pull/170)
- **Connection Folders**: Adds folders and subfolders in the Connections view to organize connections, including move/rename/delete workflows. [#426](https://github.com/microsoft/vscode-documentdb/pull/426)

### Improvements

- **Accessibility**: Improves screen reader announcements, keyboard navigation, and ARIA labeling across Query Insights and document editing. [#374](https://github.com/microsoft/vscode-documentdb/issues/374), [#375](https://github.com/microsoft/vscode-documentdb/issues/375), [#377](https://github.com/microsoft/vscode-documentdb/issues/377), [#378](https://github.com/microsoft/vscode-documentdb/issues/378), [#379](https://github.com/microsoft/vscode-documentdb/issues/379), [#380](https://github.com/microsoft/vscode-documentdb/issues/380), [#381](https://github.com/microsoft/vscode-documentdb/issues/381), [#384](https://github.com/microsoft/vscode-documentdb/issues/384), [#385](https://github.com/microsoft/vscode-documentdb/issues/385)
- **Alphabetical Collection Sorting**: Sorts collections alphabetically in the tree view. [#456](https://github.com/microsoft/vscode-documentdb/issues/456), [#465](https://github.com/microsoft/vscode-documentdb/pull/465)
- **Cancellable Imports**: Import operations can now be cancelled. [#496](https://github.com/microsoft/vscode-documentdb/pull/496)
- **Collection Paste Feedback**: Refreshes collection metadata after paste and improves error reporting for failed writes. [#482](https://github.com/microsoft/vscode-documentdb/pull/482), [#484](https://github.com/microsoft/vscode-documentdb/pull/484)
- **Collection Paste Validation and Input Trimming Consistency**: Fixes inconsistent trimming/validation of user input. [#493](https://github.com/microsoft/vscode-documentdb/pull/493)
- **Connection String Validation**: Trims and validates connection string input to avoid empty values. [#467](https://github.com/microsoft/vscode-documentdb/pull/467)
- **Copy Connection String with Password**: Adds an option to include the password when copying a connection string. [#436](https://github.com/microsoft/vscode-documentdb/pull/436)
- **Estimated Document Count**: Shows an estimated document count for collections in the tree view. [#170](https://github.com/microsoft/vscode-documentdb/pull/170)
- **Import/Export Feedback**: Improves user feedback and error handling for import/export operations. [#495](https://github.com/microsoft/vscode-documentdb/pull/495)
- **Query Insights Prompt Hardening**: Updates the Query Insights model/prompt and adds additional prompt-injection mitigations. [#468](https://github.com/microsoft/vscode-documentdb/pull/468)
- **Release Notes Notification**: Prompts users to view release notes after upgrading to a new major or minor version. [#487](https://github.com/microsoft/vscode-documentdb/pull/487)

### Fixes

- **Azure Resources View Expansion**: Fixes cluster expansion failures in the Azure Resources view by deriving resource group information from resource IDs. [#480](https://github.com/microsoft/vscode-documentdb/pull/480)
- **Connection String Deduplication**: Fixes an issue where connection string parameters were duplicated, ensuring valid connection strings and compliance with specifications. [#478](https://github.com/microsoft/vscode-documentdb/pull/478)
- **Dark Theme Rendering**: Fixes unreadable text in some dark themes by respecting theme colors. [#457](https://github.com/microsoft/vscode-documentdb/issues/457)
- **Import from Discovery View**: Fixes document import for Azure Cosmos DB for MongoDB (RU) discovery when connection metadata is not yet cached. [#368](https://github.com/microsoft/vscode-documentdb/issues/368), [#479](https://github.com/microsoft/vscode-documentdb/pull/479)
- **Invalid Query JSON**: Shows a clear error when query JSON fails to parse instead of silently using empty objects. [#458](https://github.com/microsoft/vscode-documentdb/issues/458), [#471](https://github.com/microsoft/vscode-documentdb/pull/471)
- **Keyboard Paste Shortcuts**: Restores Ctrl+V/Cmd+V in the Query Editor and Document View by pinning Monaco to 0.52.2. [#435](https://github.com/microsoft/vscode-documentdb/issues/435), [#470](https://github.com/microsoft/vscode-documentdb/pull/470)
- **Query Insights Markdown Rendering**: Restricts AI output formatting to avoid malformed markdown rendering. [#428](https://github.com/microsoft/vscode-documentdb/issues/428)

### Security

- **Dependency Updates**: Updates `qs` and `express` to address security vulnerabilities. [#434](https://github.com/microsoft/vscode-documentdb/pull/434)
- **Webpack Update**: Bumps `webpack` from 5.103.0 to 5.105.0. [#494](https://github.com/microsoft/vscode-documentdb/pull/494)

## 0.6.3

### Improvements

- **Query Insights**: The Query Insights feature has been updated to use the available `executionStats` instead of running the analysis in the AI context, improving performance and reliability. [#404](https://github.com/microsoft/vscode-documentdb/issues/404), [#423](https://github.com/microsoft/vscode-documentdb/pull/423)
- **API Telemetry Support**: Enhanced telemetry support in web views for better monitoring and diagnostics. [#429](https://github.com/microsoft/vscode-documentdb/pull/429)
- **Dependency Security Update**: Updated `tRPC` dependencies to address a security vulnerability. [#430](https://github.com/microsoft/vscode-documentdb/issues/430), [#431](https://github.com/microsoft/vscode-documentdb/pull/431)

## 0.6.2

### Fixes

- **Azure Tenant Filtering in Service Discovery**: Resolved an issue where users could not deselect tenants when filtering from a large number of available tenants. This update improves the Azure account, tenant, and subscription management workflow. For more details on the enhanced workflow, see the [updated documentation](https://microsoft.github.io/vscode-documentdb/user-manual/managing-azure-discovery). [#391](https://github.com/microsoft/vscode-documentdb/issues/391), [#415](https://github.com/microsoft/vscode-documentdb/pull/415)
- **Service Discovery Defaults**: The service discovery feature now starts with no pre-selected engines. Previously, the Azure Cosmos DB for MongoDB (RU) plugin was enabled by default, which has been corrected. [#390](https://github.com/microsoft/vscode-documentdb/issues/390), [#412](https://github.com/microsoft/vscode-documentdb/pull/412)
- **Accessibility in Query Insights**: Fixed a responsive layout issue in the "Query Insights" tab where the 'AI response may be inaccurate' text would overlap with other UI elements on resize. [#376](https://github.com/microsoft/vscode-documentdb/issues/376), [#416](https://github.com/microsoft/vscode-documentdb/pull/416)

### Improvements

- **Dependency Upgrades**:
  - Upgraded to React 19 and SlickGrid 9, enhancing UI performance and modernizing the webview components. This also includes updates to TypeScript, Webpack, and other build tools. [#406](https://github.com/microsoft/vscode-documentdb/issues/406), [#407](https://github.com/microsoft/vscode-documentdb/pull/407)
  - Updated various other dependencies to improve security and performance. [#386](https://github.com/microsoft/vscode-documentdb/pull/386)

## 0.6.1

### New Features & Improvements

- **Feedback Optimization**: Introduces privacy consent and feedback signal controls for the Query Insights feature, primarily to ensure compliance with organizational data protection requirements and user telemetry settings. It also disables survey functionality and refines the feedback dialog UI. [#392](https://github.com/microsoft/vscode-documentdb/pull/392)

### Fixes

- **Privacy Policy Link**: Updated the outdated privacy policy link in the README to the current Microsoft privacy statement URL. [#388](https://github.com/microsoft/vscode-documentdb/pull/388)

## 0.6.0

### New Features & Improvements

- **Query Insights with Performance Advisor**: Introduces a new "Query Insights" tab that provides a three-stage analysis of query performance. This includes a static query plan, detailed execution statistics, and AI-powered recommendations from GitHub Copilot to help understand performance bottlenecks and optimize slow queries.
- **Improved Query Specification**: The query editor now supports `projection`, `sort`, `skip`, and `limit` parameters, in addition to `filter`. Autocompletion is also enabled for `projection` and `sort` fields.
- **Index Management from the Tree View**: Users can now `drop`, `hide`, and `unhide` indexes directly from the context menu in the Connections View.
- **Azure Cosmos DB for MongoDB (vCore)** is now **Azure DocumentDB**: Renamed the service in the UI and in the documentation.

### Fixes

- **UI Element Visibility**: Fixed issues where the autocomplete list in the query editor and tooltips in tree/table views could be hidden by other UI elements.

## 0.5.2

### New Features & Improvements

- **Updated Migration API for Integrations**: This release introduces API versioning for the DocumentDB extension API and adds support for a new, more robust v0.3.0 API. The changes update documentation, interfaces, and implementation to reflect the new API version, including stricter provider registration and context validation. The migration provider workflow and usage examples have been clarified, and deprecated API versions are documented. Additional improvements include dependency updates, better credential handling, and minor localization and client registration changes. [#321](https://github.com/microsoft/vscode-documentdb/issues/321), [#322](https://github.com/microsoft/vscode-documentdb/pull/322)

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
- Query playground support for executing queries and managing databases.
