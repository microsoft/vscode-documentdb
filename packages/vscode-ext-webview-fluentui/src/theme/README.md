# `theme/`

Everything that turns "the user's active VS Code theme" into "a Fluent theme".

## `core/`: Fluent, no React

`themeGenerator.ts` builds the adaptive light and dark themes: a brand ramp synthesized from
`--vscode-button-background`, plus roughly fifty neutral tokens remapped onto `var(--vscode-*)`
with fallback chains, because many community themes define only a subset of VS Code's colors.

`createVSCodeFluentTheme.ts` picks between them by theme kind. High-contrast kinds bypass the
generators and fall back to the static Teams themes, so none of the token remapping applies
there. Worth remembering when reading a bug report against a high-contrast theme.

## `react/`: React

`useActiveVSCodeTheme.ts` holds both hooks. They are standalone and read no React context.
`useActiveVSCodeThemeKind` observes the body theme-kind attribute. `useActiveVSCodeTheme` also
subscribes to the shared VS Code color store so a same-kind theme switch regenerates the fixed
brand ramp.

`VSCodeFluentProvider.tsx` is the facade, and it is deliberately thin: one hook and a
`FluentProvider`. A consumer that owns a `FluentProvider` can call `useActiveVSCodeTheme()` and pass
its `theme` to get the same reactive behavior. The lower-level kind hook and theme factory are for
consumers that provide their own color-change invalidation.

## What is not here

Monaco theming, which lives in [`../monaco/`](../monaco/README.md) and ships from the `./monaco`
entry. It is a sibling rather than a part of this folder: it reads the same colors, but it produces
Monaco data rather than a Fluent theme, and it must not pull Fluent in. Both derive from
[`../vscode/`](../vscode/README.md), which is what keeps them in agreement.

There is also no "use the plain Teams theme instead" switch. That is not a feature of this
package, it is the absence of it, and any consumer gets it for free from Fluent.
