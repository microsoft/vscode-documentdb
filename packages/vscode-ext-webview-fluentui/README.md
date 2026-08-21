# @microsoft/vscode-ext-webview-fluentui (Preview)

> **Preview release.** This package is published in preview while the API
> surface stabilises. Breaking changes may land between minor versions until
> a `1.0.0` release.

Two things for building [Fluent UI React v9](https://react.fluentui.dev/) webviews inside VS Code,
usable on their own or mixed together: a **theming layer** that makes Fluent track the user's
active VS Code theme, and a small set of **reusable components** that Fluent itself does not ship.

Its sibling, [`@microsoft/vscode-ext-webview`](../vscode-ext-webview/README.md), carries the
transport (tRPC over `postMessage`). Neither package in this pairing depends on the other.

## The two things this package does

### Theming

Out of the box, Fluent looks like Microsoft Teams: its neutral ramp is a fixed gray produced by
`createLightTheme`/`createDarkTheme`, and it ignores the user's workbench theme entirely.
`VSCodeFluentProvider` synthesizes a Fluent theme from the user's live VS Code theme and keeps every
Fluent component under it in sync as the user switches themes.

See [Quick start: theming](#quick-start-theming) for the common path, and
[Theming in detail](#theming-in-detail) for the mechanism, the CSP requirement, and edge cases such
as which `Skeleton` appearance to use.

### Components

`Container`, `MetricGrid`, `StepList`, `StatusList`, and `Wizard` are reusable layout, navigation
and data-display components. They style themselves from Fluent `tokens.*`, so they work with or
without this package's theming, and importing them injects no stylesheet of their own.

See [Quick start: components](#quick-start-components) for the common path, and
[`src/components/README.md`](./src/components/README.md) for the full catalog, how the components
compose, and how to build a wizard-like surface from `Container` and `StepList` directly.

Both halves are independent: adopting the theming does not require the components, and using a
component does not require this package's provider.

## Install

```bash
npm install @microsoft/vscode-ext-webview-fluentui
```

Peer dependencies, which you already have if you are using Fluent:

| Peer                         | Range   |
| ---------------------------- | ------- |
| `react`                      | `>=19`  |
| `@fluentui/react-components` | `~9.74` |
| `@fluentui/react-icons`      | `~2.0`  |

The Fluent range is narrow on purpose. The stylesheet keys off `fui-*` class names and, in one
case, the absence of an `aria-valuenow` attribute. Those are Fluent implementation details rather
than public API. A minor Fluent release can restructure them, and the overrides would then silently
stop applying.

## Quick start: theming

```tsx
import { VSCodeFluentProvider } from '@microsoft/vscode-ext-webview-fluentui';

createRoot(container).render(
    <VSCodeFluentProvider>
        <App />
    </VSCodeFluentProvider>,
);
```

That covers most consumers: every Fluent component rendered under `VSCodeFluentProvider` now tracks
the active VS Code theme, including a theme switch while the webview stays open.

Already own a `FluentProvider`? Compose the same result yourself; the provider above is built from
exactly these two calls and nothing private, so this is not a downgraded path.

```tsx
import { createVSCodeFluentTheme, useActiveVSCodeThemeKind } from '@microsoft/vscode-ext-webview-fluentui';

const themeKind = useActiveVSCodeThemeKind();
const theme = useMemo(() => createVSCodeFluentTheme(themeKind), [themeKind]);

return (
    <FluentProvider theme={theme} /* …your own props… */>
        <App />
    </FluentProvider>
);
```

`useActiveVSCodeTheme()` returns `{ themeKind, theme }` if you want both in one call.

Post-processing the generated theme, and everything else about the theming, is covered in
[Theming in detail](#theming-in-detail) below.

## Quick start: components

```tsx
import { Wizard, WizardStep, ContainerHeader, ContainerFooter } from '@microsoft/vscode-ext-webview-fluentui/components';
```

Five things ship today. `Container` is the shell of a full-window surface: scrolling header and
content, over a footer pinned to the bottom. `StepList` is a step indicator that collapses into an
overflow menu and never hides the current step. `StatusList` is a bordered list of stages, each
with a status glyph and a line of evidence. `Wizard` is all three of those assembled into a
complete wizard surface, for the common case where you do not want to wire them yourself.
`MetricGrid` and `MetricCard` are a dashboard strip: one measurement per card, told apart from
"loading" and "unavailable" without the layout moving, in a grid that goes from one column to four.

Components style themselves from Fluent `tokens.*`, which resolve against whatever
`FluentProvider` is above them. They work without this package's theming, and importing
`./components` injects no stylesheet.

None of them carry localized strings: every user-visible string is a prop with an English default.
The package ships no translations at all, because string extractors do not scan `node_modules`, so
a string owned here could never be translated by a consumer.

See [`src/components/README.md`](./src/components/README.md) for the full catalog, how the
components compose, and how to decompose `Wizard` into `Container` and `StepList` when you need a
layout it does not offer.

## Theming in detail

Everything past the quick start: the mechanism, the things that surprise people, and the one place
a Fluent prop choice decides whether the theming can even apply.

### What it does, mechanically

1. Reads the user's accent color off the DOM and synthesizes a Fluent brand ramp from it through
   LCH/LAB palette math.
2. Remaps roughly fifty Fluent neutral tokens onto `var(--vscode-*)` with fallback chains, so
   surfaces track the active theme, including community themes that leave the ideal token
   undefined.
3. Injects a stylesheet of component-scoped escapes for the cases a Fluent recipe cannot be
   reached through tokens at all.

It follows the user live: VS Code rewrites `data-vscode-theme-kind` on the webview body when the
theme changes, and the hooks observe that attribute.

### Post-process the generated theme

`generateAdaptiveLightTheme()` and `generateAdaptiveDarkTheme()` return the raw Fluent `Theme`
objects, for consumers who want to override individual tokens on top.

### Things to know before you adopt it

**The stylesheet ships itself, and there is no opt-out.** Importing anything from the main entry
injects the overrides. There is no import to forget, no ordering to get right, and no flag to
disable them. If you want unadapted Fluent, use Fluent directly; it costs you nothing.

**The overrides are document-global.** They apply to _every_ Fluent component in your webview,
including ones you rendered without thinking about this package, and including portaled surfaces
such as dialogs, menus and tooltips. That reach is deliberate: portals are exactly why the escapes
are class-based rather than provider-scoped.

**They are still overridable.** Every rule is wrapped in `:where()`, so it carries zero
specificity. Your own plain `.fui-Input { … }` wins regardless of which `<style>` element came
first.

**Content Security Policy.** Griffel, Fluent's own styling engine, injects `<style>` elements at
runtime, and so does this package. Your webview CSP needs `style-src 'unsafe-inline'`, which is
what Fluent already required of you.

### Component guidance: Skeleton

The one place the theming cannot decide for you, where the choice of Fluent prop determines
whether the result tracks the theme at all.

Fluent's `Skeleton` and `SkeletonItem` default to `appearance="opaque"`. Pass `translucent`
instead, on the `<Skeleton>` wrapper or on a bare `<SkeletonItem>`:

```tsx
<Skeleton appearance="translucent">
    <SkeletonItem size={24} />
</Skeleton>
```

The two appearances are not two visual styles. They are two different compositing models, and
only one of them can work on an unknown surface:

| Appearance    | Resting fill                      | Sweep                                       | Composites over the card? |
| ------------- | --------------------------------- | ------------------------------------------- | ------------------------- |
| `opaque`      | solid `colorNeutralStencil1`      | `Stencil1 → Stencil2 → Stencil1`, opaque    | no, it paints over it     |
| `translucent` | alpha `colorNeutralStencil1Alpha` | `transparent → Stencil1Alpha → transparent` | yes                       |

An opaque skeleton has to be mixed against the colour of whatever card it sits on. A theme token
cannot know that, so any value is wrong on some surface. This package mixes against
`--vscode-editor-background`, which is right for the default surface and visible as a rectangle on
any other. Translucent has no such problem: it is an alpha overlay, so it picks up the card's own
colour and hue for free, on every theme.

Two consequences worth knowing:

- The sweep runs in **opposite directions**. Opaque peaks at `Stencil2`, which sits closer to the
  surface, so the band reads lighter on a light theme. Translucent adds `Stencil1Alpha` to its own
  base, so its band can only read darker. Mixing the two appearances in one view looks like a bug.
- Translucent needs nothing from this package. Its `*Alpha` tokens come from Fluent's own
  light/dark themes and are already theme-kind correct, which is why it is the appearance that
  survives contact with community themes.

## Public surface

| Entry          | Exports                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `.`            | `VSCodeFluentProvider`, `useActiveVSCodeTheme`, `useActiveVSCodeThemeKind`, `createVSCodeFluentTheme`, `generateAdaptive{Light,Dark}Theme` |
| `./components` | `Container` and its family, `MetricGrid`, `MetricCard`, `StepList`, `StatusList`, `Wizard`, and their prop types                           |

The palette math and the VS Code theme token list are internal. Monaco theming is not part of this
package: Monaco is not Fluent, and a 5 MB peer has no business in a theming package.

## License

MIT
