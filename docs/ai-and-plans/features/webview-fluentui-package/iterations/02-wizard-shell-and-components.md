---
feature: webview-fluentui-package
kind: plan
status: active
created: 2026-08-19
---

# Increment 2 — the wizard surface, unified

> Two webviews carry the same wizard chrome as a code copy. This increment makes one source of
> truth: a composable `Container*` family, a `StepList` indicator, a `Wizard` facade that assembles
> them, plus `StatusList` in the package and a local `MessageBlock` in the extension. **No npm
> publish.**

**Pending operator review.** Decisions are settled in [decisions.md](./../decisions.md). Where this
plan and a decision disagree, the decision wins — stop and flag the conflict rather than reconciling
silently. The two items in §2 were settled by the operator on 2026-08-19 and need transcribing into
`decisions.md` as 0021 and 0022 before code is written.

Sequencing, commit boundaries and the traps a first implementation walks into are in §10.

Reference implementation for every layout question: **DocumentDB Local**
(`src/webviews/documentdb/localQuickStart/LocalQuickStart.tsx`). Atlas credentials is the older copy
and loses every tie.

---

## 1. What is duplicated today

`LocalQuickStart.tsx` (~2 600 lines) and `AtlasCredentialsView.tsx` (~900 lines) share
`WizardBreadcrumb` and nothing else. Identical in both, independently written:

- the DOM skeleton — `<main root>` → scroll area → 760px content column → pinned footer;
- every chrome style value — content `760 / 24 / 20`, hero gap `16` with a `56px` brand icon,
  section `12`, section header `4`, footer `16px 24px`, the elevation shadow
  `0 -2px 6px rgba(0,0,0,0.08)`;
- the footer elevation effect — two refs, an `onScroll`, a `ResizeObserver` on both elements,
  `scrollTop + clientHeight < scrollHeight - 1`. Byte-for-byte, comment included;
- focus-moves-to-the-step's-`h2`-but-never-on-first-render, via `contentRef.querySelector('h2')`;
- the breadcrumb derivation, including the "first step is always completed" quirk;
- `body { padding: 0 }`, one rule, in two SCSS files;
- `StageRow`, in a superset/subset relationship;
- a column-stacked `MessageBarBody`, declared three times under two names across eight call sites.

### 1.1 The skeleton being replaced

```tsx
<main className={styles.root}>
    <div className={styles.scrollArea} ref={scrollAreaRef} onScroll={updateFooterLayout}>
        <div ref={contentRef} className={styles.content}>
            <Announcer … />          {/* several */}
            {hero}                   {/* 56px brand icon + h1 + muted subtitle */}
            <WizardBreadcrumb … />
            {phase === 'x' && pageX} {/* one <section aria-labelledby> owning an h2 */}
        </div>
    </div>
    {footer}
</main>
```

**The header scrolls.** It lives inside the scroll area; only the footer is pinned. That is
deliberate and it is why `ContainerHeader` is a child of `ContainerBody` in §3.2 rather than a
sibling of it.

### 1.2 The values being carried over

Identical in both files, and the source of truth for every measurement in §4:

```ts
root:       { display:'flex', flexDirection:'column', height:'100vh', overflow:'hidden', position:'relative' }
scrollArea: { flex:1, minHeight:0, overflowY:'auto' }
content:    { display:'flex', flexDirection:'column', gap:'20px', maxWidth:'760px', padding:'24px' }
hero:       { display:'flex', alignItems:'center', gap:'16px' }
heroIcon:   { color: tokens.colorBrandForeground1, fontSize:'56px', flexShrink:0 }
muted:      { color: tokens.colorNeutralForeground2 }
section:       { display:'flex', flexDirection:'column', gap:'12px' }
sectionHeader: { display:'flex', flexDirection:'column', gap:'4px' }
subsection:    { display:'flex', flexDirection:'column', gap:'8px', marginTop:'8px' }
footer:         { flexShrink:0, padding:'16px 24px', backgroundColor: tokens.colorNeutralBackground1,
                  borderTop:'1px solid transparent',
                  transitionProperty:'box-shadow, border-top-color',
                  transitionDuration: tokens.durationNormal,
                  transitionTimingFunction: tokens.curveEasyEase }
footerElevated: { borderTopColor: tokens.colorNeutralStroke2, boxShadow:'0 -2px 6px rgba(0,0,0,0.08)' }
footerNote:     { display:'flex', alignItems:'flex-start', gap:'8px', color: tokens.colorNeutralForeground2 }
footerNoteIcon: { color: tokens.colorNeutralForeground3, display:'block', fontSize:'16px',
                  height: tokens.lineHeightBase200, flexShrink:0 }
stageList: { display:'flex', flexDirection:'column', gap:'12px', padding:'16px',
             border:`1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium }
```

`footerNoteIcon` uses `display: block` deliberately — it drops the inline descender space so the
glyph shares the text's first line box.

### 1.3 `StageRow` today, for reference

The richer of the two versions, from `localQuickStart`:

```ts
interface StageRowProps {
    readonly label: string;
    readonly status: StageStatus;      // 'pending' | 'active' | 'done' | 'error'
    readonly detail?: string;          // evidence, kept after the stage settles
    readonly meta?: string;            // appended to the evidence line
    readonly action?: ReactNode;       // inline control on the evidence line
    readonly reserveDetail?: boolean;
}
```

Atlas's is `{ label, status }` only, but its `StageStatus` additionally carries `'warning'`.

---

## 2. Two decisions, settled

Both were open when this plan was drafted. Both were answered on 2026-08-19 and must be transcribed
into `decisions.md` — the wording below is the record, not a proposal.

### 2.1 The gate widens: reusable components, not only VS Code adapters — **accepted, as 0021**

Decision 0001 admitted a thing only if it "solves a VS Code **integration** problem, not a product
problem", and 0002 sharpened that into the question people actually ask: _does this exist because
Fluent does not behave correctly inside a VS Code webview?_ A wizard surface fails that as literally
worded. Fluent behaves fine; it simply ships no such component.

**Operator decision:** condition 1 is too narrow and is relaxed.

> The package ships **reusable components useful to other Fluent UI consumers** — other products and
> other extensions — not only adapters that patch Fluent's behaviour inside a webview. A wizard
> surface belongs here on exactly that basis: Fluent's own surface components (`Dialog`, `Drawer`)
> all assume an overlay above existing application chrome, Fluent ships no surface for a wizard that
> **is** the window, and every consumer that needs one otherwise rebuilds the same header / scroll /
> pinned-footer shell.

**What this costs, stated so the next person knows.** Condition 1 was the strictest of the four and
did most of the visible filtering. With it widened, **conditions 2, 3 and 4 now carry the whole
gate**, and condition 3 — _does a second consumer actually exist?_ — becomes the load-bearing one.
"Would this be useful?" is always yes; "who is the second consumer?" still has an answer or it does
not. The name chosen in 0002 keeps doing its work too: `fluentui` names the boundary, so a Monaco
wrapper is still rejected on sight.

### 2.2 `MessageBlock` stays in the extension — **decided, as 0022**

It is not a token re-point, so 0019 rules out shipping it as a global `:where()` override: it has to
be a component either way.

**Operator decision:** make it a component, but keep it **in the extension**, not in the package.

The reasoning is the honest one. Its shape follows from how _this product_ uses `MessageBar` — as a
full-fledged block element inside the content flow rather than a slim strip above it, so it is not
fighting for vertical space and a stacked title costs nothing. That is a house style, and 2.1 widened
the gate to admit reusable components, not to admit house style. Condition 3 also has no answer
here: there is no second consumer for it.

So: `src/webviews/components/MessageBlock.tsx`, deduplicating the eight call sites listed in §4.6,
and out of the package's public surface entirely. If a second consumer ever appears, promoting it is
a later, smaller decision.

---

## 3. The shape

Two tiers. The rule that keeps them honest is **invariant I3**, already recorded for
`VSCodeFluentProvider`: the facade may use nothing a consumer could not use. `Wizard` is built
entirely on public tier-1 API, which is what stops it growing private escape hatches and what gives
a consumer who outgrows it a step down rather than a cliff.

### 3.1 Public surface, all under the `./components` entry

| Family | Components                                                                                                        |
| ------ | ----------------------------------------------------------------------------------------------------------------- |
| Chrome | `Container` `ContainerHeader` `ContainerBody` `ContainerNav` `ContainerMain` `ContainerSection` `ContainerFooter` |
| Steps  | `StepList` `StepListItem`                                                                                         |
| Facade | `Wizard` `WizardStep`                                                                                             |
| Status | `StatusList` `StatusListItem`                                                                                     |

`MessageBlock` is **not** here — per §2.2 it is an extension-local component. It is specified in
§4.6 because both webviews consume it and the increment builds it.

`WizardBreadcrumb` and `WizardStepMeta` are **removed** from the public surface, superseded by
`StepList` / `StepListItem`. A breaking change, free to make while the package is `private: true` at
`0.1.0-preview` and expensive after publish.

No `WizardHeader` / `WizardFooter`: `Wizard`'s `header` and `footer` slots take `ContainerHeader` and
`ContainerFooter`. Fewer names, and it makes the facade relationship visible in the consumer's own
code.

### 3.2 Tier 1 — loose composition

```tsx
<Container>
    <ContainerBody navPosition="top">
        <ContainerHeader media={<RocketRegular />} title="DocumentDB Local" subtitle="…" action={…} />
        <ContainerNav>
            <StepList selectedValue={step} onStepSelect={(_e, d) => goToStep(d.value)} ariaLabel="Setup steps">
                <StepListItem value="introduction" completed>Introduction</StepListItem>
                <StepListItem value="configure" completed navigable>Configure</StepListItem>
                <StepListItem value="setup">Set up</StepListItem>
                <StepListItem value="done">Done</StepListItem>
            </StepList>
        </ContainerNav>
        <ContainerMain>
            <ContainerSection title="…" subtitle="…" focusOnMount>…</ContainerSection>
        </ContainerMain>
    </ContainerBody>
    <ContainerFooter note="…" contentEnd={<Button>Learn more</Button>}>
        <Button appearance="primary">Start</Button>
        <Button>Back</Button>
    </ContainerFooter>
</Container>
```

**The markup does not change between orientations.** Only `navPosition` and `StepList vertical`
flip.

### 3.3 Tier 2 — the facade

```tsx
<Wizard
    activeStep={stepForPhase(phase)}
    onStepChange={goToStep}
    navPosition="top"
    stepsLocked={isProvisioning || phase === 'success'}
    stepsAriaLabel={l10n.t('Setup steps')}
    header={<ContainerHeader media={<RocketRegular />} title={…} subtitle={…} action={…} />}
    footer={
        <ContainerFooter note={footerNote} contentEnd={<Button>{l10n.t('Learn more')}</Button>}>
            <Button appearance="primary" icon={primaryIcon} onClick={onPrimary}>{primaryLabel}</Button>
            {secondaryActions}
        </ContainerFooter>
    }
>
    <WizardStep value="introduction" label={l10n.t('Introduction')} title={…} subtitle={…}>…</WizardStep>
    <WizardStep value="configure"    label={l10n.t('Configure')}    title={…} subtitle={…}>…</WizardStep>
    <WizardStep value="setup"        label={l10n.t('Set up')}       title={…} subtitle={…}>
        {isProvisioning ? provisioningBody : failureBody}
    </WizardStep>
    <WizardStep value="done"         label={l10n.t('Done')}         title={…} subtitle={…}>…</WizardStep>
</Wizard>
```

Its whole implementation, tier-1 only:

```tsx
const steps = Children.toArray(children).filter(isWizardStep);
const activeIndex = steps.findIndex((s) => s.props.value === activeStep);
const active = steps[activeIndex];

<Container>
    <ContainerBody navPosition={navPosition}>
        {header}
        <ContainerNav>
            <StepList
                vertical={navPosition === 'start'}
                selectedValue={activeStep}
                onStepSelect={(_e, d) => onStepChange(d.value)}
                ariaLabel={stepsAriaLabel}
                overflowAriaLabel={overflowAriaLabel}
            >
                {steps.map((s, i) => (
                    <StepListItem
                        key={s.props.value}
                        value={s.props.value}
                        completed={s.props.completed ?? defaultCompleted(i, activeIndex, steps.length)}
                        navigable={s.props.navigable ?? (i < activeIndex && !stepsLocked)}
                    >
                        {s.props.label}
                    </StepListItem>
                ))}
            </StepList>
        </ContainerNav>
        <ContainerMain>
            <ContainerSection
                key={activeStep}
                title={active.props.title ?? active.props.label}
                subtitle={active.props.subtitle}
                action={active.props.action}
                focusOnMount
            >
                {active.props.children}
            </ContainerSection>
        </ContainerMain>
    </ContainerBody>
    {footer}
</Container>
```

`key={activeStep}` is what makes `focusOnMount` fire on every step change and unmounts the previous
step's body.

### 3.4 Why a facade at all, when the flat form was on the table

The flat form removed the CSS duplication and left the awkward part untouched: the consumer still
maintained a `steps` array whose ids had to stay in sync with a `{phase === 'x' && …}` ladder. The
facade removes that. Labels are declared once, beside their content; switching is one prop; and the
completed / navigable derivation happens in one place instead of two.

The earlier objection — "the two consumers derive steps incompatibly, so no shared abstraction
exists" — was wrong. The incompatibility lives entirely in the **phase → step** mapping, which stays
consumer-side. `Wizard` only ever sees steps.

- Local's five phases map to four steps: `provisioning` and `failed` both pass `activeStep="setup"`,
  and the difference is a conditional **inside** that step's children.
- Atlas's edit mode drops a step: do not render that `<WizardStep>`.

### 3.5 Where the API shape comes from

Every structural choice above has a Fluent precedent. Recorded here because the next person to add
something will need the same reference.

| Fluent component | Structure                                                                                                | Extension points                                                                                                                                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dialog**       | `Dialog > DialogSurface > DialogBody > (DialogTitle, DialogContent, DialogActions)`                      | `DialogTitle` has an `action` **slot** defaulting to a close button, opted out with `action={null}`. `DialogActions` takes `fluid` and `position: 'start' \| 'end'` — the precedent for two button groups in one footer.   |
| **Drawer**       | `DrawerHeader > DrawerHeaderTitle`, `DrawerHeaderNavigation`, `DrawerBody` (owns scroll), `DrawerFooter` | `DrawerHeaderTitle` slots `heading` and `action`. Layout modes are small enums: `position`, `size`, `separator`. Its docs also warn that a body with no focusable content needs `tabIndex={0}` for keyboard scroll access. |
| **Card**         | `Card > (CardPreview, CardHeader, CardFooter)`                                                           | `CardHeader` slots `image`, `header`, `description`, `action` — structurally our header. `Card` slots `floatingAction`, `checkbox`. Modifiers `appearance`, `size`, `orientation`, `focusMode`.                            |
| **TabList**      | `TabList > Tab`, panels rendered by the consumer                                                         | `vertical?: boolean`, `selectedValue` / `onTabSelect`, `reserveSelectedTabSpace`. Fluent ships the **selector**, not the two-column layout.                                                                                |
| **MessageBar**   | CSS grid with named areas; children carry their own `gridArea`                                           | The precedent for orientation by `grid-template-areas` — and the reason option A in §4.2 looked viable until the overlap problem surfaced.                                                                                 |

The consistent rule, and the one this increment follows: **structural children where the consumer
supplies arbitrary content, named slots where the position is fixed, small enum props for layout
modes**, plus native props and `className` on everything as the escape hatch.

Two consequences worth stating plainly:

- Fluent ships **no** wizard surface. Its own Dialog guidance points at building "a multi-step
  wizard within a single dialog" — there is no upstream component to defer to.
- `TabList` does not solve the vertical layout for its consumer. By shipping `navPosition` we go one
  step past what Fluent does. That is the difference between a control and a template, and it is
  deliberate.

---

## 4. Component specifications

### 4.1 `Container` family

| Component          | Renders                     | Owns                                                                                                                                                                                                                                                         |
| ------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Container`        | `<div>`                     | `flex` column, `height: 100%`, `overflow: hidden`, `position: relative`. Provides the shared context.                                                                                                                                                        |
| `ContainerBody`    | `<div>`                     | the **only** scroll container: `flex: 1`, `minHeight: 0`, `overflowY: auto`; the content grid, `maxWidth 760`, `padding 24`, `gap 20`. Measures overflow and publishes it.                                                                                   |
| `ContainerHeader`  | header block                | `flex` row, `gap 16`; media wrapper, title, subtitle, `action` pinned to the end.                                                                                                                                                                            |
| `ContainerNav`     | `<div>` grid area `nav`     | nothing but placement.                                                                                                                                                                                                                                       |
| `ContainerMain`    | `<main>` grid area `main`   | `flex` column, `gap 20`.                                                                                                                                                                                                                                     |
| `ContainerSection` | `<section aria-labelledby>` | `flex` column `gap 12`; heading + subtitle at `gap 4`; optional focus-on-mount.                                                                                                                                                                              |
| `ContainerFooter`  | `<div>`                     | `flex` column `gap 12`, `flexShrink 0`, `padding 16px 24px`, `colorNeutralBackground1`, `borderTop: 1px solid transparent`, transition on `box-shadow, border-top-color` at `durationNormal` / `curveEasyEase`. Consumes overflow state and elevates itself. |

```ts
interface ContainerHeaderProps {
    readonly media?: ReactNode;      // icon or image
    readonly title: ReactNode;
    readonly subtitle?: ReactNode;
    readonly action?: ReactNode;     // end-aligned
    readonly headingLevel?: 1 | 2;   // default 1
}

interface ContainerBodyProps {
    readonly navPosition?: 'top' | 'start';   // default 'top'
}

interface ContainerSectionProps {
    readonly title?: ReactNode;      // heading, wired to the section's aria-labelledby
    readonly subtitle?: ReactNode;   // the one line of guidance
    readonly action?: ReactNode;
    readonly focusOnMount?: boolean; // WCAG 2.4.3; suppressed on the Container's first render
    readonly headingLevel?: 2 | 3;   // default 2
}

interface ContainerFooterProps {
    readonly note?: ReactNode;       // info icon + small text, above the actions row
    readonly contentEnd?: ReactNode; // end-aligned trailing content
    readonly children: ReactNode;    // the action buttons, in order
}
```

`contentEnd` is named after Fluent's `contentBefore` / `contentAfter` family: logical direction, so
RTL comes free, and it bakes in no semantics. Rejected: `aside` (carries the HTML landmark
connotation), `secondaryAction` ("Back" is also secondary), `action` (collides with the children,
which are already actions), `help` (presumes a purpose the slot does not have). The alternative
considered and set aside was two `position="start" | "end"` action groups, mirroring `DialogActions`
exactly — correct, but one wrapper of ceremony in every common case.

`media` is a `ReactNode` and may be anything. Its wrapper is a fixed 56 × 56 flex box with
`color: colorBrandForeground1`, `fontSize: '56px'`, `flexShrink: 0`, and
`& > * { maxWidth: 100%; maxHeight: 100% }` so an `<img>` fits without needing the font-size path.
Omitted `media` collapses; no reserved gap.

The header is a child of `ContainerBody` because that is today's deliberate behaviour — the hero
scrolls away, only the footer is pinned. A consumer wanting a pinned header places
`ContainerHeader` as a direct child of `Container` instead; `flex-shrink: 0` makes that work with no
extra API. Both positions are documented.

**The context earns the whole family.** `ContainerBody` measures overflow and publishes it;
`ContainerFooter` elevates itself. `Container` records whether it has rendered once, so
`focusOnMount` can skip the first paint. The consumer stops owning two refs, a `ResizeObserver` and
a WCAG rule.

### 4.2 Orientation — why `ContainerNav` and `ContainerMain` exist

```
navPosition="top"    →  "header" / "nav" / "main"
navPosition="start"  →  "header header" / "nav main"
```

Three ways to reach that were considered:

|     | Approach                                                                                                                         | Verdict                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | Grid areas carried by the children; `ContainerBody` switches `grid-template-areas`. Fluent's own `MessageBar` does exactly this. | **Rejected.** Works only when the content is a single element. Two arbitrary content children both land in the `main` area and overlap — and local's Configure step has several sections plus message bars. |
| B   | Explicit region components, `ContainerNav` + `ContainerMain`.                                                                    | **Chosen.** Each region is one grid item, so each is its own flex column and holds any number of children. No overlap trap, identical markup in both orientations. Costs one nesting level.                 |
| C   | `React.Children` partitioning inside `ContainerBody`.                                                                            | Rejected for tier 1, where the promise is "what you write is what you get". Fragments silently break it. Acceptable inside the facade, which is where it is used.                                           |

A wrapper-free variant of B exists — `grid-template-columns: auto minmax(0,1fr)` with
`grid-row: 2 / -1` on the nav and content auto-placing into column 2 — but it leans on implicit-grid
line resolution that is easy to get subtly wrong. Not worth saving one element.

`navPosition` rather than `vertical`: on the container, "vertical" does not say _what_ is vertical.
The prop names the thing that moves. `'start'` is logical direction, so RTL comes free, and it is
already Fluent vocabulary (`DialogActions position`, `Drawer position`).

### 4.3 `StepList` / `StepListItem`

Modelled directly on `TabList` / `Tab`:

```ts
interface StepListProps {
    readonly vertical?: boolean;                       // TabList's spelling
    readonly selectedValue: string;
    readonly onStepSelect: (event: React.SyntheticEvent, data: { value: string }) => void;
    readonly ariaLabel: string;
    readonly overflowAriaLabel?: (count: number) => string;   // English default
}

interface StepListItemProps {
    readonly value: string;
    readonly completed?: boolean;
    readonly navigable?: boolean;
    readonly children: ReactNode;   // the label
}
```

Controlled only. An uncontrolled mode has no use in a wizard, where the consumer always drives.

Horizontal keeps today's behaviour: Fluent `Breadcrumb` inside `Overflow` with
`minimumVisible={1}`, `BreadcrumbButton` with `current` and `aria-current="step"`,
`disabledFocusable` for non-navigable steps, `MoreHorizontal` overflow menu. Completed steps stay
`fontWeightSemibold` so a step does not change width when it stops being current — Fluent's own
`reserveSelectedTabSpace` exists for the same reason.

Vertical is **not implemented in this increment**. The prop exists and the layout accepts it; the
vertical rendering is a later iteration. Shipping the prop now is what keeps that iteration additive
rather than breaking.

Carried forward for that iteration: a left rail normally wants to stay put while content scrolls,
which implies the header pins too. That combination is already expressible — `navPosition="start"`
plus moving `ContainerHeader` up to be a direct child of `Container`. No new API is expected to be
needed, which is the point of settling the shape now.

The rename from `WizardBreadcrumb` is not cosmetic. "Breadcrumb" describes the Fluent primitive the
horizontal form happens to use; a vertical rail is not a breadcrumb, and the name would be wrong the
moment the next iteration lands.

### 4.4 `Wizard` / `WizardStep`

```ts
interface WizardProps {
    readonly activeStep: string;
    readonly onStepChange: (value: string) => void;
    readonly navPosition?: 'top' | 'start';
    readonly stepsLocked?: boolean;
    readonly stepsAriaLabel: string;
    readonly overflowAriaLabel?: (count: number) => string;
    readonly header?: ReactNode;    // a ContainerHeader
    readonly footer?: ReactNode;    // a ContainerFooter
    readonly children: ReactNode;   // WizardStep only
}

interface WizardStepProps {
    readonly value: string;
    readonly label: ReactNode;      // shown in the step list
    readonly title?: ReactNode;     // the section heading; defaults to `label`
    readonly subtitle?: ReactNode;
    readonly action?: ReactNode;
    readonly completed?: boolean;   // overrides the default
    readonly navigable?: boolean;   // overrides the default
}
```

Defaults extracted from both consumers, which converged on them independently:

```ts
const defaultCompleted = (i: number, active: number, count: number): boolean =>
    i === 0 || i < active || (i === count - 1 && i === active);
const defaultNavigable = (i: number, active: number, locked: boolean): boolean => i < active && !locked;
```

Atlas additionally restricts navigation to two specific steps; that is what the per-step `navigable`
override is for.

Only the active step renders, so focus-on-mount falls out of mounting and heavy step bodies do not
stay resident.

Accepted costs: nothing can be injected between header and step list — neither consumer does today;
children must be `WizardStep`, `false` or `null`, so a fragment breaks it, which is a documented
constraint; and `Wizard` becomes the package's largest component, which is what a template is.

### 4.5 `StatusList` / `StatusListItem`

```ts
type StatusListItemStatus = 'pending' | 'active' | 'done' | 'error' | 'warning';

interface StatusListProps {
    readonly ariaLabel: string;
    readonly statusLabels?: Partial<Record<StatusListItemStatus, string>>;   // English defaults
    readonly children: ReactNode;
}

interface StatusListItemProps {
    readonly label: ReactNode;
    readonly status: StatusListItemStatus;
    /** One line under the label. Anything: text, a `Link`, a joined sentence. */
    readonly detail?: ReactNode;
    /** Holds the detail line's height before it has content, so the row never grows later. */
    readonly reserveDetailSpace?: boolean;
}
```

Four props on the item. `meta` and `action` — separate props in local today — fold into `detail`,
which is a `ReactNode` the consumer composes freely. That also removes the `·` joiner from the
package, so the localization of the separator stays with the consumer instead of needing an escape
hatch.

`reserveDetailSpace` is named after `TabList.reserveSelectedTabSpace`, which solves the same problem
in the same shape. It renders `<span aria-hidden>{'\u00a0'}</span>`; the `aria-hidden` half is the
reason it stays a boolean rather than "pass a non-breaking space yourself". Local applies it to one
of six stages — `checking`, whose detail line is empty on first paint because Docker readiness loads
in the background while the user is still reading the Introduction, and which would otherwise grow
the row and shift everything below it when the result lands.

Rejected names: `reserveDetail` (the original — reads as reserving the detail rather than the space,
which is exactly what confused a reader), `reserveDetailLine` (fine, but no Fluent precedent),
`expectsDetail` (names the consumer's knowledge, not the effect), `detailPlaceholder` (reads like it
takes a value).

Styles, carried over from local:

| Element     | Declarations                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| list        | `flex` column · `gap 12` · `padding 16` · `1px solid colorNeutralStroke2` · `borderRadiusMedium` · `role="list"` |
| row         | `flex` · `alignItems: flex-start` · `gap 10` · `minHeight 20` · `role="listitem"`                                |
| icon box    | `18 × lineHeightBase300` · `flexShrink 0` · `display grid` · `placeItems center`                                 |
| copy column | `flex` column · `gap 1` · `minWidth 0` · `alignItems flex-start`                                                 |
| label       | `colorNeutralForeground2` when `pending`, plus a visually-hidden status word                                     |
| detail      | `fontSizeBase200` / `lineHeightBase200` / `colorNeutralForeground2`                                              |

| `status`  | glyph                       | colour                          |
| --------- | --------------------------- | ------------------------------- |
| `done`    | `CheckmarkCircleFilled`     | `colorPaletteGreenForeground1`  |
| `error`   | `ErrorCircleFilled`         | `colorPaletteRedForeground1`    |
| `warning` | `WarningRegular`            | `colorStatusWarningForeground1` |
| `active`  | `Spinner size="extra-tiny"` | —                               |
| `pending` | `CircleHintFilled`          | `colorNeutralForeground4`       |

All glyphs 18px.

The detail wrapper normalises inline controls by **element**, never by `fui-*` class:

```ts
'& a, & button, & label': { fontSize: 'inherit', lineHeight: 'inherit' }
```

That covers `Link`, which renders a `<button>` when given `onClick` without `href`. It replaces the
`stageInlineLink` class the consumer hand-writes today.

Settled behaviour:

- **No row-level `aria-label`.** The status is a visually-hidden span appended to the label. A
  row-level label would make interactive content inside `detail` unreachable — and with `detail`
  open to arbitrary content that is now a guarantee, not an observation.
- **No `aria-live`.** Local already streams progress through a separate `role="status"` region;
  live semantics here would double-announce.
- **No custom icon slot.** A fixed status vocabulary is the point.
- **The border belongs to the component**, not to a Fluent `Card` the consumer wraps around it.

Staying in the consumer: elapsed-time counters, live stage streaming, Docker recovery command
blocks, the diagnostics accordion, and the `role="status"` narration region.

### 4.6 `MessageBlock` — extension-local

Lives at `src/webviews/components/MessageBlock.tsx`, beside `MonacoEditor.tsx` and
`InputWithProgress.tsx`. Not exported from the package (§2.2). Specified here because both webviews
consume it and this increment builds it.

```tsx
<MessageBlock
    intent="error"
    title={l10n.t('Setup did not finish')}
    actions={<><Button>Retry</Button><Button>Show details</Button></>}
>
    {message}
</MessageBlock>
```

```ts
interface MessageBlockProps {
    readonly intent?: 'info' | 'success' | 'warning' | 'error';
    readonly title?: ReactNode;
    readonly icon?: ReactNode;      // overrides the intent's default glyph
    readonly actions?: ReactNode;
    readonly children: ReactNode;
}
```

Internally `MessageBar layout="multiline"` with a column-stacked `MessageBarBody` at `gap 8`,
`MessageBarTitle`, and `MessageBarActions`. Fluent's own `layout` prop controls whether the
**actions** wrap to their own line; it offers no way to give the **title** its own line, which is
the gap this fills.

The duplication it replaces — the same six declarations under three names, across eight call sites
in `LocalQuickStart.tsx` (lines ~1998, ~2052, ~2148, ~2352, ~2409) and `AtlasCredentialsView.tsx`:

```ts
stackedMessageBarBody:  { display: 'flex', flexDirection: 'column', gap: '8px' }   // local
titleAndMessageBarBody: { display: 'flex', flexDirection: 'column', gap: '8px' }   // local, again
messageContent:         { display: 'flex', flexDirection: 'column', gap: '8px' }   // atlas
```

Name notes: `MessageBox` carries the Win32 modal-dialog association and is rejected. `Notice` is the
alternative if `MessageBlock` reads as too mechanical. Being extension-local, the name is cheap to
change later and needs no package decision.

It takes `vscode.l10n.t()` strings freely, unlike anything in the package — that freedom is one of
the things staying in the extension buys.

---

## 5. File and folder structure

### 5.1 How Fluent actually does it

Not flat. Grouped, and grouped **by component**, never by category. `react-accordion`:

```
packages/react-components/react-accordion/
├── library/
│   ├── docs/Spec.md                        # sample code, expected DOM output, a11y reasoning
│   ├── etc/react-accordion.api.md          # API Extractor report, committed and reviewed
│   └── src/
│       ├── index.ts                        # package barrel
│       ├── Accordion.ts                    # per-component re-export, for subpath imports
│       ├── AccordionHeader.ts
│       ├── components/
│       │   ├── Accordion/
│       │   │   ├── Accordion.tsx                  # thin forwardRef, ~5 lines of body
│       │   │   ├── Accordion.types.ts             # Props / Slots / State / ContextValues
│       │   │   ├── useAccordion.ts                # state hook
│       │   │   ├── useAccordionContextValues.ts
│       │   │   ├── renderAccordion.tsx            # JSX assembled from state slots
│       │   │   ├── useAccordionStyles.styles.ts   # classNames map + makeStyles + mergeClasses
│       │   │   ├── index.ts
│       │   │   └── *.test.tsx
│       │   ├── AccordionHeader/                   # same six-file shape
│       │   ├── AccordionItem/
│       │   └── AccordionPanel/
│       ├── contexts/                       # cross-component contexts, sibling of components/
│       └── testing/
└── stories/src/Accordion/
    ├── index.stories.tsx               # title, component, subcomponents, description
    ├── AccordionDescription.md         # the prose at the top of the docs page
    ├── AccordionDefault.stories.tsx    # one file per story
    └── AccordionCollapsible.stories.tsx
```

The closer precedent for a **multi-family** package is
`react-headless-components-preview`, which nests one level further —
`components/Accordion/{Accordion.tsx, AccordionHeader/, AccordionItem/, AccordionPanel/}`. The
family folder is named after its **root component**, in PascalCase, never after a category.

**What not to copy.** The six-file `useX` / `renderX` / `useXStyles.styles` split exists because of
Fluent's slot architecture: `useX` returns a state object of slot descriptors, `renderX` assembles
them, `useXStyles` merges class names onto them. We are writing plain components with `makeStyles`
and no slot machinery. Reproducing that split would be cargo cult. Likewise the root-level
`Accordion.ts` re-export files exist to serve subpath entries; we have exactly one, `./components`.

### 5.2 Package

```
packages/vscode-ext-webview-fluentui/src/
├── components.ts                       # unchanged — the "./components" entry
├── components.test.ts                  # unchanged — asserts the entry injects no stylesheet (I1)
└── components/
    ├── README.md                       # the scope gate + the contents table, updated
    ├── index.ts                        # the single public barrel for this entry
    ├── Container/
    │   ├── Container.tsx               # root element + context provider
    │   ├── Container.types.ts          # every exported prop interface for the family
    │   ├── ContainerHeader.tsx
    │   ├── ContainerBody.tsx           # the scroll region, the content grid, overflow measurement
    │   ├── ContainerNav.tsx
    │   ├── ContainerMain.tsx
    │   ├── ContainerSection.tsx
    │   ├── ContainerFooter.tsx
    │   ├── useOverflowState.ts         # the scroll + ResizeObserver measurement
    │   ├── index.ts
    │   ├── README.md                   # the layout contract, and why the header is a body child
    │   └── *.test.tsx
    ├── StepList/
    │   ├── StepList.tsx                # absorbs the whole of today's WizardBreadcrumb
    │   ├── StepListItem.tsx
    │   ├── StepList.types.ts
    │   ├── index.ts
    │   └── *.test.tsx
    ├── Wizard/
    │   ├── Wizard.tsx
    │   ├── WizardStep.tsx              # declarative marker; renders nothing on its own
    │   ├── Wizard.types.ts
    │   ├── wizardStepState.ts          # defaultCompleted / defaultNavigable, pure and tested
    │   ├── index.ts
    │   ├── README.md                   # the homogeneous-children constraint
    │   └── *.test.tsx
    ├── StatusList/
    │   ├── StatusList.tsx
    │   ├── StatusListItem.tsx
    │   ├── StatusList.types.ts
    │   ├── index.ts
    │   └── *.test.tsx
    ├── contexts/                       # Fluent's name; only contexts crossing family boundaries
    │   ├── container.ts                # overflow flag + first-render flag
    │   └── statusLabels.ts             # status words + English defaults
    └── utils/
        ├── srOnly.ts                   # the visually-hidden Griffel class, needed by two families
        └── useIsFirstRender.ts
```

`components/wizard/WizardBreadcrumb.tsx` is **deleted**; its `Overflow` / `Breadcrumb`
implementation moves into `StepList/StepList.tsx`.

Nothing under `theme/`, `styles/`, `palette/` or the `"."` entry changes.

### 5.3 Conventions this layout assumes

- **PascalCase folder per family, named after its root component.** Fluent's convention, and it
  removes the mismatch a category name creates — `StepList/` rather than `steps/`, `StatusList/`
  rather than `message/`.
- **A component gets its own subfolder only when it outgrows one file.** Fluent's per-component
  folders hold six files each; ours hold one. If `ContainerFooter` ever needs its own types and
  styles files, it becomes `Container/ContainerFooter/` — exactly the escalation
  `react-headless-components-preview` already models.
- **`X.types.ts` per family.** Fluent always splits types out, and it makes the public type surface
  obvious at a glance. Worth adopting even though our components are simple.
- **`contexts/` and `utils/` are Fluent's own names** for the two cross-cutting folders. Neither is
  exported. The solvent warning in 0002 governs what enters the **package**; it does not require us
  to invent names for internal organisation that Fluent has already settled.
- **`index.ts` per folder.** Only `components/index.ts` is public; the family barrels exist so a
  family can be moved or split without touching the public one.
- **Barrels are safe here.** `sideEffects` lists only `./dist/index.js`, so `dist/components.js` is
  side-effect-free and tree-shakes. This is also what keeps I1 true: importing `./components` must
  never pull in `theme/` or `styles/`.
- **`.tsx` for components, `.ts` for types, pure logic and contexts.**
- **Relative imports carry `.js`.** The existing barrel already writes
  `from './wizard/WizardBreadcrumb.js'`; the package is ESM and this is easy to get wrong when adding
  files.
- **Tests are colocated**, matching both Fluent and `theme/core/themeGenerator.test.ts`.
- **READMEs only where a folder carries a non-obvious rule** — `Container/` (the layout contract)
  and `Wizard/` (children must be `WizardStep`).

### 5.4 `WizardStep` needs a brand, not a `type ===` check

`Wizard` filters its children by identity. A bare `child.type === WizardStep` comparison breaks under
duplicate module instances — two copies of the package in a consumer's tree, or fast-refresh during
development — and fails silently by rendering nothing. Use a static symbol on the component and test
for it:

```ts
const wizardStepBrand = Symbol.for('vscode-ext-webview-fluentui.WizardStep');
```

The accompanying test asserts that a non-`WizardStep` child is ignored rather than rendered into the
step list.

### 5.5 Documentation, in Fluent's style

The Fluent docs page is generated, not written. Its parts:

| Section on the page                                 | Where it comes from                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| the prose at the top                                | `AccordionDescription.md`, wired through `parameters.docs.description.component` |
| **Best practices — Do / Don't**                     | the same markdown file                                                           |
| the props tables                                    | **auto-generated from the TypeScript types and the JSDoc on each prop**          |
| the tabs above the props table                      | the `subcomponents` key in `index.stories.tsx`                                   |
| each story, its heading and its paragraph           | one `*.stories.tsx` file per story, aggregated by `index.stories.tsx`            |
| "Native props are supported", "Customizing … slots" | global Storybook decorators, not per-component                                   |
| sample code, **expected DOM output**, a11y notes    | `library/docs/Spec.md`, in the repository rather than on the site                |

The load-bearing observation: **Fluent's prop JSDoc _is_ the documentation.** Everything else is
assembly.

This repository has **no Storybook** — no dependency, no config, no script. It does have API
Extractor, wired only for the `api/` project, and the live webview preview harness in
[live-preview-playwright.md](../../../live-preview-playwright.md), which mounts a real webview in a
browser off `watch:views`.

**Decision: markdown files only.** One `README.md` per family, no Storybook. What that costs, stated
plainly so nobody rediscovers it later:

| Lost with markdown                      | Why it matters                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| live, interactive examples              | cannot click through a wizard, tab it, or resize it from the docs            |
| the light / dark / RTL switcher         | the one dimension this package exists to get right is the one you cannot see |
| "Show code" tied to the running example | a fenced block is asserted to match the example, never proven                |
| **auto-generated props tables**         | the real risk — see below                                                    |
| "Open in Stackblitz"                    | irrelevant here; nothing runs outside a webview anyway                       |

Only the fourth is a genuine hazard, and it has a clean answer.

**Do not hand-write props tables in markdown.** Fluent's tables cannot drift because they are
generated from the types; a hand-written copy is wrong within two changes and is worse than nothing,
because it is believed. Instead:

- **prop-level documentation lives in JSDoc** and nowhere else. That is not a downgrade — it renders
  in the consumer's editor on hover and at every call site, which is a better place to read it than
  a page in another tab;
- **the markdown links to the types**, it does not restate them;
- **option b below closes the loop.** An API Extractor report is a _generated markdown file_ listing
  the complete public surface with its JSDoc attached. Not a pretty page, but an always-accurate,
  greppable, diff-reviewable props reference that lives beside the hand-written files and cannot go
  stale. It is the piece that makes "markdown only" safe.

Live rendering is not actually zero either: the preview harness already mounts real webviews in a
browser off `watch:views`. What is missing is a link from a document to a rendered example, not the
ability to render one.

### 5.6 The markdown set

```
components/
├── README.md                  # the scope gate, the contents table, how the families compose
├── Container/README.md
├── StepList/README.md
├── Wizard/README.md
└── StatusList/README.md
```

`MessageBlock` gets no README — it is extension-local, and its JSDoc is enough.

Each family file mirrors the Fluent page's sections, minus the ones that need a site:

1. **What it is** — one paragraph, the equivalent of `AccordionDescription.md`.
2. **Anatomy** — the JSX skeleton, so the composition is visible before any prose.
3. **Best practices** — Do / Don't, in Fluent's two-list form.
4. **Examples** — fenced composition recipes, one per scenario worth naming.
5. **Accessibility** — what the component guarantees, and what the consumer still owes. This is the
   section Fluent splits into `docs/Spec.md`, and it is the highest-value one here: the focus rule,
   the visually-hidden status word, the reason `StatusList` rows carry no `aria-label`.
6. **Props** — a pointer to `X.types.ts`. Never a table.

### 5.7 Tooling, ranked

|       | Approach                                                                                                            | Cost                                                                                                               | Verdict                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **a** | **JSDoc-first + the markdown set above.** Fluent's _content_ without Fluent's site.                                 | none                                                                                                               | **Chosen.** Also a prerequisite for b and c: both consume the same JSDoc.                                                                |
| **b** | **a + a committed API report.** API Extractor for this package, producing `etc/vscode-ext-webview-fluentui.api.md`. | one devDependency and one script; the repo already runs API Extractor for `api/`                                   | **Strongly recommended.** It is what removes the drift risk from a, and it directly enforces 0007's "only two entries" in every PR diff. |
| **c** | **Storybook.** Real generated props tables, live examples, the theme switcher, the whole page.                      | a devDependency tree, a build target, a hosting question, and overlap with the preview harness that already exists | **Deferred.** Its own iteration if it happens, never smuggled into this one.                                                             |

One convention worth borrowing from **c** even without Storybook: Fluent's **one file per example**.
An `examples/` folder of small compiling `.tsx` snippets stays honest in a way that fenced blocks in
a README cannot, because the compiler checks them and the preview harness could mount them. Noted,
not proposed — it only pays off once there is somewhere to render them, which is exactly what **c**
would provide.

### 5.8 Extension side

One new file: `src/webviews/components/MessageBlock.tsx` (plus `.test.tsx`), beside the existing
`MonacoEditor.tsx` and `InputWithProgress.tsx`. Nothing else moves — `LocalQuickStart.tsx` and
`AtlasCredentialsView.tsx` shrink in place, and the two SCSS files are deleted only if §8 open
question 2 resolves in favour of the package owning the body reset.

---

## 6. Baseline reconciliation — DocumentDB Local wins every tie

| #   | Local (reference)                                      | Atlas                                 | Resolution                                                                     |
| --- | ------------------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | Footer is a column: optional note above an actions row | Single row, no note                   | Local                                                                          |
| 2   | Footer gap `12` outer / `8` on the actions row         | Gap `8`                               | Local                                                                          |
| 3   | `alignItems: flex-start` on the status row             | `center`                              | Local — identical with no detail line, correct with one                        |
| 4   | Icon box `18 × 20`                                     | `18 × 18`                             | Local, re-expressed as `tokens.lineHeightBase300` rather than a magic `'20px'` |
| 5   | Visually-hidden status span, no row `aria-label`       | Row `aria-label` + `aria-hidden` text | Local                                                                          |
| 6   | No `warning` status                                    | Has `warning`                         | Union — keep `warning`                                                         |
| 7   | Section header gap `4` everywhere                      | `4`, but `formHeader` is `8`          | `4`                                                                            |
| 8   | `flexShrink: 0` on the icon box                        | On the icon colour classes            | Local — the box already prevents shrink                                        |
| 9   | Note sits in the footer above the primary button       | n/a                                   | Keep                                                                           |

Atlas's `warning` is not an Atlas quirk and stays in the union. It is raised for exactly one error
kind, `noProjects`, from `describeNoProjectsError` in `atlasCredentialsRouter.ts`:

> "MongoDB Atlas accepted the credential but returned no projects. The organization may not contain
> any projects, or the credential may need an organization or project role."

The credential is **valid** — authentication succeeded — so an error glyph would misreport it. With
a Service Account the list reads:

```
✓ Signing in to MongoDB Atlas
⚠ Checking access to your projects
○ Saving the credential
```

The whole surface shifts together: `MessageBar` intent goes `error` → `warning`, the glyph goes
`ErrorCircleFilled` → `WarningRegular`, and "Show details" is suppressed because there is no failure
to inspect. It is the general "succeeded, but you probably cannot proceed" state, and nothing about
it is Atlas-specific.

---

## 7. Consumer changes

### 7.1 Both webviews

- Replace the chrome, hero, footer, `StageRow`, elevation effect, focus effect and step-derivation
  code with the components above.
- Delete `localQuickStart.scss` and `atlasCredentials.scss` if `body { padding: 0 }` is their only
  content — see §8 open question 2.
- Import from `@microsoft/vscode-ext-webview-fluentui/components`; drop the `WizardBreadcrumb`
  import.

### 7.2 `LocalQuickStart.tsx` — the re-check should set `active`, not fake a spinner

`handleCheckDockerAgain` (line ~1465) sets `checkingDockerAgain` but never touches `stageStatus`, so
the `checking` stage stays `'error'` for the whole re-check and the in-flight signal is faked with a
`Spinner` embedded in the detail line. That inline spinner is the sole reason `stageInlineSpinner`
and its `& .fui-Spinner__label` rule exist.

Set `stageStatus.checking = 'active'` for the duration instead:

- the row's own status icon spins, because that is already what `active` renders;
- `detail` drops to plain text;
- `stageInlineSpinner` and the `.fui-Spinner__label` rule are deleted, removing the **last** `fui-*`
  coupling from `StatusList`;
- a screen reader stops hearing "failed" while a re-check is actively running.

**Required companion change.** Line ~1401 currently reads:

```ts
setStageStatus((prev) => (prev.checking === 'error' ? { ...prev, checking: 'done' } : prev));
```

Once the re-check sets `'active'`, that guard stops matching and a successful re-check never flips
the stage to `done`. It has to accept `'active'` as well.

### 7.3 Small cleanups found while comparing

- `LocalQuickStart.tsx:2152` — `</MessageBarTitle>{' '}` inside a column-layout body, a leftover
  space from the inline form.
- `AtlasCredentialsView.tsx` — `formHeader` uses `gap: 8` where the file's own `sectionHeader` uses
  `4`. A drift against the recorded baseline, not a deliberate difference.

---

## 8. Open questions for review

1. **`Container` as a name.** Chosen over `Page`, which claims the whole document when the premise
   is that the consumer hosts this at whatever size. Rejected: `Pane` (collides with VS Code's own
   pane/panel vocabulary), `Surface` (confusable with `DialogSurface`), `Layout` (taken by the
   Next/Remix convention), `Frame` (a webview literally _is_ an iframe). Accepted cost: the member
   names carry all the meaning — as they do for Fluent's own `Card` and `List`.
2. **`body { padding: 0 }`.** Stays in each consumer as documented setup, or the package injects it?
   Decision 0011 already accepts document-global reach for the Fluent overrides, but this is not a
   Fluent override.
3. **Root height.** `height: 100%` plus a documented one-line host requirement, or keep today's
   `100vh`? `100%` is more honest for a hosted component; `100vh` is drop-in.
4. **Body metrics as API.** `maxWidth 760`, `padding 24`, `gap 20` — expose `maxWidth`, or expose
   nothing and rely on `className`?
5. **`Announcer`** (`src/webviews/components/accessibility/Announcer.tsx`) is used by both consumers
   and is plain React plus `aria-live`. It fails the Fluent framing but passes every other
   condition. Extract alongside, or defer?
6. **`MessageBlock` vs `Notice`** as the name. Extension-local per §2.2, so this is cheap to revisit
   and blocks nothing.

---

## 9. Non-goals

- **Step or phase state.** Local maps five phases onto four steps; Atlas drops a step in edit mode;
  their lock rules differ. `Wizard` is controlled and never owns navigation logic.
- **Button label and disabled matrices.** Local swaps the primary button mid-provisioning and
  manages focus across the swap; Atlas keeps a static footer. No shared abstraction exists.
- **Vertical `StepList` rendering.** The prop ships; the rendering is a later iteration.
- **Everything Docker**, and **everything Atlas**.
- **Generic vertical-stack primitives.** `messageContent`, `titleAndMessageBarBody` and
  `stackedMessageBarBody` are all `flex column gap 8`. A `Stack` primitive is exactly what the scope
  gate exists to keep out; the extension-local `MessageBlock` absorbs the only case that matters.
- **A public token or class export.** Unchanged from 0008 and 0012.

---

## 10. Implementation order

### 10.1 Work items, one commit each

Every item must leave the tree building. Commit at each boundary, never one commit at the end.

| #   | Work item                                                                                                   | Commit contains                                                              |
| --- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | `Container` family — all seven components, the context, `useOverflowState`, tests                           | package only; nothing consumes it yet                                        |
| 2   | `StepList` / `StepListItem`, **and** delete `WizardBreadcrumb`                                              | package **plus** both call sites, because the deletion breaks them otherwise |
| 3   | `StatusList` / `StatusListItem`                                                                             | package only                                                                 |
| 4   | `MessageBlock` in `src/webviews/components/`                                                                | extension only — not the package (§2.2)                                      |
| 5   | `Wizard` / `WizardStep` facade, built on 1–3                                                                | package only                                                                 |
| 6   | **Mock view for visual comparison** — see §10.2                                                             | **nothing.** Never committed.                                                |
| 7   | Documentation — the markdown set in §5.6, the JSDoc pass, the updated `components/README.md` contents table | package only                                                                 |
| 8   | Migrate `LocalQuickStart.tsx`, including the `checking = 'active'` change and its companion guard (§7.2)    | extension only                                                               |
| 9   | Migrate `AtlasCredentialsView.tsx`, including the `formHeader` and `MessageBarTitle` cleanups (§7.3)        | extension only                                                               |
| 10  | API Extractor report, if §5.7 option **b** is taken                                                         | package plus one devDependency and one script                                |
| 11  | Final verification pass (§11) and mock removal                                                              | nothing, or a fixup                                                          |

Order matters in two places. Item 2 must update both consumers in the same commit, because deleting
`WizardBreadcrumb` breaks them. Items 8 and 9 come **after** the mock exists, so the migration can be
compared against a working reference rather than against memory.

### 10.2 The mock view — built, used, never committed

Build a mock of the DocumentDB Local webview using only the new package components, open it beside
the real one, and compare. It is a measuring instrument, not a deliverable.

Wiring it up requires touching **tracked** files, so "just don't `git add` the new files" is not
enough:

- `src/webviews/_integration/WebviewRegistry.ts` — one key. Its own JSDoc documents the four steps.
- `package.json` — one `contributes.commands` entry under the `vscode-documentdb.command.*`
  namespace, if it is opened from the palette.
- a command registration, and a factory calling `openAppWebview({ webviewName, title, config,
context, viewColumn })`.

The discipline that follows:

1. **Stage by explicit path only.** Never `git add -A`, never `git add .`. Each commit names the
   files it contains.
2. **Never `git add -f`.** If git refuses a path it is ignored for a reason.
3. The mock stays in the working tree across items 7–9 so comparison stays available.
4. **Item 11 removes it**: delete the mock files, revert the tracked-file edits, and confirm
   `git status` and `git diff` show no trace of it.

If a simpler route exists — the live preview harness in
[live-preview-playwright.md](../../../live-preview-playwright.md) mounts a registered webview in a
plain browser off `watch:views`, with no extension host — prefer it. It still needs the registry
key, but it needs no command, no `package.json` edit, and gives a side-by-side browser window at any
width.

### 10.3 Scaffolding that already exists

Do not build these; they are done.

- **The ESLint I1 rule** already covers `packages/vscode-ext-webview-fluentui/src/components/**` in
  `eslint.config.mjs`. New files inherit it. No ESLint change is needed, and a violation is a lint
  error rather than a review comment.
- **The jest project** for the package is already in the root `jest.config.js` `projects` array.
- **`components.test.ts`** already asserts the entry injects no stylesheet. It must keep passing.
- **The package is `private: true` at `0.1.0-preview`.** Nothing publishes. Renaming public API is
  free right now, which is why item 2 deletes `WizardBreadcrumb` outright instead of deprecating it.
- **Peers are already declared** — `@fluentui/react-components`, `@fluentui/react-icons`, `react`.
  Nothing in this increment needs a new runtime dependency. If something seems to, stop and ask.

### 10.4 Traps, in the order they are usually hit

- **`npm run build`, never `npm run compile`.** The latter is a task definition, not the build.
- **Relative imports carry `.js`.** The package is ESM; `from './StepList'` compiles and then fails
  at runtime.
- **The package must be built before the root `tsc`.** Already guaranteed by the `prebuild`
  fan-out — but it means a package change is invisible to the extension until the package rebuilds.
- **`l10n/bundle.l10n.json` is generated.** Strings move in items 8 and 9. Never hand-merge a
  conflict there: take either side, or delete it, run `npm run l10n`, commit the result.
- **No `l10n` inside the package.** Every user-visible string is a prop with an English default. The
  extractor does not scan `node_modules`, so a string owned by the package would silently never be
  translated in any consumer.
- **The `fluentOverrides` test suite is the `fui-*` tripwire.** If a component reaches for a Fluent
  internal class name, that is a design failure — see §4.5, where the last such coupling is removed
  rather than relocated.
- **`TDD:`-prefixed tests are behaviour contracts.** If one fails, stop and ask; do not adjust it.
- **Nothing under `theme/`, `styles/`, `palette/` or the `"."` entry changes.** If a change there
  seems necessary, that is a signal the design is wrong, not the boundary.

### 10.5 Done, per work item

A work item is finished when `npm run build` passes, its own tests pass under
`npx jest --no-coverage <path>`, and both webviews still compile. The full §11 ladder runs once, at
hand-over — not per commit.

---

## 11. Verify

Fast loop while working: `npm run build`, then `npx jest --no-coverage <path>`.

Before hand-over, in order: `npm run l10n` → `npm run prettier-fix` → `npm run lint` →
`npx jest --no-coverage` → `npm run build` → `npm run package`. `l10n` is required: strings move
between the two views and the package's English defaults.

Tests this increment must add:

- `components.test.ts` still passes — importing `./components` injects no stylesheet (invariant I1).
- The ESLint `no-restricted-imports` rule still holds: nothing in `src/components/` imports
  `src/theme/` or `src/styles/`.
- `Wizard` renders only the active step, and `defaultCompleted` / `defaultNavigable` reproduce both
  consumers' current breadcrumb state.
- `ContainerFooter` elevates only while `ContainerBody` overflows.
- `ContainerSection focusOnMount` does not steal focus on the container's first render.

### Acceptance — read this before declaring the work done

Green commands prove very little here. A chrome regression compiles cleanly, passes every test, and
looks wrong. **The operator performs the visual check**, on both webviews, at a narrow panel width
and a wide editor width. When the commands pass, stop, report what changed, and hand over.

---

# Outcome

> Written after the plan was executed. The plan above is left as written; this section records what
> actually happened. **The operator's visual check is still outstanding** — see the last subsection.

**Implemented in nine commits** — one for each of work items 1–5 and 7–9, plus item 11's l10n
regeneration. Item 6 produced none by design, and item 10 was not taken. The §11 ladder ran in
order and passed: `l10n` (one key lost, exactly as expected), `prettier-fix`, `lint`, 3559 tests
across 7 jest projects, `build`, `package`. The mock was removed and the tree is clean.

## The pre/post-migration comparison was performed

The acceptance criterion says a chrome regression compiles cleanly and looks wrong. That is true of
a screenshot too, so the comparison was done by **measurement**, through the live preview harness
([live-preview-playwright.md](../../../live-preview-playwright.md)) rather than the mock-plus-command
route in §10.2. Screenshots answered only colour and weight.

Three passes:

1. **Mock vs. the un-migrated view** (work item 6). A mock DocumentDB Local surface built purely
   from the new components, measured against the real view before it was touched.
2. **Migrated Local vs. its own recorded baseline** (after work item 8).
3. **Migrated Atlas** (after work item 9).

Every chrome element was compared by `getBoundingClientRect()` and `getComputedStyle()`, element by
element. At an effective width of 880 px the migrated Local view lands on the **same rectangles to
the pixel** as the baseline taken before migration:

| Element           | Rect (x, y, w × h) |
| ----------------- | ------------------ |
| `Container` root  | 0, 0, 880 × 720    |
| scroll region     | 0, 0, 880 × 628    |
| content column    | 0, 0, 808 × 573    |
| `ContainerHeader` | 24, 24, 760 × 56   |
| `ContainerNav`    | 24, 100, 760 × 32  |
| `ContainerMain`   | 24, 152, 760 × 397 |
| `ContainerFooter` | 0, 628, 880 × 92   |

Computed values matched the §1.2 baseline too — content `gap 20` / `padding 24` / `maxWidth 760`
(measuring 808 because `box-sizing` is `content-box`), footer column `gap 12` / `padding 16px 24px`,
elevation absent while `scrollHeight === clientHeight`. `StatusList` was checked against the §4.5
table: `gap 12` / `padding 16` / `borderRadius 4px`, rows `flex-start` / `gap 10` / `minHeight 20`,
icon box `18 × 20`, copy column `gap 1`.

Behaviour verified alongside the geometry: focus lands on the new step's `h2` after every step
change in both views (`document.activeElement` asserted, not inferred); no horizontal overflow at
336 px; the step list collapses into its overflow menu at that width while keeping the current step
visible; and the Atlas form step's header gap is now 4, closing the §7.3 drift.

**What this does not cover**, and why the operator's check still stands: light theme only, in a
browser, with a faked host. Dark and high-contrast are untested, as are the real webview host, the
Configure step's editors, and the live provisioning and failure states. Two differences are
deliberate and will be visible — the Docker failure title now takes its own line, and Atlas's form
header gap drops from 8 to 4.

## Where the plan needed changing

| Change                                                                          | Why                                                                                                |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `Container` uses `height: 100vh`, not §4.1's `height: 100%`                     | §8 Q3 is open and nothing gives `html`/`body` a height, so `100%` collapses the surface            |
| `ContainerBody` renders two elements (scroll region › content grid), not one    | one element that is both scroll container and 760 px column puts the scrollbar at 760 px           |
| `MessageBlockProps.icon` is Fluent's `MessageBarProps['icon']`, not `ReactNode` | `Slot<'div'>` does not accept arbitrary `ReactNode`; §4.6's signature does not compile             |
| Work item 4 added an `extension-webview` jest project                           | `src/**/*.test.ts` never matched a `.tsx` file, so §5.8's test would silently never run            |
| `failedStage` treats an in-flight Docker re-check as still failed               | §7.2 as written collapses the remediation block mid-re-check, because `checking` leaves `'error'`  |
| Work item 10 (API Extractor) not taken                                          | conditional in the plan; `api/` is outside the workspaces so it needs a real lockfile regeneration |

## What §8 looks like now

- **Q3 (root height) became the urgent one.** A choice was made to keep the baseline; it wants
  ratifying or reversing.
- **Q4 (body metrics as API)** resolved by omission: nothing is exposed, `className` only.
- **Q5 (`Announcer`)** deferred, and the implementation made its position awkward — §4.4 leaves no
  slot between header and step list, so both views now render announcers as siblings of `Wizard`,
  outside the surface entirely.
- **Q2 (`body { padding: 0 }`)** untouched, so both SCSS files stay.
- **New:** each declared grid region reserves its row, so a surface omitting one leaves that row's
  gap behind. Documented in `Container/README.md`.
