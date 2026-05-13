---
name: fluentui
description: Patterns for FluentUI React v9 components in VS Code webviews. Use when working with any FluentUI component (Toolbar, Overflow, Menu, Button, Dialog, etc.), debugging layout or styling issues with FluentUI, implementing toolbar overflow (collapsing items into a "..." menu), or integrating FluentUI components in webview panels.
---

# FluentUI React v9 Patterns

Proven patterns and project-specific knowledge for using FluentUI React v9 components in VS Code webviews.

## Official Documentation

FluentUI provides LLM-compatible documentation. Use these URLs with `fetch_webpage` to look up any component:

- **Index (all components)**: `https://storybooks.fluentui.dev/react/llms.txt`
- **Individual component**: `https://storybooks.fluentui.dev/react/llms/components-{name}.txt`
  - Examples: `components-overflow.txt`, `components-toolbar.txt`, `components-menu-menu.txt`, `components-button-button.txt`

When working with a FluentUI component you're unfamiliar with, fetch its documentation first.

## Topic References

This skill covers multiple FluentUI topics. Load the relevant reference when needed:

- **Overflow & Toolbar**: See [references/OVERFLOW_PATTERNS.md](./references/OVERFLOW_PATTERNS.md) — Layout constraints, CSS Grid vs Flexbox, divider handling, priority ordering, debugging checklist

## When to Use

- Working with any FluentUI React v9 component in a webview
- Adding or modifying a toolbar with overflow behavior
- Debugging FluentUI layout, styling, or measurement issues
- Items not hiding/showing when the toolbar shrinks/expands
- The "..." overflow menu button renders off-screen or doesn't appear
- Placing an `<Overflow>` toolbar alongside other elements in a layout
- Integrating FluentUI components that use Griffel (CSS-in-JS) with SCSS stylesheets

## Critical Rule: Layout Constraints

**The `<Overflow>` component measures its child's `clientWidth` to decide which items to hide.** If the child can grow unconstrained, overflow never triggers.

The child of `<Overflow>` (usually `<Toolbar>`) MUST have:

```css
flex-wrap: nowrap;
min-width: 0;
overflow: hidden;
```

### Side-by-Side Layout (Pinned + Overflow)

**Use CSS Grid, not Flexbox**, when placing an overflow toolbar next to pinned elements:

```css
.toolbarContainer {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}
```

- Column 1 (`auto`): pinned toolbar — takes its natural width
- Column 2 (`minmax(0, 1fr)`): overflow toolbar — constrained to remaining space

**Why not Flexbox?** Flexbox with `margin-right: auto` on the first child or `flex-grow: 1` on the second child fails in practice. The `<Overflow>` component's `clientWidth` measurement doesn't shrink correctly in a flex context, even with `min-width: 0`. CSS Grid's `minmax(0, 1fr)` provides a hard width constraint that the overflow manager can observe via ResizeObserver.

### Right-Alignment

To push overflow items to the right edge of their column:

```css
.toolbarContainer .fui-Overflow {
  justify-content: flex-end;
}
```

## Quick Reference: Overflow Priority

Higher priority = overflows **later** (stays visible longer):

```tsx
<OverflowItem id="shell"       priority={1}>  {/* hides first */}
<OverflowItem id="playground"  priority={2}>
<OverflowItem id="copy"        priority={3}>
<OverflowItem id="import"      priority={6}>  {/* hides last */}
```

## Quick Reference: Menu Item Visibility

Each menu item must be a **separate React component** to call `useIsOverflowItemVisible` (hook rules):

```tsx
const OverflowMenuItem = ({ id, children }: { id: string; children: JSX.Element | null }) => {
  const isVisible = useIsOverflowItemVisible(id);
  return isVisible ? null : children;
};
```

## Common Pitfalls

1. **Inline `display` styles on OverflowItem children** — The overflow manager sets `display: none` via the `[data-overflowing]` attribute. If you set `display: inline-flex` via an inline `style={}` prop, React will fight the overflow manager on re-render. Use a CSS **class** instead, with an explicit `&[data-overflowing] { display: none; }` override.

2. **`<Overflow>` renders no wrapper element** — It clones its single child, merging a ref and the `fui-Overflow` class. There is no intermediate DOM node.

3. **`<Toolbar>` adds `display: flex; align-items: center`** via Griffel — You don't need to add these yourself. You only need to add `flex-wrap: nowrap; min-width: 0; overflow: hidden` for the overflow behavior.
