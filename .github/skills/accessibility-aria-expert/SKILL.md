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

Tooltips require `aria-label` + `aria-hidden` to avoid double announcements:

```tsx
<Tooltip content="Detailed explanation">
  <Badge tabIndex={0} className="focusableBadge" aria-label="Badge text. Detailed explanation">
    <span aria-hidden="true">Badge text</span>
  </Badge>
</Tooltip>
```

- `aria-label`: Full context (visible text + tooltip)
- `aria-hidden="true"`: Wraps visible text to prevent duplication
- Screen reader hears: "Badge text. Detailed explanation"

## Detection Rules

### 1. Tooltip Without aria-label Context

❌ **Problem**: Tooltip content inaccessible to screen readers

```tsx
<Tooltip content="Save document to database">
  <Button aria-label="Save">Save</Button>
</Tooltip>
```

✅ **Fix**: Include tooltip in aria-label

```tsx
<Tooltip content="Save document to database" relationship="description">
  <Button aria-label="Save document to database">Save</Button>
</Tooltip>
```

### 2. Missing aria-hidden (Double Announcement)

❌ **Problem**: Screen reader says "Collection scan Collection scan"

```tsx
<Badge aria-label="Collection scan. Query is inefficient">Collection scan</Badge>
```

✅ **Fix**: Wrap visible text

```tsx
<Badge aria-label="Collection scan. Query is inefficient">
  <span aria-hidden="true">Collection scan</span>
</Badge>
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

✅ **Fix**: Use the `useAnnounce` hook

```tsx
import { useAnnounce } from '../../api/webview-client/accessibility';

const { announce, AnnouncerElement } = useAnnounce();

useEffect(() => {
  if (!isLoading && hasResults !== undefined) {
    announce(hasResults ? l10n.t('Results found') : l10n.t('No results found'));
  }
}, [isLoading, hasResults, announce]);

return (
  <div>
    {AnnouncerElement}
    {/* ... rest of your UI */}
  </div>
);
```

**Alternative (inline live region)**: For simple cases without the hook:

```tsx
<span role="status" aria-live="polite">
  {isLoading ? 'Loading...' : `${count} results`}
</span>
```

Use for: search results, loading states, success/error messages.

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

- Visible text when aria-label provides complete context
- Decorative icons, spinners, progress bars
- Visual separators (\`|\`, \`—\`)

**DO NOT use** on:

- The only accessible content (hides it completely)
- Interactive/focusable elements
- Error messages or alerts

## focusableBadge Pattern

For keyboard-accessible badges with tooltips:

1. Import: \`import '../components/focusableBadge/focusableBadge.scss';\`
2. Apply attributes:

```tsx
<Badge tabIndex={0} className="focusableBadge" aria-label="Visible text. Tooltip details">
  <span aria-hidden="true">Visible text</span>
</Badge>
```

## useAnnounce Hook

The `useAnnounce` hook provides a clean API for screen reader announcements following WCAG 4.1.3 (Status Messages). Use it for:

- Search results ("Results found" / "No results found")
- Loading completion
- Success/error messages
- Any dynamic status changes

### Location

```tsx
import { useAnnounce } from '../../api/webview-client/accessibility';
```

### Basic Usage

```tsx
const { announce, AnnouncerElement } = useAnnounce();

// Call announce directly in async completion handlers
// This ensures announcements work even when the result is the same as before
trpcClient.someQuery.query(params).then((response) => {
  announce(response.count > 0 ? l10n.t('Results found') : l10n.t('No results found'));
});

return (
  <div>
    {AnnouncerElement} {/* Place anywhere in JSX - visually hidden */}
    {/* ... rest of UI */}
  </div>
);
```

### Options

```tsx
// For urgent announcements that interrupt (use sparingly)
const { announce, AnnouncerElement } = useAnnounce({ politeness: 'assertive' });
```

### Key Points

- **Always render `AnnouncerElement`** - it creates the ARIA live region
- **Use `l10n.t()` for messages** - announcements must be localized
- **Call `announce` directly in callbacks** - don't rely on state changes (useEffect won't trigger if state value stays the same)
- **Identical messages re-announce** - the hook handles this automatically via internal timeout
- **Prefer 'polite' (default)** - only use 'assertive' for critical errors
- **Skip repetitive operations** - e.g., suppress during pagination to avoid noise

## Quick Checklist

- [ ] Icon-only buttons have `aria-label`
- [ ] Form inputs have associated labels or `aria-label`
- [ ] Tooltip content included in `aria-label`
- [ ] Visible text wrapped in `aria-hidden="true"` when aria-label duplicates it
- [ ] Redundant aria-labels removed (identical to visible text)
- [ ] Visible button labels match accessible name exactly (for voice control)
- [ ] Decorative elements have `aria-hidden={true}`
- [ ] Badges with tooltips use `focusableBadge` class + `tabIndex={0}`
- [ ] Status updates use `useAnnounce` hook or inline `role="status"` with `aria-live="polite"`
- [ ] Focus moves to dialog/modal content when opened
- [ ] Related controls wrapped in `role="group"` with `aria-labelledby`

## References

- [WCAG 2.1.1 Keyboard](https://www.w3.org/WAI/WCAG21/Understanding/keyboard.html)
- [WCAG 2.4.3 Focus Order](https://www.w3.org/WAI/WCAG21/Understanding/focus-order.html)
- [WCAG 2.5.3 Label in Name](https://www.w3.org/WAI/WCAG21/Understanding/label-in-name.html)
- [WCAG 4.1.2 Name, Role, Value](https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html)
- [WCAG 4.1.3 Status Messages](https://www.w3.org/WAI/WCAG21/Understanding/status-messages.html)
- See `src/webviews/components/focusableBadge/focusableBadge.md` for the Badge pattern
