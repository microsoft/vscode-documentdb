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

1. it is **useful to other Fluent UI consumers** — other products and other extensions — not only
   as an adapter that patches Fluent's behaviour inside a webview;
2. it takes no product strings and emits no product-prefixed tokens;
3. it plausibly has two consumers;
4. it imports no transport, no telemetry, and no `vscode` module.

Condition 1 was narrower until decision 0021 relaxed it: it used to admit only VS Code
**integration** problems, which a wizard surface fails as literally worded — Fluent behaves fine,
it simply ships no such component.

That means **condition 3 now carries the gate**. The question is no longer "is this a VS Code
integration problem?", which is always answerable by argument, but **"who is the second
consumer?"**, which has a name or it does not.

The first thing tested after the gate widened was excluded by it: `MessageBlock` stacks a
`MessageBar`'s title onto its own line, which sounds like a missing Fluent component and is
actually house style, with no second consumer. It lives in the extension
(`src/webviews/components/MessageBlock.tsx`), not here. Decision 0022.

## Contents

| Family                                 | Problem it solves                                                                      |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| [`Container`](./Container/README.md)   | the header / scroll / pinned-footer shell of a surface that _is_ the window            |
| [`StepList`](./StepList/README.md)     | a step indicator that collapses into an overflow menu and never hides the current step |
| [`StatusList`](./StatusList/README.md) | a bordered list of stages, each with a status glyph and a line of evidence             |
| [`Wizard`](./Wizard/README.md)         | all three above, assembled — a whole wizard surface in one component                   |

## How they compose

`Wizard` is tier 2 and is built only from tier 1: `Container` + `StepList`. Nothing in it is
reachable only from inside the package, which is invariant I3 and the reason a consumer who
outgrows the facade can drop to the pieces without losing anything.

```
Wizard ──> Container ─┬─ ContainerBody ─┬─ ContainerHeader
                      │                 ├─ ContainerNav ──> StepList ──> StepListItem
                      │                 └─ ContainerMain ─> ContainerSection
                      └─ ContainerFooter

StatusList ──> StatusListItem          (independent; goes inside any content area)
```

## Documentation

Prop-level documentation lives in **JSDoc on the types**, and nowhere else. That is where your
editor shows it, on hover, at every call site.

The markdown files here cover what types cannot: anatomy, best practices, accessibility guarantees,
and the reasoning behind a shape that looks like one level of nesting too many. **They never restate
the props.** A hand-written props table is wrong within two changes, and is worse than nothing
because it is believed.
