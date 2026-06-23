# Plan: Supporting "No Authentication" Connections (empty username + password)

**Companion to:** `01-username-and-tls-checks-report.md` (read it first for exact
file:line citations).

**Objective:** Let a user create and fully use a connection with **no username, no
password, and no Entra ID** — explore databases/collections, open the integrated shell,
and run the query playground — while **honoring connection-string TLS/SSL overrides**.

---

## 1. Design decision: third auth method vs. "empty native"

The codebase already models authentication as a first-class concept:

- `AuthMethodId` enum (`NativeAuth`, `MicrosoftEntraID`) in
  `src/documentdb/auth/AuthMethod.ts`.
- Per-connection `selectedAuthMethod` / `availableAuthMethods` persisted in storage.
- An auth-handler `switch` in `ClustersClient.initClient()`.

Three options were considered:

| Option | Summary | Verdict |
|--------|---------|---------|
| **A. New `AuthMethodId.NoAuth`** ("No Authentication" pick) | Add a third, explicit method. Wizards skip username/password; handlers build a credential-free connection string. | ✅ **Recommended** |
| B. Allow empty username+password inside `NativeAuth` | Drop the non-empty validators; treat empty as intentional. | ⚠️ Not preferred — ambiguous (can't tell "forgot to type" from "intentional"), and the runtime gate in `DocumentDBClusterItem` would keep re-prompting. |
| C. Store empty values under `NativeAuth` and trust the flag | Like B but rely on `selectedAuthMethod`. | ⚠️ Still needs every empty-guard relaxed; conflates two intents. |

**Recommendation: Option A.** It is explicit, discoverable ("No Authentication" appears in
the auth-method quick pick), keeps `NativeAuth` semantics intact, and maps cleanly onto the
existing auth-handler/`switch` architecture. It's also the most future-proof (e.g. X.509
later). Where Option A requires the least churn, we still *reuse* the empty-safe parts of
`CredentialCache.setAuthCredentials` (it already builds a credential-free
`connectionStringWithPassword`).

The rest of this plan assumes **Option A**.

---

## 2. Why a stored "empty creds" connection isn't enough today

Even if we persisted a Native connection with empty user/pass, the **central gate** at
`src/tree/connections-view/DocumentDBClusterItem.ts:132‑136` re-launches the authenticate
wizard whenever username **or** password is empty, and that wizard requires a non-empty
username (`ProvideUsernameStep`). So the connection could never be opened, and because the
shell/playground depend on the cache populated *after* a successful connect, they'd be dead
too. A distinct `NoAuth` method lets us cleanly *exclude* that path from the gate.

---

## 3. Phased implementation

### Phase 0 — Connection-string TLS override hardening (independent, low-risk)

The report (§5) shows TLS overrides are **already honored** for native/no-auth. To make the
behavior "solid" and intentional:

- [ ] Add a focused test asserting that a connection string with `tls=false` (and one with
      `ssl=false`, and `tls=true&tlsAllowInvalidCertificates=true`) survives unchanged
      through `ClustersClient` / shell / playground option-building for `NativeAuth`/`NoAuth`
      (i.e., the extension never injects/overrides `tls`).
- [ ] Confirm `NativeAuthHandler` / `connectToClient` / `ShellSessionManager` /
      `PlaygroundEvaluator` only set `tlsAllowInvalidCertificates` for
      `emulator + disableEmulatorSecurity` (already true; lock it with tests).
- [ ] (Optional UX) Surface the effective TLS state in the cluster tooltip the way
      emulator security is shown today (`DocumentDBClusterItem.ts:489‑494`).

> This phase can ship before the no-auth feature and de-risks the "we might override it
> somewhere" concern.

### Phase 1 — Core auth model: introduce `NoAuth`

- [ ] `src/documentdb/auth/AuthMethod.ts`
  - Add `AuthMethodId.NoAuth = 'NoAuth'`.
  - Add `NoAuthMethod: AuthMethodInfo` with localized label
    `vscode.l10n.t('No Authentication')` and detail
    `vscode.l10n.t('Connect without a username or password')`.
  - Include it in `authMethodsArray` (decide ordering: after Native, before/after Entra).
  - `isSupportedAuthMethod` / `authMethodFromString` pick it up automatically.
- [ ] `src/documentdb/auth/AuthConfig.ts` — (optional) add an empty `NoAuthConfig {}`
  marker and extend the `AuthConfig` union, or simply represent NoAuth by the *absence* of
  `nativeAuthConfig`/`entraIdAuthConfig` plus `selectedAuthMethod === NoAuth`.

### Phase 2 — Connection (client) path

- [ ] `src/documentdb/auth/` — add `NoAuthHandler.ts` implementing `AuthHandler`:
  - Returns `{ connectionString: credentials.connectionString, options }` where `options`
    only carries the emulator `tlsAllowInvalidCertificates` rule (mirror `NativeAuthHandler`
    minus the password). **No** `tls` forcing — honor the URI.
- [ ] `src/documentdb/ClustersClient.ts:228‑237` — add `case AuthMethodId.NoAuth:` →
  `new NoAuthHandler(credentials)`.
- [ ] `src/documentdb/CredentialCache.ts`
  - `setFromConnectionItem` (`:251‑294`): when `selectedAuthMethod === NoAuth` (or no
    native/entra config present and the stored method is NoAuth), call `setAuthCredentials`
    with `authMethod = NoAuth` and `nativeAuthConfig = undefined`. The existing
    `setAuthCredentials` already produces a credential-free `connectionStringWithPassword`,
    so the cache entry is valid.
  - `getConnectionStringWithPassword` (`:63‑65`): tighten the return type / add a fallback
    to `connectionString` so callers never receive `undefined` (defensive; helps shell &
    playground).

### Phase 3 — Tree item gate & caching (the key runtime fix)

- [ ] `src/tree/connections-view/DocumentDBClusterItem.ts:132‑136` — update the gate so it
  does **not** prompt when `authMethod === AuthMethodId.NoAuth`:

  ```ts
  const needsNativeCreds =
      authMethod === AuthMethodId.NativeAuth &&
      (!username || username.length === 0 || !password || password.length === 0);
  if (!authMethod || needsNativeCreds) { /* prompt */ }
  ```

  (NoAuth has a defined method and needs no creds, so it skips the wizard.)
- [ ] `:230‑243` — when caching, pass `nativeAuthConfig: undefined` for NoAuth (already the
  case since `username && password` is false), but pass `authMethod = NoAuth` so the cache
  records the method explicitly. Verify `setAuthCredentials` is called with `NoAuth`.
- [ ] `:189‑195` (save path) — fine as-is for NoAuth (no native config saved); ensure
  `connection.properties.selectedAuthMethod = NoAuth` is persisted.

### Phase 4 — Creation wizards

- [ ] `src/commands/newConnection/PromptAuthMethodStep.ts` — already lists all methods via
  `createAuthMethodQuickPickItemsWithSupportInfo`; once `NoAuth` is in `authMethodsArray` it
  appears automatically. Confirm `availableAuthenticationMethods`
  (`PromptConnectionStringStep.ts:51‑57`) includes `NoAuth` (add it to `supportedAuthMethods`).
- [ ] `src/commands/newConnection/PromptUsernameStep.ts:43‑45` &
  `PromptPasswordStep.ts:41‑43` — `shouldPrompt` already gates on
  `selectedAuthenticationMethod === NativeAuth`, so they auto-skip for NoAuth. ✅ No change
  needed beyond verifying.
- [ ] `src/commands/newConnection/ExecuteStep.ts:186‑197` — for NoAuth, store
  `nativeAuthConfig: undefined`, `selectedAuthMethod: NoAuth`, and an
  `availableAuthMethods` that contains `NoAuth`. Label/dedup already handle empty username
  (`:98`, `:138`). ✅
- [ ] `src/documentdb/wizards/authenticate/ChooseAuthMethodStep.ts` — if a NoAuth
  connection ever reaches the authenticate wizard (it shouldn't after Phase 3), make sure
  selecting NoAuth short-circuits the username/password steps. `ProvideUsernameStep`/
  `ProvidePasswordStep` `shouldPrompt` gate on `selectedAuthMethod === NativeAuth`, so they
  already skip. ✅
- [ ] (Optional) `src/commands/newLocalConnection/PromptUsernameStep.ts` — if "no auth"
  should also be offered for local/custom connections, add a NoAuth branch; otherwise leave
  local emulator flows unchanged.

### Phase 5 — Integrated shell

- [ ] `src/commands/openInteractiveShell/openInteractiveShell.ts:55,102` — the
  `hasCredentials` guard becomes satisfied once Phase 3 populates the cache for NoAuth (the
  entry exists even with no username/password). No code change strictly required; verify the
  message path. Consider relaxing to "has a cache entry OR method is NoAuth".
- [ ] `src/documentdb/shell/ShellSessionManager.ts:240‑273` — add NoAuth handling:
  - `authMechanism = credentials.authMechanism ?? 'NativeAuth'` → also accept `'NoAuth'`.
  - For NoAuth use `credentials.connectionString` (or the credential-free
    `connectionStringWithPassword`, which is identical), **not** a password-bearing string.
  - `clientOptions` keep the emulator-only `tlsAllowInvalidCertificates` rule (honor CS TLS).
  - Widen the `authMechanism as 'NativeAuth' | 'MicrosoftEntraID'` cast to include `'NoAuth'`.
- [ ] `src/documentdb/shell/workerTypes.ts` / `playgroundWorker.ts` — extend the
  `authMechanism` union to include `'NoAuth'`; the worker should treat NoAuth like Native
  minus credentials (no `options.tls = true`, no OIDC callback).

### Phase 6 — Query playground

- [ ] `src/documentdb/playground/PlaygroundEvaluator.ts:242‑277` — mirror the shell:
  - Accept `authMechanism === 'NoAuth'`.
  - Use the credential-free connection string.
  - Keep emulator-only `tlsAllowInvalidCertificates`.
- [ ] `src/documentdb/playground/workerTypes.ts` — extend `authMechanism` union.
- [ ] `executePlaygroundCode.ts` telemetry path already null-safe. ✅

### Phase 7 — Databases & collections

No dedicated change expected. Database/collection tree items reuse the authenticated
`ClustersClient` obtained from the (now NoAuth-capable) cache. Action:

- [ ] Verify there are **no** additional `getConnectionUser()` / username-presence
      assumptions on the database/collection read paths (grep showed only display/dedup
      usages). Add a regression test that lists databases over a NoAuth client.

### Phase 8 — Migration tools API (whitelisted external extension)

**Goal:** Confirm a NoAuth connection flows through the migration API to the whitelisted
external extension **without changing the public API surface** (`api/src/migration/*`).

#### 8.1 How the migration integration works today (traced)

There are two distinct boundaries:

1. **API acquisition + provider registration** (whitelist):
   - `api/src/utils/getApi.ts:52‑81` — `getDocumentDBExtensionApi(context, version)` reads
     the host extension's `package.json` → `x-documentdbApi.registeredClients` and throws
     unless `context.extension.id` is in that whitelist. This is purely an **allow-list of
     extension IDs**; it has nothing to do with cluster credentials.
   - `src/extension.ts:124‑138` — v0.3.0 `registerProvider(context, provider)` →
     `MigrationService.registerProviderWithContext(extensionId, provider)`
     (`src/services/migrationServices.ts:109‑123`), enforcing **one provider per
     extension**.
   - The external extension implements `MigrationProvider`
     (`api/src/migration/migrationProvider.ts`): `getAvailableActions(options)` and
     `executeAction(options, id)`.

2. **Per-operation connection sharing** (the part that matters for NoAuth):
   - `src/commands/accessDataMigrationServices/accessDataMigrationServices.ts:114‑130` is the
     **single place** where connection details are handed to the provider:

     ```ts
     const credentials = await node.getCredentials();              // storage read
     if (!credentials) { throw new Error('No credentials found …'); }

     const parsedCS_WithCredentials = new DocumentDBConnectionString(credentials.connectionString);
     parsedCS_WithCredentials.username = CredentialCache.getConnectionUser(node.cluster.clusterId) ?? '';
     parsedCS_WithCredentials.password = CredentialCache.getConnectionPassword(node.cluster.clusterId) ?? '';

     const options = {
         connectionString: parsedCS_WithCredentials.toString(),     // ← the channel
         extendedProperties: { clusterId: node.cluster.clusterId },
     };
     // → selectedProvider.getAvailableActions(options) / executeAction(options, id)
     ```

   - So the **only** way credentials cross the API boundary is the
     `ActionsOptions.connectionString` string (`api/src/migration/migrationProvider.ts:47‑57`).
     The external extension parses it and connects with its own MongoDB driver.

3. **Auth gating** before sharing:
   - `accessDataMigrationServices.ts:100‑112` (provider-level) and `:181‑192` (action-level)
     call `ensureAuthentication()` →
     `accessDataMigrationServices.ts:214‑219`:
     ```ts
     return CredentialCache.hasCredentials(_node.cluster.clusterId);
     ```
     i.e. it only checks that a **cache entry exists**, not that a username is present.

#### 8.2 What happens for a NoAuth connection (analysis)

Walking the same path with empty username/password:

| Step | Behavior for NoAuth | Verdict |
|------|---------------------|---------|
| `node.getCredentials()` (`DocumentDBClusterItem.ts:61‑86`) | Reads from storage; returns the `connectionString` (already credential-free) + `availableAuthMethods`/`selectedAuthMethod`. Independent of username. | ✅ Works |
| `CredentialCache.getConnectionUser()` / `getConnectionPassword()` | Return `undefined` for NoAuth → `?? ''` → empty. | ✅ |
| `parsedCS.username = '' ; parsedCS.password = ''` | The whatwg-url setters drop the userinfo → `mongodb://host/?tls=false` (no `user:pass@`). Same empty-safe behavior already relied on by `CredentialCache.setAuthCredentials` (report §2.3). | ✅ Credential-free CS |
| `options.connectionString` handed to provider | A valid anonymous connection string, **TLS params preserved** (we never strip/inject `tls`/`ssl` here). | ✅ |
| `ensureAuthentication()` → `hasCredentials(clusterId)` | True **once Phase 3 populates the cache** for NoAuth on expand/connect. | ✅ (depends on Phase 3) |

**Conclusion: no API change is required.** `ActionsOptions.connectionString` is a generic
connection string; an empty username/password naturally yields a credential-free URI, and
the whitelist is an extension-ID allow-list unrelated to cluster auth. The migration path
"just works" for NoAuth **provided** the runtime cache is populated (Phase 3) so that:
(a) `node.getCredentials()` returns a record, and (b) `hasCredentials()` returns true for
providers/actions that set `requiresAuthentication`.

#### 8.3 Required work (small, host-side only — no `api/` changes)

- [ ] **Verify-only:** Confirm `accessDataMigrationServices.ts:121‑126` produces a
      credential-free connection string for NoAuth and that `tls`/`ssl` query params from the
      stored connection string survive (add a unit test around this block, mocking
      `CredentialCache.getConnectionUser/Password` → `undefined`).
- [ ] **Cache dependency:** Ensure the NoAuth changes in Phase 3 cause
      `CredentialCache.hasCredentials(clusterId)` to be `true` after the user expands/connects,
      so `ensureAuthentication()` (`:215`) passes for providers that set
      `requiresAuthentication`. (No change in `accessDataMigrationServices.ts` expected.)
- [ ] **Edge guard (optional):** `accessDataMigrationServices.ts:117‑119` throws "No
      credentials found" if `node.getCredentials()` is `undefined`. For NoAuth this returns a
      record (it's keyed on stored connection, not username), so the throw won't fire — but add
      a test to lock that contract.

#### 8.4 Explicitly out of scope (do NOT change)

- `api/src/migration/migrationApi.ts`, `migrationProvider.ts`, `index.ts`,
  `api/src/utils/getApi.ts`, `api/src/extensionApi.ts` — the public API stays as-is. NoAuth
  is transported transparently via the existing `connectionString` field.
- The whitelist mechanism (`x-documentdbApi.registeredClients`) — unrelated to auth method.

#### 8.5 Caveat to communicate to provider authors (no code change)

The external (whitelisted) migration extension connects using the connection string we give
it. If **its** own code assumes a non-empty username (e.g. validates `user:pass@` is
present, or force-injects TLS), it may reject a NoAuth/`tls=false` URI. That's outside this
repo, but worth a note in the API docs (`api/README.md`) that the shared `connectionString`
may be credential-free and may carry explicit `tls`/`ssl` overrides, and providers should
pass it to the driver verbatim rather than reconstructing it.

---

## 4. Persistence & migration

- New connections: store `selectedAuthMethod: 'NoAuth'`,
  `availableAuthMethods: [... 'NoAuth']`, `secrets.nativeAuthConfig: undefined`.
- Existing connections: unaffected (no migration needed). `setFromConnectionItem`'s
  inference (`CredentialCache.ts:258‑272`) must **not** mis-classify a NoAuth item as
  Native: when `selectedAuthMethod === 'NoAuth'`, prefer it over the
  "first available method" fallback.

---

## 5. Testing checklist

- [ ] Unit: `AuthMethod` includes NoAuth; quick-pick items render it.
- [ ] Unit: `CredentialCache.setFromConnectionItem` with a NoAuth item produces an entry
      with `authMechanism = NoAuth`, `nativeAuthConfig = undefined`, and a credential-free
      `connectionStringWithPassword`.
- [ ] Unit: `getConnectionStringWithPassword` never returns `undefined` for a valid entry.
- [ ] Unit/Integration: `DocumentDBClusterItem` gate does **not** prompt for NoAuth.
- [ ] Integration: connect → list databases → list collections over NoAuth.
- [ ] Integration: open integrated shell against a NoAuth connection.
- [ ] Integration: run a playground statement against a NoAuth connection.
- [ ] Migration API: `accessDataMigrationServices` builds a credential-free
      `options.connectionString` for NoAuth (mock `getConnectionUser/Password → undefined`)
      and preserves `tls`/`ssl` query params; `ensureAuthentication` passes once the cache is
      populated.
- [ ] TLS: connection string `tls=false` / `ssl=false` is honored end-to-end (Phase 0).
- [ ] Regression: Native and Entra flows unchanged.
- [ ] `TDD:`-prefixed tests: if any exist around auth, **do not** auto-edit — confirm intent
      with the maintainer per repo policy.

## 6. Localization & housekeeping

- [ ] New user-facing strings (`'No Authentication'`, detail text) go through
      `vscode.l10n.t(...)`; run `npm run l10n`.
- [ ] `npm run prettier-fix`, `npm run lint`, `npx jest --no-coverage`, `npm run build`
      before opening a PR.

---

## 7. Risk notes

- **Biggest behavioral risk:** the central gate change in `DocumentDBClusterItem`. Keep the
  Native/Entra branches byte-for-byte equivalent; only add a NoAuth exclusion.
- **Silent-undefined risk:** `getConnectionStringWithPassword` null-safety (Phase 2) guards
  shell/playground from passing `undefined` to `new MongoClient`.
- **Inference risk:** `setFromConnectionItem` method-inference must respect an explicit
  `selectedAuthMethod === 'NoAuth'` and not fall back to Native.
- **TLS:** no override risk for native/no-auth today; the only forced-TLS path is Entra
  (intentional). Don't generalize the Entra TLS forcing into the shared worker code.
- **Migration API:** no public API change; the risk is entirely host-side and hinges on the
  Phase 3 cache population (so `getCredentials()`/`hasCredentials()` behave). External
  providers that assume embedded credentials are out of our control — document the
  credential-free/TLS-override possibility in `api/README.md`.
