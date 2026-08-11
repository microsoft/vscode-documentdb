# Feature Overview

## About the Feature

This feature adds CSV and Excel import/export to the DocumentDB VS Code extension through dedicated webview experiences for both flows.

Export lets users start from supported source contexts, confirm a fixed column contract, preview bounded output rows, and export with consistent field ordering, naming, and value conversion rules. Field discovery is advisory; users can include discovered fields, add known paths, and choose how to handle unexpected fields during export.

Import lets users load CSV/Excel data, review source records, define field mapping (including nested document paths), configure types and missing-value behavior, preview transformed JSON documents, and run import with clear row-level validation behavior.

For both import and export, preview behavior should match execution rules, support cancellation and progress for long-running tasks, and integrate with the extension task lifecycle (progress, errors, telemetry, and cleanup). The reusable implementation should remain database-neutral with adapter-based database-specific behavior.

---

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
2. Server analyzes the documents to:

   * Detect nested objects.
   * Identify inconsistent properties across documents.

### 2. Generate Export Schema

1. Server creates a unified export schema.
2. Property classification:

   * **Required Properties** – Properties present consistently across all documents.
   * **Optional Properties** – Properties that are inconsistent or exist only in some documents.
3. Server sends the generated schema to the client for preview.

### 3. Preview & Customize Columns

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

4. User reviews the final column preview and proceeds with the export.

---

## Database Export Workflow

### 1. Load Collections

1. Server retrieves all collections within the selected database.
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

1. Once all required collections have been configured, the user initiates the export.
2. Server exports each configured collection using its customized schema and formatting options.

---

## Import Data Feature

### 1. Initiate Import

1. User clicks **Import Data** on a selected source (Database or Collection).
2. Display the **Import Data** UI.
3. User:

   * Reviews the feature description.
   * Selects the destination type (**Database** or **Collection**).
   * Uploads the import file (CSV or Excel).
4. User clicks **Proceed**.
5. Server validates the request by checking:

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
* Database file uploaded for a Collection import (or vice versa).
* File size exceeds the allowed limit.

---

### Collection Import Workflow

#### 1. Parse File

1. Server parses the uploaded file.
2. Each column in the file is treated as a property.
3. Server analyzes the column names:

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

1. Server generates a sample schema from the parsed columns.
2. Server sends the schema to the client.
3. Client displays the schema preview.
4. User can customize the schema by:

   * Renaming properties.
   * Rearranging property hierarchy.
   * Moving properties between parent objects.
   * Converting flat properties into nested properties.
   * Flattening nested properties if required.

#### 3. Confirm Schema

1. User reviews the customized schema.
2. User clicks **Proceed**.
3. Client sends the updated schema to the server.

#### 4. Import Data

1. Server maps the uploaded data according to the customized schema.
2. Server transforms the data into the required document structure.
3. Server inserts the transformed documents into the selected collection within the database.
4. Server returns the import summary, including:

   * Total records processed.
   * Successfully imported records.
   * Failed records.
   * Validation or mapping errors (if any).

---

### Database Import Workflow

#### 1. Parse File

1. Server parses the uploaded CSV or Excel file.
2. Supported file structures:

   * Single-sheet file
   * Multi-sheet Excel workbook
3. Each worksheet is treated as an individual collection.

#### 2. Generate Database Structure

1. Server generates a Database → Collection hierarchy based on the uploaded file.
2. Server sends the generated structure to the client.

#### 3. Review & Customize Collections

1. Client displays the detected collections.
2. User can:

   * Select which collections to import.
   * Rename collection names.
   * Exclude collections from the import.
3. User clicks **Proceed**.

#### 4. Process Selected Collections

1. Client sends the selected collection configuration to the server.
2. For each selected collection, the server follows the **Collection Import Workflow**:

   * Parse collection data.
   * Generate the sample schema.
   * Allow schema customization.
   * Map data using the confirmed schema.
   * Import documents into the corresponding collection.

---

### Final Import Summary

1. After all selected collections have been processed:

   * Server imports the transformed data into the destination database.
   * Server generates an overall import summary, including:

     * Total collections processed.
     * Successfully imported collections.
     * Successfully imported documents.
     * Failed documents.
     * Collection-level validation or mapping errors.

