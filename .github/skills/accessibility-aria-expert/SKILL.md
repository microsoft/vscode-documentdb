---
name: detecting-accessibility-issues
description: Detects and fixes accessibility issues in React/Fluent UI webviews. Use when reviewing code for screen reader compatibility, fixing ARIA labels, ensuring keyboard navigation, adding live regions for status messages, or managing focus in dialogs.
---

# Accessibility Expert for Webviews

Verify and fix accessibility in React/Fluent UI webview components.

## When to Use

- Review webview code for accessibility issues
- Fix double announcements from screen readers
- Add missing `aria-label` to icon-only buttons or form inputs
- Make tooltips accessible to keyboard/screen reader users
- Announce status changes (loading, search results, errors)
- Manage focus when dialogs/modals open
- Group related controls with proper labels

## Core Pattern: Tooltip Accessibility

For a badge whose tooltip must be reachable by keyboard, use the package component and keep the
tooltip as a description:

```tsx
<Tooltip content="Detailed explanation" relationship="description">
  <FocusableBadge>Badge text</FocusableBadge>
</Tooltip>
```

- The visible content is the name through `aria-labelledby`.
- Tooltip content is the supplementary description through `aria-describedby`.
- The badge carries `role="group"`, because ARIA cannot name a role-less element.
- Browser-computed results do not prove what a real screen reader says.

## Detection Rules

### 1. Tooltip Content Never Reaches the Accessibility Tree

❌ **Problem**: the tooltip declares no ARIA relationship, so its content is invisible to assistive
technology — and the `aria-label` here only restates the visible text

```tsx
<Tooltip content="Save document to database">
  <Button aria-label="Save">Save</Button>
</Tooltip>
```

✅ **Fix**: declare the relationship and let the tooltip be the description

```tsx
<Tooltip content="Save document to database" relationship="description">
  <Button>Save</Button>
</Tooltip>
```

`relationship="description"` wires `aria-describedby` to the tooltip. Do **not** also copy the
tooltip text into `aria-label`: that announces it twice (rule 2). Use `relationship="label"` only
when the trigger has no visible text of its own.

### 2. Composed Badge Name Repeats Its Description

❌ **Problem**: Tooltip details occur in both the name and description

```tsx
<Tooltip content="Query is inefficient" relationship="description">
  <Badge tabIndex={0} aria-label="Collection scan. Query is inefficient">
    <span aria-hidden="true">Collection scan</span>
  </Badge>
</Tooltip>
```

✅ **Fix**: Let visible content name `FocusableBadge`; keep details in the description

```tsx
<Tooltip content="Query is inefficient" relationship="description">
  <FocusableBadge>Collection scan</FocusableBadge>
</Tooltip>
```

### 3. Redundant aria-label (NOT Needed)

❌ **Problem**: aria-label identical to visible text adds no value

```tsx
<Button aria-label="Save">Save</Button>
<ToolbarButton aria-label="Validate" icon={<CheckIcon />}>Validate</ToolbarButton>
```

✅ **Fix**: Remove redundant aria-label OR make it more descriptive

```tsx
<Button>Save</Button>
<ToolbarButton icon={<CheckIcon />}>Validate</ToolbarButton>
```

**Keep aria-label only when it adds information:**

```tsx
<ToolbarButton aria-label="Save document to database" icon={<SaveIcon />}>
  Save
</ToolbarButton>
```

### 4. Icon-Only Button Missing aria-label

❌ **Problem**: No accessible name

```tsx
<ToolbarButton icon={<DeleteRegular />} onClick={onDelete} />
```

✅ **Fix**: Add aria-label

```tsx
<Tooltip content="Delete selected items" relationship="description">
  <ToolbarButton aria-label="Delete selected items" icon={<DeleteRegular />} onClick={onDelete} />
</Tooltip>
```

### 5. Decorative Elements Not Hidden

❌ **Problem**: Progress bar announced unnecessarily

```tsx
<ProgressBar thickness="large" />
```

✅ **Fix**: Hide decorative elements

```tsx
<ProgressBar thickness="large" aria-hidden={true} />
```

### 6. Input Missing Accessible Name

❌ **Problem**: SpinButton/Input without accessible name

```tsx
<SpinButton value={skipValue} onChange={onSkipChange} />
<Input placeholder="Enter query..." />
```

✅ **Fix**: Add aria-label or associate with label element

```tsx
<SpinButton aria-label="Skip documents" value={skipValue} onChange={onSkipChange} />
<Label htmlFor="query-input">Query</Label>
<Input id="query-input" placeholder="Enter query..." />
```

### 7. Visible Label Not in Accessible Name

❌ **Problem**: aria-label doesn't contain visible text (breaks voice control)

```tsx
<ToolbarButton aria-label="Reload data" icon={<RefreshIcon />}>
  Refresh
</ToolbarButton>
```

✅ **Fix**: Accessible name must contain visible label exactly

```tsx
<ToolbarButton aria-label="Refresh data" icon={<RefreshIcon />}>
  Refresh
</ToolbarButton>
```

Voice control users say "click Refresh" – only works if accessible name contains "Refresh".

### 8. Status Changes Not Announced

❌ **Problem**: Screen reader doesn't announce dynamic content

```tsx
<span>{isLoading ? 'Loading...' : `${count} results`}</span>
```

✅ **Fix**: Use the `Announcer` component

```tsx
import { Announcer } from '<relative-path>/components/accessibility';

// Announces when `when` transitions from false to true
<Announcer when={isLoading} message={l10n.t('Loading...')} />

// Dynamic message based on state
<Announcer
    when={!isLoading && documentCount !== undefined}
    message={documentCount > 0 ? l10n.t('Results found') : l10n.t('No results found')}
/>
```

Use for: loading states, search results, success/error messages.

### 9. Dialog Opens Without Focus Move

❌ **Problem**: Focus stays on trigger when modal opens

```tsx
{
  isOpen && <Dialog>...</Dialog>;
}
```

✅ **Fix**: Move focus programmatically

```tsx
const dialogRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  if (isOpen) dialogRef.current?.focus();
}, [isOpen]);

{
  isOpen && (
    <Dialog ref={dialogRef} tabIndex={-1} aria-modal="true">
      ...
    </Dialog>
  );
}
```

### 10. Related Controls Without Group Label

❌ **Problem**: Buttons share visual label but screen reader misses context

```tsx
<span>How would you rate this?</span>
<Button>👍</Button>
<Button>👎</Button>
```

✅ **Fix**: Use role="group" with aria-labelledby

```tsx
<div role="group" aria-labelledby="rating-label">
  <span id="rating-label">How would you rate this?</span>
  <Button aria-label="I like it">👍</Button>
  <Button aria-label="I don't like it">👎</Button>
</div>
```

## When to Use aria-hidden

**DO use** on:

- Decorative icons, spinners, progress bars
- Visual separators (\`|\`, \`—\`)

**Last resort only**: visible text that a composed `aria-label` already covers. Prefer naming the
element _from_ its visible content with `aria-labelledby`, which needs no hiding at all — that is
what `FocusableBadge` and `MetricCard` do.

**DO NOT use** on:

- The only accessible content (hides it completely)
- Interactive/focusable elements
- Error messages or alerts

## FocusableBadge Pattern

For keyboard-accessible badges with tooltips:

1. Import `FocusableBadge` from `@microsoft/vscode-ext-webview-fluentui/components`.
2. Keep `Tooltip` at the call site with `relationship="description"`.
3. Use `focusable={false}` only for plain badges in a mixed list; never infer focusability from an
   accessible-name override.

```tsx
<Tooltip content="Tooltip details" relationship="description">
  <FocusableBadge>Visible text</FocusableBadge>
</Tooltip>
```

For rich tooltip content that visually repeats the badge name, set the content slot's `aria-label`
to only the supplementary details. For truncated values, keep the visible label and truncated value
as the badge name and the full value as the description; do not use `relationship="label"`.

When you name a focusable container yourself rather than using these components, give it a role.
ARIA forbids naming the `generic` role, so `aria-labelledby` on a bare `div` (or on Fluent's `Badge`
or `Card`, neither of which sets a role) is a name a conforming screen reader may discard.
`role="group"` is usually the least-weight role that makes the name legitimate.

## Screen Reader Announcements

Use the `Announcer` component for WCAG 4.1.3 (Status Messages) compliance.

```tsx
import { Announcer } from '<relative-path>/components/accessibility';
```

### Basic Usage

```tsx
// Announces "AI is analyzing..." when isLoading becomes true
<Announcer when={isLoading} message={l10n.t('AI is analyzing...')} />

// Dynamic message based on state (e.g., query results)
<Announcer
    when={!isLoading && documentCount !== undefined}
    message={documentCount > 0 ? l10n.t('Results found') : l10n.t('No results found')}
/>

// With assertive politeness (default is polite)
<Announcer when={hasError} message={l10n.t('Error occurred')} politeness="assertive" />
```

### Props

- `when`: Announces when this transitions from `false` to `true`
- `message`: The message to announce (use `l10n.t()` for localization)
- `politeness`: `'assertive'` (default, interrupts) or `'polite'` (waits for idle)

### Key Points

- **Placement doesn't matter** - screen readers monitor all live regions regardless of DOM position; place near related UI for code readability
- **Store relevant state** (e.g., `documentCount`) to derive dynamic messages
- **Use `l10n.t()` for messages** - announcements must be localized
- **Condition resets automatically** - when `when` goes back to `false`, it's ready for the next announcement
- **Prefer 'assertive'** for user-initiated actions, 'polite' for background updates

## Quick Checklist

- [ ] Icon-only buttons have `aria-label`
- [ ] Form inputs have associated labels or `aria-label`
- [ ] Tooltips declare a `relationship`; their text is not also copied into `aria-label`
- [ ] Visible text is not hidden with `aria-hidden` to make room for a composed `aria-label`
- [ ] Redundant aria-labels removed (identical to visible text)
- [ ] Visible button labels are contained in the accessible name (for voice control)
- [ ] Decorative elements have `aria-hidden={true}`
- [ ] Badges with keyboard-reachable tooltips use `FocusableBadge` + `relationship="description"`
- [ ] Focusable elements carrying `aria-labelledby` have a role (ARIA cannot name `generic`)
- [ ] Status updates use `Announcer` component
- [ ] Focus moves to dialog/modal content when opened
- [ ] Related controls wrapped in `role="group"` with `aria-labelledby`

## References

- [WCAG 2.1.1 Keyboard](https://www.w3.org/WAI/WCAG21/Understanding/keyboard.html)
- [WCAG 2.4.3 Focus Order](https://www.w3.org/WAI/WCAG21/Understanding/focus-order.html)
- [WCAG 2.5.3 Label in Name](https://www.w3.org/WAI/WCAG21/Understanding/label-in-name.html)
- [WCAG 4.1.2 Name, Role, Value](https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html)
- [WCAG 4.1.3 Status Messages](https://www.w3.org/WAI/WCAG21/Understanding/status-messages.html)
- See `packages/vscode-ext-webview-fluentui/src/components/FocusableBadge/README.md` for the badge pattern
