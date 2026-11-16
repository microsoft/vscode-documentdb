# Changelog

## 1.3.0

- Added a `skipped` status to `StatusListItem`, for a stage that does not apply or did not run because an earlier stage failed. It shows a neutral `SubtractCircleRegular` glyph and a dimmed label, and screen readers hear "skipped" after the label, overridable through `statusLabels`. Put the reason in `detail`. Code with an exhaustive `switch` over `StatusListItemStatus` needs a case for the new value.
- Added an optional `disclosure` to `StatusListItem`: a **Details**-style toggle right after the label, on the label's line, and a labelled region below the detail line, for rows that have more to say than one line. The toggle is a real button with `aria-expanded` and `aria-controls`, and the region is named by it. Collapsed rows keep their height; expanding never moves focus. It can be controlled (`expanded`, `onExpandedChange`) or left to the row (`defaultExpanded`). Rows without it render exactly as before.
- Added `placement` to `StatusListItem`'s `disclosure`. `label` (the default) keeps the toggle after the label; `detail` puts it inline at the end of the detail line, in that line's type size and line height, so the label line stays a plain heading. A long detail line wraps around the toggle like a word, and a row with an empty detail line still shows it there.
- Animated `StatusListItem` disclosure contents with Fluent's default `Collapse`, respecting reduced motion. The region remains mounted for `aria-controls`; collapsing makes it `inert` immediately and unmounts its contents after exit. Collapsed row heights and focus stay unchanged. Added `@fluentui/react-motion-components-preview` (`^0.15.6`) as a peer, alongside the other Fluent peers.
- Added `StatusListDetailsSection`, `StatusListDetailsFacts` and `StatusListDetailsMessage`: small presentational building blocks for a `StatusListItem` disclosure's content (a titled group, term and value pairs as a semantic `<dl>`, and a finding with a severity glyph, title, explanation and next step). They carry no strings except the overridable, visually hidden English severity word. The StatusList README gains a **Details content** section: who owns the frame and who owns the content, a base200 type scale with Fluent tokens and `Text` props, spacing tokens, long values, colours, accessibility, and do's and don'ts.
- The disclosure region sets its content's base type (`fontSizeBase200`, `lineHeightBase200`, `colorNeutralForeground1`), renders `code` as `fontFamilyMonospace` without the chip VS Code's webview default stylesheet gives it, and adds `spacingVerticalXXS` above and below the content inside the left rule. Plain content renders at base200; pass `<Text size={300}>` for larger text, though the README advises against it.
- Added an optional `aside` to `StatusListItem`: a short value, such as a duration `Badge`, at the end of the label line. It keeps its line while the label wraps, and its box is the label line's height, so a small badge does not make the row taller. The package formats nothing.
- Added `highlightRowsOnHover` to `StatusList`: it shades the row under the pointer, and the row whose control has keyboard focus (`:focus-visible`), with the subtle `colorNeutralBackground2`, and outlines it with `colorTransparentStrokeInteractive` for high contrast. Padding with an equal negative margin keeps the layout unchanged. Off by default.

## 1.2.0

- Added `contentMaxWidth` to `ContainerBody` and `Wizard`, accepting CSS maximum-width values or pixel numbers. Omit the prop or use `"none"` for no width cap.
- Removed the default 760px content cap. Set `contentMaxWidth="760px"` to retain the previous navigation and main content width. With side navigation, the cap applies to each region independently.
- Headers now span the available padded width, keeping header actions at the view's trailing gutter regardless of the content width cap.

## 1.1.1

Not published to npm; these changes first shipped in 1.2.0.

- Published sourcemaps embed their sources (`inlineSources`), so tools that load them, such as Vitest, no longer warn about missing source files ([#926](https://github.com/microsoft/vscode-documentdb/issues/926)).
- Documented how to load the package in unit tests under Node.js.

## 1.1.0

### Fluent theme tracking

- Fixed stale Fluent brand colors when switching between VS Code themes of the same kind or editing `workbench.colorCustomizations` while the webview remains open.
- Updated the manual `FluentProvider` composition path to use `useActiveVSCodeTheme`, which tracks both theme-kind and color changes.

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
