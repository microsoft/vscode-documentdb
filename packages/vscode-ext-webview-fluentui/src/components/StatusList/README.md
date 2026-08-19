# `StatusList`

A bordered list of things that are happening, or have happened: one row per stage, each with a
status glyph, a label, and an optional line of evidence under it.

It is a receipt, not a log. Evidence stays after a stage settles, so the finished list still says
_what was actually observed_.

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

That is deliberate. Separate `meta` and `action` props would have put the "·" joiner — and its
localization — inside a package that ships no strings. Composition puts both back where they belong.

Inline controls are normalised to the detail line's type scale by element (`a`, `button`, `label`),
never by a Fluent class name. `Link` renders a `<button>` when given `onClick` without `href`, which
is why the rule covers both.

## `reserveDetailSpace`

Holds the detail line's height before it has content, so the row does not grow — and shift
everything below it — when the detail lands. Use it on a row whose evidence arrives asynchronously
while the user is looking at something else.

Named after `TabList.reserveSelectedTabSpace`, which solves the same problem in the same shape. It
renders an `aria-hidden` non-breaking space; the `aria-hidden` half is why it is a boolean rather
than "pass a space yourself".

## Do / Don't

**Do**

- give the list an `ariaLabel` that says what the stages belong to;
- pass localized `statusLabels` if the consumer ships translations. Unlisted statuses keep their
  English default;
- own the narration yourself. A flow that streams progress should have one `role="status"` region
  for the whole flow.

**Don't**

- wrap it in a `Card` for the border. The border belongs to the component, and a wrapper would let
  the two drift apart;
- expect an `aria-live` region here. There is none, on purpose — see below;
- expect a custom icon slot. A fixed status vocabulary is the point.

## Accessibility

- The list is `role="list"`, each row `role="listitem"`.
- **A row carries no `aria-label`.** The status is a visually-hidden word appended to the label
  instead. A row-level label would make anything interactive inside `detail` unreachable — and
  `detail` takes arbitrary content, so that is a guarantee rather than an observation.
- **No `aria-live`.** A surface that streams progress already owns a `role="status"` region; live
  semantics here would double-announce every change.
- Glyphs are `aria-hidden`. The status word carries the meaning.
- The visually-hidden span is `position: absolute` and needs a positioned ancestor; `Container`
  provides one.

## Props

See [`StatusList.types.ts`](./StatusList.types.ts).
