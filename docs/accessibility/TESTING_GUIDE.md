# Quick Start: Testing Query Insights Tooltip Accessibility Approaches

This guide provides step-by-step instructions for testing the three experimental accessibility approaches.

## Prerequisites

- VS Code with DocumentDB extension installed in development mode
- Accessibility Insights for Web browser extension
- Screen reader (NVDA, JAWS, or VoiceOver) - optional but recommended

## Setup

The experimental implementations are located in:
```
src/webviews/documentdb/collectionView/components/queryInsightsTab/experimental/
```

### Option 1: Test via Demo Page (Recommended)

Import and render the demo component in your test environment:

```tsx
import { QueryInsightsAccessibilityDemo } from './experimental';

// In your component or test page
<QueryInsightsAccessibilityDemo />
```

### Option 2: Test Individual Approaches

Import specific approaches:

```tsx
import { QueryInsightsApproach1 } from './experimental';
import { QueryInsightsApproach2 } from './experimental';
import { QueryInsightsApproach3 } from './experimental';

// Render the approach you want to test
<QueryInsightsApproach1 />
```

## Testing Instructions

### Approach 1: Info Buttons

**Goal**: Verify that info buttons (ⓘ) are keyboard accessible and display tooltips correctly.

#### Keyboard Testing Steps:
1. Press `Tab` repeatedly to navigate through the page
2. Notice info buttons next to each metric label
3. When an info button has focus (blue outline):
   - Press `Enter` or `Space` to show the tooltip
   - Verify tooltip appears with correct information
   - Press `Tab` to move to next element
   - Verify previous tooltip closes automatically
4. Repeat for all metrics: Execution Time, Documents Returned, Keys Examined, Documents Examined
5. Navigate to Performance Rating section
6. Tab to info buttons next to diagnostic badges
7. Press `Enter` or `Space` to show badge tooltips
8. Verify tooltip content is readable and helpful

#### Expected Behavior:
✅ All info buttons are reachable via Tab  
✅ Focus indicator clearly visible on each button  
✅ Enter/Space shows tooltip  
✅ Tooltip content is complete and readable  
✅ Tooltips close when focus moves away  
✅ No keyboard traps  

#### Screen Reader Testing:
1. Start screen reader (NVDA: `Ctrl+Alt+N`)
2. Tab to an info button
3. Verify screen reader announces: "More information about [Metric Name], button"
4. Press Enter
5. Verify tooltip content is read aloud

#### Accessibility Insights:
1. Open Accessibility Insights browser extension
2. Run "FastPass" > "Automated checks"
3. Verify no violations
4. Run "Tab stops" visualization
5. Verify all info buttons appear in tab order

---

### Approach 2: Arrow Keys

**Goal**: Verify that sections are focusable and arrow keys navigate within sections.

#### Keyboard Testing Steps:
1. Press `Tab` to focus the Metrics Row section
2. Notice blue outline around the entire section
3. Press `Arrow Right` or `Arrow Down`
4. Verify first metric card gets highlighted border
5. Notice tooltip content appears in a box below the section
6. Press `Arrow Right` again
7. Verify highlight moves to second metric
8. Verify tooltip content updates in the box below
9. Continue pressing arrow keys to navigate all metrics
10. Press `Tab` to move to Performance Rating section
11. Press `Arrow Right` to navigate badges
12. Verify badge tooltip content appears below

#### Expected Behavior:
✅ Sections focusable with Tab  
✅ Focus indicator visible on section  
✅ Arrow keys navigate within section  
✅ Active item clearly highlighted  
✅ Tooltip content appears in live region  
✅ Content updates as navigation occurs  
✅ Screen reader announces tooltip content  

#### Screen Reader Testing:
1. Tab to Metrics Row section
2. Verify announcement: "Query Performance Metrics. Use arrow keys to navigate between metrics. Group"
3. Press Arrow Right
4. Verify screen reader announces tooltip content automatically

#### Accessibility Insights:
1. Run "FastPass"
2. Check for ARIA role violations
3. Verify live regions are properly configured
4. Run "Tab stops" - should show fewer stops than Approach 1

---

### Approach 3: Keyboard Shortcut

**Goal**: Verify that Ctrl+I or Enter toggles tooltips on focused elements.

#### Keyboard Testing Steps:
1. Press `Tab` to focus a metric card
2. Notice the entire card has focus (blue outline)
3. Press `Ctrl+I` or `Enter`
4. Verify tooltip appears below the card
5. Press `Escape`
6. Verify tooltip closes
7. Press `Tab` to move to next metric
8. Press `Enter` to show tooltip
9. Repeat for all metrics
10. Tab to a diagnostic badge
11. Press `Ctrl+I` or `Enter`
12. Verify badge tooltip appears
13. Press `Escape` to close

#### Expected Behavior:
✅ Metric cards and badges focusable with Tab  
✅ Focus indicator visible  
✅ Ctrl+I or Enter shows tooltip  
✅ Escape hides tooltip  
✅ Tooltip persists until dismissed or focus moves  
✅ On-screen hint explains keyboard shortcut  

#### Screen Reader Testing:
1. Tab to a metric card
2. Verify announcement includes: "Press Ctrl+I or Enter for more information"
3. Press Ctrl+I
4. Verify tooltip content is read

#### Accessibility Insights:
1. Run "FastPass"
2. Verify ARIA labels are present and descriptive
3. Check that tooltips are properly associated with triggers

---

## Comparison Checklist

After testing all approaches, fill out this checklist:

### Discoverability
- [ ] **Approach 1**: Can sighted keyboard users easily find info buttons?
- [ ] **Approach 2**: Do users understand arrow key navigation?
- [ ] **Approach 3**: Do users discover the Ctrl+I shortcut?

### Ease of Use
- [ ] **Approach 1**: Is tabbing through all buttons tedious?
- [ ] **Approach 2**: Is arrow key navigation intuitive?
- [ ] **Approach 3**: Is the keyboard shortcut easy to remember?

### Screen Reader Experience
- [ ] **Approach 1**: Are info buttons clearly announced?
- [ ] **Approach 2**: Is live region content announced promptly?
- [ ] **Approach 3**: Are instructions clear in ARIA labels?

### Visual Design
- [ ] **Approach 1**: Do info buttons clutter the interface?
- [ ] **Approach 2**: Is the live region visually clear?
- [ ] **Approach 3**: Is the design clean without visual additions?

### WCAG Compliance
- [ ] **Approach 1**: Meets WCAG 2.1.1 (Keyboard)?
- [ ] **Approach 2**: Meets WCAG 2.1.1 (Keyboard)?
- [ ] **Approach 3**: Meets WCAG 2.1.1 (Keyboard)?

---

## Common Issues to Check

### Focus Indicators
- Are focus indicators visible in all themes (dark, light, high contrast)?
- Is the contrast ratio sufficient (minimum 3:1)?
- Do focus indicators persist while tooltips are open?

### Keyboard Traps
- Can you Tab forward through all interactive elements?
- Can you Shift+Tab backward?
- Can you exit tooltips and sections without mouse?

### Tooltips
- Do tooltips contain all necessary information?
- Are tooltips readable with sufficient contrast?
- Do tooltips disappear appropriately?
- Do multiple tooltips overlap or cause layout issues?

### Screen Readers
- Is all visual information available to screen readers?
- Are instructions clear and helpful?
- Are ARIA roles and properties correct?
- Is content announced at appropriate times?

---

## Reporting Results

After testing, document your findings:

### Template

```markdown
## Testing Results: Approach [1/2/3]

### Environment
- Browser: [Chrome/Firefox/Edge/Safari]
- Screen Reader: [NVDA/JAWS/VoiceOver/None]
- OS: [Windows/Mac/Linux]

### Keyboard Testing
- [ ] All tooltips accessible: [Yes/No/Partial]
- [ ] Focus indicators visible: [Yes/No]
- [ ] No keyboard traps: [Yes/No]
- [ ] Ease of navigation: [Easy/Medium/Difficult]

### Screen Reader Testing
- [ ] Content announced correctly: [Yes/No/N/A]
- [ ] Instructions clear: [Yes/No/N/A]
- [ ] ARIA working properly: [Yes/No/N/A]

### Accessibility Insights
- [ ] FastPass: [Passed/Failed]
- [ ] Tab stops: [X found, expected Y]
- [ ] Issues found: [None/List issues]

### User Experience
- [ ] Discoverability: [High/Medium/Low]
- [ ] Learning curve: [Easy/Medium/Steep]
- [ ] Overall impression: [Excellent/Good/Fair/Poor]

### Issues Found
1. [Description of issue 1]
2. [Description of issue 2]

### Recommendation
[Support/Do not support] this approach because [reasons]
```

---

## Next Steps After Testing

1. **Compile Results**: Gather all test results in one document
2. **Compare Approaches**: Use findings to compare pros/cons
3. **Make Decision**: Choose the best approach based on data
4. **Implement**: Apply chosen approach to actual Query Insights tab
5. **Validate**: Test implementation with same rigor
6. **Document**: Update user documentation with keyboard instructions

---

## Resources

- [Accessibility Insights Download](https://accessibilityinsights.io/)
- [NVDA Screen Reader](https://www.nvaccess.org/download/)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)

## Questions?

If you encounter issues or have questions:
1. Check `IMPLEMENTATION_SUMMARY.md` for overview
2. Check `experimental/README.md` for developer details
3. Check `query-insights-tooltip-accessibility-exploration.md` for analysis
4. Open a discussion on GitHub
