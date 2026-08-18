---
feature: webview-fluentui-package
kind: decisions
status: active
created: 2026-08-18
---

# `@microsoft/vscode-ext-webview-fluentui` — Decisions

> What was decided while designing the UI package extraction, and what was rejected on the way.

| #    | Decision                                                      | Status              | Changed from the proposal?                                      | Date       | PR  |
| ---- | ------------------------------------------------------------- | ------------------- | --------------------------------------------------------------- | ---------- | --- |
| 0001 | Extract the UX layer as a second package, behind a scope gate | Accepted            | Accepted as proposed                                            | 2026-08-18 | —   |
| 0002 | Name: `@microsoft/vscode-ext-webview-fluentui`                | Accepted (modified) | `-ui` rejected as too general once the scope proved Fluent-only | 2026-08-18 | —   |
| 0003 | No dependency between the two packages, in either direction   | Accepted            | Accepted as proposed                                            | 2026-08-18 | —   |
| 0004 | Three invariants: provider independence, layering, facade     | Accepted            | Accepted as proposed                                            | 2026-08-18 | —   |
| 0005 | ESM-only, despite the sibling being CommonJS                  | Accepted            | Accepted as proposed                                            | 2026-08-18 | —   |
| 0006 | Tests stay CommonJS, transformed by `@swc/jest`               | Accepted            | Accepted as proposed                                            | 2026-08-18 | —   |
| 0007 | v1 public entries are `.` and `./components`                  | Accepted (modified) | `./styles.css` dropped after 0010                               | 2026-08-18 | —   |
| 0008 | The token list and palette math stay internal                 | Accepted (modified) | Proposal left it open; evidence closed it                       | 2026-08-18 | —   |
| 0009 | The `adaptive` flag is deleted, not defaulted                 | Accepted (modified) | Proposal was to flip the default to `true`                      | 2026-08-18 | —   |
| 0010 | The stylesheet injects itself at module scope                 | Accepted (modified) | Proposal was a consumer-side `styles.css` import                | 2026-08-18 | —   |
| 0011 | No opt-out from the Fluent overrides                          | Accepted            | Operator-originated; not in the proposal                        | 2026-08-18 | —   |
| 0012 | No public CSS custom properties in v1                         | Accepted (modified) | Proposal was a neutral or configurable prefix                   | 2026-08-18 | —   |
| 0013 | Monaco theming stays in the extension                         | Deferred            | Proposal left it open                                           | 2026-08-18 | —   |
| 0014 | Public naming vocabulary is locked before publish             | Accepted (modified) | `useVSCodeTheme` → `useActiveVSCodeTheme` after operator review | 2026-08-18 | —   |
| 0015 | The generated CSS module is committed, not gitignored         | Accepted (modified) | Reverses the recommendation made during design                  | 2026-08-18 | —   |
| 0016 | Consumers resolve the package through tsconfig `paths`        | Accepted            | Replaces the proposal's webview-scoped tsconfig                 | 2026-08-18 | —   |

> Entries below are **semantically** immutable: append new entries rather than
> rewriting old ones, and record reversals as a new entry plus a status change
> above. Editing for typos, broken links, or added verification metadata is fine.
> Heading text is frozen once written — a retitle means a new decision.

**Status vocabulary** (closed set of seven):

`Proposed` · `Open` · `Accepted` · `Accepted (modified)` · `Deferred` ·
`Superseded by D#` · `Rejected`

---

## 0001 — Extract the UX layer as a second package, behind a scope gate

**Status:** Accepted · **Date:** 2026-08-18

### Question

The transport package deliberately excluded UI helpers. Should the UX layer be extracted at all, and
if so, what stops it becoming the dumping ground that exclusion was protecting against?

### Decision

Extract it, as a package separate from the transport, and gate every addition on four conditions.
A thing enters only if **all four** hold:

1. It solves a VS Code **integration** problem, not a product problem.
2. It takes no product strings and emits no product-prefixed tokens.
3. It plausibly has two consumers.
4. It imports no transport, no telemetry, and no `vscode` module.

### Why

The exclusion was never "UX code is not worth sharing" — it was "a UX kit accumulates opinions."
A gate answers that objection directly, where a promise of restraint would not. Condition 3 is the
one that does the most work in practice: it is what kept `./tokens` out (0008) and what deferred the
opt-in class (0012).

---

## 0002 — Name: `@microsoft/vscode-ext-webview-fluentui`

**Status:** Accepted (modified) · **Date:** 2026-08-18

### Decision

`@microsoft/vscode-ext-webview-fluentui`. The shared `vscode-ext-webview-` stem keeps the pairing
with the transport package obvious; `fluentui` names the peer dependency and the problem domain,
spelled as Microsoft spells the product and as the npm scope `@fluentui/*` spells it.

### Changed from the proposal

The proposal was `@microsoft/vscode-ext-webview-ui`. It was rejected once the v1 surface was
settled and turned out to be **entirely Fluent**: `createVSCodeFluentTheme` returns a Fluent
`Theme`, the stylesheet overrides `fui-*` classes, `WizardBreadcrumb` is built on Griffel and Fluent
`tokens.*`, and Fluent is a hard peer at a narrow range. Nothing in v1 is usable without it, so
`-ui` promised a generality the package does not have.

### Options rejected, and why the reasoning matters

| Candidate  | Rejected because                                                |
| ---------- | --------------------------------------------------------------- |
| `-ui`      | implies a design-system-neutral kit; v1 is Fluent top to bottom |
| `-helpers` | "is this a helper?" is unanswerable — everything is             |
| `-addons`  | same vagueness, plus a browser-extension connotation            |
| `-kit`     | implies a suite, which is what 0001 exists to prevent           |
| `-ext`     | doubles the `ext` already in the stem                           |

The discriminator is not aesthetic. **A name is part of the scope gate in 0001**, because it is what
people reason with at the moment they are about to add something. Category names — `helpers`,
`utils`, `common`, `misc` — are solvents: they admit anything. `fluentui` names the _boundary_
rather than the contents, which turns the admission test into a question with an answer: _does this
exist because Fluent does not behave correctly inside a VS Code webview?_

The name proved itself before the package existed. Asked whether a Monaco editor wrapper belonged,
the answer was immediate and needed no debate — Monaco is not Fluent. Under `-helpers` a Monaco
wrapper is unambiguously a helper and there would have been no argument against it. See 0013: if a
wrapper is ever wanted it is a **third** package, not a subpath here, which is cleaner anyway given
`monaco-editor` is a roughly 5 MB peer.

---

## 0003 — No dependency between the two packages, in either direction

**Status:** Accepted · **Date:** 2026-08-18

### Decision

Neither package may depend on the other.

### Why

Theming reads `data-vscode-theme-kind` off the DOM; it needs no transport to work. Coupling them
would force a consumer who wants only the theme to adopt a messaging layer, and vice versa. Each
must be independently adoptable, because the realistic adoption path for `vscode-cosmosdb` is
piecemeal rather than wholesale.

---

## 0004 — Three invariants: provider independence, layering, facade

**Status:** Accepted · **Date:** 2026-08-18

### Decision

**I1 — Components must not require the package's provider.** `src/components/` must not import from
`src/theme/`. Components style themselves from Fluent `tokens.*`, which resolve against whatever
`FluentProvider` is above them.

**I2 — One-directional layering, React-free at the bottom.**

```
components  ──┐   (React + Fluent, provider-agnostic)
              ├──> theme/react  (React: provider + hooks)
              │        └───────> theme/core  (Fluent, no React: generators)
              └───────────────-> palette     (no Fluent, no React: color math)
```

**I3 — Self-hosting facade.** `VSCodeFluentProvider` is built only on public tier-2/3 API. A
consumer assembling it by hand from `useActiveVSCodeThemeKind()` + `createVSCodeFluentTheme()` gets
an identical result.

### Why

I1 is the analogue of the sibling package's bring-your-own-panel requirement — here it is
_bring your own `FluentProvider`_ — and it is precisely what lets another extension adopt a
component without adopting a visual philosophy. I2 means the two halves never import each other, so
splitting them into separate packages later is mechanical. I3 is the same rule the sibling settled
on: a facade that reaches into private internals is a facade that cannot be replaced.

I1 is enforced, not merely documented: an ESLint `no-restricted-imports` rule in the package, plus a
test asserting that importing `./components` injects no stylesheet.

---

## 0005 — ESM-only, despite the sibling being CommonJS

**Status:** Accepted · **Date:** 2026-08-18

### Decision

`"type": "module"`, `"module": "esnext"`, `"moduleResolution": "bundler"`, real `exports`
conditions, and **no `typesVersions`** block.

### Why

This will be asked as "why don't the two packages match", so the reasoning is recorded rather than
left to be re-derived.

The sibling **has to** be CommonJS: it has a `./host` entry loaded by the VS Code extension host,
which is CommonJS. **This package has no host entry at all** — every consumer runs in a browser
through a bundler.

CommonJS would also actively hurt here. It kills tree-shaking across the package boundary, which
matters because `@fluentui/react-icons` and `@fluentui/react-components` are large barrels; the
sibling has no barrel-shaped dependencies and so never paid that cost. It forecloses Griffel
build-time extraction, and it leaves no `import`/`require` condition split to evolve into.

CommonJS consumers remain fine: bundlers import ESM without issue, and `require(esm)` is unflagged in
Node ≥ 22.12 / ≥ 20.19.

The sibling carries `typesVersions` as a shim so that consumers on legacy node10 resolution can
still resolve types for its subpaths. This package deliberately does **not**, and the reason is
taste rather than necessity: `typesVersions` is a type-resolution-only mechanism and would work fine
alongside an ESM-only runtime, but it is a legacy affordance and the local resolution problem it
would paper over is better solved where the problem actually is (0016).

---

## 0006 — Tests stay CommonJS, transformed by `@swc/jest`

**Status:** Accepted · **Date:** 2026-08-18

### Decision

Jest runs the package's tests as CommonJS, transformed by `@swc/jest`, with a `jest.config.cjs`.

### Why

Jest decides ESM-versus-CommonJS **per file by extension**, not by transformer: `.mjs` is always
ESM, `.cjs` always CommonJS, `.js` follows `package.json` `"type"`, and `.ts`/`.tsx` are CommonJS
unless listed in `extensionsToTreatAsEsm`. Every test here is `.ts`/`.tsx`, so `"type": "module"`
never applies to them. That means no `--experimental-vm-modules`, no `jest.unstable_mockModule`, and
`jest.mock` hoisting keeps working.

`@swc/jest` over `ts-jest`: it is already in `devDependencies` and currently unused anywhere in the
repo, so it costs no new dependency, and it is the same SWC engine as the `swc-loader` in the views
webpack config. The trade-off, stated explicitly: SWC does **not** type-check, so type safety moves
entirely to `tsc -p .` via `npm run build`.

The config file must be `jest.config.cjs`. It is a `.js` file otherwise, and `"type": "module"` would
make `module.exports` a syntax error.

---

## 0007 — v1 public entries are `.` and `./components`

**Status:** Accepted (modified) · **Date:** 2026-08-18

### Decision

Two entries. `.` for theming, `./components` for components.

Explicitly **not** in v1: `./tokens` (0008), `./monaco` (0013), `./styles.css` (0010), and
`./testing` — the last by direct analogy with the sibling, whose `src/testing/` ships no runtime
code and is in no public entry point.

### Changed from the proposal

The original plan listed `./styles.css` as a third entry. Decision 0010 removed it.

---

## 0008 — The token list and palette math stay internal

**Status:** Accepted (modified) · **Date:** 2026-08-18

### Question

Should the ~815-entry VS Code theme token list and the LCH/LAB palette math ship as a public
`./tokens` entry for consumers building on non-Fluent design systems?

### Decision

No. Both stay internal.

### Why

Consumer tracing settled it. The palette math has exactly one caller —
`getBrandTokensFromPalette`, inside the theme generator. The token list and
`vscodeThemeTokenToCSSVar` have exactly one caller — `generateMonacoTheme`. Since Monaco is deferred
(0013), **the token list would have shipped with zero consumers**, purely on the theory that someone
might want it.

That fails condition 3 of the scope gate in 0001. The layering in 0004 still holds internally, so
promoting either later is a one-line addition to `exports` — the cheapest possible decision to
reverse, and among the most expensive to un-ship.

---

## 0009 — The `adaptive` flag is deleted, not defaulted

**Status:** Accepted (modified) · **Date:** 2026-08-18

### Question

`DynamicThemeProvider` takes `useAdaptive`, defaulting to `false`, and the only call site in the
extension passes `true`. Flip the default?

### Decision

Delete the concept. There is no flag, no prop, and no `adaptive` field on the theme state. The
package always derives the theme from the active VS Code theme.

### Why

`useAdaptive={false}` is not a feature of the package — it is the **absence** of the package. It
returns Fluent's canned Teams themes, which any consumer gets for free with
`<FluentProvider theme={teamsDarkTheme}>`. Shipping a boolean whose `false` branch reproduces
Fluent's default behavior taxes every consumer with a paragraph of documentation to learn that one
of the two options is pointless.

### The one real thing the flag was hiding

`generateAdaptiveLightTheme()` reads `--vscode-button-background` off the document and feeds it
straight into the palette math. Outside VS Code that property is absent, `getPropertyValue` returns
`''`, `getBrandTokensFromPalette` falls through its own `// TODO: If the color is not a hex value`
branch, and `hex_to_LCH('')` NaN-poisons the entire sixteen-stop brand ramp. There are no guards
anywhere in the palette utilities.

Inside a live extension host this never happens. In jsdom, Storybook, or the Playwright live-preview
technique this repo documents, it does — so the flag may have been serving as an accidental "works
outside VS Code" mode.

That is a bug, not a justification for public API. Increment 1 guards
`getBrandTokensFromPalette` so an unparseable key color falls back to a sane ramp. With that, the
flag can be deleted with nothing lost.

---

## 0010 — The stylesheet injects itself at module scope

**Status:** Accepted (modified) · **Date:** 2026-08-18

### Question

The Fluent overrides are CSS and must reach the consumer's document somehow. Ship a stylesheet for
the consumer to import, or have the package inject it?

### Options considered

| Option | Shape                                           | Consumer cost                       | Failure mode                       |
| ------ | ----------------------------------------------- | ----------------------------------- | ---------------------------------- |
| A      | Ship `dist/styles.css`, consumer imports it     | one import line; loaders on webpack | forgetting the line fails silently |
| B      | Ship SCSS source for consumers to `@use`        | consumer must run sass              | rejected outright                  |
| C1     | CSS authored as a TS template literal           | none                                | loses CSS tooling; test rework     |
| C2     | SCSS compiled to a generated TS module at build | none                                | one build script                   |

### Decision

**C2**, with the injection call at **module scope in the `.` entry** — not inside the provider.

```ts
// src/index.ts
injectStyles();
export { VSCodeFluentProvider } from './theme/VSCodeFluentProvider';
```

`./components` deliberately does not import it, per I1.

### Why

Injecting from the entry module rather than from the facade is what makes the guarantee complete.
Had it lived in `VSCodeFluentProvider`, a tier-2 consumer wiring their own `FluentProvider` from the
hooks would have had exactly the same silent-failure mode as option A. At module scope there is no
line to forget, for any tier, because there is no line.

The objection that an injected sheet cannot be overridden dissolves once every rule is normalised to
`:where()`. Zero specificity means a consumer's plain `.fui-Input { … }` wins regardless of which
`<style>` element came first, so cascade order stops mattering.

C2 over C1 because it keeps the stylesheet as a real `.scss` file with formatting, highlighting and
lint, and lets `fluentOverrides.test.ts` keep reading it off disk unchanged. The generated module is
plain TypeScript, so `tsc` type-checks it like any other source and the build stays a single `tsc`
invocation after a `prebuild` script.

### Rejected reasoning worth recording

Option A was defended on the grounds that the target consumer would need bundler configuration.
That turned out to be false: `vscode-cosmosdb` builds its views with Vite, whose config comments
_"CSS/SCSS handled natively by Vite (no css-loader/sass-loader needed)"_. Option A was therefore
zero-config for them — which removed the strongest argument **against** A, and left the decision to
rest entirely on the silent-failure mode.

---

## 0011 — No opt-out from the Fluent overrides

**Status:** Accepted · **Date:** 2026-08-18

### Decision

There is no flag, prop, or alternate entry that disables the VS Code adaptations. Adopting the
package means adopting Fluent **and** its adaptations as one thing.

### Why

Operator position, recorded verbatim in intent: if you use this package you use Fluent, and you
accept the overrides and style tweaks — the package's job is to make everything better and keep it
theme-responsive. A consumer who wants unadapted Fluent should use Fluent directly, which costs them
nothing.

This also removes the two-artifact problem: with no opt-out there is no `./styles.css` export to
keep in sync with the injected copy.

Note the consequence, which must be stated plainly in the package README: the overrides are
document-global. They apply to **every** Fluent component in the consumer's webview, including ones
the consumer rendered without thinking about this package, and including portaled surfaces such as
dialogs, menus and tooltips. That reach is deliberate — portals are exactly why the escapes are
class-based rather than provider-scoped — but it is not something a consumer should discover by
surprise.

---

## 0012 — No public CSS custom properties in v1

**Status:** Accepted (modified) · **Date:** 2026-08-18

### Question

`fluentAliases.scss` defines two product-prefixed custom properties, `--documentdb-colorInputStroke`
and `--documentdb-colorInputStrokeHover`. A product prefix cannot ship in a shared package. Rename
them to something neutral, make them configurable, or leave them behind?

### History, since it explains the shape

They arrived in a single commit — `55f58811 fix(webviews): adapt Fluent field colors`. Two
variables, thirteen references, three files, SCSS only. The value is one expression:

```scss
var(--vscode-checkbox-border, var(--vscode-input-border, color-mix(in srgb, var(--vscode-foreground) 55%, transparent)))
```

Two mechanisms stacked. `var(a, b)` is a fallback chain, because many community themes define only a
subset of VS Code's tokens. `color-mix(in srgb, X 55%, transparent)` is an alpha multiply — sRGB
mixing is premultiplied, so the result is exactly `X` at 55% opacity. The 55 and 75 are hand-tuned
contrast constants. Because the result is translucent it composites against whatever is behind it,
which is why one declaration is correct on both light and dark themes.

They are not design tokens. They are a **named shared subexpression**, invented so a long fallback
chain would not be pasted into eight places.

### Decision

The package ships **no** public CSS custom properties in v1. Inside the package the value becomes a
local SCSS variable, which is sufficient because the package compiles its own stylesheet.

The opt-in class that would have replaced them — one extra selector in the existing field
`:where()` list, letting a non-Fluent control join the field treatment — is **deferred until a
second consumer needs it**.

### Why deferring is the disciplined choice, and what it costs

The only consumer today is this extension's `MonacoAutoHeight`, a hand-rolled control styled to look
like a Fluent `Textarea`. Shipping public API for one consumer fails condition 3 of the scope gate.

The cost is accepted knowingly: the extension keeps its own `--documentdb-*` definitions, so the
formula exists in two places and can drift if the package retunes the constants. That risk is
bounded — it is one product's internal stylesheet, not published API — and the extension-side
declaration carries a comment pointing at the source of truth.

A pleasant side effect: the `--documentdb-` prefix becomes _correct_ rather than awkward. It stays
in the product, where a product prefix belongs, and the package has no prefix question at all.

### The rule that survives without the API

When a public custom property is eventually needed, derive its prefix from the package name **minus
the `vscode-` segment** — `--ext-webview-fluentui-` — and never prefix with `--vscode-`, which is
the namespace VS Code injects several hundred properties into. Suffixes mirror the Fluent token they
feed, in Fluent's camelCase, so the substitution reads directly.

### Carried forward as a bug

The base value has a three-level fallback chain; the hover value has none and is always
foreground-at-75%. On a theme defining a strong `--vscode-checkbox-border`, hovering an input
therefore **lowers** contrast. To be fixed when the rules move.

---

## 0013 — Monaco theming stays in the extension

**Status:** Deferred · **Date:** 2026-08-18

### Decision

`getMonacoTheme`, `generateMonacoTheme`, the `MonacoTheme` types and the VS Code token list all stay
in the extension. A `./monaco` subpath is future work, to be taken up when Monaco integration is
worked on in its own right.

### Why

`ThemeState.tsx` imports `monaco-editor/esm/vs/editor/editor.api` for three type aliases, pulling a
roughly 5 MB peer into a theming package. Deferring removes that peer, those types, the `monaco`
field on the theme state, and — because `generateMonacoTheme` is their only caller — the 815-entry
token list as well (0008). That is a large surface removed by one deferral.

### The seam

`MonacoEditor.tsx` is the only consumer of the precomputed `ThemeState.monaco`. It changes from
reading a field to deriving the value locally:

```ts
const monaco = getMonacoTheme(useActiveVSCodeThemeKind()); // getMonacoTheme stays in the extension
```

The package exposes the theme kind; the extension derives Monaco itself. When `./monaco` is
eventually built it is purely additive, with an optional `monaco-editor` peer, and nothing published
in v1 has to change.

Noted for that future work, not for now: `generateMonacoTheme` performs 815 `getPropertyValue`
lookups on every theme change. Acceptable today; worth a second look before it becomes public API.

### If a Monaco wrapper is ever wanted, it is a third package

Not a `./monaco` subpath here. Monaco is not Fluent, so it falls outside the boundary the package
name draws (0002), and `monaco-editor` is a roughly 5 MB peer that no theming consumer should have
to reason about. `@microsoft/vscode-ext-webview-monaco` alongside the transport and Fluent packages
is the cleaner shape.

---

## 0014 — Public naming vocabulary is locked before publish

**Status:** Accepted (modified) · **Date:** 2026-08-18

### Decision

| Was                    | Is                                              |
| ---------------------- | ----------------------------------------------- |
| `DynamicThemeProvider` | `VSCodeFluentProvider`                          |
| `useThemeState`        | `useActiveVSCodeTheme`                          |
| —                      | `useActiveVSCodeThemeKind` (narrow, for tier 2) |
| `getFluentUiTheme`     | `createVSCodeFluentTheme`                       |

### Why rename at all

The sibling package paid a rename tax twice — `api` → `webviewIntegration/` → `_integration/`, and
`setupTrpc` → `attachTrpc`. Renaming is free before publish and expensive after. Today's only
consumers are internal.

### Why the `VSCode` prefix

Three reasons, of which only the third is taste. First, collision: `useThemeState` and
`ThemeProvider` are among the most generic names in the React ecosystem, and a consumer file will
already contain `FluentProvider` and possibly a `ThemeProvider` from another library. Package-level
names must survive in files the package does not control.

Second, `DynamicThemeProvider` does not say what it does — dynamic relative to what? The actual
contract is _observe VS Code's theme, produce a Fluent theme_. `VSCodeFluentProvider` names both
ends, and naming both ends is what makes the contract legible at a glance.

Third, casing: `VSCode`, not `VsCode` or `Vscode`, matching `@vscode/l10n`, the
`@vscode/webview-ui-toolkit` component names, and the `vscode.` API surface.

### Changed from the proposal

The proposal said `useVSCodeTheme`. The operator asked for something more explicit about tracking
the currently active theme and suggested `useCurrentVSCodeTheme`. `Current` was rejected as
redundant — a hook's return value is always current, which is why the ecosystem writes
`useMediaQuery` and not `useCurrentMediaQuery` — in favour of `Active`, which carries the same
explicitness while borrowing vocabulary the audience already has: the extension-host API is
`vscode.window.activeColorTheme`, with `ColorTheme` and `ColorThemeKind`.

---

## 0015 — The generated CSS module is committed, not gitignored

**Status:** Accepted (modified) · **Date:** 2026-08-18

### Decision

`src/styles/generated.ts`, produced by the `prebuild` script from the SCSS source, is committed to
the repository.

### Why

Gitignoring it is cleaner and was the recommendation during design. It was reversed for a concrete
reason: the repo's hand-over checklist runs `npx jest --no-coverage` directly, which does **not**
trigger the root `prejesttest` fan-out. On a fresh clone the generated module would be missing and
the package's tests would fail for a reason with no obvious connection to the failure message.

The cost is diff noise on a generated artifact. The header comment marks it generated, and it
changes only when the stylesheet does.

---

## 0016 — Consumers resolve the package through tsconfig `paths`

**Status:** Accepted · **Date:** 2026-08-18

### Question

`npm run build` is plain `tsc` against the root `tsconfig.json`, which is `"module": "commonjs"` with
no `moduleResolution` — node10 resolution, so the `exports` field is ignored entirely. The first
webview that imports the package breaks the build. How is that fixed?

### Options considered

| Option | Approach                                                                                     | Cost                           | Gives up                                          |
| ------ | -------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------- |
| A      | Exclude `src/webviews/**` from the root config; add `tsconfig.webviews.json`; two-step build | new config + build script edit | nothing, but more moving parts                    |
| B      | Root tsconfig `paths` mapping the package name to its `src`                                  | two lines                      | type-checks source rather than built output       |
| C      | Ship `typesVersions`, mirroring the sibling                                                  | one block                      | puts a legacy shim into the **published** package |

### Decision

**B.** Two `paths` entries in the root `tsconfig.json`, mapping `.` and `./components` to
`packages/vscode-ext-webview-fluentui/src/*.ts`.

### Why

It is `vscode-cosmosdb`'s documented convention for its own workspace packages — their
`packages/README.md` instructs contributors to _"add path aliases to `tsconfig.base.json` (`paths`)
so `tsc` resolves the package to its `src/`"_, with matching `resolve.alias` entries in the Vite
configs. This repo is converging on that setup, so matching it costs nothing now and avoids a
migration later.

C was rejected on principle rather than mechanics: it works, but it would bake a workaround for
**our** stale root config into an artifact every consumer downloads. A local build limitation should
not shape published API.

A is the most correct and stays on the table for whenever the root config is modernised. It was not
chosen now because the operator's instruction was to take the simplest route on the explicit
grounds that this whole area is due to be reworked.

### The gap this leaves, and why it is small

B type-checks the package **source**, so `tsc` alone will not catch a malformed `exports` map or a
broken build output. That gap is covered in practice: webpack resolves the real package through
`node_modules` and honours `exports`, so `npm run webpack-prod` and `npm run package` — both in the
hand-over checklist — exercise the published shape.
