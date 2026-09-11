---
feature: webview-fluentui-package
kind: design
status: active
created: 2026-08-18
code:
  - packages/vscode-ext-webview-fluentui/**
  - src/webviews/index.tsx
---

# `@microsoft/vscode-ext-webview-fluentui` - Design

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
| `.`            | `VSCodeFluentProvider`, `useActiveVSCodeTheme`, `useActiveVSCodeThemeKind`, `createVSCodeFluentTheme` - and the self-injecting stylesheet |
| `./components` | `WizardBreadcrumb` and its types. No theming, no stylesheet.                                                                              |

Not in v1: `./tokens` (0008), `./monaco` (0013), `./styles.css` (0010), `./testing`.

### Three front doors, one implementation

| Tier       | API                                                        | For                                         |
| ---------- | ---------------------------------------------------------- | ------------------------------------------- |
| Facade     | `<VSCodeFluentProvider>`                                   | greenfield consumers and the starter kit    |
| Composable | `useActiveVSCodeThemeKind()` + `createVSCodeFluentTheme()` | consumers owning their own `FluentProvider` |
| Primitive  | `generateAdaptiveDarkTheme()` and friends                  | consumers post-processing the theme object  |

All three tiers are Fluent-bound - the generators return a Fluent `Theme`. The genuinely
design-system-neutral pieces, the palette math and the VS Code token list, are internal (0008), so
there is no tier for non-Fluent consumers and the package name says as much (0002).

The facade is built only from tier 2 and 3 (invariant I3): a consumer assembling it by hand gets an
identical result.

### Container and wizard sizing

On 2026-09-10 the operator confirmed that full-webview sizing is intentional. `Container` defaults
to `height: 100vh`, and `Wizard` inherits that default through its root `Container`. This settles
increment 2's root-height question: retain the current behavior rather than requiring every host
to establish parent-relative heights. The body owns scrolling and the footer stays visible within
the allocated height; document padding remains consumer-owned.

Embedding is an opt-in consumer override, not a change to the default or a new sizing prop.
Consumers must supply a bounded parent height. `Container` accepts a `style` or `className`
override; `Wizard` does not forward those props, so its documented workaround uses a dedicated
wrapper and a scoped direct-child height rule. That workaround depends on the current root DOM
shape. Consumers needing direct root control can compose the lower-level components instead.

The consumer examples and scroll/landmark constraints live in the
[Container README](../../../../packages/vscode-ext-webview-fluentui/src/components/Container/README.md#sizing-and-embedding)
and [Wizard README](../../../../packages/vscode-ext-webview-fluentui/src/components/Wizard/README.md#sizing-and-embedding).

### Wizard sticky chrome

`Wizard.headerBehavior` offers `scroll` (the default) and `sticky-navigation`. In the latter,
the identifying header fades as it scrolls away, while the navigation pins. Neither mode resizes
the header. A `sticky-dynamic` variant was explored and abandoned after it caused subtitle
truncation, layout jumps and scroll oscillation. See
[decision 0031](./decisions.md#0031---keep-wizard-behavior-to-scrolling-and-sticky-navigation).

The fade uses a named CSS scroll timeline; navigation elevation uses scroll-state queries.
Reduced motion disables the fade, not the navigation pinning. Focus within the header also
disables the fade so header actions remain visible while focused. Primary actions belong in
the pinned footer, and step actions remain with the step heading.

Top navigation paints its background and elevation across the scroll viewport, with its content
bounded to the wizard column. Sidebar navigation is aligned to the start of its grid area and
paints only across its own column, avoiding the main content. Both clip elevation below the surface.
The short border/shadow transitions remain enabled under reduced motion.
Behavior-level documentation lives in the
[Wizard README](../../../../packages/vscode-ext-webview-fluentui/src/components/Wizard/README.md#sticky-header-behavior).

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
├── jest.config.cjs                 # .cjs - "type": "module" would break module.exports
├── README.md  LICENSE               # no ADVANCED.md or MIGRATION.md in v1 - nothing to migrate from yet
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

`src/index.ts` calls `injectStyles()` at module scope. Any import from `.` - facade, hook, or
generator - brings the sheet. There is no consumer-side import and no opt-out (0010, 0011).

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
`package.json` consequences - a `prebuild` step, and `sideEffects: ["./dist/index.js"]` rather than
`false` - are deliberate and are argued in decisions 0005 and 0010. Everything else about the
`package.json`, including `types` and `typesVersions`, mirrors the sibling exactly (0016).

## 7. Dependencies

`peerDependencies`, chosen to satisfy both known consumers simultaneously:

| Peer                         | Range   | This extension | vscode-cosmosdb |
| ---------------------------- | ------- | -------------- | --------------- |
| `react`                      | `>=19`  | `~19.2.4`      | `~19.2.1`       |
| `@fluentui/react-components` | `~9.74` | `~9.74.4`      | `~9.74.1`       |
| `@fluentui/react-icons`      | `~2.0`  | `~2.0.320`     | `~2.0.313`      |

`devDependencies`: `sass` (the style build) and `@fluentui/react-progress` - the latter because
`fluentOverrides.test.ts` does `require.resolve('@fluentui/react-progress')` and currently works only
by npm hoisting. In the package it must be declared.

The narrow Fluent range is load-bearing rather than cautious. The overrides key off `fui-*` class
names and, in one case, the absence of an `aria-valuenow` attribute - Fluent implementation details,
not public API. A minor Fluent release can restructure them and the overrides will silently stop
applying, with no build error. The `fluentOverrides` test suite is the tripwire.

**No `@vscode/l10n`.** `WizardBreadcrumb`'s single internal string becomes an optional prop
defaulting to English. This is not merely tidier: the repo's `npm run l10n` extractor does not scan
`node_modules`, so a package-internal string would silently never be translated in any consumer.

The workspace manifest now declares `version: 1.0.0`, prepared for release but not published by this
change. The operator confirmed on
2026-09-10 that the package is already being published, so the absence of `private: true` is
intentional. Decision 0027 replaces the original workspace-only restriction. Registry versions
and the publication status of individual commits must be checked separately. The operator later
confirmed there are no external consumers: decision 0029 permits API changes while finalizing the
extraction and calls for a `1.0.0` release-version bump after acceptance.

## 8. Testing

Package tests run under the package's own jest project, registered in the root `jest.config.js`
`projects` array: jsdom environment, `@swc/jest` transform, CommonJS output (0006).

Type safety is **not** provided by the test run - SWC does not type-check. It comes from
`tsc -p .` via `npm run build`.

Tests that move with the code: `themeGenerator.test.ts`, and `fluentOverrides.test.ts` with its
on-disk SCSS paths re-based to the package root.

Tests that are new:

- `injectStyles` is idempotent and is a no-op without a DOM.
- Importing `./components` injects no stylesheet (invariant I1).
- `getBrandTokensFromPalette` degrades sanely on an unparseable key color (0009).

`WizardBreadcrumb` has no tests today and gains none here. It carries no logic worth asserting, and
the one new behavior - the overflow-label prop - is a defaulted string.

## 9. How consumers resolve the package (0016)

`npm run build` is plain `tsc` against the root `tsconfig.json`, which is `"module": "commonjs"` with
no `moduleResolution` - node10 resolution, so the `exports` field is ignored. Left alone, the first
webview importing the package breaks the build.

The package resolves the way all five existing workspace packages do: npm workspaces symlinks it
into `node_modules`, the root `tsc` reads `types` from its `package.json`, and the one subpath -
which node10 cannot resolve on its own - is covered by `typesVersions`.

```jsonc
"types": "./dist/index.d.ts",
"typesVersions": {
    "*": {
        "components": ["./dist/components.d.ts"]
    }
}
```

**No change to the root `tsconfig.json`.** Because resolution lands on `dist/`, the package must be
built before the root `tsc` runs - which `prebuild: npm run build --workspaces --if-present` already
guarantees, exactly as it does for the other five.

## 10. What stays behind in the extension

`src/webviews/theme/` is **dissolved** - a folder for two leftovers is not worth keeping. Its
survivors move to where they are used:

| What                                              | Goes to                                           | Why it stays (0013, 0012)         |
| ------------------------------------------------- | ------------------------------------------------- | --------------------------------- |
| Monaco theme derivation + the VS Code token list  | beside `src/webviews/components/MonacoEditor.tsx` | Monaco is not Fluent              |
| `slickgrid.scss`                                  | `src/webviews/`                                   | product-specific                  |
| `--documentdb-colorInputStroke` and hover variant | `src/webviews/index.scss`                         | no public custom properties in v1 |

All localized strings stay in the extension, including the `WizardBreadcrumb` overflow label.

## 11. Acceptance

A green build and a passing suite prove very little here - a wrong token mapping compiles cleanly and
looks broken. **Increment 1 is not done until the operator has visually verified the webviews.** The
implementing agent runs the verification commands, then stops and hands over for that check rather
than declaring completion.

## 11. Increments

**Increment 1** - package skeleton, theming layer, `WizardBreadcrumb`, initially consumed through
the npm workspace without publishing. Implemented in
[iterations/01-theme-and-first-component.md](./iterations/01-theme-and-first-component.md).

**Increment 2** - shared wizard components, consumed by Local Quick Start and Atlas Credentials.
Implemented in [iterations/02-wizard-shell-and-components.md](./iterations/02-wizard-shell-and-components.md).

All four increments are implemented. The operator confirmed increment 4 acceptance tests complete
on 2026-09-10. Publishing is now established policy under decision 0027, not a deferred increment.

Later increments are recorded in the iteration plans and decisions log. The two candidates first
identified after increment 1 both shipped:

- **Focusable badge.** Increment 4 replaces the stylesheet and hand-authored accessibility pattern
  with `FocusableBadge`, Fluent's supported focus outline, and one measured name/description
  contract. See [decision 0026](./decisions.md#0026--the-focusable-badge-ships-with-one-naming-contract)
  and [decision 0030](./decisions.md#0030---named-focusable-containers-carry-rolegroup), which gives
  the named elements a role so ARIA permits the name.
- **Metrics cards.** Increment 3 translated the coupled styles into provider-independent package
  components and kept formatting in the extension. See
  [decision 0024](./decisions.md#0024--the-metric-card-enters-and-converges-its-fork).
