---
feature: sovereign-clouds
kind: research
status: active
---

# Research Findings: Entra Sign-in in Sovereign Clouds

Collected from the extension's code, the installed `@microsoft/vscode-azext-azureauth` 4.1.1, and
public sources. Nothing here was observed in a sovereign cloud. Items marked **unverified** are
inferences.

## 1. The reported failure

An issue was reported: Microsoft Entra ID sign-in to an Azure DocumentDB cluster in Azure US
Government fails, while listing Azure resources works. The Microsoft Entra error is:

```text
AADSTS65002: Consent between first party application 'aebc6443-996d-45c2-90f0-388ff96faa56'
and first party resource '123cd850-d9df-40bd-94d5-c9f07b7fa203' must be configured via
preauthorization - applications owned and operated by Microsoft must get approval from the API
owner before requesting tokens for that API.
```

What this establishes:

- The failure is in the database token request, not in listing resources, so it affects every
  entry point that connects with Entra ID.
- Sign-in reached the US Government directory, so the sign-in authority already follows
  `microsoft-sovereign-cloud.environment`.
- The US Government directory resolved our requested resource
  (`https://ossrdbms-aad.database.windows.net`) to app `123cd850`. The request reached the right
  app; it was refused for lack of preauthorization.

## 2. Where the two GUIDs come from

| GUID                                   | What it is                                                                                                                                                                                                                     | Owner                                       | Scoped to our extension?                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `aebc6443-996d-45c2-90f0-388ff96faa56` | **VS Code's** client (application) ID. The built-in `microsoft` and `microsoft-sovereign-cloud` auth providers use it for every token request unless the caller adds a `VSCODE_CLIENT_ID:<guid>` pseudo-scope.                 | Microsoft, VS Code team                     | **No.** Every extension that calls `vscode.authentication.getSession('microsoft', …)` shares it. |
| `123cd850-d9df-40bd-94d5-c9f07b7fa203` | The application ID of the first-party **Azure OSSRDBMS Database** app. Its identifier URI is `https://ossrdbms-aad.database.windows.net`. Azure Database for PostgreSQL, MySQL, and Azure DocumentDB all accept tokens for it. | Microsoft, the OSSRDBMS resource owner team | No.                                                                                              |

Sources:

- `aebc6443` is `DEFAULT_CLIENT_ID` in
  [microsoft/vscode `extensions/microsoft-authentication/src/common/scopeData.ts`](https://github.com/microsoft/vscode/blob/main/extensions/microsoft-authentication/src/common/scopeData.ts),
  and is listed as "Visual Studio Code" in the community
  [merill/microsoft-info](https://github.com/merill/microsoft-info) app list.
- The **name** "Azure OSSRDBMS Database" for `123cd850` comes only from the third-party
  [AzAdvertizer](https://www.azadvertizer.net/azentraidapipermissions/123cd850-d9df-40bd-94d5-c9f07b7fa203_017211c5-049f-46b5-a0f0-bcc46299e550.html)
  catalog, which syncs from Microsoft Graph. No Microsoft document naming it was found, and
  merill/microsoft-info does not list it.
- That `123cd850` is the app **behind** `https://ossrdbms-aad.database.windows.net` is inferred from
  the AADSTS65002 error: the only resource we request is that URI, and Entra named `123cd850` as the
  resource. No published mapping was found.
- That PostgreSQL, MySQL and DocumentDB all use that URI is documented on Microsoft Learn:
  [DocumentDB](https://learn.microsoft.com/azure/documentdb/how-to-connect-role-based-access-control),
  [PostgreSQL](https://learn.microsoft.com/azure/postgresql/security/security-entra-configure),
  [MySQL](https://learn.microsoft.com/azure/mysql/flexible-server/how-to-azure-ad).

### What "preauthorization" means, and who can grant it

- Normally a client app gets permission to call an API through **consent**: the user or tenant admin
  approves it.
- When both the client and the API are **Microsoft first-party** apps, tenant consent is not
  available. The API owner must list the client in the API's **preauthorized applications**. That is
  what AADSTS65002 says: "applications owned and operated by Microsoft must get approval from the API
  owner".
- Each national cloud (Public, US Government, China, and others) is a separate Entra deployment.
  First-party app IDs are usually the same in every cloud. **Inferred, not confirmed:** each cloud
  holds its own preauthorization configuration, so a client can be preauthorized in one cloud and
  not another. This follows from the public error text, the vscode-mssql precedent below and
  standard Entra behavior; no published document states it. In Public cloud, VS Code can get
  OSSRDBMS tokens (Entra sign-in works there). In US Government it evidently cannot.

So (the last two rows are inferred, see above):

| Actor                                  | Can fix it? | Why                                                                                                         |
| -------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| A user or their tenant admin           | **No**      | First-party to first-party consent cannot be granted by a tenant.                                           |
| This extension, in code                | **No**      | We do not own a client ID; we use VS Code's. Changing the scope does not change who is asking.              |
| Microsoft, the OSSRDBMS resource owner | **Yes**     | Adds `aebc6443` to the preauthorized applications of `123cd850` in the US Government directory (and China). |
| Microsoft, the VS Code auth team       | Indirectly  | Owns `aebc6443`; may need to be involved or may already have a request process for this.                    |

Because the client ID is shared, the fix also unblocks any other VS Code extension that requests
OSSRDBMS tokens in US Government, for example a PostgreSQL extension.

### Using our own client ID instead (not recommended)

VS Code honors a `VSCODE_CLIENT_ID:<guid>` pseudo-scope that swaps in a different app registration.
This does not avoid the problem: our own app would need either first-party status plus the same
preauthorization from the OSSRDBMS owner, or third-party consent in every customer tenant, and a
separate registration in every national cloud. The extensions that use `VSCODE_CLIENT_ID` (API
Management, API Center, Fabric) do so for their own APIs, not to bypass a first-party gap.

## 3. Precedent: the same failure for Azure SQL, fixed by configuration

[microsoft/vscode-mssql#22296](https://github.com/microsoft/vscode-mssql/issues/22296),
"Sovereign Cloud Universal with MFA Support auth error", closed as resolved.

- Two US Government tenants, server `*.database.usgovcloudapi.net`.
- With the broker (`microsoft-authentication.implementation = msal`, the default) the extension
  received only `platform_broker_error: See https://aka.ms/msal.js.errors#platform_broker_error for details`.
- With `msal-no-broker` the extension received the full text: `invalid_request - AADSTS65002: Consent
between first party application 'aebc6443-…' and first party resource '022907d3-…' must be
configured via preauthorization …` (`022907d3` is Azure SQL Database).
- Resolution stated in the issue: a configuration update in the US Government cloud, made by the
  service side.

No extension code changed. This is the model for track 1.

Two consequences for track 3:

1. On Windows with the default broker, the error that reaches our code contains only
   `platform_broker_error: See https://aka.ms/msal.js.errors#platform_broker_error for details`, not
   the AADSTS code or the preauthorization text. Evidence: the vscode-mssql reproduction steps; VS
   Code's `microsoft-authentication` provider rethrows the MSAL error unchanged; and the Azure tools
   auth package (6.0.0-alpha.5, microsoft/vscode-azuretools#2215) treats the message as opaque. The
   detailed text in the broker's own dialog does not reach the extension. The classifier must handle
   both shapes.
2. The user can still see the code: the system sign-in window shows it (users in
   [microsoft/vscode#244689](https://github.com/microsoft/vscode/issues/244689) reported
   `CAA20002, AADSTS65002` on screen). Messages should ask for it rather than guess it.
3. `microsoft-authentication.implementation = msal-no-broker` makes the AADSTS code reach the
   extension, but it is a global user setting, and sovereign-cloud tokens are currently not kept in
   that mode ([microsoft/vscode#307340](https://github.com/microsoft/vscode/issues/307340), open). It
   is a manual diagnostic step only; the extension must never change it.

### A second precedent: VS Code's own client in China

[microsoft/vscode#244689](https://github.com/microsoft/vscode/issues/244689): Azure sign-in in Azure
China failed with AADSTS65002 for VS Code's client. The VS Code maintainers raised it with the
identity team and the issue was closed after a service-side fix. Same pattern as vscode-mssql#22296:
a configuration change outside the client code.

## 4. Why listing works but connecting fails

| Step                                                                     | Scope requested                                                                                        | Result in US Gov                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| Listing subscriptions and clusters (Azure Resources, our Discovery view) | ARM, built from `subscription.environment.resourceManagerEndpointUrl` (`management.usgovcloudapi.net`) | Works: VS Code is preauthorized for ARM |
| Connecting to the cluster (`MicrosoftEntraIDAuthHandler`)                | `https://ossrdbms-aad.database.windows.net/.default` (hardcoded)                                       | AADSTS65002                             |

Our management path already follows the selected cloud: `azureClients.ts` passes the full
`AzureSubscription` (with `environment`) into `createSubscriptionContext()` and `createAzureClient()`.
`vscode-cosmosdb` and Azure Resources do the same.

## 5. Per-cloud OSSRDBMS token resource

`getConfiguredAzureEnv()` in `@microsoft/vscode-azext-azureauth` returns an `Environment` from
`@azure/ms-rest-azure-env` based on `microsoft-sovereign-cloud.environment`. That `Environment` has
**no** OSSRDBMS field.

ARM's cloud metadata endpoint does publish it, with api-version `2022-09-01` (not with the older
`2019-05-01`). Each cloud's endpoint is public and unauthenticated:

| Endpoint                                                                         | `ossrDbmsResourceId`                              | `suffixes.sqlServerHostname` |
| -------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------- |
| `https://management.azure.com/metadata/endpoints?api-version=2022-09-01`         | `https://ossrdbms-aad.database.windows.net`       | `database.windows.net`       |
| `https://management.usgovcloudapi.net/metadata/endpoints?api-version=2022-09-01` | `https://ossrdbms-aad.database.usgovcloudapi.net` | `database.usgovcloudapi.net` |
| `https://management.chinacloudapi.cn/metadata/endpoints?api-version=2022-09-01`  | `https://ossrdbms-aad.database.chinacloudapi.cn`  | `database.chinacloudapi.cn`  |

These values match Azure CLI's static table, which uses them as a fallback when ARM metadata lacks
the key. For the three built-in clouds a static table is therefore safe and needs no network call;
ARM metadata is the right source for custom clouds.

| `getConfiguredAzureEnv().name` | Setting value  | OSSRDBMS resource                                 | Sources                                                                                                                        |
| ------------------------------ | -------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `AzureCloud`                   | (unset)        | `https://ossrdbms-aad.database.windows.net`       | Azure CLI `cloud.py`; DocumentDB docs                                                                                          |
| `AzureUSGovernment`            | `USGovernment` | `https://ossrdbms-aad.database.usgovcloudapi.net` | Azure CLI `cloud.py`; US Government ARM metadata                                                                               |
| `AzureChinaCloud`              | `ChinaCloud`   | `https://ossrdbms-aad.database.chinacloudapi.cn`  | Azure CLI `cloud.py`; [DocumentDB China docs](https://docs.azure.cn/en-us/documentdb/how-to-connect-role-based-access-control) |
| custom                         | `custom`       | from the custom cloud's ARM metadata, if present  | that cloud's `/metadata/endpoints`                                                                                             |

Azure CLI also lists `cloudapi.de` (retired German cloud), `sovcloud-api.fr` and `sovcloud-api.de`
(Bleu, Delos). VS Code's setting can reach those only through `custom`.

**Public, China:** Microsoft's DocumentDB documentation for Azure China uses
`TOKEN_RESOURCE:https://ossrdbms-aad.database.chinacloudapi.cn`, with cluster hosts
`<name>.mongocluster.cosmos.azure.cn` and `<name>.global.mongocluster.cosmos.azure.cn`
([connect with Entra ID](https://docs.azure.cn/en-us/documentdb/how-to-connect-role-based-access-control),
[regional availability](https://docs.azure.cn/zh-cn/documentdb/regional-availability)).

**Unverified, US Government:** that Azure DocumentDB accepts tokens whose audience is the
`usgovcloudapi.net` URI. US Government ARM metadata and Azure CLI publish it as the OSSRDBMS resource,
and the China documentation follows the same per-cloud pattern, so it is very likely, but no
DocumentDB document for US Government confirms it.

**Unverified, US Government:** DocumentDB availability and host suffix. They are not publicly
documented; `mongocluster.cosmos.azure.us` is an assumption, which our ALLOWED_HOSTS code already
makes.

**Unverified, all sovereign clouds:** whether a cluster also accepts the public `windows.net`
audience.

## 6. How other extensions handle sovereign clouds

| Extension                                      | Management plane                                                                         | Data-plane token                                                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Azure Resources (`vscode-azureresourcegroups`) | `subscription.environment`; cloud picker writes `microsoft-sovereign-cloud.environment`  | n/a                                                                                                          |
| `vscode-azuretools` auth package               | `getConfiguredAzureEnv()`, `getConfiguredAuthProviderId()` choose authority and provider | Callers pass their own scopes                                                                                |
| `vscode-cosmosdb`                              | `subscription.environment` into ARM clients, with sovereign tests                        | Lets the Cosmos SDK derive scopes from the account endpoint                                                  |
| `vscode-mssql`                                 | Own Azure config model                                                                   | Per-cloud resource descriptors (`sqlResource`, `ossRdbmsResource`) in a static table; same VS Code client ID |
| Azure CLI                                      | ARM metadata                                                                             | Static per-cloud `ossrdbms_resource_id`, used by `az account get-access-token --resource-type oss-rdbms`     |

The pattern that holds up without test access: **pick the cloud from the same source that picks the
authority** (`microsoft-sovereign-cloud.environment`), and map it to a static, closed table of
resources. Never build an audience from a hostname.

## 7. Workarounds for affected users

- Native DocumentDB username and password, if enabled on the cluster.
- To confirm the diagnosis: read the code in the system sign-in window, or open **Developer: Show
  Logs… → Microsoft Sovereign Cloud Authentication**. Whether that log contains the inner broker error
  is unverified. Setting `microsoft-authentication.implementation` to `msal-no-broker` also exposes the
  code, with the caveat in §3.
- **Unverified:** an Azure CLI token (`az account get-access-token --resource-type oss-rdbms`) uses
  the Azure CLI client ID, which is probably preauthorized for OSSRDBMS in US Government because the
  PostgreSQL docs recommend it there. The extension cannot consume such a token today.

## 8. Managed identity: which cloud is the VM in?

Managed identity tokens come from the VM's instance metadata service (IMDS), not from VS Code's
sign-in, so `microsoft-sovereign-cloud.environment` says nothing about them.

- IMDS documents `compute.azEnvironment`, "Azure Environment where the VM is running in", since
  api-version 2018-10-01. The only documented value is `AZUREPUBLICCLOUD`; values for other clouds are
  not documented ([Instance Metadata Service](https://learn.microsoft.com/azure/virtual-machines/instance-metadata-service)).
- The cluster host is a stronger signal: managed identity needs the VM and the cluster in the same
  tenant, hence the same cloud. `.mongocluster.cosmos.azure.cn` identifies China (public docs above).
- Azure China region names (`chinaeast`, `chinaeast2`, `chinaeast3`, `chinanorth`, `chinanorth2`,
  `chinanorth3`) are public ([regions list](https://docs.azure.cn/zh-cn/reliability/regions-list)).

## 9. Open questions

1. Who owns `123cd850` in US Government and China, and what is the request process?
2. Is VS Code `aebc6443` preauthorized for OSSRDBMS in China? In other national clouds?
3. Which audiences does a DocumentDB cluster accept in US Government and China? In particular, does
   Entra sign-in to China clusters work today with the public audience? If it does, switching to the
   per-cloud audience could break those users. Check telemetry for successful Entra connections to
   `*.azure.cn` hosts before shipping.
4. DocumentDB availability and host suffix in US Government (not publicly documented).
5. `compute.azEnvironment` values outside the public cloud.
6. Does the Microsoft Sovereign Cloud Authentication log contain the inner broker error?

Answered: on Windows with the broker, only `platform_broker_error` reaches the extension (§3).
