> **User Manual** | [Manage Indexes in Collection View](./collection-view-index-management) | [Back to User Manual](../index#user-manual)

---

# Troubleshoot Index Management

This guide covers common issues when viewing or changing collection indexes.

## The index list does not load

Select **Refresh** to load the current index metadata again. Confirm that the connection can access the database and collection.

If the list loads but Size or Usage is unavailable, the server may not provide that statistic. Missing statistics do not necessarily prevent you from viewing or managing indexes.

## An index is creating or building

The tab shows **Creating** after the extension sends a create request. It shows **Building** while the server reports an active index build.

The tab refreshes while an active build is present. Wait for the status to become **Ready**, or use **Refresh** to request the current server state.

## Creating an index fails

Review the validation message in the Create Index drawer. Confirm that the selected index type and options are supported by the target server.

Select **Preview as JSON** to inspect the generated definition. You can also open the command in Playground or Shell, adjust it if necessary, and run it directly.

For supported index definitions and service requirements, see the [Azure DocumentDB documentation](https://learn.microsoft.com/azure/documentdb/).

## Hiding, unhiding, or deleting an index fails

The default `_id_` index cannot be hidden or deleted. Other actions can fail when the server does not support the requested operation, the current account lacks permissions, or the index state changed before the request completed.

Refresh the index list before trying again. If you are considering deletion, hide the index first to evaluate whether queries still require it.

## Size or usage is missing or zero

Size and Usage are server-reported statistics. Some servers or service configurations do not return them.

A Usage value of zero means the server has not recorded use of the index since it began tracking that statistic. It does not prove that the index is safe to delete. Consider query patterns, application workload, and a hide-and-evaluate step before deleting an index.

## Related documentation

- [Manage Indexes in Collection View](./collection-view-index-management)
- [Create Wildcard indexes](./collection-view-wildcard-indexes)
