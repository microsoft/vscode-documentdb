# `monaco/`

Entry point `./monaco`. The active VS Code theme, shaped for `monaco.editor.defineTheme()`.

No dependency on `monaco-editor`, not even a type import. `IStandaloneThemeData` is a plain
structural interface, so `core/types.ts` mirrors it and the result is assignable without a cast.
`type-tests/monacoContract.ts` proves that against the real Monaco types at build time, with
`monaco-editor` present only as a `devDependency`.

## The boundary

> The package owns **what VS Code's colours are**. The consumer owns **what Monaco does with them**.

So this folder produces data and stops. No loader configuration, no editor lifecycle, no React
wrapper around `<Editor>`, no accessibility work. Those belong to whoever mounts Monaco, and if they
ever want sharing it is a separate package (decisions 0002 and 0013).

## `core/`: no React

| File                        | What it is                                                        |
| --------------------------- | ----------------------------------------------------------------- |
| `colorIds.ts`               | generated, committed: the 392 colour ids Monaco registers          |
| `fallbackChains.ts`         | where an unpublished id falls back to, and why that list is short  |
| `createVSCodeMonacoTheme.ts` | the derivation                                                    |
| `types.ts`                  | the structural mirror of Monaco's theme types                      |

### Why 392 and not all 813

Monaco declares every colour it understands through `registerColor`. Measured against the installed
`monaco-editor`, that is 392 ids, and they are a **strict subset** of the workbench list the
extension used to supply. The other 421 - `activityBar.*`, `titleBar.*`, `welcomePage.*` - have no
reader inside Monaco, so supplying them costs a lookup and buys nothing.

That makes the curated list provably lossless rather than a judgement call. Regenerate it with
`npm run build:monaco-color-ids` after upgrading `monaco-editor`; `colorIds.test.ts` fails if the
committed list has drifted from the installed one.

### Why the fallback table is short

Unification is the point, but a chain is not automatically an improvement. For ids Monaco owns
outright - the cursor, the current-line highlight, bracket matching - Monaco's own default is the
right answer, and overriding it with some other VS Code colour would be worse than doing nothing.

So a chain exists only where the same visual concept is rendered twice, by two engines, resolving
it two different ways: a Fluent popover beside a Monaco hover widget, a Fluent menu beside Monaco's
context menu. Each chain mirrors one that already exists in `theme/core/themeGenerator.ts`.

## `react/`: React

`useVSCodeMonacoTheme` re-derives when the theme changes and holds its object identity when it has
not, so the consumer's `defineTheme` / `setTheme` effect - and Monaco's repaint - do not fire for
nothing.

"When the theme changes" means the `vscode/` change store, not `data-vscode-theme-kind`. Monaco
consumes a **snapshot** of the colours, and switching between two dark themes leaves the kind
unchanged while every colour moves. Keying on the kind is the bug this hook exists to not have.

## What it does not do

Syntax token colours. `rules` is empty, so Monaco colourizes from its built-in `vs`/`vs-dark`
palette: a string inside the editor is a different colour from the same string in the user's real
editor. VS Code publishes no TextMate colours as CSS variables, so closing that gap means
approximating from `--vscode-debugTokenExpression-*` and friends - a real improvement, but one with
its own taste debate. The `rules` option on `createVSCodeMonacoTheme` leaves the door open.
