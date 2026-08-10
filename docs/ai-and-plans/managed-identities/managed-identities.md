# Managed Identity Support for Azure DocumentDB (vCore)

**Status:** Implemented on `dev/tnaum/managed-identities`, pending validation on the Azure VM repro.
**Progress:** see [`implementation-log.md`](./implementation-log.md) and [`manual-validation-checklist.md`](./manual-validation-checklist.md)
**Owner:** unassigned
**Branch:** `dev/tnaum/managed-identities`
**Companion docs:** [`research-findings.md`](./research-findings.md) (evidence),
[`decisions.md`](./decisions.md) (choices and rejected alternatives)

---

## Summary

Add **Managed Identity** as a first-class, explicitly selectable authentication method, so that
VS Code running on an **Azure VM** can authenticate to an Azure DocumentDB cluster using that VM's
managed identity instead of an interactive user sign-in.

Today this is impossible: our Entra ID path only ever asks the signed-in VS Code user for a token.

> **Platform scope.** Azure VMs only, per [D0](./decisions.md#d0-supported-platforms-azure-vms-only).
> The credential library we use also works on App Service, Container Apps, Arc-enabled servers and
> AKS, and we are not blocking that, but those hosts are not claimed, documented, or tested here.

---

## Problem

A customer provisioned an Azure VM with a user-assigned managed identity, registered that identity
on their DocumentDB (vCore) cluster, and then tried to connect from VS Code running on that VM using
"Entra ID". It failed.

The initial theory was that our OIDC callback could not decide which of the VM's managed identities
to use, because we omit the username from the connection string. That describes the wrong layer.

**Our extension never contacts the Instance Metadata Service at all.** `MicrosoftEntraIDAuthHandler`
calls `getSessionFromVSCode(...)`, which is `vscode.authentication.getSession('microsoft', ...)`,
which is interactive user authentication. There is no managed identity in that code path, ambiguous
or otherwise. See `research-findings.md` §1.

A secondary factor compounds it: even a correctly formed connection string carrying the identity's
client ID is discarded, because the handler blanks the username before connecting.

The multi-identity ambiguity from the original theory **is** real, and we will meet it as soon as we
implement this. It is handled explicitly in this design rather than inferred.

### Why our existing Entra ID support is not the thing to change

The interactive Entra ID path is working and battle-tested, including multi-tenant scenarios. This
work is purely **additive**: a fourth authentication method alongside it. The only change to the
existing path is a shared token-resource constant extraction (see WI2). The `expiresInSeconds: 0`
quirk in that handler is deliberately **left alone**; see
[D6.1](./decisions.md#d61-token-expiry-and-caching-out-of-scope-dedicated-issue).

---

## Goals

- A user on an **Azure VM** can connect to a DocumentDB cluster using the VM's system-assigned or a
  chosen user-assigned managed identity.
- Selecting the identity is **explicit**. No environment sniffing decides it for the user.
- Selecting the identity reuses the quick-pick pattern users have already met in the Atlas connect
  flow: manual entry first, known values below it.
- The connection string published in Microsoft Learn
  (`mongodb+srv://<client-id>@<cluster>...&authMechanismProperties=ENVIRONMENT:azure,...`) works when
  pasted into our New Connection flow.
- `Copy Connection String` on a managed-identity connection produces that same documented form, so it
  works in mongosh and application drivers on that VM **and** pastes back into our own flow.
- Failures produce readable messages, especially the multi-identity case that caused the incident.
- Works from all three entry points: Connections view, Azure Resources view, Discovery view.
- Works in Collection View, the Query Playground, and the Interactive Shell.

## Non-goals

- Azure hosting platforms other than VMs. See [D0](./decisions.md#d0-supported-platforms-azure-vms-only).
- Using the driver's own `ENVIRONMENT: 'azure'` machine flow **at runtime**. We read that form on
  input and normalise it away; the token always comes from `ManagedIdentityCredential`. See
  [D1](./decisions.md#d1-token-acquisition-mechanism).
- `DefaultAzureCredential` / "Active Directory Default" chained credential mode, MFA and Conditional
  Access behaviour, service principals, sovereign clouds. All tracked in the
  [D4](./decisions.md#d4-scope-managed-identity-only-not-a-general-default-credential-mode) issue,
  which is filed **after** this work lands.
- Workload identity federation as a distinct mode.
- Changing the existing interactive Entra ID token-expiry behaviour. See
  [D6.1](./decisions.md#d61-token-expiry-and-caching-out-of-scope-dedicated-issue).
- Actionable error remediation UI (commands, deep links). Plain-language translation only, see
  [D6.2](./decisions.md#d62-error-mapping-simplified-to-plain-language-translation).
- Any new VS Code settings. See [D5](./decisions.md#d5-no-vs-code-settings-for-managed-identity).
- Azure infrastructure provisioning of any kind. Validation on real hardware is delegated via a
  written checklist.

---

## Decisions at a glance

Confirmed 2026-08-10 except D3; see [`decisions.md`](./decisions.md) for reasoning and reversal
instructions.

| ID  | Decision                                                                                                                                                           | Status   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| D0  | Azure VMs only: what we claim, document, and test                                                                                                                  | Agreed   |
| D1  | `@azure/identity` `ManagedIdentityCredential` is the only engine; a pasted driver-native `ENVIRONMENT:azure` string is **normalised into our own config** on input | Agreed   |
| D1a | `Copy Connection String` emits that same documented form, no password prompt, round-trips with D1                                                                  | Agreed   |
| D2  | Identity chosen through an Atlas-pattern quick pick: manual entry first, known values below                                                                        | Agreed   |
| D3  | IMDS probe                                                                                                                                                         | **Open** |
| D4  | Managed identity only; chained credential, MFA, service principals tracked in an issue filed after this work                                                       | Agreed   |
| D5  | No new VS Code settings; per-connection configuration only                                                                                                         | Agreed   |
| D6  | Token-expiry fix deferred to an issue; error mapping simplified; `docs/` updated                                                                                   | Agreed   |
| D7  | Unit tests plus a fake identity-endpoint harness plus a manual checklist for the VM repro                                                                          | Agreed   |

---

## Conventions for the implementer

Read these before writing code. They are not negotiable and they are cheap to get wrong.

1. **No em dashes and no en dashes in user-facing strings.** Not in `vscode.l10n.t(...)` or
   `l10n.t(...)` values, not in quick-pick labels, details, placeholders, validation messages, error
   messages, notifications, tree item labels or descriptions, or `package.json` command titles. Use a
   comma, a colon, a full stop, or restructure the sentence. Verify with a grep for the two
   characters over the files you touched; the result must be empty. This applies to documentation
   added under `docs/` as well.
2. **Every user-facing string goes through `vscode.l10n.t()` / `l10n.t()`**, and `npm run l10n` runs
   before the PR is considered done.
3. **Never log or emit a credential.** The client ID is not a secret, but it is a stable
   tenant-scoped identifier: add it to `context.valuesToMask` and keep it out of telemetry.
4. **`any` is banned.** Use `unknown` plus a type guard. Explicit return types on all functions.
5. **Error handling in catch blocks** uses `error instanceof Error ? error.message : String(error)`.
6. **Cluster identity:** use `clusterId` for cache keys (`CredentialCache`, `ClustersClient`) and
   `treeId` for tree element paths. Getting this backwards produces bugs that only appear when a user
   moves a connection into a folder. See `.github/skills/tree-cluster-architecture/SKILL.md`.
7. **Terminology:** "DocumentDB" for the service, "MongoDB API" or "DocumentDB API" for the wire
   protocol. Never "MongoDB" alone as a product name, including in comments and test names.
8. **The five-step PR checklist** at the end of this document must pass before the work is done.

---

## Design

### 1. New authentication method

`src/documentdb/auth/AuthMethod.ts`:

```ts
export enum AuthMethodId {
  NativeAuth = 'NativeAuth',
  MicrosoftEntraID = 'MicrosoftEntraID',
  /** Microsoft Entra ID using the managed identity of the Azure resource hosting VS Code. */
  ManagedIdentity = 'ManagedIdentity',
  NoAuth = 'NoAuth',
}

export const ManagedIdentityAuthMethod: AuthMethodInfo = {
  id: AuthMethodId.ManagedIdentity,
  label: vscode.l10n.t('Managed Identity (Azure hosted)'),
  detail: vscode.l10n.t('Authenticate using the managed identity assigned to this machine'),
} as const;
```

Add to `authMethodsArray` between `MicrosoftEntraIDAuthMethod` and `NoAuthMethod`, so it renders
adjacent to the other Entra ID option.

> **Naming caveat.** `AuthMethodId` values double as the ARM `authConfig.allowedModes` vocabulary in
> `clusterHelpers.ts` (`allowedModes.filter(isSupportedAuthMethod)`). `ManagedIdentity` has no ARM
> counterpart, so it must be added by explicit rule (see §6), never by pass-through. If ARM ever
> introduces a mode with this exact name, revisit.
>
> Label wording is **confirmed**: keep "Managed Identity (Azure hosted)". The `detail` line carries
> the discovery hint that D3's probe was originally meant to provide, as static copy.
>
> **Revised in review, 2026-08-10.** The `detail` originally read "Use when VS Code is running on an
> Azure VM that has a managed identity assigned". It asserted a host type we never verify, and it
> broke the "Authenticate using..." parallel of the sibling entries. See the
> [implementation log](./implementation-log.md#post-review-host-type-wording).

### 2. Configuration type

`src/documentdb/auth/AuthConfig.ts`:

```ts
/**
 * Configuration for authenticating with the managed identity of the Azure VM
 * that is hosting VS Code.
 */
export interface ManagedIdentityAuthConfig {
  /**
   * Client ID of a user-assigned managed identity.
   * Omitted for the system-assigned identity.
   * Required whenever the host has more than one candidate identity, because the
   * instance metadata service cannot disambiguate on its own.
   */
  readonly clientId?: string;
}

export type AuthConfig = NativeAuthConfig | EntraIdAuthConfig | ManagedIdentityAuthConfig;
```

> **Important:** an "empty" config `{}` is meaningful (it means system-assigned). Persisting
> `undefined` instead of `{}` would make the method un-inferable after a reload. See §8.

### 3. `ManagedIdentityAuthHandler`

New file `src/documentdb/auth/ManagedIdentityAuthHandler.ts`, structurally parallel to
`MicrosoftEntraIDAuthHandler`:

```ts
export class ManagedIdentityAuthHandler implements AuthHandler {
  constructor(private readonly clusterCredentials: CachedClusterCredentials) {}

  public async configureAuth(): Promise<AuthHandlerResponse> {
    // Dynamic import: @azure/identity pulls in MSAL and must stay out of the activation path.
    const { ManagedIdentityCredential } = await import('@azure/identity');

    const clientId = this.clusterCredentials.managedIdentityConfig?.clientId;
    const credential = clientId ? new ManagedIdentityCredential({ clientId }) : new ManagedIdentityCredential();

    const dbConnectionString = new DocumentDBConnectionString(this.clusterCredentials.connectionString);
    dbConnectionString.username = '';
    dbConnectionString.password = '';
    dbConnectionString.searchParams.delete('authMechanism');
    dbConnectionString.searchParams.delete('authMechanismProperties');
    dbConnectionString.searchParams.delete('tls');

    const options: MongoClientOptions = {
      authMechanism: 'MONGODB-OIDC',
      tls: true,
      authMechanismProperties: {
        ALLOWED_HOSTS: getOidcAllowedHosts(this.clusterCredentials.connectionString),
        OIDC_CALLBACK: async (): Promise<OIDCResponse> => {
          let token: AccessToken | null;
          try {
            token = await credential.getToken(ENTRA_DOCUMENTDB_SCOPE);
          } catch (error) {
            throw new Error(describeManagedIdentityError(error, clientId));
          }
          if (!token) {
            throw new Error(describeManagedIdentityError(undefined, clientId));
          }
          return {
            accessToken: token.token,
            expiresInSeconds: expiresInSecondsFromTimestamp(token.expiresOnTimestamp),
          };
        },
      },
    };

    // Same host-gated TLS exception policy as every other handler.
    if (
      resolveAllowInvalidCertificates(
        this.clusterCredentials.emulatorConfiguration?.disableEmulatorSecurity,
        this.clusterCredentials.connectionString,
      )
    ) {
      options.tlsAllowInvalidCertificates = true;
    }

    return { connectionString: dbConnectionString.toString(), options };
  }
}
```

Notes:

- **`authMechanismProperties` must be stripped from the URL.** We pass `authMechanismProperties` via
  `MongoClientOptions`; leaving a competing `authMechanismProperties=ENVIRONMENT:azure,...` in the
  connection string risks the driver merging or preferring the URL form and taking its own IMDS path.
  Needs an explicit test (WI14).
- The scope constant `https://ossrdbms-aad.database.windows.net/.default` is currently duplicated in
  three places (`MicrosoftEntraIDAuthHandler.ts`, `playgroundWorker.ts`, and implicitly in the shell
  path). Extract it to a shared constant while adding the fourth consumer.
- `ALLOWED_HOSTS` alongside a machine callback matches the official Node.js sample in the DocumentDB
  RBAC documentation, so the two are expected to coexist. Confirm empirically during WI14.

Register in the `ClustersClient.initClient()` switch:

```ts
case AuthMethodId.ManagedIdentity:
    authHandler = new ManagedIdentityAuthHandler(credentials);
    break;
```

### 4. Token expiry for the new handler only

`ManagedIdentityCredential` returns an `AccessToken` with a real `expiresOnTimestamp`, so the new
handler reports a correct `expiresInSeconds` and the driver can cache the token. That matters here
more than elsewhere: for interactive Entra ID a cache miss is cheap because the VS Code session is
itself cached, whereas for managed identity every miss is a network round-trip to the identity
endpoint.

One small helper, used by the new handler only:

```ts
/** Seconds until an absolute expiry timestamp (ms since epoch), floored at zero. */
export function expiresInSecondsFromTimestamp(expiresOnTimestamp: number): number;
```

> **Out of scope.** `MicrosoftEntraIDAuthHandler` returns `expiresInSeconds: 0`, and
> `playgroundWorker.ts` computes the value correctly from the JWT `exp` claim. That inconsistency is
> real, but there may be a reason for the zero, and changing token-lifetime behaviour underneath a
> working interactive path is not something to do as a side effect of this work. Raised as a
> dedicated issue instead (WI27), per
> [D6.1](./decisions.md#d61-token-expiry-and-caching-out-of-scope-dedicated-issue). **Do not touch
> the existing handler in this PR.**

### 5. Connection-string interoperability

Per [D1](./decisions.md#d1-token-acquisition-mechanism) the driver-native form is a **transport
format**, not a runtime mechanism. We write it on copy and read it on paste, and in both directions
the connection is represented internally by `ManagedIdentityAuthConfig` and served by
`ManagedIdentityAuthHandler`. The driver's own `ENVIRONMENT: 'azure'` flow is never used.

The two halves must be built and tested as a pair. If they drift, users get a string that looks
right and behaves differently depending on which side of the clipboard it is on.

#### 5.1 Copy Connection String (output)

`src/commands/copyConnectionString/copyConnectionString.ts`, `buildParsedConnectionString()`, today
handles native auth and `MicrosoftEntraID` only. A managed-identity connection currently falls
through and produces a silently wrong string (no OIDC mechanism, empty username), so this is a
correctness fix as much as a feature.

```ts
if (credentials.selectedAuthMethod === AuthMethodId.ManagedIdentity) {
  parsedConnectionString.searchParams.set('authMechanism', 'MONGODB-OIDC');
  parsedConnectionString.searchParams.set(
    'authMechanismProperties',
    `ENVIRONMENT:azure,TOKEN_RESOURCE:${DOCUMENTDB_TOKEN_RESOURCE}`,
  );
  // The client ID rides in the username position, per the documented form. Empty for system-assigned.
  parsedConnectionString.username = credentials.managedIdentityConfig?.clientId ?? '';
}
```

`DOCUMENTDB_TOKEN_RESOURCE` is `https://ossrdbms-aad.database.windows.net`, the resource form of the
scope `MicrosoftEntraIDAuthHandler` already requests. Extract it as a shared constant rather than
repeating the literal.

Behaviour notes:

- **No with/without-password prompt.** `canIncludeNativePassword()` already returns false for
  non-native auth, so the existing branch is skipped without further change.
- **Nothing secret is emitted.** A client ID is a tenant-scoped identifier, not a credential.
- The result works in mongosh and application drivers **on the same Azure VM**, and pastes back into
  our own New Connection flow (5.2).
- Telemetry: `passwordIncluded` stays `notPrompted`; add `copiedAuthMechanism: 'managedIdentity'`.

#### 5.2 Normalisation on paste (input)

New file `src/documentdb/auth/managedIdentityConnectionString.ts`:

```ts
export interface ManagedIdentityHint {
  /** Client ID taken from the username position, when it is GUID-shaped. */
  readonly clientId?: string;
  /** 'explicit' when ENVIRONMENT:azure was present; 'weak' when only OIDC plus a GUID username was. */
  readonly confidence: 'explicit' | 'weak';
}

export function detectManagedIdentityHint(cs: DocumentDBConnectionString): ManagedIdentityHint | undefined;
```

Detection rules:

| Connection string shape                                                                     | Result                                                                                                                                          |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `authMechanism=MONGODB-OIDC` **and** `authMechanismProperties` contains `ENVIRONMENT:azure` | `explicit`. Select Managed Identity, take the client ID from the username, skip the identity prompt.                                            |
| `authMechanism=MONGODB-OIDC` and a GUID-shaped username, no `ENVIRONMENT`                   | `weak`. Select Managed Identity and prefill the client ID, but still show the prompt so the user can confirm or switch to interactive Entra ID. |
| Anything else                                                                               | `undefined`. Existing behaviour, unchanged.                                                                                                     |

Normalisation, applied once the hint is taken:

1. Set `selectedAuthMethod = AuthMethodId.ManagedIdentity`.
2. Set `managedIdentityAuthConfig` to `{ clientId }`, or `{}` when there was no username.
3. **Strip `authMechanism`, `authMechanismProperties`, and the username from the stored connection
   string.** They were inputs to a decision; keeping them risks the driver later preferring the URL
   form over `MongoClientOptions` and taking its own IMDS path.

A username that is present but **not** GUID-shaped keeps the method selection, leaves the client ID
empty, and lets the identity step ask. Do not guess.

> **Ordering constraint.** `PromptConnectionStringStep.prompt()` clears the username unconditionally
> before any inspection. The hint must be computed **before** that credential-stripping block, or the
> client ID is gone by the time we look for it. This is the single easiest thing to get wrong in this
> work item.

If the gap is accepted instead, it must be stated in the user manual, because copy-then-paste between
two VS Code windows is an obvious thing to try.

### 6. Availability rules

Managed identity is offered wherever interactive Entra ID is offered, because on the wire they are
the same mechanism and differ only in token source (`research-findings.md` §5.3).

**Pasted connection string**, `src/commands/newConnection/PromptConnectionStringStep.ts`:

```ts
const supportedAuthMethods: AuthMethodId[] = [AuthMethodId.NativeAuth];

if (hasDomainSuffix(AzureDomains.vCore, ...parsedConnectionString.hosts)) {
  supportedAuthMethods.push(AuthMethodId.MicrosoftEntraID);
  supportedAuthMethods.push(AuthMethodId.ManagedIdentity);
}

supportedAuthMethods.push(AuthMethodId.NoAuth);
```

**ARM metadata**, `src/plugins/service-azure-mongo-vcore/utils/clusterHelpers.ts`:

```ts
if (credentials.availableAuthMethods.includes(AuthMethodId.MicrosoftEntraID)) {
    // Managed identity is Entra ID on the wire; the cluster has no separate allowedModes value.
    credentials.availableAuthMethods.push(AuthMethodId.ManagedIdentity);

    credentials.entraIdAuthConfig = { tenantId: ..., subscriptionId: ... };
}
```

Leave the `receivedAuthMethods` / `unknownAuthMethods` telemetry reading the **raw** `allowedModes`,
so the synthesized entry does not pollute service-side telemetry.

### 7. Wizard UX

New step `src/documentdb/wizards/authenticate/SelectManagedIdentityStep.ts` (plus a sibling
registration in the New Connection wizard), shown when
`selectedAuthMethod === AuthMethodId.ManagedIdentity` and the identity is not already settled by an
`explicit` hint from §5.2.

It follows the pattern already shipped in
`src/plugins/service-atlas-mongodb/connect/SelectAtlasDatabaseUserStep.ts`: the manual escape hatch
is row one, known values are grouped below it under `QuickPickItemKind.Separator` headings, and the
step is never a dead end.

```text
Select the managed identity to use

$(edit)     Enter a client ID
            Type the client ID of a user-assigned managed identity
─────────── This machine ─────────────────────────────────────────
$(vm)       System-assigned managed identity
            Use the identity built into this Azure VM
─────────── Recently used ────────────────────────────────────────
$(account)  11111111-2222-3333-4444-555555555555
            Used by "contoso-prod-cluster"
```

- **"Enter a client ID"** opens a GUID-validated input box, exactly as the Atlas step falls through
  to `ProvideUserNameStep`.
- **Any other row** writes straight into `context.managedIdentityAuthConfig` (`{}` for
  system-assigned, `{ clientId }` otherwise) and skips the input box.
- **Nothing known** still shows the step with the manual entry row, so the list can never be empty.

`buildItems()` mirrors the Atlas implementation closely enough that it is worth reading side by side
during review.

#### Source of the "known" rows

v1 proposal: **system-assigned plus recently used**, which needs no network and works identically in
all three entry points. "Recently used" is a capped, de-duplicated list of client IDs in global
state, displayed with the connection name they were last used with. No secrets, so no `SecretStorage`.

ARM enumeration of user-assigned identities, and enumeration of the identities actually assigned to
this VM, are phase 2. Both are described in the [D2 open item](./decisions.md#open-item-needs-a-call);
the second one depends on IMDS and therefore on the D3 outcome.

`ChooseAuthMethodStep` needs no logic change; it renders whatever is in `availableAuthMethods`. The
discovery hint that D3's probe was meant to provide lives in the method's static `detail` copy (§1).

### 8. Storage and credential cache

`src/services/connectionStorageService.ts`:

```ts
export interface ConnectionSecrets {
  connectionString: string;
  nativeAuthConfig?: NativeAuthConfig;
  entraIdAuthConfig?: EntraIdAuthConfig;
  managedIdentityAuthConfig?: ManagedIdentityAuthConfig;
}
```

A client ID is not a secret, but it belongs next to the other auth configs; splitting it into
`properties` would make the read path inconsistent for no benefit.

`src/documentdb/CredentialCache.ts`:

```ts
export interface CachedClusterCredentials {
    ...
    managedIdentityConfig?: ManagedIdentityAuthConfig;
}
```

Two changes with real risk:

1. **`setAuthCredentials()` gains a seventh positional parameter.** It already has six, four of them
   optional, which is past the point where positional arguments are readable. Appending is the
   minimal-blast-radius change and is what this plan assumes; converting the tail to an options
   object is a worthwhile follow-up but should not be bundled into this work.

2. **`setFromConnectionItem()` inference ladder.** It currently infers the method when one is not
   passed explicitly, in this order: explicit `NoAuth`, then `entraIdAuthConfig`, then
   `nativeAuthConfig`, then fallbacks. A managed-identity connection may legitimately carry an
   `entraIdAuthConfig` too (tenant and subscription from ARM), so **adding a rung is not enough**:
   it would resolve to interactive Entra ID after a reload.

   The fix is to honour the persisted `selectedAuthMethod` first for **all** known methods, not just
   `NoAuth`, and only fall through to inference when it is absent or unrecognised:

   ```ts
   let selectedAuthMethod = authMethod;
   if (!selectedAuthMethod) {
     const explicitMethod = connectionItem.properties.selectedAuthMethod as AuthMethodIdType | undefined;
     if (isSupportedAuthMethod(explicitMethod)) {
       selectedAuthMethod = explicitMethod; // covers NoAuth, ManagedIdentity, and the rest
     } else if (secrets.managedIdentityAuthConfig) {
       selectedAuthMethod = AuthMethodId.ManagedIdentity;
     } else if (secrets.entraIdAuthConfig) {
       selectedAuthMethod = AuthMethodId.MicrosoftEntraID;
     } else if (secrets.nativeAuthConfig) {
       selectedAuthMethod = AuthMethodId.NativeAuth;
     } else {
       selectedAuthMethod =
         (connectionItem.properties.availableAuthMethods[0] as AuthMethodIdType) ?? AuthMethodId.NativeAuth;
     }
   }
   ```

   This is a behaviour change for existing connections, so it needs a regression test asserting that
   stored Native / Entra ID / NoAuth connections still resolve identically.

   The existing "defense in depth" rule that `NoAuth` never surfaces stale secrets stays as-is, and
   should extend to clearing `managedIdentityConfig`.

`ExecuteStep` must persist `managedIdentityAuthConfig` as `{}` for system-assigned rather than
omitting it.

### 9. Playground and Interactive Shell

`src/documentdb/playground/workerTypes.ts`:

```ts
readonly authMechanism: 'NativeAuth' | 'MicrosoftEntraID' | 'ManagedIdentity' | 'NoAuth';

// tokenRequest gains a discriminator; absent means 'vscode' for backward compatibility.
{
    readonly type: 'tokenRequest';
    readonly requestId: string;
    readonly scopes: readonly string[];
    readonly tenantId?: string;
    readonly source?: 'vscode' | 'managedIdentity';
    readonly clientId?: string;
}
```

Token acquisition stays on the **main thread** for both sources, so there is a single credential
object and a single token cache per window, and so the worker never needs `@azure/identity`.

- `playgroundWorker.ts`: extend the `MicrosoftEntraID` branch to also fire for `ManagedIdentity`,
  setting `source: 'managedIdentity'` and `clientId` on the request. The OIDC options are otherwise
  identical.
- `PlaygroundEvaluator.handleTokenRequest()` and `ShellSessionManager.handleTokenRequest()`: branch
  on `source`. The `managedIdentity` branch caches one `ManagedIdentityCredential` per client ID.
- `buildInitMessage()` in both: pass `managedIdentityClientId` from
  `credentials.managedIdentityConfig`.

### 10. Error handling: plain-language translation only

Per [D6.2](./decisions.md#d62-error-mapping-simplified-to-plain-language-translation), this iteration
**translates** errors into readable sentences and stops there. No suggested commands, no deep links,
no branching remediation UI. This is the same approach taken in the Local Quick Start work.

New file `src/documentdb/auth/managedIdentityErrors.ts`:

```ts
/** Turns a raw credential failure into a sentence a human can act on. Never throws. */
export function describeManagedIdentityError(error: unknown, clientId?: string): string;
```

| Condition                                           | Message (localized)                                                                                                                                                                      |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multiple candidate identities, no selector          | "This machine has more than one managed identity, so the right one cannot be chosen automatically. Reconnect and enter the client ID you want to use."                                   |
| No identity endpoint reachable                      | "No managed identity is available on this machine. Managed identity authentication requires VS Code to be running on an Azure resource, such as an Azure VM, with an identity assigned." |
| Endpoint reachable, requested identity not assigned | "The managed identity with client ID {0} is not assigned to this machine."                                                                                                               |
| Anything else                                       | Pass through with a "Managed Identity authentication failed: {0}" prefix.                                                                                                                |

The first row is the reported incident, so it gets a sentence that names the cause and says what to
do. It is still a sentence, not a workflow.

> **Implementation note.** In `@azure/identity` 4.13 managed identity is delegated to
> `@azure/msal-node` (`ManagedIdentitySources/`), so the surfaced error is typically a
> `CredentialUnavailableError` or `AuthenticationError` wrapping an MSAL `ManagedIdentityError`.
> The exact `name` values and message substrings must be captured from the fake-endpoint harness
> (WI14) rather than guessed. Match defensively on both name and message, and always fall through to
> the pass-through case.

Richer, actionable mapping (retry commands, a link to cluster-side registration, an offer to
re-run the identity picker) is deliberately **deferred**. Revisit once WI14 has captured what the
errors actually look like on hardware.

One exception is worth the sentence: when a token is obtained but the **server** rejects it, the
connect-failure message should mention cluster-side registration, because otherwise the failure looks
identical to a bad identity. Text only, no command.

### 11. Azure environment probe: **on hold, D3 is open**

**Do not implement until D3 is settled.** The current lean is not to build this at all; see
[D3](./decisions.md#d3-azure-environment-detection-open). The discovery benefit it was meant to
provide is already covered by the static `detail` copy in §1, and the detection itself is performed
authoritatively by `ManagedIdentityCredential` at the moment it matters.

If it is built after all, the shape is:

New file `src/documentdb/auth/azureEnvironmentProbe.ts`:

```ts
/** Best-effort, never throws. Result is cached for the session. */
export async function isLikelyAzureHosted(): Promise<boolean>;
```

- `GET http://169.254.169.254/metadata/versions` with header `Metadata: true`.
- **2 second** timeout (vscode-cosmosdb uses 10, which is a latency trap).
- Cached result, single-flight promise, never throws, never gates anything.
- Called lazily when the auth quick pick is about to be built, and for telemetry. **Never awaited on
  a connection path.**

Note that dropping the probe does **not** forbid using IMDS _after_ the user has explicitly selected
managed identity. That distinction keeps the phase 2 "identities assigned to this VM" option in §7
available.

### 12. Telemetry

Riding on the existing `selectedAuthMethod` property, add:

| Property / measurement          | Values                                                                   |
| ------------------------------- | ------------------------------------------------------------------------ |
| `managedIdentityKind`           | `system` \| `user`                                                       |
| `managedIdentityClientIdSource` | `connectionString` \| `prompt` \| `recent` \| `none`                     |
| `managedIdentityFailureReason`  | `noEndpoint` \| `multipleIdentities` \| `identityNotAssigned` \| `other` |
| `copiedAuthMechanism`           | `managedIdentity`, on the copy command only                              |

`azureEnvironmentDetected` is dropped unless D3 lands on the probe. `managedIdentityFailureReason`
already distinguishes `noEndpoint`, which is the same signal obtained from the real call rather than
from a speculative one.

The client ID itself is never emitted, and is added to `context.valuesToMask`. It is not a secret,
but it is a stable tenant-scoped identifier and there is no analysis question that needs it.

Follow the patterns in `.github/skills/telemetry-instrumentation/SKILL.md`.

---

## Work items

### Phase 1: core authentication path

Goal: a connection created from a pasted connection string can authenticate with a managed identity.
This alone closes the incident for the reported scenario.

| ID  | Description                                                                                                                                                                                           | Status |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| WI1 | Add `AuthMethodId.ManagedIdentity`, `ManagedIdentityAuthMethod`, register in `authMethodsArray`                                                                                                       | ✅     |
| WI2 | Extract the shared Entra scope / token-resource constant. **Do not** touch the existing handler's `expiresInSeconds: 0`; the new handler reports its own from `AccessToken.expiresOnTimestamp` (D6.1) | ✅     |
| WI3 | Add `ManagedIdentityAuthConfig`; extend `AuthConfig` union                                                                                                                                            | ✅     |
| WI4 | Implement `ManagedIdentityAuthHandler` with a dynamic `@azure/identity` import                                                                                                                        | ✅     |
| WI5 | Add the `ManagedIdentity` case to the `ClustersClient.initClient()` switch                                                                                                                            | ✅     |
| WI6 | Implement `managedIdentityErrors.ts` / `describeManagedIdentityError()` (plain-language translation only, D6.2)                                                                                       | ✅     |

### Phase 2: connection creation and persistence

| ID   | Description                                                                                                                                            | Status |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| WI7  | Implement `detectManagedIdentityHint()` and the normalisation rule (§5.2); wire into `PromptConnectionStringStep` **before** the username is cleared   | ✅     |
| WI8  | `Copy Connection String`: emit the driver-native form for `ManagedIdentity` (§5.1)                                                                     | ✅     |
| WI9  | Offer `ManagedIdentity` for vCore hosts in `PromptConnectionStringStep`                                                                                | ✅     |
| WI10 | Implement `SelectManagedIdentityStep` (Atlas pattern, §7) plus the recently-used client ID store; register in both wizards; skip on an `explicit` hint | ✅     |
| WI11 | Extend `ConnectionSecrets`, `CachedClusterCredentials`, `setAuthCredentials()`, `EphemeralClusterCredentials`, `AuthenticateWizardContext`             | ✅     |
| WI12 | Rework the `setFromConnectionItem()` inference ladder to honour `selectedAuthMethod` for all known methods                                             | ✅     |
| WI13 | Persist `managedIdentityAuthConfig` (including `{}` for system-assigned) in `ExecuteStep`                                                              | ✅     |

### Phase 3: validation harness

Deliberately ahead of the remaining feature work: WI6 and WI11 cannot be reviewed honestly without it.

| ID   | Description                                                                                                    | Status |
| ---- | -------------------------------------------------------------------------------------------------------------- | ------ |
| WI14 | Fake identity-endpoint test harness (see Testing below); capture real error shapes and feed them back into WI6 | ✅     |
| WI15 | Unit tests per the Testing section, including the **copy then paste round-trip** across §5.1 and §5.2          | ✅     |

### Phase 4: Azure Resources and Discovery views

| ID   | Description                                                                                                               | Status |
| ---- | ------------------------------------------------------------------------------------------------------------------------- | ------ |
| WI16 | Synthesize `ManagedIdentity` into `availableAuthMethods` in `clusterHelpers.ts`; keep raw `allowedModes` telemetry intact | ✅     |
| WI17 | Thread `managedIdentityAuthConfig` through `VCoreResourceItem` and `DocumentDBResourceItem` `authenticateAndConnect()`    | ✅     |

### Phase 5: Playground and Shell

| ID   | Description                                                                                                                                         | Status |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| WI18 | Extend `workerTypes.ts` (`authMechanism` union, `tokenRequest` `source` / `clientId`)                                                               | ✅     |
| WI19 | Extend `playgroundWorker.ts` OIDC branch to cover `ManagedIdentity`                                                                                 | ✅     |
| WI20 | Branch `handleTokenRequest()` in `PlaygroundEvaluator` and `ShellSessionManager`; cache credentials per client ID; extend both `buildInitMessage()` | ✅     |

### Phase 6: hardening and documentation

| ID   | Description                                                                                                                                              | Status |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| WI21 | **On hold.** `azureEnvironmentProbe.ts` and quick-pick annotation. Blocked on D3; currently expected to be dropped                                       | ⛔     |
| WI22 | Telemetry properties per §12                                                                                                                             | ✅     |
| WI23 | `npm run l10n`; verify **no em dashes and no en dashes** in any new user-facing string (see Conventions)                                                 | ✅     |
| WI24 | `docs/` updates (D6.3): new managed identity user-manual page, `copy-connection-string.md`, `how-to-construct-url.md`, `connection-string-parameters.md` | ✅     |
| WI25 | Manual validation checklist for the Azure VM repro                                                                                                       | ✅     |

### After the work lands

Deliberately **not** done up front: both issues should be written with what the implementation and
the VM validation actually taught us, otherwise they will need rewriting.

| ID   | Description                                                                                                                                                                   | Status |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| WI26 | File the **D4 issue**: chained default credential, MFA and Conditional Access, service principals, workload identity, sovereign clouds, plus anything this work surfaced      | ☐      |
| WI27 | File the **D6.1 issue**: revisit token expiry and refresh for all Entra-based methods, including why `expiresInSeconds: 0` is there, informed by how the new handler behaved  | ☐      |
| WI28 | Follow-up: correct the Learn "Connect using Microsoft Entra ID in Visual Studio Code" section (client ID handling, and the stale "shell functionality isn't supported" claim) | ☐      |

---

## Testing

### Unit (Jest)

- `expiresInSecondsFromTimestamp`: timestamp maths, floor at zero, clock-skew tolerance.
- `detectManagedIdentityHint`: explicit / weak / none, non-GUID username, `ENVIRONMENT:azure` mixed
  with other `authMechanismProperties` entries, casing variants, and `+srv` versus plain hosts.
- **Normalisation:** after a hint is applied, the stored connection string retains no
  `authMechanism`, no `authMechanismProperties`, and no username, and the config carries the client
  ID (or `{}` for system-assigned).
- `ManagedIdentityAuthHandler`: with a mocked credential, assert `authMechanism`, `tls`,
  `ALLOWED_HOSTS`, the TLS exception, and specifically that `authMechanismProperties` and
  `authMechanism` are **removed from the returned connection string**.
- `buildParsedConnectionString`: the copy output for a system-assigned and a user-assigned identity,
  that existing query parameters survive, and that no password is ever added (§5.1).
- **Round-trip:** copy output fed back through `detectManagedIdentityHint` plus normalisation yields
  the original config. One test, both directions, so the two halves cannot drift apart unnoticed.
- `describeManagedIdentityError`: each mapped condition plus the pass-through fallback.
- `CredentialCache`: `setAuthCredentials` and `setFromConnectionItem` round trip for
  `ManagedIdentity`, including the system-assigned `{}` case.
- `SelectManagedIdentityStep.buildItems()`: manual entry is always first, separators appear only for
  non-empty groups, and the list is never empty.
- **Regression:** `setFromConnectionItem` still resolves existing stored Native / Entra ID / NoAuth
  connections identically after the WI12 ladder change.

### Fake identity-endpoint harness (WI14)

`ManagedIdentityCredential` delegates to `@azure/msal-node`, whose `ManagedIdentitySources/AppService`
source reads `IDENTITY_ENDPOINT` and `IDENTITY_HEADER` (verified in `node_modules`, API version
`2019-08-01`). Pointing those at a local `http.Server` exercises the **real** credential object end to
end, with no Azure resources involved.

Cases to cover:

1. Success, system-assigned. Assert no `client_id`-style selector is sent.
2. Success, user-assigned. Assert the client ID reaches the endpoint.
3. Multiple-identity failure response. Capture the real error `name` and message, and assert the
   mapping in WI6.
4. Identity not assigned.
5. Endpoint unreachable (env vars unset, and no IMDS in the test environment).
6. Expiry propagation: assert the driver receives a sane `expiresInSeconds`.

### Manual validation checklist (WI25)

For whoever holds the Azure VM repro. **Azure VMs only**, per D0. Each case from both the Connections
view and the Azure Resources view, and in Collection View plus Playground plus Shell:

- [ ] VM with **only** a system-assigned identity, no client ID entered.
- [ ] VM with **one** user-assigned identity, no client ID entered.
- [ ] VM with **two or more** identities, no client ID entered. Expect the readable
      multiple-identity message, not an opaque failure. **This is the reported incident.**
- [ ] Same VM, correct client ID entered. Expect success.
- [ ] Client ID of an identity not registered on the cluster. Expect a message that mentions
      cluster-side registration.
- [ ] The documented Learn connection string pasted verbatim, including
      `authMechanismProperties=ENVIRONMENT:azure,TOKEN_RESOURCE:...`. Expect the method to be
      preselected and the identity step to be skipped.
- [ ] `Copy Connection String` on a managed-identity connection: no password prompt appears, and the
      copied string works in `mongosh` on that same VM.
- [ ] Same copied string used from a small Node driver script on that VM.
- [ ] Same copied string pasted into New Connection in a second VS Code window. Expect an identical
      managed-identity connection, not a native-auth one.
- [ ] Non-Azure machine, Managed Identity selected. Expect the "no managed identity is available on
      this machine" message.
- [ ] The identity quick pick offers "Enter a client ID" first, and a previously used client ID
      appears under "Recently used" on the second connection.
- [ ] Reload the window and reconnect a saved managed-identity connection.
- [ ] Move a saved managed-identity connection into a folder, then reconnect (dual-ID regression).
- [ ] Confirm existing interactive Entra ID connections, including multi-tenant, still work.

### PR completion checklist

Per `.github/copilot-instructions.md`, all five must pass, in this order: `npm run l10n`,
`npm run prettier-fix`, `npm run lint`, `npx jest --no-coverage`, `npm run build`.

Plus one project-specific gate for this work: **grep the files you touched for em dashes and en
dashes and confirm there are none** in any user-facing string or in the documentation added under
`docs/`. See Conventions for the implementer.

---

## Risks and open questions

| #   | Risk                                                                                        | Mitigation                                                                                      |
| --- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | `@azure/identity` + MSAL bundle weight                                                      | Dynamic `await import()` inside the handler only. Check the webpack bundle report before merge. |
| 2   | URL `authMechanismProperties` conflicting with `MongoClientOptions.authMechanismProperties` | Strip from the URL; assert in a unit test (WI15).                                               |
| 3   | `ALLOWED_HOSTS` may be spec'd for human callbacks only                                      | The official DocumentDB Node.js sample uses it with a machine callback; confirm in WI14.        |
| 4   | WI12's inference-ladder change silently altering existing connections                       | Dedicated regression test; the change is ordered before the new rung is relied upon.            |
| 5   | Error-message mapping written against guessed error shapes                                  | WI14 is scheduled before WI6 is finalized specifically to capture real shapes.                  |
| 6   | Managed identity is unavailable in a browser-hosted extension host                          | Hide the method when the Node runtime is unavailable; confirm the current activation targets.   |
| 7   | Sovereign clouds use a different Entra token endpoint and DocumentDB scope                  | Out of scope, folded into the D4 issue.                                                         |
| 8   | Seventh positional parameter on `setAuthCredentials()`                                      | Accepted for now; options-object refactor tracked as separate follow-up.                        |
| 9   | Copy and paste drifting apart, so a string we emit is not the string we can read            | One round-trip unit test spanning §5.1 and §5.2 (WI15), not two independent tests.              |

Open items are listed in [`decisions.md`](./decisions.md#still-open): **D3** (probe or no probe) and
**D2** (source of the known identity rows). Neither blocks implementation; both have a default that
an implementer should follow unless told otherwise.

---

## Future work

- **The D4 issue** (WI26): chained default credential, MFA and Conditional Access behaviour, service
  principals, workload identity federation, sovereign clouds.
- **The D6.1 issue** (WI27): token expiry and refresh across all Entra-based methods.
- **Richer identity discovery** (D2 open item): ARM enumeration of
  `Microsoft.ManagedIdentity/userAssignedIdentities` for name-based selection in the Azure Resources
  and Discovery views, and enumeration of the identities actually assigned to this VM.
- **Actionable error remediation** (D6.2): commands and links, once WI14 has captured real shapes.
- **Azure hosting platforms beyond VMs** (D0): a documentation and test change, not a code change.
- **`setAuthCredentials()` options-object refactor.**
- **Cluster-side registration assist.** When a managed identity token is obtained but the cluster
  rejects it, offer to register the principal as a `Microsoft.DocumentDB/mongoClusters/users`
  resource, mirroring the RBAC assist in vscode-cosmosdb.

---

## References

- Evidence and prior-art analysis: [`research-findings.md`](./research-findings.md)
- Decisions and rejected alternatives: [`decisions.md`](./decisions.md)
- Azure DocumentDB role-based access control:
  <https://learn.microsoft.com/azure/documentdb/how-to-connect-role-based-access-control>
- SqlClient Microsoft Entra authentication (the vscode-mssql precedent):
  <https://learn.microsoft.com/sql/connect/ado-net/sql/azure-active-directory-authentication>
- `.github/skills/tree-cluster-architecture/SKILL.md` (dual-ID pattern, relevant to WI17)
- `.github/skills/telemetry-instrumentation/SKILL.md` (relevant to WI22)
- `.github/instructions/wizard.instructions.md` (relevant to WI10)
