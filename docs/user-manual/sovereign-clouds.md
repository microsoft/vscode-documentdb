---
title: 'Sovereign Clouds (Azure Government, Azure China)'
parent: 'Connecting to Databases'
nav_order: 6
---

# Sovereign Clouds (Azure Government, Azure China)

The DocumentDB extension for Visual Studio Code supports Azure US Government, Azure China, and
custom Azure clouds when you connect with Microsoft Entra ID or a managed identity.

## Select a cloud

VS Code signs in to the cloud selected by the `microsoft-sovereign-cloud.environment` setting:

- `USGovernment` for Azure US Government
- `ChinaCloud` for Azure China
- `custom` for a custom cloud
- Unset for the public cloud

The Azure Resources extension has a cloud picker that updates this setting. After you change the
cloud, sign out of VS Code and sign in again.

## Token resource for Microsoft Entra ID

The extension requests a token for the open-source database resource of the selected cloud:

| Cloud               | Resource                                          |
| ------------------- | ------------------------------------------------- |
| Public              | `https://ossrdbms-aad.database.windows.net`       |
| Azure US Government | `https://ossrdbms-aad.database.usgovcloudapi.net` |
| Azure China         | `https://ossrdbms-aad.database.chinacloudapi.cn`  |

These values are published by each cloud in its Azure Resource Manager metadata at
`/metadata/endpoints?api-version=2022-09-01`.

If a cluster host ends in `azure.com`, `azure.us`, or `azure.cn`, and that suffix identifies a
different cloud from the one VS Code is signed in to, the extension stops before sign-in. It tells
you which `microsoft-sovereign-cloud.environment` setting to change.

## Managed identity

For a managed identity, the extension determines the cloud from the cluster host:
`azure.com`, `azure.us`, or `azure.cn`. Otherwise, it uses the Azure VM's instance metadata.

If neither source identifies the cloud, set `documentDB.customEnvironment.ossrdbmsEndpoint`.

## Custom clouds

Set `microsoft-sovereign-cloud.environment` to `custom` and fill in
`microsoft-sovereign-cloud.customEnvironment`. The extension then finds the open-source database
resource in this order:

1. `documentDB.customEnvironment.ossrdbmsEndpoint`
2. The custom cloud's sign-in host, if it is a known Azure cloud
3. The cloud's Azure Resource Manager metadata, `ossrDbmsResourceId`

If none is available, connecting fails with a message that names
`documentDB.customEnvironment.ossrdbmsEndpoint`. It never falls back to the public cloud.

By default, the extension sends tokens only to cluster hosts under `azure.com`, `azure.us`, and
`azure.cn`. Set `documentDB.customEnvironment.mongoClusterHostnameSuffix` to allow cluster hosts
in a custom cloud. Include the leading dot.

```json
{
    "documentDB.customEnvironment.ossrdbmsEndpoint": "https://ossrdbms-aad.database.example",
    "documentDB.customEnvironment.mongoClusterHostnameSuffix": ".mongocluster.cosmos.example"
}
```

## Sign-in error AADSTS65002

In some clouds, Microsoft Entra ID has not authorized VS Code to request tokens for Azure
DocumentDB. Sign-in can then show **Something went wrong** or fail with AADSTS65002, which says
the application "must be configured via preauthorization."

Microsoft must make this configuration change. You and your tenant administrator cannot change it.
The Azure Resources view can still list resources because it requests a token for a different
resource.

Until the configuration changes, you can:

- Use native DocumentDB authentication with a username and password, if the cluster enables it.
- Use a managed identity when VS Code runs on an Azure VM.

## Find the error code

On Windows, the sign-in window shows the error code in its troubleshooting details. The extension
receives only the generic `platform_broker_error`.

To find more details:

1. Check the sign-in window.
2. Run **Developer: Show Logs...**.
3. Open **Microsoft Sovereign Cloud Authentication**, or **Microsoft Authentication** for the
   public cloud.

As a manual diagnostic step only, set `microsoft-authentication.implementation` to
`msal-no-broker`. The raw AADSTS error then reaches the extension. This setting affects all of VS
Code. In Azure China, tokens are currently not kept in this mode. See
[VS Code issue 307340](https://github.com/microsoft/vscode/issues/307340). Change the setting back
after you finish diagnosing the problem.

## Report a problem

[Open an issue](https://github.com/microsoft/vscode-documentdb/issues) and include:

- DocumentDB extension version
- VS Code version
- Operating system
- Selected cloud
- AADSTS error code

Remove tenant IDs, subscription IDs, account names, and correlation IDs before posting.
