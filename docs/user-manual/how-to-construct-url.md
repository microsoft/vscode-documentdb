---
title: 'Connect with a URL'
parent: 'Connecting to Databases'
nav_order: 1
---

# How to Construct a URL That Opens the Extension

The **DocumentDB extension for Visual Studio Code** supports activation through custom URLs, enabling you to integrate the extension seamlessly with your development environment and build deep links directly to your DocumentDB and MongoDB clusters. This powerful feature allows you to create shortcuts that can open specific connections, navigate to particular databases, or even jump directly to a collection view within the extension.

This URL-based activation is particularly useful for:

- **Development Workflow Integration:** Create bookmarks or shortcuts that instantly connect to your frequently used databases
- **Team Collaboration:** Share direct links to specific database resources with your team members
- **Documentation and Tutorials:** Embed clickable links in documentation that open specific database connections
- **External Tool Integration:** Allow other applications to launch the extension with pre-configured connections

## URL Syntax

The prefix for URLs handled by this extension is:

```
vscode://ms-azuretools.vscode-documentdb
```

A link names **what it wants** in the path, and supplies **arguments for it** in the query:

```
vscode://ms-azuretools.vscode-documentdb/<action>?<parameters>
```

### Supported Actions

| Action             | What it does                                                                                    | Parameters                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `connect`          | Opens a connection to a cluster, optionally navigating into it                                  | `connectionString`, `database`, `collection`, `open`, `source`       |
| `connect/azure`    | Opens an Azure DocumentDB or Azure Cosmos DB for MongoDB (RU) resource by its Azure resource ID | `resourceId`, `tenantId`, `database`, `collection`, `open`, `source` |
| `local`            | Opens the **DocumentDB Local** setup wizard                                                     | Optional `source`                                                    |
| `local/documentdb` | Opens the **DocumentDB Local** setup wizard                                                     | Optional `source`                                                    |

Only the actions in this table are recognized. A link naming anything else is refused with an
explanatory message — the extension never treats the path as a command name, so a link cannot
reach extension functionality that is not listed here. In `/connect/azure`, `azure` is case-insensitive;
other sources (`/connect/<other>`) and extra path segments are refused.

> **Links written before actions existed keep working.** A URL with no action, such as
> `vscode://ms-azuretools.vscode-documentdb?connectionString=...`, means `connect`. You do not
> need to update existing links.

`local` accepts an optional local resource type. Currently, `documentdb` is the only supported
type, and omitting it defaults to `documentdb`, so `/local` and `/local/documentdb` are equivalent.
Unsupported resource types and additional path segments are refused rather than silently opening a
different setup experience.

### Supported Parameters

`connect` and `connect/azure` use different locator parameters. Parameters that belong to the other
variant are refused, including links that mix the two variants' locators. Other unknown parameters
are ignored.

| Parameter          | `/connect`                                                        | `/connect/azure`                            | Description                                                                           |
| ------------------ | ----------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------- |
| `connectionString` | Required (double-encoded, unchanged)                              | Refused                                     | Connection string; for example, `mongodb%253A%252F%252F...`                           |
| `resourceId`       | Refused                                                           | Required                                    | Azure resource ID; raw, encoded once, or encoded twice (encoding once is recommended) |
| `tenantId`         | Refused                                                           | Optional                                    | GUID for the Microsoft Entra tenant that owns the subscription                        |
| `database`         | Optional                                                          | Optional                                    | Name of the database to open                                                          |
| `collection`       | Optional; requires a database parameter or connection-string path | Optional; requires the `database` parameter | Collection to open                                                                    |
| `open`             | Optional                                                          | Optional                                    | `dashboard` or `shell` (case-insensitive); cannot be combined with `collection`       |
| `source`           | Optional                                                          | Optional                                    | Publisher attribution label; also supported on `/local` and `/local/documentdb`       |

### Parameter Details

- **`connectionString`**: The core parameter that defines the database connection for `/connect`. It must be a valid DocumentDB or MongoDB API connection string that has been double-encoded (see [Encoding Parameter Values](#encoding-parameter-values)). Note: While it's possible to include a database name in the connection string, it's recommended to use the separate `database` parameter instead to keep the API simple and consistent.
- **`resourceId`**: For `/connect/azure`, the Azure resource ID must have the form `/subscriptions/<subscription-guid>/resourceGroups/<group>/providers/Microsoft.DocumentDB/{mongoClusters|databaseAccounts}/<name>`, with nothing after the name. The provider and resource type are case-insensitive. `mongoClusters` identifies an Azure DocumentDB cluster; `databaseAccounts` identifies an Azure Cosmos DB for MongoDB (RU) account using the MongoDB API. The value can be raw or encoded once or twice; encoding once is recommended.
- **`tenantId`**: An optional GUID for the Microsoft Entra tenant (directory) that owns the subscription. It lets the extension choose the right account and offer to sign in to that tenant.
- **`database`**: When provided, the extension will automatically navigate to the specified database after establishing the connection. Names with spaces or special characters must be double-encoded (see [Encoding Parameter Values](#encoding-parameter-values)).
- **`collection`**: The extension opens the Collection View for this collection. For `/connect`, a database must be supplied either through the `database` parameter or in the connection-string path. For `/connect/azure`, the `database` parameter is required. Otherwise the link is rejected before connecting. Names with spaces or special characters must be double-encoded (see [Encoding Parameter Values](#encoding-parameter-values)).
- **`open`**: `dashboard` opens the Cluster Dashboard, scoped to `database` when provided, even if opening the dashboard automatically on connect is turned off. It replaces the automatic dashboard for that link, so only the requested dashboard opens. `shell` opens the interactive shell, scoped to `database` when provided. The parameter is case-insensitive and cannot be combined with `collection`; a link never carries a shell script, query, or command.
- **`source`**: An optional publisher label used only for telemetry attribution, on every action and on legacy links without an action. Use 1-64 ASCII letters, digits, hyphens, or underscores, starting with a letter or digit. Labels are recorded in lowercase. For example, use `source=azure-portal`, `source=documentdb-website`, or `source=docs-quickstart` to distinguish where you publish links. Do not include names, email addresses, resource identifiers, credentials, URLs, or other sensitive information. Empty, invalid, or repeated `source` parameters are ignored for attribution (with a diagnostic warning); they do not prevent the link from opening. The label does not change routing, authentication, confirmations, or telemetry consent.

For example, a website's setup link can be:

```text
vscode://ms-azuretools.vscode-documentdb/local?source=documentdb-website
```

For an existing link, append `&source=docs-quickstart` to its query. This publisher tag is
independent of the connection source named by the path (`/connect` versus `/connect/azure`).

## Encoding Parameter Values

VS Code decodes the link once when it receives it, and the extension decodes each parameter value a second time. Every parameter value is therefore decoded twice. To preserve values, the safe rule when building links is to double-encode every parameter value by applying URL component encoding twice, such as `encodeURIComponent(encodeURIComponent(value))` in JavaScript.

| Parameter                                    | Encoding                                                  |
| -------------------------------------------- | --------------------------------------------------------- |
| `connectionString`, `database`, `collection` | Double-encode                                             |
| `resourceId`, `tenantId`                     | Raw, encoded once, or encoded twice; examples encode once |
| `open`                                       | None                                                      |

Values made only of ASCII letters, digits, `-`, `_`, `.`, and `~` are unchanged by encoding, so they work encoded or not. Every other character in a value must be double-encoded, including spaces, `&`, `+`, `=`, `#`, `%`, `?`, `/`, and non-ASCII letters. This also applies to database and collection names. `resourceId` and `tenantId` contain only letters, digits, `-`, `_`, `.`, `(`, `)`, and `/`, which survive decoding, so they work raw, encoded once, or encoded twice; the examples encode the resource ID once. `open` values (`dashboard`, `shell`) never need encoding.

### Encoding Process

For example, the string `"mongo+srv://"` is encoded in two steps:

1. **First encoding**: Standard URL component encoding
   ```
   mongo%2Bsrv%3A%2F%2F
   ```
2. **Second encoding**: Encode the already-encoded string
   ```
   mongo%252Bsrv%253A%252F%252F
   ```

### Database and Collection Names

For the database `sales & marketing` and collection `orders+2024`:

| Parameter    | Original value      | Once-encoded              | Double-encoded                  |
| ------------ | ------------------- | ------------------------- | ------------------------------- |
| `database`   | `sales & marketing` | `sales%20%26%20marketing` | `sales%2520%2526%2520marketing` |
| `collection` | `orders+2024`       | `orders%2B2024`           | `orders%252B2024`               |

For a non-ASCII name, the database `café` is double-encoded as `caf%25C3%25A9`.

If a name is encoded only once, `&` ends the value and the rest becomes another, ignored parameter; `+` becomes a space; and percent sequences are decoded again. As a result, the extension can open the wrong or a missing database or collection.

### Building a Link in Code

These examples double-encode each value in a `/connect` link with a database and collection:

**JavaScript or TypeScript**

```javascript
const encodeValue = (value) => encodeURIComponent(encodeURIComponent(value));
const url = `vscode://ms-azuretools.vscode-documentdb/connect?connectionString=${encodeValue("mongodb://localhost:27017")}&database=${encodeValue("sales & marketing")}&collection=${encodeValue("orders+2024")}`;
```

**Python**

```python
from urllib.parse import quote

connection_string = quote(quote("mongodb://localhost:27017", safe=""), safe="")
database = quote(quote("sales & marketing", safe=""), safe="")
collection = quote(quote("orders+2024", safe=""), safe="")
url = f"vscode://ms-azuretools.vscode-documentdb/connect?connectionString={connection_string}&database={database}&collection={collection}"
```

**PowerShell**

```powershell
$connectionString = [uri]::EscapeDataString([uri]::EscapeDataString("mongodb://localhost:27017"))
$database = [uri]::EscapeDataString([uri]::EscapeDataString("sales & marketing"))
$collection = [uri]::EscapeDataString([uri]::EscapeDataString("orders+2024"))
$url = "vscode://ms-azuretools.vscode-documentdb/connect?connectionString=$connectionString&database=$database&collection=$collection"
```

For `/connect/azure`, the same JavaScript helper can double-encode every value. This is also fine for `resourceId`, `tenantId`, and `open`; the examples encode the resource ID once, and `open` values do not need encoding.

```javascript
const encodeValue = (value) => encodeURIComponent(encodeURIComponent(value));
const resourceId = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/my-group/providers/Microsoft.DocumentDB/mongoClusters/my-cluster";
const url = `vscode://ms-azuretools.vscode-documentdb/connect/azure?resourceId=${encodeValue(resourceId)}&tenantId=${encodeValue("11111111-1111-1111-1111-111111111111")}&database=${encodeValue("analytics")}&open=${encodeValue("shell")}`;
```

## Examples

Here are practical examples of URLs with their decoded values for clarity:

### Example 1: Basic Connection

```
vscode://ms-azuretools.vscode-documentdb?connectionString=mongodb%253A%252F%252Fusername%253Apassword%2540localhost%253A27017
```

| Parameter          | Decoded Value                                 |
| ------------------ | --------------------------------------------- |
| `connectionString` | `mongodb://username:password@localhost:27017` |

### Example 2: Connection with Database Navigation

```
vscode://ms-azuretools.vscode-documentdb?connectionString=mongodb%253A%252F%252Fmyuser%253Amypass%2540localhost%253A27017&database=analytics
```

| Parameter          | Decoded Value                             |
| ------------------ | ----------------------------------------- |
| `connectionString` | `mongodb://myuser:mypass@localhost:27017` |
| `database`         | `analytics`                               |

This URL will connect to the database and automatically navigate to the `analytics` database.

### Example 3: Direct Collection Access

```
vscode://ms-azuretools.vscode-documentdb?connectionString=mongodb%253A%252F%252Fadmin%253Asecret%2540localhost%253A27017%252Fecommerce&database=ecommerce&collection=orders
```

| Parameter          | Decoded Value                                      |
| ------------------ | -------------------------------------------------- |
| `connectionString` | `mongodb://admin:secret@localhost:27017/ecommerce` |
| `database`         | `ecommerce`                                        |
| `collection`       | `orders`                                           |

This URL will connect to the database, navigate to the `ecommerce` database, and open the Collection View for the `orders` collection.

### Example 4: Open the DocumentDB Local Setup Wizard

Use this to take someone from a web page to a running local DocumentDB without asking them to find
anything in the UI. It carries no parameters, because there is no connection yet — that is what the
wizard is for.

```
vscode://ms-azuretools.vscode-documentdb/local
```

The explicit resource-type form is equivalent:

```
vscode://ms-azuretools.vscode-documentdb/local/documentdb
```

When URL handling confirmations are enabled in the extension settings, either form shows one
confirmation before opening the setup wizard.

### Example 5: Open an Azure DocumentDB cluster by resource ID

The resource ID is encoded once in the URL:

```
vscode://ms-azuretools.vscode-documentdb/connect/azure?resourceId=%2Fsubscriptions%2F00000000-0000-0000-0000-000000000000%2FresourceGroups%2Fmy-group%2Fproviders%2FMicrosoft.DocumentDB%2FmongoClusters%2Fmy-cluster
```

| Parameter    | Decoded Value                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `resourceId` | `/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/my-group/providers/Microsoft.DocumentDB/mongoClusters/my-cluster` |

### Example 6: Open an Azure Cosmos DB for MongoDB (RU) account

```
vscode://ms-azuretools.vscode-documentdb/connect/azure?resourceId=%2Fsubscriptions%2F00000000-0000-0000-0000-000000000000%2FresourceGroups%2Fmy-group%2Fproviders%2FMicrosoft.DocumentDB%2FdatabaseAccounts%2Fmy-account&tenantId=11111111-1111-1111-1111-111111111111
```

| Parameter    | Decoded Value                                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `resourceId` | `/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/my-group/providers/Microsoft.DocumentDB/databaseAccounts/my-account` |
| `tenantId`   | `11111111-1111-1111-1111-111111111111`                                                                                                   |

### Example 7: Open the shell for an Azure DocumentDB database

```
vscode://ms-azuretools.vscode-documentdb/connect/azure?resourceId=%2Fsubscriptions%2F00000000-0000-0000-0000-000000000000%2FresourceGroups%2Fmy-group%2Fproviders%2FMicrosoft.DocumentDB%2FmongoClusters%2Fmy-cluster&database=analytics&open=shell
```

| Parameter    | Decoded Value                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `resourceId` | `/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/my-group/providers/Microsoft.DocumentDB/mongoClusters/my-cluster` |
| `database`   | `analytics`                                                                                                                           |
| `open`       | `shell`                                                                                                                               |

### Example 8: Open the Cluster Dashboard for a connection

```
vscode://ms-azuretools.vscode-documentdb/connect?connectionString=mongodb%253A%252F%252Fusername%253Apassword%2540localhost%253A27017&open=dashboard
```

| Parameter          | Decoded Value           |
| ------------------ | ----------------------- |
| `connectionString` | `******localhost:27017` |
| `open`             | `dashboard`             |

### Example 9: Database and collection names with special characters

```
vscode://ms-azuretools.vscode-documentdb/connect?connectionString=mongodb%253A%252F%252Flocalhost%253A27017&database=sales%2520%2526%2520marketing&collection=orders%252B2024
```

| Parameter          | Decoded Value               |
| ------------------ | --------------------------- |
| `connectionString` | `mongodb://localhost:27017` |
| `database`         | `sales & marketing`         |
| `collection`       | `orders+2024`               |

## How It Works

When you click a URL for the extension, the following process occurs:

1. **Activation**: The `vscode://` prefix tells the operating system to activate VS Code. The `ms-azuretools.vscode-documentdb` segment activates the **DocumentDB** extension.

2. **Action routing**: The extension reads the action from the path. An unrecognized action is refused rather than guessed at, so a mistyped link never acts on parameters you did not intend for it.

3. **Connection Handling** (for `connect`):
   - The extension parses the `connectionString` parameter and creates a new connection in the Connections View.
   - If a connection with the same host and username already exists, the existing connection will be selected instead of creating a duplicate, including when it is inside a folder.
   - For a new connection, one confirmation shows its target (user, hosts, database, and collection) and what will open, and asks you to add and open it. This confirmation is always shown, even when URL handling confirmations are disabled in the extension settings, because the link adds a connection.
   - For a connection you have already saved, one confirmation shows the same details before opening it. Disabling URL handling confirmations skips it.
   - There is no separate question before the Collection View, Cluster Dashboard, or shell opens: the confirmation already names it.
   - TLS options that turn off certificate validation (such as `tlsAllowInvalidCertificates`) are removed from the connection string. A link can ask to turn off certificate validation only for a target on your own machine (`localhost`, `127.0.0.1`, or `::1`), and the extension always asks you first. For any other target, certificate validation stays on; you can change it later in the connection settings.

4. **Azure resources** (for `connect/azure`):
   1. When URL handling confirmations are enabled, a confirmation appears right away. It shows what the link names: the resource, its resource group, the subscription ID, the database, the collection, and what will open. Nothing has been looked up or changed yet.
   2. If you are not signed in to Azure, the extension asks you to sign in.
   3. It looks for the subscription among all your signed-in accounts. If none has it and the link includes `tenantId`, it offers to sign in to that tenant. Otherwise, it shows an error with a **Manage Azure accounts** action.
   4. It reads the resource from Azure using your identity. A missing resource, a resource you cannot read, or a Cosmos DB account that does not use the MongoDB API is reported before anything changes.
   5. If the resource is hidden, the extension permanently changes the filters as it would if you changed them by hand: it shows the hidden Azure discovery provider in the Discovery view, stops hiding the tenant in the tenant filter, and adds the subscription to the Azure subscription filter when you have a selection. The subscription filter is the `azureResourceGroups.selectedSubscriptions` setting shared with the Azure Resources extension, so the subscription also appears in the Azure Resources view. When confirmations are enabled, a second confirmation lists these changes before they are made; it appears only when a filter has to change. When confirmations are disabled, the same changes are applied without a dialog. The changes stay even if the connection later fails or you cancel; to undo them, use **Filter Entries…** or **Hide Provider** on the provider in the Discovery view.
   6. The extension reveals the cluster in the **Discovery** view and connects as when you expand it, using Microsoft Entra ID or prompting for credentials. Nothing is saved to the Connections View.
   7. It navigates to the database or collection and opens the Collection View, Cluster Dashboard, or shell as requested.

   A link carries no cloud hint, so this works only when you are signed in to the Azure cloud that owns the resource.

5. **Navigation** (if additional parameters are provided):
   - If the `database` parameter is provided, the extension navigates to that database.
   - If both `database` and `collection` parameters are provided, the extension opens the Collection View for the specified collection.
   - If `open=dashboard` is provided, the extension opens the Cluster Dashboard; if `open=shell` is provided, it opens the interactive shell. Either can be scoped to the `database` parameter.
   - Without `open=dashboard`, the Cluster Dashboard can still open on its own when a cluster connects for the first time, if opening the dashboard automatically on connect is turned on.
   - If the connection fails, the connection error explains why and the link stops there. If the database or collection cannot be found, the error names it.
   - Opening a link again retries a connection that failed earlier; you do not need to click **Retry** in the tree first.

## Additional Notes

- Ensure every parameter value is properly double-encoded to avoid parsing errors.
- The extension will handle authentication and connection establishment automatically.
- If a `mongodb+srv://` connection fails with `querySrv EBADRESP` or `querySrv ECONNREFUSED`, see [Troubleshoot SRV DNS Lookups](./troubleshooting-srv-dns).
- Invalid or malformed URLs will display appropriate error messages to help with troubleshooting.
- A link is untrusted input: the set of actions it can reach is fixed by the extension, not derived from its command list. Adding a new action is a deliberate decision that the action is safe to trigger from someone else's web page.
