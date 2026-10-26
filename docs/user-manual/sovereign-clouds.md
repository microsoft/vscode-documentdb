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
different cloud from the one VS Code is signed in to, the extension stops before sign-in and asks
you to change `microsoft-sovereign-cloud.environment` to the cluster's cloud.

## Managed identity

For a managed identity, the extension selects the token resource in this order:

1. `documentDB.customEnvironment.ossrdbmsEndpoint`, if configured.
2. The cluster host: `azure.com` for public, `azure.us` for Government, or `azure.cn` for China.
3. The Azure VM's instance metadata (IMDS), but **only `AZUREPUBLICCLOUD` is recognized**.

Government, China, and other IMDS environment values are not mapped to a cloud. If the host is
private or otherwise unrecognized and IMDS does not identify the public cloud, set
`documentDB.customEnvironment.ossrdbmsEndpoint` to your cloud's resource (the built-in resources
are listed above).
The VS Code sign-in cloud setting does not select the managed identity audience.

## Custom clouds

Set `microsoft-sovereign-cloud.environment` to `custom` and fill in
`microsoft-sovereign-cloud.customEnvironment`. The extension then finds the open-source database
resource in this order:

1. `documentDB.customEnvironment.ossrdbmsEndpoint`
2. The custom cloud's sign-in host, if it is a known Azure cloud
3. The cloud's Azure Resource Manager metadata, `ossrDbmsResourceId`

If none is available, connecting fails with a message that names
`documentDB.customEnvironment.ossrdbmsEndpoint`. It never falls back to the public cloud.

The token audience and trusted hostnames are separate settings. For a custom cloud's service
domain, configure `documentDB.customEnvironment.mongoClusterHostnameSuffix` as described below.

## Private endpoints and custom DNS names

The extension recognizes connection-string hostnames under `azure.com`, `azure.us`, and `azure.cn`
and selects the corresponding OIDC hostname allowlist. For other names it defaults to
`*.azure.com`; it does not discover the cloud or trusted suffix by following DNS aliases.
A private endpoint that keeps its recognized Azure hostname needs no suffix override.

For a trusted private service name outside those domains, set
`documentDB.customEnvironment.mongoClusterHostnameSuffix` to the service's DNS suffix, for example
`.documentdb.private.example`. This applies to **built-in Government and China clouds too**, not
only custom clouds. The connection-string hostname must be a subdomain of the configured suffix.
For a non-SRV (`mongodb://`) CNAME, the name in the connection string is checked, not its canonical
DNS target or resolved IP address.

A managed identity connection to a private hostname in Government needs **both** properties:
the Government token resource and the trusted private service suffix. For example, for a host
such as `cluster.documentdb.private.example`:

```json
{
    "documentDB.customEnvironment": {
        "ossrdbmsEndpoint": "https://ossrdbms-aad.database.usgovcloudapi.net",
        "mongoClusterHostnameSuffix": ".documentdb.private.example"
    }
}
```

For `mongodb+srv://`, the extension still derives its allowlist from the hostname in the
connection string, but the driver checks the **SRV target hostnames** after SRV resolution,
including when the SRV lookup follows a CNAME. Trusting an alias's private suffix does not allow
SRV targets under a different suffix. In particular, a private alias whose SRV targets end in
`azure.us` or `azure.cn` does not automatically get that cloud's allowlist. Use the service-provided
connection string with the recognized service hostname, or DNS whose connection hostname and SRV
targets share the configured trusted service suffix. The setting does not bypass the driver's
SRV-domain or TLS checks. Do not broaden it to an arbitrary domain or public suffix to accommodate
unrelated targets.

If the driver rejects a host for OIDC authentication, the extension explains that the host does not
appear to be allowed and names `documentDB.customEnvironment.mongoClusterHostnameSuffix` in User
settings. Verify the trusted service domain with your cloud administrator, configure it, and
connect again. The audience override alone does not authorize a hostname.

Both are properties of the `documentDB.customEnvironment` setting, so they go in one object in
`settings.json`. For a custom cloud, for example:

```json
{
    "documentDB.customEnvironment": {
        "ossrdbmsEndpoint": "https://ossrdbms-aad.database.example",
        "mongoClusterHostnameSuffix": ".mongocluster.cosmos.example"
    }
}
```

Configure this machine-scoped object in **User settings**, not Workspace or Folder settings.
The Settings editor checks both properties: the audience must be an HTTPS resource without a
non-root path, query, fragment, credentials, or `/.default`; the hostname suffix must use valid DNS
labels, without a wildcard, URL, port, or path (a leading dot is optional). Bare top-level domains
and common public suffixes such as `com.cn` are rejected.
Only configure a service domain you trust. Surrounding whitespace is ignored; an empty or
whitespace-only property clears the override and restores automatic selection.

## Sign-in error AADSTS65002

In some clouds, Microsoft Entra ID has not authorized VS Code to request tokens for Azure
DocumentDB. Sign-in can then show **Something went wrong** or fail with AADSTS65002, which says
the consent "must be configured via preauthorization."

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
