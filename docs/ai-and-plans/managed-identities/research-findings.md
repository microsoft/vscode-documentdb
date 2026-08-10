# Managed Identity Support: Research Findings

**Status:** Research complete
**Date:** 2026-08-10
**Purpose:** Capture the evidence behind `managed-identities.md` so nobody has to redo this
investigation. Every claim below was verified against source, `node_modules`, or Microsoft Learn.

---

## 1. The incident

Reported repro (paraphrased from the incident thread):

1. Provision an Azure VM, enable a user-assigned managed identity on it.
2. Register that identity in an Azure DocumentDB (vCore) cluster.
3. On the VM, in VS Code with our extension, try to connect using Entra ID. It fails.

The thread's working theory was:

> The standard `MyEntraIdCallback : IOidcCallback` won't know which MSI to pick, because we omit
> the user name from the Entra connection string.

### Verdict: the theory describes the wrong layer

The theory is a correct description of a problem that **a driver-level or
`DefaultAzureCredential`-based implementation** would have. It is not what our extension does.

Our `MicrosoftEntraIDAuthHandler` never contacts the Azure Instance Metadata Service (IMDS) at all.
It asks the **interactive, signed-in VS Code user** for a token:

```ts
// src/documentdb/auth/MicrosoftEntraIDAuthHandler.ts
const session = await getSessionFromVSCode(
  ['https://ossrdbms-aad.database.windows.net/.default'],
  this.clusterCredentials.entraIdConfig?.tenantId,
  { createIfNone: true },
);
```

`getSessionFromVSCode` is a thin wrapper over `vscode.authentication.getSession('microsoft', ...)`.
There is no managed identity in that path, ambiguous or otherwise.

The "which MSI" ambiguity is real, and we will hit it the moment we add managed identity support,
but it is the _next_ problem, not the current one. The current failure mode is simply: **the VM's
managed identity is never used, so the cluster rejects whatever user token happened to be
available (or no interactive user is signed in at all).**

### Secondary contributing factor

Even if a user pastes the documented connection string with the client ID in the username position,
we discard it:

```ts
// src/documentdb/auth/MicrosoftEntraIDAuthHandler.ts
dbConnectionString.username = ''; // required to move forward with Entra ID
dbConnectionString.password = ''; // required to move forward with Entra ID
```

---

## 2. What our extension has today

Verified by reading the source on branch `dev/tnaum/managed-identities`.

| Concern                             | Location                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| Auth method enum (3 values)         | `src/documentdb/auth/AuthMethod.ts`                                                               |
| Auth config shapes                  | `src/documentdb/auth/AuthConfig.ts`                                                               |
| Handler interface                   | `src/documentdb/auth/AuthHandler.ts`                                                              |
| Handler selection (switch)          | `src/documentdb/ClustersClient.ts`, `initClient()`                                                |
| Entra ID handler                    | `src/documentdb/auth/MicrosoftEntraIDAuthHandler.ts`                                              |
| OIDC host allowlist                 | `src/documentdb/auth/oidcAllowedHosts.ts`                                                         |
| Runtime credential cache            | `src/documentdb/CredentialCache.ts`                                                               |
| Persisted connection shape          | `src/services/connectionStorageService.ts`                                                        |
| Auth method quick pick              | `src/documentdb/wizards/authenticate/ChooseAuthMethodStep.ts`                                     |
| Auth method inference from conn str | `src/commands/newConnection/PromptConnectionStringStep.ts`                                        |
| Auth method from ARM metadata       | `src/plugins/service-azure-mongo-vcore/utils/clusterHelpers.ts`                                   |
| Playground / shell worker protocol  | `src/documentdb/playground/workerTypes.ts`                                                        |
| Worker-side OIDC callback           | `src/documentdb/playground/playgroundWorker.ts`                                                   |
| Main-thread token broker            | `src/documentdb/playground/PlaygroundEvaluator.ts`, `src/documentdb/shell/ShellSessionManager.ts` |

### Current enum

```ts
export enum AuthMethodId {
  NativeAuth = 'NativeAuth',
  MicrosoftEntraID = 'MicrosoftEntraID',
  NoAuth = 'NoAuth',
}
```

### Current handler dispatch

```ts
// src/documentdb/ClustersClient.ts
const authMethod = credentials?.authMechanism ?? AuthMethodId.NativeAuth;

let authHandler: AuthHandler;
switch (authMethod) {
  case AuthMethodId.NativeAuth:
    authHandler = new NativeAuthHandler(credentials);
    break;
  case AuthMethodId.MicrosoftEntraID:
    authHandler = new MicrosoftEntraIDAuthHandler(credentials);
    break;
  case AuthMethodId.NoAuth:
    authHandler = new NoAuthHandler(credentials);
    break;
  default:
    throw new Error(l10n.t('Unsupported authentication method: {0}', authMethod));
}
```

The architecture is clean and extension-friendly: adding a fourth method is a localized change.

### Where Entra ID becomes "available"

Two independent sources:

1. **Pasted connection string** (`PromptConnectionStringStep.ts`), host-suffix based:

   ```ts
   const supportedAuthMethods: AuthMethodId[] = [AuthMethodId.NativeAuth];
   if (hasDomainSuffix(AzureDomains.vCore, ...parsedConnectionString.hosts)) {
     supportedAuthMethods.push(AuthMethodId.MicrosoftEntraID);
   }
   supportedAuthMethods.push(AuthMethodId.NoAuth);
   ```

2. **ARM cluster metadata** (`clusterHelpers.ts`), from `properties.authConfig.allowedModes`:

   ```ts
   const allowedModes = clusterInformation.properties?.authConfig?.allowedModes ?? [];
   credentials.availableAuthMethods = allowedModes.filter(isSupportedAuthMethod);

   if (credentials.availableAuthMethods.includes(AuthMethodId.MicrosoftEntraID)) {
     credentials.entraIdAuthConfig = {
       tenantId: subscription.tenantId,
       subscriptionId: subscription.subscriptionId,
     };
   }
   ```

   Because `AuthMethodId` values were deliberately named to match the ARM `allowedModes` strings
   (`NativeAuth`, `MicrosoftEntraID`), the filter is a direct pass-through. **This matters for the
   plan:** a new `ManagedIdentity` enum value has no counterpart in `allowedModes` and must
   therefore be added by explicit rule rather than by pass-through.

### Persisted shape

```ts
export interface ConnectionProperties extends Record<string, unknown> {
  type: ItemType.Connection;
  parentId?: string;
  api: API;
  emulatorConfiguration?: { isEmulator: boolean; disableEmulatorSecurity: boolean };
  availableAuthMethods: string[];
  selectedAuthMethod?: string; // string, not the enum, on purpose (forward-compat)
}

export interface ConnectionSecrets {
  connectionString: string; // credential-free
  nativeAuthConfig?: NativeAuthConfig;
  entraIdAuthConfig?: EntraIdAuthConfig;
}
```

Note `CredentialCache.setFromConnectionItem()` **infers** the auth method when it is not explicitly
passed, in a fixed priority order (`NoAuth` explicit, then `entraIdAuthConfig`, then
`nativeAuthConfig`, then fallbacks). A fourth method has to be inserted into that ladder or it will
silently resolve to something else after a reload.

### Token expiry bug (pre-existing)

```ts
OIDC_CALLBACK: (_params: OIDCCallbackParams): Promise<OIDCResponse> =>
    Promise.resolve({ accessToken: session.accessToken, expiresInSeconds: 0 }),
```

`expiresInSeconds: 0` tells the driver the token is already expired, which disables its token cache.
Meanwhile `playgroundWorker.ts` does it correctly:

```ts
let expiresInSeconds = 3500;
const payload = accessToken.split('.')[1];
const decoded = JSON.parse(Buffer.from(payload, 'base64').toString()) as { exp?: number };
if (typeof decoded.exp === 'number') {
  expiresInSeconds = Math.max(0, decoded.exp - Math.floor(Date.now() / 1000));
}
```

Two implementations of the same idea, one of them wrong. Cheap for interactive Entra ID (the VS Code
session is itself cached); more expensive once every miss is an IMDS round-trip.

---

## 3. Does VS Code have a managed identity API?

**No.** Verified by grepping the `@types/vscode` `index.d.ts` bundled in this repo.

The entire authentication surface is:

- `vscode.authentication.getSession(providerId, scopeListOrRequest, options)` (4 overloads)
- `vscode.authentication.registerAuthenticationProvider(...)`
- `vscode.authentication.onDidChangeSessions`

There is **no** occurrence of "managed identity", "ManagedIdentity", or IMDS anywhere in the API
surface. The built-in `microsoft` provider is MSAL-based interactive user authentication.
`@microsoft/vscode-azext-azureauth` wraps the same API and inherits the same limitation.

**Conclusion:** managed identity has to come from outside the VS Code API. Two candidates, both
already available to us.

### Candidate A: `@azure/identity`

Already a declared dependency and **currently unused in `src/`**:

```jsonc
// package.json
"@azure/identity": "~4.13.0",
```

`ManagedIdentityCredential` supports four constructor shapes:

```ts
// node_modules/@azure/identity/dist/commonjs/credentials/managedIdentityCredential/index.d.ts
constructor(clientId: string, options?: TokenCredentialOptions);
constructor(options?: ManagedIdentityCredentialClientIdOptions);
constructor(options?: ManagedIdentityCredentialResourceIdOptions);
constructor(options?: ManagedIdentityCredentialObjectIdOptions);
```

So `clientId`, `resourceId`, and `objectId` selectors are all available. It covers IMDS VMs, App
Service / Functions / Container Apps (`IDENTITY_ENDPOINT` protocol), Azure Arc, Cloud Shell, and
Service Fabric.

> **Scope note.** That list describes what the **library** supports, not what we claim. Per
> [D0](./decisions.md#d0-supported-platforms-azure-vms-only) this work targets, documents, and tests
> **Azure VMs only**. The broader coverage is a property we inherit for free and do not block; it is
> not a promise. The `IDENTITY_ENDPOINT` protocol is nonetheless used as a **local test mechanism**
> (see D7).

### Candidate B: the MongoDB Node.js driver's built-in Azure machine flow

We ship `mongodb@^7.1.0`, which supports this natively:

```ts
// node_modules/mongodb/mongodb.d.ts
export declare interface AuthMechanismProperties extends Document {
  OIDC_CALLBACK?: OIDCCallbackFunction;
  OIDC_HUMAN_CALLBACK?: OIDCCallbackFunction;
  /** The OIDC environment. Note that 'test' is for internal use only. */
  ENVIRONMENT?: 'test' | 'azure' | 'gcp' | 'k8s';
  ALLOWED_HOSTS?: string[];
  /** The resource token for OIDC auth in Azure and GCP. */
  TOKEN_RESOURCE?: string;
}
```

**Critically, the driver maps the connection-string username to the IMDS `client_id`.** Verified in
the shipped JavaScript:

```js
// node_modules/mongodb/lib/cmap/auth/mongodb_oidc/azure_machine_workflow.js
const AZURE_HEADERS = Object.freeze({ Metadata: 'true', Accept: 'application/json' });

const azureCallback = async (params) => {
    const tokenAudience = params.tokenAudience;
    const username = params.username;
    if (!tokenAudience) throw new MongoAzureError(TOKEN_RESOURCE_MISSING_ERROR);
    const response = await getAzureTokenData(tokenAudience, username);
    ...
};
```

```js
// node_modules/mongodb/lib/client-side-encryption/providers/azure.js
const AZURE_BASE_URL = 'http://169.254.169.254/metadata/identity/oauth2/token?';

function addAzureParams(url, resource, username) {
  url.searchParams.append('api-version', '2018-02-01');
  url.searchParams.append('resource', resource);
  if (username) {
    url.searchParams.append('client_id', username);
  }
  return url;
}
```

This is exactly why the documented connection string puts the client ID in the username position.
Note it is **hardcoded to the IMDS endpoint**: no App Service, no Arc, no workload identity.

---

## 4. Prior art

### 4.1 vscode-cosmosdb (our partner extension)

Relevant files: `src/cosmosdb/AuthenticationMethod.ts`, `src/cosmosdb/CosmosDBCredential.ts`,
`src/cosmosdb/utils/managedIdentityUtils.ts`, `src/cosmosdb/getCosmosClient.ts`,
`src/cosmosDBShell/nodeCredentials.ts`.

```ts
export enum AuthenticationMethod {
  auto = 'auto',
  accountKey = 'accountKey',
  entraId = 'entraId',
  managedIdentity = 'managedIdentity',
}
```

**IMDS probe** (fired at extension activation, cached, single-flight):

```ts
// Uses a 10-second timeout to prevent hanging in non-Azure environments
const response = await fetch('http://169.254.169.254/metadata/versions', {
  headers: { Metadata: 'true' },
  signal: controller.signal,
});
```

**But it is not purely IP detection.** There is an explicit escape hatch:

```ts
export async function getManagedIdentityAuth(
  accountEndpoint: string,
  force: boolean,
): Promise<CosmosDBManagedIdentityCredential | undefined> {
  // If not forcing and not on Azure, return early
  if (!force && !(await getIsRunningOnAzure())) return undefined;

  const managedIdentityClientId = vscode.workspace
    .getConfiguration()
    .get<string>(ext.settingsKeys.authManagedIdentityClientId);

  if (force || (await getHasManagedIdentity(accountEndpoint, managedIdentityClientId, !force))) {
    return { type: AuthenticationMethod.managedIdentity, clientId: managedIdentityClientId };
  }
  return undefined;
}
```

So the model is: a `preferredAuthenticationMethod` setting where `managedIdentity` forces it
unconditionally and `auto` falls back to the IMDS probe, plus an `authManagedIdentityClientId`
setting for the user-assigned client ID. Token acquisition is
`new ManagedIdentityCredential({ clientId })`. They then run an ordered credential fallback chain in
`getCosmosClient`, plus a last-resort forced interactive Entra ID attempt.

They also thread it into their shell:

```ts
// For user-assigned managed identity, pass the client ID via CLI arg
if (managedIdentityCredential?.clientId) {
  args.push('--connect-managed-identity', managedIdentityCredential.clientId);
}
```

**Scope: Cosmos DB NoSQL only.** They never did this for Mongo vCore, so there is nothing directly
liftable, only the shape of the solution.

**Assessment:** the settings-based escape hatch is good; the `auto` probe-gated default is the part
worth avoiding. A 10-second IMDS timeout on a non-Azure machine is also a latency trap if it ever
ends up on a blocking path.

### 4.2 vscode-mssql (large user base, most battle-tested)

`AuthenticationType` is a first-class, explicit field on the connection profile. No environment
sniffing anywhere:

```ts
// extensions/mssql/src/sharedInterfaces/connectionDialog.ts
export enum AuthenticationType {
  SqlLogin = 'SqlLogin',
  Integrated = 'Integrated',
  AzureMFA = 'AzureMFA', // interactive Entra ID
  ActiveDirectoryDefault = 'ActiveDirectoryDefault', // DefaultAzureCredential chain
  ActiveDirectoryServicePrincipal = 'ActiveDirectoryServicePrincipal',
  DSTSAuth = 'dstsAuth',
  None = 'None',
}
```

The connection dialog shows or hides the `user` field per auth type:

```ts
// extensions/mssql/src/connectionconfig/connectionDialogWebviewController.ts
// userId is required for SQL Login and Service Principal, optional for AD Default, and hidden for everything else
```

That "optional for AD Default" is the whole trick. From the SqlClient documentation
(<https://learn.microsoft.com/sql/connect/ado-net/sql/azure-active-directory-authentication>):

> **ManagedIdentityCredential** - Attempts authentication with Microsoft Entra ID using a managed
> identity that is assigned to the deployment environment. **"Client Id" of "User Assigned Managed
> Identity" is read from the "User Id" connection property.**

And there is a dedicated mode as well:

```text
Authentication=Active Directory Managed Identity; User Id=ClientIdOfManagedIdentity; ...
Authentication=Active Directory MSI;              User Id=ClientIdOfManagedIdentity; ...
Authentication=Active Directory Workload Identity; User Id=ClientIdOfManagedIdentity; ...
```

Their own migration guidance table:

| Scenario                         | Recommended mode                     |
| -------------------------------- | ------------------------------------ |
| Interactive / desktop apps       | `Active Directory Interactive`       |
| Service-to-service               | `Active Directory Service Principal` |
| Azure-hosted workloads           | `Active Directory Managed Identity`  |
| Developer / CI environments      | `Active Directory Default`           |
| Kubernetes / federated workloads | `Active Directory Workload Identity` |

They also explicitly warn that `Active Directory Default` "can come with performance impacts because
it has to look in multiple places for authentication information" and is "not recommended for
environments that have strict service level response times". Worth remembering if we ever add it.

**Assessment: this is the pattern to copy.** Explicit auth mode plus the identity selector in the
user field. It scales to service principal and workload identity later without another redesign.

---

## 5. What the DocumentDB service actually expects

Source: <https://learn.microsoft.com/azure/documentdb/how-to-connect-role-based-access-control>

### 5.1 Documented connection string for a managed identity

From the section "Connect using Microsoft Entra ID in MongoDB Compass or MongoDB Shell":

```text
mongodb+srv://<client-id>@<cluster-name>.global.mongocluster.cosmos.azure.com/?tls=true&authMechanism=MONGODB-OIDC&retrywrites=false&maxIdleTimeMS=120000&authMechanismProperties=ENVIRONMENT:azure,TOKEN_RESOURCE:https://ossrdbms-aad.database.windows.net
```

The steps preceding it are exactly the incident repro: create an Azure VM, attach a system-assigned
or user-assigned managed identity, register that identity on the cluster, then connect.

Note this is the **driver-native path** (candidate B), and it confirms:

- username position carries the **client ID** of the user-assigned managed identity
- `TOKEN_RESOURCE` is `https://ossrdbms-aad.database.windows.net` (matches the scope we already use)
- `ENVIRONMENT:azure` triggers the driver's IMDS workflow

### 5.2 The documented VS Code flow is currently wrong

From the section "Connect using Microsoft Entra ID in Visual Studio Code", which names our
extension by repository URL:

```text
mongodb+srv://<client-id>@<cluster-name>.global.mongocluster.cosmos.azure.com/?tls=true&authMechanism=MONGODB-OIDC&retrywrites=false&maxIdleTimeMS=120000
```

> Wait for the automatic prompt to use Microsoft Entra ID authentication. Enter the appropriate
> credentials for your identity type.

We strip the username, so `<client-id>` is silently dropped and there is no "identity type" concept
in our prompt. **Either we make this true or the doc needs a correction.** Tracked as a work item.

(The same section also claims shell functionality is unsupported with Entra ID, which is stale.)

### 5.3 There is no separate cluster-side "ManagedIdentity" auth mode

`properties.authConfig.allowedModes` only ever contains `NativeAuth` and/or `MicrosoftEntraID`.
Principal type is a property of the **registered user resource**, not of the cluster:

```bash
az resource create \
    --name "<cluster-name>/users/<principal-id>" \
    --resource-type "Microsoft.DocumentDB/mongoClusters/users" \
    --properties '{"identityProvider":{"type":"MicrosoftEntraID","properties":{"principalType":"User"}},"roles":[...]}'
```

> Replace `principalType` with `servicePrincipal` for app/service principals or `ManagedIdentity`
> for managed identities.

**Implication for us:** on the wire, managed identity _is_ Entra ID. Only the token source differs.
Therefore `ManagedIdentity` must be offered wherever `MicrosoftEntraID` is offered, added by rule
rather than read from `allowedModes`.

### 5.4 Documented Node.js reference implementation

```ts
const AzureIdentityTokenCallback = async (
  params: OIDCCallbackParams,
  credential: TokenCredential,
): Promise<OIDCResponse> => {
  const tokenResponse: AccessToken | null = await credential.getToken([
    'https://ossrdbms-aad.database.windows.net/.default',
  ]);
  return {
    accessToken: tokenResponse?.token || '',
    expiresInSeconds: (tokenResponse?.expiresOnTimestamp || 0) - Math.floor(Date.now() / 1000),
  };
};

const credential: TokenCredential = new DefaultAzureCredential();

const client = new MongoClient(`mongodb+srv://${clusterName}.global.mongocluster.cosmos.azure.com/`, {
  connectTimeoutMS: 120000,
  tls: true,
  retryWrites: true,
  authMechanism: 'MONGODB-OIDC',
  authMechanismProperties: {
    OIDC_CALLBACK: (params: OIDCCallbackParams) => AzureIdentityTokenCallback(params, credential),
    ALLOWED_HOSTS: ['*.azure.com'],
  },
});
```

Two things to take from this:

1. It is structurally identical to our existing handler, so candidate A drops straight in.
2. **`ALLOWED_HOSTS` is used together with a machine callback in the official sample**, which
   answers the open question about whether the two can coexist. (Still worth an empirical smoke
   test, but the documented sample is strong evidence.)
3. It computes `expiresInSeconds` properly from `expiresOnTimestamp`, unlike our handler.

### 5.5 Token lifetime and revocation

> Existing tokens remain valid until they expire (typically up to 90 minutes from the issuance of
> the token).

Relevant to the caching fix: a 90 minute ceiling means honouring `exp` is safe and worthwhile.

---

## 6. The multi-identity ambiguity

Confirmed as a real hazard, and the reason the client ID is not optional in practice.

- If a VM has **one** system-assigned identity and no user-assigned ones, IMDS resolves without a
  selector.
- If a VM has **one** user-assigned identity and no system-assigned one, IMDS resolves it.
- If a VM has **more than one** candidate identity and no `client_id` / `object_id` / `msi_res_id`
  is supplied, IMDS cannot choose and fails.

The incident thread notes that an Azure VM with a user-assigned managed identity commonly ends up
with two MSI identities, the extra one being security-tooling related. That matches the failure
class above, and it is why the plan makes the identity selector a first-class, explicit input rather
than something we try to infer.

---

## 7. Summary of the decision-relevant facts

| Question                                                        | Answer                                                            |
| --------------------------------------------------------------- | ----------------------------------------------------------------- |
| Can VS Code give us a managed identity token?                   | No. No such API exists.                                           |
| Do we already have a library that can?                          | Yes, `@azure/identity` ~4.13.0, declared but unused.              |
| Can the driver do it without any credential library?            | Yes, `ENVIRONMENT: 'azure'` + `TOKEN_RESOURCE`, IMDS only.        |
| Does the driver read the client ID from the connection string?  | Yes, username maps to IMDS `client_id`.                           |
| Does the cluster expose a distinct managed identity auth mode?  | No. It is `MicrosoftEntraID` on the wire.                         |
| Does our current code ever attempt a managed identity?          | No, not once.                                                     |
| Did our partner extension solve this for vCore?                 | No, Cosmos DB NoSQL only.                                         |
| What does the most battle-tested extension do?                  | Explicit auth type plus client ID in the user field. No sniffing. |
| Is there an existing token-caching defect to fix along the way? | Yes, `expiresInSeconds: 0` in the Entra ID handler.               |

---

## 8. Sources

- Azure DocumentDB role-based access control:
  <https://learn.microsoft.com/azure/documentdb/how-to-connect-role-based-access-control>
- SqlClient Microsoft Entra authentication:
  <https://learn.microsoft.com/sql/connect/ado-net/sql/azure-active-directory-authentication>
- `microsoft/vscode-cosmosdb`: `src/cosmosdb/utils/managedIdentityUtils.ts`,
  `src/cosmosdb/AuthenticationMethod.ts`, `src/cosmosdb/CosmosDBCredential.ts`
- `microsoft/vscode-mssql`: `src/sharedInterfaces/connectionDialog.ts`,
  `src/connectionconfig/connectionDialogWebviewController.ts`
- `node_modules/mongodb/lib/cmap/auth/mongodb_oidc/azure_machine_workflow.js`
- `node_modules/mongodb/lib/client-side-encryption/providers/azure.js`
- `node_modules/@azure/identity/dist/commonjs/credentials/managedIdentityCredential/index.d.ts`
- `node_modules/@types/vscode/index.d.ts`
