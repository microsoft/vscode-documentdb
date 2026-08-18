# `styles/`

The escapes that tokens cannot express, and the machinery that gets them onto the page.

| File                   | What it is                                                       |
| ---------------------- | ---------------------------------------------------------------- |
| `fluentOverrides.scss` | the source of truth, authored as normal SCSS                     |
| `generated.ts`         | compiled from it by `scripts/build-styles.mjs` — **do not edit** |
| `injectStyles.ts`      | appends a single `<style>` element, idempotently                 |

`generated.ts` is committed rather than gitignored. `npx jest` does not run the repo's `prebuild`
fan-out, so on a fresh clone an absent module would fail the package's tests with a message that
has nothing to do with the cause.

## Two properties the whole design rests on

**Every rule is wrapped in `:where()`.** Zero specificity is what makes an injected sheet as
overridable as an imported one: a consumer's plain `.fui-Input { … }` wins regardless of which
`<style>` element came first, so cascade order stops mattering. This is also why the ProgressBar
adaptation re-points the tokens the Fluent recipe reads instead of declaring a `background-image` —
a declaration would have to out-specify Fluent's own Griffel class to win, and would then be
unoverridable.

**The rules are document-global.** They reach every Fluent component in the consumer's webview,
including portaled dialogs, menus and tooltips. That reach is the reason the escapes are
class-based rather than provider-scoped.

## Why component-scoped, not global tokens

Fluent reuses neutral aliases across controls with different semantics: the field stroke tokens
also drive Switch indicators and Tab hover bars. Remapping them globally in the generator fixes
inputs and breaks switches, so the field remapping lives here, scoped to field class names.

## Public CSS custom properties

There are none, deliberately. The one shared value — the field stroke chain — is a local SCSS
variable, which is enough because the package compiles its own stylesheet. If a public custom
property is ever needed, prefix it `--ext-webview-fluentui-` (the package name minus the `vscode-`
segment) and never `--vscode-`, which is VS Code's own namespace.
