# Query Insights Tooltip Accessibility - Experimental Implementations

This directory contains experimental implementations of different approaches to make tooltips in the Query Insights tab keyboard accessible.

## Problem

Tooltips in the Query Insights tab are currently only accessible via mouse hover, creating a barrier for keyboard-only users. This affects:
- Metrics Row (Execution Time, Documents Returned, Keys Examined, Documents Examined)
- Performance Rating badges (diagnostic information)

## Experimental Approaches

### Approach 1: Info Buttons with Individual Tab Stops
**File**: `Approach1.tsx`

Adds visible info buttons (ⓘ) next to each element with a tooltip. Each button is keyboard focusable.

**How to test**:
1. Press Tab to navigate through metrics and badges
2. Each info button is a separate tab stop
3. Press Enter or Space to show tooltip
4. Use mouse hover to see tooltip

**Pros**:
- Clear visual affordance
- Explicit tab order
- Standard UI pattern

**Cons**:
- Visual clutter
- More tab stops (8+ additional)
- Redundant for mouse users

### Approach 2: Section-Based Navigation with Arrow Keys
**File**: `Approach2.tsx`

Makes sections focusable with Tab. Use Arrow keys to navigate within a section. Tooltip content is displayed in a live region below the section.

**How to test**:
1. Press Tab to focus a section (metrics row or badges)
2. Press Arrow keys (←/→ or ↑/↓) to navigate between items
3. Tooltip content appears in a box below
4. Screen reader announces tooltip content

**Pros**:
- Fewer tab stops (4 instead of 12+)
- Natural semantic grouping
- Efficient navigation

**Cons**:
- Non-standard pattern
- Learning curve
- No visual indication of arrow key support

### Approach 3: Hybrid - Tab Stops + Keyboard Shortcut
**File**: `Approach3.tsx`

Makes elements focusable with Tab. Press Ctrl+I or Enter when focused to toggle tooltip visibility.

**How to test**:
1. Press Tab to focus a metric or badge
2. Press Ctrl+I or Enter to show tooltip
3. Press Escape to hide tooltip
4. Screen reader announces "Press Ctrl+I for details"

**Pros**:
- Discoverable via ARIA
- Minimal UI changes
- Natural tab order

**Cons**:
- Hidden affordance for sighted users
- Potential keyboard shortcut conflicts
- Discoverability challenge

## Demo Page

**File**: `Demo.tsx`

Provides a tabbed interface to compare all three approaches side by side, including a comparison table.

## How to Use These Files

### For Development Testing

To test these experimental implementations in the running extension:

1. Import the demo component in your collection view or create a new test page
2. Render the `QueryInsightsAccessibilityDemo` component
3. Use the tab navigation to switch between approaches

Example:
```tsx
import { QueryInsightsAccessibilityDemo } from './experimental';

// In your component
<QueryInsightsAccessibilityDemo />
```

### For Accessibility Testing

1. Open the extension with the experimental demo
2. Use Accessibility Insights for Web to scan each approach
3. Test with keyboard only (Tab, Arrow keys, Enter, Space, Escape)
4. Test with screen readers (NVDA, JAWS, VoiceOver)
5. Verify WCAG 2.1 compliance (especially 2.1.1 Keyboard)

### Testing Checklist

- [ ] All tooltips accessible via keyboard
- [ ] Tab order is logical
- [ ] Focus indicators are visible
- [ ] Screen reader announces tooltip content
- [ ] No keyboard traps
- [ ] Works in VS Code dark/light themes
- [ ] Works in high contrast mode

## Mock Data

**File**: `mockData.ts`

Contains mock metric and performance data used by all experimental implementations.

## Recommendation

After evaluation with accessibility tools and user testing, **Approach 1 (Info Buttons)** is recommended as it:
- Meets WCAG 2.1.1 (Keyboard) clearly
- Uses familiar UI patterns
- Provides clear visual affordances
- Works well with screen readers

## Next Steps

1. Evaluate each approach with Accessibility Insights
2. Conduct user testing with keyboard-only users
3. Test with screen readers (NVDA, JAWS)
4. Implement chosen approach in the actual Query Insights tab
5. Update documentation with keyboard navigation instructions

## Files in This Directory

- `Approach1.tsx` / `Approach1.scss` - Info buttons implementation
- `Approach2.tsx` / `Approach2.scss` - Arrow key navigation implementation
- `Approach3.tsx` / `Approach3.scss` - Keyboard shortcut implementation
- `Demo.tsx` / `Demo.scss` - Comparison demo page
- `mockData.ts` - Mock data for testing
- `index.ts` - Exports for all experimental components
- `README.md` - This file
