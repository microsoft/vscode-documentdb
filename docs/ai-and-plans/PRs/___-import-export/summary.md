# Import and Export Data

Related issues:

- [#67: Import Data from CSV and Excel](https://github.com/microsoft/vscode-documentdb/issues/67)
- [#65: Export Data to CSV and Excel](https://github.com/microsoft/vscode-documentdb/issues/65)

## Summary

This work will add CSV and Excel import and export capabilities to the DocumentDB VS Code extension. Together, these features aim to make it easier to move data between local files and DocumentDB while supporting both simple tabular data and more complex document structures.

Import will cover reading file data, mapping it to document fields, previewing the result, and handling data types, missing values, nested structures, and invalid rows. Export will cover writing collection or query data to files, with options for selecting and filtering data, previewing the output, and representing nested objects and arrays.

The detailed scope, user experience, technical design, and implementation decisions will be developed through further discussion.

## Export Scope

Export should be delivered as a dedicated webview experience. It should support exports started from relevant extension contexts, including a collection and the results of a query, while presenting a consistent configuration and preview flow.

The core export experience should allow users to:

- Choose CSV or Excel as the output format.
- Choose the destination file name and location.
- Review fields discovered from available schema information and a bounded sample of the source data.
- Select, reorder, and rename fields for the output.
- Add field paths that were not discovered but are known to exist.
- Preview a configurable, bounded number of rows using the current export settings.
- Export either the applicable collection data or the filtered/query result represented by the source context.
- Cancel an export and see meaningful progress for long-running operations.

### Fixed Field Contract

Document collections may contain many shapes, so field discovery cannot guarantee that every field has been found before export begins. CSV and Excel output nevertheless require a stable column layout.

For the core implementation, the fields confirmed by the user should become a fixed export contract when the export starts. Discovery is advisory: the webview should make it clear that sampled fields may not represent every document in the source.

When a document contains a field outside that contract, users should be able to choose between:

- **Ignore unexpected fields:** Continue exporting only the selected fields. This should be the default behavior.
- **Abort on unexpected fields:** Stop the task so the user can review and update the field selection.

Missing selected fields should produce empty cells rather than changing the column layout. Writing unexpected values without matching headers should not be part of the core behavior because it can produce ambiguous or incompatible files.

### Preview

Preview must use the same selected fields, ordering, labels, and value conversion rules as the actual export. It is a bounded view of the resulting rows, not proof that the complete collection has a uniform schema. The precise default and maximum preview row counts should be proposed during implementation.

The preview should help users verify field choices and the representation of nested values, arrays, nulls, missing values, dates, numbers, and other database-specific value types before starting the task.

### Data Representation

The issue calls for handling nested objects, arrays, and field formatting. The implementation proposal should define a clear and consistent approach for:

- Selecting nested fields by path.
- Flattening nested objects or preserving them in a serialized form where appropriate.
- Representing arrays without creating ambiguous rows or columns.
- Distinguishing missing values from explicit `null` values when the target format permits it.
- Preserving dates, numbers, identifiers, and other database-specific values as faithfully as the selected format allows.
- Applying CSV-specific options such as delimiter, quoting, line endings, and encoding where needed.
- Respecting Excel format limits and type behavior.

These decisions should be presented by the implementer as part of the detailed design rather than prescribed here.

### Task and API Direction

The export operation should use the extension's task API for lifecycle management, progress, cancellation, error reporting, telemetry, cleanup, and resource tracking.

The reusable export API should remain database-neutral so it can potentially be shared with or adapted by other database extensions, including the Azure Cosmos DB extension. Database-specific concerns should be supplied through adapters rather than built into the general export workflow.

At a conceptual level, the design should separate:

- The source of documents or query results.
- The user-confirmed export configuration.
- Transformation of documents into rows with a fixed column contract.
- CSV- or Excel-specific output behavior.
- Task orchestration and reporting.

The exact interfaces, types, libraries, and file organization are left to the implementation proposal. The existing JSON import and export commands are not a design reference and do not need to be reused or preserved as part of this work.

### Dynamic Field Mode

A dynamic mode may be developed as an extension after the fixed-schema core is complete. In this mode, newly encountered fields could be appended as columns while the export runs.

This is intentionally outside the core scope because local files cannot generally grow their header in place without rewriting or staging output. CSV also raises compatibility questions when earlier rows do not contain trailing separators for columns discovered later. A robust version may require temporary files, a finalization pass, additional disk-space handling, and cleanup after cancellation or failure. Excel behavior will depend on the chosen streaming library and file-writing model.

The implementer may propose dynamic field discovery as follow-up work once the fixed-schema export is reliable. The proposal should explicitly address whether output is normalized, which tools can consume it, and how partial or temporary files are managed.

### Open Scope Questions

The detailed design should resolve:

- Which source contexts are supported in the first iteration and how their active filters, projections, sorting, limits, and query results are represented.
- Whether preview reads the first rows, sampled rows, or another bounded selection.
- Which nested-object and array representations are available for each format.
- Which CSV and Excel options are user-configurable versus fixed defaults.
- How progress is estimated when an exact result count is unavailable or expensive.
- What remains on disk after cancellation, failure, or an aborted unknown-field check.
- How very large exports handle memory use, disk space, format limits, and source changes during execution.

## Import Scope

Import should be delivered as a dedicated webview experience for configuring and reviewing data before it is written to a target collection. It should support CSV and Excel sources while allowing tabular input to be transformed into document-shaped data.

The core import experience should allow users to:

- Choose a CSV or Excel source file and, where applicable, the worksheet to import.
- Review detected headers and a bounded set of source records.
- Include or exclude input fields and rename their target fields.
- Arrange fields into the intended document and subdocument structure.
- Add or adjust mappings when automatic discovery does not produce the intended shape.
- Configure data types, conversions, and handling of missing or invalid values.
- Preview the transformed documents before starting the import.
- Choose how row-level validation or conversion failures are handled.
- Cancel an import and see meaningful progress for long-running operations.

### Source and Document Preview

The webview should present both the source record and the resulting JSON document shape. Users should be able to move backward and forward through the bounded preview records so they can see how the same mapping behaves with different values and missing fields.

Changes to field names, types, inclusion, defaults, or document structure should be reflected in the JSON preview. The preview must use the same transformation and validation rules as the actual import so that it represents what will be written rather than a separate approximation.

The preview is a bounded inspection tool and may not expose every value or error present in a large file. The exact preview size, navigation behavior, and file-reading strategy should be proposed during implementation.

### Document Shape and Field Mapping

Users should be able to control how input columns become document fields, including which fields form nested subdocuments. The experience should make the resulting hierarchy understandable and editable without requiring users to rewrite the source file.

The detailed design should cover:

- Mapping source headers to target field names or paths.
- Creating, removing, and rearranging subdocument groupings.
- Moving fields between the root document and nested subdocuments.
- Detecting conflicting mappings, such as assigning one value to `address` while also mapping values below `address`.
- Handling duplicate, blank, or otherwise ambiguous source headers.
- Representing arrays or other structures that do not map directly from a single tabular row.

The exact interaction model for editing the hierarchy is left to the implementer. It should prioritize a clear preview of the resulting document over exposing implementation syntax.

### Dot-Notation Inference

An automatic mode should detect dots in source field names and propose a nested document structure. For example, `address.street` and `address.city` could be interpreted as fields within an `address` subdocument.

This inference must remain visible and overridable because a dot may be intended as part of a literal field name. Users should be able to choose whether dot notation is interpreted as nesting, retain a field as a literal name where the target permits it, and adjust individual inferred mappings before import.

The implementation proposal should define how inference handles conflicting paths, repeated separators, empty path segments, arrays, and field names that the target database cannot store directly.

### Types, Missing Values, and Defaults

The import experience should support reviewing or selecting the expected type of each mapped field. Type inference should be treated as a suggestion based on the previewed data rather than a guarantee about the complete file.

Users should be able to define how missing and empty source values are represented, including omission, explicit `null`, or a configured default where appropriate. The design should also address conversions for strings, numbers, booleans, dates, identifiers, and other supported target values.

The implementer should propose how mixed-type columns, failed conversions, locale-sensitive values, and CSV-versus-Excel type differences are communicated and resolved.

### Validation and Error Handling

Before import starts, the webview should identify mapping and configuration errors that can be detected from the headers and preview. During import, errors may still be discovered in records outside the preview.

The core flow should consider policies such as:

- **Abort on error:** Stop when an invalid record or value is encountered.
- **Skip invalid records:** Continue importing valid records and report skipped records.
- **Convert where possible:** Apply configured conversions and report values that still cannot be converted.

The detailed proposal should define whether these policies can be combined, what information is retained for an error summary, and how users can identify source records that were not imported. Prompting for every failing record is unlikely to scale for large files and should only be included if a practical workflow is demonstrated.

The proposal should also address target-side failures such as duplicate identifiers, validation rules, throttling, connectivity loss, and partial imports. It must be clear which records may already have been written when an import is stopped or fails.

### Task and API Direction

The import operation should use the extension's task API for lifecycle management, progress, cancellation, error reporting, telemetry, and resource tracking.

As with export, the reusable import API should remain database-neutral so the file-reading, mapping, transformation, preview, and orchestration concepts can potentially be shared with or adapted by other database extensions. Database-specific insertion, validation, retry, and conflict behavior should be supplied through adapters.

At a conceptual level, the design should separate:

- Reading records and metadata from CSV or Excel files.
- The user-confirmed field mapping and document-shape configuration.
- Transforming and validating source records as documents.
- Previewing transformed documents.
- Writing documents through a database-specific destination.
- Task orchestration, progress, cancellation, and result reporting.

The exact interfaces, libraries, and implementation structure are left to the implementation proposal. The existing JSON import and export commands are not a design reference and do not need to be reused or preserved as part of this work.

### Open Scope Questions

The detailed design should resolve:

- How CSV dialect and encoding are detected or configured.
- How Excel worksheets, formulas, formatted values, dates, and blank cells are interpreted.
- How source records are identified in previews and error reports, including CSV records containing quoted newlines.
- How nested objects and arrays are constructed from tabular input.
- Which type inference and conversion rules are automatic versus explicitly configured.
- How destination conflicts and partial imports are handled and reported.
- How progress is estimated for large files and how cancellation interacts with buffered writes.
- Whether a reusable mapping configuration can be saved and applied to later imports.
