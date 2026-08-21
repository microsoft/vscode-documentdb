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

_Not yet taken. The measurements from §13.2 belong here, verbatim, before item 1 begins._
