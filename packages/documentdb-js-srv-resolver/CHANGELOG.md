# Changelog

## 1.0.0

Initial release.

- Falls back to an in-memory DNS client when Node.js rejects an otherwise valid compressed SRV reply.
- Uses only the DNS servers configured for the process, with UDP and TCP fallback and no public resolver.
- Rewrites `mongodb+srv://` connection strings with driver-compatible SRV and TXT rules while preserving credentials and caller options.
- Supports cancellation, a bounded fallback deadline, trace logging, and structured resolution reports.
- Exports the lower-level SRV URI rewrite and DNS lookup building blocks for callers that need them independently.