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
