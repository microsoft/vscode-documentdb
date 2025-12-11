# Implementation Plan: Index Management Commands

## Overview

Implement three new index management commands for MongoDB collections:

- `vscode-documentdb.command.hideIndex` - Hide an index from query planner
- `vscode-documentdb.command.dropIndex` - Delete an index
- `vscode-documentdb.command.unhideIndex` - Unhide a previously hidden index

## Background: Command Architecture Investigation

### 1. Command Registration in `package.json`

Commands are registered in three sections of `package.json`:

#### A. **Command Declaration** (`contributes.commands`)

```json
{
  "//": "Delete Collection",
  "category": "DocumentDB",
  "command": "vscode-documentdb.command.dropCollection",
  "title": "Delete Collection…"
}
```

#### B. **Context Menu Integration** (`contributes.menus.view/item/context`)

```json
{
  "//": "[Collection] Drop collection",
  "command": "vscode-documentdb.command.dropCollection",
  "when": "view =~ /connectionsView|discoveryView|azure(ResourceGroups|FocusView)/ && viewItem =~ /\\btreeitem_collection\\b/i && viewItem =~ /\\bexperience_(documentDB|mongoRU)\\b/i",
  "group": "3@1"
}
```

**Key elements:**

- `when` clause determines visibility based on:
  - `view` - which tree view is active
  - `viewItem` - matches context value from tree item (uses regex)
- `group` - controls menu section and ordering (`section@priority`)

#### C. **Command Palette Hiding** (`contributes.menus.commandPalette`)

```json
{
  "command": "vscode-documentdb.command.dropCollection",
  "when": "never"
}
```

This prevents the command from appearing in the Command Palette (Ctrl+Shift+P).

### 2. Command Registration in Code

**Location:** `src/documentdb/ClustersExtension.ts`

```typescript
registerCommandWithTreeNodeUnwrapping('vscode-documentdb.command.dropCollection', deleteCollection);
```

**Two registration methods:**

- `registerCommand` - Direct command registration
- `registerCommandWithTreeNodeUnwrapping` - Automatically unwraps tree node from arguments

### 3. Command Folder Structure

Commands are organized in `src/commands/` with one folder per command:

```
src/commands/
  deleteCollection/
    deleteCollection.ts       # Command implementation
```

**Convention:**

- Folder name matches the command action (e.g., `deleteCollection`)
- Main file has same name as folder
- Each command is a self-contained module

### 4. `deleteCollection` Implementation Analysis

**File:** `src/commands/deleteCollection/deleteCollection.ts`

**Key patterns:**

#### A. Function Signature

```typescript
export async function deleteCollection(context: IActionContext, node: CollectionItem): Promise<void>;
```

- Takes `IActionContext` for telemetry
- Takes tree node as second parameter (unwrapped automatically)

#### B. Validation

```typescript
if (!node) {
  throw new Error(l10n.t('No node selected.'));
}
```

#### C. Telemetry

```typescript
context.telemetry.properties.experience = node.experience.api;
```

#### D. Confirmation Dialog

```typescript
const confirmed = await getConfirmationAsInSettings(
  l10n.t('Delete "{nodeName}"?', { nodeName: node.collectionInfo.name }),
  message + '\n' + l10n.t('This cannot be undone.'),
  node.collectionInfo.name, // Word to type for confirmation
);

if (!confirmed) {
  return;
}
```

**Three confirmation styles** (user-configurable):

1. **Word Confirmation** - User types the name
2. **Challenge Confirmation** - User solves a math problem
3. **Button Confirmation** - Simple Yes/No buttons

#### E. Progress Indicator with `showDeleting`

```typescript
const client = await ClustersClient.getClient(node.cluster.id);

let success = false;
await ext.state.showDeleting(node.id, async () => {
  success = await client.dropCollection(node.databaseInfo.name, node.collectionInfo.name);
});
```

**What `showDeleting` does:**

- Sets a temporary "description" on the tree item showing "Deleting..."
- Executes the async operation
- Automatically clears the description when done
- Part of `TreeElementStateManager` from `@microsoft/vscode-azext-utils`

#### F. Success Message

```typescript
if (success) {
  showConfirmationAsInSettings(successMessage);
}
```

#### G. Tree Refresh

```typescript
finally {
    const lastSlashIndex = node.id.lastIndexOf('/');
    let parentId = node.id;
    if (lastSlashIndex !== -1) {
        parentId = parentId.substring(0, lastSlashIndex);
    }
    ext.state.notifyChildrenChanged(parentId);
}
```

Notifies the parent node to refresh its children.

### 5. Index Tree Item Context

**File:** `src/tree/documentdb/IndexItem.ts`

**Context Value:**

```typescript
public contextValue: string = 'treeItem_index';
private readonly experienceContextValue: string = '';

constructor(...) {
    this.experienceContextValue = `experience_${this.experience.api}`;
    this.contextValue = createContextValue([this.contextValue, this.experienceContextValue]);
}
```

**Result:** `treeItem_index experience_documentDB` (or `experience_mongoRU`)

**Index Information Available:**

```typescript
readonly indexInfo: IndexItemModel {
    name: string;
    type: 'traditional' | 'search';
    key?: { [key: string]: number | string };
    version?: number;
    unique?: boolean;
    sparse?: boolean;
    background?: boolean;
    hidden?: boolean;              // ← Important for hide/unhide
    expireAfterSeconds?: number;
    partialFilterExpression?: Document;
    // ...
}
```

### 6. ClustersClient API Methods

**File:** `src/documentdb/ClustersClient.ts`

**Available methods:**

```typescript
async hideIndex(databaseName: string, collectionName: string, indexName: string): Promise<Document>

async dropIndex(databaseName: string, collectionName: string, indexName: string): Promise<DropIndexResult>

async unhideIndex(databaseName: string, collectionName: string, indexName: string): Promise<Document>
```

---

## Implementation Plan

### Phase 1: Command Structure Setup

#### 1.1 Create Command Folders and Files

Create three new command folders with implementations:

```
src/commands/
  hideIndex/
    hideIndex.ts
  dropIndex/
    dropIndex.ts
  unhideIndex/
    unhideIndex.ts
```

#### 1.2 Update `package.json` - Commands Section

Add three command declarations in `contributes.commands`:

```json
{
  "//": "Hide Index",
  "category": "DocumentDB",
  "command": "vscode-documentdb.command.hideIndex",
  "title": "Hide Index…"
},
{
  "//": "Delete Index",
  "category": "DocumentDB",
  "command": "vscode-documentdb.command.dropIndex",
  "title": "Delete Index…"
},
{
  "//": "Unhide Index",
  "category": "DocumentDB",
  "command": "vscode-documentdb.command.unhideIndex",
  "title": "Unhide Index"
}
```

#### 1.3 Update `package.json` - Context Menu Section

Add menu items in `contributes.menus.view/item/context` for index items:

```json
{
  "//": "[Index] Hide Index",
  "command": "vscode-documentdb.command.hideIndex",
  "when": "view =~ /connectionsView|discoveryView|azure(ResourceGroups|FocusView)/ && viewItem =~ /\\btreeitem_index\\b/i && viewItem =~ /\\bexperience_(documentDB|mongoRU)\\b/i",
  "group": "2@1"
},
{
  "//": "[Index] Unhide Index",
  "command": "vscode-documentdb.command.unhideIndex",
  "when": "view =~ /connectionsView|discoveryView|azure(ResourceGroups|FocusView)/ && viewItem =~ /\\btreeitem_index\\b/i && viewItem =~ /\\bexperience_(documentDB|mongoRU)\\b/i",
  "group": "2@2"
},
{
  "//": "[Index] Delete Index",
  "command": "vscode-documentdb.command.dropIndex",
  "when": "view =~ /connectionsView|discoveryView|azure(ResourceGroups|FocusView)/ && viewItem =~ /\\btreeitem_index\\b/i && viewItem =~ /\\bexperience_(documentDB|mongoRU)\\b/i",
  "group": "3@1"
}
```

**Note:** Group `2@x` for hide/unhide (modification), group `3@x` for delete (destructive).

#### 1.4 Update `package.json` - Command Palette Hiding

Add entries to hide commands from Command Palette:

```json
{
  "command": "vscode-documentdb.command.hideIndex",
  "when": "never"
},
{
  "command": "vscode-documentdb.command.dropIndex",
  "when": "never"
},
{
  "command": "vscode-documentdb.command.unhideIndex",
  "when": "never"
}
```

### Phase 2: Command Implementation

#### 2.1 Implement `hideIndex.ts`

**File:** `src/commands/hideIndex/hideIndex.ts`

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ext } from '../../extensionVariables';
import { type IndexItem } from '../../tree/documentdb/IndexItem';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';

export async function hideIndex(context: IActionContext, node: IndexItem): Promise<void> {
  if (!node) {
    throw new Error(l10n.t('No index selected.'));
  }

  context.telemetry.properties.experience = node.experience.api;
  context.telemetry.properties.indexName = node.indexInfo.name;

  // Prevent hiding the _id index
  if (node.indexInfo.name === '_id_') {
    throw new Error(l10n.t('The _id index cannot be hidden.'));
  }

  // Check if already hidden
  if (node.indexInfo.hidden) {
    throw new Error(l10n.t('Index "{indexName}" is already hidden.', { indexName: node.indexInfo.name }));
  }

  const message = l10n.t(
    'Hide index "{indexName}" from collection "{collectionName}"? This will prevent the query planner from using this index.',
    {
      indexName: node.indexInfo.name,
      collectionName: node.collectionInfo.name,
    },
  );
  const successMessage = l10n.t('Index "{indexName}" has been hidden.', { indexName: node.indexInfo.name });

  const confirmed = await getConfirmationAsInSettings(
    l10n.t('Hide index "{indexName}"?', { indexName: node.indexInfo.name }),
    message,
    node.indexInfo.name,
  );

  if (!confirmed) {
    return;
  }

  try {
    const client = await ClustersClient.getClient(node.cluster.id);

    let result: Document | null = null;
    await ext.state.showUpdating(node.id, async () => {
      result = await client.hideIndex(node.databaseInfo.name, node.collectionInfo.name, node.indexInfo.name);
    });

    if (result) {
      showConfirmationAsInSettings(successMessage);
    }
  } finally {
    // Refresh parent (collection's indexes folder)
    const lastSlashIndex = node.id.lastIndexOf('/');
    let parentId = node.id;
    if (lastSlashIndex !== -1) {
      parentId = parentId.substring(0, lastSlashIndex);
    }
    ext.state.notifyChildrenChanged(parentId);
  }
}
```

**Key differences from deleteCollection:**

- Requires confirmation (user must confirm the action)
- Uses `ext.state.showUpdating` instead of `showDeleting`
- Validates that index is not already hidden
- Prevents hiding `_id_` index

#### 2.2 Implement `unhideIndex.ts`

**File:** `src/commands/unhideIndex/unhideIndex.ts`

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ext } from '../../extensionVariables';
import { type IndexItem } from '../../tree/documentdb/IndexItem';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';

export async function unhideIndex(context: IActionContext, node: IndexItem): Promise<void> {
  if (!node) {
    throw new Error(l10n.t('No index selected.'));
  }

  context.telemetry.properties.experience = node.experience.api;
  context.telemetry.properties.indexName = node.indexInfo.name;

  // Check if index is actually hidden
  if (!node.indexInfo.hidden) {
    throw new Error(l10n.t('Index "{indexName}" is not hidden.', { indexName: node.indexInfo.name }));
  }

  const message = l10n.t(
    'Unhide index "{indexName}" from collection "{collectionName}"? This will allow the query planner to use this index again.',
    {
      indexName: node.indexInfo.name,
      collectionName: node.collectionInfo.name,
    },
  );
  const successMessage = l10n.t('Index "{indexName}" has been unhidden.', { indexName: node.indexInfo.name });

  const confirmed = await getConfirmationAsInSettings(
    l10n.t('Unhide index "{indexName}"?', { indexName: node.indexInfo.name }),
    message,
    node.indexInfo.name,
  );

  if (!confirmed) {
    return;
  }

  try {
    const client = await ClustersClient.getClient(node.cluster.id);

    let result: Document | null = null;
    await ext.state.showUpdating(node.id, async () => {
      result = await client.unhideIndex(node.databaseInfo.name, node.collectionInfo.name, node.indexInfo.name);
    });

    if (result) {
      showConfirmationAsInSettings(successMessage);
    }
  } finally {
    // Refresh parent (collection's indexes folder)
    const lastSlashIndex = node.id.lastIndexOf('/');
    let parentId = node.id;
    if (lastSlashIndex !== -1) {
      parentId = parentId.substring(0, lastSlashIndex);
    }
    ext.state.notifyChildrenChanged(parentId);
  }
}
```

#### 2.3 Implement `dropIndex.ts`

**File:** `src/commands/dropIndex/dropIndex.ts`

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ext } from '../../extensionVariables';
import { type IndexItem } from '../../tree/documentdb/IndexItem';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';

export async function dropIndex(context: IActionContext, node: IndexItem): Promise<void> {
  if (!node) {
    throw new Error(l10n.t('No index selected.'));
  }

  context.telemetry.properties.experience = node.experience.api;
  context.telemetry.properties.indexName = node.indexInfo.name;

  // Prevent deleting the _id index
  if (node.indexInfo.name === '_id_') {
    throw new Error(l10n.t('The _id index cannot be deleted.'));
  }

  const message = l10n.t('Delete index "{indexName}" from collection "{collectionName}"?', {
    indexName: node.indexInfo.name,
    collectionName: node.collectionInfo.name,
  });
  const successMessage = l10n.t('Index "{indexName}" has been deleted.', { indexName: node.indexInfo.name });

  const confirmed = await getConfirmationAsInSettings(
    l10n.t('Delete index "{indexName}"?', { indexName: node.indexInfo.name }),
    message + '\n' + l10n.t('This cannot be undone.'),
    node.indexInfo.name,
  );

  if (!confirmed) {
    return;
  }

  try {
    const client = await ClustersClient.getClient(node.cluster.id);

    let result: { ok: number } | null = null;
    await ext.state.showDeleting(node.id, async () => {
      const dropResult = await client.dropIndex(node.databaseInfo.name, node.collectionInfo.name, node.indexInfo.name);
      result = dropResult.ok ? { ok: 1 } : null;
    });

    if (result && result.ok === 1) {
      showConfirmationAsInSettings(successMessage);
    }
  } finally {
    // Refresh parent (collection's indexes folder)
    const lastSlashIndex = node.id.lastIndexOf('/');
    let parentId = node.id;
    if (lastSlashIndex !== -1) {
      parentId = parentId.substring(0, lastSlashIndex);
    }
    ext.state.notifyChildrenChanged(parentId);
  }
}
```

**Key features:**

- Requires confirmation (destructive action)
- Uses `ext.state.showDeleting` for progress
- Prevents deleting `_id_` index
- Uses confirmation word matching the index name

### Phase 3: Command Registration

#### 3.1 Update `ClustersExtension.ts`

**File:** `src/documentdb/ClustersExtension.ts`

Add imports at the top:

```typescript
import { dropIndex } from '../commands/dropIndex/dropIndex';
import { hideIndex } from '../commands/hideIndex/hideIndex';
import { unhideIndex } from '../commands/unhideIndex/unhideIndex';
```

Add registrations (around line 284, near other command registrations):

```typescript
registerCommandWithTreeNodeUnwrapping('vscode-documentdb.command.hideIndex', hideIndex);
registerCommandWithTreeNodeUnwrapping('vscode-documentdb.command.unhideIndex', unhideIndex);
registerCommandWithTreeNodeUnwrapping('vscode-documentdb.command.dropIndex', dropIndex);
```

### Phase 4: Progress Indicator Enhancement

#### 4.1 Verify `TreeElementStateManager` Methods

Check if `showUpdating` exists. If not, use alternatives:

**Option A:** Use `showUpdating` if available:

```typescript
await ext.state.showUpdating(node.id, async () => {
  // operation
});
```

**Option B:** Use `showCreatingChild` or custom description:

```typescript
await ext.state.showCreatingChild(node.id, 'Hiding index...', async () => {
  // operation
});
```

**Option C:** Manual description management:

```typescript
try {
    ext.state.notifyChangedData(node.id, { description: 'Hiding...' });
    await client.hideIndex(...);
} finally {
    ext.state.notifyChangedData(node.id, { description: undefined });
}
```

### Phase 5: Smart Context Menu (Optional Enhancement)

#### 5.1 Dynamic Menu Visibility

To show only relevant commands (hide when hidden, unhide when not hidden):

**Add to `IndexItem.ts`:**

```typescript
constructor(...) {
    // Existing code...

    // Add hidden state to context
    if (this.indexInfo.hidden) {
        this.contextValue = createContextValue([
            this.contextValue,
            this.experienceContextValue,
            'hidden'
        ]);
    }
}
```

**Update `package.json` menus:**

```json
{
  "//": "[Index] Hide Index",
  "command": "vscode-documentdb.command.hideIndex",
  "when": "view =~ /connectionsView|discoveryView/ && viewItem =~ /\\btreeitem_index\\b/i && !(viewItem =~ /\\bhidden\\b/i)",
  "group": "2@1"
},
{
  "//": "[Index] Unhide Index",
  "command": "vscode-documentdb.command.unhideIndex",
  "when": "view =~ /connectionsView|discoveryView/ && viewItem =~ /\\btreeitem_index\\b/i && viewItem =~ /\\bhidden\\b/i",
  "group": "2@1"
}
```

This ensures:

- "Hide Index" only shows when index is NOT hidden
- "Unhide Index" only shows when index IS hidden

### Phase 6: Testing Checklist

#### 6.1 Manual Testing

Test each command with:

- ✅ Regular index (non-\_id)
- ✅ Hidden index (for unhide)
- ✅ Visible index (for hide)
- ✅ \_id index (should fail appropriately)
- ✅ MongoDB RU experience
- ✅ DocumentDB experience

#### 6.2 Confirmation Styles

Test dropIndex with all three confirmation styles:

- ✅ Word Confirmation
- ✅ Challenge Confirmation
- ✅ Button Confirmation

#### 6.3 Progress Indicators

Verify:

- ✅ "Deleting..." appears during dropIndex
- ✅ "Updating..." (or equivalent) appears during hide/unhide
- ✅ Description clears after operation
- ✅ Tree refreshes automatically

#### 6.4 Error Cases

Test:

- ✅ Cancel confirmation (dropIndex)
- ✅ Hide already hidden index
- ✅ Unhide already visible index
- ✅ Try to hide/drop \_id index
- ✅ Network/connection errors

### Phase 7: Documentation

#### 7.1 Add to l10n

Run localization extraction:

```bash
npm run l10n
```

This will extract all `l10n.t()` strings to `l10n/bundle.l10n.json`.

#### 7.2 Update CHANGELOG.md

Add entry:

```markdown
### Added

- Index management commands: Hide Index, Unhide Index, Delete Index
- Context menu options on index items for index operations
- Progress indicators during index operations
```

---

## Summary of Files to Create/Modify

### New Files (3)

1. `src/commands/hideIndex/hideIndex.ts`
2. `src/commands/unhideIndex/unhideIndex.ts`
3. `src/commands/dropIndex/dropIndex.ts`

### Modified Files (3)

1. `package.json` - Add command declarations, menus, and command palette hiding
2. `src/documentdb/ClustersExtension.ts` - Register commands
3. `src/tree/documentdb/IndexItem.ts` - (Optional) Add hidden state to context value

### Generated Files (1)

1. `l10n/bundle.l10n.json` - Updated via `npm run l10n`

---

## Command Summary Table

| Command     | Confirmation | Progress State | Reversible | Destructive | Can Apply to \_id     |
| ----------- | ------------ | -------------- | ---------- | ----------- | --------------------- |
| hideIndex   | Yes          | "Updating..."  | Yes        | No          | No                    |
| unhideIndex | Yes          | "Updating..."  | Yes        | No          | N/A (can't hide \_id) |
| dropIndex   | Yes          | "Deleting..."  | No         | Yes         | No                    |

---

## Implementation Order

1. ✅ Create command files (hideIndex, unhideIndex, dropIndex)
2. ✅ Update package.json (commands, menus, commandPalette)
3. ✅ Register commands in ClustersExtension.ts
4. ✅ Test basic functionality
5. ✅ Add smart context menu (optional)
6. ✅ Run l10n extraction
7. ✅ Update CHANGELOG.md
8. ✅ Full testing cycle

---

## Notes for Implementation

- **Use `nonNullProp` and `nonNullValue`** helpers from project guidelines for null safety
- **Follow TypeScript strict mode** - no `any` types
- **Use `l10n.t()` for all user-facing strings** for localization
- **Telemetry properties** should include `experience` and `indexName`
- **Error messages** should be clear and actionable
- **Progress indicators** improve UX for potentially slow operations
- **Tree refresh** is critical to show updated state

---

## Future Enhancements (Not in This Plan)

- Bulk operations (hide/delete multiple indexes)
- Index rebuild command
- Index statistics visualization
- Index usage recommendations
- Visual index builder/editor
