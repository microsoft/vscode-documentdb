# @microsoft/vscode-ext-webview-fluentui

Makes [Fluent UI React v9](https://react.fluentui.dev/) look native inside a VS Code webview.

Out of the box, Fluent looks like Microsoft Teams: its neutral ramp is a fixed gray produced by
`createLightTheme`/`createDarkTheme`, and it ignores the user's workbench theme entirely. This
package fixes that, and then — separately and optionally — offers a small set of components that
solve VS Code integration problems.

**Theming is the reason to adopt this package. The components are a bonus you can ignore**; they
never require this package's provider.

Its sibling, [`@microsoft/vscode-ext-webview`](../vscode-ext-webview/README.md), carries the
transport (tRPC over `postMessage`). Neither package depends on the other, in either direction.

## What the theming does

1. Reads the user's accent color off the DOM and synthesizes a Fluent brand ramp from it through
   LCH/LAB palette math.
2. Remaps roughly fifty Fluent neutral tokens onto `var(--vscode-*)` with fallback chains, so
   surfaces track the active theme — including community themes that leave the ideal token
   undefined.
3. Injects a stylesheet of component-scoped escapes for the cases a Fluent recipe cannot be
   reached through tokens at all.

It follows the user live: VS Code rewrites `data-vscode-theme-kind` on the webview body when the
theme changes, and the hooks observe that attribute.

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
case, the absence of an `aria-valuenow` attribute — Fluent implementation details rather than
public API. A minor Fluent release can restructure them, and the overrides would then silently
stop applying.

## Usage

### Greenfield: use the provider

```tsx
import { VSCodeFluentProvider } from '@microsoft/vscode-ext-webview-fluentui';

createRoot(container).render(
    <VSCodeFluentProvider>
        <App />
    </VSCodeFluentProvider>,
);
```

### You already own a `FluentProvider`

Compose the same result yourself. The provider above is built from exactly these two calls and
nothing private, so this is not a downgraded path.

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

### Post-process the generated theme

`generateAdaptiveLightTheme()` and `generateAdaptiveDarkTheme()` return the raw Fluent `Theme`
objects, for consumers who want to override individual tokens on top.

### Components

```tsx
import { WizardBreadcrumb } from '@microsoft/vscode-ext-webview-fluentui/components';
```

Components style themselves from Fluent `tokens.*`, which resolve against whatever
`FluentProvider` is above them. They work without this package's theming, and importing
`./components` injects no stylesheet.

`WizardBreadcrumb` carries no localized strings: its accessible names are props. The package ships
no translations at all, because string extractors do not scan `node_modules`, so a string owned
here could never be translated by a consumer.

## Things to know before you adopt it

**The stylesheet ships itself, and there is no opt-out.** Importing anything from the main entry
injects the overrides. There is no import to forget, no ordering to get right, and no flag to
disable them. If you want unadapted Fluent, use Fluent directly — it costs you nothing.

**The overrides are document-global.** They apply to _every_ Fluent component in your webview,
including ones you rendered without thinking about this package, and including portaled surfaces
such as dialogs, menus and tooltips. That reach is deliberate: portals are exactly why the escapes
are class-based rather than provider-scoped.

**They are still overridable.** Every rule is wrapped in `:where()`, so it carries zero
specificity. Your own plain `.fui-Input { … }` wins regardless of which `<style>` element came
first.

**Content Security Policy.** Griffel — Fluent's own styling engine — injects `<style>` elements at
runtime, and so does this package. Your webview CSP needs `style-src 'unsafe-inline'`, which is
what Fluent already required of you.

## Public surface

| Entry          | Exports                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `.`            | `VSCodeFluentProvider`, `useActiveVSCodeTheme`, `useActiveVSCodeThemeKind`, `createVSCodeFluentTheme`, `generateAdaptive{Light,Dark}Theme` |
| `./components` | `WizardBreadcrumb`, `WizardBreadcrumbProps`, `WizardStepMeta`                                                                              |

The palette math and the VS Code theme token list are internal. Monaco theming is not part of this
package — Monaco is not Fluent, and a 5 MB peer has no business in a theming package.

## License

MIT
