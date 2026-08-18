---
feature: webview-ext-package
kind: notes
status: active
prs: [676, 766, 786, 795]
verified: 2026-08-14
code:
  - packages/vscode-ext-webview/**
  - src/webviews/_integration/**
---

# `@microsoft/vscode-ext-webview`

**Status:** published preview · **Verified:** 2026-08-14

> Why the webview transport was extracted into a standalone package, and what "consumer concerns"
> had to be pushed back out of it.

`packages/vscode-ext-webview` is a reusable package that carries the framework half of this
extension's webview stack: tRPC over `postMessage`, the `WebviewController` lifecycle, and the
middleware seams around them. This extension consumes it through `src/webviews/_integration/`.

## Code map

- `packages/vscode-ext-webview/**` — the published package
- `src/webviews/_integration/**` — this extension's consumer layer: `appRouter`, `WebviewRegistry`,
  the tRPC client hook, and the telemetry sink

## Related skills

- [.github/skills/webview-trpc-messaging](../../../../.github/skills/webview-trpc-messaging/SKILL.md)
- [.github/skills/react-webview-architecture](../../../../.github/skills/react-webview-architecture/SKILL.md)

## Migration manual

- [migration-manual.md](./migration-manual.md) — the old-to-new rename map
  (package, folders, subpaths, symbols) for migrating a consumer onto the package. It records
  this package's own rename and doubles as the template for the parallel vscode-cosmosdb
  adoption.

## Architecture (intent — code is authoritative for behavior)

[design.md](./design.md) is the durable document. The load-bearing ideas:

- **Framework concerns and consumer concerns are separated.** The transport, controller lifecycle,
  and middleware seams belong to the package. DocumentDB telemetry sinks, bundle layout, and
  configuration knobs belong to the consumer.
- **The design was benchmarked against a partner package.** `@cosmosdb/webview-rpc`, extracted for
  the `vscode-cosmosdb` extension, is the comparison point; the goal was a package flexible enough
  for that extension to adopt.
- **Telemetry middleware is thin.** The package exposes a generic runner; product-specific event
  shaping stays outside it.

## Timeline

| Date       | PR   | What changed                                            | Docs                                                                                     |
| ---------- | ---- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 2026-05-22 | #676 | Preview hardening and consumer reshape                  | [iterations/01-preview-hardening.md](./iterations/01-preview-hardening.md)               |
| 2026-06-24 | #766 | Package redesign: design, plan, and review              | [iterations/02-package-redesign/](./iterations/02-package-redesign/)                     |
| 2026-07-06 | #786 | Publish-readiness tweaks                                | [iterations/03-publish-readiness-tweaks.md](./iterations/03-publish-readiness-tweaks.md) |
| 2026-07-14 | #795 | Thin telemetry middleware and a generic TelemetryRunner | [iterations/04-thin-telemetry-review.md](./iterations/04-thin-telemetry-review.md)       |

## Decisions

No separate `decisions.md`. The alternatives and their trade-offs are argued in
[design.md](./design.md) and re-litigated in
[iterations/02-package-redesign/review.md](./iterations/02-package-redesign/review.md).

## Open gaps

Recorded in the package's own `README.md` and `ADVANCED.md`, and in the publish-readiness notes.

## Reading order for newcomers

1. This README
2. [design.md](./design.md)
3. [migration-manual.md](./migration-manual.md) if
   you are moving a consumer onto the package
