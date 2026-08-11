> **User Manual** &mdash; [Back to Connecting with a URL](./how-to-construct-url) | [Back to User Manual](../index#user-manual)

---

# Connect with a Managed Identity

When VS Code runs on an **Azure VM** that has a managed identity assigned, the extension can authenticate to an Azure DocumentDB cluster as that identity. Nobody signs in, no password is stored, and no secret is written to disk: the VM's identity is presented to Microsoft Entra ID and exchanged for a short-lived token.

This is the right choice for a shared jump box, a build agent, or any Azure VM where an interactive sign-in is impractical or where you want the connection to be attributable to the machine rather than to a person.

**Table of Contents**

- [Before you start](#before-you-start)
- [Supported environments](#supported-environments)
- [The identity and the cluster must be in the same tenant](#the-identity-and-the-cluster-must-be-in-the-same-tenant)
- [Create a connection](#create-a-connection)
- [Choosing the identity](#choosing-the-identity)
- [Paste a connection string instead](#paste-a-connection-string-instead)
- [Copying the connection string](#copying-the-connection-string)
- [Troubleshooting](#troubleshooting)
- [How it differs from Entra ID](#how-it-differs-from-entra-id)

## Before you start

Three things have to be in place, and all three are outside VS Code:

1. The Azure VM has a **system-assigned** or **user-assigned** managed identity.
2. The identity is **registered on the DocumentDB cluster** as a user. Assigning an identity to a VM does not grant it any database access on its own. See [Azure DocumentDB role-based access control](https://learn.microsoft.com/azure/documentdb/how-to-connect-role-based-access-control).
3. The cluster allows Microsoft Entra ID authentication.
4. The VM and the cluster are **in the same Microsoft Entra tenant**. See [the next section but one](#the-identity-and-the-cluster-must-be-in-the-same-tenant).

If any of these is missing, the connection fails with a message naming which one.

## Supported environments

**Azure VMs only.** That is what this feature is designed for, documented for, and tested against.

The underlying credential library also works on App Service, Container Apps, Azure Arc enabled servers and AKS, and nothing here deliberately blocks those. They are simply not scenarios the extension claims or verifies, so treat success there as a bonus rather than a guarantee.

On a machine that is not Azure hosted, the method is still listed, and selecting it produces a clear message rather than a silent failure.

## The identity and the cluster must be in the same tenant

This is the one hard limitation of managed identity, and it has no workaround.

A managed identity is a service principal that exists in exactly **one** Microsoft Entra tenant: the tenant of the subscription that owns the VM. Unlike a user account, it cannot be invited as a guest into another tenant, and the token request has no tenant parameter to point somewhere else. So if the VM is in one tenant and the DocumentDB cluster is in another, managed identity cannot authenticate, no matter how the cluster is configured.

That is why the connection flow never asks which tenant to use, while [Entra ID sign-in](#how-it-differs-from-entra-id) does: a person can belong to several tenants, a machine identity belongs to one.

**If your cluster is in a different tenant, use Entra ID sign-in instead.** A user account can be a guest in the cluster's tenant, and the connection flow lets you pick which tenant to authenticate against.

When the extension knows which tenant owns the cluster, which is the case for connections created from the **Azure Resources** or **Service Discovery** views, it checks the tenant before connecting and tells you both tenant IDs rather than letting the cluster reject the token with a generic authentication error. For a connection created by pasting a connection string the extension has no way to know the cluster's tenant, so the failure surfaces as a plain authentication error from the server.

## Create a connection

1. In the **Connections** view, select **New Connection**, then **Connection String**.
2. Paste the connection string of your cluster. You can copy it from the Azure portal.
3. When asked for an authentication method, choose **Managed Identity (Azure hosted)**.
4. Choose the identity to use, as described below.

The same option appears in the **Azure Resources** and **Service Discovery** views when you connect to a cluster that allows Microsoft Entra ID, and in **Update Credentials** on an existing connection.

## Choosing the identity

The extension asks which identity to authenticate as:

- **Enter a client ID**: type the client ID of a user-assigned managed identity. It looks like `11111111-2222-3333-4444-555555555555`.
- **System-assigned managed identity**: use the machine's own identity. No client ID is needed.
- **Recently used**: client IDs you have connected with before, shown with the connection they were last used for. This list is local to your machine and holds no secrets.

**If the VM has more than one identity, the client ID is not optional.** The Azure instance metadata service cannot choose between several identities on its own, so a request without a client ID fails. This is the single most common cause of a failed managed identity connection.

A client ID is a tenant-scoped identifier, not a credential. It is stored alongside the connection and it is safe to paste into a bug report.

> **A note on "system-assigned".** Choosing that option sends no identity selector at all, and the instance metadata service answers with the machine's **default** identity. On a machine that has no system-assigned identity but exactly one user-assigned identity, the request therefore still succeeds and returns that user-assigned identity. If you need a specific identity, name it with its client ID rather than relying on the default.

## Paste a connection string instead

A connection string in the form documented by Microsoft Learn is recognized automatically:

```text
mongodb+srv://<client-id>@<cluster>.mongocluster.cosmos.azure.com/?authMechanism=MONGODB-OIDC&authMechanismProperties=ENVIRONMENT:azure,TOKEN_RESOURCE:https://ossrdbms-aad.database.windows.net
```

When you paste this, the extension selects **Managed Identity**, takes the client ID from the user position, and does not ask you again. Leave the user position empty for the system-assigned identity.

The extension reads those parameters to work out what you meant and then removes them from the stored connection string, so the mechanism is configured in exactly one place.

## Copying the connection string

**Copy Connection String** on a managed identity connection produces the same documented form shown above, so it works in `mongosh` and in application drivers **on the same Azure VM**, and it can be pasted back into **New Connection** in another VS Code window.

No password prompt appears, because there is no password to include. See [Copy Connection String](./copy-connection-string#managed-identity-connections).

## Troubleshooting

| Message                                                                 | What it means                                                                                                                                            |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| This machine has more than one managed identity                         | Reconnect and enter the client ID of the identity you want. The metadata service cannot pick one for you.                                                |
| No managed identity is available on this machine                        | VS Code is not running on an Azure resource with a managed identity assigned, or the instance metadata service is not reachable.                         |
| The managed identity with client ID ... is not assigned to this machine | The client ID is valid but that identity is not attached to this VM. Check the VM's Identity blade in the Azure portal.                                  |
| This managed identity belongs to Microsoft Entra tenant ..., but the cluster is in tenant ... | The VM and the cluster are in different tenants. There is no way to bridge that with a managed identity; use Entra ID sign-in instead. See [the tenant section](#the-identity-and-the-cluster-must-be-in-the-same-tenant). |
| The connection is refused after a token was obtained                    | Authentication worked but the cluster does not recognize the identity. Register it on the cluster as described in [Before you start](#before-you-start). If the connection came from a pasted connection string, also check that the cluster is in the same tenant as the VM. |

## How it differs from Entra ID

Both methods present a Microsoft Entra ID token to the cluster, and on the wire they are identical. The difference is where the token comes from:

|                              | Entra ID for Azure DocumentDB | Managed Identity (Azure hosted)          |
| ---------------------------- | ----------------------------- | ---------------------------------------- |
| Who is authenticated         | The signed-in VS Code user    | The Azure VM                             |
| Sign-in prompt               | Yes, the first time           | Never                                    |
| Works without a user session | No                            | Yes                                      |
| Tenants                      | You choose one, and can be a guest in several | Exactly one, fixed by the VM's subscription |
| Cluster in another tenant    | Supported                     | Not possible                             |
| Where it works               | Anywhere                      | On an Azure VM with an identity assigned |

If you want the connection to be attributable to you, use Entra ID. If you want it attributable to the machine, or there is no interactive user, use Managed Identity.
