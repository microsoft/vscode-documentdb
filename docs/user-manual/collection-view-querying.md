> **User Manual** &mdash; [Back to User Manual](../index#user-manual)

---

# Collection View: Querying

The **Collection View** is the visual query interface for DocumentDB and MongoDB API databases. It provides three query editors (filter, project, sort) that let you build `find` queries with context-aware autocompletion, hover documentation, and real-time validation.

This page focuses on how to write queries in the Collection View and how the autocompletion works. For general information about browsing and managing documents, see the Collection View overview in the extension.

## Opening the Collection View

There are several ways to open a collection in the Collection View:

1. **Double-click** the **Documents** node under a collection in the tree view.
2. **Click the inline button**: Each collection node in the tree view has an inline action button (the leftmost icon) that opens the Collection View directly.
3. **From the Interactive Shell**: Click the `↗ Collection View` link that appears after query results.
4. **From the Query Playground**: Use the CodeLens link to open the referenced collection.

<p align="center"><img src="images/inline-action-buttons.png" alt="Inline action buttons on a collection node: Open Collection View, New Query Playground, Open Interactive Shell" width="300" style="max-width:100%;height:auto;"></p>

The three inline icons next to each collection node are (from left to right): **Open Collection View**, **New Query Playground**, and **Open Interactive Shell**.

**Table of Contents**

- [The Three Query Editors](#the-three-query-editors)
- [Writing Filter Queries](#writing-filter-queries)
- [Writing Projections](#writing-projections)
- [Writing Sort Expressions](#writing-sort-expressions)
- [Autocompletion](#autocompletion)
  - [Field Name Suggestions](#field-name-suggestions)
  - [Field Types and Type-Aware Suggestions](#field-types-and-type-aware-suggestions)
  - [Context-Sensitive Completions](#context-sensitive-completions)
  - [Project and Sort Value Completions](#project-and-sort-value-completions)
- [Hover Documentation](#hover-documentation)
- [Real-Time Validation](#real-time-validation)
- [Relaxed Query Syntax](#relaxed-query-syntax)
- [Navigating to Other Features](#navigating-to-other-features)

## The Three Query Editors

The Collection View has three input editors that correspond to the three parameters of the DocumentDB API `find()` command:

| Editor      | Purpose                                   | Example                                  |
| ----------- | ----------------------------------------- | ---------------------------------------- |
| **Filter**  | Select which documents to return          | `{ status: "active", age: { $gt: 25 } }` |
| **Project** | Choose which fields to include or exclude | `{ name: 1, email: 1, _id: 0 }`          |
| **Sort**    | Control the order of results              | `{ createdAt: -1 }`                      |

Together, these editors produce a query equivalent to:

```javascript
db.collection.find(filter, project).sort(sort);
```

Each editor provides its own autocompletion behavior tailored to what you're writing: the filter editor suggests operators and value patterns, the project editor suggests `1` (include) and `0` (exclude), and the sort editor suggests `1` (ascending) and `-1` (descending).

## Writing Filter Queries

The filter editor accepts any valid DocumentDB API query expression. You can use all query operators, BSON constructors, and JavaScript expressions:

```javascript
// Simple equality
{ status: "active" }

// Comparison operators
{ age: { $gt: 25, $lte: 65 } }

// Logical operators
{ $or: [{ status: "active" }, { role: "admin" }] }

// Regular expressions
{ email: { $regex: /\.com$/ } }

// BSON constructors
{ _id: ObjectId("507f1f77bcf86cd799439011") }

// Date ranges
{ createdAt: { $gt: ISODate("2025-01-01"), $lt: ISODate("2025-12-31") } }
```

## Writing Projections

The project editor controls which fields appear in the results. Use `1` to include a field and `0` to exclude it:

```javascript
// Include only name and email
{ name: 1, email: 1 }

// Exclude the _id field
{ name: 1, email: 1, _id: 0 }

// Exclude large fields
{ rawData: 0, internalNotes: 0 }
```

> **Note:** You cannot mix inclusion and exclusion in the same projection, except for the `_id` field which can always be explicitly excluded.

## Writing Sort Expressions

The sort editor controls the order of returned documents. Use `1` for ascending and `-1` for descending:

```javascript
// Sort by creation date, newest first
{ createdAt: -1 }

// Sort by multiple fields
{ status: 1, createdAt: -1 }
```

## Autocompletion

The Collection View provides rich, context-aware autocompletion across all three editors. Suggestions appear automatically as you type, or you can trigger them manually with `Ctrl+Space`.

### Field Name Suggestions

As you type in any of the three editors, the extension suggests field names from your collection's actual data. Field names are discovered by analyzing documents you have already browsed or queried.

> **This analysis happens entirely locally:** the extension examines documents that are already being fetched for display, without making additional requests to your database or sending data to external services.

Each field appears with its inferred BSON type displayed next to it:

```
name        String
age         Int32
email       String
createdAt   Date
tags        Array
address     Object
```

If a field is **sparse** (not present in all documents), it is marked with a `(sparse)` indicator.

Fields with special characters in their names (dots, hyphens, spaces) are automatically quoted in the inserted text so the query remains valid.

### Field Types and Type-Aware Suggestions

The extension doesn't just know field names, it also knows their types. This knowledge powers two behaviors:

**Type-aware operator ordering**: When you type a `$` operator after a field, the completion list is sorted by relevance to that field's BSON type. For example:

- After a **number** field (`Int32`, `Double`, `Long`): comparison operators (`$gt`, `$gte`, `$lt`, `$lte`) appear first
- After a **string** field: `$regex` and `$in` are prioritized
- After a **boolean** field: `true`/`false` value suggestions appear at the top

<p align="center"><img src="images/autocompletion-boolean-field.png" alt="Autocompletion for a boolean field showing true/false values first, then comparison operators" width="650" style="max-width:100%;height:auto;"></p>

In this example, the field `additionalInfo.isFamilyFriendly` is a boolean. The editor suggests `true` and `false` first, followed by comparison operators sorted by relevance. The documentation panel at the bottom describes the selected item.

**Type-aware value suggestions**: When the cursor is at a value position and the field's type is known, the editor suggests values appropriate for that type:

| Field Type                              | Suggestions                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------- |
| `Boolean`                               | `true`, `false`                                                             |
| `Int32`, `Double`, `Long`, `Decimal128` | Range query snippets (`{ $gt: ..., $lt: ... }`)                             |
| `String`                                | String literal (`"..."`), regex pattern (`{ $regex: /.../ }`)               |
| `Date`                                  | `ISODate("...")`, date range snippet, relative date (`Date.now() - N days`) |
| `ObjectId`                              | `ObjectId("...")`                                                           |
| `Null`                                  | `null`                                                                      |

These type-aware suggestions appear at the top of the completion list, followed by the general operators and BSON constructors.

### Context-Sensitive Completions

The autocompletion is aware of where your cursor is within the query expression and adjusts what it suggests accordingly:

| Cursor Position                                           | What You See                                                                        |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **At a key position** (e.g., `{ \| }`)                   | Field names and logical operators (`$and`, `$or`, `$nor`, `$not`)                   |
| **At a value position** (e.g., `{ age: \| }`)            | Type-aware suggestions, comparison operators, BSON constructors, JavaScript globals |
| **Inside an operator object** (e.g., `{ age: { \| } }`)  | Comparison and query operators without outer braces                                 |
| **Inside an array** (e.g., `{ $and: [ \| ] }`)           | Same as key position (each array element is a query document)                       |

This means you see the right suggestions at the right time, instead of a flat list of everything.

### Project and Sort Value Completions

The project and sort editors have their own specialized value completions that reflect the specific values expected in each context:

**Project editor** (at a value position after a field name):

| Suggestion | Description   |
| ---------- | ------------- |
| `1`        | Include field |
| `0`        | Exclude field |

**Sort editor** (at a value position after a field name):

| Suggestion | Description |
| ---------- | ----------- |
| `1`        | Ascending   |
| `-1`       | Descending  |

These appear as the only value suggestions in their respective editors, keeping the completion list focused and unambiguous.

## Hover Documentation

Hovering over any element in the query editors provides inline documentation:

### Operators and BSON Constructors

Hover over any `$`-prefixed operator (e.g., `$gt`, `$regex`, `$elemMatch`) or BSON constructor (e.g., `ObjectId`, `ISODate`, `NumberDecimal`) to see:

- **A description** of what it does
- **A link** to the official DocumentDB API documentation page

### Field Names

Hover over a field name to see:

- **The field name** with an indication if it is sparse
- **The inferred BSON type(s)**: if a field holds different types across documents (e.g., some documents have a `String`, others an `Int32`), all observed types are listed

## Real-Time Validation

The editors validate your query as you type:

- **Syntax errors** are highlighted with red squiggles when the expression cannot be parsed (e.g., missing closing braces, invalid JavaScript syntax).
- **Near-miss typo warnings** appear as yellow squiggles when you type something close to a known BSON constructor or JavaScript global. For example, typing `ObjctId()` produces a "Did you mean `ObjectId`?" warning. This uses Levenshtein distance matching, so small typos are caught even if the misspelling is technically valid JavaScript.

Validation runs with a short debounce (300ms) so it doesn't interfere with your typing.

## Relaxed Query Syntax

The Collection View editors accept relaxed JavaScript expression syntax, not just strict JSON. This means you can write queries naturally:

| Syntax                          | Example                             | Supported? |
| ------------------------------- | ----------------------------------- | :--------: |
| Unquoted keys                   | `{ name: "Alice" }`                 |    Yes     |
| Single-quoted strings           | `{ status: 'active' }`              |    Yes     |
| Double-quoted keys (JSON-style) | `{ "name": "Alice" }`               |    Yes     |
| BSON constructors               | `ObjectId("...")`, `ISODate("...")` |    Yes     |
| JavaScript expressions          | `Date.now()`, `Math.min(a, b)`      |    Yes     |
| Regex literals                  | `{ email: /\.com$/ }`               |    Yes     |
| Comments                        | `{ /* filter */ name: "Alice" }`    |    Yes     |

This is a significant improvement over earlier versions of the extension, which required strict JSON and didn't support BSON constructors or unquoted keys.

## Navigating to Other Features

From the Collection View, you can move your query to other surfaces:

- **Open in Playground**: Click the toolbar button to export your current find query (filter, project, sort) into a new `.documentdb.js` playground file.
- **Open in Shell**: Click the toolbar button to pre-feed your current query into a new Interactive Shell session.
- **Copy**: Copy the full find expression to the clipboard for use elsewhere.
- **Paste**: Paste a find expression from the clipboard into the query editors. The extension parses the `find(filter, project).sort(sort)` format and populates each editor.

For more details, see the [Query Playground](./query-playground) and [Interactive Shell](./interactive-shell) documentation.
