> **User Manual** | [Back to User Manual](../index#user-manual)

---

# Manage Indexes in Collection View

The **Indexes** tab in Collection View lets you inspect and manage indexes for the current collection. You can review index status and statistics, create Standard or Wildcard indexes, and hide, unhide, or delete indexes.

For information about index types, supported options, and index design, see the [Azure DocumentDB documentation](https://learn.microsoft.com/azure/documentdb/).

## Open the Indexes tab

Open a collection in Collection View, then select **Indexes**.

You can also double-click the collection's **Indexes** node in the Explorer. This opens Collection View directly on the Indexes tab. The Explorer context menu provides quick actions for an individual index.

## Inspect indexes

The metrics at the top of the tab summarize the indexes on the collection. The list below them shows each index and its current properties.

| Item       | Description                                                   |
| ---------- | ------------------------------------------------------------- |
| Name       | The index name. The default `_id_` index is always present.   |
| Type       | The index type reported by the server.                        |
| Properties | Options that apply to the index, when present.                |
| Size       | The server-reported storage used by the index.                |
| Usage      | The server-reported number of operations that used the index. |

Use the filter box and quick filters to narrow the list. Select a column heading to sort the list. Expand a row to inspect the index fields and full set of properties.

An index can have one of these states:

| State    | Meaning                                                                              |
| -------- | ------------------------------------------------------------------------------------ |
| Ready    | The index is available for use.                                                      |
| Creating | The create request has been sent and the extension is waiting for the server result. |
| Building | The server reports that the index build is still in progress.                        |

The tab refreshes while an index is creating or building. You can also select **Refresh** at any time.

## Create an index

1. Select **Create Index**.
2. Choose an index tab:
   - **Standard** for regular indexes on one or more fields.
   - **Wildcard** for an index that covers many fields in documents with variable shapes.
   - **Vector** for similarity search over embeddings.
3. Complete the required fields for the selected index type.
4. Select **Create Index**.

The drawer keeps less common settings under **Advanced**. Select **Preview as JSON** to review the generated index definition before you create it.

For Standard indexes, add more fields to create a compound index. The order of fields is part of the index definition.

For detailed guidance on choosing index types and options, see the [Azure DocumentDB documentation](https://learn.microsoft.com/azure/documentdb/).

## Manage an existing index

Each row has actions to manage the index. The extension asks for confirmation before it changes an index.

| Action | Use it when                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------ |
| Hide   | You want to test whether queries need the index without deleting it. A hidden index is not considered by query planning. |
| Unhide | You want to make a hidden index available to query planning again.                                                       |
| Delete | You no longer need the index. Consider hiding the index first when you want to evaluate its impact before deletion.      |

The default `_id_` index cannot be hidden or deleted.

## Use Playground or Shell instead

The Create Index drawer can prepare the generated command in a Query Playground or Interactive Shell instead of creating the index directly.

Use this path when you want to inspect or adjust the command before running it. The Interactive Shell is also useful when you want to interact directly with the collection after creating the index.

## Next steps

- [Create Wildcard indexes](./collection-view-wildcard-indexes)
- [Create Vector indexes](./collection-view-vector-indexes)
- [Troubleshoot Index Management](./collection-view-index-management-troubleshooting)
- [Collection View: Querying](./collection-view-querying)
