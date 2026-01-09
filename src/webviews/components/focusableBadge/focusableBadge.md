# Focusable Badge Style

## Overview

This style makes Fluent UI `Badge` components keyboard accessible by adding proper focus indicators that match VS Code's design system. It uses Fluent UI's native focus management (`data-fui-focus-visible` attribute) to ensure focus indicators only appear during keyboard navigation.

## When to Use

Use this style when you need to make a Badge component focusable for keyboard accessibility, typically when:
- The badge has a tooltip that needs to be accessible via keyboard
- The badge is interactive and needs to be part of the tab order
- You're implementing WCAG 2.1.1 (Keyboard) compliance

## How to Use

### 1. Import the SCSS

```scss
@import '../../../../webviews/components/focusableBadge/focusableBadge.scss';
```

### 2. Apply to Badge Component

```tsx
import { Badge, Tooltip } from '@fluentui/react-components';

// Badge with tooltip that's keyboard accessible
<Tooltip content="Detailed information about this badge">
    <Badge
        appearance="tint"
        size="small"
        tabIndex={0}
        className="focusableBadge"
        role="button"
        aria-label="Badge name. Press Enter or Space for details."
        onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                // Handle keyboard activation (e.g., toggle tooltip)
            }
        }}
    >
        Badge Text
    </Badge>
</Tooltip>
```

## Required Props

When using the `focusableBadge` class, ensure you also set:

- `tabIndex={0}` - Makes the badge focusable via keyboard
- `role="button"` - Indicates the badge is interactive (when applicable)
- `aria-label` - Provides accessible name, especially if badge has tooltip
- `onKeyDown` handler - Handles Enter/Space key activation (when applicable)

## How It Works

### Focus Management

The style uses Fluent UI's `data-fui-focus-visible` attribute, which is automatically managed by Fluent UI's tabster focus system:

- **Keyboard Focus (Tab, Shift+Tab)**: Attribute is added → Focus indicator appears
- **Mouse Click**: Attribute is NOT added → No focus indicator
- **Better UX**: Focus indicators only show when needed for keyboard navigation

### Visual Design

The focus indicator matches VS Code's focus styling:
- Uses `var(--vscode-focusBorder)` for theme consistency
- Also uses `var(--colorStrokeFocus2)` for Fluent UI consistency
- Applies border radius, outline, and box-shadow as per Fluent UI Button pattern
- Positioned with `inset: -4px` to appear outside the badge

### Fallback Support

Includes `:focus-visible` fallback for browsers that don't support Fluent UI's focus management.

## Example: Badge with Tooltip

```tsx
const [tooltipOpen, setTooltipOpen] = useState(false);

<Tooltip
    content="This is detailed information about the badge"
    visible={tooltipOpen}
    onVisibleChange={(_, data) => setTooltipOpen(data.visible)}
>
    <Badge
        appearance="tint"
        color="informative"
        size="small"
        tabIndex={0}
        className="focusableBadge"
        role="button"
        aria-label="Information badge. Press Enter or Space for details."
        onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setTooltipOpen(!tooltipOpen);
            }
        }}
    >
        Info Badge
    </Badge>
</Tooltip>
```

## Accessibility Notes

- **WCAG 2.1.1 (Keyboard)**: All functionality accessible via keyboard
- **WCAG 2.4.7 (Focus Visible)**: Focus indicator clearly visible
- **Screen Reader Support**: Use proper `aria-label` to describe badge and interaction
- **Keyboard Interaction**: Enter/Space keys should trigger the same action as click

## Browser Support

- Works in all modern browsers with Fluent UI v9 support
- Falls back to `:focus-visible` in browsers without `data-fui-focus-visible` support
- VS Code theme variables automatically adapt to dark/light/high-contrast themes
