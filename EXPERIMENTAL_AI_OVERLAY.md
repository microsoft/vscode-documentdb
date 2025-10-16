# Experimental AI Input Overlay Implementation

## Overview

This branch implements an experimental approach for the AI input feature using an overlay pattern instead of the previous collapse/expand pattern.

## Key Changes

### Approach Difference

**Previous Implementation (Collapse-based):**

- AI input row collapsed/expanded above the filter row
- Layout shifted when toggling AI mode
- Required scrollbar hiding logic to prevent flickering
- Height changes caused visual jumps

**New Implementation (Overlay-based):**

- Regular query inputs (filter + enhanced area) remain in place
- When AI mode is enabled, query inputs are hidden with `visibility: hidden` (space preserved)
- AI input appears as an overlay with Scale animation
- Centered vertically in the preserved space
- No layout shifts at all

### Implementation Details

#### 1. QueryEditor Component (`QueryEditor.tsx`)

- Wrapped filter row and enhanced area in `.queryContent` container
- Added conditional `hidden` class when `isAiRowVisible` is true
- Replaced Collapse-based AI row with Scale-based overlay
- AI overlay is absolutely positioned and centered

#### 2. Styling (`queryEditor.scss`)

- `.queryEditor` set to `position: relative` for overlay positioning
- `.queryContent.hidden` uses `visibility: hidden` to hide but preserve space
- `.aiInputOverlay` absolutely positioned (top:0, left:0, right:0, bottom:0)
- Flexbox centering for AI input
- Semi-transparent background with subtle backdrop blur
- Constrained max-width (600px) for better UX

#### 3. Animation

- Uses Fluent UI's `Scale` component from `@fluentui/react-motion-components-preview`
- Same `visible` prop pattern as Collapse
- Provides zoom-in/zoom-out effect

#### 4. Removed Complexity

- No need for scrollbar hiding when toggling AI mode (no layout shifts)
- `useHideScrollbarsDuringResize` hook still used for enhanced mode toggle
- Removed hook import and usage from ToolbarMainView

### Benefits

✅ **No Layout Shifts**: Space is preserved, eliminates all scrollbar flickering issues
✅ **Cleaner UX**: Feels like a true "mode switch" rather than content appearing/disappearing
✅ **Simpler Code**: Removed scrollbar hiding logic for AI toggle
✅ **Better Visual Hierarchy**: Overlay with backdrop makes it clear you're in "AI mode"
✅ **Smooth Animation**: Scale effect is elegant and intuitive
✅ **Accessibility**: Content properly hidden with visibility, not removed from DOM

### Potential Issues to Watch

⚠️ **Dynamic Height**: Query editor height varies based on filter content (1-10 lines). AI input is centered in whatever space exists.
⚠️ **Enhanced Mode State**: Enhanced mode can still be toggled while AI is active, but it's hidden behind the overlay.
⚠️ **User Confusion**: First-time users might wonder where their query went. Consider adding a visual indicator.

### Testing Checklist

- [ ] Toggle AI mode from toolbar button
- [ ] Toggle AI mode from inline button (removed in this implementation)
- [ ] Verify focus automatically moves to AI input when enabled
- [ ] Test with enhanced mode open before enabling AI
- [ ] Test rapid toggling of AI mode
- [ ] Verify no scrollbar flickering
- [ ] Test on different screen sizes
- [ ] Verify backdrop visibility and blur effect
- [ ] Check accessibility (screen readers, keyboard navigation)
- [ ] Test in both light and dark themes

### Reverting to Previous Implementation

If this experimental approach doesn't work out:

1. Restore AI row as Collapse-based component above filter row
2. Restore scrollbar hiding logic in ToolbarMainView
3. Remove `.queryContent` wrapper and overlay styling
4. Remove `Scale` import and component usage

### Next Steps

1. User testing to gather feedback on the overlay approach
2. Consider adding a visual indicator (e.g., "AI Mode" badge)
3. Possibly fix query editor height when AI mode is active
4. Add subtle entrance/exit animations for the backdrop
5. Consider adding escape key handler to close AI mode
