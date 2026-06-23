# Report: Username / Password Presence Checks & TLS Override Handling

**Scope:** Locate every place in the codebase that requires (or silently assumes) a
non‑empty **username** and/or **password**, and assess whether a connection-string
**TLS/SSL override** is honored.

**Goal context:** A user wants to add and use a connection that has **no username, no
password, and no Entra ID** (a truly anonymous / "no auth" cluster), explore it, open the
integrated shell and the query playground — and optionally **disable TLS** via the
connection string.

> Terminology note: "DocumentDB" = the service; "MongoDB API" / "DocumentDB API" = the
> wire protocol. The MongoDB Node driver natively supports anonymous connections
> (`mongodb://host/` with no credentials) and honors `tls` / `ssl` URI parameters.

---

## 1. Executive summary

There are **two categories** of obstacles:

1. **Hard input validators** in the wizards that reject an empty username/password
   (the one you already knew about, plus four siblings).
2. **A central runtime gate** in the Connections tree item that *re‑prompts* for
   credentials every time a Native‑auth connection has an empty username **or** password —
   so even a stored "empty creds" connection can never connect without being asked again.

Beyond those, several helpers **silently drop** an all‑empty `nativeAuthConfig`
(`username || password ? {…} : undefined`), which means the cache/shell/playground can
end up with **no auth config at all** and then assume `NativeAuth` with a password‑bearing
connection string that does not exist.

**TLS/SSL:** Good news — for Native auth the **driver honors the connection-string
`tls`/`ssl` parameters**. The extension does **not** force TLS for native connections; it
only *adds* `tlsAllowInvalidCertificates` for emulator connections that opted into
"disable emulator security". The only place TLS is forced on is the **Entra ID** handler
(by design). See §5.

---

## 2. The blockers, grouped

Legend: 🛑 BLOCK = stops the user; 💥 BREAK = silently produces a broken/undefined state;
🏷️ COSMETIC = label/dedup only.

### 2.1 Wizard input validators (BLOCK at create / authenticate time)

| # | File:Line | Check | Effect |
|---|-----------|-------|--------|
| 1 | `src/commands/newConnection/PromptUsernameStep.ts:24‑29` | `asyncValidationTask` → `'Username cannot be empty'` | 🛑 The one you knew about — new connection wizard rejects empty username. |
| 2 | `src/commands/newConnection/PromptPasswordStep.ts:25‑30` | `asyncValidationTask` → `'Password cannot be empty'` | 🛑 Same wizard rejects empty password. |
| 3 | `src/documentdb/wizards/authenticate/ProvideUsernameStep.ts:21‑26` | `asyncValidationTask` → `'Username cannot be empty'` | 🛑 Authenticate-on-connect wizard (runs when expanding a cluster) rejects empty username. |
| 4 | `src/commands/newLocalConnection/PromptUsernameStep.ts:18‑23` | `asyncValidationTask` → `'Username cannot be empty'` | 🛑 Local/emulator connection wizard rejects empty username (when `emulatorType === 'documentdb'` or custom connection string). |
| 5 | `src/commands/updateCredentials/PromptUserNameStep.ts:19‑24` | `asyncValidationTask` → `'Username cannot be empty'` | 🛑 "Update credentials" command rejects empty username. |

**Notable asymmetry:** `src/documentdb/wizards/authenticate/ProvidePasswordStep.ts` has
**no** non-empty validator (an empty password is allowed there). So password emptiness is
enforced inconsistently across wizards.

Secondary username-presence (non-async) validators that are *not* hard blockers but worth
knowing:

- `src/commands/newConnection/PromptUsernameStep.ts:47‑63` — `validateInput` only checks
  encodability (returns `undefined` for empty, deferring to the async validator).
- `src/commands/newConnection/PromptPasswordStep.ts:45‑61` — same pattern for password.

### 2.2 The central runtime gate (BLOCK on connect / expand) — most important

**`src/tree/connections-view/DocumentDBClusterItem.ts:132‑136`**

```ts
if (
    !authMethod ||
    (authMethod === AuthMethodId.NativeAuth &&
        (!username || username.length === 0 || !password || password.length === 0))
) {
    // → launches the AuthenticateWizard (ChooseAuthMethod → ProvideUsername → ProvidePassword → SaveCredentials)
}
```

This is the **heart of the problem**. Every time a Native-auth cluster is expanded, if the
username **or** password is empty, the code forces the authenticate wizard — which (via #3)
requires a non-empty username. So a "no auth" connection can never get past tree expansion,
which in turn means **the shell and playground never get cached credentials** (they depend
on a prior successful connect; see §3, §4).

Related credential-caching gates in the same file:

- `DocumentDBClusterItem.ts:235‑240` — when caching after connect:
  `username && password ? { connectionUser, connectionPassword } : undefined`. With empty
  creds this passes `nativeAuthConfig: undefined` to `CredentialCache.setAuthCredentials`. 💥
- `DocumentDBClusterItem.ts:189‑195` — when *saving* chosen creds:
  `authMethod === NativeAuth && (username || password) ? {…} : undefined`. 💥

### 2.3 CredentialCache logic that drops empty auth config (BREAK)

- **`src/documentdb/CredentialCache.ts:290`** (`setFromConnectionItem`):

  ```ts
  username || password ? { connectionUser: username, connectionPassword: password } : undefined
  ```

  Empty username **and** empty password ⇒ `nativeAuthConfig` becomes `undefined`. 💥
  Downstream, `authMechanism` then defaults to `NativeAuth` but there is no native config.

- **`src/documentdb/CredentialCache.ts:216‑223`** (`setAuthCredentials`): coalesces
  `connectionUser`/`connectionPassword` to `''` and always builds
  `connectionStringWithPassword`. This part **is** empty-safe (it produces
  `mongodb://host/…` with no `user:pass@`). ✅ — but it is only reached if a non-undefined
  `nativeAuthConfig` is passed in, which §2.2/§2.3 prevent for empty creds.

- **`src/documentdb/CredentialCache.ts:63‑65`** (`getConnectionStringWithPassword`):

  ```ts
  return CredentialCache._store.get(clusterId)?.connectionStringWithPassword as string;
  ```

  Unsafe cast: can return `undefined` while typed as `string`. Shell & playground pass this
  straight to `new MongoClient(...)`. 💥

### 2.4 Integrated shell (BLOCK / BREAK)

- **`src/commands/openInteractiveShell/openInteractiveShell.ts:55` and `:102`**

  ```ts
  if (!CredentialCache.hasCredentials(connectionInfo.clusterId)) {
      void vscode.window.showErrorMessage(l10n.t('Not signed in to {0}. Please authenticate first.', …));
      return;
  }
  ```

  🛑 Requires a cache entry. (A no-auth cluster that never connected has none.)

- **`src/documentdb/shell/ShellSessionManager.ts:241‑244`** — `getCredentials()` →
  `throw 'No credentials found for cluster …'`. 💥
- **`src/documentdb/shell/ShellSessionManager.ts:249‑253`** — for `NativeAuth` (the default
  when `authMechanism` is unset) it uses `getConnectionStringWithPassword(...)`, which may be
  `undefined` for empty creds (§2.3). 💥
- Username display only: `ShellSessionManager` → `CredentialCache.getConnectionUser(...)`
  and `DocumentDBShellPty.ts` / `ShellTerminalLinkProvider.ts` already treat
  `username: string | undefined` safely. ✅

### 2.5 Query playground (BLOCK / BREAK)

- **`src/documentdb/playground/PlaygroundEvaluator.ts:243‑246`** — `getCredentials()` →
  `throw 'No credentials found for cluster "…"'`. 💥
- **`src/documentdb/playground/PlaygroundEvaluator.ts:252‑257`** — for `NativeAuth` uses
  `getConnectionStringWithPassword(...)` (same undefined risk). 💥
- **`src/commands/playground/executePlaygroundCode.ts:251‑265`** — only reads credentials
  for **telemetry** and is wrapped in try/catch with an early return. ✅ Not a blocker.

### 2.6 Cosmetic / dedup uses of username (not blockers)

- `src/commands/newConnection/ExecuteStep.ts:98` — duplicate detection compares
  `existingUsername === newUsername` (empty compares fine). 🏷️
- `src/commands/newConnection/ExecuteStep.ts:138` — label is
  `newUsername ? \`${newUsername}@${hosts}\` : hosts` (already handles empty). 🏷️
- `src/tree/connections-view/DocumentDBClusterItem.ts:224‑226, 484‑485` — output/tooltip
  text uses username only when present. 🏷️

---

## 3. How the shell obtains credentials (flow)

```
openInteractiveShell(node)
  └─ guard: CredentialCache.hasCredentials(clusterId)            ← 🛑 §2.4
  └─ DocumentDBShellPty → ShellSessionManager.buildInitMessage()
       ├─ CredentialCache.getCredentials(clusterId)              ← 💥 throws if missing §2.4
       ├─ authMechanism = credentials.authMechanism ?? 'NativeAuth'
       ├─ NativeAuth → CredentialCache.getConnectionStringWithPassword(clusterId)  ← 💥 §2.3
       └─ clientOptions.tlsAllowInvalidCertificates only for emulator+disableEmulatorSecurity
  └─ worker (playgroundWorker.ts) → new MongoClient(connectionString, options)
```

The shell **never prompts** for credentials itself — it relies entirely on the cache that
the tree item populates after a successful connect (§2.2). So fixing §2.2 is a prerequisite.

## 4. How the playground obtains credentials (flow)

```
executePlaygroundCode(connection, code)
  └─ PlaygroundEvaluator.buildInitMessage(connection)
       ├─ CredentialCache.getCredentials(clusterId)              ← 💥 throws if missing §2.5
       ├─ NativeAuth → CredentialCache.getConnectionStringWithPassword(clusterId)  ← 💥 §2.3
       └─ clientOptions.tlsAllowInvalidCertificates only for emulator+disableEmulatorSecurity
  └─ worker → new MongoClient(connectionString, options)
```

Same dependency on the cache populated by tree-item connect.

---

## 5. TLS / SSL override handling

**Question:** If the user provides `?tls=false` (or `?ssl=false`, or
`?tls=true&tlsAllowInvalidCertificates=true`) in the connection string, is it honored?

**Answer:** For **Native auth / no auth — yes, it is honored.** The connection string is
passed through to `new MongoClient(connectionString, options)` and the driver parses
`tls`/`ssl` URI options. The extension does **not** override them for native connections.

Evidence of the *only* places that touch TLS in client options:

| File:Line | What it does | Honors CS override? |
|-----------|--------------|---------------------|
| `src/documentdb/auth/NativeAuthHandler.ts:21‑28` | Sets `tlsAllowInvalidCertificates = true` **only** when `emulatorConfiguration.isEmulator && disableEmulatorSecurity`. Never sets `tls`. | ✅ CS `tls`/`ssl` untouched. |
| `src/documentdb/connectToClient.ts:25‑28` | Same emulator-only `tlsAllowInvalidCertificates`. (RU path.) | ✅ |
| `src/documentdb/shell/ShellSessionManager.ts:255‑262` | Same emulator-only `tlsAllowInvalidCertificates`. | ✅ |
| `src/documentdb/playground/PlaygroundEvaluator.ts:260‑267` | Same emulator-only `tlsAllowInvalidCertificates`. | ✅ |
| `src/documentdb/playground/playgroundWorker.ts:121` | `options.tls = true` **only** inside the `authMechanism === 'MicrosoftEntraID'` branch. | ➖ Entra-only (expected). |
| `src/documentdb/auth/MicrosoftEntraIDAuthHandler.ts:40,45` | `searchParams.delete('tls')` then forces `tls: true`. | ➖ Entra-only (OIDC requires TLS — by design). |

**Where TLS is *injected* into the connection string (not overriding the user, but worth
knowing):**

- `src/commands/newLocalConnection/PromptConnectionTypeStep.ts:96,100` — the *emulator
  quick-create* path hardcodes `?directConnection=true&tls=true&tlsAllowInvalidCertificates=true`.
- `src/plugins/service-kubernetes/kubernetesClient.ts:627‑628` — discovery sets `tls=true`
  and `tlsAllowInvalidCertificates=true` for DKO gateways.
- `src/vscodeUriHandler.ts:135` — infers `disableEmulatorSecurity` from
  `tlsAllowInvalidCertificates=true` in an incoming deep-link CS.

**Conclusion for TLS:** The checks are "not really solid" as you suspected, but they are
**additive** (emulator-only `tlsAllowInvalidCertificates`) rather than *overriding* the
user's `tls`/`ssl` choice for native/no-auth connections. The one true override is
Entra-ID-only. **A user-supplied TLS override on a Native/no-auth connection is already
honored** — the main risk is the emulator/local quick-create flows that *inject* TLS params,
and the fact that nothing validates or surfaces the effective TLS setting. See the plan for
a hardening recommendation (Phase 5).

---

## 6. Consolidated list of files to touch for "no auth"

(Full design in `02-no-auth-support-plan.md`.)

1. `src/documentdb/auth/AuthMethod.ts` — add a `NoAuth` method (id, label, quickpick).
2. `src/documentdb/auth/AuthConfig.ts` — (optional) `NoAuthConfig` marker type.
3. `src/documentdb/auth/NativeAuthHandler.ts` *or* new `NoAuthHandler.ts` — build a
   credential-free connection string.
4. `src/documentdb/ClustersClient.ts:228‑237` — route `NoAuth` in the auth-handler switch.
5. `src/tree/connections-view/DocumentDBClusterItem.ts:132‑136` — exclude `NoAuth` from the
   "must prompt for credentials" gate; and `:189‑195`, `:235‑240` caching gates.
6. `src/documentdb/CredentialCache.ts:251‑294` (`setFromConnectionItem`) and `:63‑65`
   (`getConnectionStringWithPassword` null-safety).
7. `src/documentdb/shell/ShellSessionManager.ts:240‑262` — handle `NoAuth` (use plain
   connection string, no `…WithPassword`).
8. `src/documentdb/playground/PlaygroundEvaluator.ts:242‑267` — same `NoAuth` handling.
9. Wizards: `src/commands/newConnection/{PromptUsernameStep,PromptPasswordStep}.ts`,
   `src/documentdb/wizards/authenticate/{ProvideUsernameStep,ProvidePasswordStep,ChooseAuthMethodStep}.ts`
   — skip when `NoAuth` is selected.
10. `src/commands/openInteractiveShell/openInteractiveShell.ts:55,102` — `hasCredentials`
    works once the cache is populated for `NoAuth`; verify messaging.
