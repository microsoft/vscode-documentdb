# Changelog

## 1.1.0

### Monaco theming

- Added the `./monaco` entry, exporting `useVSCodeMonacoTheme` and `createVSCodeMonacoTheme`: the user's active VS Code theme, shaped for `monaco.editor.defineTheme()`.
- The Monaco theme data is structurally assignable to `monaco.editor.IStandaloneThemeData`, so the package takes no peer or runtime dependency on `monaco-editor`. Importing `./monaco` does not load Fluent UI or inject its stylesheet.
- Added VS Code color fallback chains for shared widget, input, menu, and list surfaces, aligned with the Fluent theme mappings when a color is unset.
- The Monaco theme re-derives on a same-kind theme switch, such as one dark theme to another, which a derivation keyed on the theme kind alone cannot detect.
- Theme snapshots are shared across editors and retain their object identity when the derived colors are unchanged, avoiding unnecessary theme updates.
- Fixed stale initial colors when the theme changes between the hook's first render and subscription; snapshots also refresh when observation resumes after all editors unmount.
- Colors that Monaco could not parse are dropped rather than passed through, where previously they would have painted the surface red.
- Added optional theme names, color overrides, and syntax token rules to `createVSCodeMonacoTheme`. Syntax highlighting inherits Monaco's built-in palette unless rules are supplied.

### Wizard navigation

- Added the `headerBehavior` prop to `Wizard` with `scroll` and `sticky-navigation` modes.
- Added sticky step navigation that gains a border and shadow when content scrolls beneath it.
- Added a scrolling header fade that stays fully visible while header actions have focus and is disabled when reduced motion is preferred.

## 1.0.0

- Initial release.
