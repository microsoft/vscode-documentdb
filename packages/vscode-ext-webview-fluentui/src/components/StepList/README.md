# `StepList`

A responsive wizard step indicator. When the row does not fit, steps collapse into a "…" menu — and
the current step is the last thing overflow ever removes, so it never hides.

Modelled on Fluent's `TabList`: `selectedValue`, `onStepSelect`, and children that declare the
sequence. Fluent ships the selector but not the surrounding layout; this goes one step further, and
`Container` supplies the layout.

## Anatomy

```tsx
<StepList selectedValue={step} onStepSelect={(_e, d) => goToStep(d.value)} ariaLabel="Setup steps">
    <StepListItem value="introduction" completed>
        Introduction
    </StepListItem>
    <StepListItem value="configure" completed navigable>
        Configure
    </StepListItem>
    <StepListItem value="setup">Set up</StepListItem>
    <StepListItem value="done">Done</StepListItem>
</StepList>
```

`StepListItem` renders nothing on its own. `StepList` reads its props, because the dividers between
steps and the overflow menu both need the whole sequence rather than one item at a time. Children
are identified by a `Symbol.for` brand, not by `child.type ===`, which would break silently under
duplicate module instances or a fast refresh.

## Controlled only

There is no uncontrolled mode. A wizard always drives its own navigation — usually off a phase that
is richer than the step list itself — so an internal "selected" state would only ever be a second
copy of something the consumer already owns.

`onStepSelect` fires; nothing moves until the consumer changes `selectedValue`.

## Do / Don't

**Do**

- mark completed steps `completed`, including any that open pre-satisfied;
- mark a step `navigable` only when going back to it is safe. `Wizard` derives both by default;
- give `StepList` a `min-width: 0` parent. `ContainerNav` already does; anywhere else it is on you,
  and without it the overflow behaviour never engages.

**Don't**

- render anything but `StepListItem` inside it. Other children are dropped, deliberately and
  silently, so a `{condition && …}` guard is safe;
- expect `vertical` to do anything yet. The prop and the surrounding layout accept it; the vertical
  rendering is a later iteration, and shipping the prop now is what keeps that iteration additive.

## Accessibility

- The list is a `navigation` landmark named by `ariaLabel`.
- The current step carries `aria-current="step"`.
- A non-navigable step is `disabledFocusable`: still reachable by keyboard, so a screen-reader user
  can read the whole sequence, but it does nothing when activated.
- Completed steps stay semibold, so a step does not change width when it stops being current and
  shift the whole row. Fluent's own `reserveSelectedTabSpace` exists for the same reason.
- The overflow button is named through `overflowAriaLabel(count)`, which defaults to English.

## Props

See [`StepList.types.ts`](./StepList.types.ts).
