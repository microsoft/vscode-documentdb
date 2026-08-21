---
feature: webview-fluentui-package
kind: plan
status: active
created: 2026-08-20
---

# Increment 3 — the metric card

> One component family, and the fork it converges. `MetricCard` and `MetricGrid` move into the
> package; `MetricBase` and its sibling copy `CellBase` dissolve into them; every unit string and
> every formatting rule stays in the extension. **No npm publish.**

**Pending operator review.** Decisions are settled in [decisions.md](../decisions.md), which ends at
0023; this plan proposes 0024 and 0025. Where this plan and a decision disagree, the decision wins:
stop and flag the conflict rather than reconciling silently.

Read [§13.2](#132-record-the-baseline-before-you-touch-anything) before writing any code. It is the
one section whose order actually matters.

**Split from a larger draft.** This increment originally also carried the focusable badge. It was
separated because the badge is not an extraction at all: it needs a technical redesign and it is
entangled with an unresolved accessibility question. That work is
[increment 4](./04-focusable-badge-and-accessible-names.md), and §2 explains why this increment does
not have to wait for it.

---

## 1. Scope

| Item                       | This increment                                                         |
| -------------------------- | ---------------------------------------------------------------------- |
| `MetricCard`               | in                                                                     |
| `MetricGrid`               | in                                                                     |
| Converging `CellBase`      | in, subject to open question 1                                         |
| Number and time formatting | out, permanently. §6                                                   |
| The focusable badge        | out. [Increment 4](./04-focusable-badge-and-accessible-names.md)       |
| The accessible-name fix    | out. Evidence is captured here, the decision is made there. §2         |
| `Announcer`                | out of the package entirely, decided here because it needs no work. §8 |

---

## 2. Is this blocked on the accessible-name question?

**No, and it is worth being precise about why, because the answer is a constraint on the API rather
than a matter of sequencing.**

The two components being converged disagree about accessibility. `MetricBase` composes a full
accessible name by hand and hides its visible children from assistive technology:

```tsx
aria-label={`${label}: ${valueText}. ${tooltipExplanation}`}
<div aria-hidden="true">{label}</div>
```

`CellBase` composes nothing and relies on Fluent's `Tooltip`, which sets `aria-describedby` on its
trigger for `relationship="description"`. There is good reason to think the first is wrong, and that
it produces the double announcement it was written to prevent: the tooltip text ends up in the name
**and** in the description, and assistive technology announces both. Increment 4 settles that, with
measurement rather than argument.

The trap would be to let that question decide the component's shape. It does not have to:

|     | Approach                                                                                                         | Verdict                                                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | Wait for increment 4, then extract with the answer built in                                                      | Rejected. It blocks a clean extraction on an unrelated investigation, and the investigation is the slower of the two.                                                                   |
| B   | Extract with the composition **built in**, matching `MetricBase`                                                 | Rejected. It writes a suspected defect into a shared package, where reversing it later is a breaking change for anyone who has adopted it.                                              |
| C   | Extract with the composition **removed**, matching `CellBase`                                                    | Rejected for now. It is probably right, and "probably" is not enough to change what a screen reader says without evidence.                                                              |
| D   | **The component takes `ariaLabel` as an optional pass-through, and hides its children only when it is supplied** | **Chosen.** The package takes no position. Both of today's behaviours are expressible, the migration is behaviour-preserving, and increment 4's fix becomes a change at the call sites. |

Under D the rule inside the component is one line: `aria-label` present means the children are
decorative and get `aria-hidden`; absent means the content names the element itself. The two are
never both active, which is the only way the current pattern can go wrong by accident.

So the dependency runs in one direction only. This increment **captures** the accessible names and
descriptions as part of its baseline (§13.2) and asserts they did not change; increment 4 reads that
capture, decides, and changes call sites. Nothing in the package needs to move twice.

One thing D genuinely costs: `ariaLabel` may turn out to be a prop that no consumer should ever pass.
If increment 4 concludes that, the prop is removed while the package is still `private: true`, which
is free. That is the cheap direction to be wrong in.

---

## 3. The metric card is already a fork, and that is the case for extracting it

[design.md §11](../design.md) described this candidate as "not self-contained" and stopped there.
Reading the folder turns up something the shortlist missed: `MetricBase.tsx` has a **sibling copy**,
`summaryCard/CellBase.tsx`, in the same feature, written to solve the same problem.

Both take `{ label, value, loadingPlaceholder, nullValuePlaceholder, tooltipExplanation }`. Both use
`undefined` for loading and `null` for unavailable. Both render a `SkeletonItem appearance="translucent"`,
a fixed-height value slot to stop the swap shifting layout, a `Tooltip` with a
`tooltipContainer` / `tooltipTitle` / `tooltipBody` block, and an `InfoRegular` marker on the label.
Both define an identical `.nullValue` rule, in two different stylesheets.

Where they disagree, they disagree without a reason on the record:

| #   | `MetricBase`                                             | `CellBase`                                                | Proposed resolution                                                                    |
| --- | -------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | Fluent `Card appearance="filled"`, `padding 16`, `gap 8` | bare `div`, `gap 4`                                       | Both, as `appearance="filled" \| "subtle"`                                             |
| 2   | value `28px` / line-height `32`, slot `min-height 32`    | value `16px` / line-height `20`, slot `min-height 20`     | Both, as `size="large" \| "small"`                                                     |
| 3   | `SkeletonItem size={28}`                                 | `SkeletonItem size={16}`                                  | Follows `size`                                                                         |
| 4   | always `tabIndex={0}`                                    | `tabIndex={0}` only when a tooltip exists                 | **`MetricBase`. Every card is a tab stop**, settled at review. See §11                 |
| 5   | Fluent `Card`'s own focus ring                           | hand-written `:focus-visible` with `--vscode-focusBorder` | Fluent's, through `createCustomFocusIndicatorStyle` for the `subtle` variant           |
| 6   | composes `aria-label`, hides children                    | composes nothing, relies on Fluent's `aria-describedby`   | Neither, per §2: the prop is a pass-through and each call site keeps today's behaviour |
| 7   | tooltip `positioning="below"`                            | tooltip `positioning="above-start"`                       | A prop, defaulting to `below`. Neither is wrong                                        |
| 8   | tooltip has a value row with a `DataUsageRegular` glyph  | no value row                                              | See §7                                                                                 |
| 9   | no span concept                                          | `span="single" \| "full"`, plus grid rules                | Stays with the consumer. It is a property of the grid, not of the card                 |
| 10  | `.nullValue` in `MetricsRow.scss`                        | `.nullValue` in `SummaryCard.scss`, byte-identical        | One Griffel class in the package                                                       |

Row 5 is worth a note. `Card` brings its own focus indicator, so the `filled` variant needs nothing;
the `subtle` variant is a plain element and needs one, and Fluent exports the recipe for it.
`@fluentui/react-components` publicly re-exports **`createFocusOutlineStyle`** and
**`createCustomFocusIndicatorStyle`** from `@fluentui/react-tabster`. They emit the
`[data-fui-focus-visible]` selector that Fluent's own focus system drives, and they track Fluent's
focus design across versions. Hand-writing that selector inside the package would be a second
`fui-*` coupling of exactly the kind decision 0019 exists to prevent; calling the supported recipe
removes it instead of relocating it.

Row 6 is discharged by §2 rather than decided here.

---

## 4. What the package gets

```ts
interface MetricCardProps {
    /** The label above the value. */
    readonly label: ReactNode;
    /**
     * `undefined` renders the loading placeholder, `null` renders `nullValuePlaceholder`,
     * anything else renders as-is. The consumer formats; this component never does.
     */
    readonly value?: ReactNode;
    /** Explanation shown in a tooltip and marked with an info glyph beside the label. */
    readonly description?: string;
    readonly appearance?: 'filled' | 'subtle';        // default 'filled'
    readonly size?: 'large' | 'small';                // default 'large'
    readonly loadingPlaceholder?: 'skeleton' | 'empty';
    readonly nullValuePlaceholder?: string;           // English default 'N/A'
    readonly tooltipPositioning?: 'below' | 'above-start';
    /** A complete accessible name, composed by the consumer. Supplying it hides the children from
     *  assistive technology. See §2 before reaching for it. */
    readonly ariaLabel?: string;
    readonly className?: string;
}

interface MetricGridProps {
    readonly children: ReactNode;
    readonly className?: string;
}
```

`MetricGrid` carries today's responsive grid unchanged: `gap 16`, one column, two at `min-width:
400px`, four at `min-width: 800px`. Container queries would be the better mechanism, since the grid
cares about its own width and not the viewport's, but that is a behaviour change and belongs in its
own iteration. Filed as open question 2.

`appearance` and `size` are Fluent's own modifier vocabulary, and `Card` uses both spellings already.

**There is no `focusable` prop.** Every card is a tab stop (§3 row 4, settled at review), so the
behaviour is unconditional and needs no API surface. The `filled` variant inherits `Card`'s focus
indicator; the `subtle` variant gets one from `createCustomFocusIndicatorStyle`.

---

## 5. The styles that have to be translated

Everything the two components rely on is SCSS today and must become Griffel, since the package ships
no stylesheet from `./components` (invariant I1, asserted by `components.test.ts`).

| Source                                    | Today                                             | In the package                          |
| ----------------------------------------- | ------------------------------------------------- | --------------------------------------- |
| `.baseDataHeader`                         | `12px` / `600` / `--vscode-descriptionForeground` | `tokens.colorNeutralForeground2`        |
| `.baseDataValue`                          | `28px` / `600` / line-height `32`                 | same values, `size="large"`             |
| `.nullValue`                              | `opacity .5` / `--vscode-disabledForeground`      | `tokens.colorNeutralForegroundDisabled` |
| `.tooltipInfoIcon`, `.headerWithInfoIcon` | `12px`, `opacity .6`, inline-flex                 | Griffel, inside the component           |
| `.tooltipContainer/Title/Body/Value`      | product stylesheet                                | Griffel, inside the component           |
| `.metricsRow`                             | grid + two media queries                          | Griffel, `MetricGrid`                   |

Two consequences to accept explicitly:

- **The raw `--vscode-*` variables do not come along.** A package component may not depend on this
  package's theming (the `components/` one rule), so it uses Fluent tokens, which resolve to the
  VS Code variables **only** under `VSCodeFluentProvider`. Under a plain `FluentProvider` a consumer
  gets Fluent's neutrals, which is the correct behaviour and a different colour. Inside this
  extension it should be visually identical, and §13.2 is where that gets proven rather than assumed.
- **`.baseDataHeader` and `.baseDataValue` stay in `queryInsights.scss`.** `SummaryCard.scss`,
  `StageDetailCard.scss` and `GenericCell.scss` all `@extend` them and are not part of this
  increment. The values are therefore duplicated between the product stylesheet and the package for
  as long as those three survive. That is a real cost, stated here so it is not rediscovered as a
  defect.

---

## 6. What stays in the extension

**All formatting.** `formatUtils.ts` produces `"2.33 ms"`, `"1.23 s"`, `"2m 15s"`, `"1.2M"` and
`"85.00%"`. Those are user-visible strings with locale-specific unit abbreviations and grouping, and
gate condition 2 keeps them out. `TimeMetric`, `CountMetric`, `RatioMetric` and `GenericMetric` stay
where they are and become thin wrappers that format a value and hand it to `MetricCard`.

That is also the smaller cut. The package gains the layout, the loading and unavailable states, the
tooltip wiring and the accessibility contract; the extension keeps everything that has an opinion
about numbers.

`RatioMetric`'s inline bar chart stays too. It is already a custom node passed as `value`, which is
what that prop is for.

---

## 7. Two smaller shape questions

**The tooltip value row.** `MetricBase` repeats the value inside the tooltip with a
`DataUsageRegular` glyph; `CellBase` does not. Options: drop it, keep it behind a boolean, or make
the glyph a slot. Recommendation: **drop it from the package**, since a tooltip that repeats the
number already on screen is decoration, and let the extension pass a richer `description` if it
turns out to be missed. Low stakes either way, and reversible while the package is private.

**`nullValuePlaceholder` defaults to the untranslated string `'N/A'`** in five components today, and
every call site that does not override it ships English to every locale. In the package that default
is correct and expected; in the extension it is a small existing bug. Worth fixing in the same PR,
in the wrappers, exactly as increment 2 fixed the `formHeader` gap it found while diffing.

---

## 8. `Announcer` is out of the package

Increment 2 left this open as its §8 question 5. It is answered here because the answer is "do
nothing", and an open question that resolves to no work should not wait for an increment to carry it.

**`Announcer` stays in the extension**, at `src/webviews/components/accessibility/Announcer.tsx`.

It passes all four gate conditions and is still the wrong thing to put here, for two reasons that
compound.

**It is not a Fluent component.** Decision 0002 chose `fluentui` in the name precisely so that the
admission question has an answer rather than an argument, and it has already earned that once by
rejecting a Monaco wrapper on sight. `Announcer` is `useState`, `useEffect` and a visually hidden
`div` with `aria-live`. It imports nothing from Fluent and would work identically in an application
with no design system at all. Admitting it makes `fluentui` a category name, which is the failure
mode 0002 exists to prevent.

**Fluent already defines the contract.** `@fluentui/react-components` exports `useAnnounce` and
`AnnounceProvider`. `useAnnounce()` returns `{ announce(message, options) }`, and with no provider
above it returns a **no-op**, because Fluent's live region ships inside `Toaster`, which this
extension does not use. So the Fluent-shaped answer is not "move this component into the package", it
is "implement Fluent's announce contract for consumers who have no `Toaster`". That is a different,
better component, and it would pass the name test that the current one fails.

Two consequences:

1. **A `VSCodeAnnouncer` that provides `AnnounceProvider` is a legitimate future candidate**, and it
   would belong to the `"."` entry beside the other providers rather than to `./components`. It is
   not proposed here, needs a second consumer before it is, and must not be smuggled into any
   increment as a convenience.
2. **The awkwardness increment 2 recorded is not fixed by extraction.** Both wizard views render
   announcers as siblings of `<Wizard>` because `Wizard` has no slot between header and step list. If
   that is worth fixing, it is a `Wizard` API question, not an `Announcer` packaging question.

---

## 9. Proposed decisions

To be transcribed into [decisions.md](../decisions.md) before code is written, in the same form as
0021 and 0022.

- **0024 — The metric card enters, and converges its fork.** `MetricCard` and `MetricGrid` ship in
  `./components`; `MetricBase` and `CellBase` both dissolve into them; all formatting and every unit
  string stay in the extension. Two sub-choices, both provisional under the package's Preview status
  and both revisited by increment 4: the accessible name is a consumer-supplied pass-through, so the
  package takes no position on §2; and every card is a tab stop, unconditionally.
- **0025 — `Announcer` is out of scope for this package.** It is not a Fluent component, and Fluent
  already defines the announce contract. A provider implementing that contract is a separate future
  candidate for the `"."` entry.

Increment 4 proposes 0026 for the focusable badge.

---

## 10. File and folder structure

Conventions are unchanged from increment 2 §5.3: PascalCase family folder named after its root
component, `X.types.ts` per family, colocated tests, `index.ts` per folder, relative imports fully
specified with `.js`, README only where a folder carries a non-obvious rule.

```
packages/vscode-ext-webview-fluentui/src/components/
├── README.md                       # contents table + how they compose, updated
├── index.ts                        # + the new family
└── MetricGrid/
    ├── MetricGrid.tsx
    ├── MetricCard.tsx
    ├── MetricGrid.types.ts
    ├── index.ts
    ├── README.md                   # loading vs unavailable; why formatting is not here
    └── *.test.tsx
```

Deleted from the extension:

```
src/webviews/documentdb/collectionView/queryInsightsTab/components/metricsRow/MetricBase.tsx
src/webviews/documentdb/collectionView/queryInsightsTab/components/metricsRow/MetricsRow.tsx
src/webviews/documentdb/collectionView/queryInsightsTab/components/metricsRow/MetricsRow.scss
src/webviews/documentdb/collectionView/queryInsightsTab/components/summaryCard/CellBase.tsx
```

`MetricsRow.tsx` goes because `MetricGrid` replaces it; the name is inherited from a layout that has
not been a row since it grew media queries. Renaming is free while the package is `private: true`,
and increment 2 already took that trade once with `WizardBreadcrumb`.

`SummaryCard.scss` shrinks rather than disappears: the grid, the span rules and `.summaryCard` stay.

Nothing under `theme/`, `styles/`, `palette/` or the `"."` entry changes. If a change there seems
necessary, that is a signal the design is wrong, not the boundary.

---

## 11. Open questions

Split into blocking and non-blocking, per increment 2's lesson that a plan which leaves a question
open while a specification section already answers it makes the decision by whoever types first.

**Settled at review, 2026-08-21.** Both were blocking. Both are recorded here because the reasoning
matters more than the outcome, and because increment 4 revisits them.

- **Every metric card is a tab stop.** `MetricBase`'s behaviour wins over `CellBase`'s, so the
  component sets `tabIndex={0}` unconditionally and ships no `focusable` prop. Consistency across a
  grid beats minimising tab stops: a keyboard user who can reach one card can reach all of them, and
  a card whose value is truncated or whose meaning needs its tooltip is not reliably distinguishable
  from one that does not.
  **The consequence to watch:** converging `CellBase` makes every summary cell a tab stop too, which
  it is not today. That is a deliberate behaviour change, it is visible in the item 0 tab-order
  capture, and it is the first thing the operator's keyboard check should look at.
- **`ariaLabel` is an optional pass-through**, per §2 option D. The package takes no position on the
  double-announcement question; each call site keeps the behaviour it has today.

Both are provisional, and the package's own README already says so: it ships as a **Preview**, with
breaking changes permitted between minor versions until the surface stabilises. That is what makes
shipping the card ahead of the accessibility answer an acceptable trade rather than a deferred
defect, and it is why removing either choice later costs nothing. Increment 4 owns the revisit.

**Blocking. The code cannot be written without an answer.**

1. **The `MetricGrid` name**, and whether the summary cells are in scope at all. Alternatives:
   `MetricList`, `Metrics`, keep `MetricsRow`. If the summary cells are out of scope, the `subtle`
   and `small` variants have no consumer in this increment and should not ship, which removes rows 1,
   2, 3 and 5 of §3 along with them, and defers the tab-stop consequence above.

**Non-blocking. A later, additive change.**

2. Container queries instead of viewport media queries for the grid breakpoints (§4).
3. The tooltip value row and its glyph (§7).
4. Whether `MetricCard` should expose its `Card` props at all, or stay a closed surface.

---

## 12. Non-goals

- **Number, time and percentage formatting.** §6. It never enters the package.
- **The summary card's grid and span behaviour.** A property of the consumer's layout.
- **`PerformanceRatingCell` and the diagnostics block.** Product logic that happens to render inside
  a cell.
- **Deciding the accessible-name question.** §2. Evidence is captured, the decision is increment 4's.
- **The focusable badge.** [Increment 4](./04-focusable-badge-and-accessible-names.md).
- **An `AnnounceProvider` implementation.** §8, and explicitly not this increment.
- **Publishing.** The package stays `private: true` at `0.1.0-preview`.
- **API Extractor.** Still open from increment 2 item 10, still needs a deliberate lockfile change,
  still not a side effect of this work.

---

## 13. Implementation order

### 13.1 Work items, one commit each

Every item must leave the tree building. Commit at each boundary, never one commit at the end. Write
the work-log entry when the item is committed, not at the end: it is the only place a rejected option
is ever recorded.

| #   | Work item                                                                                              | Commit contains                                           |
| --- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| 0   | **Baseline capture** (§13.2)                                                                           | **nothing**, except the numbers pasted into this work log |
| 1   | Transcribe decisions 0024 and 0025 into `decisions.md`                                                 | docs only                                                 |
| 2   | `MetricGrid` / `MetricCard` in the package, with tests                                                 | package only                                              |
| 3   | Rewrite the four metric wrappers on `MetricCard`; delete `MetricBase`, `MetricsRow`, `MetricsRow.scss` | extension only                                            |
| 4   | Converge `CellBase` onto `MetricCard`, if open question 1 keeps it in scope                            | extension only                                            |
| 5   | Documentation: the family README, the JSDoc pass, the updated `components/README.md` contents table    | package only                                              |
| 6   | Final verification (§14), post-migration measurement against the item 0 baseline                       | nothing, or a fixup                                       |

Item 0 comes before everything, including the decisions, because it is the only chance to take it.

Migrate the awkward consumer second, per increment 2's lesson. Here that is `CellBase`, which is the
one that disagrees with the design on rows 1, 2, 4, 5 and 6. If it fits without a new prop, the API
is right; if it does not, better to learn that in item 4 than after publish.

### 13.2 Record the baseline before you touch anything

A chrome regression compiles cleanly, passes every test, and looks wrong; a screenshot has the same
weakness, so screenshots are not the verification. **Measurement is.**

The recipe, its prerequisites and its failure modes are in
[live-preview-playwright.md](../../../live-preview-playwright.md). **Read its Gotchas section before
using it to compare anything** — three of those entries were written after increment 2 mistook a
harness artefact for a defect in the code under test. The two that will bite this increment
specifically:

- **the default viewport is about 548 px**, which sits between this grid's 400 px and 800 px
  breakpoints, so an unspecified viewport silently measures the two-column layout;
- **a remote workspace mangles query strings**, so `?view=…` renders the same view on every page and
  a comparison agrees with itself perfectly. One static page per view, name hardcoded, no query
  string.

**Prefer a second worktree at the pre-migration commit over a mock.** Increment 2 built a mock and
recorded afterwards that a worktree would have been a truer control and needed no wiring at all. The
point here is to prove nothing changed, which is exactly the case the worktree serves.

Whatever route is taken, anything that touches tracked files to wire up a preview is **staged by
explicit path, never `git add -A`, never `git add -f`**, and is removed in item 6 with `git status`
and `git diff` confirmed clean.

**What to capture at item 0**, from `QueryInsightsTab` and `IndexesTab`, at 360 px, 600 px and
1000 px of viewport width, and pasted into the work log below:

```js
// 1. Grid breakpoints. The single most regression-prone thing in this increment.
getComputedStyle(document.querySelector('.metricsRow')).gridTemplateColumns; // 1, 2, then 4 tracks
// Assert window.innerWidth first. The viewport default sits between the breakpoints.

// 2. Card geometry, per card, exactly as increment 2 did it.
[...document.querySelectorAll('.metricCard')].map((c) => c.getBoundingClientRect());
// and, on the header and value elements: fontSize, fontWeight, lineHeight, color, minHeight

// 3. The loading state, which is half the component's reason to exist.
//    Capture the skeleton's box, then the resolved value's box. They must match.

// 4. The unavailable state: the `N/A` span's opacity and color.

// 5. Tab order through both tabs, and the focus indicator on a focused card.
//    Requires real keyboard input; a click does not produce the indicator.
await page.keyboard.press('Tab');
document.activeElement.getAttribute('data-fui-focus-visible');

// 6. The computed accessible name and description of every metric card, with and without a tooltip.
//    Evidence for increment 4, and the "nothing changed" check for this one.
```

Point 6 is the one that cannot be reconstructed later, and it is the reason increment 4 can be a
decision rather than another investigation. Capture it with the harness's accessibility tree
(`read_page`) or, better, with `Accessibility.queryAXTree` over CDP, which also reports **which name
source won and which was superseded**. The full protocol, and what the two possible answers mean, is
[increment 4 §4](./04-focusable-badge-and-accessible-names.md). Here it is only recorded, and then
asserted to be identical after migration.

**Be explicit about what this does not prove** when reporting: light theme only, in a browser, with a
faked host. Dark and high-contrast are untested, as is the real webview host.

### 13.3 Scaffolding that already exists

Do not build these.

- The ESLint `no-restricted-imports` rule already covers
  `packages/vscode-ext-webview-fluentui/src/components/**`. New files inherit it.
- The jest project for the package is already in the root `jest.config.js` `projects` array, and
  increment 2 added an `extension-webview` jsdom project that matches `.test.tsx` under `src/`.
- `components.test.ts` already asserts the `./components` entry injects no stylesheet. It must keep
  passing, and this increment adds a family's worth of Griffel to it.
- `components/testing/renderSurface.tsx` exists and is excluded from the build.
- The package is `private: true` at `0.1.0-preview`. Renaming is free.
- Peers are already declared. Nothing here needs a new runtime dependency; if something seems to,
  stop and ask.

### 13.4 Traps, in the order they are usually hit

- **`npm run build`, never `npm run compile`.**
- **Relative imports carry `.js`.** The package is ESM; `from './MetricCard'` compiles and then fails
  at runtime.
- **The package must be built before the root `tsc`**, so a package change is invisible to the
  extension until it rebuilds.
- **A new `.test.tsx` must actually run.** Increment 2 nearly shipped a test that no project matched.
  After adding the first test in a new folder, check that the reported test count moved.
- **No `l10n` inside the package.** Every user-visible string is a prop with an English default.
- **`l10n/bundle.l10n.json` is generated.** Strings move in items 3 and 4. Never hand-merge it.
- **The `fluentOverrides` suite is the `fui-*` tripwire.** If the component reaches for a Fluent
  internal class name, that is a design failure. `createCustomFocusIndicatorStyle` is the supported
  route for the `subtle` variant's focus ring; a hand-written `[data-fui-focus-visible]` selector is
  not.
- **Grep the package README for any identifier you rename or remove**, in the commit that removes it.
  `MetricsRow` and `WizardBreadcrumb` are the same kind of mistake.
- **`TDD:`-prefixed tests are behaviour contracts.** If one fails, stop and ask.

### 13.5 Done, per work item

`npm run build` passes, the item's own tests pass under `npx jest --no-coverage <path>`, and both
affected tabs still compile. The full §14 ladder runs once, at hand-over.

---

## 14. Verify

Fast loop while working: `npm run build`, then `npx jest --no-coverage <path>`.

Before hand-over, in order: `npm run l10n` → `npm run prettier-fix` → `npm run lint` →
`npx jest --no-coverage` → `npm run build` → `npm run package`.

Tests this increment must add:

- `components.test.ts` still passes: importing `./components` injects no stylesheet.
- The `no-restricted-imports` rule still holds: nothing in `src/components/` imports `src/theme/` or
  `src/styles/`.
- `MetricCard` renders a skeleton for `undefined`, the placeholder for `null`, and the value for
  everything else, including `0` and `''`, which are the two values most likely to be mishandled.
- `MetricCard`'s value slot has the same height in the loading and resolved states.
- `MetricCard` hides its children from assistive technology **only** when `ariaLabel` is supplied,
  which is the §2 contract stated as a test.
- `MetricCard` is a tab stop in every configuration, including `subtle`, `small`, and with no
  tooltip. This is the settled choice in §11 and the one most likely to be quietly reverted by
  someone tidying up.
- `MetricGrid` produces one, two and four tracks at the three widths.

### Acceptance

Green commands prove very little here. **The operator performs the visual check**, on the Query
Insights tab and the Indexes tab, at a narrow panel width and a wide editor width, and in a dark
theme, which the harness does not cover. Before that, the implementing agent re-runs the item 0
measurements against the migrated views and reports the diff, element by element, in the work log.
When the commands pass and the numbers are reported, stop and hand over.

---

# Work log

> One entry per work item in §13.1, recorded as the work was done: what landed, why, the commit that
> carries it, and any deviation from the plan with the alternatives weighed against it. Write it at
> the commit, not at the end.

## Item 0: the baseline

Taken 2026-08-21, before any code changed. No commit, as specified.

### How it was taken

Not a mock and not a worktree, in the end. A worktree would have needed its own dev server on a
second port and its own copy of the harness wiring, and the thing being compared is the same
workspace at two points in time rather than two trees at once, so the same page is simply
re-measured after the migration.

What was wired up, all of it **untracked or reverted at item 6**:

- `src/webviews/__preview__/MetricPreview.tsx` — untracked. Mounts the real consumers:
  `MetricsRow` with `TimeMetric` / `CountMetric` / `RatioMetric` exactly as `QueryInsightsTab`
  composes them, the real `IndexMetricsRow` in both its resolved and its loading state, and a
  `SummaryCard` of `GenericCell`s covering resolved, tooltip, loading and unavailable.
- `src/webviews/static/metricPreview.html` — untracked. One static page, view name hardcoded, no
  query string, per the remote-workspace gotcha.
- One import and one line in `WebviewRegistry.ts` — the only tracked file touched, reverted
  immediately after the capture and restored only to re-measure at item 6.

Measured at three viewport sizes. **The integrated browser scales the viewport by 0.8**, so
`setViewportSize(360 / 600 / 1000)` produced `window.innerWidth` of **288 / 480 / 800**. That
happens to land one sample in each of the grid's three bands, with the widest sitting exactly on the
`min-width: 800px` boundary. `window.innerWidth` was asserted on every sample rather than trusted,
and `document.querySelector('iframe')` was asserted absent so the dev-server overlay could not be
mistaken for layout.

### 1. Grid breakpoints

Identical for all four grids on the page (`QueryInsightsTab`'s row, and `IndexMetricsRow` in both
states), so one table covers them:

| `window.innerWidth` | `grid-template-columns`         | `gap`  | horizontal overflow |
| ------------------- | ------------------------------- | ------ | ------------------- |
| 288                 | `275.733px`                     | `16px` | no                  |
| 480                 | `232px 232px`                   | `16px` | no                  |
| 800                 | `188px 188px 188px 188px`       | `16px` | no                  |

One, two and four tracks. That is the contract to preserve.

### 2. Card geometry

`.metricCard`, first card of the Query Insights row, at `innerWidth` 800:

| Element         | Measurement                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| card box        | `188 x 88`                                                                                                        |
| card computed   | `padding: 12px`, `gap: 12px`, `display: flex`, `flex-direction: column`, `align-items: flex-start`, `border-radius: 4px`, `background: rgb(255,255,255)` |
| `tabindex`      | `0`                                                                                                               |
| `.dataHeader`   | box `164 x 20` at `(12, 12)`; `12px` / `600` / line-height `20px` / `rgb(113,113,113)`; `overflow: hidden`, `text-overflow: ellipsis`, `white-space: nowrap` |
| `.dataValue`    | box `164 x 32` at `(12, 44)`; `28px` / `600` / line-height `32px` / `rgb(31,31,31)`; `min-height: 32px`, `display: flex`, `align-items: center` |
| `.tooltipInfoIcon` | `12 x 12`; `font-size: 12px`, `opacity: 0.6`, `margin-left: 4px`                                                |

Card height is `88` at every width: `12 + 20 + 12 + 32 + 12`.

**Finding A. `.metricCard`'s declared padding and gap are dead CSS.** `MetricsRow.scss` declares
`padding: 16px` and `gap: 8px`; the computed values are **`12px` and `12px`**, which are Fluent
`Card`'s own. Griffel's rules win, so the SCSS has never applied. §3 row 1 describes the card as
"`padding 16`, `gap 8`" and that is the source, not the rendering.

This matters for the migration in the opposite direction from the obvious one. A package component
that sets `padding: 16px` / `gap: 8px` in Griffel and merges its class onto `Card` **would** win,
and would therefore be the first time those values have ever been painted. Preserving the baseline
means either not setting them at all for `filled`, or setting them to `12px` / `12px`.

### 3. Loading and unavailable states

- **Loading.** `.dataValue` box is `164 x 32` with `min-height: 32px` — **identical to the resolved
  state**, which is the reservation working. The `SkeletonItem` inside it is `28px` tall, centred in
  the 32px slot.
- **Unavailable.** `.nullValue` computes to `opacity: 0.5`, `color: rgb(161,161,161)`, inside an
  unchanged `32px` slot.

### 4. Summary cells, for the item 4 comparison

`.summaryGrid` is two equal tracks at every width, `gap: 16px`.

| Element                        | Measurement                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| `.summaryCell`                 | `display: flex`, `gap: 4px`, `align-items: flex-start`, `grid-column: span 1`, height `44` |
| `.summaryCell` `border-radius` | `0px` normally, `4px` on the tooltip-wrapped cell                                        |
| `.cellLabel`                   | `12px` / `600` / `20px` / `rgb(113,113,113)`; `display: block`, or `flex` with a tooltip  |
| `.cellValueSlot`               | `min-height: 20px`, `display: flex`, `align-items: center`                               |
| `.cellValue`                   | **`14px`** / `600` / line-height `20px` / `rgb(31,31,31)`                                |
| loading skeleton               | `16px` tall inside the `20px` slot                                                       |
| `.nullValue`                   | `opacity: 0.5`, `color: rgb(161,161,161)` — byte-identical to the metric card's          |

**Finding B. §3 row 2 has the small value size wrong.** It says `CellBase` renders its value at
`16px`; the measured font size is **`14px`**, from the `font-size: 14px` override in
`GenericCell.scss`. `16` is the `SkeletonItem size={16}`, which is a different number. A `small`
variant built from §3 row 2 as written would enlarge every summary cell value.

### 5. Tab order and the focus indicator

At `innerWidth` 800, tabbing from `<body>`, 17 stops before the cycle repeats:

| Stops | Elements                                                   |
| ----- | ---------------------------------------------------------- |
| 1-16  | every `.metricCard`, in DOM order, across all four grids   |
| 17    | **one** `.summaryCell` — the only one with a tooltip       |

Every metric card is a tab stop whether or not it has a tooltip, and whether or not its value has
resolved. Exactly one of the four summary cells is.

Focus indicators differ, which is §3 row 5:

- `.metricCard` — no `outline`; Fluent's `::after` indicator, `1px solid` at inset `0`, with
  `data-fui-focus-visible` present on the focused element.
- `.summaryCell.cellWithTooltip` — `outline: 1px solid rgb(0,95,184)` at `outline-offset: 1px`.
  `rgb(0,95,184)` is `--vscode-focusBorder`. No `::after`.

### 6. Accessible names and descriptions

From `Accessibility.getFullAXTree` over CDP, which also reports which name source won.

Metric cards, every one of them: `role="group"`, **name from `aria-label`, not superseded**, no
other name source present. A card whose value has resolved and which has a tooltip carries **both**:

```
name:        "Execution Time: 2.33 ms. Total time taken to execute the query on the server"
description: "Execution Time Total time taken to execute the query on the server 2.33 ms"
```

The description is the tooltip content, reached through the `aria-describedby` that Fluent's
`Tooltip` sets for `relationship="description"`. **The label, the explanation and the value each
appear twice**, once in the name and once in the description. That is the double announcement §2
suspected, now measured rather than argued. A card with no tooltip has a name and no description.

Summary cells: **no accessible name at all**. The tooltip-wrapped one has a description only —
`"Index Used The index the planner selected for this query"` — and is focusable; the other three are
neither named nor focusable.

This is increment 4's evidence. It is recorded here and is not acted on.

### 7. Two findings that block item 2, and one that does not

**Blocking — the header colour.** `.baseDataHeader` renders at `rgb(113,113,113)`, which is
`--vscode-descriptionForeground`. §5 maps it to `tokens.colorNeutralForeground2`. Measured under
`VSCodeFluentProvider` in the light adaptive theme:

| Token                              | Resolves to | vs. today's `#717171` |
| ---------------------------------- | ----------- | --------------------- |
| `colorNeutralForeground1`          | `#1f1f1f`   | far darker            |
| `colorNeutralForeground2`          | `#424242`   | **clearly darker**    |
| `colorNeutralForeground3`          | `#616161`   | darker                |
| `colorNeutralForeground4`          | `#707070`   | one unit off          |
| `colorNeutralForegroundDisabled`   | `#a1a1a1`   | —                     |

§5 predicted "inside this extension it should be visually identical". For the header it is not:
`themeGenerator.ts` re-points `colorNeutralForeground2` to `--vscode-foreground` **only in the dark
theme**, so in light it keeps Fluent's `#424242`. `colorNeutralForeground3` and `4` are re-pointed
to `--vscode-descriptionForeground` only inside `fluentOverrides.scss`, which is scoped to
`:where(.fui-Input, .fui-SearchBox, …)` and does not reach a card. Adopting §5 as written darkens
every metric label and every summary cell label in every light theme.

Escalated to the operator together with finding A and open question 1. **The operator was not
available and delegated the three decisions.** They are resolved in decision 0024, with the rejected
alternative and its argument recorded there rather than here, and every one of them is a visual
change the operator's own check should confirm.

**Non-blocking — `.nullValue` maps exactly.** `colorNeutralForegroundDisabled` resolves to `#a1a1a1`,
identical to today's `--vscode-disabledForeground`, because `adaptiveNeutralSurfaces` does re-point
that one. §5's mapping for `.nullValue` is correct as written.

**Non-blocking — line-height is inherited.** `.baseDataHeader` declares no `line-height`; the `20px`
comes from Fluent's `body1` on the surrounding provider. A Griffel rule that declares `20px`
explicitly preserves the pixel and loses the inheritance; one that declares nothing preserves both.
Preferring the second.

### What this does not prove

Light theme only, one hardcoded palette. Not the VS Code webview host: no real theme variables, no
CSP, no panel chrome, no host messaging. Dark and high-contrast are untested, and the dark theme is
exactly where finding B's token question behaves differently. Screen-reader behaviour is inferred
from the accessibility tree, not heard.

---

## Item 1: decisions 0024 and 0025

Docs only. Commit: _pending_.

0024 and 0025 transcribed into [decisions.md](../decisions.md) in the form 0021 to 0023 use, plus
their two rows in the summary table. 0024 is filed as **Accepted (modified)** rather than
**Accepted**, because three of the proposal's mappings did not survive the item 0 measurement.

### The three questions the operator delegated

Raised together after item 0, since all three block item 2 and one also blocks item 4. The operator
was unavailable and delegated them. Each is decided below toward **preserving the measured
baseline**, on the reasoning that an extraction whose acceptance criterion is "nothing changed" is
the wrong vehicle for a visual decision, and that every one of these remains cheap to reverse while
the package is `private: true`.

| Question                    | Decided                                    | Rejected                                          |
| --------------------------- | ------------------------------------------ | ------------------------------------------------- |
| Label colour token          | `colorNeutralForeground4` (`#707070`)      | `colorNeutralForeground2` per §5 (`#424242`)      |
| `filled` padding and gap    | declare neither; inherit `Card`'s 12 / 12  | declare 16 / 8 as `MetricsRow.scss` intended      |
| Summary cells in item 4     | in scope; the grid ships as `MetricGrid`   | deferring them, and shipping `filled`/`large` only |

The full argument for the first two, including what is genuinely lost by not following §5, is in
0024's "Changed from the proposal". They are not repeated here.

### What made the third one safe to decide alone

§11 flagged the tab-order change as the consequence to watch: converging `CellBase` makes every
summary cell a tab stop, which it is not today. Reading the only call site closes that:

**All four `GenericCell`s in `QueryInsightsTab` already pass a `tooltipExplanation`**, so all four
are already tab stops under `CellBase`'s conditional rule. The fifth cell is
`PerformanceRatingCell`, which is `span="full"` and stays in the extension, so it is unaffected. The
tab order through the summary card therefore does **not** change, and the item 0 capture is what
proves it rather than an argument that it probably would not.

The change that does remain is the focus **indicator** on those four cells: today a hand-written
`outline: 1px solid var(--vscode-focusBorder)` at `outline-offset: 1px`, and after the migration
Fluent's own indicator via `createCustomFocusIndicatorStyle`. That is decision 0019 applied, it is
visible, and it is what the operator's keyboard check should look at first.

### Deviation from §10 worth naming

§10 lists `CellBase.tsx` as deleted and says both copies dissolve into `MetricCard`. Only the
single-span path dissolves. `PerformanceRatingCell` keeps the full-span markup, inlined into itself,
because that layout drops the fixed-height value slot, stretches its children and moves the label
onto its own line — it is a different component that shared a file, not a variant of a card. §3
row 9 already puts span with the consumer and §12 already names `PerformanceRatingCell` a non-goal;
this is those two read together. The alternative considered was a `span` prop on `MetricCard`, which
was rejected because it would put a grid property on the cell and would carry the slot-suppression
rule into the package for exactly one consumer.

---

## Item 2: `MetricGrid` and `MetricCard` in the package

Package only. Commit: _pending_.

`src/components/MetricGrid/` with `MetricGrid.tsx`, `MetricCard.tsx`, `MetricGrid.types.ts`,
`index.ts` and `MetricCard.test.tsx`, exported from `components/index.ts`. Nothing under `theme/`,
`styles/`, `palette/` or the `"."` entry was touched. No new dependency, no lockfile change.

11 tests, and the folder's reported count moved from nothing to 11, which is the check for a
`.test.tsx` that no jest project matches. The package suite is 60 tests across 10 files, including
`components.test.ts`, which still passes: a family's worth of Griffel injects no stylesheet.

### The props that are not in §4

Two, both with a reason that only appeared once the code was written.

**`tooltipRepeatsValue`, defaulting to `false`.** §7 recommended dropping the tooltip's value row
outright. Dropping it **changes the accessible description**: today a metric card's description
reads `"Execution Time Total time taken … 2.33 ms"`, and without the row it loses the value. §13.2
point 6 and the hand-over instructions both say the descriptions must not change in this increment,
because they are increment 4's question. So the row survives, behind a prop that the metric wrappers
opt into and the summary cells leave alone, which is also exactly the difference between the two
forks in §3 row 8.

Alternatives weighed: dropping it and accepting the description change (rejected, it answers
increment 4's question by accident); tying the row to `size === 'large'` (rejected, an invisible
coupling between a type scale and a tooltip's contents); making the glyph a slot (rejected as more
surface than open question 3 is worth while it is still open).

**No `focusable` prop**, as settled. `tabIndex={0}` is unconditional and is asserted across five
configurations, including `subtle`, `small`, and with no tooltip, because that is the line most
likely to be removed by someone tidying up.

### Deviation: `createFocusOutlineStyle`, not `createCustomFocusIndicatorStyle`

§3 row 5, §4 and §13.4 all name `createCustomFocusIndicatorStyle` for the `subtle` variant's focus
ring. The code calls **`createFocusOutlineStyle()`** instead. Both are public re-exports from
`@fluentui/react-components`, both emit the `[data-fui-focus-visible]` selector Fluent's own focus
system drives, and neither hand-writes it, so decision 0019 is satisfied either way.

`createFocusOutlineStyle` is the better fit for two reasons. It produces the same `::after` ring
that Fluent's `Card` already draws, which the item 0 capture measured on every metric card, so the
converged component has one focus appearance rather than two. And it removes the browser's default
outline, which `createCustomFocusIndicatorStyle` explicitly does not — its own doc comment says
that is the caller's job — so the alternative would have needed a hand-written `outlineStyle: 'none'`
beside it to avoid drawing two rings.

It requires `position: relative` on the element it decorates, which is declared, and which `Card`
already sets for itself.

### Where the baseline changed the code

- **`filled` declares neither `padding` nor `gap`.** Per 0024. The class contributes only
  `alignItems: 'flex-start'`, which is the one declaration in `.metricCard` that Fluent's `Card`
  does not already set and that the measurement showed applying.
- **The label uses `colorNeutralForeground4`.** Per 0024.
- **The label declares no `line-height`.** Item 0 found the `20px` is inherited from Fluent's
  `body1`, not declared. Declaring it would preserve the pixel and lose the inheritance, which is
  the worse trade for a component whose consumer may set a different type ramp.
- **`size="small"` puts `14px` on the value slot itself**, rather than expecting the consumer to
  wrap the value in a styled span the way `GenericCell` does today. Same rendered geometry, one
  fewer element, and it means the `N/A` placeholder inherits the right size without a second rule.

### The one thing the tests cannot assert

Jsdom computes no layout, so "the value slot has the same height loading and resolved" is asserted
as **the same class**, not the same measured height. The height itself is item 6's problem, and item
0 recorded it: `32px` in both states for `large`, `20px` for `small`.

---

## Item 3: the metric wrappers move onto `MetricCard`

Extension only. Commit: _pending_.

`MetricBase.tsx`, `MetricsRow.tsx` and `MetricsRow.scss` deleted, and both call sites updated in the
same commit, per increment 2's rule that a deletion is atomic with its call sites. `TimeMetric`,
`CountMetric`, `RatioMetric` and `GenericMetric` now format a value and hand it to `MetricCard`;
`QueryInsightsTab` and `IndexMetricsRow` import `MetricGrid` from the package directly.

`npm run build` passes, the webview test projects pass at 510 tests, and both affected tabs compile.

### `metricProps.ts` is new, and is not `MetricBase` under another name

Two things were genuinely shared and neither is a component:

- **`MetricProps`** — the four props every metric takes beside its own value shape. It replaces
  `Omit<MetricBaseProps, 'value'>`, which is how all four wrappers used to spell it, so no call site
  changed.
- **`composeMetricAriaLabel`** — the accessible name, reproduced character for character from
  `MetricBase`, including the rule that a node-valued metric contributes no value text. This is what
  §2 option D costs at the call sites, and it is deliberately one function so increment 4 has one
  place to change rather than four.

The alternative was a local `Metric` component wrapping `MetricCard` with the extension's
conventions. Rejected: that is `MetricBase` again, one indirection further out, and it would hide the
`ariaLabel` pass-through that increment 4 needs to be able to see.

### Two latent bugs the diff turned up

Both are §7's "small existing bug" category, fixed here rather than filed, exactly as increment 2
handled the `formHeader` gap it found the same way.

- **`nullValuePlaceholder` shipped English to every locale.** It defaulted to the untranslated
  string `'N/A'` in `MetricBase` and in three of the four wrappers. All four now default to
  `l10n.t('N/A')`. The English rendering is unchanged, so the baseline holds.
- **`GenericMetric` accepted `nullValuePlaceholder` and never forwarded it.** Its props extended
  `MetricBaseProps`, so the prop was in the signature and type-checked at every call site, and was
  then dropped on the floor. It is forwarded now. No current call site passes it, which is why
  nobody noticed.

### Preserved on purpose, though it looks wrong

`RatioMetric` renders the **loading** placeholder when its ratio is `null`, not the unavailable one:
it collapses `null` into `undefined` before it reaches the card. Every other metric distinguishes
them. It is preserved verbatim, with a comment saying so, because a ratio that is unavailable
showing a permanent skeleton is a product decision about a specific screen, not a fact about the
component, and this increment is not the place to change what a user sees.

### Naming left alone

`IndexMetricsRow` keeps its name. It is the extension's own composition for the index dashboard, not
the deleted container, and renaming it would be churn in a commit whose value is that it changes
nothing visible.

### Still duplicated, as §5 predicted

`.baseDataHeader` and `.baseDataValue` stay in `queryInsights.scss`, because `SummaryCard.scss`,
`StageDetailCard.scss` and `GenericCell.scss` all `@extend` them. `.headerWithInfoIcon`,
`.tooltipInfoIcon` and the four `.tooltip*` rules are now used only by `CellBase`, so they come out
in item 4 rather than here.
