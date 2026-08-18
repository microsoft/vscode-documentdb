# `theme/`

Everything that turns "the user's active VS Code theme" into "a Fluent theme".

## `core/` — Fluent, no React

`themeGenerator.ts` builds the adaptive light and dark themes: a brand ramp synthesized from
`--vscode-button-background`, plus roughly fifty neutral tokens remapped onto `var(--vscode-*)`
with fallback chains, because many community themes define only a subset of VS Code's colors.

`createVSCodeFluentTheme.ts` picks between them by theme kind. High-contrast kinds bypass the
generators and fall back to the static Teams themes, so none of the token remapping applies
there — worth remembering when reading a bug report against a high-contrast theme.

## `react/` — React

`useActiveVSCodeTheme.ts` holds both hooks. They are standalone: they observe
`data-vscode-theme-kind` on the body element directly rather than reading a context, because a
consumer using their own `FluentProvider` needs the theme kind without mounting ours.

`VSCodeFluentProvider.tsx` is the facade, and it is deliberately thin — one hook and a
`FluentProvider`. A consumer assembling it by hand from `useActiveVSCodeThemeKind()` and
`createVSCodeFluentTheme()` gets an identical result. A facade that reaches into private internals
is a facade that cannot be replaced.

## What is not here

Monaco theming. `getMonacoTheme` and the ~815-entry VS Code token list stayed in the extension:
Monaco is not Fluent, and its types would drag a 5 MB peer into a theming package. A consumer
derives Monaco themselves from `useActiveVSCodeThemeKind()`.

There is also no "use the plain Teams theme instead" switch. That is not a feature of this
package — it is the absence of it, and any consumer gets it for free from Fluent.
