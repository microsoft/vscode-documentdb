> **User Manual** | [Manage Indexes in Collection View](./collection-view-index-management) | [Back to User Manual](../index#user-manual)

---

# Wildcard Indexes in Collection View

Wildcard indexes can be useful when documents in a collection have variable fields and query patterns are not known in advance. When query patterns are known, a targeted Standard index is usually easier to evaluate and maintain.

For detailed information about Wildcard index behavior and supported options, see the [Azure DocumentDB documentation](https://learn.microsoft.com/azure/documentdb/).

## Create a Wildcard index

1. Open the collection's **Indexes** tab.
2. Select **Create Index**.
3. Select **Wildcard**.
4. Choose the scope:
   - **All fields** creates an index using the `$**` key.
   - **Parent path** creates an index using a scoped key such as `metadata.$**`.
   - **Projection** lets you include or exclude selected paths from an all-fields Wildcard index.
5. Review the generated definition in **Preview as JSON**.
6. Select **Create Index**, or prepare the command in Playground or Shell first.

## Choose a scope

Use **All fields** when the index should cover fields throughout the document. Use **Parent path** when only one nested area of the document needs flexible indexing.

Use **Projection** to limit an all-fields Wildcard index to selected paths, or to exclude selected paths. An empty projection does not restrict the index.

## Review before creating

Wildcard indexes have different restrictions from Standard indexes. The form validates incompatible selections and shows the available choices for the selected scope.

Use **Preview as JSON** to verify the generated definition. Use Playground or Shell when you want to modify the generated command before running it.

## Related documentation

- [Manage Indexes in Collection View](./collection-view-index-management)
- [Vector Indexes in Collection View](./collection-view-vector-indexes)
- [Troubleshoot Index Management](./collection-view-index-management-troubleshooting)
