> **User Manual** &mdash; [Back to User Manual](../index#user-manual)

---

# Interactive Shell

The **Interactive Shell** is a REPL (Read-Eval-Print Loop) terminal embedded in VS Code. It gives you a command-line experience for DocumentDB and MongoDB API databases, fully integrated with the extension's connection management. Type a command, see the result, type the next one.

Unlike the [Query Playground](./query-playground), which is file-based and suited for multi-statement scripts, the Interactive Shell is designed for quick, ad-hoc exploration: checking what databases exist, browsing collections, running one-off queries, and iterating on results.

**Table of Contents**

- [Getting Started](#getting-started)
- [Shell Commands](#shell-commands)
- [Running Queries](#running-queries)
- [Persistent Variables](#persistent-variables)
- [Autocompletion and Ghost Text](#autocompletion-and-ghost-text)
- [Syntax Highlighting](#syntax-highlighting)
- [Cursor Iteration](#cursor-iteration)
- [Cancelling Operations](#cancelling-operations)
- [Multi-line Input](#multi-line-input)
- [Clickable Links in Results](#clickable-links-in-results)
- [Navigating to Other Features](#navigating-to-other-features)
- [Settings](#settings)
- [Tips and Best Practices](#tips-and-best-practices)

## Getting Started

There are several ways to open an Interactive Shell session:

1. **From the tree view**: Right-click a cluster, database, or collection node in the Connections, Discovery, or Azure views, then select **Open Interactive Shell**.
2. **From the inline button**: Click the terminal icon (rightmost icon) next to a database or collection node in the tree view.
3. **From the Collection View**: Use the **Open in Shell** toolbar button to export your current find query into a new shell session.
4. **From the Query Playground**: Use a CodeLens link to launch a shell for the same connection.

<p align="center"><img src="images/inline-action-buttons.png" alt="Inline action buttons on a collection node: Open Collection View, New Query Playground, Open Interactive Shell" width="300" style="max-width:100%;height:auto;"></p>

The three inline icons next to each collection node are (from left to right): Open Collection View, New Query Playground, and **Open Interactive Shell**.

When the shell opens, it displays a connection banner with the host, authentication method, and username. The prompt shows your current database name:

```
Connected to: mycluster.example.com
Auth: SCRAM-SHA-256 (user: admin)

myDatabase>
```

## Shell Commands

The following built-in commands are available at the prompt:

| Command            | Description                                                      |
| ------------------ | ---------------------------------------------------------------- |
| `show dbs`         | List all databases on the server                                 |
| `show collections` | List all collections in the current database                     |
| `use <database>`   | Switch to a different database (updates the prompt and tab name) |
| `it`               | Iterate to the next batch of results from the last cursor        |
| `help`             | Show available commands and usage information                    |
| `exit` / `quit`    | Close the shell session                                          |
| `cls` / `clear`    | Clear the terminal screen                                        |

## Running Queries

Type any DocumentDB API query at the prompt and press Enter:

```
myDatabase> db.users.find({ status: "active" })
```

You can use the full query language, including:

- **Find queries**: `db.collection.find()`, `db.collection.findOne()`
- **Aggregation pipelines**: `db.collection.aggregate([...])`
- **Write operations**: `db.collection.insertOne()`, `db.collection.updateMany()`, `db.collection.deleteOne()`
- **BSON constructors**: `ObjectId("...")`, `ISODate("...")`, `NumberDecimal("...")`
- **JavaScript expressions**: `Date.now()`, `Math.random()`, variables, loops
- **Index operations**: `db.collection.createIndex()`, `db.collection.getIndexes()`

Results are displayed as formatted JSON directly in the terminal, with optional ANSI color coding for readability.

## Persistent Variables

Unlike the Query Playground (where each block runs in a fresh context by default), the Interactive Shell maintains state across commands within a session:

```
myDatabase> const threshold = 25
myDatabase> db.users.find({ age: { $gt: threshold } })
```

Variables, functions, and other JavaScript state persist until you close the shell session. This makes it easy to build up complex queries incrementally.

## Autocompletion and Ghost Text

The shell provides two forms of input assistance:

<p align="center"><img src="images/interactive-shell-completions.png" alt="Interactive Shell showing tab completion for collection methods and ghost text suggesting a field name" width="700" style="max-width:100%;height:auto;"></p>

In this example, the shell suggests `find()`, `findOne()`, and other methods after typing `db.restaurants.find` (top). It also suggests the field name `reviews` as ghost text after the user typed `re` in a query (bottom). Field suggestions come from schema information gathered locally as you browse and query your data.

### Tab Completion

Press **Tab** to trigger completion suggestions based on your current input:

| Context                | What Tab Suggests                                               |
| ---------------------- | --------------------------------------------------------------- |
| Empty prompt           | Shell commands: `show`, `use`, `db`, `help`, `exit`, `it`, ...  |
| After `show`           | `dbs`, `collections`                                            |
| After `use `           | Available database names                                        |
| After `db.`            | Collection names in the current database                        |
| After `db.collection.` | Collection methods: `find()`, `aggregate()`, `insertOne()`, ... |

When there are multiple matches, the shell inserts the common prefix and displays all options in a multi-column list (similar to bash/zsh). Press Tab again to cycle through them.

### Ghost Text (Inline Suggestions)

As you type, the shell may display a dim, inline suggestion showing what it thinks you're about to type. For example:

- Type `db.users.` and see `find()` appear as ghost text
- Type `show ` and see `dbs` appear

The shell also suggests **closing brackets** automatically. When your input has unclosed brackets, parentheses, or braces, the ghost text shows the exact sequence needed to close them. For example:

- Type `db.col.find({ _id: { $exists: true ` and see `}})` as ghost text
- Type `db.col.aggregate([ { $match: { status: "active" ` and see `} } ])` as ghost text

Press **Right Arrow** or **Tab** to accept the suggestion, or keep typing to ignore it.

## Syntax Highlighting

The shell colorizes your input in real time as you type:

| Color   | Applied To                                        |
| ------- | ------------------------------------------------- |
| Cyan    | JavaScript keywords, BSON constructors            |
| Green   | Strings                                           |
| Yellow  | Numbers, `$`-prefixed operators, escape sequences |
| Magenta | Shell commands (`show`, `use`, `it`, etc.)        |
| Gray    | Comments                                          |
| Red     | Regex literals, unterminated strings              |

Syntax highlighting can be disabled via the `documentDB.shell.display.colorSupport` setting for accessibility (screen readers) or piped output.

## Cursor Iteration

When a query returns more documents than the batch size (default: 50), the shell displays the first batch and shows a hint:

```
myDatabase> db.users.find({})
[
  { "_id": ObjectId("..."), "name": "Alice", ... },
  ...
]
Type "it" for more
```

Type `it` and press Enter to fetch the next batch. You can keep typing `it` until all results are exhausted.

The batch size is controlled by the `documentDB.batchSize` setting.

## Cancelling Operations

If a query is taking too long, press **Ctrl+C** to cancel it immediately. The shell terminates the running operation and creates a fresh execution context, so you can continue working without restarting the session.

## Multi-line Input

The shell detects incomplete expressions automatically. If you type an opening brace or bracket without closing it, the shell waits for more input instead of trying to execute:

```
myDatabase> db.orders.aggregate([
...   { $group: { _id: "$status", count: { $sum: 1 } } },
...   { $sort: { count: -1 } }
... ])
```

When pasting multi-line text, the shell can handle it in several ways, controlled by the `documentDB.shell.multiLinePasteBehavior` setting:

| Option          | Behavior                                                                |
| --------------- | ----------------------------------------------------------------------- |
| `ask` (default) | Prompts you to choose how to process the pasted text                    |
| `alwaysAsk`     | Always shows the prompt, even if VS Code's own paste warning is enabled |
| `executeAsOne`  | Joins pasted lines into a single expression and executes                |
| `runLineByLine` | Runs each pasted line independently                                     |

## Clickable Links in Results

After query results that reference a known collection, the shell shows two clickable action links on the same line:

```
↗ Collection View [myDatabase.users]  ↗ Query Playground [myDatabase.users]
```

- Click **Collection View** to open the collection in the Collection View, where you can browse results visually with table, tree, and JSON layouts.
- Click **Query Playground** to open a new playground file pre-connected to the same database and collection.

## Navigating to Other Features

The Interactive Shell is connected to the other query surfaces in the extension:

- **To Collection View**: Click the `↗ Collection View` link that appears after query results.
- **To Query Playground**: Click the `↗ Query Playground` link that appears after query results to open a playground for the same collection.
- **From the Collection View**: The Collection View toolbar has an **Open in Shell** button that pre-feeds your current find query into a new shell session.
- **From the Query Playground**: CodeLens links let you launch a shell from within your script.

For more details on the Query Playground, see the [Query Playground](./query-playground) documentation.

## Settings

The following settings control shell behavior:

| Setting                                   | Default | Description                                                                                                        |
| ----------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| `documentDB.shell.initTimeout`            | `60`    | Maximum time (in seconds) to wait for the shell to connect during initialization                                   |
| `documentDB.shell.display.colorSupport`   | `true`  | Enable ANSI color support for syntax highlighting and formatted output. Disable for screen readers or piped output |
| `documentDB.shell.display.autocompletion` | `true`  | Enable autocompletion in the Interactive Shell                                                                     |
| `documentDB.shell.multiLinePasteBehavior` | `ask`   | Controls how multi-line text is handled when pasted into the shell                                                 |
| `documentDB.batchSize`                    | `50`    | Number of documents to display per cursor iteration (shared with Query Playground)                                 |

## Tips and Best Practices

- **Use the shell for exploration, the playground for scripts**: The shell is great for quick checks (`show dbs`, `db.collection.count()`), while the playground is better for multi-step operations you want to save and re-run.
- **Use `show collections` before querying**: Quickly see what's available in the current database.
- **Use variables for iteration**: Store intermediate results in variables and refine your queries step by step.
- **Switch databases with `use`**: No need to open a new shell. Just type `use otherDatabase` and the prompt updates.
- **Copy queries to the playground**: If an ad-hoc query grows complex, use the navigation links to move it to a playground file where you can save and refine it.
- **Disable colors for accessibility**: If you use a screen reader, set `documentDB.shell.display.colorSupport` to `false` for clean, unformatted output.

---

> **Related**: [Query Playground](./query-playground) | [How It Works Behind the Scenes](./query-runtime)
