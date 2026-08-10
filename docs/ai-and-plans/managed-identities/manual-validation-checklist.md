# Managed Identity: Manual Validation Checklist

**For:** whoever holds the Azure VM repro.
**Scope:** Azure VMs only, per [D0](./decisions.md#d0-supported-platforms-azure-vms-only).
**Plan:** [`managed-identities.md`](./managed-identities.md) &middot; **Log:** [`implementation-log.md`](./implementation-log.md)

Automated tests cover the shapes of things: the connection string round-trip, the storage round-trip,
the error classification against a fake identity endpoint. What they cannot cover is a real instance
metadata service, a real Entra ID token, and a real cluster deciding whether to accept it. That is
what this list is for.

---

## Setup

You need, at minimum:

- An **Azure VM** with VS Code and this extension installed.
- An Azure DocumentDB (vCore) cluster reachable from that VM, with Microsoft Entra ID authentication
  allowed.
- At least one managed identity **registered on the cluster** as a user. Assigning an identity to the
  VM is not enough on its own; see
  [role-based access control](https://learn.microsoft.com/azure/documentdb/how-to-connect-role-based-access-control).

To cover everything below you will want to move the VM through three identity configurations:
system-assigned only, one user-assigned, and two or more identities at once.

Record the extension version and the VM identity configuration next to each result. A pass on a VM
with one identity says nothing about a VM with three, which is the configuration that produced the
original incident.

---

## Identity resolution

| #   | Case                                                              | Expected                                                                                            | Result |
| --- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------ |
| 1   | VM with **only** a system-assigned identity, no client ID entered | Connects.                                                                                           | ☐      |
| 2   | VM with **one** user-assigned identity, no client ID entered      | Connects.                                                                                           | ☐      |
| 3   | VM with **two or more** identities, no client ID entered          | Fails with "This machine has more than one managed identity...". **This is the reported incident.** | ☐      |
| 4   | Same VM as 3, correct client ID entered                           | Connects.                                                                                           | ☐      |
| 5   | Client ID of an identity **not registered on the cluster**        | Fails with a message that mentions cluster-side registration.                                       | ☐      |
| 6   | Client ID of an identity **not assigned to this VM**              | Fails with "The managed identity with client ID ... is not assigned to this machine."               | ☐      |
| 7   | Non-Azure machine, Managed Identity selected                      | Fails with "No managed identity was found...".                                                      | ☐      |

Case 3 is the one that matters most. An opaque failure here means the feature has not done its job,
regardless of how many other rows pass.

---

## Connection string interoperability

| #   | Case                                                                                                         | Expected                                                                                                          | Result |
| --- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------ |
| 8   | Paste the documented Learn connection string verbatim, including `authMechanismProperties=ENVIRONMENT:azure` | Managed Identity is preselected and the identity step is skipped.                                                 | ☐      |
| 9   | Same, but with the user position empty                                                                       | Preselected, resolves to the system-assigned identity.                                                            | ☐      |
| 10  | Paste a string with `authMechanism=MONGODB-OIDC` and a GUID user, but no `ENVIRONMENT`                       | The authentication method quick pick still appears, with the client ID prefilled once Managed Identity is chosen. | ☐      |
| 11  | **Copy Connection String** on a managed identity connection                                                  | No password prompt. The copied string carries `ENVIRONMENT:azure`.                                                | ☐      |
| 12  | Use that copied string in `mongosh` on the same VM                                                           | Connects.                                                                                                         | ☐      |
| 13  | Use that copied string from a small Node driver script on the same VM                                        | Connects.                                                                                                         | ☐      |
| 14  | Paste that copied string into New Connection in a second VS Code window                                      | Produces an identical managed identity connection, **not** a native auth one.                                     | ☐      |

---

## Persistence and tree behaviour

| #   | Case                                                                       | Expected                                                                | Result |
| --- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------ |
| 15  | Reload the window, then reconnect a saved managed identity connection      | Connects without re-asking for the identity.                            | ☐      |
| 16  | Same for a **system-assigned** connection specifically                     | Still managed identity after the reload, not interactive Entra ID.      | ☐      |
| 17  | Move a saved managed identity connection into a folder, then reconnect     | Connects. Dual-ID regression, see the tree-cluster-architecture skill.  | ☐      |
| 18  | Update Credentials on a managed identity connection, switch to Native auth | The managed identity config is cleared; the connection uses a password. | ☐      |
| 19  | Reverse of 18: switch a native connection to Managed Identity              | The username and password are cleared; the identity step appears.       | ☐      |
| 20  | Connect the same cluster from the **Azure Resources** view                 | Managed Identity is offered and works.                                  | ☐      |
| 21  | Connect the same cluster from the **Service Discovery** view, then save it | The saved connection keeps the identity.                                | ☐      |

---

## Query surfaces

Each with a working managed identity connection:

| #   | Case                                                                   | Expected                                                        | Result |
| --- | ---------------------------------------------------------------------- | --------------------------------------------------------------- | ------ |
| 22  | Collection View: browse, query, edit a document                        | Works.                                                          | ☐      |
| 23  | Query Playground: run a script                                         | Works.                                                          | ☐      |
| 24  | Interactive Shell: open a session and run a command                    | Works, and the banner says **Managed Identity**, not **SCRAM**. | ☐      |
| 25  | Leave a shell session open past the token lifetime, then run a command | The token is refreshed silently.                                | ☐      |

Case 25 is slow to run but worth doing once: it is the only check that the real `expiresInSeconds`
reported by the new handler behaves as intended.

---

## Regression

| #   | Case                                                              | Expected                               | Result |
| --- | ----------------------------------------------------------------- | -------------------------------------- | ------ |
| 26  | Existing interactive Entra ID connections, including multi-tenant | Unchanged.                             | ☐      |
| 27  | Existing native auth connections                                  | Unchanged.                             | ☐      |
| 28  | Existing "No Authentication" connections                          | Unchanged.                             | ☐      |
| 29  | A connection stored by a previous extension version, reopened     | Resolves to the same method as before. | ☐      |

Rows 26 to 29 exist because WI12 changed how a stored authentication method is resolved. There are
unit tests for it, but the tests use synthetic records; row 29 uses real ones.

---

## Reporting

For any failure, capture:

- The row number and what actually happened.
- The exact message shown, including the notification and the **DocumentDB** output channel.
- The VM's identity configuration (system-assigned, user-assigned, or both, and how many).
- Whether the identity is registered on the cluster.

Please do **not** include the connection string if it carries anything beyond the host and the client
ID. A client ID on its own is safe to share.
