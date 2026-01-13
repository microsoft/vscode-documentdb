---
name: accessibility-aria-expert
description: Detects and fixes ARIA accessibility issues in React/Fluent UI webviews. Use when reviewing webview code for screen reader compatibility, fixing double announcements, adding missing aria-labels, or ensuring WCAG compliance for tooltips and badges.
---

# Accessibility ARIA Expert

Verify and fix ARIA attributes in React/Fluent UI webview components.

## When to Use

- Review webview code for accessibility issues
- Fix double announcements from screen readers
- Add missing `aria-label` to icon-only buttons
- Make tooltips accessible to keyboard/screen reader users
- Apply `focusableBadge` pattern for keyboard-navigable badges

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

## Quick Checklist

- [ ] Icon-only buttons have \`aria-label\`
- [ ] Tooltip content included in \`aria-label\`
- [ ] Visible text wrapped in \`aria-hidden="true"\` when aria-label duplicates it
- [ ] Redundant aria-labels removed (identical to visible text)
- [ ] Decorative elements have \`aria-hidden={true}\`
- [ ] Badges with tooltips use \`focusableBadge\` class + \`tabIndex={0}\`

## References

- [WCAG 2.1.1 Keyboard](https://www.w3.org/WAI/WCAG21/Understanding/keyboard.html)
- [WCAG 4.1.2 Name, Role, Value](https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html)
- See \`src/webviews/components/focusableBadge/focusableBadge.md\` for detailed pattern if using the Badge component
