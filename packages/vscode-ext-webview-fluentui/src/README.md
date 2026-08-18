# `src/`

Entry map and import direction.

| File            | Entry point    | What it is                                                              |
| --------------- | -------------- | ----------------------------------------------------------------------- |
| `index.ts`      | `.`            | theming, plus the `injectStyles()` call at module scope                 |
| `components.ts` | `./components` | components only — imports neither `theme/` nor `styles/` (invariant I1) |

## Layering

One-directional. Nothing below imports anything above it.

```
components  ──┐   React + Fluent, provider-agnostic
              ├──> theme/react   React: provider + hooks
              │        └───────> theme/core    Fluent, no React: theme generators
              └───────────────-> palette       no Fluent, no React: LCH/LAB colour math
```

Two rules make this worth keeping:

- **`components/` may not import `theme/` or `styles/`.** A component must not require the
  package's provider — that is what lets a consumer adopt a component without adopting a visual
  philosophy. Enforced by a `no-restricted-imports` rule in the repo's ESLint config, and by
  `components.test.ts`.
- **The bottom is React-free and Fluent-free.** `palette/` is plain colour math, `theme/core` adds
  Fluent but no React. Splitting the package later is then mechanical rather than archaeological.

## Folders

| Folder         | Contents                                                               |
| -------------- | ---------------------------------------------------------------------- |
| `palette/`     | LCH/LAB colour math that turns a key colour into a 16-stop brand ramp  |
| `theme/core/`  | Fluent `Theme` generators; no React                                    |
| `theme/react/` | the hooks that track the active VS Code theme, and the provider facade |
| `styles/`      | the SCSS escapes, the module generated from them, and the injector     |
| `components/`  | components, each usable under any `FluentProvider`                     |
