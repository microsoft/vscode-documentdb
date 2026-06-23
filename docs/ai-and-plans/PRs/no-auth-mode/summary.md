# PR Summary — "No Authentication" connection support

> Iterative working summary of what was implemented and why. Update as the PR evolves.
> Companion analysis: [`01-username-and-tls-checks-report.md`](./01-username-and-tls-checks-report.md).

## Goal

Let a user create and fully use a connection that has **no username, no password, and no
Entra ID** — explore databases/collections, open the integrated shell, and run the query
playground — while **honoring connection-string TLS/SSL overrides** (e.g. `tls=false`).

## Design decision

Introduced an explicit third authentication method, `AuthMethodId.NoAuth` ("No
Authentication"), rather than overloading `NativeAuth` with empty credentials. This is
explicit, discoverable in the auth-method quick pick, keeps `NativeAuth` semantics intact,
and maps cleanly onto the existing auth-handler `switch` architecture.

## What changed (by area)

| Area | Change | Why |
|------|--------|-----|
| Auth model (`auth/AuthMethod.ts`) | Added `AuthMethodId.NoAuth`, `NoAuthMethod` metadata, and registered it in the methods array. | Makes "No Authentication" a first-class, discoverable choice. |
| Client path (`auth/NoAuthHandler.ts`, `ClustersClient.ts`) | New credential-free auth handler; routed via the auth `switch`. Passes the connection string verbatim and never forces TLS (only the emulator `tlsAllowInvalidCertificates` rule, mirroring `NativeAuthHandler`). | Anonymous driver connection that honors URI `tls`/`ssl`. |
| Cache (`CredentialCache.ts`) | `setFromConnectionItem` respects an explicit `selectedAuthMethod === NoAuth` (no Native misclassification). `getConnectionStringWithPassword` is now null-safe (falls back to `connectionString`). | Prevents broken/undefined cache state for anonymous connections. |
| Tree gate (`DocumentDBClusterItem.ts`) | The connect gate no longer re-prompts for credentials when the method is `NoAuth`. Added a TLS/SSL-disabled **description** and a tooltip line for non-emulator connections whose connection string disables TLS (`tls=false`/`ssl=false`), mirroring the emulator "disable security" UX. The tooltip line is only added when TLS is disabled. | Anonymous connections can connect; TLS-off state is visible. |
| Creation wizard (`newConnection/*`) | `NoAuth` offered in the auth-method list. New connection labels are now derived from the host(s) only — the username prefix (`user@host`) was dropped for **all** new connections. NoAuth connections are stored with `nativeAuthConfig: undefined`. | Consistent, credential-free naming; correct persistence. |
| Creation wizard dedup/persistence (`newConnection/ExecuteStep.ts`) | Native credentials parsed from a *pasted* connection string are now ignored unless the user actually selects **Native** auth. Previously, pasting `user:pass@host` and then choosing **No Authentication** (or **Entra ID**) reused the pasted username for duplicate detection — producing a false "A connection with the same username and host already exists." error — and leaked the pasted username/password into stored secrets. | Anonymous/Entra connections can be created next to an existing native connection on the same host, and never persist stray native credentials. |
| Integrated shell (`shell/*`, `playground/workerTypes.ts`) | `authMechanism` union widened to include `'NoAuth'`; NoAuth uses the credential-free connection string; a "No Authentication" banner label is shown. | Shell works against anonymous connections. |
| Query playground (`playground/PlaygroundEvaluator.ts`) | Same NoAuth handling as the shell. | Playground works against anonymous connections. |
| Migration tools API | **No `api/` changes.** Verified host-side that a NoAuth connection yields a credential-free `options.connectionString` while preserving `tls`/`ssl`. Locked with a test. | The whitelist is an extension-ID allow-list; NoAuth is transported transparently via the existing `connectionString`. |

## TLS/SSL handling (hardening)

For native/no-auth connections the driver already honors connection-string `tls`/`ssl`
parameters; the extension only *adds* the emulator-specific `tlsAllowInvalidCertificates`
rule and never forces TLS. This is now locked with tests in `NoAuthHandler.test.ts`.

## Tests added

- `auth/NoAuthHandler.test.ts` — connection string passes through verbatim; TLS never
  forced/injected; emulator-only `tlsAllowInvalidCertificates`.
- `auth/AuthMethod.test.ts` — `NoAuth` is supported, listed, and renders in the quick pick.
- `CredentialCache.test.ts` — NoAuth `setFromConnectionItem` yields a credential-free entry
  with `authMechanism = NoAuth` and `nativeAuthConfig = undefined`, preserving `tls=false`;
  `getConnectionStringWithPassword` never returns `undefined`.
- `accessDataMigrationServices/noAuthMigration.test.ts` — the shared connection string for a
  NoAuth connection is credential-free and preserves `tls=false` / `ssl=false`.
- `newConnection/ExecuteStep.test.ts` — pasted credentials are ignored for NoAuth/Entra ID
  (no false duplicate, no leaked secrets), anonymous-vs-anonymous duplicates are still detected,
  and Native duplicate detection + credential persistence are preserved.

## Out of scope / unchanged

- Public migration API surface (`api/src/migration/*`, `api/src/utils/getApi.ts`).
- Entra ID TLS forcing (intentional, OIDC requires TLS).
- No storage version bump needed — only a new auth-method enum value was added.

## Commit breakdown

Each work item is a separate commit on `dev/tnaum/no-auth-mode` (no reverts/resets; fixes are
added on top):

1. Relocate the username/TLS report into the PRs folder.
2. Add `NoAuth` to the auth model.
3. NoAuth handler + client routing + cache hardening.
4. Tree-item gate skip + TLS-disabled surfacing.
5. New-connection wizard: offer NoAuth + drop username prefix from labels.
6. Integrated shell NoAuth support.
7. Query playground NoAuth support.
8. Tests (TLS/no-auth/migration contract).
