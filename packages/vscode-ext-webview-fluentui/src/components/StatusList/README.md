# `StatusList`

A status list shows the stages of a multi-step operation and how each one ended. Each row has a
status icon, a label, and an optional line of detail beneath it.

Detail stays on screen after a stage settles, so a finished list still records what was observed,
and a failure stays readable beside the stage that produced it.

Use a status list when an operation has several stages worth naming. For a single wait with no
stages, use Fluent's `Spinner`, or `ProgressBar` when the progress is measurable.

## Best practices

### Do

- Give the list an `ariaLabel` naming what the stages belong to.
- Pass localized `statusLabels` if your application ships translations. Unlisted statuses keep
  their English default.
- Keep the labels stable for the whole run. The list is most useful when it shows the shape of the
  operation before it starts.
- Own any live narration yourself. A flow that streams progress should have one `role="status"`
  region for the whole flow.

### Don't

- Wrap it in a `Card` for the border. The border belongs to the component.
- Expect an `aria-live` region here. There is none, deliberately; see Accessibility.
- Expect a custom icon slot. The fixed status vocabulary is what makes a list readable at a glance.

## Anatomy

```tsx
<StatusList ariaLabel={l10n.t('Setup progress')}>
    <StatusListItem
        label={l10n.t('Checking Docker')}
        status="done"
        detail={l10n.t('{0} · {1}', 'Docker Engine 27.3', 'Linux')}
        reserveDetailSpace
    />
    <StatusListItem label={l10n.t('Pulling official image')} status="active" />
    <StatusListItem label={l10n.t('Creating container')} status="pending" />
</StatusList>
```

| `status`  | glyph                       | reads as                             |
| --------- | --------------------------- | ------------------------------------ |
| `done`    | `CheckmarkCircleFilled`     | finished                             |
| `error`   | `ErrorCircleFilled`         | failed                               |
| `warning` | `WarningRegular`            | succeeded, but you may not proceed   |
| `active`  | `Spinner size="extra-tiny"` | in flight                            |
| `pending` | `CircleHintFilled`          | not started; the label dims to match |

`warning` earns its place: a credential that authenticates and then returns nothing usable has not
failed, and an error glyph would misreport it. It is the general "succeeded, but you probably cannot
proceed" state.

## `detail` takes anything

One `ReactNode`, not a set of props. Text, a `Link`, a joined sentence, a control:

```tsx
detail={
    <>
        {evidence}
        {' · '}
        <Link onClick={recheck}>{l10n.t('Check again')}</Link>
    </>
}
```

That is deliberate. Separate `meta` and `action` props would have put the "·" joiner, and its
localization, inside a package that ships no strings. Composition puts both back where they belong.

Inline controls are normalised to the detail line's type scale by element (`a`, `button`, `label`),
never by a Fluent class name. `Link` renders a `<button>` when given `onClick` without `href`, which
is why the rule covers both.

## `reserveDetailSpace`

Holds the detail line's height before it has content, so the row does not grow, and shift
everything below it, when the detail lands. Use it on a row whose evidence arrives asynchronously
while the user is looking at something else.

Named after `TabList.reserveSelectedTabSpace`, which solves the same problem in the same shape. It
renders an `aria-hidden` non-breaking space; the `aria-hidden` half is why it is a boolean rather
than "pass a space yourself".

## Accessibility

- The list is `role="list"`, each row `role="listitem"`.
- **A row carries no `aria-label`.** The status is a visually-hidden word appended to the label
  instead. A row-level label would make anything interactive inside `detail` unreachable, and
  `detail` takes arbitrary content, so that is a guarantee rather than an observation.
- **No `aria-live`.** A surface that streams progress already owns a `role="status"` region; live
  semantics here would double-announce every change.
- Glyphs are `aria-hidden`. The status word carries the meaning.
- The visually-hidden span is `position: absolute` and needs a positioned ancestor; `Container`
  provides one.

## Props

See [`StatusList.types.ts`](./StatusList.types.ts).
