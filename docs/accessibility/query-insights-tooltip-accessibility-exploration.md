# Query Insights Tooltip Accessibility - Exploration Document

## Problem Statement

Tooltips in the Query Insights tab are not keyboard accessible. This affects:

1. **Metrics Row**: Execution Time, Documents Returned, Keys Examined, Documents Examined
2. **Performance Rating Section**: Diagnostic badges (Fair, Good, Poor, Excellent indicators)

Currently, these tooltips only appear on hover, with no keyboard navigation support. This creates a barrier for keyboard-only users who cannot access important explanatory information.

## Current Implementation

### Metrics (MetricBase.tsx)
- Uses Fluent UI `Tooltip` component
- Wraps `Card` component with tooltip
- Tooltip shows on hover only
- No keyboard navigation support
- No visible info icon or affordance

### Performance Rating Badges (PerformanceRatingCell.tsx)
- Uses Fluent UI `Tooltip` component
- Wraps `Badge` components with detailed diagnostics
- Tooltip shows on hover only
- No keyboard navigation support
- Badges use `InfoRegular` icon but are not focusable

## Accessibility Requirements (WCAG 2.1)

### Relevant Guidelines
- **WCAG 2.1.1 (Keyboard)**: All functionality must be operable through keyboard
- **WCAG 2.1.3 (Keyboard No Exception)**: No exceptions to keyboard accessibility
- **WCAG 4.1.2 (Name, Role, Value)**: Components must have proper ARIA labels

### User Impact
Keyboard-only users cannot access:
- Explanatory information about metrics
- Detailed diagnostic information for performance ratings
- Context-sensitive help content

---

## Approach 1: Info Buttons with Individual Tab Stops

### Description
Add a visible info button (ⓘ) next to each element that has a tooltip. Each button is keyboard focusable and activates the tooltip on Enter/Space.

### Implementation Details

#### Metrics Row
```tsx
// MetricBase.tsx modification
<Card className="metricCard" appearance="filled">
  <div className="metricHeader">
    <div className="dataHeader">{label}</div>
    {tooltipExplanation && (
      <Button
        appearance="transparent"
        icon={<InfoRegular />}
        size="small"
        aria-label={`More information about ${label}`}
        onClick={() => setTooltipOpen(!tooltipOpen)}
      />
    )}
  </div>
  <div className="dataValue">{renderValue()}</div>
</Card>
```

#### Performance Rating Badges
```tsx
// PerformanceRatingCell.tsx modification
<Badge
  appearance="tint"
  color={diagnostic.type === 'positive' ? 'success' : 'informative'}
  size="small"
  shape="rounded"
  icon={
    <Button
      appearance="transparent"
      icon={<InfoRegular />}
      size="small"
      tabIndex={0}
      aria-label={`More information about ${diagnostic.message}`}
      onFocus={() => setTooltipOpen(true)}
      onBlur={() => setTooltipOpen(false)}
    />
  }
>
  {diagnostic.message}
</Badge>
```

### Pros
1. **Clear Visual Affordance**: Info buttons (ⓘ) are universally recognized as "more information" indicators
2. **Explicit Tab Order**: Each tooltip has a clear tab stop, making navigation predictable
3. **Standard Pattern**: Follows common UI patterns users are familiar with (help icons)

### Cons
1. **Visual Clutter**: Adds extra UI elements (info buttons) to an already information-dense interface
2. **Tab Order Length**: Increases the number of tab stops, potentially making navigation tedious (8+ additional stops)
3. **Redundant for Mouse Users**: Hover still works, so buttons might feel unnecessary for mouse users

---

## Approach 2: Section-Based Navigation with Arrow Keys

### Description
Make entire cards/sections keyboard focusable. Use Arrow keys to navigate between sub-elements within a section. Tooltip shows when focus is on an element.

### Implementation Details

#### Metrics Row
```tsx
// MetricsRow.tsx modification
<div 
  className="metricsRow"
  role="region"
  aria-label="Query Performance Metrics"
>
  {metrics.map((metric, index) => (
    <MetricCard
      key={metric.label}
      tabIndex={0}
      role="group"
      aria-label={`${metric.label}: ${metric.value}`}
      aria-describedby={`metric-tooltip-${index}`}
      onFocus={() => setActiveMetric(index)}
      onKeyDown={(e) => handleKeyNavigation(e, index)}
    >
      {/* Card content */}
    </MetricCard>
  ))}
  
  {/* Live region for tooltip content */}
  <div 
    id={`metric-tooltip-${activeMetric}`}
    role="tooltip"
    aria-live="polite"
  >
    {metrics[activeMetric]?.tooltipExplanation}
  </div>
</div>
```

### Pros
1. **Fewer Tab Stops**: Only one tab stop per section, reducing navigation burden (4 stops instead of 12+)
2. **Natural Grouping**: Reflects semantic structure - sections are logical units
3. **Efficient Navigation**: Arrow keys provide quick access within a section without leaving it

### Cons
1. **Non-Standard Pattern**: Arrow key navigation within cards is not a common web pattern
2. **Learning Curve**: Users need to discover that sections are navigable with arrow keys
3. **Discoverability Issues**: No visual indication that arrow keys work within a section

---

## Approach 3: Hybrid - Tab Stops + Keyboard Shortcut

### Description
Make cards/badges focusable with Tab. Add a keyboard shortcut (Ctrl+I or ?) to toggle tooltip visibility when focused on an element.

### Implementation Details

#### Global Keyboard Handler
```tsx
// QueryInsightsTab.tsx
const [focusedElement, setFocusedElement] = useState<string | null>(null);
const [tooltipVisible, setTooltipVisible] = useState(false);

useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    // Toggle tooltip with Ctrl+I when focused on element with tooltip
    if (e.ctrlKey && e.key === 'i') {
      if (focusedElement && hasTooltip(focusedElement)) {
        e.preventDefault();
        setTooltipVisible(!tooltipVisible);
      }
    }
  };
  
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [focusedElement, tooltipVisible]);
```

### Pros
1. **Discoverable via ARIA**: Screen readers announce "Press Ctrl+I for details" making feature discoverable
2. **Minimal UI Changes**: No additional visual elements, maintains clean interface
3. **Consistent Tab Order**: Elements appear in natural tab order without extra stops for info buttons

### Cons
1. **Hidden Affordance**: Keyboard shortcut not visible to sighted users (requires documentation or hint)
2. **Keyboard Shortcut Conflict**: Ctrl+I might conflict with VS Code or browser shortcuts
3. **Discoverability Challenge**: Non-screen-reader users may not discover the feature

---

## Recommended Approach: Approach 1 (Info Buttons with Individual Tab Stops)

### Rationale
1. **WCAG Compliance**: Clearly meets 2.1.1 (Keyboard) with explicit tab stops
2. **User Familiarity**: Uses established patterns (info buttons, tooltips)
3. **Discoverability**: Buttons are visible, making them accessible to all users
4. **Screen Reader Support**: Proper ARIA labels guide screen reader users

### Implementation Priority
1. Add info buttons to all metric cards
2. Make performance rating badges focusable
3. Ensure proper ARIA labels and keyboard handlers
4. Test with Accessibility Insights and screen readers

---

## Testing Checklist

### Keyboard Navigation
- [ ] All tooltips accessible via keyboard (Tab, Enter, Space)
- [ ] Tab order is logical and intuitive
- [ ] Focus indicators are clearly visible
- [ ] Escape key closes tooltips appropriately
- [ ] No keyboard traps

### Screen Reader Support
- [ ] All tooltips have proper ARIA labels
- [ ] Tooltip content is announced when accessed
- [ ] Role and state information is correct

### Visual Design
- [ ] Focus indicators meet WCAG contrast requirements
- [ ] Layout remains responsive with new elements
- [ ] No overlap or z-index issues with tooltips
