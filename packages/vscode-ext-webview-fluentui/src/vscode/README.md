# `vscode/`

What VS Code's active theme actually _is_, with no opinion about what renders it.

No Fluent, no React, no Monaco. This is the tier the Fluent generators and the Monaco derivation
both sit on, and it exists so those two agree on the answer rather than each computing their own.

| File                       | What it is                                                                        |
| -------------------------- | --------------------------------------------------------------------------------- |
| `themeKind.ts`             | reads `data-vscode-theme-kind`; one definition of "which theme is active"         |
| `cssVariable.ts`           | color id (`editorWidget.background`) to custom property                           |
| `toHexColor.ts`            | normalizes a computed CSS color to hex, or rejects it                             |
| `readVSCodeThemeColors.ts` | resolves a list of color ids off the document, in one `getComputedStyle`          |
| `themeColorsStore.ts`      | a change counter for consumers that must snapshot colors rather than link to them |

## Why `toHexColor` rejects rather than passes through

Monaco's `Color.fromHex` is `parseHex(value) || Color.red`. An unparseable value does not degrade
to something dull, it paints that surface **red**. Omitting the id instead lets the renderer fall
back to its own default, which is the right answer for a color we could not read.

It is deliberately narrower than a CSS color parser - `color-mix()`, `hsl()` and named colors are
all rejected. VS Code publishes hex and `rgba()`, so widening it would only add ways to guess wrong.

## Why the store exists, and why Fluent does not need it

Fluent's adapted tokens are `var(--vscode-*)` strings; the browser re-resolves them and the theme
follows by itself. A consumer that reads colors into fixed values has to be told when to re-read,
and `data-vscode-theme-kind` is not that signal - switching between two dark themes leaves the kind
unchanged while every color moves.

So the store watches the root element's `style` attribute, which is where VS Code writes the
custom properties. That is the write itself, so it holds regardless of which body attributes a
given VS Code version sets, and it also catches `workbench.colorCustomizations` edits that change
no theme at all.

## Not an entry point

Internal, per decision 0008: it has no external consumer, and promoting it later is one line in
`exports`. Un-shipping it would not be.
