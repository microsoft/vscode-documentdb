# `components/`

Components that solve a VS Code integration problem, and nothing else.

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

1. it solves a VS Code **integration** problem, not a product problem;
2. it takes no product strings and emits no product-prefixed tokens;
3. it plausibly has two consumers;
4. it imports no transport, no telemetry, and no `vscode` module.

Condition 3 does most of the work. "Would this be useful?" is always yes; "does a second consumer
exist?" is answerable.

## Contents

| Component          | Problem it solves                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `WizardBreadcrumb` | a wizard step indicator that collapses into an overflow menu and never hides the current step |
