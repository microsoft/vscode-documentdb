---
feature: webview-fluentui-package
kind: notes
status: active
created: 2026-08-18
code:
  - packages/vscode-ext-webview-fluentui/**
  - src/webviews/index.tsx
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

## The second consumer already exists, as a fork

The scope gate in decision 0001 asks whether a thing plausibly has two consumers. For the theming
layer this is not a projection: `microsoft/vscode-cosmosdb` carries a near-identical **copy** of it —
`src/webviews/theme/DynamicThemeProvider.tsx`, `state/ThemeContext.tsx`, `state/ThemeState.tsx` with
the same `monaco-editor` type import, `themeGenerator.ts`, and the same `utils/csswg.ts` palette
math.

The two copies have already drifted — their context exports `getVSCodeTheme` where this one exports
`getVSCodeThemeKind`, and their `WithTheme` takes a defaulted optional prop where this one takes a
required one. Every fix to one of them is invisible to the other.

So this extraction is not speculative reuse. It converges an existing fork, which is also why the
peer ranges in design.md §7 are chosen to satisfy both repositories at once.

## Code map

After increment 1:

- `packages/vscode-ext-webview-fluentui/**` — the package
- `src/webviews/index.tsx` — the consumer wiring, now rendering through `VSCodeFluentProvider`
- `src/webviews/components/monacoTheme.ts` and `vscodeThemeTokens.ts` — the Monaco derivation and
  its token list, which stayed behind (decisions 0008, 0013), beside their only consumer
- `src/webviews/index.scss` — the `--documentdb-*` field stroke aliases, kept extension-side (0012)
- `src/webviews/slickgrid.scss` — product-specific, moved out of the dissolved `theme/` folder

`src/webviews/theme/` no longer exists.

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

| Date       | PR   | What changed                                                                                                           | Docs                                                                                       |
| ---------- | ---- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 2026-08-18 | —    | Design and decisions settled; increment 1 planned                                                                      | [iterations/01-theme-and-first-component.md](./iterations/01-theme-and-first-component.md) |
| 2026-08-18 | #895 | Increment 1 implemented and visually verified: package on disk, theming layer and `WizardBreadcrumb` moved, no publish | [iterations/01-theme-and-first-component.md](./iterations/01-theme-and-first-component.md) |

## Decisions

[decisions.md](./decisions.md) — twenty entries covering scope, layering, module format, styling
delivery, and public naming.

The highest-signal ones, because they reverse what was originally proposed:

- **0009** — the `adaptive` flag is deleted rather than defaulted to `true`
- **0010** — the stylesheet is injected at module scope rather than imported by the consumer
- **0012** — no public CSS custom properties ship in v1

And the four that only implementation could have produced:

- **0017** — `moduleResolution: bundler` emits ESM that no bundler will load
- **0018** — a context-backed hook cannot serve the composable tier it exists for
- **0019** — adapt Fluent by re-pointing its tokens, never by out-specifying its classes
- **0020** — opaque stencils must stay opaque; `translucent` is what consumers should use

## Open gaps

- **Fluent internals coupling.** The overrides key off `fui-*` class names, which are Fluent
  implementation details rather than public API. A narrow peer range and the
  `fluentOverrides` test suite are the only tripwires. Increment 1 widened that suite: it now also
  asserts that every selector is `:where()`-wrapped, and that Fluent's indeterminate ProgressBar
  recipe still reads the three tokens the adaptation re-points (0019).
- **Theme coverage is still incomplete.** [#811](https://github.com/microsoft/vscode-documentdb/issues/811)
  keeps four items after increment 1 mapped `colorNeutralBackground3`: the tertiary foregrounds, the
  global neutral strokes, `colorSubtleBackgroundSelected`, and high-contrast theme kinds, which
  bypass the generator entirely and fall back to the static Teams themes.
- **Type-checking resolves built output, not source** (0016). The package must be built before the
  root `tsc` runs — already guaranteed by the `prebuild` fan-out, and true of the other five
  workspace packages too. Modernising resolution repo-wide is filed as future work.
- **The two originally shortlisted components are still unbuilt.** Increment 2 took the wizard
  surface instead. The metric card is planned in
  [iterations/03-metric-card.md](./iterations/03-metric-card.md), which also closes increment 2's
  `Announcer` question; the focusable badge and the accessible-name question it raises are
  [iterations/04-focusable-badge-and-accessible-names.md](./iterations/04-focusable-badge-and-accessible-names.md).

## Reading order for newcomers

1. This README
2. [decisions.md](./decisions.md)
3. [design.md](./design.md)
4. [webview-ext-package/README.md](../webview-ext-package/README.md) for the sibling package whose
   shape this one follows, and whose CommonJS build it deliberately does not
