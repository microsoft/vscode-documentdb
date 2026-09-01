# `components/`

Reusable Fluent UI components, and nothing else.

## The one rule

**A component must not require this package's theming.** Nothing here may import `theme/` or
`styles/`; components style themselves from Fluent `tokens.*`, which resolve against whatever
`FluentProvider` is above them. That is what lets another extension adopt a single component
without adopting a whole visual philosophy.

Enforced by a `no-restricted-imports` rule in the repo's ESLint config and by `components.test.ts`,
which asserts that importing the `./components` entry injects no stylesheet.

## The second rule

No localized strings. Every user-visible string is a prop, defaulting to English. String
extractors do not scan `node_modules`, so a string owned here would silently never be translated
in any consumer.

## What gets in

This folder grows slowly on purpose. A component enters only if all four hold:

1. it is **useful to other Fluent UI consumers**, meaning other products and other extensions, not
   only as an adapter that patches Fluent's behaviour inside a webview;
2. it takes no product strings and emits no product-prefixed tokens;
3. it plausibly has two consumers;
4. it imports no transport, no telemetry, and no `vscode` module.

Condition 1 was narrower until decision 0021 relaxed it: it used to admit only VS Code
**integration** problems, which a wizard surface fails as literally worded. Fluent behaves fine, it
simply ships no such component.

That means **condition 3 now carries the gate**. The question is no longer "is this a VS Code
integration problem?", which is always answerable by argument, but **"who is the second
consumer?"**, which has a name or it does not.

The first thing tested after the gate widened was excluded by it: `MessageBlock` stacks a
`MessageBar`'s title onto its own line, which sounds like a missing Fluent component and is
actually house style, with no second consumer. It lives in the extension
(`src/webviews/components/MessageBlock.tsx`), not here. Decision 0022.

## Contents

| Component                              | What it is                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| [`Container`](./Container/README.md)   | the shell of a full-window surface: scrolling header and content, over a pinned footer |
| [`MetricGrid`](./MetricGrid/README.md) | one measurement per card, in a grid that goes from one column to four                  |
| [`StepList`](./StepList/README.md)     | a step indicator that collapses into an overflow menu and never hides the current step |
| [`StatusList`](./StatusList/README.md) | a bordered list of stages, each with a status glyph and a line of evidence             |
| [`Wizard`](./Wizard/README.md)         | a complete wizard surface in one component                                             |

## How they compose

`Wizard` is the one component assembled from others: it is `Container` and `StepList`, wired
together. It uses nothing from them that a consumer could not use directly, which is what lets
anyone who outgrows `Wizard` drop to those components and lose nothing.

`StatusList` is independent and goes inside any content area. `MetricGrid` is independent too, and
is a plain grid: `MetricCard` is the expected child but not a required one.

```
Wizard ──> Container ─┬─ ContainerBody ─┬─ ContainerHeader
                      │                 ├─ ContainerNav ──> StepList ──> StepListItem
                      │                 └─ ContainerMain ─> ContainerSection
                      └─ ContainerFooter

StatusList ──> StatusListItem

MetricGrid ──> MetricCard
```

## Documentation

Prop-level documentation lives in **JSDoc on the types**, and nowhere else. That is where your
editor shows it, on hover, at every call site.

The markdown files here cover what types cannot: anatomy, best practices, accessibility guarantees,
and the reasoning behind a shape that looks like one level of nesting too many. **They never restate
the props.** A hand-written props table is wrong within two changes, and is worse than nothing
because it is believed.
