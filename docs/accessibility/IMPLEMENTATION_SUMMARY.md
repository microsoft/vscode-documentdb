# Query Insights Tooltip Accessibility - Implementation Summary

## Overview

This document summarizes the work completed to address the accessibility issue where tooltips in the Query Insights tab are not keyboard accessible.

**Issue**: [A11y_DocumentDB for VS Code Extension_View Query Insights_Keyboard](https://github.com/microsoft/vscode-documentdb/issues/XXX)

**WCAG Guideline**: 2.1.1 (Keyboard) - All functionality must be operable through keyboard interface

## Problem Statement

Tooltips in the Query Insights tab are only accessible via mouse hover, creating a barrier for keyboard-only users. Specifically:

1. **Metrics Row**: Tooltips explaining "Execution Time", "Documents Returned", "Keys Examined", and "Documents Examined" cannot be accessed with keyboard
2. **Performance Rating Section**: Diagnostic badges with detailed information are not keyboard accessible

## Work Completed

### 1. Exploration Document

**Location**: `docs/accessibility/query-insights-tooltip-accessibility-exploration.md`

A comprehensive analysis document that:
- Defines the problem and WCAG requirements
- Documents current implementation limitations
- Proposes three different approaches with detailed pros/cons
- Provides implementation examples for each approach
- Includes a testing checklist
- Recommends Approach 1 as the primary solution

### 2. Experimental Implementations

**Location**: `src/webviews/documentdb/collectionView/components/queryInsightsTab/experimental/`

Three complete, working implementations demonstrating different accessibility solutions:

#### Approach 1: Info Buttons with Individual Tab Stops
**Files**: `Approach1.tsx`, `Approach1.scss`

**Description**: Adds visible info buttons (ⓘ) next to each element with a tooltip. Each button is keyboard focusable and activates tooltips on click or keyboard interaction.

**Key Features**:
- Info button next to each metric label
- Info button next to each performance diagnostic badge
- Tab to each button
- Enter or Space to show tooltip
- Hover still works for mouse users

**Pros**:
- ✅ Clear visual affordance
- ✅ Explicit tab order
- ✅ Standard UI pattern
- ✅ WCAG 2.1.1 compliant

**Cons**:
- ❌ Visual clutter (8+ additional buttons)
- ❌ Increased tab stops
- ❌ Redundant for mouse users

#### Approach 2: Section-Based Navigation with Arrow Keys
**Files**: `Approach2.tsx`, `Approach2.scss`

**Description**: Makes entire sections keyboard focusable. Users Tab to a section, then use Arrow keys to navigate between items within that section. Tooltip content is displayed in an ARIA live region.

**Key Features**:
- Tab to focus metrics row or performance rating section
- Arrow keys (←/→ or ↑/↓) to navigate within section
- Active item highlighted with border
- Tooltip content appears in a box below the section
- Screen reader announces tooltip content automatically

**Pros**:
- ✅ Fewer tab stops (4 instead of 12+)
- ✅ Natural semantic grouping
- ✅ Efficient navigation within sections

**Cons**:
- ❌ Non-standard pattern (uncommon on web)
- ❌ Learning curve for users
- ❌ No visual indication of arrow key support

#### Approach 3: Hybrid - Tab Stops + Keyboard Shortcut
**Files**: `Approach3.tsx`, `Approach3.scss`

**Description**: Makes cards and badges focusable with Tab. Users press Ctrl+I or Enter when focused to toggle tooltip visibility.

**Key Features**:
- Tab to focus metric card or badge
- Press Ctrl+I or Enter to show tooltip
- Press Escape to hide tooltip
- ARIA labels announce "Press Ctrl+I for details"
- On-screen hint explains keyboard shortcut

**Pros**:
- ✅ Discoverable via ARIA for screen readers
- ✅ Minimal UI changes
- ✅ Natural tab order

**Cons**:
- ❌ Hidden affordance for sighted users
- ❌ Potential keyboard shortcut conflicts
- ❌ Discoverability challenge

### 3. Interactive Demo Page

**Location**: `experimental/Demo.tsx`, `Demo.scss`

A tabbed interface that allows side-by-side comparison of all three approaches:

**Features**:
- Tab navigation to switch between approaches
- Live, working demonstrations of each approach
- Comparison table with pros/cons for each
- Recommendation section
- Instructions for keyboard testing

**How to Use**:
```tsx
import { QueryInsightsAccessibilityDemo } from './experimental';

// Render in your component
<QueryInsightsAccessibilityDemo />
```

### 4. Mock Data

**Location**: `experimental/mockData.ts`

Provides sample data for all experimental implementations:
- Mock metrics (Execution Time, Documents Returned, etc.)
- Mock performance rating with diagnostics
- Mock efficiency analysis data

### 5. Documentation

**Location**: `experimental/README.md`

Complete documentation for the experimental implementations:
- Detailed description of each approach
- Testing instructions
- Integration guide
- Accessibility testing checklist
- Recommendation

## Recommendation

After thorough analysis, **Approach 1 (Info Buttons with Individual Tab Stops)** is recommended as the primary solution because:

1. **WCAG Compliance**: Clearly meets WCAG 2.1.1 (Keyboard) requirement
2. **Discoverability**: Info buttons are universally recognized
3. **Standard Pattern**: Follows established UI conventions
4. **Screen Reader Support**: Works naturally with assistive technologies
5. **No Learning Curve**: Users immediately understand how to access tooltips

While Approach 1 adds visual elements, the accessibility benefit outweighs the visual cost. The other approaches may be considered as alternatives if user testing reveals issues with Approach 1.

## Testing Guide

### Manual Keyboard Testing

1. **Load the demo page** with all three approaches
2. **Test each approach** using only keyboard:
   - Tab through all interactive elements
   - Verify focus indicators are visible
   - Access all tooltip content
   - Check for keyboard traps
   - Verify Escape key closes tooltips (where applicable)

### Approach 1 Testing
- [ ] Tab to each info button
- [ ] Press Enter or Space to show tooltip
- [ ] Verify tooltip appears and contains correct information
- [ ] Tab to next info button
- [ ] Verify previous tooltip closes

### Approach 2 Testing
- [ ] Tab to metrics row
- [ ] Press Arrow keys to navigate between metrics
- [ ] Verify active metric is highlighted
- [ ] Verify tooltip content appears in live region below
- [ ] Tab to performance rating section
- [ ] Press Arrow keys to navigate between badges
- [ ] Verify badge tooltip content appears

### Approach 3 Testing
- [ ] Tab to a metric card
- [ ] Press Ctrl+I or Enter
- [ ] Verify tooltip appears
- [ ] Press Escape
- [ ] Verify tooltip closes
- [ ] Tab to a badge
- [ ] Press Ctrl+I or Enter
- [ ] Verify tooltip appears

### Screen Reader Testing

Test with NVDA, JAWS, or VoiceOver:

- [ ] All tooltips are announced
- [ ] Instructions for accessing tooltips are clear
- [ ] ARIA labels provide context
- [ ] Live regions announce content changes (Approach 2)
- [ ] Focus order is logical
- [ ] No missing or incorrect ARIA attributes

### Accessibility Insights Testing

1. Install [Accessibility Insights for Web](https://accessibilityinsights.io/)
2. Run "FastPass" on each approach
3. Run "Assessment" on chosen approach
4. Verify no violations of WCAG 2.1 Level A and AA
5. Check keyboard navigation specifically

## Integration Plan

### Phase 1: Validation (Current)
- ✅ Create exploration document
- ✅ Implement experimental approaches
- ✅ Create demo page
- ⬜ Test with Accessibility Insights
- ⬜ Test with screen readers
- ⬜ Gather feedback

### Phase 2: Implementation (Next)
- ⬜ Implement chosen approach in actual QueryInsightsTab.tsx
- ⬜ Update MetricBase.tsx component
- ⬜ Update PerformanceRatingCell.tsx component
- ⬜ Add keyboard event handlers
- ⬜ Update SCSS styles
- ⬜ Test thoroughly

### Phase 3: Documentation (Final)
- ⬜ Update user documentation
- ⬜ Add keyboard navigation guide
- ⬜ Update accessibility documentation
- ⬜ Create release notes

## Files Modified/Created

### New Files
```
docs/accessibility/
└── query-insights-tooltip-accessibility-exploration.md

src/webviews/documentdb/collectionView/components/queryInsightsTab/experimental/
├── Approach1.tsx
├── Approach1.scss
├── Approach2.tsx
├── Approach2.scss
├── Approach3.tsx
├── Approach3.scss
├── Demo.tsx
├── Demo.scss
├── mockData.ts
├── index.ts
└── README.md
```

### Future Modifications (Phase 2)
```
src/webviews/documentdb/collectionView/components/queryInsightsTab/
├── components/
│   ├── metricsRow/
│   │   └── MetricBase.tsx          (to be modified)
│   └── summaryCard/
│       └── custom/
│           └── PerformanceRatingCell.tsx  (to be modified)
└── QueryInsightsTab.tsx            (testing integration)
```

## Next Steps

1. **Testing Phase**:
   - Run Accessibility Insights on all three approaches
   - Test with NVDA and JAWS screen readers
   - Document test results

2. **Validation Phase**:
   - Share findings with accessibility team
   - Get feedback from keyboard-only users
   - Confirm chosen approach

3. **Implementation Phase**:
   - Implement Approach 1 in actual Query Insights tab
   - Update related components
   - Comprehensive testing

4. **Documentation Phase**:
   - Update user-facing documentation
   - Create keyboard navigation guide
   - Update changelog

## Resources

- [WCAG 2.1 - Guideline 2.1.1 Keyboard](https://www.w3.org/WAI/WCAG21/Understanding/keyboard)
- [Accessibility Insights](https://accessibilityinsights.io/)
- [Fluent UI Accessibility](https://react.fluentui.dev/?path=/docs/concepts-developer-accessibility--page)
- [ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/)

## Questions?

For questions or feedback about this implementation, please:
- Review the exploration document: `docs/accessibility/query-insights-tooltip-accessibility-exploration.md`
- Check the experimental README: `src/webviews/.../experimental/README.md`
- Test the demo page to see each approach in action
- Open a discussion on the GitHub repository
