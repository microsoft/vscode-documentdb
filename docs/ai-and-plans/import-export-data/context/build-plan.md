# Build Plan

## Core Principle

Full page UI built with mock data first — verified visually before any logic is written. Then functionality is built and wired to the UI step by step. Every feature must be visible and testable before moving to the next. No invisible backend phases.

---

## Phase 1 — Foundation

> Shared scaffolding and planning tasks that must be complete before any feature phase begins.

### Planning

- [ ] 01 — Finalize open design decisions from `summary.md` (preview row limits, CSV dialect config surface, Excel streaming library, error policy combinability, partial-file cleanup strategy)

  Resolve the 5 open questions before writing any code, so all later tasks have stable answers to build on.

  | Decision | Example answer |
  |---|---|
  | Preview row limit | Default 25; user can switch to 10 / 50 |
  | CSV dialect surface | Show delimiter + encoding in "Advanced Options" only |
  | Excel streaming library | Use `exceljs` in streaming mode |
  | Error policy combinability | Policies are mutually exclusive (radio, not checkboxes) |
  | Partial-file cleanup | Always delete the partial file on cancel or error |

- [ ] 02 — Define shared TypeScript interfaces for the database-neutral pipeline: `FieldContract`, `ExportConfig`, `ImportConfig`, `FieldMapping`, `TaskResult`, `ExportRow`, `ImportDocument`, `CompanionSheetSchema`, `ExportSchema`

  Write the type contracts that every later task compiles against. Nothing is implemented yet; just the shapes.

  ```typescript
  interface FieldContract {
    readonly sourcePath: string;       // e.g. "customer.address.city"
    readonly columnHeader: string;     // e.g. "customer_address_city"
    readonly included: boolean;
    readonly required: boolean;        // present in all sampled docs/elements
    readonly systemField?: boolean;    // true for _sourceDocId, _arrayIndex
  }

  interface ArraySummaryColumn {
    readonly sourceArrayPath: string;  // e.g. "items"
    readonly columnHeader: string;     // e.g. "items_count"
  }

  interface CompanionSheetSchema {
    readonly sourceArrayPath: string;
    readonly arrayKind: 'array-of-objects' | 'array-of-scalars' | 'array-empty';
    readonly sheetName: string;        // e.g. "orders_items"
    readonly fields: FieldContract[];  // includes system fields first
  }

  interface ExportSchema {
    readonly mainSheet: {
      readonly fields: FieldContract[];
      readonly arraySummaryColumns: ArraySummaryColumn[];
    };
    readonly companionSheets: CompanionSheetSchema[];
  }

  interface ExportRow {
    readonly values: (string | number | boolean | null)[];
  }

  interface TaskResult {
    readonly rowsExported: number;
    readonly rowsSkipped: number;
    readonly errors: { rowIndex: number; reason: string }[];
  }
  ```

### Scaffolding — Export Webview

- [ ] 03 — Register `documentdb.exportData` command in `package.json` (menu contributions, keybinding placeholder) and `registerCommands.ts`

  Add the command ID to `package.json` so VS Code knows it exists and shows it in menus, then add the handler stub to `registerCommands.ts`.

  ```json
  // package.json (contributes.commands)
  { "command": "documentdb.exportData", "title": "Export Data…", "category": "DocumentDB" }

  // package.json (contributes.menus → view/item/context)
  { "command": "documentdb.exportData", "when": "viewItem == documentdb.collection", "group": "data" }
  ```

- [ ] 04 — Scaffold `src/webviews/exportData/` folder with empty files: `ExportData.tsx`, `exportData.scss`, `exportDataContext.ts`, `exportDataController.ts`, `exportDataRouter.ts`, `components/`, `hooks/`, `types/`, `utils/`

  Create the empty file tree so every later task has a known home for its code.

  ```
  src/webviews/exportData/
  ├── ExportData.tsx           ← root React component
  ├── exportData.scss          ← scoped styles
  ├── exportDataContext.ts     ← React context + provider
  ├── exportDataController.ts  ← VS Code side (opens panel, owns router)
  ├── exportDataRouter.ts      ← tRPC router definition
  ├── components/              ← FieldListPanel, PreviewTable, ProgressPanel …
  ├── hooks/                   ← useExportSchema, useExportTask …
  ├── types/                   ← ExportConfig, ExportState …
  └── utils/                   ← flatPropertyExtractor, columnNameBuilder …
  ```

- [ ] 05 — Register `exportData` webview in `WebviewRegistry.ts`

  Map the webview ID to its controller so the extension can open it by name.

  ```typescript
  // WebviewRegistry.ts
  registry.register('exportData', () => new ExportDataController(context));
  ```

- [ ] 06 — Add `exportDataRouter` to `appRouter.ts`

  Merge the export router into the root tRPC router so the webview's client can call `exportData.*` procedures.

  ```typescript
  // appRouter.ts
  export const appRouter = router({
    exportData: exportDataRouter,  // ← add this line
    importData: importDataRouter,
    // …
  });
  ```

### Scaffolding — Import Webview

- [ ] 07 — Register `documentdb.importData` command in `package.json` and `registerCommands.ts`

  Same as task 03 but for import. Adds the menu entry and stub handler.

  ```json
  { "command": "documentdb.importData", "title": "Import Data…", "category": "DocumentDB" }
  ```

- [ ] 08 — Scaffold `src/webviews/importData/` folder with the same standard layout as exportData

  Mirror of task 04 for import.

  ```
  src/webviews/importData/
  ├── ImportData.tsx
  ├── importData.scss
  ├── importDataContext.ts
  ├── importDataController.ts
  ├── importDataRouter.ts
  ├── components/
  ├── hooks/
  ├── types/
  └── utils/
  ```

- [ ] 09 — Register `importData` webview in `WebviewRegistry.ts`

  ```typescript
  registry.register('importData', () => new ImportDataController(context));
  ```

- [ ] 10 — Add `importDataRouter` to `appRouter.ts`

  ```typescript
  export const appRouter = router({
    exportData: exportDataRouter,
    importData: importDataRouter,  // ← add this line
  });
  ```

### Scaffolding — Shared Pipeline

- [ ] 11 — Create `src/services/importExport/` with database-neutral pipeline type definitions and empty adapter interfaces (`IExportSourceAdapter`, `IImportDestinationAdapter`)

  Define the contracts that both DocumentDB and future Atlas adapters must satisfy, with no implementation yet.

  ```typescript
  // IExportSourceAdapter.ts
  interface IExportSourceAdapter {
    openCursor(config: ExportConfig): AsyncIterable<Document>;
    estimateCount(config: ExportConfig): Promise<number>;
    close(): Promise<void>;
  }

  // IImportDestinationAdapter.ts
  interface IImportDestinationAdapter {
    insertBatch(docs: ImportDocument[]): Promise<InsertBatchResult>;
    close(): Promise<void>;
  }
  ```

- [ ] 12 — Create stub DocumentDB adapter implementations for export (document cursor) and import (document insert) that satisfy the adapter interfaces

  Write classes that satisfy the interfaces but return hard-coded data, so Phase 2/3 logic tasks have something to compile against before the real adapters exist.

  ```typescript
  // StubExportSourceAdapter.ts
  export class StubExportSourceAdapter implements IExportSourceAdapter {
    async *openCursor(): AsyncIterable<Document> {
      yield { _id: 1, name: 'Alice' };
      yield { _id: 2, name: 'Bob' };
    }
    async estimateCount(): Promise<number> { return 2; }
    async close(): Promise<void> {}
  }
  ```

---

## Phase 2 — Export Feature

> UI is built and verified with mock data first. Logic is wired only after the UI step is visually confirmed.
> Edge-case and failure-mode requirements for export behavior are defined in `architecture.md` under **Export Edge Cases and Failure Modes** and apply to all Phase 2 tasks.

### UI — Shell & Entry

- [ ] 01 — Create the export webview shell — shows the source name (collection or database), a feature description, a step indicator, and a Proceed button. All content is mock data at this stage.

  The first visible screen. Shows static mock data so the layout can be reviewed before any real data flows.

  ```
  ┌─────────────────────────────────────────────┐
  │  Export Data                                │
  │  Source: orders (mock)                      │
  │  Step 1 of 3: Configure fields              │
  │                                             │
  │                           [ Proceed → ]    │
  └─────────────────────────────────────────────┘
  ```

- [ ] 02 — Add the format selector — a CSV / Excel toggle. The Export button stays disabled until the user picks a format.

  A CSV / Excel toggle that gates the Export button. The button becomes enabled only once the user makes a selection.

  ```
  Format:  ○ CSV   ● Excel

  [ Export ]   ← disabled until a format is chosen
  ```

- [ ] 03 — Wire the `documentdb.exportData` command to open the Export webview panel and pass the selected source context (collection or database name and path) into the webview.

  The command handler reads the tree selection and injects it into the webview as initial state.

  ```typescript
  // exportData.ts (command handler)
  const node = context.selectedItems[0] as CollectionTreeItem;
  ExportDataController.open({
    sourceType: 'collection',
    databaseName: node.databaseName,    // "shop"
    collectionName: node.collectionName, // "orders"
  });
  ```

### UI — Collection Export

- [ ] 04 — Build the field list panel — shows each discovered column with a checkbox to include or exclude it, a drag handle to reorder it, and an inline field to rename the column header. The panel has two labelled sections: scalar/nested-object fields at the top, and array fields at the bottom.

  Scalar fields are draggable rows with a checkbox and rename input, same as before. Auto-generated `_count` columns appear in the scalar section alongside the array field that produced them — unchecking the array field in the lower section removes its `_count` column automatically. Array fields in the lower section show the source path, companion sheet name, array kind badge, and element count hint.

  ```
  ─── Scalar & nested fields ───────────────────────────
  ☑  [≡] orderId          → orderId
  ☑  [≡] customer.name    → customer_name
  ☑  [≡] total            → total
  ☐  [≡] coupon           → coupon       ← unchecked = excluded
  ☑  [≡] items_count      → items_count  [auto]
  ☑  [≡] tags_count       → tags_count   [auto]

  ─── Array fields (exported as companion sheets) ────────────
  ☑  items   → orders_items    [objects]  avg 2.8 elem/doc
  ☑  tags    → orders_tags     [scalars]  avg 3.1 elem/doc
  ☐  history → orders_history  [empty ⚠]  no content observed
  ```

- [ ] 05 — Build the nested property mode toggle — when enabled, a separator input appears with `.` as the default value. Typing a separator character immediately regenerates all column names in the field list (e.g., `address.city` with `_` becomes `address_city`).

  Toggling "Flatten nested fields" on/off and changing the separator regenerates column names live.

  ```
  [✓] Flatten nested fields   Separator: [_]

  customer.name  →  customer_name    (separator = _)
  customer.name  →  customer.name    (separator = .)  ← dot keeps original path
  customer.name  →  customer#name    (separator = #)
  ```

- [ ] 06 — Build the "add field path" input — lets the user manually type and add a field path that was not found during schema sampling.

  Lets users add a field that schema sampling missed (e.g., a rarely-populated field present in fewer than the sample threshold).

  ```
  + Add field path:  [ metadata.source ]  [ Add ]

  → metadata_source  appears at the bottom of the field list
  ```

- [ ] 07 — Build the inconsistent-document warning banner — shown when some sampled documents are missing certain fields. Optional (inconsistent) properties appear in a collapsible section below the required ones.

  Shown when schema sampling found that some fields only appear in some documents. Required and optional fields are visually separated.

  ```
  ⚠ Some sampled documents are missing fields.

  Required (in all 200 samples)
    ☑ orderId
    ☑ total

  ▶ Optional (in some samples)
    ☑ coupon        ← present in 2 of 200 sampled docs
    ☑ customer.city ← present in 6 of 200 sampled docs
  ```

  Optional properties are fields that appear in **some** sampled documents but not all. The user can include or exclude them like any other field. If included, they become normal columns in the export. For rows where the field is absent, the cell is **empty** — this is expected and does not trigger an error. Absence of an optional field is distinct from an *unexpected* field (handled by the policy in task 09).

- [ ] 08 — Build the tabbed preview panel — shows a tab bar with one tab for the main sheet and one tab per included array field. Each tab displays a bounded table (10 / 25 / 50 rows) with the confirmed field list for that sheet as fixed column headers. Driven by mock row data at this stage.

  The main sheet tab shows scalar fields and auto-generated array count columns. Companion tabs show system fields (`_sourceDocId`, `_arrayIndex`) plus element fields. Clicking a row in the main tab filters companion tabs to show only rows belonging to that document's `_sourceDocId`. Toggling an array field off in the field list removes its companion tab in real time.

  ```
  Preview   [ Showing 25 ▾ ] rows
  ┌──────────┬──────────────┬─────────────┐
  │  orders  │ orders_items │ orders_tags │
  └──────────┴──────────────┴─────────────┘

  Tab: orders (main)
  | orderId | customer_name | total | items_count | tags_count |
  |---------|---------------|-------|-------------|------------|
  | 1001    | Ana           | 45.50 | 3           | 2          |
  | 1002    | Ben           | 90.00 | 1           | 1          |

  Tab: orders_items — after clicking row 1001
  [ ✕ Filtered to: 1001 — Show all ]
  | _sourceDocId | _arrayIndex | sku | name     | qty |
  | 1001         | 0           | A1  | Keyboard | 2   |
  | 1001         | 1           | B9  | Mouse    | 1   |

  Tab: orders_tags — after clicking row 1001
  [ ✕ Filtered to: 1001 — Show all ]
  | _sourceDocId | _arrayIndex | value       |
  | 1001         | 0           | electronics |
  | 1001         | 1           | sale        |
  ```

  The row limit selector controls how many source documents are sampled for the main sheet. Companion tabs show all array elements belonging to those sampled documents — no separate row limit for companion tabs.

- [ ] 09 — Build the unexpected-field policy selector — a radio group: **Ignore unexpected fields** (default) and **Abort on unexpected fields**. Each option has a tooltip explaining what happens when a document has a field outside the confirmed list.

  Controls what happens at export time when a document contains a field that is not in the confirmed field list.

  ```
  When a document has an unexpected field:
    ● Ignore unexpected fields   (i) Continue exporting; extra fields are silently dropped.
    ○ Abort on unexpected fields (i) Stop the task and report the offending field name.
  ```

  **Example:** confirmed fields are `orderId` and `total`. A document arrives with `{ orderId: 1, total: 5, discountCode: "D10" }`.
  - **Ignore**: `discountCode` is dropped silently; row `[1, 5]` is written.
  - **Abort**: the task stops and reports: `"Unexpected field 'discountCode' in document at index 412."`.

- [ ] 10 — Build the export file name input — defaults to the collection or database name and automatically appends the correct file extension when the format changes.

  Defaults to the collection name. The extension updates automatically when the user switches format.

  ```
  File name: [ orders.csv ]    ← user typed "orders"; .csv appended automatically

  User switches format to Excel  →  [ orders.xlsx ]
  ```

- [ ] 11 — Build the advanced format options panel — collapsed by default behind an "Advanced Options" toggle. CSV options: delimiter, quoting style, text encoding, line ending. Excel options: sheet name.

  Collapsed by default. Opening it reveals format-specific knobs. Changing any option is reflected in the preview table on the next render.

  ```
  ▶ Advanced Options

  CSV
    Delimiter:    [ , ▾ ]   (comma / semicolon / tab)
    Quoting:      [ Minimal ▾ ]
    Encoding:     [ UTF-8 ▾ ]
    Line ending:  [ CRLF ▾ ]

  Excel
    Sheet name:   [ orders ]
  ```

### UI — Database Export

- [ ] 12 — Build the collection list sidebar — lists each collection in the selected database with a status chip: **Pending** (not yet configured), **Configured**, or **Ready**.

  When exporting a whole database, this sidebar lists every collection and tracks its configuration state.

  ```
  ┌────────────────────────┐
  │ orders     PENDING     │
  │ products   READY       │
  │ users      PENDING     │
  └────────────────────────┘
  ```

  - **Pending** — user has not yet opened this collection's config pane.
  - **Configured** — user has opened and changed settings but has not confirmed.
  - **Ready** — user has confirmed the field list and options for this collection.

- [ ] 13 — Build the per-collection configuration pane — clicking a collection in the sidebar opens its export configuration in the main area, reusing the same field list and options from the Collection Export UI.

  Clicking a collection in the sidebar loads the full Collection Export UI (tasks 04–11) for that collection in the main panel. Each collection maintains its own independent configuration.

  ```
  [ orders | products | users ]

  ← Clicking "products" loads the products field list and options in the main panel
  ```

- [ ] 14 — Build the gated Export button — only activates when at least one collection is marked Ready. Shows the count of collections still Pending.

  Export is only enabled once at least one collection is Ready. The button label communicates current progress.

  ```
  2 collections still Pending.

  [ Export (1 Ready) ]   ← only "products" is Ready; button is active
  ```

### UI — Progress & Result

- [ ] 15 — Build the progress panel — shows an indeterminate then determinate progress bar, a live status message (e.g., "Exporting row 450 of ~1200"), and a Cancel button.

  Shown while the export runs. Starts indeterminate (while the cursor is opening), then transitions to a percentage bar as rows stream in.

  ```
  Exporting orders…

  [████████░░░░░░░░░░░░]  37%

  Exporting row 450 of ~1200

  [ Cancel ]
  ```

- [ ] 16 — Build the result summary panel — shows total rows exported, skipped or aborted count, the destination file path (clickable to reveal in the OS file manager), and an expandable error details list. For database exports, shows a zip summary with per-collection breakdown.

  Shown after the export completes, is cancelled, or is aborted. The file path link opens the OS file manager at the output location.

  Collection export:
  ```
  ✓ Export complete

    Rows exported:   1198
    Rows skipped:    2
    Output file:     C:\exports\orders.xlsx  [Reveal in Explorer]

  ▶ Error details (2)
    Row 88:   Unexpected field 'legacyId' — skipped
    Row 412:  Null value in required field 'total' — skipped
  ```

  Database export:
  ```
  ✓ Export complete

    Output archive: C:\exports\shop.zip  [Reveal in Explorer]

  ▶ Contents (3 files)
    orders.xlsx    — 3 sheets (orders, orders_items, orders_tags)  1198 main rows
    products.xlsx  — 1 sheet  (products)                           340 main rows
    users.xlsx     — 2 sheets (users, users_addresses)             889 main rows
  ```

### Logic — Schema Analysis

- [ ] 17 — Fetch the collection schema from the server — samples a bounded set of documents, walks all field paths depth-first, and classifies each as Required (in every sample) or Optional (in some). (`exportData.getSchema` tRPC query)

  Samples up to N documents (e.g., 200), walks all paths depth-first, and classifies each path.

  ```
  Input:  collection "orders", sample size 200

  Output:
    Required: ["orderId", "total"]           ← present in all 200 docs
    Optional: ["coupon", "customer.city"]    ← present in some docs only
  ```

- [ ] 18 — Build the flat property extractor — converts a nested document into a flat list of classified path entries. Scalar and nested-object paths are walked depth-first. Arrays are classified at the point they are encountered; their contents are not recursively expanded by the extractor.

  Each path entry carries a `kind`: `scalar`, `array-of-objects`, `array-of-scalars`, or `array-empty`. Only `scalar` paths are added to the main sheet field list; array paths are handed to the companion schema discoverer (task A-LOGIC-02).

  ```
  Input:  { a: 1, b: { c: { y: { z: 2 } } }, items: [{ sku: 'A' }], tags: ['x'], history: [] }
  Output: [
    { path: 'a',       kind: 'scalar'           },
    { path: 'b.c.y.z', kind: 'scalar'           },
    { path: 'items',   kind: 'array-of-objects' },
    { path: 'tags',    kind: 'array-of-scalars' },
    { path: 'history', kind: 'array-empty'      },
  ]

  Input:  { address: { city: "Oslo", zip: "0150" } }
  Output: [
    { path: 'address.city', kind: 'scalar' },
    { path: 'address.zip',  kind: 'scalar' },
  ]
  ```

- [ ] 19 — Build the separator column name builder — takes a dot-notation path list and the user's chosen separator and produces column header strings. For example, `b.c.y.z` with `_` produces `b_c_y_z`.

  Takes the dot-notation paths from task 18 and converts them to column headers using the user's separator.

  ```
  Paths:     ["customer.address.city", "orderId"]

  Separator "_"  →  ["customer_address_city", "orderId"]
  Separator "#"  →  ["customer#address#city", "orderId"]
  Separator "."  →  ["customer.address.city", "orderId"]  ← unchanged
  ```

- [ ] 20 — Connect the server schema response to the field list — replaces mock column data with the live schema result. Keep a mock fallback for development without a live connection.

  Replaces the hard-coded mock field list with the live schema from task 17. The fallback ensures the UI still renders during offline development.

  ```typescript
  // Before (mock data only):
  const fields = MOCK_FIELDS;

  // After (live with fallback):
  const fields = schemaQuery.data ?? MOCK_FIELDS;
  ```

### Logic — Export Task

- [ ] 21 — Lock in the confirmed field list as the export contract — takes the user's confirmed field selection, ordering, and rename choices and produces an immutable `FieldContract` used for the entire export run.

  At the moment the user clicks Export, the current field selection is frozen. This snapshot never changes during the export run, guaranteeing a consistent file structure even if the collection schema changes mid-export.

  ```typescript
  const contract: FieldContract[] = [
    { sourcePath: 'orderId',       columnHeader: 'orderId',       included: true },
    { sourcePath: 'customer.name', columnHeader: 'customer_name', included: true },
    { sourcePath: 'coupon',        columnHeader: 'coupon',        included: true },
  ];
  // This array is Object.freeze'd and never mutated during the export run.
  ```

- [ ] 22 — Implement the DocumentDB document cursor adapter — the real (non-stub) `IExportSourceAdapter` that opens a server-side cursor over the target collection and streams documents page by page to the export pipeline.

  Replaces the stub from Phase 1 task 12. Opens a real server-side cursor with a batch size, yielding pages of documents until the cursor is exhausted.

  ```typescript
  class DocumentDBExportSourceAdapter implements IExportSourceAdapter {
    async *openCursor(config: ExportConfig): AsyncIterable<Document> {
      const cursor = collection.find({}).batchSize(200);
      for await (const doc of cursor) {
        yield doc;
      }
    }
    async estimateCount(config: ExportConfig): Promise<number> {
      return collection.estimatedDocumentCount();
    }
  }
  ```

- [ ] 23 — Start the export background task — validates the config, creates an extension task, and returns a task ID. Streams live progress events back to the webview. (`exportData.startExport` tRPC mutation, collection source)

  The tRPC mutation that kicks off the export. Validates config first (field contract non-empty, output path writable), then launches an extension `Task` and returns its ID.

  ```typescript
  // Webview calls:
  const { taskId } = await trpc.exportData.startExport.mutate({ config });

  // Extension host: validates config → creates Task → starts cursor → streams progress
  ```

- [ ] 24 — Build the document-to-row transformer — reads the value at each field contract path for every document and produces a fixed-length row. Missing fields produce empty cells; nested objects at a leaf are serialized as a JSON string.

  For every document, reads the value at each contract path and produces a fixed-length array. The row length always equals the number of included fields.

  ```
  Contract: ["orderId", "customer.name", "coupon"]

  Doc: { orderId: 1003, customer: { name: "Ben" } }
  Row: [1003, "Ben", ""]   ← coupon absent → empty string

  Doc: { orderId: 1004, metadata: { source: "web", v: 2 } }
  Contract includes "metadata" as a leaf →
  Row: [1004, "", '{"source":"web","v":2}']   ← nested object serialized as JSON string
  ```

- [ ] 25 — Build the unexpected-field detector — checks each incoming document's keys against the field contract and applies the user's chosen policy: continue silently (Ignore) or stop the task (Abort).

  Inspects every document's keys against the field contract produced in task 21. Applied before the row transformer.

  ```
  Contract keys:  { orderId, total, coupon }
  Document:       { orderId: 1, total: 5, discountCode: "D10" }

  Policy = Ignore  →  "discountCode" dropped; row [1, 5, ""] is written normally.
  Policy = Abort   →  task stops. Error: "Unexpected field 'discountCode' at document index 412."
  ```

- [ ] 26 — Implement the CSV file writer — streams export rows into a CSV file using the user-configured delimiter, quoting style, text encoding, and line ending.

  Opens a write stream, writes the header row first, then writes each row produced by task 24. Respects all advanced format options.

  ```
  Config: delimiter=;  encoding=UTF-8  line ending=LF

  orderId;customer_name;total
  1001;Ana;45.5
  1002;;90
  1003;Ben;
  ```

- [ ] 27 — Implement the Excel file writer — streams rows into an `.xlsx` workbook with correct value-type mapping (dates, numbers, booleans, strings). Writes the main sheet first, then one companion worksheet per included array field in declaration order. Respects Excel sheet name, row, and column count limits.

  Uses `exceljs` streaming mode so large collections do not exhaust memory. Stores each value with the correct Excel cell type so formulas and sorting work correctly. Values that begin with formula-like prefixes (`=`, `+`, `-`, `@`) are written as explicit text cells. System field columns (`_sourceDocId`, `_arrayIndex`) are always written as text.

  ```
  Sheet 1: orders (main)
  _id (Text) | customer_name (Text) | total (Number) | items_count (Number) | tags_count (Number)
  ord_001    | Alice                | 45.50          | 3                    | 2
  ord_002    | Bob                  | 90.00          | 1                    | 1

  Sheet 2: orders_items (companion — array-of-objects)
  _sourceDocId (Text) | _arrayIndex (Number) | sku (Text) | qty (Number) | price (Number)
  ord_001             | 0                    | A1         | 2            | 49.99
  ord_001             | 1                    | B9         | 1            | 29.99
  ord_002             | 0                    | D2         | 1            | 89.00

  Sheet 3: orders_tags (companion — array-of-scalars)
  _sourceDocId (Text) | _arrayIndex (Number) | value (Text)
  ord_001             | 0                    | electronics
  ord_001             | 1                    | sale
  ```

- [ ] 28 — Connect live export progress to the progress panel — updates the progress bar and status message each time the server emits a progress event. (`exportData.taskProgress` tRPC subscription)

  The webview subscribes to the tRPC subscription and pushes each event into React state, which re-renders the progress bar and status text.

  ```typescript
  trpc.exportData.taskProgress.subscribe({ taskId }, {
    onData(event) {
      setProgress({ current: event.rowsProcessed, total: event.estimatedTotal });
      setStatusMessage(`Exporting row ${event.rowsProcessed} of ~${event.estimatedTotal}`);
    },
  });
  ```

- [ ] 29 — Wire the Cancel button — sends a cancellation signal to the running export task, stops the file writer, and deletes the partial output file on disk. (`exportData.cancelTask` mutation)

  Sends the cancellation mutation. The extension host closes the cursor, aborts the writer, and deletes the incomplete output file so no corrupt file is left behind.

  ```typescript
  // Webview:
  await trpc.exportData.cancelTask.mutate({ taskId });

  // Extension host:
  cursor.close();
  writer.abort();
  fs.unlinkSync(partialFilePath);  // clean up partial file
  ```

- [ ] 30 — Add telemetry for the export flow — emit events for: export started (source type, format, field count), export completed (row count, duration), export cancelled, and export failed (error category).

  Emits structured events at key lifecycle points so the team can understand usage patterns and failure rates.

  ```typescript
  telemetry.sendEvent('exportData/started',   { sourceType: 'collection', format: 'csv', fieldCount: 5 });
  telemetry.sendEvent('exportData/completed', { rowCount: 1198, durationMs: 4200 });
  telemetry.sendEvent('exportData/cancelled', {});
  telemetry.sendEvent('exportData/failed',    { errorCategory: 'write_error' });
  ```

### Logic — Database Export

- [ ] 31 — Fetch the collection list for the selected database — returns each collection name and its approximate document count. (`exportData.listCollections` tRPC query)

  Used to populate the sidebar (task 12) with live data. The estimated count is shown as a hint next to each collection name.

  ```
  Input:  database "shop"
  Output: [
    { name: "orders",   estimatedCount: 1200 },
    { name: "products", estimatedCount: 340  },
    { name: "users",    estimatedCount: 890  },
  ]
  ```

- [ ] 32 — Connect the collection list to the sidebar — replaces the mock list with live data from the server.

  Replaces the hard-coded mock collection list (from task 12) with the live response from task 31.

  ```typescript
  const collections = collectionsQuery.data ?? MOCK_COLLECTIONS;
  ```

- [ ] 33 — Start a database-level export task — iterates over all configured collections in sequence, runs the collection-level export for each one, and combines the results into a single summary. (`exportData.startExport` tRPC mutation, database source)

  Runs the collection-level export pipeline (tasks 22–27) for each configured collection in sequence, then merges all per-collection `TaskResult` objects into one summary.

  ```
  shop/orders   → orders.csv   (1198 rows, 2 errors)
  shop/products → products.csv (340 rows,  0 errors)
  shop/users    → users.csv    (888 rows,  1 error)

  Database summary: 3 collections, 2426 rows total, 3 errors total.
  ```

- [ ] 34 — Package all ready collection workbooks into a zip archive — after each collection's `.xlsx` (or CSV files) have been written to a shared temp directory, compress the temp directory into a single `.zip` archive at the user-specified output path. Database export always produces a zip; single-workbook output is out of scope.

  Uses streaming zip (e.g., `archiver` or Node.js `zlib`) to avoid loading all workbooks into memory simultaneously. On success, deletes the temp directory. On failure or cancellation at any point, deletes both the partial zip and the temp directory; cleanup is idempotent.

  ```
  Temp directory (deleted after packaging):
    /tmp/export-shop/
      ├─ orders.xlsx    ← 3 sheets: orders, orders_items, orders_tags
      ├─ products.xlsx  ← 1 sheet:  products
      └─ users.xlsx     ← 2 sheets: users, users_addresses

  Output:
    C:\exports\shop.zip
      ├─ orders.xlsx
      ├─ products.xlsx
      └─ users.xlsx
  ```

### Tests

- [ ] 35 — Unit tests for the flat property extractor — cover: deeply nested objects, array classification (objects vs scalars vs empty), null values, missing keys, and cyclic-safe traversal.

  ```typescript
  // Scalar and nested-scalar paths
  expect(extract({ b: { c: { y: { z: 2 } } } }))
    .toContainEqual({ path: 'b.c.y.z', kind: 'scalar' });
  expect(extract({ a: null }))
    .toContainEqual({ path: 'a', kind: 'scalar' });
  expect(extract({})).toEqual([]);

  // Array classification
  expect(extract({ items: [{ sku: 'A' }] }))
    .toContainEqual({ path: 'items', kind: 'array-of-objects' });
  expect(extract({ tags: ['x', 'y'] }))
    .toContainEqual({ path: 'tags', kind: 'array-of-scalars' });
  expect(extract({ history: [] }))
    .toContainEqual({ path: 'history', kind: 'array-empty' });

  // Arrays nested inside objects are classified at their full path
  expect(extract({ order: { items: [{ sku: 'A' }] } }))
    .toContainEqual({ path: 'order.items', kind: 'array-of-objects' });
  ```

- [ ] 36 — Unit tests for the document-to-row transformer — cover: missing fields producing empty cells, explicit null vs absent field, date and ObjectId serialization, and separator character collisions in column names.

  ```typescript
  // Missing field → empty string
  expect(transform({ orderId: 1 }, contract)).toEqual([1, '', '']);

  // Explicit null → empty string (not the string "null")
  expect(transform({ orderId: 1, total: null }, contract)).toEqual([1, '', '']);

  // ObjectId → hex string
  expect(transform({ _id: new ObjectId('abc...') }, contract)).toEqual(['abc...']);

  // Date → ISO string
  expect(transform({ createdAt: new Date('2024-01-01') }, contract)).toEqual(['2024-01-01T00:00:00.000Z']);
  ```

- [ ] 37 — Unit tests for the unexpected-field policy — verify that Ignore continues exporting and Abort stops the task and reports the offending field name and document index.

  ```typescript
  // Ignore policy: row is still written, no error thrown
  const result = applyPolicy('ignore', doc, contract, rowIndex);
  expect(result.shouldAbort).toBe(false);

  // Abort policy: returns abort signal with field name and index
  const result = applyPolicy('abort', doc, contract, 412);
  expect(result.shouldAbort).toBe(true);
  expect(result.reason).toContain('discountCode');
  expect(result.reason).toContain('412');
  ```

### Array Support

> Tasks below extend Phase 2 with array-of-objects and array-of-scalars support. UI tasks must be verified with mock data before the corresponding logic tasks are started.
> All decisions from the design discussions are locked: every array field produces a companion sheet; database export always produces a zip; array-mixed is out of scope.

#### UI — Array Support

- [ ] A-UI-01 — Update the field list panel to show two independent sections

  Split the existing field list into two labelled sections. The top section is unchanged for scalar and nested-object fields. The bottom section lists each discovered array field as a single row: include/exclude checkbox, source path, arrow to companion sheet name, array kind badge (`[objects]` / `[scalars]` / `[empty ⚠]`), and element count hint.

  Unchecking an array field in the bottom section simultaneously removes its auto-generated `_count` column from the top section, removes its companion tab from the preview, and removes its companion sheet from the output.

  ```
  ─── Scalar & nested fields ───────────────────────────────
  ☑  [≡] _id              → _id
  ☑  [≡] customer.name    → customer_name
  ☑  [≡] status           → status
  ☑  [≡] items_count      → items_count       [auto]
  ☑  [≡] tags_count       → tags_count        [auto]

  ─── Array fields (exported as companion sheets) ──────────
  ☑  items   → orders_items     [objects]   avg 2.8 elem/doc
  ☑  tags    → orders_tags      [scalars]   avg 3.1 elem/doc
  ☐  history → orders_history   [empty ⚠]  no content observed
  ```

- [ ] A-UI-02 — Convert the preview table to a tabbed multi-sheet preview

  Replace the existing single preview table with a tab bar. Tabs are generated dynamically: one tab for the main sheet, one per included array field. Tab count equals the number of sheets in the output workbook. The row limit selector (10 / 25 / 50) controls how many source documents are sampled; companion tabs show all elements for those documents with no separate row limit.

  ```
  Preview   [ Showing 25 ▾ ] rows
  ┌──────────┬──────────────┬─────────────────┐
  │  orders  │ orders_items │ orders_payments  │
  └──────────┴──────────────┴─────────────────┘
  ```

- [ ] A-UI-03 — Add row filter interaction between main tab and companion tabs

  Clicking any data row in the main sheet tab sets a `_sourceDocId` filter on all companion tabs. Each filtered companion tab shows a dismissible filter chip. Clicking the chip restores the full companion preview. Switching back to the main tab and clicking the same row clears the filter.

  ```
  ← Click row ord_001 in orders tab

  orders_items tab:
    [ ✕ Filtered to: ord_001 — Show all ]
    | _sourceDocId | _arrayIndex | sku | name     |
    | ord_001      | 0           | A1  | Keyboard |
    | ord_001      | 1           | B9  | Mouse    |
  ```

- [ ] A-UI-04 — Build the array-of-objects companion sheet field management panel

  Each array-of-objects companion tab has its own independent field list. System fields (`_sourceDocId`, `_arrayIndex`) have a disabled checkbox (always included), a tooltip, and a rename input that shows a `⚠ Renamed system field` badge when used. System fields are pinned to the first two column positions; drag handles are hidden for them. Element fields support include/exclude, rename, and drag-to-reorder. The Required/Optional section split applies to element fields.

  ```
  Tab: orders_items

  ─── System fields ────────────────────────────────────────
  ☑  [locked] _sourceDocId   → _sourceDocId   ⓘ Required join key
  ☑  [locked] _arrayIndex    → _arrayIndex    ⓘ Required join key

  ─── Required (in all 40 sampled elements) ───────────────
  ☑  [≡] sku     → productSku
  ☑  [≡] qty     → quantity

  ▶ Optional (in some elements) ──────────────────────────
  ☑  [≡] discount → discount   ← present in 3 of 40 elements
  ```

- [ ] A-UI-05 — Build the array-of-scalars companion sheet field management panel

  Each array-of-scalars companion tab has a minimal, fixed field management panel. System fields behave identically to A-UI-04. There is exactly one user field — `value` — which cannot be excluded or reordered; only its column header rename is available.

  ```
  Tab: orders_tags

  ─── System fields ────────────────────────────────────────
  ☑  [locked] _sourceDocId   → _sourceDocId   ⓘ
  ☑  [locked] _arrayIndex    → _arrayIndex    ⓘ

  ─── Value field ──────────────────────────────────────────
  ☑  [locked] value          → [ tagName ]    ← user renamed
  ```

- [ ] A-UI-06 — Update format selector and file name input for database export zip mode

  In database export context, add an informational notice below the format selector explaining that the output is always a zip archive. The file name input extension is always `.zip`. A read-only contents preview lists the auto-generated inner file names and their companion sheets; it updates live as collections are configured.

  ```
  Format:  ○ CSV   ● Excel

  ℹ Database export packages one file per collection into a zip archive.

    Preview contents:
      orders.xlsx   — orders, orders_items, orders_tags
      products.xlsx — products
      users.xlsx    — users, users_addresses

  File name: [ shop.zip ]
  ```

- [ ] A-UI-07 — Add array field indicator chip to the database export collection sidebar

  Add an `⊞ N array fields` chip next to collections that contain at least one array-of-objects or array-of-scalars field. Informational only — tells the analyst their workbook will have companion sheets.

  ```
  ┌──────────────────────────────────────────────────────┐
  │ orders      PENDING   ⊞ 2 array fields               │
  │ products    READY                                     │
  │ users       PENDING   ⊞ 1 array field                │
  └──────────────────────────────────────────────────────┘
  ```

- [ ] A-UI-08 — Update the export progress panel for database export zip mode

  Show two-level progress: current collection (N of M) and row progress within that collection. After all collections complete, show a "Packaging zip…" phase with an indeterminate bar.

  ```
  Exporting database: shop
  Collection 2 of 3: products

  [████████░░░░░░░░░░░░]  37%
  Exporting row 120 of ~340

              ↓ after all collections complete

  Packaging zip…
  [░░░░░░░░░░░░░░░░░░░░]
  ```

- [ ] A-UI-09 — Update the result summary panel for database export zip mode

  Replace the single output file line with a zip summary showing each contained workbook, its sheet names, and its main-sheet row count. The "Reveal in Explorer" action targets the zip file.

  ```
  ✓ Export complete

    Output archive: C:\exports\shop.zip   [Reveal in Explorer]

  ▶ Contents (3 files)
    orders.xlsx    — 3 sheets (orders, orders_items, orders_tags)    1198 main rows
    products.xlsx  — 1 sheet  (products)                             340 main rows
    users.xlsx     — 2 sheets (users, users_addresses)               889 main rows
  ```

#### Logic — Array Support

- [ ] A-LOGIC-01 — Extend the flat property extractor to classify array fields

  Update the depth-first path walker to stop and classify when it encounters an array value. Classification reads sampled elements across all documents to determine kind. Only `scalar` paths feed into the main sheet field list; array paths go to the companion schema discoverer.

  ```typescript
  extract({ _id: '1', items: [{ sku: 'A' }], tags: ['x'], history: [] })
  → [
      { path: '_id',     kind: 'scalar'           },
      { path: 'items',   kind: 'array-of-objects' },
      { path: 'tags',    kind: 'array-of-scalars' },
      { path: 'history', kind: 'array-empty'      },
    ]

  // Nested array field classified at full dot-notation path
  extract({ order: { items: [{ sku: 'A' }] } })
  → [{ path: 'order.items', kind: 'array-of-objects' }]
  ```

- [ ] A-LOGIC-02 — Build the companion schema discoverer

  For each `array-of-objects` field, walk all elements across all sampled documents, collect every leaf path inside elements, and classify each as Required (in all sampled elements) or Optional (in some). Returns a `CompanionSheetSchema`. For `array-of-scalars`, skip discovery and return the fixed single-field schema (`value`, always Required). Applies bounded traversal depth and cycle guard. Arrays nested inside elements are treated as leaves (no recursive expansion).

  ```typescript
  discoverCompanionSchema('items', sampledDocs)
  → {
      sourceArrayPath: 'items',
      arrayKind: 'array-of-objects',
      sheetName: 'orders_items',
      fields: [
        { sourcePath: '_sourceDocId', systemField: true  },
        { sourcePath: '_arrayIndex',  systemField: true  },
        { sourcePath: 'sku',          required: true     },
        { sourcePath: 'qty',          required: true     },
        { sourcePath: 'discount',     required: false    },
      ]
    }

  discoverCompanionSchema('tags', sampledDocs)
  → {
      sourceArrayPath: 'tags',
      arrayKind: 'array-of-scalars',
      sheetName: 'orders_tags',
      fields: [
        { sourcePath: '_sourceDocId', systemField: true },
        { sourcePath: '_arrayIndex',  systemField: true },
        { sourcePath: 'value',        required: true    },
      ]
    }
  ```

- [ ] A-LOGIC-03 — Update the schema query to return the full ExportSchema tree

  Change the `exportData.getSchema` tRPC query response from a flat field list to an `ExportSchema` object containing the main sheet (scalar fields + array summary columns) and an array of `CompanionSheetSchema` entries.

  ```typescript
  // Response shape
  {
    mainSheet: {
      fields: [...],                   // scalar fields only
      arraySummaryColumns: [
        { sourceArrayPath: 'items', columnHeader: 'items_count' },
        { sourceArrayPath: 'tags',  columnHeader: 'tags_count'  },
      ]
    },
    companionSheets: [
      { sourceArrayPath: 'items', arrayKind: 'array-of-objects', sheetName: 'orders_items', fields: [...] },
      { sourceArrayPath: 'tags',  arrayKind: 'array-of-scalars', sheetName: 'orders_tags',  fields: [...] },
    ]
  }
  ```

- [ ] A-LOGIC-04 — Update the column name builder to operate per sheet scope

  The separator-based column name builder runs independently per sheet context. Duplicate detection is scoped per sheet only; the same header name in two different sheets is not a collision.

  ```typescript
  buildColumnName('customer.name', '_', scope='orders')         → 'customer_name'
  buildColumnName('address.city',  '_', scope='orders_items')   → 'address_city'

  // Duplicate within same sheet → error
  validateHeaders(['sku', 'name', 'sku'], scope='orders_items')  → Error: duplicate 'sku'

  // Same name in different sheets → OK
  validateHeaders(['status'], scope='orders_items')  // 'status' also in orders → no error
  ```

- [ ] A-LOGIC-05 — Update the main sheet document-to-row transformer

  The main sheet transformer now: (1) skips all array fields — they produce no cell in the main sheet; (2) emits a `_count` summary cell for each included array field (`field?.length ?? 0`); (3) treats absent or null array fields as count 0.

  ```typescript
  // Doc: { _id: 'ord_001', status: 'shipped', items: [{},{},{}], tags: ['a','b'] }
  // Contract: _id, status, items_count(auto), tags_count(auto)
  transformMainRow(doc, contract) → ['ord_001', 'shipped', 3, 2]

  // Array field absent
  transformMainRow({ _id: 'ord_002', status: 'pending' }, contract) → ['ord_002', 'pending', 0, 0]

  // Array field null
  transformMainRow({ _id: 'ord_003', items: null }, contract) → ['ord_003', ..., 0, ...]
  ```

- [ ] A-LOGIC-06 — Build the array-of-objects element expander

  Takes a single document and a `CompanionSheetSchema` for an `array-of-objects` field. Produces one output row per array element. Each row starts with `_sourceDocId` (doc `_id` as string, or `_sourceDocIndex` if absent) then `_arrayIndex` then element fields in contract order. Missing optional fields produce empty string. Nested objects in elements are flattened using the companion sheet's separator. Arrays inside elements are serialized as JSON text.

  ```typescript
  expandObjectArrayField('items', doc, companionContract)
  // doc._id = 'ord_001', doc.items = [{sku:'A1',qty:2}, {sku:'B9',qty:1,discount:5}, {sku:'C4',qty:1}]
  → [
      ['ord_001', 0, 'A1', 2, ''  ],  // discount absent → ''
      ['ord_001', 1, 'B9', 1, 5   ],
      ['ord_001', 2, 'C4', 1, ''  ],  // discount absent → ''
    ]

  // No _id → use synthetic position
  expandObjectArrayField('items', { items: [{ sku: 'X' }] }, contract, 7)
  → [['7', 0, 'X', '', '']]

  // Absent or null array → zero rows
  expandObjectArrayField('items', { _id: 'ord_002' }, contract) → []
  ```

- [ ] A-LOGIC-07 — Build the array-of-scalars element expander

  Takes a single document and a `CompanionSheetSchema` for an `array-of-scalars` field. Produces one output row per element with exactly 3 columns: `_sourceDocId`, `_arrayIndex`, `value`. Value is written using the same type mapping rules as any scalar cell (dates → ISO string, null → empty string). Empty array → zero rows.

  ```typescript
  expandScalarArrayField('tags', { _id: 'ord_001', tags: ['electronics', 'sale'] })
  → [['ord_001', 0, 'electronics'], ['ord_001', 1, 'sale']]

  expandScalarArrayField('scores', { _id: 'ord_002', scores: [95, 87.5] })
  → [['ord_002', 0, 95], ['ord_002', 1, 87.5]]

  // null element → empty string, index still advances
  expandScalarArrayField('tags', { _id: 'ord_003', tags: ['a', null, 'b'] })
  → [['ord_003', 0, 'a'], ['ord_003', 1, ''], ['ord_003', 2, 'b']]

  expandScalarArrayField('tags', { _id: 'ord_004', tags: [] }) → []
  ```

- [ ] A-LOGIC-08 — Build the companion sheet writer

  Writes companion rows produced by A-LOGIC-06 and A-LOGIC-07 into output. For Excel, creates a named worksheet in the same workbook as the main sheet using `exceljs` streaming mode. For CSV, writes a separate `.csv` file named `<collectionName>_<arrayPath>.csv`. Writes the header row first using confirmed column headers, then streams rows. Applies the same Excel value-type mapping as the main writer. System field columns are always written as text to preserve join key fidelity.

  ```
  orders.xlsx (streaming)
    Sheet 1: orders          ← main writer (existing)
    Sheet 2: orders_items    ← companion — array-of-objects, columns: _sourceDocId | _arrayIndex | productSku | quantity | discount
    Sheet 3: orders_tags     ← companion — array-of-scalars, columns: _sourceDocId | _arrayIndex | tagName
  ```

- [ ] A-LOGIC-09 — Build the zip packager for database export

  After all collection workbooks are written to a shared temp directory, compresses them into a single `.zip` at the user-specified output path using streaming zip. On success, deletes the temp directory. On failure or cancellation, deletes both the partial zip and the temp directory; cleanup is idempotent.

  ```typescript
  interface ZipPackageResult {
    outputPath: string;
    files: { name: string; sheetCount: number; mainRowCount: number }[];
  }

  // On failure: partial zip deleted, temp dir preserved, temp path surfaced in error detail
  ```

- [ ] A-LOGIC-10 — Update cancellation and cleanup for database export zip mode

  Extend the cancellation handler to: (1) signal the active collection's cursor to stop; (2) allow the active companion sheet writer to close cleanly; (3) delete all temp `.xlsx` files; (4) delete the partial `.zip` if it exists; (5) report "Cancelled after N rows across M completed collections". Cleanup must be idempotent — repeated calls or calls after partial failures must not throw.

  ```typescript
  // Cancel during collection 2 of 3
  result.cancelledAfter = {
    completedCollections: ['orders.xlsx'],    // fully written
    partialCollection: 'products.xlsx',       // in progress, deleted
    rowsWritten: { orders: 1198, products: 120 }
  }
  ```

#### Tests — Array Support

- [ ] A-TEST-01 — Unit tests for array classifier in the flat property extractor

  ```typescript
  expect(classify({ items: [{ sku: 'A' }] }))
    .toContainEqual({ path: 'items', kind: 'array-of-objects' });
  expect(classify({ tags: ['a', 'b'] }))
    .toContainEqual({ path: 'tags', kind: 'array-of-scalars' });
  expect(classify({ history: [] }))
    .toContainEqual({ path: 'history', kind: 'array-empty' });
  expect(classify({ order: { items: [{ sku: 'A' }] } }))
    .toContainEqual({ path: 'order.items', kind: 'array-of-objects' });
  expect(classify({ items: null }))
    .toContainEqual({ path: 'items', kind: 'scalar' }); // null is not an array
  ```

- [ ] A-TEST-02 — Unit tests for the companion schema discoverer

  ```typescript
  // array-of-objects: Required vs Optional
  const docs = [
    { items: [{ sku: 'A', qty: 1 }] },
    { items: [{ sku: 'B', qty: 2, discount: 5 }] },
  ];
  const schema = discoverCompanionSchema('items', docs);
  expect(schema.fields.find(f => f.sourcePath === 'sku').required).toBe(true);
  expect(schema.fields.find(f => f.sourcePath === 'discount').required).toBe(false);

  // array-of-scalars: always returns fixed single value field
  const schema2 = discoverCompanionSchema('tags', [{ tags: ['a', 'b'] }]);
  expect(schema2.fields.filter(f => !f.systemField)).toHaveLength(1);
  expect(schema2.fields.find(f => !f.systemField).sourcePath).toBe('value');

  // Document with absent array contributes nothing to schema
  const schema3 = discoverCompanionSchema('items', [{ items: [{ sku: 'A' }] }, { status: 'x' }]);
  expect(schema3.fields.filter(f => !f.systemField)).toHaveLength(1);
  ```

- [ ] A-TEST-03 — Unit tests for the array-of-objects element expander

  ```typescript
  const doc = { _id: 'ord_001', items: [{ sku: 'A1', qty: 2 }, { sku: 'B9', qty: 1, discount: 5 }, { sku: 'C4', qty: 1 }] };
  const rows = expandObjectArrayField('items', doc, contract);
  expect(rows[0]).toEqual(['ord_001', 0, 'A1', 2, '']);  // discount absent → ''
  expect(rows[1]).toEqual(['ord_001', 1, 'B9', 1, 5]);
  expect(rows[2]).toEqual(['ord_001', 2, 'C4', 1, '']);

  // No _id → synthetic position index
  const rows2 = expandObjectArrayField('items', { items: [{ sku: 'X' }] }, contract, 7);
  expect(rows2[0][0]).toBe('7');

  // Absent array → zero rows
  expect(expandObjectArrayField('items', { _id: 'ord_002' }, contract)).toHaveLength(0);

  // Null array → zero rows
  expect(expandObjectArrayField('items', { _id: 'ord_003', items: null }, contract)).toHaveLength(0);
  ```

- [ ] A-TEST-04 — Unit tests for the array-of-scalars element expander

  ```typescript
  const doc = { _id: 'ord_001', tags: ['electronics', 'sale', 'new'] };
  const rows = expandScalarArrayField('tags', doc);
  expect(rows).toHaveLength(3);
  expect(rows[0]).toEqual(['ord_001', 0, 'electronics']);

  // Numeric type preserved
  expect(expandScalarArrayField('scores', { _id: 'ord_002', scores: [95, 87.5] })[1])
    .toEqual(['ord_002', 1, 87.5]);

  // BSON Date → ISO string
  const rows3 = expandScalarArrayField('ts', { _id: 'ord_003', ts: [new Date('2024-01-01')] });
  expect(rows3[0][2]).toBe('2024-01-01T00:00:00.000Z');

  // null element → empty string, index advances
  const rows4 = expandScalarArrayField('tags', { _id: 'ord_004', tags: ['a', null, 'b'] });
  expect(rows4[1]).toEqual(['ord_004', 1, '']);
  expect(rows4[2]).toEqual(['ord_004', 2, 'b']);

  // Empty array → zero rows
  expect(expandScalarArrayField('tags', { _id: 'ord_005', tags: [] })).toHaveLength(0);
  ```

- [ ] A-TEST-05 — Unit tests for the main sheet transformer with array fields

  ```typescript
  const doc = { _id: 'ord_001', status: 'shipped', items: [{}, {}, {}], tags: ['a', 'b'], history: [] };
  // Contract: _id, status, items_count(auto), tags_count(auto), history_count(auto)
  expect(transformMainRow(doc, mainContract)).toEqual(['ord_001', 'shipped', 3, 2, 0]);

  // Absent array → count 0
  expect(transformMainRow({ _id: 'ord_002', status: 'pending' }, mainContract)[2]).toBe(0);

  // Null array → count 0
  expect(transformMainRow({ _id: 'ord_003', items: null }, mainContract)[2]).toBe(0);
  ```

- [ ] A-TEST-06 — Unit tests for the zip packager

  ```typescript
  // Packages multiple files into zip
  const result = await packageToZip(['/tmp/orders.xlsx', '/tmp/products.xlsx'], '/out/shop.zip');
  expect(result.outputPath).toBe('/out/shop.zip');
  expect(result.files).toHaveLength(2);

  // Temp directory deleted after success
  expect(fs.existsSync('/tmp')).toBe(false); // temp dir cleaned

  // Partial zip deleted on failure; temp dir preserved
  mockZipWriterFailAfterFirstFile();
  await expect(packageToZip(['/tmp/orders.xlsx', '/tmp/products.xlsx'], '/out/shop.zip')).rejects.toThrow();
  expect(fs.existsSync('/out/shop.zip')).toBe(false);
  expect(fs.existsSync('/tmp/orders.xlsx')).toBe(true); // preserved for manual access
  ```

- [ ] 18 — Build the progress panel — shows an indeterminate then determinate progress bar, a live status message (e.g., "Importing row 450 of ~1200"), and a Cancel button.

  Updates with each row processed or each companion sheet reconstruction step.

  ```
  Importing collection: orders
  Progress: [████████░░░░░░░░░░░] 42%
  Inserted: 450 rows
  Arrays reconstructed: 450 documents

  [ Cancel ]
  ```

- [ ] 19 — Build the result summary panel — shows total records imported, skipped or failed count, and an expandable error details list. For database imports, shows per-collection breakdown.

  Summary after import completes or cancels.

  ```
  Import complete

  Total records:  1200
  Inserted:       1185
  Skipped:        15

  [▼] Error details (15 errors)
    Row 42: orderId required field missing
    Row 89: invalid JSON in items array
    ...
  ```

### Logic — Schema Analysis

- [ ] 20 — Extract columns and file structure from the uploaded zip — unzip safely, extract sheet/file names, and list sheet structure for the webview. (`importData.getZipStructure` tRPC query)

  ```typescript
  return {
    files: [
      { name: 'orders.csv', rows: 1200, format: 'csv' },
      { name: 'orders_items.csv', rows: 1500, format: 'csv' },
    ],
  };
  ```

- [ ] 21 — Detect array patterns in each sheet — identify companion sheets (by `_sourceDocId`/`_arrayIndex` columns), indexed tabular columns (`items[0].sku`, `items[1].sku`), and JSON-in-cell columns. Classify each array field by its detected pattern. (`importData.detectArrayPatterns` tRPC query)

  ```typescript
  return {
    arrayFields: [
      { path: 'items', pattern: 'companion-sheet', companionFile: 'orders_items.csv' },
      { path: 'tags', pattern: 'indexed-tabular', indexedColumns: ['tags[0]', 'tags[1]'] },
    ],
  };
  ```

- [ ] 22 — Parse columns and infer schema from the primary (main) sheet — for flat columns, infer types by scanning non-empty cells. For indexed tabular array columns, group by base path and index, infer element schema. For companion sheets, join and infer element schema. (`importData.getSchema` tRPC query)

  ```typescript
  return {
    fields: [
      { sourceName: 'orderId', targetName: 'orderId', type: 'number', required: true },
      { sourceName: 'items', pattern: 'companion-sheet', elementFields: [...] },
    ],
  };
  ```

- [ ] 23 — Connect the zip structure and schema response to the webview — replaces mock data with live detection results. Show array pattern indicators, companion sheet linking, and indexed column groupings.

### Logic — Import Task

- [ ] 24 — Lock in the confirmed schema and array reconstruction policies — takes the user's confirmed field selection, array policies (compact vs sparse), nesting choices, and missing-value configs and produces an immutable contract used for the entire import run.

- [ ] 25 — Implement the DocumentDB document insert adapter — the real (non-stub) `IImportDestinationAdapter` that opens a connection and inserts documents in batches with error handling and retry logic.

- [ ] 26 — Start the import background task — validates the config, creates an extension task, and returns a task ID. Streams live progress events back to the webview. (`importData.startImport` tRPC mutation)

- [ ] 27 — Build the array reconstruction logic — for each source record, reconstruct arrays from the detected pattern: join companion sheet rows, group indexed columns, or parse JSON strings. Produce a normalized document with nested arrays.

- [ ] 28 — Build the record-to-document transformer — applies field mapping, type conversions, nesting (dot-notation to object tree), and missing-value policies to each source record.

- [ ] 29 — Connect live import progress to the progress panel — updates the progress bar and status message each time the server emits a progress event. (`importData.taskProgress` tRPC subscription)

- [ ] 30 — Wire the Cancel button — sends a cancellation signal to the running import task, stops the insert operation, and reports the last successfully inserted record. (`importData.cancelTask` mutation)

- [ ] 31 — Add telemetry for the import flow — emit events for: import started (format, array patterns detected, field count), import completed (row count, duration), import cancelled, and import failed (error category).

### Tests

- [ ] 32 — Unit tests for zip extraction and file detection — cover: valid zip with mixed formats, corrupted zip, empty zip, nested folders (should be ignored).

- [ ] 33 — Unit tests for array pattern detection — cover: companion sheet naming, indexed column regex matching, JSON-in-cell confidence scoring, priority resolution when multiple patterns detected.

- [ ] 34 — Unit tests for companion sheet joining — cover: successful join on `_sourceDocId`, orphaned rows detection, referential integrity errors, index gaps (compact vs sparse).

- [ ] 35 — Unit tests for indexed tabular reconstruction — cover: grouped column parsing, element field discovery, type inference, nested depth consistency validation.

- [ ] 36 — Unit tests for JSON-in-cell parsing — cover: valid JSON arrays, mixed-type elements, empty cells, parse errors with error policy application.

- [ ] 37 — Unit tests for schema inference with arrays — cover: Required/Optional classification for array elements, combining patterns, conflict detection.

### Array Support — Import

> Tasks below extend Phase 3 with comprehensive array field support across three equally-primary patterns.
> All decisions are locked: companion sheets are first-priority, indexed tabular is second, JSON-in-cell is third; always-zip input format; reconstruction policies are user-configurable.

#### UI — Array Support

- [ ] A-IMP-UI-01 — Update the zip contents preview to show array field indicators per sheet

  Display array fields with pattern badges and source (companion file or column names). Example:
  ```
  ☑ orders.xlsx
     Rows: ~500
     ├─ Scalar fields: orderId, customer_name, total
     └─ Arrays:
        ├─ items (Companion Sheet from orders_items.xlsx)
        │  Element fields: sku, qty
        │  Estimated elements: 1,200 rows
        │
        └─ tags (Indexed Tabular)
           Element: scalar
           Indices detected: 0–2
  ```

- [ ] A-IMP-UI-02 — Build the array pattern resolution UI

  When multiple patterns detected for same array, show selector:
  ```
  Array field "items": Multiple patterns detected
    ● Use Companion Sheet (orders_items.csv)
    ○ Use Indexed Tabular (items[0], items[1])
    ○ Use JSON-in-Cell (items column)
  ```

- [ ] A-IMP-UI-03 — Add sparse/compact policy selector per array field

  Shown when index gaps are detected:
  ```
  items: Indexed Tabular — gaps detected (items[0], items[2])

  Index gaps:
    ● Compact     — Skip gaps, re-index: [item0, item2] → [0, 1]
    ○ Sparse      — Preserve gaps: [item0, null, item2]
  ```

- [ ] A-IMP-UI-04 — Add array element field management panel for companion sheets

  Show element fields with Required/Optional indicators and nesting tree:
  ```
  Array: items (Companion Sheet — orders_items.csv)

  Element fields:
    ☑ _sourceDocId   [string] ← system field, locked
    ☑ _arrayIndex    [number] ← system field, locked
    ☑ sku            [string] (Required)
    ☑ qty            [number] (Required)
    ☑ discount       [number] (Optional)
  ```

- [ ] A-IMP-UI-05 — Add array element field management panel for indexed tabular

  Show detected indices and grouped element fields:
  ```
  Array: items (Indexed Tabular)

  Indices detected: 0, 1, 2
  Element fields:
    ☑ sku     [string]
    ☑ qty     [number]
  ```

- [ ] A-IMP-UI-06 — Add array element field management panel for JSON-in-cell

  Show parsed structure with sample values:
  ```
  Array: items (JSON-in-Cell)

  Inferred structure (from 50 parsed samples):
    ☑ sku     [string]
    ☑ qty     [number]
    ☑ discount [number] (Optional)
  ```

- [ ] A-IMP-UI-07 — Update the schema tree view to show array element structure

  Arrays appear as collapsible nodes with nested element fields:
  ```
  ▼ (root)
    ├── orderId
    ▼ items        : array-of-objects [Companion Sheet]
    │   ├── sku    : string
    │   └── qty    : number
    └─ tags        : array-of-scalars [Indexed]
  ```

#### Logic — Array Support

- [ ] A-IMP-LOGIC-01 — Build the companion sheet detector and linker

  Scan all sheets in zip for `_sourceDocId` and `_arrayIndex` columns. Match to main sheet by naming convention (e.g., `orders.csv` + `orders_items.csv`). Validate referential integrity.

- [ ] A-IMP-LOGIC-02 — Build the indexed column parser and grouper

  Parse column names with regex `^([\w.]+)\[(\d+)\]\.(.+)$` and `^([\w.]+)\[(\d+)\]$`. Group by base path and index. Detect max index and gaps. Infer element schema per index position.

- [ ] A-IMP-LOGIC-03 — Build the JSON-in-cell detector with confidence scoring

  Scan column for JSON-like values (start with `[` or `{`). Try-parse 20-50 non-empty cells. Compute confidence ratio. If >80%, classify as JSON-in-cell. Return inferred element type (array-of-objects or array-of-scalars).

- [ ] A-IMP-LOGIC-04 — Build the array pattern priority resolver

  When multiple patterns detected for same field, apply priority order: Companion > Indexed > JSON-in-cell. Log diagnostic for conflicts. Use highest-priority pattern; ignore others.

- [ ] A-IMP-LOGIC-05 — Build the companion sheet join and reconstruction logic

  Load main sheet keyed by `_sourceDocId` (or row position if no `_id`). For each companion sheet, group rows by `_sourceDocId`. Sort by `_arrayIndex` within each group. Build array of element objects. Validate referential integrity; fail on orphaned rows.

- [ ] A-IMP-LOGIC-06 — Build the indexed column reconstruction logic

  For each source row, collect all indexed-column values grouped by base path and index. Apply reconstruction policy (Compact or Sparse). Build array from elements. Handle empty index slots per policy.

- [ ] A-IMP-LOGIC-07 — Build the JSON-in-cell string parser

  For each source cell value, attempt JSON.parse(). On success, validate element type matches inferred schema. On failure, apply error policy (Abort, Skip, or Convert). Log fallback conversions.

- [ ] A-IMP-LOGIC-08 — Extend the record-to-document transformer to handle arrays

  After scalar fields are mapped, attach reconstructed arrays using the selected pattern logic (join, group, or parse). Ensure final document structure matches schema contract.

- [ ] A-IMP-LOGIC-09 — Build the referential integrity validator for companion sheets

  Before import starts, scan all companion sheet `_sourceDocId` values and verify they exist in the main sheet. Report orphaned rows with line numbers. Allow user to proceed or abort.

- [ ] A-IMP-LOGIC-10 — Build the index gap analyzer and policy applicator

  Detect non-contiguous `_arrayIndex` values (companion) or indexed column indices (indexed tabular). Apply Compact (skip gaps) or Sparse (insert nulls) per user policy. Warn on policy choice.

#### Tests — Array Support

- [ ] A-IMP-TEST-01 — Unit tests for companion sheet detection and linking

  Cover: valid naming, missing main sheet, multiple companions per main, orphaned companions, referential integrity validation.

- [ ] A-IMP-TEST-02 — Unit tests for indexed column parsing and grouping

  Cover: regex matching, index ordering, element field inference, max-index detection, gap detection, nested depth consistency.

- [ ] A-IMP-TEST-03 — Unit tests for JSON-in-cell detection and parsing

  Cover: confidence scoring, valid JSON arrays, mixed types, empty cells, parse errors, fallback handling.

- [ ] A-IMP-TEST-04 — Unit tests for companion sheet joining and reconstruction

  Cover: successful joins, orphaned rows, index gaps (compact vs sparse), missing `_sourceDocId`, duplicate keys, sorting by index.

- [ ] A-IMP-TEST-05 — Unit tests for indexed column reconstruction

  Cover: column grouping, sparse/compact application, missing index slots, element ordering, nested depth validation.

- [ ] A-IMP-TEST-06 — Unit tests for full import transformation with arrays

  Cover: mixed pattern detection, schema inference, record-to-document with arrays, error policies, round-trip validation (export → re-import).

---

## Phase 3 — Import Feature

> Same UI-first principle as Phase 2. Each UI task is verified with mock data before the corresponding logic task is started.

### UI — Shell & File Selection

- [ ] 01 — Create the import webview shell — shows a destination type selector (Database or Collection), a zip file upload area with drag-and-drop and a file picker button, and file validation feedback. All driven by mock state at this stage.

  The first visible screen. Always requires a zip archive. Shows hint: "Package your CSV or Excel files in a zip archive."

  ```
  Import Data

  Destination:  ○ Database  ● Collection

  ┌────────────────────────────────────────┐
  │   Drop zip file here or [ Browse… ]    │
  │   (ℹ️ Package CSV/Excel in a zip first) │
  └────────────────────────────────────────┘

                                [ Proceed → ]
  ```

- [ ] 02 — Add the zip contents preview panel — appears after zip is uploaded. Detects all sheets, identifies array patterns (companion sheets, indexed tabular, JSON-in-cell), and shows a summary. For collection import displays single-file preview; for database import shows all-files preview.

  Extracted zip structure with auto-detected array patterns:

  ```
  📦 shop.zip (3 files)

  Collections detected:
    ☑ orders.xlsx
       Rows: ~500
       ├─ Scalar fields: orderId, customer_name, total
       └─ Arrays:
          ├─ items (from companion sheet orders_items.xlsx)
          │  Pattern: Companion Sheet
          │  Rows: ~1,200
          │  Element fields: sku, qty
          │
          └─ tags (from indexed columns tags[0], tags[1], tags[2])
             Pattern: Indexed Tabular
             Max elements per document: 3
             Element: scalar

  [Cancel]  [Next: Configure Collections]
  ```

- [ ] 03 — Wire the `documentdb.importData` command to open the Import webview panel and pass the selected destination context (collection or database name and path) into the webview.

  ```typescript
  const node = context.selectedItems[0] as CollectionTreeItem;
  ImportDataController.open({
    destinationType: 'collection',
    databaseName: node.databaseName,
    collectionName: node.collectionName,
  });
  ```

- [ ] 04 — Build the multi-collection selector for database imports — after zip preview, show all detected sheets with checkboxes to include/exclude and editable collection name fields. Display row count and array field hints per sheet.

  Shown after zip upload in database mode. Allows user to rename collections and exclude some sheets.

  ```
  Collections in shop.zip:
    ☑ orders.xlsx       → [orders   ]  (1200 rows, 2 array fields)
    ☑ products.xlsx     → [products ]  (500 rows, no arrays)
    ☐ archived.xlsx     → [archived ]  (100 rows, 1 array field) ← excluded

  [Cancel]  [Next: Configure]
  ```

### UI — Collection Import

- [ ] 05 — Build the source record viewer — shows the raw column-name-to-value pairs for the current preview record directly from the CSV or Excel file.

  Shows the raw data exactly as read from the file, before any mapping or transformation is applied. This is the "source truth" view.

  ```
  Record 1 of 25

  orderId        → 1001
  customer_name  → Ana
  total          → 45.5
  coupon         → (empty)
  ```

- [ ] 06 — Build the JSON document preview panel — shows the resulting document shape as formatted JSON, including reconstructed arrays. Updates live whenever the user changes field names, types, nesting, array reconstruction policy, or defaults. Driven by mock schema at this stage.

  The "destination truth" view. Updates in real time as the user edits the schema. This is what will be inserted into DocumentDB.

  ```json
  {
    "orderId": 1001,
    "customer": {
      "name": "Ana"
    },
    "total": 45.5
  }
  ```

  If the user renames `customer_name` → `customer.name` and changes type to `string`, the preview instantly shows the nested structure above.

- [ ] 07 — Build the preview navigation controls — Previous and Next buttons, a "Record N of M" counter, and a jump-to-record input so the user can step through the bounded preview records.

  Lets the user inspect different rows before committing to the mapping.

  ```
  [ ← Prev ]   Record 3 of 25   [ Next → ]   Jump to: [ 12 ]
  ```

- [ ] 08 — Build the schema editor field list — shows each mapped field with: an include/exclude checkbox, the source column name (read-only), an editable target field name, and an editable inferred-type badge (string / number / boolean / date / ObjectId / null). For array fields, show pattern badge (Companion Sheet / Indexed / JSON).

  The core mapping UI. The source column name is read-only (it comes from the file); everything else is editable.

  ```
  ☑  orderId        →  orderId        [number ▾]
  ☑  customer_name  →  customer.name  [string ▾]   ← renamed + dot-nested
  ☑  total          →  total          [number ▾]
  ☑  coupon         →  coupon         [string ▾]
  ☑  items          →  items          [array-of-objects] [Companion Sheet]
  ☑  tags           →  tags           [array-of-scalars] [Indexed Tabular]
  ```

- [ ] 09 — Build the nested hierarchy editor — a tree view of the resulting document shape. The user can drag a field into a parent node to nest it, add a new subdocument group, or remove/flatten a group. Array fields appear as collapsed nodes with element structure inside. Conflicting paths are highlighted in red.

  A visual tree of the target document shape. Users can restructure the document by dragging fields. Conflicts (e.g., `address` is both a scalar and a parent) are highlighted in red.

  ```
  ▼ (root)
    ├── orderId   : number
    ▼ customer
    │   └── name  : string   ← dragged here from flat list
    ├── total     : number
    ├── coupon    : string
    ▼ items       : array-of-objects [Companion Sheet]
    │   ├── sku   : string
    │   └── qty   : number
    └─ tags       : array-of-scalars [Indexed Tabular]

  ← If both "address" and "address.city" are mapped, "address" shows in red.
  ```

- [ ] 10 — Build the dot-notation inference control — a global on/off toggle that detects dots in source column names and proposes a nested structure. Each field with a dot shows a per-field override badge ("treat as literal name") to opt out of inference for that column.

  A global on/off toggle. When on, any column name containing a dot is split into a nested path. A per-field badge lets the user opt out for specific columns.

  ```
  [✓] Infer nesting from dots in column names

  customer.name  →  { customer: { name: … } }   ← inferred
  order.id       →  { order: { id: … } }          ← inferred

  User clicks [Treat as literal name] on "order.id":
  order.id       →  { "order.id": … }             ← stored as literal key
  ```

- [ ] 11 — Build the array reconstruction policy selector — shown for each array field. Offers two options: **Compact** (remove gaps, re-index 0, 1, 2) or **Sparse** (preserve gaps with null elements). Only appears if index gaps are detected in indexed tabular or companion sheet patterns.

  Shown inline when an array field has gaps (e.g., items[0], items[2] missing items[1]).

  ```
  items: array-of-objects [Indexed Tabular]
  Index gaps detected: items[0], items[2]

  Reconstruction policy:
    ● Compact     — Skip gaps, re-index to [0, 1]
    ○ Sparse      — Preserve gaps: [item0, null, item2]
  ```

- [ ] 12 — Build the missing-value config per field — shown inline in the schema editor for each field: a radio group with three options — **Omit field** (leave it out of the document), **Write null** (explicitly set to null), or **Use default** (enter a custom default value).

  Shown inline for each field. Controls what happens when a source row has an empty value for that column.

  ```
  coupon  [string]  When missing:  ● Omit field  ○ Write null  ○ Use default: [______]
  ```

  Example outcomes for a record where `coupon` is empty:
  - **Omit**: `{ orderId: 1, total: 5 }` — no `coupon` key inserted.
  - **Write null**: `{ orderId: 1, total: 5, coupon: null }`.
  - **Use default "NONE"**: `{ orderId: 1, total: 5, coupon: "NONE" }`.

- [ ] 13 — Build the error policy selector — a radio group with three options: **Abort on error** (stop immediately), **Skip invalid records** (continue, collect failures), and **Convert where possible** (attempt conversion, log fallbacks). Each option includes a note about what happens to records already written.

  Controls what happens when a record fails type conversion or the insert operation.

  ```
  On import error:
    ● Abort on error          — Stop immediately. Records written so far are kept.
    ○ Skip invalid records    — Continue. Failed records are collected and reported.
    ○ Convert where possible  — Try conversion; fall back to string. Log fallbacks.
  ```

  **Example:** a `total` column contains `"N/A"` instead of a number.
  - **Abort**: stops at that record. Reports row index and reason.
  - **Skip**: skips that record, continues with the rest, lists it in the final report.
  - **Convert**: stores `"N/A"` as a string and logs `{ field: "total", intended: "number", stored: "string" }`.

- [ ] 14 — Add the source file annotation label — shows the name of the uploaded zip file and, for database imports, the name of the sheet currently being configured, as a read-only label in the panel header.

  A read-only header label that keeps the user oriented, especially when configuring multiple sheets.

  ```
  Zip: shop.zip  |  Sheet: orders
  ```

### UI — Database Import

- [ ] 15 — Build the multi-sheet collection list — shows each sheet as a list item with a checkbox to include or exclude it, an editable collection name field, and array field indicator chips. Displays the sheet's row count as a hint.

  Lists all sheets from the uploaded zip. The collection name defaults to the sheet name but is editable.

  ```
  ☑  Sheet1 — orders    → [orders   ]  (1200 rows) [2 arrays]
  ☑  Sheet2 — returns   → [returns  ]  (45 rows)
  ☐  Sheet3 — archived  → [archived ]  (300 rows)  ← excluded
  ```

- [ ] 16 — Build the per-sheet configuration pane — clicking a sheet in the list opens the collection import UI (tasks 05–14) for that sheet in the main area.

  Clicking a sheet row opens the full Collection Import UI (tasks 05–14) for that sheet in the main panel. Each sheet maintains its own independent mapping configuration.

- [ ] 17 — Build the "proceed with selected collections" confirmation step — shows a summary of how many collections will be imported, a Proceed button, and a warning if no collections are selected.

  A confirmation gate before the import starts. The Proceed button is disabled and a warning is shown if zero collections are selected.

  ```
  2 collections will be imported:
    • orders  (1200 rows)
    • returns (45 rows)

  ⚠ 1 collection excluded (archived).

                            [ Proceed → ]
  ```

### UI — Validation Errors

- [ ] 16 — Build the validation error panel — shown after Proceed if the server finds problems with the uploaded file or destination. Groups errors by category (format, integrity, compatibility, size). Where possible, each error links to the relevant column or row number.

  Shown when server-side validation (task 23) returns errors. Grouped by category so users know what to fix.

  ```
  Validation failed. Fix the following before importing:

  Format errors (1)
    • Row 3, column "total": value "abc" cannot be converted to number.

  Size errors (1)
    • File exceeds maximum size of 100 MB.
  ```

### UI — Progress & Result

- [ ] 17 — Build the import progress panel — shows a progress bar, a live status message (e.g., "Importing record 120 of ~800 into orders"), and a Cancel button.

  ```
  Importing into orders…

  [████████████░░░░░░░░]  60%

  Importing record 720 of ~1200

  [ Cancel ]
  ```

- [ ] 18 — Build the import result summary panel — shows total records processed, successfully imported, skipped, and failed. For database imports, includes a per-collection breakdown. Provides a link to download a CSV report of the failed rows with their error reasons.

  The failure report CSV contains one row per failed source record with columns for `sourceRowIndex` and `reason`.

  ```
  ✓ Import complete

    Processed:  1200
    Imported:   1197
    Skipped:    2
    Failed:     1

  ▶ Per-collection breakdown
    orders:   1197 imported, 3 issues

  [ Download failure report (CSV) ]
  ```

### Logic — File Parsing

- [ ] 19 — Implement the CSV parser — auto-detects the delimiter (comma, semicolon, or tab), text encoding (UTF-8, UTF-8-BOM, or Latin-1), and handles quoted values that contain newlines. Extracts the header row and reads a bounded set of preview records.

  ```
  Input file (raw):
  orderId;customer_name;total
  1001;Ana;45.5
  "1002";"O'Brien, Mary";90

  Detected:  delimiter=;  encoding=UTF-8  quoted-newlines=yes

  Output:
    header       = ["orderId", "customer_name", "total"]
    previewRows  = [
      { orderId: "1001", customer_name: "Ana",           total: "45.5" },
      { orderId: "1002", customer_name: "O'Brien, Mary", total: "90"   },
    ]
  ```

- [ ] 20 — Implement the Excel parser — enumerates all worksheets, reads the header row from row 1, and converts each cell to a plain value (formulas → evaluated result, date serials → ISO string, blank cells → undefined). Reads a bounded set of preview records.

  ```
  Cell B2: formula =A2*1.1       →  evaluated to 49.5
  Cell C2: date serial 45383     →  "2024-03-15T00:00:00.000Z"
  Cell D2: blank                 →  undefined
  ```

- [ ] 21 — Implement the column name analyzer — given a list of header strings, detects which separator each column uses (`.`, `#`, `_`, or `:`), applies dot-notation inference, and produces the initial field mapping list.

  ```
  Headers: ["orderId", "customer.name", "customer.city", "order_date"]

  Dot-inference on:
    customer.name  →  path ["customer", "name"]
    customer.city  →  path ["customer", "city"]
    orderId        →  path ["orderId"]           ← no dot, stays flat
    order_date     →  path ["order_date"]        ← underscore not inferred by default
  ```

- [ ] 22 — Implement the duplicate and blank header handler — renames duplicate headers by appending `_1`, `_2`, etc., and replaces blank headers with `column_N`. Both issues are surfaced as warnings in the schema editor.

  ```
  Input headers:   ["name", "name", "", "total"]
  Output headers:  ["name", "name_1", "column_3", "total"]

  Warnings surfaced in schema editor:
    ⚠ Duplicate header "name" at column 2 renamed to "name_1"
    ⚠ Blank header at column 3 renamed to "column_3"
  ```

- [ ] 23 — Implement server-side file validation — checks the uploaded file before parsing: verifies format, file integrity (readable, not corrupted), compatibility with the chosen destination type, and file size within limits. Returns structured validation errors to the webview. (`importData.validateFile` tRPC mutation)

  Runs before any parsing. Returns structured errors so the validation panel (task 16) can display them.

  ```typescript
  // Response:
  {
    valid: false,
    errors: [
      { category: 'size',   message: 'File exceeds 100 MB limit', column: null, row: null },
      { category: 'format', message: 'File appears to be binary, not CSV', column: null, row: null },
    ]
  }
  ```

### Logic — Schema & Mapping

- [ ] 24 — Fetch the parsed file schema from the server — sends the file path and destination type; returns the initial field mapping list, a bounded set of preview records, and any header warnings. (`importData.parseFile` tRPC query)

  ```typescript
  const result = await trpc.importData.parseFile.query({ filePath, destinationType });
  // result.fieldMappings    ← initial mapping list (one entry per column)
  // result.previewRecords   ← first 25 records
  // result.warnings         ← duplicate/blank header warnings
  ```

- [ ] 25 — Build the type inference engine — samples the preview values for each column and suggests the most specific safe type: number (all values numeric), boolean (all true/false), date (all parseable ISO dates), or string (fallback).

  ```
  Column "total":    ["45.5", "90", "12.0"]       → all numeric   → infer number
  Column "paid":     ["true", "false", "true"]    → all boolean   → infer boolean
  Column "shipped":  ["2024-03-15", "N/A"]        → mixed         → infer string (fallback)
  ```

- [ ] 26 — Build the field mapping resolver — given the confirmed field mapping list, constructs a nested document path tree and a reusable function that transforms a source row into a target document.

  ```typescript
  // Mapping: customer_name → customer.name (string), total → total (number)
  const transform = buildTransform(mapping);

  transform({ customer_name: "Ana", total: "45.5" })
  // → { customer: { name: "Ana" }, total: 45.5 }
  ```

- [ ] 27 — Build the conflict detector — walks the path tree and flags cases where one path is a parent of another (e.g., `address` assigned a scalar while `address.city` is also mapped). Surfaces these as blocking errors in the schema editor.

  ```
  Paths: ["address", "address.city"]

  "address" is both a scalar leaf AND a parent node → CONFLICT (highlighted red)

  Paths: ["address.city", "address.zip"]  →  sibling paths, no conflict
  ```

- [ ] 28 — Connect the server schema response to the schema editor and source record viewer — replaces mock data with live parsed results.

  Replaces the mock field mappings and preview records with the live server response from task 24.

  ```typescript
  const mappings       = parseFileQuery.data?.fieldMappings   ?? MOCK_MAPPINGS;
  const previewRecords = parseFileQuery.data?.previewRecords  ?? MOCK_RECORDS;
  ```

### Logic — Import Task

- [ ] 29 — Start the import background task — validates the confirmed mapping, creates an extension task, and returns a task ID. Streams live progress events back to the webview. (`importData.startImport` tRPC mutation, collection destination)

  ```typescript
  const { taskId } = await trpc.importData.startImport.mutate({ config });
  // Extension host: validates mapping → creates Task → starts reading file → streams progress
  ```

- [ ] 30 — Build the record-to-document transformer — converts each source row into a target document by applying field renames, building nested paths, converting types, and applying the configured omit/null/default behavior for missing values.

  ```
  Source row:  { customer_name: "Ana", total: "45.5", coupon: "" }

  Mapping:
    customer_name → customer.name (string)
    total         → total (number)
    coupon        → coupon (string, missing policy = Omit)

  Output doc:  { customer: { name: "Ana" }, total: 45.5 }
               ← coupon omitted because value is empty and policy = Omit
  ```

- [ ] 31 — Implement the abort-on-error policy — on the first transformation or insert failure, stops the task immediately, returns the source row index and the error reason, and reports how many records were already written.

  ```
  Record 1: OK   → inserted
  Record 2: OK   → inserted
  Record 3: FAIL → task STOPS immediately.
                   Reports: "Record 3 failed: cannot convert 'N/A' to number. 2 records already written."
  ```

- [ ] 32 — Implement the skip-invalid-records policy — collects each failed row (source row index + error reason) while continuing to process valid rows. Includes the full failure list in the final summary.

  ```
  Record 1:   OK    → inserted
  Record 2:   FAIL  → collected, processing continues
  Record 3:   OK    → inserted
  …
  Final: 1197 imported, 3 skipped. Full failure list attached to result.
  ```

- [ ] 33 — Implement the convert-where-possible policy — attempts the configured type conversion for each value; if conversion fails, falls back to a string and logs the original value and intended type. Continues processing.

  ```
  Record 88, field "total": value "N/A" cannot be converted to number
    → stored as string "N/A"
    → log: { field: "total", intendedType: "number", actualValue: "N/A", storedAs: "string" }

  Processing continues. All fallbacks appear in the result summary.
  ```

- [ ] 34 — Implement the DocumentDB insert adapter — the real (non-stub) `IImportDestinationAdapter` that batch-inserts transformed documents into the target collection. Handles duplicate key errors and server throttling per the adapter contract.

  `ordered: false` lets the batch continue past duplicate key errors so the adapter can report them individually rather than stopping the entire batch.

  ```typescript
  class DocumentDBImportDestinationAdapter implements IImportDestinationAdapter {
    async insertBatch(docs: ImportDocument[]): Promise<InsertBatchResult> {
      const result = await collection.insertMany(docs, { ordered: false });
      return { insertedCount: result.insertedCount, errors: result.writeErrors ?? [] };
    }
  }
  ```

- [ ] 35 — Connect live import progress to the progress panel — updates the progress bar and status message each time the server emits a progress event. (`importData.taskProgress` tRPC subscription)

  ```typescript
  trpc.importData.taskProgress.subscribe({ taskId }, {
    onData(event) {
      setProgress({ current: event.recordsProcessed, total: event.estimatedTotal });
      setStatusMessage(`Importing record ${event.recordsProcessed} of ~${event.estimatedTotal}`);
    },
  });
  ```

- [ ] 36 — Wire the Cancel button — sends a cancellation signal to the running import task, propagates it to the insert adapter, and reports how many records were written before the task stopped. (`importData.cancelTask` mutation)

  ```typescript
  // Webview:
  await trpc.importData.cancelTask.mutate({ taskId });

  // Extension host: signals insert adapter to stop, reports:
  // "Cancelled after 720 records were written."
  ```

- [ ] 37 — Add telemetry for the import flow — emit events for: import started (source format, destination type, field count), import completed (record count, duration), import cancelled (records written so far), and import failed (error category).

  ```typescript
  telemetry.sendEvent('importData/started',   { sourceFormat: 'csv', destinationType: 'collection', fieldCount: 4 });
  telemetry.sendEvent('importData/completed', { recordCount: 1197, durationMs: 6800 });
  telemetry.sendEvent('importData/cancelled', { recordsWritten: 720 });
  telemetry.sendEvent('importData/failed',    { errorCategory: 'parse_error' });
  ```

### Logic — Database Import

- [ ] 38 — Fetch the sheet list from the server for a multi-sheet file — parses a multi-sheet Excel workbook or a multi-section CSV and returns each sheet as a named entry with its row count. (`importData.parseFileSheets` tRPC query)

  ```typescript
  const sheets = await trpc.importData.parseFileSheets.query({ filePath });
  // [
  //   { name: "orders",  rowCount: 1200 },
  //   { name: "returns", rowCount: 45   },
  // ]
  ```

- [ ] 39 — Connect the sheet list to the multi-sheet collection list UI — replaces the mock list with live data from the server.

  ```typescript
  const sheets = sheetsQuery.data ?? MOCK_SHEETS;
  ```

- [ ] 40 — Start a database-level import task — iterates over the selected collections in sequence, runs the collection-level import for each one, and combines the per-collection results into a single database-level summary. (`importData.startImport` tRPC mutation, database destination)

  ```
  Sheet "orders"  → collection "orders"  (1197 imported, 3 skipped)
  Sheet "returns" → collection "returns" (45 imported,   0 skipped)

  Database summary: 2 collections, 1242 total, 3 skipped.
  ```

### Tests

- [ ] 41 — Unit tests for the CSV parser — cover: comma, semicolon, and tab delimiters; quoted values containing newlines; UTF-8-BOM; empty fields; and a header-only file with no data rows.

  ```typescript
  expect(parseCsv('a,b\n1,2')).toEqual([{ a: '1', b: '2' }]);
  expect(parseCsv('a;b\n1;2')).toEqual([{ a: '1', b: '2' }]);       // semicolon
  expect(parseCsv('a\tb\n1\t2')).toEqual([{ a: '1', b: '2' }]);     // tab
  expect(parseCsv('"a\nb",c\n1,2')).toEqual([{ 'a\nb': '1', c: '2' }]);  // quoted newline
  expect(parseCsv('a,b\n')).toEqual([]);                             // header-only, no data rows
  ```

- [ ] 42 — Unit tests for the Excel parser — cover: formula cells evaluated to their result, date serial numbers converted to ISO strings, blank cells producing undefined, and correct enumeration of multiple worksheets.

  ```typescript
  expect(parseCell({ type: 'formula', result: 49.5 })).toBe(49.5);
  expect(parseCell({ type: 'date', value: 45383 })).toBe('2024-03-15T00:00:00.000Z');
  expect(parseCell({ type: 'blank' })).toBeUndefined();
  expect(getSheetNames(workbook)).toEqual(['orders', 'returns', 'archived']);
  ```

- [ ] 43 — Unit tests for the column name analyzer and dot-notation inference — cover: dots as nesting, dots retained as literal names (per-field override), mixed separators across columns, empty path segments, and repeated separators.

  ```typescript
  expect(analyze('customer.name')).toEqual(['customer', 'name']);
  expect(analyze('customer.name', { literal: true })).toEqual(['customer.name']);
  expect(analyze('a..b')).toEqual(['a', 'b']);       // empty segment between dots
  expect(analyze('order_date')).toEqual(['order_date']);  // underscore not inferred
  ```

- [ ] 44 — Unit tests for the record-to-document transformer — cover: all type conversions, nested path construction, conflicting path handling, omit/null/default behavior for missing values, and all three error policies.

  ```typescript
  expect(transform({ total: '45.5' }, [{ src: 'total', type: 'number' }])).toEqual({ total: 45.5 });
  expect(transform({ name: '' }, [{ src: 'name', missing: 'omit'    }])).toEqual({});
  expect(transform({ name: '' }, [{ src: 'name', missing: 'null'    }])).toEqual({ name: null });
  expect(transform({ name: '' }, [{ src: 'name', missing: 'default', default: 'N/A' }])).toEqual({ name: 'N/A' });
  ```

- [ ] 45 — Unit tests for the conflict detector — cover: ancestor/descendant path conflicts, sibling paths (no conflict), and deeply nested conflicts.

  ```typescript
  expect(detectConflicts(['address', 'address.city'])).toHaveLength(1);    // conflict
  expect(detectConflicts(['address.city', 'address.zip'])).toHaveLength(0); // siblings, no conflict
  expect(detectConflicts(['a.b.c', 'a.b'])).toHaveLength(1);               // deeply nested
  expect(detectConflicts(['a', 'b', 'c'])).toHaveLength(0);                // all flat, no conflict
  ```

---

## Phase 4 — Add Export feature to Atlas

> Extends the Export feature to work from the **Atlas Discovery view** (`release/0.10.0`). Depends on Atlas Discovery being merged into the main branch first.

- [ ] 01 — Identify which Atlas Discovery tree item types (cluster, database, collection) should expose the **Export Data** context menu action

  Review the Atlas Discovery tree item hierarchy and decide at which levels the "Export Data" action makes sense. Collection-level is required; database-level is optional (triggers a database export). Cluster-level is likely out of scope for the initial release.

- [ ] 02 — Register `documentdb.exportData` command on Atlas Discovery collection and database tree item context menus in `package.json`

  Add `when` clauses in `contributes.menus` that target Atlas Discovery tree item context IDs.

  ```json
  {
    "command": "documentdb.exportData",
    "when": "viewItem == atlasDiscovery.collection",
    "group": "data"
  }
  ```

- [ ] 03 — Implement `AtlasExportSourceAdapter`: wraps Atlas-specific document cursor/query into the `IExportSourceAdapter` interface; forwards active filters, projection, and limits from the source context

  The existing `DocumentDBExportSourceAdapter` uses a direct driver cursor. The Atlas variant uses the Atlas connection and forwards any active query filters the user has set in the Discovery view.

  ```typescript
  class AtlasExportSourceAdapter implements IExportSourceAdapter {
    constructor(private readonly context: AtlasSourceContext) {}

    async *openCursor(config: ExportConfig): AsyncIterable<Document> {
      const filter = this.context.activeFilter ?? {};
      const cursor = this.context.collection.find(filter).batchSize(200);
      for await (const doc of cursor) {
        yield doc;
      }
    }
  }
  ```

- [ ] 04 — Wire Atlas source context (selected cluster, database, collection, any active query filters) into `ExportConfig` when the command is invoked from the Discovery view

  The command handler reads the Atlas tree item's metadata and passes it as the `sourceContext` field of `ExportConfig`.

  ```typescript
  ExportDataController.open({
    sourceType: 'atlas-collection',
    clusterId:      node.clusterId,
    databaseName:   node.databaseName,
    collectionName: node.collectionName,
    activeFilter:   node.activeFilter ?? {},
  });
  ```

- [ ] 05 — Manual integration test: initiate export from an Atlas Discovery collection, verify full flow end-to-end (schema discovery → preview → export file written)

  Connect to a live Atlas cluster in the Discovery view, right-click a collection, choose "Export Data", configure fields, and verify the output file is written with the correct rows and column headers.

---

## Phase 5 — Add Import feature to Atlas

> Extends the Import feature to work from the **Atlas Discovery view**. Depends on Phase 4 and Atlas Discovery being merged.

- [ ] 01 — Identify which Atlas Discovery tree item types (cluster, database, collection) should expose the **Import Data** context menu action

  Same analysis as Phase 4 task 01 but for import. Collection-level is required; database-level enables multi-collection import.

- [ ] 02 — Register `documentdb.importData` command on Atlas Discovery collection and database tree item context menus in `package.json`

  ```json
  {
    "command": "documentdb.importData",
    "when": "viewItem == atlasDiscovery.collection",
    "group": "data"
  }
  ```

- [ ] 03 — Implement `AtlasImportDestinationAdapter`: wraps Atlas-specific document insert into the `IImportDestinationAdapter` interface; handles Atlas-specific throttling, conflict rules, and retry behavior

  Atlas may throttle write-heavy operations. The adapter wraps `insertMany` with exponential backoff and respects Atlas-specific write concern settings.

  ```typescript
  class AtlasImportDestinationAdapter implements IImportDestinationAdapter {
    async insertBatch(docs: ImportDocument[]): Promise<InsertBatchResult> {
      // Atlas may throttle; adapter retries with exponential backoff
      return withRetry(() =>
        this.collection.insertMany(docs, { ordered: false, writeConcern: { w: 'majority' } })
      );
    }
  }
  ```

- [ ] 04 — Wire Atlas destination context (selected cluster, database, collection) into `ImportConfig` when the command is invoked from the Discovery view

  ```typescript
  ImportDataController.open({
    destinationType: 'atlas-collection',
    clusterId:      node.clusterId,
    databaseName:   node.databaseName,
    collectionName: node.collectionName,
  });
  ```

- [ ] 05 — Manual integration test: import a CSV file into an Atlas Discovery collection, verify full flow end-to-end (parse → schema config → import → summary)

  Upload a CSV via the Import webview targeting a live Atlas collection in the Discovery view. Verify the documents appear in the collection and the result summary shows the correct counts.

---

## Task Count

| Phase                                     | Tasks |
| ----------------------------------------- | ----- |
| Phase 1 — Foundation                      | 12    |
| Phase 2 — Export Feature                  | 37    |
| Phase 2 — Array Support (Export)          | 25    |
| Phase 3 — Import Feature                  | 37    |
| Phase 3 — Array Support (Import)          | **36** ← NEW |
| Phase 4 — Add Export feature to Atlas     | 5     |
| Phase 5 — Add Import feature to Atlas     | 5     |
| **Total**                                 | **157** |
