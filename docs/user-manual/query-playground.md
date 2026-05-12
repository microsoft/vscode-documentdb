> **User Manual** &mdash; [Back to User Manual](../index#user-manual)

---

# Query Playground

The **Query Playground** is a file-based scripting environment for DocumentDB and MongoDB API databases, built directly into VS Code. It lets you write JavaScript queries, run them with a single click, and see formatted results in a side panel.

Each playground file uses the `.documentdb.js` extension and behaves like a regular JavaScript file with extra powers: connection awareness, inline execution, and autocompletion for your database schema.

**Table of Contents**

- [Getting Started](#getting-started)
- [Writing Queries](#writing-queries)
- [Running Code](#running-code)
- [Results Panel](#results-panel)
- [Console Output](#console-output)
- [Autocompletion](#autocompletion)
- [Connections and Multiple Files](#connections-and-multiple-files)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Navigating to Other Features](#navigating-to-other-features)
- [Settings](#settings)
- [Tips and Best Practices](#tips-and-best-practices)

## Getting Started

There are several ways to open a new Query Playground:

1. **From the tree view**: Right-click a database or collection node in the Connections, Discovery, or Azure views, then select **New Query Playground**. The playground will be pre-connected to that cluster and database.
2. **From the inline button**: Click the keyboard icon (middle icon) next to a database or collection node in the tree view.
3. **From the Collection View**: Use the **Open in Playground** toolbar button to export your current find query into a new playground file.
4. **From the Command Palette**: Run `DocumentDB: New Query Playground`.

<p align="center"><img src="images/inline-action-buttons.png" alt="Inline action buttons on a collection node: Open Collection View, New Query Playground, Open Interactive Shell" width="300" style="max-width:100%;height:auto;"></p>

The three inline icons next to each collection node are (from left to right): Open Collection View, **New Query Playground**, and Open Interactive Shell.

When a playground opens, a CodeLens header at the top displays the connection status, showing which cluster and database the file is connected to.

## Writing Queries

Playground files use standard JavaScript syntax. You have access to the `db` object, which represents the connected database:

```javascript
// Find all active users older than 25
db.users.find({ status: 'active', age: { $gt: 25 } });

// Aggregate orders by status
db.orders.aggregate([{ $group: { _id: '$status', total: { $sum: '$amount' } } }, { $sort: { total: -1 } }]);
```

### Script Blocks

A playground file is divided into **blocks** separated by blank lines. Each block can be run independently:

```javascript
// Block 1: Find recent orders
db.orders.find({ createdAt: { $gt: new Date('2025-01-01') } });

// Block 2: Count by category
db.products.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }]);
```

You can also use variables, loops, and any JavaScript construct. Variables persist within a single execution (Run All), but not between separate block runs.

### Supported Syntax

Because the playground uses a full JavaScript runtime, you can write queries the way you naturally would:

- **Unquoted keys**: `{ name: "Alice" }` instead of `{ "name": "Alice" }`
- **Single-quoted strings**: `{ status: 'active' }`
- **BSON constructors**: `ObjectId("...")`, `ISODate("...")`, `NumberDecimal("...")`
- **JavaScript expressions**: `Date.now()`, `Math.random()`, `new Date()`
- **Multi-line scripts**: Declare variables, use loops, and build complex logic

## Running Code

The playground provides two execution modes, each triggered through CodeLens buttons that appear above your code:

<p align="center"><img src="images/query-playground-codelens.png" alt="Query Playground showing Run All at the top, and Run, Collection View, Shell CodeLens links on each block" width="750" style="max-width:100%;height:auto;"></p>

| Mode          | Trigger                                                                          | Behavior                                  |
| ------------- | -------------------------------------------------------------------------------- | ----------------------------------------- |
| **Run Block** | Click the **Run** button above a specific block, or press `Ctrl+Enter`           | Executes the block at the cursor position |
| **Run All**   | Click the **Run All** button at the top of the file, or press `Ctrl+Shift+Enter` | Executes the entire file, top to bottom   |

Each block also shows **Collection View** and **Shell** CodeLens links. These open the same query in the Collection View or the Interactive Shell, so you can switch tools without copy-pasting. Some scripts (e.g., loops, aggregations, or multi-statement blocks) may not be convertible to the Collection View.

When you press `Ctrl+Enter` and the cursor is on a blank line between blocks, the playground runs the nearest preceding block.

Each execution reuses the connection you established when you connected to the cluster. There is no need to authenticate again or provide credentials separately.

### Execution Isolation

Each playground file runs in its own isolated worker thread. This means:

- A long-running or infinite query in one playground does not freeze VS Code or affect other playgrounds.
- If a query takes too long, the worker is terminated and a fresh one is created for the next run.

## Results Panel

When you run code, results appear in a read-only tab next to your playground file. The results panel includes:

- **Header**: Shows the cluster name, database, timestamp, and a copy of the code that was executed.
- **Formatted output**: Query results are displayed as formatted JSON with syntax highlighting.
- **Document count**: The number of returned documents is shown in the header.
- **Error display**: If your code produces an error, it appears in the same results tab with a descriptive message.

The results tab is stable: re-running code replaces the content in the same tab rather than opening new ones.

## Console Output

The playground supports `console.log()`, `print()`, and `printjson()` for debugging and inspection:

```javascript
const users = db.users.find({ status: 'active' }).toArray();
console.log('Found', users.length, 'active users');

// print() and printjson() also work
print('Processing...');
printjson(users[0]);
```

Console output appears in a dedicated **DocumentDB Query Playground Output** channel in VS Code's Output panel. When console output is produced, a hint is added to the results tab pointing you to the Output panel.

## Autocompletion

The playground provides rich autocompletion as you type:

### Database and Collection Methods

Type `db.` to see a list of your database's collections. After selecting a collection (e.g., `db.users.`), you will see all available collection methods: `find()`, `findOne()`, `aggregate()`, `insertOne()`, `updateMany()`, `deleteOne()`, and more.

### Schema-Aware Field Suggestions

Inside query objects, field names are suggested based on your collection's actual data. The extension samples documents from the collection to learn its schema, then offers field names with their inferred BSON types (e.g., `String`, `Int32`, `Double`, `Date`, `ObjectId`, `Array`, `Object`) and an indicator if the field is sparse (not present in all documents):

```javascript
db.users.find({
  // Autocompletion suggests: name (String), age (Int32), email (String), createdAt (Date), ...
});
```

Hovering over a field name in your query shows a tooltip with the field's inferred type. If a field holds multiple types across documents, all observed types are listed.

### Operators and BSON Constructors

All DocumentDB API query operators (`$gt`, `$lt`, `$in`, `$regex`, etc.), aggregation stages (`$match`, `$group`, `$sort`, etc.), and BSON constructors (`ObjectId()`, `ISODate()`, etc.) are available with hover documentation.

### Discovering Fields

When no schema data is available for a collection (e.g., when you open a playground for a collection you haven't browsed yet), the autocompletion list shows a special **"Discover fields in collection..."** entry. Selecting it samples approximately 100 documents from the collection to learn its field names and types. Once complete, field suggestions appear immediately.

You can also trigger this manually at any time through the Command Palette: run **DocumentDB: Query Playground: Scan Collection Schema** to refresh the schema data for the current collection.

## Connections and Multiple Files

Each playground file is permanently bound to the cluster and database it was created for. This means:

- **Multiple playgrounds, multiple connections**: You can have several `.documentdb.js` files open at the same time, each connected to a different server or database.
- **Status bar indicator**: The VS Code status bar shows the active playground's connection details when the file is focused.
- **CodeLens header**: The first line of each file displays a CodeLens showing the connection status. Click it to see connection details.
- **No "switch connection" workflow**: To query a different database, create a new playground from that database's tree node.

## Keyboard Shortcuts

| Shortcut           | Action                |
| ------------------ | --------------------- |
| `Ctrl+Enter`       | Run the current block |
| `Ctrl+Shift+Enter` | Run the entire file   |

## Navigating to Other Features

The playground is connected to the other query surfaces in the extension:

- **Open in Collection View**: A CodeLens link lets you open the collection referenced in your script directly in the Collection View, where you can browse results visually.
- **Open in Interactive Shell**: A CodeLens link lets you launch an Interactive Shell session for the same connection, pre-filled with your code.
- **From the Collection View**: The Collection View toolbar has an **Open in Playground** button that exports your current find query (filter, project, sort) into a new playground file.

For more details on the Interactive Shell, see the [Interactive Shell](./interactive-shell) documentation.

## Settings

The following settings control playground behavior:

| Setting                               | Default | Description                                                                                       |
| ------------------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| `documentDB.playground.confirmRunAll` | `true`  | Show a confirmation dialog before running the entire playground file with Run All                 |
| `documentDB.batchSize`                | `50`    | Number of documents to display per cursor iteration in the Query Playground and Interactive Shell |

## Tips and Best Practices

- **Use blocks for organization**: Separate distinct queries with blank lines so you can run them independently.
- **Use `console.log()` for debugging**: Print intermediate values to the Output panel while building complex aggregation pipelines.
- **Use variables in Run All**: When using "Run All," variables defined in earlier blocks are available in later blocks. This is useful for multi-step data processing.
- **Create playgrounds from the tree**: Right-clicking a collection automatically connects the playground and sets the right database context.
- **Copy from Collection View**: Use the **Copy** button in the Collection View to grab a find expression, then paste it into a playground for further refinement.

---

> **Related**: [Interactive Shell](./interactive-shell) | [How It Works Behind the Scenes](./query-runtime)
