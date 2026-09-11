# `src/`

Entry map and import direction.

| File            | Entry point    | What it is                                                                               |
| --------------- | -------------- | ---------------------------------------------------------------------------------------- |
| `index.ts`      | `.`            | theming, plus the `injectStyles()` call at module scope                                  |
| `components.ts` | `./components` | components only; imports neither `theme/` nor `styles/` (invariant I1)                   |
| `monaco.ts`     | `./monaco`     | the active theme shaped for `monaco.editor.defineTheme()`; no `monaco-editor` dependency |

## Layering

One-directional. Nothing below imports anything above it.

```
components  ──┐   React + Fluent, provider-agnostic
              ├──> theme/react   React: provider + hooks
              │        └───────> theme/core    Fluent, no React: theme generators
              │                      └───────> vscode    no Fluent, no React: what the active theme is
              │                              ^
monaco      ──────────────────────────────┘   React at the top only
              └───────────────-> palette       no Fluent, no React: LCH/LAB colour math
```

Three rules make this worth keeping:

- **`components/` may not import `theme/` or `styles/`.** A component must not require the
  package's provider. That is what lets a consumer adopt a component without adopting a visual
  philosophy. Enforced by a `no-restricted-imports` rule in the repo's ESLint config, and by
  `components.test.ts`.
- **`monaco/` may not import `theme/`, `components/` or `styles/`.** It shares the colour source,
  not the Fluent adaptation, and importing `./monaco` must inject nothing. Same enforcement, plus
  `monaco.test.ts`.
- **The bottom is React-free and Fluent-free.** `palette/` is plain colour math, `vscode/` is the
  active theme read off the DOM, `theme/core` adds Fluent but no React. Splitting the package later
  is then mechanical rather than archaeological.

## Folders

| Folder         | Contents                                                                     |
| -------------- | ---------------------------------------------------------------------------- |
| `palette/`     | LCH/LAB colour math that turns a key colour into a 16-stop brand ramp        |
| `vscode/`      | the active theme itself: kind, colour ids, hex normalisation, a change store |
| `theme/core/`  | Fluent `Theme` generators; no React                                          |
| `theme/react/` | the hooks that track the active VS Code theme, and the provider facade       |
| `monaco/`      | the same colour source, shaped for Monaco; no `monaco-editor` dependency     |
| `styles/`      | the SCSS escapes, the module generated from them, and the injector           |
| `components/`  | components, each usable under any `FluentProvider`                           |

`vscode/` is internal and is not an entry point (decision 0008). It exists so that every
derivation in the package agrees on what the active theme is, rather than each computing its own.
