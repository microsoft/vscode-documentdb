# Step 10 — Cross-Feature Navigation Links

**Status:** Implementation complete — experimental, ready for UX review

## Implementation Progress

| Work Item | Description                                          | Commit     | Status  |
| --------- | ---------------------------------------------------- | ---------- | ------- |
| WI1       | `newPlaygroundWithContent` command                   | `6f788c5a` | ✅ Done |
| WI2       | Shell `initialInput` pre-feed                        | `6d5d1bb1` | ✅ Done |
| WI3       | Collection View toolbar buttons (Playground + Shell) | `16d20244` | ✅ Done |
| WI4       | Shell → Playground terminal link                     | `608c4d95` | ✅ Done |
| WI5       | Playground CodeLens navigation (CV + Shell)          | `e4667bb7` | ✅ Done |
| WI6       | Collection View Copy/Paste query buttons             | `dece660f` | ✅ Done |

### Deviations from Plan

1. **Cluster display name**: The router context doesn't carry `clusterDisplayName` (only `clusterId`). The playground header comment shows `clusterId` instead of a human-readable name. Acceptable for experimental phase.

2. **Copy/Paste buttons**: Added as the user requested (not in original plan). Copy exports the find expression to clipboard. Paste uses `parseFindExpression` (bracket-matching parser) to extract filter/project/sort from clipboard text and inject into the query editors via a `pendingPaste` context mechanism.

3. **Shell → Playground**: Phase 1 carries only the namespace (creates `db.getCollection('coll').find({})`) rather than the raw input expression. This matches the plan's pragmatic approach.

4. **Playground → Collection View**: Uses `extractCollectionName` regex to get the collection name, opens CV with default empty query. Phase 2 would add find() argument parsing.

## Summary

Add navigation links between the three query surfaces — **Collection View**, **Interactive Shell**, and **Query Playground** — so users can seamlessly move their work between features without manual copy-paste.

Today the shell already has a `🔗 [db.collection]` action line that opens Collection View. This plan extends that pattern to cover all six directional links between the three features.

## Motivation

Each query surface has strengths:

- **Collection View**: Visual results, pagination, tree/table/JSON views, CRUD operations
- **Interactive Shell**: Rapid iteration, shell commands, history, arbitrary JavaScript
- **Query Playground**: Multi-statement scripts, code lens, persistent files, named connections

Users frequently want to "see this query over there." Today the only cross-link is Shell → Collection View. Adding bidirectional links reduces friction and makes the three surfaces feel like one integrated tool.

## Feature Map

| From              | To                | Query Carries                                            | Feasibility |
| ----------------- | ----------------- | -------------------------------------------------------- | ----------- |
| Collection View   | Playground        | `db.getCollection('c').find(filter, project).sort(sort)` | ✅ Done     |
| Collection View   | Interactive Shell | Same string, pre-fed to shell input                      | ✅ Done     |
| Interactive Shell | Collection View   | Already exists (namespace only)                          | ✅ Done     |
| Interactive Shell | Playground        | Namespace → default find()                               | ✅ Done     |
| Playground        | Collection View   | Extract collection name → open CV                        | ✅ Done     |
| Playground        | Interactive Shell | Code block as initialInput                               | ✅ Done     |
| Collection View   | Clipboard (Copy)  | Full find expression                                     | ✅ Done     |
| Clipboard (Paste) | Collection View   | Parse find expression → filter/project/sort              | ✅ Done     |

---

## 1. Collection View → Playground / Shell

### 1.1 UI Placement Options

We add navigation buttons to the Collection View's main toolbar area. Three placement options to evaluate simultaneously:

#### Option A: Toolbar buttons (right side of ToolbarMainView)

```
┌──────────────────────────────────────────────────────────────────────┐
│ [▶ Find Query] [✨ Generate] [↻ Refresh]     [⇗ Playground] [⇗ Shell] │
│                                                                      │
│ Filter:  ┌──────────────────────────────────────┐                    │
│          │ { status: "active" }                  │                    │
│          └──────────────────────────────────────┘                    │
│ Project: ┌──────────────────────────────────────┐                    │
│          │ { name: 1, email: 1 }                │                    │
│          └──────────────────────────────────────┘                    │
│ Sort:    ┌──────────────────────────────────────┐                    │
│          │ { createdAt: -1 }                    │                    │
│          └──────────────────────────────────────┘                    │
│                                                                      │
│ ┌────────────────────────────────────────────────────────────────┐   │
│ │ Results (Table View)                                           │   │
│ └────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

#### Option B: Menu under an "Open In…" dropdown

```
┌──────────────────────────────────────────────────────────────────────┐
│ [▶ Find Query] [✨ Generate] [↻ Refresh]   [Import] [Export] [⋯ Open In…] │
│                                                      ┌─────────────┐│
│                                                      │ Playground   ││
│                                                      │ Shell        ││
│                                                      └─────────────┘│
```

#### Option C: Both — explicit buttons + "Open In…" menu as overflow

```
┌──────────────────────────────────────────────────────────────────────┐
│ [▶ Find Query] [✨ Generate] [↻ Refresh]  [📝 Playground] [>_ Shell]│
│                                                                      │
```

**Recommendation**: Start with **Option C** — two small `ToolbarButton` components with icons, placed after the existing Import/Export group in `ToolbarMainView`. This keeps them discoverable without a menu but doesn't clutter the query-action area.

### 1.2 Query Construction

The Collection View has `filter`, `project`, and `sort` in `activeQuery` state. We build a find expression:

```typescript
function buildFindExpression(collectionName: string, filter: string, project: string, sort: string): string {
  let expr = `db.getCollection('${collectionName}').find(${filter || '{}'})`;

  // Only add project/sort if non-empty and not default
  if (project && project.trim() !== '{}' && project.trim() !== '{  }') {
    // Use .project() for readability (equivalent to find's 2nd arg)
    // Using find(filter, projection) is also valid but less readable
    // with chained .sort()
    expr = `db.getCollection('${collectionName}').find(${filter || '{}'}, ${project})`;
  }

  if (sort && sort.trim() !== '{}' && sort.trim() !== '{  }') {
    expr += `.sort(${sort})`;
  }

  return expr;
}
```

Example output:

```javascript
db.getCollection('orders').find({ status: 'active' }, { name: 1 }).sort({ createdAt: -1 });
```

### 1.3 "Open in Playground" Flow

1. User clicks "Playground" button in Collection View
2. Webview calls a new tRPC mutation: `openQueryInPlayground`
3. The mutation (server-side in `collectionViewRouter.ts`) calls a new command:
   `vscode-documentdb.command.playground.new.withContent`
4. This command is a variant of `newPlayground` that:
   - Accepts `{ clusterId, clusterDisplayName, databaseName, collectionName, content }`
   - Creates an untitled playground document with the provided content instead of the template
   - Binds the connection via `PlaygroundService.setConnection()`

**New command**: `newPlaygroundWithContent` in `src/commands/playground/newPlayground.ts`

```typescript
export async function newPlaygroundWithContent(
  _context: IActionContext,
  params: {
    clusterId: string;
    clusterDisplayName: string;
    databaseName: string;
    content: string;
  },
): Promise<void> {
  const service = PlaygroundService.getInstance();

  const template = [
    `// Query Playground: ${params.clusterDisplayName}`,
    '//',
    `// Use ${modifierKey}+Enter to run the current block`,
    '',
    params.content,
    '',
  ].join('\n');

  // ... same untitled file creation logic as newPlayground ...

  service.setConnection(doc.uri, {
    clusterId: params.clusterId,
    clusterDisplayName: params.clusterDisplayName,
    databaseName: params.databaseName,
  });
}
```

### 1.4 "Open in Shell" Flow

The shell currently has no mechanism to pre-feed a command without executing it. Two approaches:

#### Approach A: Pre-feed via PTY input queue (recommended)

Add an optional `initialInput` parameter to `DocumentDBShellPtyOptions`:

```typescript
export interface DocumentDBShellPtyOptions {
  readonly connectionInfo: ShellConnectionInfo;
  /** Optional command to pre-fill in the input line (not executed). */
  readonly initialInput?: string;
}
```

After the shell initializes and shows the first prompt, inject the text into the input handler as if the user typed it (but don't press Enter):

```typescript
// In DocumentDBShellPty, after first prompt renders:
if (this._options.initialInput) {
  this._inputHandler.insertText(this._options.initialInput);
}
```

This gives the user the query on their command line, ready to edit or press Enter.

#### Approach B: Clipboard + notification

Copy the query to clipboard and show a notification: "Query copied to clipboard. Paste it in the shell."

**Recommendation**: Approach A is more seamless. Falls back to Approach B if A has issues.

### 1.5 tRPC Mutations (Collection View Router)

Add two new mutations to `collectionViewRouter.ts`:

```typescript
openQueryInPlayground: baseProcedure.mutation(async ({ ctx }) => {
    // Read current query from session state
    const query = buildFindExpression(ctx.collectionName, filter, project, sort);
    await vscode.commands.executeCommand(
        'vscode-documentdb.command.playground.new.withContent',
        { clusterId: ctx.clusterId, ..., content: query }
    );
}),

openQueryInShell: baseProcedure.mutation(async ({ ctx }) => {
    const query = buildFindExpression(ctx.collectionName, filter, project, sort);
    await vscode.commands.executeCommand(
        'vscode-documentdb.command.shell.open',
        { clusterId: ctx.clusterId, ..., initialInput: query }
    );
}),
```

**Important**: These mutations need to receive the current query state from the webview. The webview will read `queryEditor.getCurrentQuery()` and pass filter/project/sort as input to the mutation.

---

actually, do add the Copy to Clipboard function, next to the playgorudn and shell action buttons. this would be userful.
why not paste as well, that would extract find parameters (filter, sort, project) from a query if pasted as a db.<>.find...

---

## 2. Interactive Shell → Collection View + Playground

### 2.1 Current State

Today, the action line after query results is:

```
🔗 [mydb.orders]
```

This is a single link that opens Collection View.

### 2.2 Proposed Change

Expand the action line to show **two links** — one for Collection View, one for Playground:

```
🔗 Collection View: [mydb.orders] | Query Playground: [mydb.orders]
```

But wait — the current link detection uses a single regex on the whole line. With two links, we need **two separate terminal links on the same line**, each with a different click target.

#### Terminal Link Provider Design

VS Code's `TerminalLinkProvider` can return **multiple links** for a single line, each with different `startIndex` and `length`. So we match both markers on one line:

New line format:

```
🔗 [mydb.orders] 📝 [mydb.orders]
```

Where:

- `🔗` = Collection View link (existing sentinel, same behavior)
- `📝` = Playground link (new sentinel)

Both share the same `[db.collection]` format but use different emoji prefixes.

#### Alternative format (with localized headers as tooltips only):

```
🔗 [mydb.orders]  📝 [mydb.orders]
```

Tooltips:

- `🔗`: "Open collection "mydb.orders" in Collection View"
- `📝`: "Open query in Query Playground"

The emoji prefixes are visual cues; the actual descriptive text is in the tooltips (localized).

--> use tooltips + the prefixes as used above, the prefixes won't be clickable, tbut this is okay.

### 2.3 Carrying the Query Expression

The current action line only has `[db.collection]` — the Collection View ignores the query (starts fresh). For Playground, we want to carry the **actual query the user typed**.

**Problem**: The action line is a fixed-format string matched by regex. We can't embed arbitrary JavaScript in a terminal line and still reliably match it.

**Solution**: Encode the input expression in a way that's safe for terminal display and regex matching.

The input expression is available in `evaluateInput(input: string)` right where `maybeWriteActionLine` is called. We can:

1. **For Collection View**: Keep current behavior (just namespace, no query). The Collection View will open with default `find({})`.

2. **For Playground**: Encode the original input expression. The playground link doesn't need to appear in the terminal text — we can store it in the PTY and look it up by line number.

Actually, a simpler approach: **pass the input expression through the terminal info provider**. Store the last N action line contexts in the PTY:

```typescript
interface ActionLineContext {
  readonly databaseName: string;
  readonly collectionName: string;
  readonly inputExpression: string; // raw user input
  readonly lineNumber: number; // terminal line where the action was written
}
```

But `provideTerminalLinks` only gets the line text, not a line number. So we need the data encoded in the line itself.

**Pragmatic approach**: For the Playground link, just create `db.getCollection('coll').find({})` from the namespace (same as Collection View). The user typed something more complex? They can edit in the playground. The point is to **switch surfaces quickly**, not to perfectly transfer every query.

This is consistent with the user's note: "maybe we can just ... ignore it and let the user 'think'."

### 2.4 Implementation

#### Updated `maybeWriteActionLine`:

```typescript
private maybeWriteActionLine(result: SerializableExecutionResult): void {
    const ns = result.source?.namespace;
    if (!ns?.db || !ns?.collection) return;
    if (result.type !== 'Cursor' && result.type !== 'Document') return;
    if (result.printableIsUndefined) return;

    const collectionViewLink = `${ACTION_LINE_PREFIX}[${ns.db}.${ns.collection}]`;
    const playgroundLink = `${PLAYGROUND_ACTION_PREFIX}[${ns.db}.${ns.collection}]`;

    const actionText = `${collectionViewLink}  ${playgroundLink}`;
    this.writeLine(this._outputFormatter.formatSystemMessage(actionText));
}
```

#### New sentinel:

```typescript
export const PLAYGROUND_ACTION_PREFIX = '\u{1F4DD} '; // 📝 + space
```

#### Updated regex (match both on one line):

The link provider returns **multiple links** by scanning the line for each pattern independently:

```typescript
provideTerminalLinks(context: TerminalLinkContext): ShellTerminalLink[] {
    const infoProvider = shellTerminalRegistry.get(context.terminal);
    if (!infoProvider) return [];

    const links: ShellTerminalLink[] = [];

    // Collection View link
    const cvMatch = ACTION_LINE_PATTERN.exec(context.line);
    if (cvMatch) {
        links.push({
            linkType: 'collectionView',
            startIndex: cvMatch.index,
            length: cvMatch[0].length,
            tooltip: vscode.l10n.t('Open in Collection View'),
            clusterId: infoProvider().clusterId,
            databaseName: cvMatch[1],
            collectionName: cvMatch[2],
        });
    }

    // Playground link
    const pgMatch = PLAYGROUND_LINE_PATTERN.exec(context.line);
    if (pgMatch) {
        links.push({
            linkType: 'playground',
            startIndex: pgMatch.index,
            length: pgMatch[0].length,
            tooltip: vscode.l10n.t('Open in Query Playground'),
            clusterId: infoProvider().clusterId,
            databaseName: pgMatch[1],
            collectionName: pgMatch[2],
        });
    }

    // ... settings link (unchanged) ...

    return links;
}
```

#### Terminal output appearance:

```
> db.getCollection('orders').find({ status: "active" })
[
  { _id: ObjectId('...'), status: 'active', name: 'Widget A' },
  ...
]
🔗 [mydb.orders]  📝 [mydb.orders]
```

Hover on `🔗 [mydb.orders]` → tooltip: "Open collection "mydb.orders" in Collection View"
Hover on `📝 [mydb.orders]` → tooltip: "Open query in Query Playground"

### 2.5 Extended: Carrying the Input Expression to Playground

If we want to be smarter (Phase 2), we can store the raw input alongside the action line data:

```typescript
// In DocumentDBShellPty — map from namespace key to last input expression
private readonly _lastInputByNamespace = new Map<string, string>();

private async evaluateInput(input: string): Promise<void> {
    const result = await this._sessionManager.evaluate(input, timeoutMs);
    // ...
    if (result.source?.namespace) {
        const key = `${result.source.namespace.db}.${result.source.namespace.collection}`;
        this._lastInputByNamespace.set(key, input);
    }
    this.maybeWriteActionLine(result);
}
```

Then expose it through the `ShellTerminalInfo` / info provider so the link handler can pass the raw expression to the playground command. This is an optional enhancement.

---

## 3. Playground → Collection View / Shell

### 3.1 UI Placement

The Playground uses CodeLens for run buttons. We can add CodeLens actions for navigation:

```
  // Query Playground: my-cluster                           ← header
  //
  // Use Cmd+Enter to run the current block

  db.getCollection('orders').find({ status: "active" })    ← CodeLens line
  ──────────────────────────────────────────────────────
  ▶ Run Block  |  Open in Collection View  |  Open in Shell
```

#### Alternative: Editor title bar actions

VS Code supports `editor/title` contributions in `package.json`:

```
┌─ playground-1.documentdb.js ─────────────────────── [🔗] [>_] [▶] ──┐
│ // Query Playground: my-cluster                                       │
│ db.getCollection('orders').find({ status: "active" })                 │
└───────────────────────────────────────────────────────────────────────┘
```

The `[🔗]` and `[>_]` icons in the editor title bar open Collection View and Shell respectively.

#### Alternative: Context menu

Right-click on a find() expression → "Open in Collection View" / "Open in Shell"

**Recommendation**: CodeLens is the most discoverable and consistent with the existing Playground UX (which already uses CodeLens for Run). Editor title bar icons as a secondary option.

### 3.2 Extracting Query Parameters

For Playground → Collection View, we need to extract filter/project/sort from the JavaScript expression. This is tricky for the general case but straightforward for the common pattern:

```javascript
db.getCollection('orders').find({ status: 'active' }, { name: 1 }).sort({ createdAt: -1 });
```

**Simple approach**: Use a regex to extract the collection name, then open Collection View with default empty query. The user can then enter their filter in the Collection View.

**Better approach**: Parse the find() arguments with a simple heuristic:

1. Find `db.getCollection('name')` or `db.name` → collection name
2. Find `.find(` → extract first argument (filter) and optional second (projection)
3. Find `.sort(` → extract argument

This doesn't need a full JS parser — a bracket-matching approach works for 95% of real queries. But it's fragile. For Phase 1, just use the collection name.

### 3.3 "Open in Shell" from Playground

1. Get the current code block (the selection or the block at cursor)
2. Open an interactive shell connected to the same cluster/database
3. Pre-feed the code block as initial input (same mechanism as 1.4)

### 3.4 Implementation

#### CodeLens additions

In `PlaygroundCodeLensProvider.ts`, add two new CodeLens items next to "Run Block":

```typescript
// After the "Run Block" CodeLens:
lenses.push(
  new vscode.CodeLens(blockRange, {
    title: '$(link-external) Collection View',
    command: 'vscode-documentdb.command.playground.openQueryInCollectionView',
    arguments: [uri, blockRange],
  }),
  new vscode.CodeLens(blockRange, {
    title: '$(terminal) Shell',
    command: 'vscode-documentdb.command.playground.openQueryInShell',
    arguments: [uri, blockRange],
  }),
);
```

#### New commands

```typescript
// playground.openQueryInCollectionView
// 1. Get the playground connection (cluster, database)
// 2. Extract collection name from the code block (regex)
// 3. Execute vscode-documentdb.command.internal.containerView.open

// playground.openQueryInShell
// 1. Get the playground connection (cluster, database)
// 2. Get the code block text
// 3. Open shell with initialInput = code block text
```

---

## 4. Implementation Order

### Phase 1 (MVP — all directions, basic query transfer)

1. **Collection View → Playground**: New `newPlaygroundWithContent` command + tRPC mutation + toolbar button
2. **Collection View → Shell**: `initialInput` support in shell PTY + tRPC mutation + toolbar button
3. **Shell → Playground**: New `📝` sentinel + playground link type in `ShellTerminalLinkProvider`
4. **Playground → Collection View**: CodeLens "Collection View" + command to extract collection name and open
5. **Playground → Shell**: CodeLens "Shell" + command to open shell with code block

### Phase 2 (Enhanced query transfer)

6. Shell → Playground: Carry the raw input expression (not just namespace)
7. Playground → Collection View: Parse find() arguments into filter/project/sort
8. Collection View → Shell: Support `skip`/`limit` in the generated expression

---

## 5. Files to Modify

| File                                                        | Changes                                                   |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| `src/webviews/.../toolbar/ToolbarMainView.tsx`              | Add "Playground" and "Shell" buttons                      |
| `src/webviews/.../collectionViewRouter.ts`                  | Add `openQueryInPlayground` and `openQueryInShell` mutations        |
| `src/commands/playground/newPlayground.ts`                  | Add `newPlaygroundWithContent` function                   |
| `src/documentdb/ClustersExtension.ts`                       | Register new commands                                     |
| `src/documentdb/shell/DocumentDBShellPty.ts`                | Add `initialInput` support, update `maybeWriteActionLine` |
| `src/documentdb/shell/ShellTerminalLinkProvider.ts`         | Add `PLAYGROUND_ACTION_PREFIX`, playground link type      |
| `src/commands/openInteractiveShell/openInteractiveShell.ts` | Pass `initialInput` through                               |
| `src/documentdb/playground/PlaygroundCodeLensProvider.ts`   | Add "Collection View" and "Shell" CodeLens                |
| New: `src/commands/playground/openQueryInCollectionView.ts`      | Extract collection name → open CV                         |
| New: `src/commands/playground/openQueryInShell.ts`               | Get code block → open shell with initial input            |

---

## 6. ASCII Art — Full Navigation Map

```
                    ┌─────────────────────┐
                    │   Collection View   │
                    │                     │
                    │  [▶ Find] [↻]       │
                    │  [📝 Playground]    │──────┐
                    │  [>_ Shell]         │──┐   │
                    │                     │  │   │
                    │  Filter: { ... }    │  │   │
                    │  Results: [table]   │  │   │
                    └──────▲──────────────┘  │   │
                           │                 │   │
                      Open CV                │   │ Open Playground
                      (namespace)            │   │ (full find expression)
                           │                 │   │
    ┌──────────────────────┤                 │   │
    │                      │                 │   │
    │  ┌───────────────────┴──┐              │   │
    │  │  Interactive Shell   │◄─────────────┘   │
    │  │                      │  Open Shell      │
    │  │  > db.orders.find()  │  (initialInput)  │
    │  │  [ { doc }, ... ]    │                   │
    │  │  🔗 [db.orders]      │                   │
    │  │  📝 [db.orders]      │──────┐            │
    │  │                      │      │            │
    │  └──────────────────────┘      │            │
    │                                │            │
    │      Open Playground           │            │
    │      (namespace → find())      │            │
    │                                │            │
    │  ┌─────────────────────────────▼────────────▼──┐
    │  │  Query Playground                           │
    │  │                                             │
    │  │  db.getCollection('orders').find({ ... })   │
    │  │  ─────────────────────────────────────────   │
    │  │  ▶ Run  |  🔗 Collection View  |  >_ Shell │ ← CodeLens
    │  │                                             │
    └──│◄── 🔗 Collection View (extract coll name)   │
       │                                             │
       │──► >_ Shell (code block as initialInput)────┘
       └─────────────────────────────────────────────┘
```

---

## 7. Open Questions

1. **Should the Collection View buttons use the current editor values or the last-executed query?**
   - Current editor: More intuitive ("what I see"), but might not match results
   - Last executed: Matches the displayed results
   - **Recommendation**: Use current editor values via `queryEditor.getCurrentQuery()`

2. **Shell initialInput: should it auto-execute or just pre-fill?**
   - Pre-fill (recommended): User reviews and presses Enter
   - Auto-execute: Faster but user loses control
   - Could be a setting

3. **Playground CodeLens: on every block or only on find() calls?**
   - Every block: Simple, consistent
   - Only find(): More targeted, less clutter, but requires detecting find()
   - **Recommendation**: Every block for Shell, only blocks with a find/aggregate for Collection View

4. **Should the shell carry the raw input expression to the Playground, or just the namespace?**
   - Phase 1: Just namespace (simple, matches existing pattern)
   - Phase 2: Raw input (requires storage + lookup by line context)

5. **PlaygroundCodeLens clutter**: Adding 2 more CodeLens per block may be too much. Consider:
   - A single "Open In…" CodeLens with a quick pick menu
   - Or only showing them on hover / right-click context menu
