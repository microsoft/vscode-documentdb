> **User Manual** | [MongoDB Atlas Service Discovery](./service-discovery-mongodb-atlas) | [Back to User Manual](../index#user-manual)

---

# Browse and Connect to MongoDB Atlas

This guide explains how to browse resources that are visible to your stored MongoDB Atlas credentials and connect to a cluster.

## Browse the discovery tree

The default view is a hierarchy:

```text
v MongoDB Atlas
  v Example Organization
    v Production Project
      > orders-prod
      > inventory-prod
```

1. Expand **MongoDB Atlas** to load the organizations visible to your credentials.
2. Expand an organization to see its projects.
3. Expand a project to load its clusters.
4. Select a cluster to open it or save it as a connection.

Resources that are visible through more than one configured credential appear once. The extension uses a working credential for later discovery requests, such as listing the cluster's database users.

## Switch between tree and list views

Use the view action on the **MongoDB Atlas** root item or its context menu to change the view.

| View      | Contents                                                                             |
| --------- | ------------------------------------------------------------------------------------ |
| Tree view | Organizations, then projects, then clusters. This is the default.                    |
| List view | A flat list of clusters. Each cluster includes its `organization · project` context. |

The selected view is remembered for future sessions. Both views show the same clusters and recovery actions.

## Understand cluster status

Atlas can show a cluster before it is ready for a database connection. The extension keeps these clusters visible and adds a status label.

| Status        | Meaning                                                    |
| ------------- | ---------------------------------------------------------- |
| Paused        | Resume the cluster in MongoDB Atlas before connecting.     |
| Creating      | Atlas is provisioning the cluster.                         |
| Updating      | Atlas is applying a configuration or topology change.      |
| Repairing     | Atlas is repairing the cluster.                            |
| Deleting      | The cluster is being removed.                              |
| Unknown state | Atlas returned a state that the extension cannot classify. |

A cluster can be connected only when it is running, reports the `IDLE` state, and provides an Atlas connection string. If these conditions are not met, wait for the Atlas operation to finish or correct the cluster configuration in Atlas.

## Connect from the discovery tree

1. Locate a ready cluster in tree or list view.
2. Select the cluster or use its connection action.
3. When prompted, enter an Atlas database username and password.
4. Continue through the standard connection flow.

The extension may show database-user names that it can read through the Atlas Admin API. It does not retrieve database passwords. Enter the password for the selected database user.

## Connect from New Connection

You can create the same connection without first browsing the tree:

1. Start **New Connection**.
2. Select **Service Discovery**, then **MongoDB Atlas**.
3. Select a project and a ready cluster.
4. Enter the Atlas database username and password when prompted.
5. Finish the connection flow.

The project list includes a **Manage MongoDB Atlas Credentials** option. Select it when the project or cluster you need is not shown. After adding or updating a credential, start discovery again to load the updated resource list.

## Saved connections

After you save a discovered cluster, it appears in **DocumentDB Connections** like any other connection. You can work with the connection without reopening the discovery tree.

Changing or removing an Atlas discovery credential does not delete a saved connection. The saved connection still requires valid Atlas database credentials and network access.

## Next steps

- [Manage MongoDB Atlas credentials](./service-discovery-mongodb-atlas-credentials)
- [Troubleshoot MongoDB Atlas Service Discovery](./service-discovery-mongodb-atlas-troubleshooting)
