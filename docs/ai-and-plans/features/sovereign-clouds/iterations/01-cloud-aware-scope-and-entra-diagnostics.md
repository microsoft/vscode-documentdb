---
feature: sovereign-clouds
kind: plan
status: active
code:
  - src/documentdb/auth/entraScopes.ts
  - src/documentdb/auth/MicrosoftEntraIDAuthHandler.ts
  - src/documentdb/auth/ManagedIdentityAuthHandler.ts
  - src/documentdb/auth/managedIdentityConnectionString.ts
  - src/documentdb/auth/oidcAllowedHosts.ts
  - src/documentdb/playground/playgroundWorker.ts
  - src/documentdb/playground/PlaygroundEvaluator.ts
  - src/documentdb/shell/ShellSessionManager.ts
  - src/commands/copyConnectionString/copyConnectionString.ts
  - src/services/connectionDiagnosticsService.ts
---

# Iteration 01: Cloud-aware token audience and Entra error classifier

Plan for tracks 2 and 3 of the [README](../README.md#what-is-being-done). Track 1 (service-side
preauthorization) is outside the code.

Progress is recorded inline under each work item, with the commit that carries it.

**Verification case:** Case 1 while in progress (`npm run build`, targeted `npx vitest run`).
Case 2 only at hand-over.

**Constraint (D2):** no sovereign-cloud access. Public-cloud behavior must not change, and tests pin
the exact public scope string.

## Revision 1 (before implementation started)

The first version of this plan assumed the Windows broker passes the AADSTS code to the extension,
kept the public audience for custom clouds, used the VS Code setting for managed identity, and only
logged cloud mismatches. Follow-up research changed all four: the broker error is opaque (research
§3), custom clouds must never fall back to public (D6), managed identity follows the VM and the
cluster (D7), and a clear mismatch stops the request (D8). ARM's `2022-09-01` metadata turned out to
publish the OSSRDBMS resource for every cloud (research §5), which gives custom clouds a source.
Decisions D6 to D11 record the outcome.

---

# Part A: Cloud-aware token audience

Goal: the DocumentDB token is requested for the OSSRDBMS resource of the right cloud, never silently
for the public one.

## A1. Audience table and helpers

`src/documentdb/auth/entraScopes.ts`:

- `DocumentDBEntraCloud = 'AzureCloud' | 'AzureUSGovernment' | 'AzureChinaCloud'`.
- A closed `TOKEN_RESOURCE_BY_CLOUD` table (research §5). `DOCUMENTDB_TOKEN_RESOURCE` and
  `DOCUMENTDB_ENTRA_SCOPE` keep their public values.
- `toEntraScope(resource)`: strips one trailing slash, appends `/.default`.
- `parseTokenResource(value)`: accepts only `https://host` with no path, query or fragment; returns
  the normalized value or `undefined`.
- `getCloudForTokenResource(value)`: the built-in cloud for a known audience, else `undefined`.

## A2. Interactive resolver (D6, D8)

`src/documentdb/auth/resolveDocumentDBTokenResource.ts`:

```ts
export interface ResolvedTokenResource {
    readonly resource: string;
    readonly scope: string;
    /** For telemetry and traces only. */
    readonly cloudCategory: 'public' | 'usgov' | 'china' | 'custom';
    readonly reason: 'setting' | 'customOverride' | 'customLoginHost' | 'armMetadata' | 'connectionString' | 'host' | 'imds';
}

export function resolveInteractiveTokenResource(connectionString: string, deps?: ResolverDeps): Promise<ResolvedTokenResource>;
```

- Built-in clouds come from `getConfiguredAzureEnv()` (internal module path, as for
  `getSessionFromVSCode`).
- `custom`: the D6 order. The ARM metadata call uses `fetch` with a short timeout, reads
  `ossrDbmsResourceId` ignoring case, validates it with `parseTokenResource`, and caches per
  `resourceManagerEndpointUrl` (success only). Known login hosts: `login.microsoftonline.com`,
  `login.microsoftonline.us`, `login.chinacloudapi.cn`, `login.sovcloud-identity.fr`,
  `login.sovcloud-identity.de` (Azure CLI `cloud.py`).
- Unresolved custom cloud: throws a localized error naming
  `documentDB.customEnvironment.ossrdbmsEndpoint`.
- Mismatch (D8): `.azure.cn` host with a non-China cloud, or `.azure.com` host with a non-public
  cloud, throws a localized error naming both clouds and `microsoft-sovereign-cloud.environment`.
- A warning is logged when the override equals the public audience but the cloud is not public.
- `deps` injects settings, `fetch` and the environment for tests.

## A3. Managed identity resolver (D7)

Same file: `resolveManagedIdentityTokenResource(connectionString, deps?)`.

- Order: override, known `TOKEN_RESOURCE` in the connection string, host suffix, IMDS
  `compute.azEnvironment` (`AZUREPUBLICCLOUD` only), else a localized error naming the override.
- IMDS: `GET http://169.254.169.254/metadata/instance/compute/azEnvironment?api-version=2021-02-01&format=text`
  with `Metadata: true` and a short timeout; called only when the earlier steps found nothing.

## A4. Wiring

- [MicrosoftEntraIDAuthHandler.ts](../../../../../src/documentdb/auth/MicrosoftEntraIDAuthHandler.ts) and
  [ManagedIdentityAuthHandler.ts](../../../../../src/documentdb/auth/ManagedIdentityAuthHandler.ts): use the
  resolvers; add `cloudCategory` and `reason` to the existing traces.
- Shell and playground: the main thread's `handleTokenRequest` resolves the scope from the cluster's
  credentials and ignores the worker's `scopes`, which the worker stops sending.
- Copy connection string: `TOKEN_RESOURCE` comes from a synchronous subset (override, known
  `TOKEN_RESOURCE`, host suffix, built-in VS Code cloud), else public. Copying must not wait on IMDS;
  the copied string is a starting point the user can edit.
- Record each failed DocumentDB token request by `clusterId` (cloud category, auth method, time) in
  a small in-memory registry, for Part B. This is the error-translation skill's "record it while
  preparing the connection" pattern; the error object is not touched.

## A5. Settings

`documentDB.customEnvironment`, an object setting mirroring `mssql.customEnvironment`:

| Property                     | Description                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `ossrdbmsEndpoint`           | Sovereign cloud equivalent for `https://ossrdbms-aad.database.windows.net/`   |
| `mongoClusterHostnameSuffix` | Sovereign cloud equivalent for `.mongocluster.cosmos.azure.com` (leading dot) |

The description says it is used together with `microsoft-sovereign-cloud.environment = custom`.
`mongoClusterHostnameSuffix` extends `ALLOWED_HOSTS` explicitly; automatic trust stays limited to
`azure.com`, `azure.us` and `azure.cn`, which [oidcAllowedHosts.ts](../../../../../src/documentdb/auth/oidcAllowedHosts.ts)
already enforces (#934).

## A6. Tests

- Resolver tables: every setting value; custom with override, known login host, ARM metadata (key
  present, missing, differently cased, invalid, timeout), and nothing; trailing slashes; invalid
  overrides; mismatch in both directions; private hosts not checked.
- Managed identity: override, known and unknown `TOKEN_RESOURCE`, `.azure.cn`, `.azure.com`,
  `AZUREPUBLICCLOUD`, another IMDS value, IMDS timeout.
- Handlers: public scope string unchanged; US Government scope when the setting says so.
- Allowed hosts: `*.azure.xyz` rejected; the configured custom suffix accepted.

---

# Part B: Entra error classifier

Goal (D3): one table maps Entra sign-in failures to text that says what happened, who can fix it, and
where to go next.

## B1. Where it plugs in

`ConnectionDiagnosticsService.explain()` is already called wherever a connection failure is shown, so
one provider covers tree connect in both views, the shell, the playground, tree commands, and
webviews. All of them pass at least the message, so the classifier works on text.

## B2. Files

```
src/documentdb/auth/entraErrors/
├── entraErrorRules.ts          # THE table. The only file touched to add a code.
├── classifyEntraError.ts       # Pure: text in, classification out.
├── entraTokenFailures.ts       # Registry from A4: failed DocumentDB token requests by clusterId.
└── EntraDiagnosticsProvider.ts # ConnectionDiagnosticsProvider adapter; registered once.
```

## B3. Classification

`classifyEntraError(text)` returns `{ ruleId, code?, brokered }` or `undefined`:

1. Cheap rejection unless the text contains `AADSTS`, `platform_broker_error`, or the
   preauthorization phrase.
2. `AADSTS(\d{5,7})` codes; first rule listing one of them wins.
3. The preauthorization phrase without a code maps to 65002 (harmless extra; not the broker
   strategy).
4. `platform_broker_error` without a code: `brokerOpaque`.
5. Any other AADSTS code: `unknownAadsts`.

## B4. Rules

Each rule has an id, codes, and `explain(context)` with `context = { code, cloud, authMethod }`.
Every message names who can fix the problem and links to the public troubleshooting page
(`Links.SovereignCloudsTroubleshooting`).

| Rule id                      | Codes                   | Who can fix it                                  |
| ---------------------------- | ----------------------- | ----------------------------------------------- |
| `firstPartyPreauthorization` | 65002, or the phrase    | Microsoft only                                  |
| `brokerOpaque`               | `platform_broker_error` | Depends; hedged text (D9) in sovereign clouds   |
| `resourceNotInTenant`        | 500011                  | Cloud selection, else the tenant administrator  |
| `invalidResource`            | 50001                   | The extension or the custom override            |
| `accountNotInTenant`         | 50020, 90072            | The cluster tenant's administrator, or the user |
| `applicationNotInDirectory`  | 700016                  | The user (cloud or tenant choice)               |
| `tenantNotFound`             | 90002                   | The user (cloud or tenant choice)               |
| `crossCloudNotAllowed`       | 1000104                 | Tenant administrators                           |
| `conditionalAccess`          | 53003                   | Tenant administrator or IT help desk            |
| `additionalVerification`     | 50076, 50079            | The user                                        |
| `unknownAadsts`              | any other               | Unknown; the message gives the code             |

`brokerOpaque` gets the hedged 65002 text only when the cloud is not public **and** the registry from
A4 holds a recent DocumentDB token failure for this `clusterId`. Otherwise it gets a generic text that
asks for the code shown in the sign-in window and points to **Developer: Show Logs… → Microsoft
Sovereign Cloud Authentication** (or **Microsoft Authentication**). `msal-no-broker` is mentioned only
as a manual diagnostic step, never as a fix.

## B5. Telemetry

The provider sends `entraSignIn.classified` with `ruleId`, `aadstsCode`, `cloudCategory`, `brokered`
and `authMethod`. No tenant, subscription, cluster, user, or correlation identifiers.

## B6. Tests

- Fixtures with fake GUIDs: the no-broker 65002 string, the opaque broker string, each rule's code,
  HTML-escaped quotes, ordinary driver errors (no match).
- Table integrity: unique ids, no code in two rules, a fixture per rule.
- Provider: string and `Error` input, the hedged and generic broker variants.

---

# Part C: Documentation

- New user-manual page `docs/user-manual/sovereign-clouds.md`: selecting a cloud, the audience per
  cloud, `documentDB.customEnvironment`, the known Entra limitation where VS Code is not yet
  authorized, workarounds (native authentication, managed identity), finding the error code, and how
  to report it on GitHub. It is the target of `Links.SovereignCloudsTroubleshooting`.
- `src/documentdb/utils/connection-string-parameters.md`: the per-cloud `TOKEN_RESOURCE` values.
- `oidcAllowedHosts.ts`: point the "tracked separately" comment at the resolver.

---

# Before shipping

- D11: check telemetry for successful Entra connections to `*.azure.cn` hosts.
- Validation without sovereign access: public-cloud behavior unchanged (manual); with
  `microsoft-sovereign-cloud.environment = USGovernment`, the DocumentDB output shows the US Government
  scope before sign-in fails (proves the request, not the outcome).

# Future work

- The ask-once prompt for custom clouds, as a command (D6).
- Buttons on diagnostics: Report issue, Switch cloud, Copy details (D10).
- A US Government host suffix rule once it is publicly documented (D7, D8).

# Outcome

_To be written at hand-over._
