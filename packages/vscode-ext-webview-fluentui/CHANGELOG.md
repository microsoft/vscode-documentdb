# Changelog

## 1.2.0

- Added the `./monaco` entry, exporting `useVSCodeMonacoTheme` and `createVSCodeMonacoTheme`: the user's active VS Code theme, shaped for `monaco.editor.defineTheme()`.
- The Monaco theme data is structurally assignable to `monaco.editor.IStandaloneThemeData`, so the package takes no dependency on `monaco-editor` — not a peer, and nothing at runtime.
- Monaco and Fluent now read one shared internal color source, so both resolve a shared surface the same way, including on themes that leave a color unset.
- The Monaco theme re-derives on a same-kind theme switch, such as one dark theme to another, which a derivation keyed on the theme kind alone cannot detect.
- Colors that Monaco could not parse are dropped rather than passed through, where previously they would have painted the surface red.

## 1.1.0

- Added the `headerBehavior` prop to `Wizard` with `scroll` and `sticky-navigation` modes.
- Added sticky step navigation that gains a border and shadow when content scrolls beneath it.
- Added a scrolling header fade that stays fully visible while header actions have focus and is disabled when reduced motion is preferred.

## 1.0.0

- Initial release.
