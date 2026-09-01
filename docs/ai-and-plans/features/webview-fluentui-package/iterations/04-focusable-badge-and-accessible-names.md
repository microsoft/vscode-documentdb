---
feature: webview-fluentui-package
kind: plan
status: active
created: 2026-08-21
---

# Increment 4 — the focusable badge, and the accessible-name question

> The last component on the original shortlist, and the reason it was worth waiting for: it is not
> an extraction. Today it is a stylesheet plus a markdown instruction, the stylesheet reimplements
> something Fluent already exports, and the accessibility pattern it teaches is probably wrong in a
> way that also affects the metric card. This increment settles the question with evidence, then
> ships the component the answer implies. **No npm publish.**

**Not started. Depends on [increment 3](./03-metric-card.md) only for its baseline capture**, not for
its code. Decisions are settled in [decisions.md](../decisions.md); this plan proposes 0026.

---

## 1. Why this is a redesign and not a move

`src/webviews/components/focusableBadge/` contains no `.tsx` at all. It holds a stylesheet and a
150-line markdown file instructing callers to hand-write four things on every `Badge`: `tabIndex={0}`,
a class name, a composed `aria-label`, and `aria-hidden` on the children.

Converting an instruction into an enforced API is the highest-value move available in this package,
and [design.md §11](../design.md) said so. What it did not say is that both halves of the instruction
are questionable:

- the **stylesheet** hand-writes a focus indicator that Fluent exports a supported recipe for (§3.1);
- the **`aria-label` pattern** it teaches probably produces the double announcement it claims to
  prevent (§3.2).

Porting either faithfully would ship a defect into a shared package, which is the one place a defect
is expensive to reverse. So the sequence is: measure, decide, then write.

---

## 2. What exists today

Four call sites follow the instruction, each slightly differently:

| Call site                       | `relationship` | Composed name                          | Children                                     | Notes                                     |
| ------------------------------- | -------------- | -------------------------------------- | -------------------------------------------- | ----------------------------------------- |
| `IndexPropertiesView.tsx:73`    | `description`  | `l10n.t('{0}. {1}', label, tooltip)`   | one `aria-hidden` span                       | focusable **only** when a tooltip exists  |
| `IndexRowDetails.tsx:128`       | `label`        | the same string as the tooltip content | two `aria-hidden` spans, field and direction | class composed: `keyBadge focusableBadge` |
| `StageDetailCard.tsx:140`       | `label`        | `` `${metric.label}: ${valueStr}` ``   | two `aria-hidden` spans, label and value     | tooltip only when the value is truncated  |
| `PerformanceRatingCell.tsx:205` | see the file   | composed inline                        | `aria-hidden` span                           |                                           |

Everything in the "Composed name" column is a **joiner**, and joiners are localizable. Increment 2
already ruled on this once: `StatusListItem` folded `meta` and `action` into a single `detail` node
specifically so the `·` separator, and its localization, stayed with the consumer. One call site here
already does it correctly, with `l10n.t('{0}. {1}', …)`; the other three hard-code the punctuation.

---

## 3. The two defects

### 3.1 Fluent already ships the focus ring

`focusableBadge.scss` hand-writes an `::after` pseudo-element keyed off `[data-fui-focus-visible]`,
with a `:focus-visible` fallback, and its markdown explains the attribute at length.

`@fluentui/react-components` publicly re-exports **`createFocusOutlineStyle`** and
**`createCustomFocusIndicatorStyle`** from `@fluentui/react-tabster`. They are the supported way to
produce exactly this indicator, they already emit the `[data-fui-focus-visible]` selector, and they
track Fluent's own focus design across versions.

This matters beyond tidiness. Decision 0019 says adapt Fluent by re-pointing its tokens, never by
out-specifying its classes, and `[data-fui-focus-visible]` is a Fluent internal contract of the same
kind. Reproducing the indicator by hand inside the package would add a second `fui-*` style coupling
in the same package whose `fluentOverrides` suite exists to prevent exactly that. Calling Fluent's own
recipe removes the coupling instead of relocating it.

**Consequence: the component is mostly deleting CSS, not moving it.**

### 3.2 The hand-composed `aria-label` probably double-announces

Every element has an accessible **name** and an accessible **description**. Assistive technology
announces both on focus, name first.

Fluent's `Tooltip` already wires its trigger. From `useTooltipBase`: `relationship="label"` sets
**`aria-labelledby`**, and `relationship="description"` sets **`aria-describedby`**, in both cases
pointing at the tooltip content, which is rendered even while hidden precisely so the reference stays
valid.

So, for the four call sites in §2:

- with `relationship="description"`, the tooltip text is announced as the description **and** is
  already inside the composed `aria-label`. That is the double announcement the pattern claims to
  prevent, arrived at from the other direction;
- with `relationship="label"`, `aria-labelledby` wins over `aria-label` in name computation, so the
  composed string is computed and then discarded.

The same pattern appears on `MetricBase`, and its sibling `CellBase` takes the opposite position and
composes nothing. Two components with the same purpose, in the same folder, disagree. At most one of
them is right, and increment 3 deliberately deferred the answer here rather than writing either
behaviour into a shared package.

**This is a strong suspicion, not a fact.** §4 is how it stops being one.

---

## 4. How the question actually gets answered

Mostly without a screen reader, because the redundancy is a property of two strings the browser
computes for you. Three tiers, in order, and each one is only run for what the previous cannot decide.

### 4.1 The two assertions

```js
const redundant = description && name.includes(description);          // announced twice
const dead = el.getAttribute('aria-label') && !name.includes(el.getAttribute('aria-label'));
```

`redundant` is the double announcement. `dead` is the composition that was computed and discarded.
Both are decidable mechanically, for one badge per `relationship` value and for one metric card with
a tooltip.

### 4.2 Tier 1, the browser, which is ground truth for the computation

Chrome computes the name with the accname algorithm and will tell you which source won. Through
`run_playwright_code`:

```js
const cdp = await page.context().newCDPSession(page);
await cdp.send('Accessibility.enable');
const { root } = await cdp.send('DOM.getDocument');
const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '.focusableBadge' });
for (const nodeId of nodeIds) {
    const { nodes } = await cdp.send('Accessibility.queryAXTree', { nodeId });
    // nodes[0].name.value        the announced name
    // nodes[0].name.sources      each candidate, with `superseded: true` on the ones that lost
    // nodes[0].description.value the announced description
}
```

`name.sources` is the part worth the setup: it shows `aria-label` marked `superseded` when
`aria-labelledby` beat it, which is §3.2's second half stated by the browser rather than inferred
from Fluent's source. The DevTools Accessibility pane shows the same thing interactively if you would
rather look than script it.

`read_page` gives names and roles for a quick first pass, but not the source chain, so it answers
`redundant` and not `dead`.

**If increment 3 was run first, this data already exists** in its work log, captured at its item 0.
Re-measure only what it did not cover, which is the badges.

### 4.3 Tier 2, a committed regression test

So the next change cannot quietly undo the fix. `dom-accessibility-api` implements the same algorithm
in jsdom and is one small devDependency, the same one Testing Library uses:

```ts
import { computeAccessibleDescription, computeAccessibleName } from 'dom-accessibility-api';

const name = computeAccessibleName(badge);
const description = computeAccessibleDescription(badge);
expect(name).toBe('TTL');
expect(description).not.toBe('');
expect(name).not.toContain(description); // the contract, asserted
```

Two caveats, both cheap to check: jsdom has no layout, so anything the algorithm skips for being
hidden may be included anyway, and Fluent renders tooltip content even while hidden precisely so the
aria reference resolves, which helps here. **Verify the jsdom result agrees with the tier 1 result for
one known case before writing tests against it.** If they disagree, the browser is right and the unit
test is measuring something else.

One cost to raise at review rather than absorb: this is a **new devDependency**, so it regenerates
`package-lock.json`. Increment 2 deferred API Extractor for that reason alone, and repo memory records
that regenerating the lockfile under the wrong npm version breaks CI. If the lockfile is going to be
touched, taking both in one deliberate change is better than taking each as a side effect of
something else.

### 4.4 Tier 3, a real screen reader, once

Only for what the first two cannot decide: how a specific reader paces name and description, and
whether it repeats at all at the user's verbosity setting. NVDA with the Speech Viewer window gives a
transcript you can paste into the work log; VoiceOver's caption panel does the same. Run it against
the real webview in the extension host, not the harness, and treat it as confirmation of a decision
already made rather than as the way to make it.

### 4.5 The constraint on whatever is chosen

WCAG 2.5.3, Label in Name: the visible text must be contained in the accessible name, and should
start it, so that speech control works. Today's composed labels satisfy that by accident of ordering.
If the composition is dropped in favour of Fluent's wiring, the name becomes the visible content,
which satisfies it directly. A variant that puts the description first does not.

### 4.6 What each answer implies

| Measurement                                                  | Then                                                                                                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `redundant` true for `relationship="description"` call sites | Drop the composition there. The tooltip already supplies the description; the name is the visible text                                                       |
| `dead` true for `relationship="label"` call sites            | Drop the composition there too, and delete the prop rather than leave a no-op                                                                                |
| Both false                                                   | The pattern is correct, `ariaLabel` stays, and the markdown's reasoning moves into JSDoc unchanged                                                           |
| Ambiguous                                                    | Keep today's behaviour, ship the component as a faithful port, and file the question. A silent accessibility change is worse than a documented inconsistency |

---

## 5. The component

```ts
interface FocusableBadgeProps extends Omit<BadgeProps, 'tabIndex'> {
    /**
     * The complete accessible name, composed by the consumer, including whatever the tooltip says.
     * Omit it when the tooltip supplies the name through `relationship="label"`.
     */
    readonly ariaLabel?: string;
    /** Visible content. Hidden from assistive technology when `ariaLabel` is supplied. */
    readonly children: ReactNode;
}
```

Everything else, `appearance`, `color`, `shape`, `size` and `className`, passes through to `Badge`.

Three things the component owns, and they are the whole reason it exists:

1. `tabIndex={0}`, so a badge that carries a tooltip is reachable by keyboard (WCAG 2.1.1);
2. the focus indicator, through Fluent's `createCustomFocusIndicatorStyle` (§3.1);
3. the `aria-hidden` wrapper around children, applied **only** when `ariaLabel` is supplied, so the
   two naming mechanisms cannot both be active by accident.

Three things it deliberately does not own:

- **the `Tooltip`.** The consumer wraps it, as today. Two call sites render the tooltip conditionally
  and one composes it from a `<code>` element; absorbing it would mean re-exporting `relationship`,
  `positioning`, `withArrow` and `content` for no gain. It also keeps §3.2 visible at the call site
  instead of hiding it inside the package;
- **the joiner.** `ariaLabel` arrives composed. Precedent: `StatusListItem.detail`, increment 2 §4.5;
- **any string.** There is no default text anywhere in it.

If §4 concludes that the composition should go, `ariaLabel` is deleted from this interface before it
ships and the component keeps only points 1 and 2. That is the smaller, better component, and it is
why the measurement comes first.

### 5.1 The mixed-list problem, and why `ariaLabel` is optional

`IndexPropertiesView` renders a list where only some badges have a tooltip; the others are plain,
non-focusable `Badge`s. Two ways to serve that:

|     | Approach                                                                      | Verdict                                                                                                                                                      |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A   | `ariaLabel` required; the consumer picks `Badge` or `FocusableBadge` per item | Rejected. It pushes a conditional element type into a `.map()`, which is exactly the hand-assembly the component exists to remove.                           |
| B   | `ariaLabel` optional; without it the badge renders plain and non-focusable    | **Chosen.** One element type for the whole list. The rule is legible: a badge becomes focusable when, and only when, it carries something extra to announce. |

The cost of B is that the component's name overstates what it always does. Accepted: the alternative
is worse at every call site, and the JSDoc states the rule in one line.

**If §4 removes `ariaLabel`**, this section needs a different discriminator, most likely an explicit
`focusable` boolean. Do not skip the question: a list where every badge silently became a tab stop is
a regression that no test in this repository would catch.

---

## 6. The follow-through into `MetricCard`

Increment 3 ships `MetricCard` with `ariaLabel` as a pass-through and takes no position on §3.2. This
increment is where that position is taken, so it also owns the follow-through:

- if the composition goes, the metric wrappers stop passing `ariaLabel` and the prop is deleted from
  `MetricCardProps`, which is free while the package is `private: true`;
- if it stays, the prop is documented with the reasoning from §4 rather than left unexplained.

Either way, `MetricCard` and `FocusableBadge` end this increment with the **same** naming contract.
Two components in one package that disagree about accessibility is the state this whole exercise
exists to end, and shipping the badge without resolving the card would simply move the fork inside the
package boundary.

### 6.1 Two provisional choices from increment 3, to review here

Both were settled at increment 3's review on 2026-08-21 so that the metric card could ship without
waiting for this investigation. Both were accepted **as provisional**, on the explicit basis that the
package README ships it as a Preview with breaking changes permitted between minor versions. Neither
is a conclusion. Reopen both, in this order.

**1. `ariaLabel` as an optional pass-through.** The prop exists so the package could take no position.
§4 takes one. Three outcomes:

| §4 concludes                         | `MetricCardProps.ariaLabel`                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| The composition is redundant or dead | **Delete the prop.** Do not deprecate it; nothing is published and nothing is owed  |
| The composition is correct           | Keep it, and document the reasoning from §4 in its JSDoc                            |
| Ambiguous                            | Keep it, and record in the work log that it is still unresolved rather than settled |

Deleting it is the outcome to expect, and it is the reason the prop was made optional rather than
required: no call site is obliged to pass it, so removal touches the wrappers and nothing else.

**2. Every metric card is a tab stop.** Increment 3 resolved `MetricBase` against `CellBase` in favour
of always setting `tabIndex={0}`, and the argument was consistency: a keyboard user who can reach one
card in a grid should reach all of them. That argument is sound and it has a cost that only shows up
once the summary cells are converged.

What to look at here, with the item 0 tab-order capture from increment 3 in hand:

- **How many non-interactive tab stops did the change add?** A four-card metrics row plus a converged
  summary grid can put a double-digit run of static tiles in front of everything below them. Nothing
  in WCAG forbids it, and 2.4.3 Focus Order is satisfied, but tab-order noise is a real usability cost
  paid by exactly the users the tab stop was added for.
- **Does the card still need to be focusable at all once §4 lands?** The tab stop exists so a tooltip
  can be reached by keyboard. If §4 concludes the tooltip's content should be an
  `aria-describedby` description rather than part of a composed name, the description is announced on
  focus, which _requires_ the focus. If instead the information ends up available without focus, the
  justification weakens.
- **If it changes, what replaces it?** Most likely a `focusable` prop defaulting to `true`, so the
  summary grid can opt out while the metrics row keeps today's behaviour. That is additive and cheap.
  Adding it speculatively in increment 3 was rejected for that reason: an unused prop is harder to
  remove than an absent one is to add.

Whatever is decided, decide it **explicitly and in the work log**. The failure mode here is not
choosing wrongly, it is letting a provisional choice become permanent by nobody revisiting it.

---

## 7. What happens to the old files

- `focusableBadge.scss` is **deleted**. Its content is replaced by a Fluent call, not ported.
- `focusableBadge.md` is **deleted**. Its accessibility reasoning, the parts that survive §4, moves
  into the component's JSDoc and its family README.
- `.github/skills/accessibility-aria-expert/SKILL.md` references the pattern in five places, including
  a checklist item and an import instruction. It must be updated **in the same commit** that deletes
  the stylesheet. Increment 2's lesson was that nothing tells you a document has gone stale; this one
  is known in advance, so there is no excuse for it.

The skill is the sharpest instance of the problem this increment fixes. It currently teaches the
pattern to every future contributor, which means a wrong answer propagates by instruction, not just
by copy-paste.

---

## 8. Proposed decision

- **0026 — The focusable badge ships as a component, and the stylesheet is deleted rather than
  ported.** The focus indicator comes from Fluent's `createCustomFocusIndicatorStyle`; the `Tooltip`
  stays at the call site; the accessible-name contract is whatever §4 measures, and it is applied to
  `MetricCard` and `FocusableBadge` together.

---

## 9. File and folder structure

```
packages/vscode-ext-webview-fluentui/src/components/
├── README.md                       # contents table, updated
├── index.ts                        # + the new family
└── FocusableBadge/
    ├── FocusableBadge.tsx
    ├── FocusableBadge.types.ts
    ├── index.ts
    ├── README.md                   # the naming contract; when a badge is a tab stop
    └── FocusableBadge.test.tsx
```

Deleted from the extension:

```
src/webviews/components/focusableBadge/focusableBadge.scss
src/webviews/components/focusableBadge/focusableBadge.md
```

Nothing under `theme/`, `styles/`, `palette/` or the `"."` entry changes.

---

## 10. Open questions

**Blocking.**

1. **The naming contract itself.** Answered by §4, by measurement, before item 2. If the measurement
   is ambiguous, the answer is "faithful port plus a filed question", not a judgement call.
2. **Whether `dom-accessibility-api` is accepted** (§4.3), which decides whether the contract gets a
   regression test or only a one-off measurement. It is a lockfile change.

**Non-blocking.**

3. Whether `FocusableBadge` should also absorb the truncation-plus-tooltip pattern that
   `StageDetailCard` implements inline. It is the only call site that does it, so condition 3 of the
   gate says no for now.

---

## 11. Non-goals

- **Wrapping `Tooltip`.** §5.
- **A general focus-ring utility.** Fluent already exports one; re-exporting it would be a category
  helper, which is what decision 0002 exists to keep out.
- **Rewriting the accessibility skill's other sections.** Only the badge pattern is in scope.
- **Publishing.** The package stays `private: true` at `0.1.0-preview`.

---

## 12. Implementation order

| #   | Work item                                                                                           | Commit contains                                                         |
| --- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 0   | **Measure** (§4.1, §4.2), and record the answer and its evidence in the work log                    | **nothing**                                                             |
| 1   | Transcribe decision 0026, with the measured contract in it                                          | docs only                                                               |
| 2   | `dom-accessibility-api` devDependency and the lockfile change, if open question 2 is accepted       | one devDependency, one lockfile                                         |
| 3   | `FocusableBadge` in the package, with tests including the naming assertions                         | package only                                                            |
| 4   | Migrate the four call sites; **delete** `focusableBadge.scss` and `.md`; update the a11y skill (§7) | extension only, all in **one** commit, because the deletion breaks them |
| 5   | Apply the same contract to `MetricCard`, and settle both §6.1 choices in the work log               | package plus the metric wrappers                                        |
| 6   | Documentation: the family README, the JSDoc pass, the updated `components/README.md` contents table | package only                                                            |
| 7   | Final verification (§13), and the tier 3 screen-reader pass if §4 called for one                    | nothing, or a fixup                                                     |

Item 4 is atomic with its deletions, for the same reason increment 2's item 2 was.

Migrate the awkward consumer second: `IndexPropertiesView`, whose list is half focusable and is the
case §5.1 exists for.

The harness protocol is unchanged from [increment 3 §13.2](./03-metric-card.md), including its two
gotchas and its "stage by explicit path" rule. One addition specific to this increment: **the focus
indicator requires real keyboard input**. `page.keyboard.press('Tab')` produces
`data-fui-focus-visible`; a click does not, and a screenshot taken after a click will show no
indicator and look like a regression.

---

## 13. Verify

Fast loop: `npm run build`, then `npx jest --no-coverage <path>`.

Before hand-over, in order: `npm run l10n` → `npm run prettier-fix` → `npm run lint` →
`npx jest --no-coverage` → `npm run build` → `npm run package`.

Tests this increment must add:

- `components.test.ts` still passes: importing `./components` injects no stylesheet.
- `FocusableBadge` sets `tabIndex` and hides its children according to whatever §4 settled, asserted
  as behaviour and not as an implementation detail.
- `FocusableBadge` passes `appearance`, `color`, `shape`, `size` and `className` through to `Badge`,
  and **composes** `className` rather than replacing it, which is what `IndexRowDetails` relies on.
- The accessible name and description of a badge, and of a metric card, asserted as strings, with the
  §4.1 redundancy check among them. This is the test that stops the question from being re-litigated,
  and it exists only if open question 2 is accepted.

### Acceptance

**The operator performs the check**, keyboard-only, through both the Indexes tab and the Query
Insights tab: every badge that carries a tooltip is reachable, shows an indicator, and announces once.
Before that, the implementing agent reports the measured names and descriptions before and after, side
by side, in the work log.

---

# Work log

> One entry per work item in §12, recorded as the work was done. Write it at the commit, not at the
> end.

## Item 0: the measurement

_Not yet taken. The §4.1 assertions, the `name.sources` output, and the resulting contract belong
here before item 1 begins._
