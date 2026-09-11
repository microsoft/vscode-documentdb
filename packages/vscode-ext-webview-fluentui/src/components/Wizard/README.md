# `Wizard`

A wizard presents a task as a sequence of steps and shows one of them at a time, with a header, a
step indicator and an action bar around it. Steps are declared as `WizardStep` children.

A wizard is controlled. You pass `activeStep`, and it renders the step with that value. Activating
another step in the indicator raises `onStepChange` and changes nothing until you say so.

A wizard is a `Container` and a `StepList` assembled for you, and it uses nothing from them that
you cannot use directly. Compose those yourself when you need a layout a wizard does not offer.

![A Wizard showing a configured local database setup with step navigation and footer actions](./screenshot.png)

## Best practices

### Do

- Pass `stepsLocked` while work is in flight, or once the outcome is committed.
- Give a step a `title` when its heading should differ from its label in the indicator. It defaults
  to the label.
- Show one step for one place in the task, even when your application distinguishes several
  situations there. See below.
- Keep expensive work out of an inactive step's children. They are not rendered, but you still
  construct them.

### Don't

- Wrap steps in a fragment. A fragment has no props to read, so its steps are ignored.
- Expect an inactive step to keep state. Only the active step is mounted.
- Inject content between the header and the step indicator. There is no slot for it.

## Anatomy

```tsx
<Wizard
    activeStep={currentStep}
    onStepChange={goToStep}
    headerBehavior="sticky-navigation"
    stepsLocked={isRunning}
    stepsAriaLabel={l10n.t('Setup steps')}
    header={<ContainerHeader media={<RocketRegular />} title="DocumentDB Local" subtitle="…" />}
    footer={
        <ContainerFooter note={footerNote} contentEnd={<Button>{l10n.t('Learn more')}</Button>}>
            <Button appearance="primary" onClick={onPrimary}>
                {primaryLabel}
            </Button>
            {secondaryActions}
        </ContainerFooter>
    }
>
    <WizardStep value="introduction" label={l10n.t('Introduction')} title="…" subtitle="…">
        …
    </WizardStep>
    <WizardStep value="setup" label={l10n.t('Set up')}>
        {isRunning ? progressBody : failureBody}
    </WizardStep>
</Wizard>
```

There is no `WizardHeader` or `WizardFooter`. The slots take `ContainerHeader` and
`ContainerFooter`, which is fewer names and makes the facade relationship visible in the consumer's
own code.

## Sticky header behavior

`headerBehavior` controls what remains visible while the wizard body scrolls:

| Value               | The identifying header         | The step indicator |
| ------------------- | ------------------------------ | ------------------ |
| `scroll` (default)  | scrolls away                   | scrolls away       |
| `sticky-navigation` | scrolls away, fading out early | pins               |

Pick `scroll` unless a step's content is long enough that the user loses their place in the flow.
`sticky-navigation` is the cheapest fix for that, because it keeps the step indicator, which is the
part that answers "where am I?", and spends no vertical space on the title once it has been read.
The fade uses the first 150 pixels of scrolling and reaches zero opacity at 65% of that range.
Header media, title and subtitle keep their normal sizes; there is no condensing presentation.

Navigation gains a bottom border and shadow when there is content above the scroll position.
The shadow is clipped to the bottom. Top navigation keeps the wizard's normal maximum content
width while its background and elevation span the scroll viewport, matching `ContainerFooter`.
With `navPosition="start"`, the background stays within the sidebar so it cannot cover the main content.

### Action buttons

Header actions scroll and fade with the identifying header. While any descendant has focus,
`:focus-within` disables the fade, restoring full opacity without removing buttons from the tab order
or accessibility tree. The fade resumes when focus leaves the header. This applies to keyboard
focus and to pointer interactions that focus a control.

Put primary actions and commands that must remain available in `ContainerFooter`; it stays pinned
in both modes. `WizardStep.action` stays with the step heading and is not part of the header fade.

### What it costs, and what it never changes

Sticky navigation adds only CSS: a named scroll timeline and scroll-state container queries.
It adds no scroll listeners, observers or React state. `ContainerBody` retains its existing
overflow tracking for the footer.

Nothing about the accessible content changes in any mode. The header renders one title and one
subtitle throughout. Step headings carry a scroll margin to leave room for the pinned navigation.

With `prefers-reduced-motion: reduce`, or without scroll timelines, the identifying header scrolls
away **without fading** and the navigation still pins. This fallback simply disables the animation.
The navigation's border and shadow retain their short cosmetic transitions.

## Sizing and embedding

`Wizard` uses `Container` as its root and intentionally defaults to a full-webview height of
`100vh`. Its body scrolls and its footer stays visible. It does not automatically fill the space
remaining below an application toolbar or inside an arbitrary parent.

Unlike `Container`, `Wizard` currently exposes neither `style` nor `className` for its root.
For embedding, use a dedicated wrapper and a scoped CSS override targeting its direct root element:

```tsx
<div className="embeddedWizardHost">
    <div>{toolbar}</div>
    <div className="embeddedWizardSlot">
        <Wizard
            activeStep={currentStep}
            onStepChange={goToStep}
            stepsAriaLabel={l10n.t('Setup steps')}
            header={<ContainerHeader title={title} headingLevel={2} />}
            footer={<ContainerFooter>{actions}</ContainerFooter>}
        >
            <WizardStep value="configure" label={l10n.t('Configure')}>
                {configurationForm}
            </WizardStep>
            <WizardStep value="review" label={l10n.t('Review')}>
                {reviewContent}
            </WizardStep>
        </Wizard>
    </div>
</div>
```

```css
.embeddedWizardHost {
    height: 480px;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-width: 0;
    overflow: hidden;
}

.embeddedWizardSlot {
    min-height: 0;
    min-width: 0;
    overflow: hidden;
}

.embeddedWizardSlot > div {
    height: 100%;
    min-height: 0;
    min-width: 0;
}
```

Replace the example 480px with a definite height supplied by your application. The toolbar takes
the first row and the wizard fills only the remaining row. Keep the wizard as the wrapper's only
child. The direct-child selector overrides the root's Griffel height without depending on generated
class names or changing any nested component's height.

This is a workaround tied to the current single-`div` root structure, not a dedicated sizing API;
recheck it when upgrading the package. For direct control over root props, compose `Container` and
`StepList` yourself, preserving the step navigation and focus behavior your flow needs.

The parent must supply a bounded height; `height: 100%` under an auto-height parent is not enough.
Keep the wrapper non-scrolling and let the wizard's `ContainerBody` own scrolling. See
[Container sizing and embedding](../Container/README.md#sizing-and-embedding) for the parent-sizing
requirements and document-padding guidance. The wizard still contains a `<main>` landmark and
level-2 step headings: do not embed it inside another `<main>`, and use the lower-level components
if the surrounding document requires different landmark or heading semantics.

## Children must be `WizardStep`

`Wizard` reads its children's props. `false` and `null` are dropped, so `{isEdit && <WizardStep …>}`
is safe. But **a fragment of steps is ignored**, because a fragment has no props to read. Anything
that is not a branded `WizardStep` is skipped rather than rendered.

That is the cost of declaring a label beside its content, and it is the one thing about this
component that will surprise someone.

## Choosing `activeStep`

`activeStep` is a string you compute. A wizard never sees how you arrived at it, which is what lets
your own state be a different shape from your step list.

Two consequences are worth knowing, because both look like missing features until you try them.

**Several situations can share one step.** An operation that is running and the same operation
after it failed are the same place in the task, so they are one step. Pass the same `activeStep`
for both and let the step's own content tell them apart:

```tsx
<WizardStep
    value="setup"
    label="Set up"
    title={isRunning ? 'Setting up' : 'Setup did not finish'}
>
    {isRunning ? <Progress /> : <Failure onRetry={retry} />}
</WizardStep>
```

The indicator stays put, and a failure is reported where it happened instead of moving the user.

**A step that does not apply is simply not rendered.** `false` and `null` children are dropped, so
the indicator shows three steps instead of four and the derived state follows:

```tsx
{!isEditing && (
    <WizardStep value="choose" label="Choose method">
        …
    </WizardStep>
)}
```

## What a wizard does not do

It owns no navigation logic, no button labels, no disabled rules, and no focus handling across a
button that swaps mid-step. Those differ between flows enough that any shared version would be a
list of predicates you supply anyway.

## Derived state, and when to override it

```ts
completed = index === 0 || index < activeIndex || (index === last && index === activeIndex);
navigable = index < activeIndex && !stepsLocked;
```

Override either per step when a flow disagrees: a mode whose first step is not already satisfied,
or one that allows returning to only some earlier steps.

## Accessibility

Everything `Container` and `StepList` guarantee, plus one thing that belongs to the facade: the
active step's section is keyed by `activeStep`, so every step change mounts a fresh section and
moves focus to its heading (WCAG 2.4.3). The first render is exempt.

## Props

See [`Wizard.types.ts`](./Wizard.types.ts).
