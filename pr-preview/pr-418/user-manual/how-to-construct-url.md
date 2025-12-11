> **User Manual** &mdash; [Back to User Manual](../index#user-manual)

---

# How to Construct a URL That Opens a Connection in the Extension

**DocumentDB for VS Code** supports activation through custom URLs, enabling you to integrate the extension seamlessly with your development environment and build deep links directly to your DocumentDB and MongoDB clusters. This powerful feature allows you to create shortcuts that can open specific connections, navigate to particular databases, or even jump directly to a collection view within the extension.

This URL-based activation is particularly useful for:

- **Development Workflow Integration:** Create bookmarks or shortcuts that instantly connect to your frequently used databases
- **Team Collaboration:** Share direct links to specific database resources with your team members
- **Documentation and Tutorials:** Embed clickable links in documentation that open specific database connections
- **External Tool Integration:** Allow other applications to launch DocumentDB for VS Code with pre-configured connections

## URL Syntax

The prefix for URLs handled by this extension is:

```
vscode://ms-azuretools.vscode-documentdb
```

### Supported Parameters

The following table lists all supported URL parameters:

| Parameter          | Required | Description                                                    | Example Value               |
| ------------------ | -------- | -------------------------------------------------------------- | --------------------------- |
| `connectionString` | Yes      | The MongoDB/DocumentDB connection string (double URL-encoded)  | `mongodb%253A%252F%252F...` |
| `database`         | No       | Name of the database to open after connection                  | `myDatabase`                |
| `collection`       | No       | Name of the collection to open (requires `database` parameter) | `myCollection`              |

### Parameter Details

- **`connectionString`**: The core parameter that defines the database connection. Must be a valid DocumentDB or MongoDB connection string that has been double URL-encoded (see encoding section below). Note: While it's possible to include a database name in the connection string, it's recommended to use the separate `database` parameter instead to keep the API simple and consistent.
- **`database`**: When provided, the extension will automatically navigate to the specified database after establishing the connection.
- **`collection`**: When provided along with `database`, the extension will open the Collection View for the specified collection within that database.

## Double Encoding

The `connectionString` parameter must be encoded twice to ensure proper parsing. This is because the connection string itself contains special characters that need to be preserved through the URL parsing process.

### Encoding Process

The encoding happens in two steps:

1. **First encoding**: Standard URL encoding of the connection string
2. **Second encoding**: URL encoding of the already-encoded string

For example, the string `"mongo+srv://"` would be transformed as follows:

1. Original string:
   ```
   mongo+srv://
   ```
2. First encoding:
   ```
   mongo%2Bsrv%3A%2F%2F
   ```
3. Second encoding (final result):
   ```
   mongo%252Bsrv%253A%252F%252F
   ```

This double encoding ensures that the URL is correctly parsed by both the operating system and the extension.

## Examples

Here are practical examples of URLs with their decoded connection strings for clarity:

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

## How It Works

When you click a DocumentDB for VS Code URL, the following process occurs:

1. **Activation**: The `vscode://` prefix tells the operating system to activate VS Code. The `ms-azuretools.vscode-documentdb` segment activates the **DocumentDB for VS Code** extension.

2. **Connection Handling**:
   - The extension parses the `connectionString` parameter and creates a new connection in the Connections View.
   - If a connection with the same host and username already exists, the existing connection will be selected instead of creating a duplicate.

3. **Navigation** (if additional parameters are provided):
   - If the `database` parameter is provided, the extension navigates to that database.
   - If both `database` and `collection` parameters are provided, the extension opens the Collection View for the specified collection.

## Additional Notes

- Ensure the `connectionString` is valid and properly double-encoded to avoid connection errors.
- The extension will handle authentication and connection establishment automatically.
- Invalid or malformed URLs will display appropriate error messages to help with troubleshooting.
