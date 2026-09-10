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

## Step 1 — Make the package resolvable (prerequisite)

`npm run build` is plain `tsc` against the root `tsconfig.json`, which uses node10 resolution and
ignores `exports`. Resolve it the way the other five workspace packages do — in the package's own
`package.json`, with **no root tsconfig change** (0016):

```jsonc
"types": "./dist/index.d.ts",
"typesVersions": {
    "*": {
        "components": ["./dist/components.d.ts"]
    }
}
```

Also add the package to the root `references` array, matching the other workspace packages.

This is part of Step 2's `package.json` rather than a separate edit — it is listed first because
everything below depends on the package being resolvable.

## Step 2 — Package skeleton

Create `packages/vscode-ext-webview-fluentui/` per design.md §4, with `version: "0.1.0-preview"` and
`"private": true` — nothing is published in this increment, and `private` is what makes an
accidental publish impossible. Peer and dev dependency ranges are in design.md §7. Then:

- register the package's jest project in the root `jest.config.js` `projects` array, as
  `'<rootDir>/packages/vscode-ext-webview-fluentui'` alongside the existing entries
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

Then update the extension, dissolving `src/webviews/theme/` entirely (design.md §10):

- `src/webviews/index.tsx` — import `VSCodeFluentProvider` from the package; drop `useAdaptive`
- `src/webviews/components/MonacoEditor.tsx` — derive the Monaco theme locally from
  `useActiveVSCodeThemeKind()`; the Monaco derivation and the VS Code token list move to sit beside
  it
- `src/webviews/index.scss` — keep the `--documentdb-*` declarations, now defined extension-side,
  with a comment pointing at the package as the source of truth (0012)
- `slickgrid.scss` — move to `src/webviews/`
- delete the moved files and the now-empty `theme/` folder

## Step 4 — Move `WizardBreadcrumb`

Move the file into `src/components/wizard/`. One change: replace the internal
`l10n.t('{0} more steps', …)` with an optional prop — suggested
`overflowAriaLabel?: (count: number) => string` — defaulting to English. With that the package takes
no `@vscode/l10n` dependency at all (design.md §7). The component has no tests today and gains none
here.

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
- A `README.md` in `src/` and in each folder, following the sibling package. **No `ADVANCED.md` and
  no `MIGRATION.md`** — there is nothing to migrate from yet, and the design rationale lives in this
  feature folder rather than in the package.
- Update the two documents that reference `DynamicThemeProvider` by name:
  `.github/skills/react-webview-architecture/SKILL.md` and its
  `references/REACT_ARCHITECTURE_GUIDELINES.md`.
- Update this feature's `README.md` timeline row with the PR number once one exists.

## Step 6 — Verify

Fast loop while working: `npm run build`, then `npx jest --no-coverage <path>`.

Before hand-over, in order: `npm run l10n` → `npm run prettier-fix` → `npm run lint` →
`npx jest --no-coverage` → `npm run build` → `npm run package`. The `l10n` step is required because
strings change at the two `WizardBreadcrumb` call sites.

### Acceptance — read this before declaring the work done

Green commands prove very little here. A wrong token mapping compiles cleanly, passes every test,
and looks broken. **The operator performs the visual check.** When the commands pass, stop, report
what changed, and hand over — do not mark the increment complete on the strength of a green build.

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

---

# Outcome

> Written after the plan was executed and the operator completed the visual check. The plan above is
> left as written; this section records what actually happened, including where reality disagreed.

**Acceptance is met.** The commands passed, and the operator verified the webviews against a spread
of themes on a local machine — the extraction is visually clean, and the theming defects the pass
surfaced are fixed below.

## Where the plan was wrong

Three facts were flagged as load-bearing and worth re-verifying. Two held exactly: the
`WizardBreadcrumb` call sites at lines 46/469 and 78/2578, and the theme layer's importers
(`index.tsx` and `MonacoEditor.tsx`).

The third did not. Step 3 asked to _"re-base the on-disk SCSS paths in `fluentOverrides.test.ts`"_ —
there were none. That test resolves `@fluentui/react-progress` through `require.resolve` and never
referenced a repo-relative SCSS path, so there was nothing to re-base. It gained a new assertion
that reads the compiled stylesheet instead.

## What the plan did not anticipate

| Discovery                                                                    | Recorded as |
| ---------------------------------------------------------------------------- | ----------- |
| `moduleResolution: bundler` emits ESM that no bundler will load              | 0017        |
| A context-backed hook cannot serve the tier-2 consumer it exists for         | 0018        |
| `:where()` normalisation breaks any rule that has to out-specify Griffel     | 0019        |
| The opaque skeleton stencils were alpha values in slots that require opacity | 0020        |

0019 and 0020 are the two that matter, because both compile cleanly and look broken — exactly the
failure mode the acceptance criterion was written to catch. Neither would have been found by any
command in Step 6.

## Theming fixes made along the way

All pre-existing, none caused by the extraction. The visual pass is what surfaced them.

| Fix                                                                                  | Why it was needed                                                                                    |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Indeterminate `ProgressBar` re-points tokens instead of declaring `background-image` | required by the `:where()` normalisation the plan asked for; a declaration would have gone blank     |
| Determinate `ProgressBar` gained a themed track                                      | only the fill was adapted; the rail stayed Teams gray on every theme                                 |
| Field hover stroke blends 45% toward the foreground                                  | the flat value _lowered_ contrast on any theme defining `--vscode-checkbox-border` (0012's open bug) |
| Opaque skeleton stencils made opaque, ratios un-reversed                             | hard-edged sweep and inverted shimmer                                                                |
| `colorNeutralBackground3` mapped to `--vscode-textCodeBlock-background`              | last unmapped surface; markdown code blocks read as a near-black hole on dark themes (#811)          |
| `getMonacoTheme` cached on the theme kind                                            | 0018 un-shared a ~815-lookup derivation across up to five editors                                    |
| `getBrandTokensFromPalette` guards its key colour                                    | planned in 0009; an absent `--vscode-button-background` threw on a NaN hue                           |

Each carries a regression test where one is possible, because none of them fail loudly.

## Tooling the increment added

- An ESLint `no-restricted-imports` rule enforcing invariant I1, verified to fire rather than
  assumed to.
- `react-hooks` lint extended to the package's `.ts` files — the repo scopes it to `.tsx`, and the
  package's hooks carry no JSX.
- `**/jest.config.cjs` added to the ESLint ignore list, alongside the existing `.js` entry.
- A throwaway `ThemeProbe` on a temporary branch, rendering the affected controls on every wizard
  step. Deleted after the check. It is what found 0020, and it is the technique to reach for again:
  the defects were in components the extension renders rarely, or in an appearance it never renders
  at all.

## Not done, deliberately

- The four remaining tokens in #811 — `colorNeutralForeground3`/`Foreground4`,
  `colorNeutralStroke1`/`Stroke3`/`StrokeAccessible`, `colorSubtleBackgroundSelected`, and
  high-contrast kinds bypassing the generator. A partial coverage pass inside an extraction is worse
  than a clean deferral.
- `ProgressBar color="error" | "warning" | "success"` still uses Fluent's static palette. Nothing
  renders them, and those tokens are shared with badges and message bars, so remapping is a wider
  decision.
- No publish. The package stays `"private": true` and is consumed through the npm workspace.
