# `MetricGrid` and `MetricCard`

A metric card shows one measurement: a caption, the value, and an optional explanation behind an
info glyph. `MetricGrid` is the responsive grid they sit in, one column narrow and four wide.

Use them for a dashboard strip that answers "how did this go" at a glance. For a single figure with
no caption, use Fluent's `Text` at a type ramp size. For a value that needs a control beside it, use
`Card` directly, since a metric card is deliberately not interactive beyond being focusable.

## Best practices

### Do

- Distinguish **not yet known** from **not available**. `undefined` is loading, `null` is
  unavailable, and they look different on purpose.
- Format before you pass. Units, grouping, precision and percentages are locale-specific, and the
  card has no way to know what your number means.
- Pass a localized `nullValuePlaceholder` if your application ships translations. It defaults to
  English.
- Keep one `size` per grid. Cards of the same size line up; mixing them makes rows of unequal
  height.

### Don't

- Use `''` or `0` to mean "no data". Both are values, and both render as themselves.
- Reach for `ariaLabel` by default. Read Accessibility first: it changes what the card exposes, and
  the visible content usually names it better than a composed string does.
- Put spanning logic on the card. Column spans belong to your grid.

## Anatomy

```tsx
<MetricGrid>
    <MetricCard label={l10n.t('Execution time')} value={executionTime} />
    <MetricCard
        label={l10n.t('Documents returned')}
        value={documentsReturned}
        description={l10n.t('Number of documents the query returned.')}
    />
    <MetricCard label={l10n.t('Keys examined')} value={null} nullValuePlaceholder={l10n.t('N/A')} />
    <MetricCard label={l10n.t('Documents examined')} />
</MetricGrid>
```

Left to right: a resolved value, a value with an explanation behind an info glyph, an unavailable
value, and one still loading.

## The three states of `value`

This is the part worth getting right, and the reason the card exists rather than a `div` with two
lines of text in it.

| `value`     | Renders                                             | Means                   |
| ----------- | --------------------------------------------------- | ----------------------- |
| `undefined` | `loadingPlaceholder`, in a slot of the final height | not known yet           |
| `null`      | `nullValuePlaceholder`                              | known to be unavailable |
| anything    | itself, including `0` and `''`                      | the value               |

The value slot reserves its height before the value arrives, so the swap from placeholder to number
does not move everything below it. That reservation is why `loadingPlaceholder="empty"` is a real
option: on a surface with many cards resolving at once, a row of shimmering blocks is noisier than a
row of gaps, and neither of them shifts the layout.

`0` and `''` are the two values most often mishandled by a component like this, so they are stated
explicitly and covered by tests. A count of zero is a fact, not an absence.

## Formatting is not here, and will not be

`"2.33 ms"`, `"1.2M"` and `"85.00%"` are locale-specific strings. Their unit abbreviations, their
grouping separators and their decimal marks all vary by language, and none of that can be decided by
a component that does not know whether the number is a duration, a count or a share.

So a metric component in a consumer is a formatter with a card attached. That is also the smaller
half: the card keeps the layout, the two placeholder states, the tooltip wiring and the focus
behaviour, and the consumer keeps everything that has an opinion about numbers.

For a figure the type scale cannot express on its own, such as a percentage with a bar under it,
pass a node as `value`. That is what the prop is for.

## Accessibility

**Every card is a tab stop**, in every configuration, whether or not it has a tooltip and whether or
not its value has resolved. A grid where some cards are reachable by keyboard and others are not is
harder to use than one where all of them are, because nothing on screen tells you which is which.

**`ariaLabel` is a pass-through, and it is not the default for a reason.** Supplying it hides the
visible label and value from assistive technology, so the string has to carry both. The two are
never both active, which is the only way this pattern can go wrong by accident.

The case against reaching for it: when a card has a `description`, Fluent's `Tooltip` sets
`aria-describedby` on it with `relationship="description"`. A card that also folds that explanation
into its name will have it announced twice, once as the name and once as the description. Leaving
`ariaLabel` off avoids that, and the visible content names the card perfectly well.

The case for it: a name composed by the consumer can say things the visible content cannot, such as
what a truncated value was, or a unit that only the axis label carries.

The component takes no position between those. It is a Preview surface and this is the choice most
likely to change once there is evidence rather than argument.

## The grid's breakpoints are on the viewport

One column, two from `400px`, four from `800px`, measured against the **window**, not against the
grid.

That is the wrong measure for a grid inside a resizable panel: a narrow panel in a wide window gets
four columns it has no room for. Container queries are the right mechanism and would be a behaviour
change rather than a refactor, so this is recorded as a known limitation rather than presented as a
design.

`MetricGrid` is otherwise a plain grid and takes any children.
