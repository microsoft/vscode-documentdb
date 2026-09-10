# `FocusableBadge`

Fluent badges are normally inline decoration and should not receive focus. `FocusableBadge` is for
the exception: a badge with supplementary information in a tooltip that would otherwise be
unreachable by keyboard.

## Use it with `Tooltip`

Keep the tooltip at the call site. This preserves Fluent's trigger ref, pointer and focus events,
and ARIA relationship without making the badge API mirror every tooltip option.

```tsx
<Tooltip content={l10n.t('The query examined every document.')} relationship="description">
    <FocusableBadge appearance="tint" color="informative" size="small" shape="rounded">
        {l10n.t('Collection scan detected')}
    </FocusableBadge>
</Tooltip>
```

The visible badge content is the accessible name. The tooltip is its supplementary description.
`FocusableBadge` creates the `aria-labelledby` relationship internally and uses Fluent's supported
focus-outline helper; do not add a second `aria-label`, hide the visible children, or apply a
consumer focus-ring class.

For rich tooltip markup that repeats the badge text visually, give the tooltip content an
`aria-label` containing only the additional explanation:

```tsx
<Tooltip
    relationship="description"
    content={{
        'aria-label': details,
        children: (
            <div>
                <strong>{message}</strong>
                <div>{details}</div>
            </div>
        ),
    }}
>
    <FocusableBadge>{message}</FocusableBadge>
</Tooltip>
```

This keeps `message` in the name and `details` in the description instead of exposing both twice.

## Mixed lists

Focusability is independent of naming. A mixed list can keep plain badges out of sequential
keyboard navigation while exposing only tooltip-bearing badges:

```tsx
<FocusableBadge focusable={tooltip !== undefined}>{label}</FocusableBadge>
```

Use `focusable={false}` only when the badge has no focus-only information. The visible content stays
available as ordinary inline text.

## Truncated values

Use the visible label and truncated value as the name, and the full value as the tooltip
description. Do not use `relationship="label"`: once the tooltip becomes the name, a tooltip that
contains only the full value can replace and lose the visible metric label.

Browser-computed names and descriptions verify the ARIA contract. They do not prove what a real
screen reader says or how it paces the two strings.
