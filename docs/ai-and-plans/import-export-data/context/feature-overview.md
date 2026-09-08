# Import and Export Data Feature

## Purpose

This feature adds database-neutral CSV and Excel import/export workflows to the DocumentDB VS Code extension. The architecture document is the source of truth for ownership, task lifecycle, adapter boundaries, validation, and execution behavior.

The initial database sources and destinations are Azure DocumentDB and Mongo-compatible collections through adapters. Future CLI and migration tools may consume the reusable schema-analyzer package directly; they must not depend on VS Code webview or `SchemaStore` APIs.

## Shared Analysis Model

Both database adapters provide documents and source metadata to the shared `SchemaAnalyzer`. The analyzer produces a database-neutral analysis snapshot containing discovered paths, nested structure, BSON/JSON types, occurrence information, array shapes, and diagnostics. The shared validation layer validates reconstructed import documents and compatibility with the analyzed or supplied schema.

`SchemaStore` is an extension-local cache of analyzer results keyed by stable cluster, database, and collection identifiers. It may support other VS Code surfaces, but import/export tasks use their own analysis snapshot and never use a mutable live cache as execution configuration.

The ownership boundary is layered:

1. Source adapters own database-specific reads, writes, metadata, retries, and throttling.
2. `SchemaAnalyzer` owns reusable document analysis and validation.
3. Import/export owns file formats, sheet layout, column mappings, array reconstruction, and operation contracts.
4. The user-confirmed `ExportSchema` or `ImportSchema` is the immutable contract for one operation.
5. `TaskService` owns progress, cancellation, cleanup, telemetry, and resource conflicts.

## Workflow

## Export Data Feature

### 1. Initiate Export

1. User clicks **Export Data** on a selected source (Database or Collection).
2. Display the **Export Data** UI.
3. User reviews the feature description and clicks **Proceed**.
4. Server determines whether the selected source is a **Database** or a **Collection**.

---

## Collection Export Workflow

### 1. Analyze Collection

1. Server retrieves all documents from the selected collection.
2. The source adapter streams a bounded sample through `SchemaAnalyzer`.
3. If analysis exceeds the bounded request budget, the router registers a `schema-analysis-collection` task with `TaskService`.
4. The analyzer produces the shared analysis snapshot used by the export pipeline to:

   * Detect nested objects.
   * Identify inconsistent properties across documents.
   * Infer BSON/JSON types and array shapes.
   * Report analysis and validation diagnostics.

### 2. Generate Export Schema

1. The export pipeline converts the `SchemaAnalyzer` snapshot into a unified `ExportSchema`.
2. Property classification:

   * **Required Properties** – Properties present consistently across all documents.
   * **Optional Properties** – Properties that are inconsistent or exist only in some documents.
3. Array fields are represented by array summary columns and companion-sheet schemas.
4. The server sends the generated schema and analysis diagnostics to the client for preview.

### 3. Preview and Customize Columns

1. Client displays the generated schema as the export preview.
2. By default:

   * Nested objects are flattened into column names.
3. User can customize the export by selecting **Nested Property** mode.

### Nested Property Customization

1. When the user selects **Nested Property** mode:

   * Display an input field for specifying a custom separator character (e.g., `.`, `_`, `#`, `:`).
2. User enters the preferred separator.
3. Client regenerates the preview using the selected separator.

**Example**

Default (Flattened):

```
addressCity
addressStreet
addressZip
```

Nested Property with "." separator:

```
address.city
address.street
address.zip
```

Nested Property with "_" separator:

```
address_city
address_street
address_zip
```

4. User reviews the final column preview and confirms the export contract.
5. The router validates and freezes the confirmed `ExportSchema` and `ExportConfig` before creating an export task.

### 4. Execute Collection Export

1. The router registers an `export-collection` task with `TaskService`.
2. The task streams documents through the source adapter and transforms them using the frozen contract.
3. The task writes the selected CSV or Excel format and applies the configured unexpected-field policy.
4. Progress, cancellation, cleanup, telemetry, and the terminal result are reported through `TaskService` and the tRPC task-status contract.

---

## Database Export Workflow

### 1. Load and Configure Collections

1. Server retrieves all collections within the selected database through the source adapter.
2. Server sends the collection list to the client.

### 2. Collection Selection

1. Client displays the collections in a left-hand navigation panel.
2. Each collection is initially marked with a **Pending** status.
3. User selects a collection to configure its export.

### 3. Configure Collection Export

1. The selected collection follows the **Collection Export Workflow**:

   * Analyze documents.
   * Detect nested objects and inconsistent properties.
   * Generate the export schema.
   * Preview columns.
   * Customize nested property formatting (optional).

2. After configuration is completed:

   * Mark the collection as **Configured** (or **Ready**).
   * Allow the user to continue configuring additional collections.

### 4. Final Export

1. Once the selected collections have confirmed contracts, the user initiates the export.
2. The router registers one `export-database` task with `TaskService`.
3. The task processes each configured collection using its immutable schema and formatting options.
4. The task owns temporary output and packages the collection results into the final ZIP.

---

## Import Data Feature

### 1. Initiate Import

1. User clicks **Import Data** on a selected source (Database or Collection).
2. Display the **Import Data** UI.
3. User:

   * Reviews the feature description.
   * Selects the destination type (**Database** or **Collection**).
   * Uploads a ZIP archive containing CSV or Excel files.
4. User clicks **Proceed**.
5. The server validates the request and, for large archives, registers `import-archive-inspection` with `TaskService` to perform extraction, validation, progress, and cleanup.
6. Validation checks:

   * Destination type (Database or Collection).
   * Uploaded file format.
   * File integrity and readability.
   * Whether the uploaded file is compatible with the selected destination type.

#### Validation Errors

The server should return appropriate validation errors for scenarios such as:

* Unsupported file format.
* Corrupted or unreadable file.
* Empty file.
* Missing header row.
* Invalid destination type.
* Archive contents are incompatible with the selected Collection or Database destination.
* File size exceeds the allowed limit.

---

### Collection Import Workflow

#### 1. Inspect and Parse the Archive

1. The file adapter inspects the ZIP and parses the selected CSV or Excel sheet.
2. Each column in the file is treated as a candidate property.
3. The adapter detects companion-sheet, indexed-tabular, and JSON-in-cell array patterns, with precedence Companion Sheet > Indexed Tabular > JSON-in-Cell.
4. Parsed rows and reconstructed array candidates are normalized into the shared analyzer input model.
5. `SchemaAnalyzer` analyzes the candidate documents and validates paths, types, required/optional fields, and array shapes.
6. The server analyzes the column names:

   * Flat column names are treated as top-level properties.
   * Column names containing supported separators (e.g., `.`, `_`, `#`, `:`) are interpreted as nested properties.

**Example**

Flat Columns:

```
name
email
phone
```

Nested Columns:

```
address.city
address.street
address.zip
```

Resulting Schema:

```json
{
  "address": {
    "city": "",
    "street": "",
    "zip": ""
  }
}
```

#### 2. Preview & Customize Schema

1. The pipeline converts the analyzer result and file-pattern diagnostics into an `ImportSchema` draft.
2. Server sends the schema, diagnostics, and bounded preview records to the client.
3. Client displays the schema preview.
4. User can customize the schema by:

   * Renaming properties.
   * Rearranging property hierarchy.
   * Moving properties between parent objects.
   * Converting flat properties into nested properties.
   * Flattening nested properties if required.

#### 3. Confirm Schema

1. User reviews the customized schema and array reconstruction policies.
2. User clicks **Proceed**.
3. Client sends the updated schema and import configuration to the server.
4. The router validates the mapping, path conflicts, destination, and policies, then freezes the confirmed `ImportSchema` and `ImportConfig`.

#### 4. Execute Collection Import

1. The router registers an `import-collection` task with `TaskService`.
2. The task reconstructs arrays and maps rows according to the frozen schema.
3. The shared analyzer validation layer validates each candidate document before insertion.
4. The destination adapter inserts valid documents in batches and reports provider-specific failures separately.
5. The task returns the import summary, including:

   * Total records processed.
   * Successfully imported records.
   * Failed records.
   * Validation or mapping errors (if any).

---

### Database Import Workflow

#### 1. Parse File

1. Server inspects the uploaded ZIP archive.
2. Supported file structures:

   * CSV files packaged in the ZIP
   * Single-workbook Excel archives
   * Multi-sheet Excel workbooks
3. Each selected file or worksheet is treated as an individual collection input.

#### 2. Generate Database Structure

1. Server generates a Database → Collection hierarchy based on the archive contents.
2. Server sends the generated structure to the client.

#### 3. Review & Customize Collections

1. Client displays the detected collections.
2. User can:

   * Select which collections to import.
   * Rename collection names.
   * Exclude collections from the import.
3. User clicks **Proceed**.

#### 4. Process Selected Collections

1. Client sends the selected collection configurations to the server.
2. The router registers one `import-database` task with `TaskService`.
3. For each selected collection, the task follows the **Collection Import Workflow**:

   * Parse collection data.
   * Generate the sample schema.
   * Allow schema customization.
   * Map data using the confirmed schema.
   * Import documents into the corresponding collection.

---

### Final Import Summary

1. After all selected collections have been processed:

   * The `import-database` task reports an overall result, including:

     * Total collections processed.
     * Successfully imported collections.
     * Successfully imported documents.
     * Failed documents.
     * Collection-level validation or mapping errors.

