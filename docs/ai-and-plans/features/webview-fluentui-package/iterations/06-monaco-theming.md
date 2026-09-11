---
feature: webview-fluentui-package
kind: plan
status: active
created: 2026-09-11
---

# Increment 6 — unified Monaco theming

> Fluent tracks the user's workbench theme; Monaco does not, or rather it does so through a second,
> divergent derivation that the package cannot see. This increment gives both engines one source of
> truth for VS Code's colors, takes up the deferral in decision 0013, and fixes three defects that a
> straight move would have relocated rather than repaired.

**Takes up [decision 0013](../decisions.md#0013---monaco-theming-stays-in-the-extension)**, whose
status is `Deferred` precisely for this. Adds decision 0032. Depends on nothing from increment 5.

---

## 1. Why 0013 is being taken up now

0013 deferred on three grounds. Two no longer hold, and the third is answered rather than ignored.

| Original ground                                         | Status today                                                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| "a roughly 5 MB peer"                                   | **Gone.** Only three type aliases were ever needed. `IStandaloneThemeData` is a plain structural interface.       |
| "the token list would have shipped with zero consumers" | **Gone.** The `vscode-cosmosdb` fork carries the same `ThemeState.tsx` with the same `monaco-editor` type import. |
| "Monaco is not Fluent" (0002)                           | **Stands**, and draws the boundary in §3 rather than blocking the work.                                           |

## 2. The defects this fixes

The point of the increment is not relocation. It is these three, none of which the extension can fix
on its own because the fallback policy lives inside the package.

### (a) Fluent falls back through VS Code values; Monaco falls back to Monaco constants

`themeGenerator.ts` maps `colorNeutralBackground1Hover` to
`var(--vscode-list-hoverBackground, var(--vscode-editorWidget-background, var(--vscode-editor-background)))`.
`generateMonacoTheme` does the opposite: it drops any id whose CSS variable is empty
(`.filter(([_, color]) => color !== '')`) and lets Monaco's built-in `vs`/`vs-dark` approximation
supply a constant.

For ids Monaco owns outright — cursor, line highlight, bracket match — Monaco's own default is the
**right** answer and a chain would be worse. The divergence only matters for ids painting a surface
**Fluent also paints**, where the same visual concept is rendered twice by two engines resolving it
two different ways. That set is small and enumerable, and §5.3 enumerates it.

### (b) Monaco goes stale on a same-kind theme switch

`getMonacoTheme` caches on `themeKind`. Dark Modern → Dracula keeps `themeKind === 'vscode-dark'`,
so the cache returns the previous theme and Monaco keeps the old colors until the webview reloads.

Fluent has no such bug: its adapted tokens are `var(--vscode-*)` strings the browser re-resolves
live. Monaco's are **snapshot hex values**. That asymmetry is invisible from the consumer's side and
is the strongest single argument for package ownership.

### (c) Unvalidated values render red

Monaco's standalone theme service pushes every value through `Color.fromHex`, which yields **red**
on a parse failure. Today only `''` and `rgb…` are handled, and the `rgb…` converter runs
`parseFloat(…).toString(16)` with no rounding, so a fractional channel produces a hex fragment like
`e.4ccccccccccccd`. Feeding 813 unvalidated ids into that is a live foot-gun.

## 3. Ownership boundary

> **The package owns _what VS Code's colors are_. The consumer owns _what Monaco does with them_.**

This keeps 0002 intact. What moves into the package is not Monaco — it is a second rendering of the
**same VS Code color source** that already feeds the Fluent generator. Monaco is only the output
shape, expressed structurally.

What stays out, and 0013's closing paragraph remains correct: a Monaco **wrapper component** —
loader configuration, editor lifecycle, the focus-trap and `Announcer` work in `MonacoEditor.tsx`,
`MonacoAutoHeight` — is still a third package if it is ever wanted.

### Options considered

| Option                                                     | Verdict   |
| ---------------------------------------------------------- | --------- |
| **A** — `./monaco` subpath in this package                 | **Taken** |
| B — a new `@microsoft/vscode-ext-webview-monaco` package   | Rejected  |
| C — promote `./tokens` (0008) and build a separate package | Rejected  |

Unification requires one source of truth resolved at one version. B and C both put a package
boundary between the Fluent derivation and the Monaco derivation, which means a semver range
between them, which means the two **can** resolve at different versions — reintroducing exactly the
drift the extraction exists to kill.

A is also the cheapest to reverse, by 0008's own argument: a subpath is one line in `exports`, and
if a Monaco wrapper package ever happens this module moves into it wholesale.

## 4. Layering

Extends [design.md §3](../design.md). One-directional and React-free at the bottom, preserved.

```
components  ──┐   React + Fluent, provider-agnostic
              ├──> theme/react  ──> theme/core  ──┐  Fluent
              │                                   ├──> vscode/   ← new: colour source, no Fluent, no React
              └──> monaco/      ─────────────────-┘
                                    palette       no Fluent, no React
```

`vscode/` is an **internal** tier: the colour-id list, the CSS-variable reader, hex normalisation,
the theme-kind vocabulary, and the change store. It is not an entry point. 0008 stands — it still
has no external consumer, and promoting it later is one line in `exports`.

New invariant, alongside I1: **`monaco/` may not import `theme/`, `components/` or `styles/`.**
Enforced by the existing ESLint `no-restricted-imports` rule and by a test asserting that importing
`./monaco` injects no stylesheet.

## 5. What gets built

### 5.1 Public surface

```ts
// @microsoft/vscode-ext-webview-fluentui/monaco

/** Structural mirror of monaco.editor.BuiltinTheme. */
export type VSCodeMonacoBaseTheme = 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';

/** Structurally assignable to monaco.editor.IStandaloneThemeData. */
export interface VSCodeMonacoThemeData {
    base: VSCodeMonacoBaseTheme;
    inherit: boolean;
    rules: VSCodeMonacoTokenRule[];
    colors: Record<string, string>;
}

export interface VSCodeMonacoTheme {
    readonly themeName: string;
    readonly data: VSCodeMonacoThemeData;
}

export function createVSCodeMonacoTheme(options?: CreateVSCodeMonacoThemeOptions): VSCodeMonacoTheme;
export function useVSCodeMonacoTheme(options?: UseVSCodeMonacoThemeOptions): VSCodeMonacoTheme;
```

The hook takes **primitives only** (`themeName`). `colors` and `rules` are extension points on the
pure function, so the hook cannot acquire a memoisation foot-gun where an inline object literal
silently re-derives 392 CSS lookups on every render.

No applier helper ships in v1. It is the only piece that edges toward "wrapper", and the consumer's
effect is six lines. Revisit if a second consumer writes the same effect.

### 5.2 The colour-id list is derived from Monaco, not guessed

Measured against `monaco-editor`'s own `registerColor` calls:

|                                                       | Count                                   |
| ----------------------------------------------------- | --------------------------------------- |
| Ids the extension reads today                         | 813                                     |
| Ids Monaco actually registers, and can therefore read | **392**                                 |
| Of those, present in the extension's list             | 392 — the Monaco set is a strict subset |
| Ids read today that are inert inside Monaco           | **421**                                 |

So the curated list is **provably lossless**: every id Monaco can read is included, and the 421
dropped ones (`activityBar.*`, `titleBar.*`, `welcomePage.*` and friends) have no reader. This is
not a judgement call, and it halves both the lookup cost and the shipped list.

The list is generated from the installed `monaco-editor` by a script and **committed**, by analogy
with 0015 — a consumer must not need `monaco-editor` installed to build this package.

### 5.3 Fallback chains: only where Fluent already has one

The rule, so this does not become invented policy across 392 ids:

> A Monaco colour id gets a fallback chain **only** if it paints a surface Fluent also paints,
> **and** the chain mirrors one that already exists in `adaptiveNeutralSurfaces`.

Everything else is left to Monaco's own defaults, deliberately. Concretely, the chains mirror
Fluent's widget-surface, list-selection, input and separator chains — the places where a Fluent
popover and a Monaco hover widget sit on screen together.

### 5.4 Change detection

A React-free store in `vscode/`, consumed through `useSyncExternalStore`:

- `document.documentElement` `style` — where VS Code writes the `--vscode-*` custom properties. This
  is the trigger that fixes defect (b), and it also covers settings-level `workbench.colorCustomizations`
  edits that change no theme at all.
- `document.body` theme attributes — kind, id, name, class.

Coalesced per animation frame, so a batched attribute rewrite re-derives once. The hook returns the
**previous object identity** when the newly derived data is structurally equal, so a spurious
mutation does not cause a `defineTheme` + `setTheme` round trip and its repaint.

Observing the root `style` attribute rather than keying on `data-vscode-theme-id` is deliberate: it
is the property write itself, so it holds regardless of which body attributes a given VS Code
version happens to set.

## 6. Migration

| Step                                                                       | Effect           |
| -------------------------------------------------------------------------- | ---------------- |
| Delete `src/webviews/components/vscodeThemeTokens.ts`                      | −832 lines       |
| Delete `src/webviews/components/monacoTheme.ts`, with its `rgbaToHex` copy | −100 lines       |
| Edit `MonacoEditor.tsx` to `useVSCodeMonacoTheme()`                        | ~4 lines changed |
| `MonacoAutoHeight`, `QueryEditor`, `JsonInputEditor`, `DataViewPanelJSON`  | untouched        |

**Visual acceptance is the real cost.** §2(a) means the migration _intends_ to change pixels on
themes that leave a shared-surface id unpublished. The pass covers Default Dark Modern, Default
Light Modern, Solarized Dark, a high-contrast kind, and one tinted community theme — the set the
Fluent neutral remapping was verified against — plus a same-kind switch to confirm (b) is fixed.

## 7. Explicitly out of scope

**Syntax token colours.** `rules` stays `[]`. Monaco's TextMate colours come from `vs`/`vs-dark`,
not from the user's theme, so a JSON string inside a Monaco editor is a different colour from the
same string in the user's real editor. VS Code publishes no TextMate colours as CSS variables, so
closing this means approximating from `--vscode-debugTokenExpression-*`, `--vscode-symbolIcon-*` and
`--vscode-charts-*`. That is a genuine unification improvement, but it is guesswork with its own
taste debate, and folding it in here would make the §6 visual pass unreadable. The `rules` option
leaves the door open; it earns its own increment on its own evidence.

**The `--documentdb-*` field aliases (0012).** `MonacoAutoHeight` styles its container from the
extension's copy of the field-stroke formula. That is the drift 0012 accepted knowingly, and it is a
separate conversation from Monaco's internal colours.

## 8. Work items

One commit each.

| #   | Item                                                                                                     | Commit      |
| --- | -------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | This plan                                                                                                | `2f96979c`  |
| 2   | Internal `vscode/` tier: theme kind, colour reader, hex normalisation, change store                      | `1bc75367`  |
| 3   | `./monaco` entry: colour-id list + generator script, theme derivation, hook, `exports` + `typesVersions` | `49591694`  |
| 4   | Migrate the extension consumer; delete both leave-behind files                                           | `bbbb9320`  |
| 5   | Docs: design.md, package README, feature README, decision 0032, CHANGELOG                                | this commit |

The colour-id list sits in `monaco/`, not `vscode/`, as the plan first had it: which ids matter is
Monaco's knowledge, while `vscode/` only knows how to read any id it is given. Keeping the two apart
is what lets a future non-Monaco consumer reuse the reader without inheriting Monaco's list.

### Found while building

Two things the plan did not anticipate, both recorded because they changed the design rather than
merely the code.

**Identity stability could not live in a ref.** The plan implied memoising the derived theme against
a ref holding the previous value. Mutating a ref during render is a React rule violation, caught by
`react-hooks/refs`. It moved into a module-level snapshot cache keyed by theme name, read through
`useSyncExternalStore`'s `getSnapshot` - which is strictly better anyway, because it also shares one
derivation across every editor in the webview rather than per hook instance.

**That cache exposed a gap in the store.** The observer disconnects when the last subscriber leaves,
so theme changes during that window went uncounted, and a later mount would have been served a stale
snapshot. The store now bumps its version when observation resumes after a gap.

**Review follow-up (2026-09-11):** the first subscription has the same unobserved window between
render and subscription. The review initially rated this P2, then downgraded it to **P3 / low
priority** with the operator: the race was reproduced with a layout effect, not in an actual
VS Code session, and its impact is stale editor colours rather than editing or data failures.
The operator requested the small robustness fix without treating it as a release blocker.
Observation now invalidates the snapshot on every start, including the first. A new hook test
failed before the fix and passed afterward. See decision 0032's review follow-up for the reasoning
and rejected alternatives.

## 9. Acceptance

- [x] `./monaco` type-checks against the real `monaco.editor.defineTheme` signature, asserted by a
      type-level test, with `monaco-editor` present only as a package `devDependency`.
- [x] The package's runtime `dependencies` and `peerDependencies` are unchanged.
- [x] Importing `./monaco` injects no stylesheet.
- [x] A same-kind theme switch re-derives the Monaco theme (defect b), asserted in jsdom.
- [x] Values that are not valid Monaco hex are dropped rather than passed through (defect c).
- [x] `npm run build` and the full Jest suite pass.
- [x] Visual acceptance pass per §6 - **operator-confirmed on 2026-09-11**, across several themes. No
      regression found, and the intended change in §2(a) - shared surfaces now agreeing where they
      previously did not - held up in the editor.

Increment 6 is complete.
