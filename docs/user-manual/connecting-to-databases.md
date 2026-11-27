---
title: 'Connecting to Databases'
parent: 'User Manual'
nav_order: 1
---

# Connecting to Databases

Connect to DocumentDB and MongoDB databases: with a URL or connection string, through service discovery in Azure, Kubernetes and MongoDB Atlas, or to a database running on your machine.

For Azure US Government, Azure China, or a custom cloud, see [Sovereign Clouds](./sovereign-clouds).

For Microsoft Entra ID account sign-in or managed identity, see [Trusted
Servers](./entra-id-trusted-servers) before trusting a custom service suffix.

## Recover from a failed connection

When expanding a cluster fails, a dialog explains the problem and the tree offers recovery actions.
The actions available depend on the connection and the failure:

1. **Update connection string…**, when offered, corrects the saved destination before you change credentials.
2. **Update credentials…**, when offered, lets you review the saved authentication.
3. **Diagnose connection…** opens [step-by-step connection diagnostics](./diagnose-connection).
4. **Open shell** opens the Interactive Shell for further investigation.
5. **Retry** tries the connection again after you have corrected or investigated the problem.

Retry is always last. These shorter labels apply to the recovery rows under a failed cluster;
context-menu and Command Palette titles can differ.

## Keep connections usable

The extension normally recovers from an expired Microsoft Entra ID token or an idle connection
without restarting VS Code. Silent recovery uses the account and tenant that established the
connection. It does not open a sign-in prompt from a background refresh.

If Microsoft sign-in can no longer be renewed, the tree offers **Retry sign-in**. The Interactive
Shell and Query Playground can instead offer **Sign in again**. Sign in with the identity originally
used for that connection. The old view is not moved to a different account.

## Disconnect and reconnect

Right-click a connected cluster and select **Disconnect** to end its live connections. If a copy,
export, or import is using the cluster, both the task and connection keep running. Select
**Disconnect** again after the task finishes or you stop it.

When open connection views exist and the setting `documentDB.connections.openTabsOnDisconnect` is
`ask`, the **Disconnect?** modal offers:

- **Close all**, which closes open connection views. Closing a dirty Document View first asks
  whether to **Discard changes**.
- **Keep open**, which keeps view contents but prevents database operations.

This choice applies to Collection View, Document View, and Cluster Dashboard tabs. It does not close
the Interactive Shell terminal or the Query Playground file; Disconnect stops their database
workers.

The setting can use `closeAll` or `keepOpenDisabled` as a default instead of showing the choice each
time. It never bypasses the unsaved-document confirmation. **Delete Connection…** uses the same
choice, but also removes the saved connection and its cached credentials.

A retained Collection View, Document View, or Cluster Dashboard is covered by a dialog that explains
why it is unavailable:

- Select **Retry** after repairing or reconnecting the connection. Retry checks the binding and
  does not replay the operation that failed.
- Select **Close view** to close the tab. A dirty Document View warns before closing.
- Use the **X** to dismiss the dialog when you need to inspect or copy view contents. Database operations stay
  disabled, and the next operation shows the dialog again.

Once **Retry** is offered, it remains available while that connection problem is unresolved,
even if the reason changes or you dismiss and reopen the dialog. Attempts still check the original
binding and cannot bypass a blocked connection or switch identity. After successful recovery,
a later problem can offer **Close view** only.

Use the cluster's **Reconnect** action in the tree to restore the same connection. If reconnect
automatically opens the retained Dashboard for that connection, it retries on its own. If it
stays disabled, select **Retry**, as you would in other retained webviews.

After reconnecting to the same connection with unchanged settings, run a command in the existing
Interactive Shell or run the retained Query Playground again. No new terminal or connection pick
is needed. The terminal scrollback and Playground text remain, but worker-local state such as
variables and open cursors is lost. Interrupted commands are not replayed.

## After changing connection details

Saving a change with **Update Credentials…** or **Update Connection String…** permanently disables
database operations in the existing Collection View, Document View, and Cluster Dashboard tabs.
This includes a password-only edit. Their contents remain available for inspection or copying.
Select **Close view** and open a new view from the tree to use the saved settings.

Shell and Playground follow different rules. If you choose to keep a running Shell connected when
prompted, its worker can continue using the previous settings. After a password-only edit, a new
worker can use the updated password in the existing terminal or Playground without a new connection
pick. To use a different host, user, or sign-in identity, open a new Shell or explicitly select the
connection again in the Playground. Cancelling an edit or saving unchanged settings does not lock
the open views.
