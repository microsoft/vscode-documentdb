---
feature: webview-fluentui-package
kind: design
status: active
created: 2026-08-18
code:
  - packages/vscode-ext-webview-fluentui/**
  - src/webviews/index.tsx
---

# `@microsoft/vscode-ext-webview-fluentui` — Design

> The durable shape of the package. Rationale for individual choices lives in
> [decisions.md](./decisions.md); where the two disagree, decisions.md wins.

## 1. What ships

A React theming layer that makes Fluent UI track the user's active VS Code theme, plus a small,
deliberately slow-growing set of components that solve VS Code integration problems.

The package README presents both as equally weighted, independently adoptable pieces (decision
0023): a short, high-level section for each, with the technical depth one link away rather than
folded into the same paragraph. Theming and components can be used alone or mixed; neither requires
the other, per invariant I1.

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
├── README.md  LICENSE               # no ADVANCED.md or MIGRATION.md in v1 — nothing to migrate from yet
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
`package.json` consequences — a `prebuild` step, and `sideEffects: ["./dist/index.js"]` rather than
`false` — are deliberate and are argued in decisions 0005 and 0010. Everything else about the
`package.json`, including `types` and `typesVersions`, mirrors the sibling exactly (0016).

## 7. Dependencies

`peerDependencies`, chosen to satisfy both known consumers simultaneously:

| Peer                         | Range   | This extension | vscode-cosmosdb |
| ---------------------------- | ------- | -------------- | --------------- |
| `react`                      | `>=19`  | `~19.2.4`      | `~19.2.1`       |
| `@fluentui/react-components` | `~9.74` | `~9.74.4`      | `~9.74.1`       |
| `@fluentui/react-icons`      | `~2.0`  | `~2.0.320`     | `~2.0.313`      |

`devDependencies`: `sass` (the style build) and `@fluentui/react-progress` — the latter because
`fluentOverrides.test.ts` does `require.resolve('@fluentui/react-progress')` and currently works only
by npm hoisting. In the package it must be declared.

The narrow Fluent range is load-bearing rather than cautious. The overrides key off `fui-*` class
names and, in one case, the absence of an `aria-valuenow` attribute — Fluent implementation details,
not public API. A minor Fluent release can restructure them and the overrides will silently stop
applying, with no build error. The `fluentOverrides` test suite is the tripwire.

**No `@vscode/l10n`.** `WizardBreadcrumb`'s single internal string becomes an optional prop
defaulting to English. This is not merely tidier: the repo's `npm run l10n` extractor does not scan
`node_modules`, so a package-internal string would silently never be translated in any consumer.

`version` is `0.1.0-preview` and `"private": true` until the first publish — increment 1 consumes the
package through the npm workspace only, and `private` is the one thing that makes an accidental
`npm publish` impossible.

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

`WizardBreadcrumb` has no tests today and gains none here. It carries no logic worth asserting, and
the one new behavior — the overflow-label prop — is a defaulted string.

## 9. How consumers resolve the package (0016)

`npm run build` is plain `tsc` against the root `tsconfig.json`, which is `"module": "commonjs"` with
no `moduleResolution` — node10 resolution, so the `exports` field is ignored. Left alone, the first
webview importing the package breaks the build.

The package resolves the way all five existing workspace packages do: npm workspaces symlinks it
into `node_modules`, the root `tsc` reads `types` from its `package.json`, and the one subpath —
which node10 cannot resolve on its own — is covered by `typesVersions`.

```jsonc
"types": "./dist/index.d.ts",
"typesVersions": {
    "*": {
        "components": ["./dist/components.d.ts"]
    }
}
```

**No change to the root `tsconfig.json`.** Because resolution lands on `dist/`, the package must be
built before the root `tsc` runs — which `prebuild: npm run build --workspaces --if-present` already
guarantees, exactly as it does for the other five.

## 10. What stays behind in the extension

`src/webviews/theme/` is **dissolved** — a folder for two leftovers is not worth keeping. Its
survivors move to where they are used:

| What                                              | Goes to                                           | Why it stays (0013, 0012)         |
| ------------------------------------------------- | ------------------------------------------------- | --------------------------------- |
| Monaco theme derivation + the VS Code token list  | beside `src/webviews/components/MonacoEditor.tsx` | Monaco is not Fluent              |
| `slickgrid.scss`                                  | `src/webviews/`                                   | product-specific                  |
| `--documentdb-colorInputStroke` and hover variant | `src/webviews/index.scss`                         | no public custom properties in v1 |

All localized strings stay in the extension, including the `WizardBreadcrumb` overflow label.

## 11. Acceptance

A green build and a passing suite prove very little here — a wrong token mapping compiles cleanly and
looks broken. **Increment 1 is not done until the operator has visually verified the webviews.** The
implementing agent runs the verification commands, then stops and hands over for that check rather
than declaring completion.

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
