# `Wizard`

A whole wizard surface in one component: header, step indicator, the active step's content, and a
pinned footer.

It is tier 2. Everything it does, it does through the public `Container` and `StepList` API — that
is invariant I3, and it is what stops the facade growing private escape hatches. A consumer who
outgrows `Wizard` takes the same pieces and assembles them by hand; there is a step down rather
than a cliff.

## Anatomy

```tsx
<Wizard
    activeStep={stepForPhase(phase)}
    onStepChange={goToStep}
    stepsLocked={isProvisioning}
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
        {isProvisioning ? provisioningBody : failureBody}
    </WizardStep>
</Wizard>
```

There is no `WizardHeader` or `WizardFooter`. The slots take `ContainerHeader` and
`ContainerFooter`, which is fewer names and makes the facade relationship visible in the consumer's
own code.

## Children must be `WizardStep`

`Wizard` reads its children's props. `false` and `null` are dropped, so `{isEdit && <WizardStep …>}`
is safe — but **a fragment of steps is ignored**, because a fragment has no props to read. Anything
that is not a branded `WizardStep` is skipped rather than rendered.

That is the cost of declaring a label beside its content, and it is the one thing about this
component that will surprise someone.

## What stays with the consumer

`Wizard` is controlled and owns no navigation logic. In particular it never sees phases — only
steps. That mapping stays consumer-side, which is exactly what makes two very different flows fit:

- a flow whose five phases collapse onto four steps passes the same `activeStep` for two of them,
  and branches **inside** that step's children;
- a mode that drops a step simply does not render its `WizardStep`.

Button labels, disabled states and focus across a mid-step button swap also stay with the consumer.
No shared abstraction exists there, and inventing one would be the moment this component stopped
being a template and started being a framework.

## Derived state, and when to override it

```ts
completed = index === 0 || index < activeIndex || (index === last && index === activeIndex);
navigable = index < activeIndex && !stepsLocked;
```

Both defaults were extracted from two consumers that arrived at them independently. Override either
per step when a flow disagrees — a mode that drops the pre-satisfied first step, or one that allows
going back to only some earlier steps.

## Do / Don't

**Do**

- pass `stepsLocked` while work is in flight or the outcome is committed;
- give a step a `title` when the heading should differ from the step's label. It defaults to the
  label;
- keep heavy work out of an inactive step's children — they are not rendered, but they are still
  constructed by the consumer.

**Don't**

- wrap steps in a fragment;
- expect an inactive step to keep state. Only the active step is mounted, which is what makes
  focus-on-mount fall out of mounting and stops a heavy body staying resident;
- inject anything between the header and the step indicator. There is no slot for it.

## Accessibility

Everything `Container` and `StepList` guarantee, plus one thing that belongs to the facade: the
active step's section is keyed by `activeStep`, so every step change mounts a fresh section and
moves focus to its heading (WCAG 2.4.3). The first render is exempt.

## Props

See [`Wizard.types.ts`](./Wizard.types.ts).
