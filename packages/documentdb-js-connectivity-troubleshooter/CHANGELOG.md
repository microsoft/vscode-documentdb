# Changelog

## 0.1.0 — Unreleased: initial package scaffold and public types

- Add `hostPhaseStarted` events announcing the ordered checks and fixed targets of each host phase.
- Add consumer-supplied Markdown report text, safe Markdown rendering and the complete code/data catalogue.
- Add immutable report snapshots, bounded sanitization, optional identifier redaction and JSON rendering.
- Add bounded unauthenticated wire handshakes, compression negotiation, clock offsets and the built-in check factory.
- Add effective network option origins and injectable TCP/TLS probes with verification-first certificate diagnostics.
- Add injectable SRV/TXT resolution and per-host DNS checks with resolver comparison and address classification.
- Add secret-free environment facts and connection-string validation checks.
- Add ordered check execution, host chains, timeout profiles, cancellation, events and injectable clocks.
