# Changelog

## 0.1.0

Initial release.

- Ordered check execution with concurrent per-host chains, timeout profiles (default, longer, no diagnostic timeouts), safety limits, cancellation, run events (including `hostPhaseStarted` for each host phase) and injectable clocks.
- Explicit timeout profiles for `resolveTimeouts()`; diagnostic overrides and connection timeouts reject values above the exported `MAX_TIMEOUT_MS` (`2_147_483_647`) before checks or I/O.
- Built-in checks through `createBuiltInChecks()`: secret-free environment facts, connection-string validation, injectable SRV/TXT resolution, per-host DNS with resolver comparison and address classification, TCP and TLS probes with effective network option origins and verification-first certificate diagnostics, and a bounded unauthenticated wire handshake with compression negotiation and clock offset.
- Transport findings include address classification when known, with local-endpoint guidance for loopback TCP failures and missing handshake replies; TLS handshake closure does not infer a cause.
- Stable finding codes with structured data and language-tagged English details; the complete code and data catalogue is in the README.
- Immutable report snapshots with bounded sanitization and optional identifier redaction, rendered as JSON or as safe Markdown from consumer-supplied report text. Typed steps, findings and server rows retain omission counts when truncated, with Markdown omission notices.
- Identifier redaction replaces known identifiers even in certificate issuer chains while preserving public issuer names; consumer-defined identifier keys include kubeconfig contexts.
