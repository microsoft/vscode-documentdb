---
feature: no-auth
kind: notes
status: active
prs: [755]
verified: 2026-08-14
code:
    - src/documentdb/auth/**
    - src/commands/newConnection/**
---

# No Authentication

**Status:** shipped · **Verified:** 2026-08-14

> Why "No Authentication" is its own auth method rather than native auth with empty credentials.

A user can create and fully use a connection that has no username, no password, and no Entra ID —
browse databases and collections, open the Interactive Shell, and run the Query Playground — while
the connection string's own TLS settings are honored rather than overridden.

## Code map

- `src/documentdb/auth/**` — `AuthMethod.ts` (the `AuthMethodId.NoAuth` member and its metadata) and
  `NoAuthHandler.ts`
- `src/commands/newConnection/**` — the auth-method step and `ExecuteStep`
- `src/documentdb/CredentialCache.ts`, `src/documentdb/ClustersClient.ts` — cache and client routing

## Architecture (intent — code is authoritative for behavior)

- **`NoAuth` is an explicit third auth method.** Overloading native auth with empty credentials
  would have been smaller, but it is not discoverable in the auth-method quick pick, it muddies
  native-auth semantics, and it does not fit the auth-handler `switch`.
- **The connection string is passed verbatim, and TLS is never forced.** The only exception is the
  emulator's `tlsAllowInvalidCertificates` rule, which mirrors the native handler. Connections whose
  string disables TLS carry a visible description and tooltip line, mirroring the emulator's
  "disable security" treatment.
- **Pasted credentials are ignored unless native auth is actually selected.** Previously, pasting
  `user:pass@host` and then choosing No Authentication reused the pasted username for duplicate
  detection and leaked it into stored secrets.
- **Connection labels come from the host, not `user@host`** — for all new connections, not just
  anonymous ones.
- **Connecting and listing databases are different failures.** A connection can succeed while the
  server still rejects `listDatabases()`, so tree expansion has its own error recovery path.

## Timeline

| Date       | PR   | What changed                                        | Docs                                                                                                |
| ---------- | ---- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 2026-06-23 | #755 | No Authentication support, TLS hardening, review     | [iterations/01-no-auth-support/](./iterations/01-no-auth-support/)                                   |

## Decisions

No separate `decisions.md`. The single decision — an explicit method rather than an overloaded one —
is stated with its rationale in
[iterations/01-no-auth-support/summary.md](./iterations/01-no-auth-support/summary.md).

## Open gaps

The "Out of scope / unchanged" section of
[iterations/01-no-auth-support/summary.md](./iterations/01-no-auth-support/summary.md) is the record
of what was deliberately not touched, including the migration-tools API surface.

## Reading order for newcomers

1. This README
2. [iterations/01-no-auth-support/summary.md](./iterations/01-no-auth-support/summary.md)
3. [iterations/01-no-auth-support/username-and-tls-checks-report.md](./iterations/01-no-auth-support/username-and-tls-checks-report.md)
   for the evidence behind the username and TLS rules
