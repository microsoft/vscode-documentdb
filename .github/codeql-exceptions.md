# CodeQL exceptions

This file records the rationale for individual alert dismissals. It is not consumed by
CodeQL and does not disable any rule. Dismiss only the matching alert in GitHub.

## Alert 40: In-memory connection fingerprint

- **Finding:** [Alert 40](https://github.com/microsoft/vscode-documentdb/security/code-scanning/40),
  `js/insufficient-password-hash`, in [connectionFingerprint.ts](../src/documentdb/connectionFingerprint.ts).
- **Disposition:** False positive for password verification. The fingerprint compares connection
  identities inside one running extension host. It is not used to verify a password. The helper omits
  the URI authority password; other URI options can still contain credentials. HMAC-SHA-256 uses a
  random host-local key, and neither the fingerprint nor the key is persisted, logged, or sent outside
  that host.
- **Revisit if:** The fingerprint or key is persisted or shared, or the fingerprint is used for
  password verification.

See [decision 0021](../docs/ai-and-plans/features/connection-lifecycle/decisions.md#0021-key-the-in-memory-connection-fingerprint-per-extension-host)
for the implementation rationale.
