---
title: 'Sovereign Clouds (Azure Government, Azure China)'
parent: 'Connecting to Databases'
nav_order: 6
---

# Sovereign Clouds (Azure Government, Azure China)

The DocumentDB extension for Visual Studio Code connects to Azure DocumentDB clusters in Azure US
Government, Azure China, and custom Azure clouds with **Microsoft Entra ID** sign-in or a
**[managed identity](./connect-with-managed-identity)**.

Native DocumentDB authentication (username and password) works the same way in every cloud and
needs none of the settings on this page.

Entra account sign-in and managed identity also require a [trusted service
destination](./entra-id-trusted-servers) and valid TLS certificates. Selecting a cloud or token
audience does not grant trust to every server in that cloud.

**Table of Contents**

- [What to do when](#what-to-do-when)
- [What you need to configure](#what-you-need-to-configure)
- [The settings](#the-settings)
- [Where to set them](#where-to-set-them)
- [When a change takes effect](#when-a-change-takes-effect)
- [Private endpoints and custom DNS names](#private-endpoints-and-custom-dns-names)
- [Custom clouds](#custom-clouds)
- [How the extension chooses the cloud](#how-the-extension-chooses-the-cloud)
- [Error messages](#error-messages)
- [Sign-in error AADSTS65002](#sign-in-error-aadsts65002)
- [Collect diagnostic information](#collect-diagnostic-information)
- [Report a problem](#report-a-problem)

## What to do when

| When                                                                                                                     | Do this                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| You sign in with a username and password                                                                                 | Nothing. This page does not apply.                                                                                                                                                 |
| Your cluster is in Azure US Government or Azure China and you sign in with Entra ID                                      | Set [`microsoft-sovereign-cloud.environment`](#microsoft-sovereign-cloudenvironment) to that cloud, then sign in again.                                                            |
| You see _"This cluster is in …, but VS Code sign-in is set to …"_                                                          | Same as above: select the cluster's cloud.                                                                                                                                         |
| You use a managed identity and the service host ends in `mongocluster.cosmos.azure.us` or `mongocluster.cosmos.azure.cn` | Nothing. The extension recognizes the cloud.                                                                                                                                       |
| You see _"We could not determine which Azure cloud this virtual machine is in"_                                          | Set [`ossrdbmsEndpoint`](#documentdbcustomenvironmentossrdbmsendpoint) to your cloud's value.                                                                                      |
| Your cluster uses your own DNS name and Entra ID or managed identity is not offered                                      | Compare every host with the Azure portal connection string first; follow [Trusted Servers](./entra-id-trusted-servers) before considering a suffix override.                       |
| You see _"Microsoft Entra ID isn't allowed for this server"_ or a driver host-rejection error                            | Follow [Trusted Servers](./entra-id-trusted-servers). A broad Azure domain or TLS bypass cannot grant trust.                                                                       |
| Sign-in shows **Something went wrong** or AADSTS65002 in US Government or China                                          | Not fixable on your side yet. Use a username and password or a managed identity. See [AADSTS65002](#sign-in-error-aadsts65002).                                                    |
| You see another error                                                                                                    | Look it up in [Error messages](#error-messages).                                                                                                                                   |
| You use a custom cloud                                                                                                   | Follow [Custom clouds](#custom-clouds).                                                                                                                                            |
| You changed a setting and nothing changed                                                                                | Select **Retry** or reload the window ([details](#when-a-change-takes-effect)). In a remote window, check that you edited the **Remote** settings ([details](#where-to-set-them)). |
| You need help                                                                                                            | [Collect diagnostic information](#collect-diagnostic-information) and [report a problem](#report-a-problem).                                                                       |

## What you need to configure

The same guidance as a matrix. Look up the end of the cluster host name in your connection string,
and the way you authenticate.

| Cluster host name ends in                                                                | Entra ID sign-in                                                                                       | Managed identity                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mongocluster.cosmos.azure.com` (public cloud)                                           | Nothing                                                                                                | Nothing                                                                                                                                                                                                         |
| `mongocluster.cosmos.azure.us` (US Government) or `mongocluster.cosmos.azure.cn` (China) | [Select the cloud](#microsoft-sovereign-cloudenvironment)                                              | Nothing; the service host name identifies the cloud                                                                                                                                                             |
| A verified custom service name, such as `db1.data.contoso.example`                       | Select the cloud; follow [Trusted Servers](./entra-id-trusted-servers) before setting `hostnameSuffix` | Follow [Trusted Servers](./entra-id-trusted-servers). In US Government, China, or a custom cloud, also set [`ossrdbmsEndpoint`](#documentdbcustomenvironmentossrdbmsendpoint) if the cloud cannot be determined |
| A verified service in a [custom cloud](#custom-clouds)                                   | Select `custom` and define the cloud; confirm destination trust separately                             | Set `ossrdbmsEndpoint`; confirm destination trust separately                                                                                                                                                    |

A private endpoint that keeps its recognized service host name, such as
`<cluster>.mongocluster.cosmos.azure.us`, needs no suffix override. Private DNS still has to resolve
correctly, and the certificate must cover the host name. Live Government, China, and private-link
endpoint/certificate behavior has not been verified by the extension team.

Do not set the DocumentDB settings unless the table, or an error message, asks for them.

## The settings

Two settings belong to VS Code and choose the cloud you sign in to. Two belong to this extension and
only cover what VS Code cannot work out on its own.

| Setting                                                                                         | Owner          | Used by                                                             |
| ----------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------- |
| [`microsoft-sovereign-cloud.environment`](#microsoft-sovereign-cloudenvironment)                | VS Code        | Entra ID sign-in                                                    |
| [`microsoft-sovereign-cloud.customEnvironment`](#microsoft-sovereign-cloudcustomenvironment)    | VS Code        | Entra ID sign-in in a custom cloud                                  |
| [`documentDB.customEnvironment.ossrdbmsEndpoint`](#documentdbcustomenvironmentossrdbmsendpoint) | This extension | Managed identity; Entra ID sign-in only in a custom cloud           |
| [`documentDB.customEnvironment.hostnameSuffix`](#documentdbcustomenvironmenthostnamesuffix)     | This extension | Both, for host names outside `azure.com`, `azure.us` and `azure.cn` |

### `microsoft-sovereign-cloud.environment`

The cloud VS Code signs in to with Microsoft Entra ID. The extension requests its DocumentDB token
from the same cloud.

| Value          | Cloud                            |
| -------------- | -------------------------------- |
| _(not set)_    | Azure public cloud               |
| `USGovernment` | Azure US Government              |
| `ChinaCloud`   | Azure China                      |
| `custom`       | A [custom cloud](#custom-clouds) |

To set it, open the Settings editor (see [Where to set them](#where-to-set-them)), search for
`microsoft-sovereign-cloud.environment`, and pick the cloud from the drop-down. To go back to the
public cloud, select **Reset Setting** from the gear next to it. After you change it, sign out and
sign in again with an account from the selected cloud.

> **Also using the Azure Resources extension?** Its **Azure: Configure Sovereign Cloud** command
> (also the gear icon in the **Accounts & Tenants** view) sets the same value. It lists the clouds by
> name (**Azure (Default)**, **Azure US Government**, **Azure China**, **A custom Microsoft Sovereign
> Cloud**), always writes to User settings, and refreshes the **Azure** and **Accounts & Tenants**
> views so your subscriptions and clusters are listed from the new cloud straight away. Use it if you
> work in those views. For a custom cloud, it only opens the Settings editor; you still fill in the
> values yourself. It does not change the `documentDB.customEnvironment` settings.

Managed identity ignores this setting: the token comes from the Azure VM, not from your VS Code
sign-in.

### `microsoft-sovereign-cloud.customEnvironment`

Only for `custom`. It describes the custom cloud's endpoints, and VS Code needs all six fields:
`name`, `portalUrl`, `managementEndpointUrl`, `resourceManagerEndpointUrl`,
`activeDirectoryEndpointUrl`, and `activeDirectoryResourceId`. Your cloud operator provides the
values. The Settings editor cannot edit this one directly; select **Edit in settings.json** under
it.

### `documentDB.customEnvironment.ossrdbmsEndpoint`

The Microsoft Entra resource that the DocumentDB token is issued for (the token's _audience_).
The extension normally chooses it automatically. Set it only when:

- You use a **managed identity** with your own DNS name in US Government, China, or a custom cloud.
  The connection fails with _"We could not determine which Azure cloud this virtual machine is in"_.
- You use a **custom cloud** and the connection fails with _"VS Code is signed in to a custom cloud,
  and we could not find which Microsoft Entra resource to request a token for"_.

| Cloud               | Value                                                                           |
| ------------------- | ------------------------------------------------------------------------------- |
| Azure public cloud  | `https://ossrdbms-aad.database.windows.net`                                     |
| Azure US Government | `https://ossrdbms-aad.database.usgovcloudapi.net`                               |
| Azure China         | `https://ossrdbms-aad.database.chinacloudapi.cn`                                |
| Custom cloud        | Ask your cloud operator, usually `https://ossrdbms-aad.database.<cloud-domain>` |

Things to know:

- For managed identity, this value **wins over everything else** for every managed identity
  connection on this machine. Clear it if the machine moves to another cloud.
- For Entra ID sign-in, it is used **only** when `microsoft-sovereign-cloud.environment` is
  `custom`, and ignored otherwise.
- It does not make a host name trusted; that is `hostnameSuffix`.

### `documentDB.customEnvironment.hostnameSuffix`

An explicit trust grant for a confirmed Azure DocumentDB service suffix that is not already
recognized. It is one string, not a list. For example, `.data.contoso.example` covers
`db1.data.contoso.example`, but not the suffix itself.

Setting it does two things for hosts under that suffix:

- **New Connection** and **Update Credentials** offer Microsoft Entra ID and managed identity.
- The extension can send Microsoft Entra ID tokens to those hosts, provided every connection host
  qualifies and all servers pass TLS certificate and hostname validation.

It applies in every cloud, public cloud included, and never selects the cloud or the token resource.

> **Security:** Microsoft Entra ID tokens are sent to servers ending with this suffix. Add only a
> suffix you have confirmed belongs to Azure DocumentDB. First compare the host names with the
> Azure portal connection string and report an unrecognized service endpoint on GitHub. Then,
> if needed, choose the narrowest service suffix. Broad Azure domains, parents of built-in service
> suffixes, `cloudapp` labels, sovereign customer-hosting parents, bare TLDs, and common public
> suffixes are rejected. See [Trusted Servers](./entra-id-trusted-servers) for the full guidance.

## Where to set them

Use the Settings editor:

1. Open it with **File > Preferences > Settings** (**Code > Settings > Settings** on macOS), or
   <kbd>Ctrl</kbd>+<kbd>,</kbd> (<kbd>Cmd</kbd>+<kbd>,</kbd> on macOS).
2. Select the **User** tab. In a remote window, select the **Remote** tab instead (see below).
3. Type the setting ID in the search box, for example `documentDB.customEnvironment`.
4. Change the value:
   - `microsoft-sovereign-cloud.environment`: pick a cloud from the drop-down.
   - `documentDB.customEnvironment`: select **Add Item**, choose `ossrdbmsEndpoint` or
     `hostnameSuffix`, type the value, and select **OK**. Add only the properties you need.
   - `microsoft-sovereign-cloud.customEnvironment`: select **Edit in settings.json**.

Changes are saved straight away.

If you prefer to edit JSON, run **Preferences: Open User Settings (JSON)**, or **Preferences: Open
Remote Settings (JSON)** in a remote window, from the Command Palette. Both DocumentDB properties
live in one `documentDB.customEnvironment` object. The following illustrates a managed identity
connection to a **previously verified and certificate-covered** private service name in US
Government; do not copy the suffix without the checks above:

```json
{
    "documentDB.customEnvironment": {
        "ossrdbmsEndpoint": "https://ossrdbms-aad.database.usgovcloudapi.net",
        "hostnameSuffix": ".data.contoso.example"
    }
}
```

VS Code underlines a value it does not accept and explains why.

`documentDB.customEnvironment` is a per-machine setting, which matters in two cases:

- **Remote windows.** When VS Code is connected to another machine with Remote - SSH, Remote -
  Tunnels, WSL, Dev Containers, or Codespaces, the extension runs on that machine and reads this setting **only from
  Remote settings**. A value in your local User settings is ignored there. This is the usual setup
  for managed identity, where you connect to an Azure VM over SSH.
- **Workspace and folder settings are ignored**, so a repository's `.vscode/settings.json` cannot
  change where tokens are sent.
- **Settings Sync does not carry this machine-scoped trust grant** to another machine.

To turn an override off, remove the property (the **Remove** icon on its row in the Settings
editor), or delete it or set it to an empty string in JSON.

## When a change takes effect

The extension reads these settings each time it connects to a cluster.

- If the connection **failed**, select **Retry** under the cluster.
- If the cluster is **already connected**, run **Developer: Reload Window**.
- An open **interactive shell** or **Query Playground** keeps the cloud it started with. Close it and
  open a new one, or reload the window, to change its audience or identity. Destination trust is
  different: each token relay checks the current `hostnameSuffix` against the original session
  connection. Removing custom trust can stop the next token request; it does not forcibly close
  an already authenticated socket.

## Private endpoints and custom DNS names

A private endpoint using a recognized service FQDN needs no suffix override. Prefer the
connection string shown in the Azure portal. If a custom alias is necessary, first follow
[Trusted Servers](./entra-id-trusted-servers); a CNAME alone proves neither permission to receive
tokens nor certificate coverage. Managed identity in US Government, China, or a custom cloud may
also need [`ossrdbmsEndpoint`](#documentdbcustomenvironmentossrdbmsendpoint), because a private name
does not identify the cloud.

Every seed host must be trusted, and SRV targets, discovered servers, and reconnects must remain
within that connection's approved suffixes and pass certificate validation. Do not substitute
localhost, an IP address, a tunnel address, or a trailing-dot name for the service FQDN.
Certificate/hostname-validation bypasses are ignored for Entra, including managed identity; they
cannot rescue an alias that lacks trust or a matching certificate.

## Custom clouds

1. In the Settings editor, set `microsoft-sovereign-cloud.environment` to `custom`. (The Azure
   Resources command **Azure: Configure Sovereign Cloud** > **A custom Microsoft Sovereign Cloud**
   opens the same settings.)
2. Under `microsoft-sovereign-cloud.customEnvironment`, select **Edit in settings.json** and fill in
   the values from your cloud operator.
3. Connect. The extension finds the token resource from the cloud definition.
4. If it cannot, the error message names `documentDB.customEnvironment.ossrdbmsEndpoint`. Set it to
   the value your cloud operator gives you.
5. If the service destination is not recognized, follow [Trusted Servers](./entra-id-trusted-servers)
   before considering `documentDB.customEnvironment.hostnameSuffix`.

The extension never falls back to the public cloud for a custom cloud.

## How the extension chooses the cloud

This section is for troubleshooting. You do not need it to configure a connection.

Cloud inference below is separate from destination trust. The trusted-server check runs before
token acquisition; a host classified as public, Government, or China is not thereby trusted.

**Entra ID sign-in** uses the cloud in `microsoft-sovereign-cloud.environment`. Before signing in,
the extension compares it with the cluster's host names. If a host name ends in `azure.com`,
`azure.us`, or `azure.cn` and belongs to a different cloud, the extension stops and asks you to
change the setting. If the host names belong to more than one cloud, it stops and asks you to check
the connection string. Your own DNS names are not part of this check.

In a custom cloud, it uses, in order: `ossrdbmsEndpoint`, the custom cloud's sign-in host if it is a
known Azure cloud, and then the resource published by the cloud's Azure Resource Manager endpoint.

**Managed identity** uses, in order:

1. `documentDB.customEnvironment.ossrdbmsEndpoint`, if set.
2. The cluster host name: `azure.com`, `azure.us`, or `azure.cn`.
3. The Azure VM itself, which can only confirm the **public** cloud.
4. Otherwise, the connection stops with a message naming `ossrdbmsEndpoint`.

A `TOKEN_RESOURCE` value in a pasted connection string is not used to choose the cloud; set
`ossrdbmsEndpoint` instead. **Copy Connection String** writes a `TOKEN_RESOURCE` for the cluster's
cloud, taken from `ossrdbmsEndpoint`, the host name, or the cloud selected in VS Code, so the copied
string works in other tools on the same VM.

## Error messages

The **Who can fix it** column tells you whether to change a setting yourself or to escalate.

### Before sign-in

The extension stops before requesting a token when the configuration cannot work.

| Message starts with                                                                          | What to do                                                                                                                                                                        | Who can fix it               |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| This cluster is in _&lt;cloud&gt;_, but VS Code sign-in is set to _&lt;cloud&gt;_              | Change [`microsoft-sovereign-cloud.environment`](#microsoft-sovereign-cloudenvironment) to the cluster's cloud                                                                    | You                          |
| The host names of this cluster belong to more than one Azure cloud                           | Fix the connection string so all hosts are in one cloud                                                                                                                           | You                          |
| We could not determine which Azure cloud this virtual machine is in                          | Set [`ossrdbmsEndpoint`](#documentdbcustomenvironmentossrdbmsendpoint) to your cloud's value                                                                                      | You                          |
| VS Code is signed in to a custom cloud, and we could not find which Microsoft Entra resource | Set `ossrdbmsEndpoint` to the value from your cloud operator                                                                                                                      | You, with the cloud operator |
| The VS Code custom cloud definition could not be read                                        | Complete all six fields of [`microsoft-sovereign-cloud.customEnvironment`](#microsoft-sovereign-cloudcustomenvironment)                                                           | You, with the cloud operator |
| "documentDB.customEnvironment.ossrdbmsEndpoint" must be an HTTPS resource                    | Correct the value, or clear it                                                                                                                                                    | You                          |
| Microsoft Entra ID isn't allowed for this server, or the driver does not allow the host      | Check every host against the Azure portal connection string; report a missing endpoint before granting a narrow custom suffix. See [Trusted Servers](./entra-id-trusted-servers). | You, with the cluster owner  |

### From Microsoft Entra ID

These come from Microsoft Entra ID, which reports an `AADSTS` code. The extension adds an
explanation.

| Code                                                     | Meaning                                                           | What to do                                                                                                   | Who can fix it                      |
| -------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| AADSTS65002                                              | VS Code is not yet allowed to sign in to DocumentDB in this cloud | See [AADSTS65002](#sign-in-error-aadsts65002)                                                                | Microsoft only                      |
| AADSTS500011                                             | The token was requested from a cloud other than the cluster's     | Entra ID: check `microsoft-sovereign-cloud.environment`. Managed identity: check or clear `ossrdbmsEndpoint` | You                                 |
| AADSTS50001                                              | The token resource is not valid in this cloud                     | Check `ossrdbmsEndpoint`; if it is not set, report the problem                                               | You, or the extension maintainers   |
| AADSTS50020, AADSTS90072                                 | The account is not a member or guest of the cluster's tenant      | **Update Credentials** and choose another account or tenant                                                  | You, or that tenant's administrator |
| AADSTS700016                                             | Wrong cloud or wrong tenant                                       | Check `microsoft-sovereign-cloud.environment` and the tenant in **Update Credentials**                       | You                                 |
| AADSTS90002                                              | The tenant does not exist in the selected cloud                   | Check `microsoft-sovereign-cloud.environment` and the tenant                                                 | You                                 |
| AADSTS1000104                                            | The account belongs to another Azure cloud                        | Sign in with an account from the cluster's cloud                                                             | You, or the tenant administrators   |
| AADSTS53003                                              | Blocked by a Conditional Access policy                            | Give your IT help desk the code and the time of the failure                                                  | Your IT help desk                   |
| AADSTS50076, AADSTS50079                                 | Additional verification (MFA) is required                         | Sign in again and complete the verification                                                                  | You                                 |
| _"The sign-in window reported an error without details"_ | Windows reported the failure without a code                       | [Find the code](#collect-diagnostic-information)                                                             | Depends on the code                 |
| Any other code                                           | See `https://login.microsoftonline.com/error?code=<code>`         | Ask your tenant administrator or IT help desk                                                                | Depends on the code                 |

## Sign-in error AADSTS65002

In some sovereign clouds, Microsoft Entra ID has not yet authorized VS Code to request tokens for
Azure DocumentDB. Sign-in then shows **Something went wrong**, or fails with AADSTS65002 saying
that consent "must be configured via preauthorization."

Microsoft has to make this change. You and your tenant administrator cannot. The Azure Resources
view still lists your clusters, because listing uses a different Microsoft Entra resource.

Until the change is made, you can:

- Use native DocumentDB authentication with a username and password, if the cluster allows it.
- Use a [managed identity](./connect-with-managed-identity) when VS Code runs on an Azure VM.

## Collect diagnostic information

### The DocumentDB output

Open **View > Output** and select **DocumentDB** in the drop-down. Each connection attempt writes
lines that start with `[Authentication]`. The one that matters most for cloud problems is:

- `entraCloud.resolved`: the cloud and token resource the extension chose, or
- `entraCloud.unresolved`: the extension stopped before sign-in, and why.

| Field             | Meaning                                                                                                                                                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flow`            | `interactive` (Entra ID sign-in) or `managedIdentity`                                                                                                                                                                                                                 |
| `tokenResource`   | The token resource that was requested                                                                                                                                                                                                                                 |
| `cloudCategory`   | `public`, `usgov`, `china`, or `custom`                                                                                                                                                                                                                               |
| `reason`          | Where the choice came from: `setting` (`microsoft-sovereign-cloud.environment`), `host` (cluster host name), `imds` (the Azure VM reported the public cloud), `customOverride` (`ossrdbmsEndpoint`), `customLoginHost` or `armMetadata` (the custom cloud definition) |
| `configuredCloud` | The cloud selected in VS Code                                                                                                                                                                                                                                         |
| `hostCloud`       | The cloud identified from the cluster host names, `none` for your own DNS names, or `conflicting`                                                                                                                                                                     |
| `errorKind`       | Only on `entraCloud.unresolved`: which of the [before sign-in](#before-sign-in) messages was shown                                                                                                                                                                    |

These cloud-resolution lines contain no tokens, passwords, tenant IDs, or cluster host names.

`entraDestination.evaluated` records a bounded destination class, not a host name. If a custom
suffix admits the connection, a separate `[Auth]` entry records that suffix. Redact private suffixes
before sharing the output.

### The sign-in logs

On Windows, the sign-in window shows the error code in its troubleshooting details; the extension
receives only the generic `platform_broker_error`. To see more:

1. Run **Developer: Show Logs...**.
2. Select **Microsoft Sovereign Cloud Authentication** (or **Microsoft Authentication** for the
   public cloud).

As a last resort, and only to find the code, you can set `microsoft-authentication.implementation`
to `msal-no-broker` so that the raw AADSTS error reaches the extension. This affects all of VS Code,
and token-cache failures and repeated sign-in prompts have been reported in this mode for sovereign
clouds (see [microsoft/vscode#307340](https://github.com/microsoft/vscode/issues/307340)). Restore
the setting afterwards.

## Report a problem

[Open an issue](https://github.com/microsoft/vscode-documentdb/issues) and include:

- DocumentDB extension version, VS Code version, and operating system
- Whether VS Code runs locally or in a remote window (SSH, WSL, Dev Containers, Codespaces)
- Authentication method: Entra ID sign-in or managed identity
- The value of `microsoft-sovereign-cloud.environment`
- Whether the cluster host name ends in `azure.com`, `azure.us`, `azure.cn`, or is your own DNS name
- Which `documentDB.customEnvironment` properties are set
- The full error message and AADSTS code
- The `[Authentication]` lines from the DocumentDB output

Remove tenant IDs, subscription IDs, account names, host names, and Microsoft Entra correlation IDs
before posting.
