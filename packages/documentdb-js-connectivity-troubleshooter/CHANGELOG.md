# Changelog

## 0.1.0

Initial release. Not yet published to npm.

- Ordered check execution with concurrent per-host chains, timeout profiles (default, longer, no diagnostic timeouts), safety limits, cancellation, run events (including `hostPhaseStarted` for each host phase) and injectable clocks.
- Built-in checks through `createBuiltInChecks()`: secret-free environment facts, connection-string validation, injectable SRV/TXT resolution, per-host DNS with resolver comparison and address classification, TCP and TLS probes with effective network option origins and verification-first certificate diagnostics, and a bounded unauthenticated wire handshake with compression negotiation and clock offset.
- Stable finding codes with structured data and language-tagged English details; the complete code and data catalogue is in the README.
- Immutable report snapshots with bounded sanitization and optional identifier redaction, rendered as JSON or as safe Markdown from consumer-supplied report text.
