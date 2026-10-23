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

## Revision 1 (before implementation started; approved by the operator)

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

**Done** in `99f7c2b0` (with the allowed-hosts changes): table, `toEntraScope`, `parseTokenResource`,
`getCloudForTokenResource`, tests pinning the exact public scope string.

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
- Mismatch (D8): a host under `azure.com`, `azure.us` or `azure.cn` whose cloud differs from the
  audience's cloud throws a localized error naming both clouds and
  `microsoft-sovereign-cloud.environment`. (Revised after approval: `azure.us` was added once the
  operator confirmed it as the US Government cluster domain.)
- A warning is logged when the override equals the public audience but the cloud is not public.
- `deps` injects settings, `fetch` and the environment for tests.

**Done** in `b1e39d1b` (`documentdbTokenResource.ts`, shared with A3). `azure.us` maps to US
Government after the operator confirmed it (D8).

**ARM metadata api-version:** kept at `2022-09-01`. A research pass found that vscode-cosmosdb, Azure
Resources and the Azure tools libraries never call `/metadata/endpoints` (they use the static
`getConfiguredAzureEnv()`), so there is no peer version to follow. The public endpoint returns the
same body, including `ossrDbmsResourceId`, for `2022-09-01` and the newer `2026-06-01` stable spec
version. Review again only if the response content changes.

## A3. Managed identity resolver (D7)

Same file: `resolveManagedIdentityTokenResource(connectionString, deps?)`.

- Order: override, host suffix, IMDS `compute.azEnvironment` (`AZUREPUBLICCLOUD` only), else a
  localized error naming the override.
- **Deviation:** the plan also read a known `TOKEN_RESOURCE` from the connection string. Dropped:
  `stripManagedIdentityMarkers` removes `authMechanismProperties` before the connection is saved, so
  the value never reaches connect time. Keeping it would have meant a storage change for a signal the
  host suffix already covers.
- IMDS: `GET http://169.254.169.254/metadata/instance/compute/azEnvironment?api-version=2021-02-01&format=text`
  with `Metadata: true` and a short timeout; called only when the earlier steps found nothing.

**Done** in `b1e39d1b`.

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

**Done**: interactive handler `00c8752e`, managed identity handler `89a2489e`, shell and playground
`32e8f5f2` (the playground uses its existing `workerClusterId`), copy connection string `df8652a5`.
The failure registry moved to Part B, which owns it.

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

**Done** in `5aafc30e`; the custom suffix is passed to `getOidcAllowedHosts` by every caller.

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

**Done** with each commit. Case 1 checkpoint after Part A: `npm run build` passed; targeted Vitest
(auth, shell, playground, copy, new connection, settings) 43 files, 992 tests passed.

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

Each rule has an id, codes, and `explain(context)` with
`context = { code, cloudCategory, recentTokenFailure }`.
Every message names who can fix the problem and links to the public troubleshooting page
(`Links.SovereignClouds`).

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
The auth method comes from the recent token-failure registry, not from the error text.

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
  to report it on GitHub. It is the target of `Links.SovereignClouds`.
- `src/documentdb/utils/connection-string-parameters.md`: the per-cloud `TOKEN_RESOURCE` values.
- `oidcAllowedHosts.ts`: point the "tracked separately" comment at the resolver.

**Done**: user-manual page `79af884e`, links and `Links.SovereignClouds` (named without the
`Troubleshooting` suffix, since the page covers setup too) `891af716`, settings example fix
`5e1930e7` (the first draft used dotted keys; `documentDB.customEnvironment` is one object setting),
`connection-string-parameters.md` `8082fa9c`, `oidcAllowedHosts.ts` comment `99f7c2b0`.

---

# Addition: support tracing (operator request)

**Done** in `17a95f66`. Every Entra connection, including the public cloud, writes
`entraCloud.resolved` (or `entraCloud.unresolved`) to the DocumentDB output: flow, configured cloud,
sign-in provider, broker mode, cloud implied by the host, whether the custom settings are set, ARM
and IMDS lookup outcomes, and the chosen token resource and reason. The OIDC traces add the
`ALLOWED_HOSTS` patterns, auth error summaries add `broker=platform_broker_error|none`, and the
classifier writes `entraSignIn.classified`. No tenant, client, account, host, or connection-string
values are logged, consistent with the managed identity tracing rules.

---

# Before shipping

- D11: check telemetry for successful Entra connections to `*.azure.cn` hosts.
- Validation without sovereign access: public-cloud behavior unchanged (manual); with
  `microsoft-sovereign-cloud.environment = USGovernment`, the DocumentDB output shows the US Government
  scope before sign-in fails (proves the request, not the outcome).

# Future work

- The ask-once prompt for custom clouds, as a command (D6).
- Buttons on diagnostics: Report issue, Switch cloud, Copy details (D10).

# Outcome

Part B is implemented: one rule table and pure text classifier, a ten-minute in-memory
token-failure registry, and the `entra-sign-in` diagnostics provider registered next to SRV DNS
diagnostics. Interactive and managed identity handlers, the shell, and the playground record only
token-acquisition failures, leaving audience-resolution failures and original errors unchanged.
An empty interactive session is also recorded as a token-acquisition failure.

Verification: `npx vitest run src/documentdb/auth src/documentdb/shell src/documentdb/playground src/services`
passed, 85 files and 2,061 tests. No build, lint, formatter, localization generation, or packaging was
run for Part B, as requested by the operator. Sovereign-cloud behavior is inferred from fixtures and
has not been observed end to end (D2). The service-side preauthorization work remains outside this
repository.
