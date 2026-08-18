---
feature: webview-fluentui-package
kind: notes
status: active
created: 2026-08-18
code:
  - src/webviews/theme/**
  - src/webviews/components/wizard/WizardBreadcrumb.tsx
---

# `@microsoft/vscode-ext-webview-fluentui`

**Status:** in design · **Created:** 2026-08-18

> The React theming layer and a small set of components, extracted so other VS Code extensions can
> make Fluent UI look correct inside a webview without rebuilding it.

This is the **second** package extracted from this extension's webview stack. The first,
[`@microsoft/vscode-ext-webview`](../webview-ext-package/README.md), carries the transport: tRPC over
`postMessage`, the controller lifecycle, the middleware seams.

The two are independent by design. Neither depends on the other, in either direction.

## Why this exists

When the transport package was extracted, UI helpers were **deliberately** left out.
[webview-ext-package/iterations/01-preview-hardening.md](../webview-ext-package/iterations/01-preview-hardening.md)
records the reason: accessibility helpers were re-homed into the extension rather than the package,
because _"a UX kit grows fast and accumulates opinions that not every consumer shares. A transport
package is easy to maintain, easy to review, and easy to adopt."_

**This package is the UX kit that decision deferred.** It therefore has to carry its own scope
discipline, or it becomes exactly the opinion sink that was feared. That is decision 0001, and it is
the most important thing in this folder.

## What problem it actually solves

Fluent UI inside a VS Code webview looks like Microsoft Teams, not like VS Code. Its neutral color
ramp is a fixed gray produced by `createLightTheme`/`createDarkTheme` and it ignores the user's
active workbench theme entirely.

The theming layer fixes that in two moves:

1. Reads the user's accent color off the DOM and synthesizes a Fluent brand ramp from it through
   LCH/LAB palette math.
2. Remaps roughly fifty Fluent neutral tokens onto `var(--vscode-*)` with fallback chains, so
   surfaces track the active theme — including community themes that leave the ideal token
   undefined.

Plus a stylesheet of component-scoped escapes for the cases where a Fluent recipe cannot be reached
through tokens at all.

## Code map

Today, before extraction:

- `src/webviews/theme/**` — the theming layer being extracted
- `src/webviews/components/wizard/WizardBreadcrumb.tsx` — the first component being extracted
- `src/webviews/index.tsx` — the consumer wiring
- `src/webviews/components/MonacoEditor.tsx` — the one other consumer of the theme context

Planned:

- `packages/vscode-ext-webview-fluentui/**` — the package
- `src/webviews/theme/monaco.ts` — the Monaco derivation, which stays behind (decision 0013)

## Architecture (intent — code is authoritative for behavior)

[design.md](./design.md) is the durable document. The load-bearing ideas:

- **Three front doors, one implementation.** A facade for greenfield consumers, a composable pair
  for consumers who own their own `FluentProvider`, and the raw generators for non-Fluent design
  systems. The facade is built only from the public lower tiers.
- **Components do not require the package's theming.** `components/` may not import `theme/`. This
  is what lets a consumer adopt a component without adopting a whole visual philosophy.
- **The stylesheet ships itself.** Importing the package's main entry injects the Fluent overrides;
  there is no stylesheet import for a consumer to forget, and no opt-out.
- **The layering is one-directional and React-free at the bottom**, so splitting the package later
  is mechanical rather than archaeological.

## Timeline

| Date       | PR  | What changed                                                              | Docs                                                                                       |
| ---------- | --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 2026-08-18 | —   | Design and decisions settled; increment 1 planned but not yet implemented | [iterations/01-theme-and-first-component.md](./iterations/01-theme-and-first-component.md) |

## Decisions

[decisions.md](./decisions.md) — fifteen entries covering scope, layering, module format, styling
delivery, and public naming.

The highest-signal ones, because they reverse what was originally proposed:

- **0009** — the `adaptive` flag is deleted rather than defaulted to `true`
- **0010** — the stylesheet is injected at module scope rather than imported by the consumer
- **0012** — no public CSS custom properties ship in v1

## Open gaps

- **Root `tsconfig.json` resolution.** The root config is `module: commonjs` with no
  `moduleResolution`, which means node10 resolution and a silently ignored `exports` field. A
  webview-scoped tsconfig with `moduleResolution: bundler` is a prerequisite for increment 1.
- **Fluent internals coupling.** The overrides key off `fui-*` class names, which are Fluent
  implementation details rather than public API. A narrow peer range and the
  `fluentOverrides` test suite are the only tripwires.
- **The palette generator is unguarded.** An absent `--vscode-button-background` produces a
  NaN-poisoned brand ramp. Fixed in increment 1; see decision 0009.
- **Increment 2 is undecided.** The two remaining shortlisted components are the focusable badge
  (net-new code — today it is a stylesheet plus a markdown instruction) and the metrics cards
  (a larger style-extraction job).

## Reading order for newcomers

1. This README
2. [decisions.md](./decisions.md)
3. [design.md](./design.md)
4. [webview-ext-package/README.md](../webview-ext-package/README.md) for the sibling package whose
   shape this one follows, and whose CommonJS build it deliberately does not
