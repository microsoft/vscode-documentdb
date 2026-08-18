---
feature: webview-fluentui-package
kind: plan
status: active
created: 2026-08-18
---

# Increment 1 — theming layer and the first component

> Package skeleton on disk, the theming layer moved, `WizardBreadcrumb` moved, both consumed by this
> extension through the npm workspace. **No npm publish.**

Decisions are settled in [decisions.md](./decisions.md). Where this plan and a decision disagree, the
decision wins — stop and flag the conflict rather than reconciling silently.

## Step 1 — Webview-scoped tsconfig (prerequisite)

Add a tsconfig covering `src/webviews/**` with `"moduleResolution": "bundler"`, separate from the
host-side config, and wire the new package into the root `references` array. Nothing else can be
type-checked correctly until this exists; see design.md §9.

Everything below depends on this step.

## Step 2 — Package skeleton

Create `packages/vscode-ext-webview-fluentui/` per design.md §4. Then:

- register the package's jest project in the root `jest.config.js` `projects` array
- add `"@microsoft/vscode-ext-webview-fluentui": "*"` to the root `dependencies`, beside the existing
  `"@microsoft/vscode-ext-webview": "*"`
- add `jest-environment-jsdom` to root `devDependencies` — jest 28 split it out and it is not
  currently installed

`"workspaces": ["packages/*"]` picks the package up with no further change.

## Step 3 — Move the theming layer

Move `themeGenerator.ts`, `vscodeThemeTokens.tsx`, `utils/**`, `state/**`, `DynamicThemeProvider.tsx`
and the two SCSS files, applying:

- **Sever Monaco** — remove the `monaco-editor` type import, the `monaco` field on the theme state,
  and `getMonacoTheme`/`generateMonacoTheme`. They stay in the extension (0013), which also keeps
  `vscodeThemeTokens` (0008).
- **Delete the `adaptive` flag** and guard `getBrandTokensFromPalette` against an unparseable key
  color (0009).
- **Fold `fluentAliases.scss`** into a local SCSS variable; ship no custom properties (0012).
- **Normalise every override rule to `:where()`** — the ProgressBar rules currently are not, and
  zero specificity is what makes an injected stylesheet overridable (0010).
- **Fix the hover fallback asymmetry** recorded at the end of 0012.
- **Rename** per 0014.
- **Re-base** the on-disk SCSS paths in `fluentOverrides.test.ts` to the package root.

Then update the extension:

- `src/webviews/index.tsx` — import `VSCodeFluentProvider` from the package; drop `useAdaptive`
- `src/webviews/components/MonacoEditor.tsx` — derive the Monaco theme locally from
  `useActiveVSCodeThemeKind()`
- `src/webviews/index.scss` — keep the `--documentdb-*` declarations, now defined extension-side,
  with a comment pointing at the package as the source of truth (0012)
- delete the moved files

## Step 4 — Move `WizardBreadcrumb`

Move the file into `src/components/wizard/`. One change: replace the internal
`l10n.t('{0} more steps', …)` with an optional prop — suggested
`overflowAriaLabel?: (count: number) => string` — defaulting to English. With that the package takes
no `@vscode/l10n` dependency at all (design.md §7).

Update both call sites to import from `@microsoft/vscode-ext-webview-fluentui/components` and pass a
localized label:

- `src/webviews/documentdb/atlasCredentials/AtlasCredentialsView.tsx` — import line 46, use line 469
- `src/webviews/documentdb/localQuickStart/LocalQuickStart.tsx` — import line 78, use line 2578

## Step 5 — Docs

- Package `README.md`: lead with the framing agreed in design.md §1 — **theming for Fluent-based
  webviews first, additional optional components second** — then install, peers, the three tiers,
  the document-global reach of the overrides, and the CSP note: Griffel injects `<style>` at runtime
  and needs `style-src 'unsafe-inline'`, which is already true for these webviews but is now a
  documented package requirement.
- `ADVANCED.md`, `MIGRATION.md`, and a `README.md` in `src/` and in each folder, following the
  sibling package.
- Update the two documents that reference `DynamicThemeProvider` by name:
  `.github/skills/react-webview-architecture/SKILL.md` and its
  `references/REACT_ARCHITECTURE_GUIDELINES.md`.
- Update this feature's `README.md` timeline row with the PR number once one exists.

## Step 6 — Verify

Fast loop while working: `npm run build`, then `npx jest --no-coverage <path>`.

Before hand-over, in order: `npm run l10n` → `npm run prettier-fix` → `npm run lint` →
`npx jest --no-coverage` → `npm run build` → `npm run package`. The `l10n` step is required because
strings change at the two `WizardBreadcrumb` call sites.

## Gotchas

- **`jest.config.cjs`, not `.js`.** `"type": "module"` makes any `.js` in the package ESM, and
  `module.exports` becomes a syntax error. Applies to every `.js` file in the package.
- **The root `extension` jest project is still ts-jest and CommonJS.** If any `src/**/*.test.ts`
  imports the new package it will `require()` an ESM `dist` and fail. Keep webview UI tests inside
  the package, or add a `moduleNameMapper` in the root project pointing the package name at its
  `src`.
- **`sideEffects` must not be `false`.** The sibling's `false` is justified by an explicit audit. Here
  it would let a consumer's bundler tree-shake away the entry's `injectStyles()` call, and Fluent
  controls would silently look wrong in production builds only.
- **Do not hand-merge `l10n/bundle.l10n.json`.** It is generated: take either side, run
  `npm run l10n`, commit the result.
- **`TDD:` test suites are behavior contracts.** If one fails after a change, stop and ask rather
  than fixing the test.
