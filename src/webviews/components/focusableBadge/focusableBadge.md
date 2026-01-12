# Focusable Badge Style

## Overview

This style makes Fluent UI `Badge` components keyboard accessible by adding proper focus indicators that match VS Code's design system. It uses Fluent UI's native focus management (`data-fui-focus-visible` attribute) to ensure focus indicators only appear during keyboard navigation.

## When to Use

Use this style when you need to make a Badge component focusable for keyboard accessibility, typically when:

- The badge has a tooltip that needs to be accessible via keyboard
- The badge displays additional information that should be available to screen readers
- You're implementing WCAG 2.1.1 (Keyboard) compliance

## How to Use

### 1. Import the SCSS

```scss
@import '../path/to/components/focusableBadge/focusableBadge.scss';
```

### 2. Apply to Badge Component

```tsx
import { Badge, Tooltip } from '@fluentui/react-components';

// Badge with tooltip and full accessibility support
<Tooltip content="Additional detailed information shown in tooltip">
  <Badge
    appearance="tint"
    size="small"
    tabIndex={0}
    className="focusableBadge"
    aria-label="Badge text. Additional detailed information shown in tooltip"
  >
    <span aria-hidden="true">Badge text</span>
  </Badge>
</Tooltip>;
```

## Required Props and Pattern

When using the `focusableBadge` class, follow this pattern:

- `tabIndex={0}` - Makes the badge focusable via keyboard
- `className="focusableBadge"` - Applies the focus indicator styling
- `aria-label` - Provides the complete accessible name including both visible text and tooltip content
- `<span aria-hidden="true">` - Wrap visible text children to prevent double announcement

### Accessibility Pattern Explanation

The key to making tooltips accessible is the combination of `aria-label` and `aria-hidden`:

1. **`aria-label`**: Contains the full context (visible text + tooltip details)
2. **`aria-hidden="true"` on children**: Hides visible text from screen readers
3. **Result**: Screen readers announce the complete `aria-label` instead of just the visible text

**Example:**

```tsx
aria-label="Collection scan detected. This query performs a full collection scan which is inefficient."
// Visual users see: "Collection scan detected"
// Screen reader users hear: "Collection scan detected. This query performs a full collection scan which is inefficient."
```

## How It Works

### Focus Management

The style uses Fluent UI's `data-fui-focus-visible` attribute, which is automatically managed by Fluent UI's tabster focus system:

- **Keyboard Focus (Tab, Shift+Tab)**: Attribute is added → Focus indicator appears
- **Mouse Click**: Attribute is NOT added → No focus indicator
- **Better UX**: Focus indicators only show when needed for keyboard navigation

### Visual Design

The focus indicator matches VS Code's focus styling:

- Also uses `var(--colorStrokeFocus2)` for Fluent UI consistency
- Applies border radius, outline, and box-shadow as per Fluent UI Button pattern
- Positioned with `inset: -4px` to appear outside the badge

### Fallback Support

Includes `:focus-visible` fallback for browsers that don't support Fluent UI's focus management.

## Real-World Examples

### Example 1: Diagnostic Badge with Tooltip

```tsx
<Tooltip
  content={{
    children: (
      <div style={{ padding: '8px' }}>
        <div style={{ fontWeight: 600, marginBottom: '12px' }}>Collection scan detected</div>
        <div>This query performs a full collection scan which is inefficient...</div>
      </div>
    ),
  }}
  relationship="description"
>
  <Badge
    appearance="tint"
    color="informative"
    size="small"
    tabIndex={0}
    className="focusableBadge"
    aria-label="Collection scan detected. This query performs a full collection scan which is inefficient..."
  >
    <span aria-hidden="true">Collection scan detected</span>
  </Badge>
</Tooltip>
```

### Example 2: Metric Badge with Truncated Value

```tsx
const fullValue = 'very-long-value-that-is-truncated...';
const displayValue = 'very-long-val...';

<Tooltip content={fullValue} relationship="label">
  <Badge
    appearance="outline"
    size="small"
    tabIndex={0}
    className="focusableBadge"
    aria-label={`Metric name: ${displayValue}. Full value: ${fullValue}`}
  >
    <span aria-hidden="true">Metric name: {displayValue}</span>
  </Badge>
</Tooltip>;
```

## Accessibility Notes

- **WCAG 2.1.1 (Keyboard)**: All content accessible via keyboard through tab navigation
- **WCAG 2.4.7 (Focus Visible)**: Focus indicator clearly visible during keyboard navigation
- **Screen Reader Support**: Use `aria-label` with full context; wrap visible text in `aria-hidden="true"`
- **Tooltip Access**: Tooltips automatically show on focus (Fluent UI behavior)

## Browser Support

- Works in all modern browsers with Fluent UI v9 support
- Falls back to `:focus-visible` in browsers without `data-fui-focus-visible` support
- VS Code theme variables automatically adapt to dark/light/high-contrast themes
