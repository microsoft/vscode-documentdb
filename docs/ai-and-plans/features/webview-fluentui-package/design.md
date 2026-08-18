---
feature: webview-fluentui-package
kind: design
status: active
created: 2026-08-18
code:
  - src/webviews/theme/**
  - src/webviews/components/wizard/WizardBreadcrumb.tsx
---

# `@microsoft/vscode-ext-webview-fluentui` — Design

> The durable shape of the package. Rationale for individual choices lives in
> [decisions.md](./decisions.md); where the two disagree, decisions.md wins.

## 1. What ships

A React theming layer that makes Fluent UI track the user's active VS Code theme, plus a small,
deliberately slow-growing set of components that solve VS Code integration problems.

The package README must lead with that framing, in that order: **theming for Fluent-based webviews
first, additional optional components second.** Theming is the reason to adopt the package;
components are a bonus a consumer may ignore entirely, and invariant I1 exists precisely so they
can.

Every addition passes the four-condition scope gate in decision 0001.

## 2. Public surface

Two entries.

| Entry          | Contents                                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `.`            | `VSCodeFluentProvider`, `useActiveVSCodeTheme`, `useActiveVSCodeThemeKind`, `createVSCodeFluentTheme` — and the self-injecting stylesheet |
| `./components` | `WizardBreadcrumb` and its types. No theming, no stylesheet.                                                                              |

Not in v1: `./tokens` (0008), `./monaco` (0013), `./styles.css` (0010), `./testing`.

### Three front doors, one implementation

| Tier       | API                                                        | For                                         |
| ---------- | ---------------------------------------------------------- | ------------------------------------------- |
| Facade     | `<VSCodeFluentProvider>`                                   | greenfield consumers and the starter kit    |
| Composable | `useActiveVSCodeThemeKind()` + `createVSCodeFluentTheme()` | consumers owning their own `FluentProvider` |
| Primitive  | `generateAdaptiveDarkTheme()` and friends                  | consumers post-processing the theme object  |

All three tiers are Fluent-bound — the generators return a Fluent `Theme`. The genuinely
design-system-neutral pieces, the palette math and the VS Code token list, are internal (0008), so
there is no tier for non-Fluent consumers and the package name says as much (0002).

The facade is built only from tier 2 and 3 (invariant I3): a consumer assembling it by hand gets an
identical result.

## 3. Layering

```
components  ──┐   React + Fluent, provider-agnostic
              ├──> theme/react   React: provider + hooks
              │        └───────> theme/core    Fluent, no React: theme generators
              └───────────────-> palette       no Fluent, no React: LCH/LAB colour math
```

One-directional, React-free at the bottom (invariant I2). `components/` may not import `theme/` or
`styles/` (invariant I1), enforced by an ESLint `no-restricted-imports` rule and by a test asserting
that importing `./components` injects no stylesheet.

## 4. Repository layout

```
packages/vscode-ext-webview-fluentui/
├── package.json                    # type: module, two exports, sideEffects: ["./dist/index.js"]
├── tsconfig.json                   # esnext + bundler resolution, jsx react-jsx, declaration
├── jest.config.cjs                 # .cjs — "type": "module" would break module.exports
├── README.md  ADVANCED.md  MIGRATION.md  LICENSE
├── scripts/
│   └── build-styles.mjs            # scss → src/styles/generated.ts
└── src/
    ├── README.md                   # entry map and import direction
    ├── index.ts                    # entry "."; calls injectStyles() at module scope
    ├── components.ts               # entry "./components"
    ├── theme/
    ├── styles/
    │   ├── fluentOverrides.scss    # authored normally, with real tooling
    │   ├── generated.ts            # generated, committed (0015)
    │   └── injectStyles.ts
    └── components/
```

Every folder carries its own `README.md`, as in the sibling package.

## 5. How the styles reach the page

`src/index.ts` calls `injectStyles()` at module scope. Any import from `.` — facade, hook, or
generator — brings the sheet. There is no consumer-side import and no opt-out (0010, 0011).

```ts
export function injectStyles(): void {
  if (typeof document === 'undefined') return; // node-environment tests can still import the entry
  if (document.getElementById(STYLE_ID)) return; // idempotent across duplicate copies
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = css;
  document.head.appendChild(el);
}
```

Two properties this design depends on:

- **Every override rule is wrapped in `:where()`.** Zero specificity means a consumer's plain
  `.fui-Input { … }` wins regardless of `<style>` order, which is what makes an injected sheet as
  overridable as an imported one. The ProgressBar rules are not currently wrapped; normalising them
  is part of increment 1.
- **The overrides are document-global.** They reach every Fluent component in the consumer's
  webview, including portaled dialogs, menus and tooltips. That reach is the reason the escapes are
  class-based rather than provider-scoped, and it must be stated plainly in the package README.

## 6. Build

```jsonc
"scripts": {
    "prebuild": "node scripts/build-styles.mjs",
    "build": "tsc -p ."
}
```

`build-styles.mjs` compiles `src/styles/fluentOverrides.scss` with the `sass` API and writes
`src/styles/generated.ts` exporting the CSS as a string. Because the output is ordinary TypeScript,
`tsc` type-checks it like any other source and no bundler is involved.

The root `prebuild` already fans out with `npm run build --workspaces --if-present`, so the chain
works with no root-level change.

This is the first real divergence from the sibling package, whose entire build is `tsc -p .`. The
`package.json` consequences — a `prebuild` step, `sideEffects: ["./dist/index.js"]` rather than
`false`, and no `typesVersions` — are deliberate and are argued in decisions 0005 and 0010.

## 7. Dependencies

`peerDependencies`: `react`, `@fluentui/react-components` at a **narrow** range (`~9.74`), and
`@fluentui/react-icons`.

The narrow Fluent range is load-bearing rather than cautious. The overrides key off `fui-*` class
names and, in one case, the absence of an `aria-valuenow` attribute — Fluent implementation details,
not public API. A minor Fluent release can restructure them and the overrides will silently stop
applying, with no build error. The `fluentOverrides` test suite is the tripwire.

**No `@vscode/l10n`.** `WizardBreadcrumb`'s single internal string becomes an optional prop
defaulting to English. This is not merely tidier: the repo's `npm run l10n` extractor does not scan
`node_modules`, so a package-internal string would silently never be translated in any consumer.

## 8. Testing

Package tests run under the package's own jest project, registered in the root `jest.config.js`
`projects` array: jsdom environment, `@swc/jest` transform, CommonJS output (0006).

Type safety is **not** provided by the test run — SWC does not type-check. It comes from
`tsc -p .` via `npm run build`.

Tests that move with the code: `themeGenerator.test.ts`, and `fluentOverrides.test.ts` with its
on-disk SCSS paths re-based to the package root.

Tests that are new:

- `injectStyles` is idempotent and is a no-op without a DOM.
- Importing `./components` injects no stylesheet (invariant I1).
- `getBrandTokensFromPalette` degrades sanely on an unparseable key color (0009).

## 9. Prerequisite: webview-scoped tsconfig

The root `tsconfig.json` is `"module": "commonjs"` with **no** `moduleResolution`, which means node10
resolution and a silently ignored `exports` field. The sibling package works around this with a
`typesVersions` block; an ESM-only package with subpath exports cannot be shimmed that way.

A tsconfig covering `src/webviews/**` with `"moduleResolution": "bundler"` is therefore a
prerequisite, not a cleanup. It is arguably overdue regardless: `src/webviews/**` and `src/**` are
two different runtimes type-checked under one config today.

## 10. What stays behind in the extension

- Monaco theme derivation and the VS Code token list (0013)
- `slickgrid.scss` — product-specific
- `--documentdb-colorInputStroke` and its hover variant (0012)
- All localized strings, including the `WizardBreadcrumb` overflow label

## 11. Increments

**Increment 1** — package skeleton, theming layer, `WizardBreadcrumb`, consumed through the npm
workspace. No publish. Planned in
[iterations/01-theme-and-first-component.md](./iterations/01-theme-and-first-component.md).

**Increment 2** — undecided, to be discussed once increment 1 lands. The two candidates:

- **Focusable badge.** Today it is `focusableBadge.scss` plus a markdown document instructing callers
  to hand-write `tabIndex={0}`, a class name, a composed `aria-label`, and `aria-hidden` children —
  there is no `.tsx` in the folder at all. Converting an instruction into an enforced API is the
  highest-value move available, but it is net-new code rather than an extraction.
- **Metrics cards.** Zero l10n coupling — every string is already a prop — but not self-contained.
  `MetricsRow.scss` does `@use '../../queryInsights.scss' as *` and `@extend .baseDataHeader` /
  `.baseDataValue`, and `MetricBase.tsx` emits five further class names (`tooltipContainer`,
  `tooltipTitle`, `tooltipBody`, `tooltipValue`, `tooltipInfoIcon`) defined only in that
  product-level stylesheet. Extracted as-is they render unstyled.
