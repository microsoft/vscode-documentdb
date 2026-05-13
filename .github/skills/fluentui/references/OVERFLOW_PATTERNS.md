# FluentUI Overflow Patterns — Detailed Reference

## How the Overflow Manager Works

The `<Overflow>` component uses a **priority-based overflow manager** backed by a `ResizeObserver`:

1. **Available space** = `container.clientWidth - padding` (the container is the child element of `<Overflow>`)
2. **Occupied space** = sum of all visible items' `offsetWidth` + divider sizes + overflow menu size
3. Items are hidden when `occupiedSize > availableSize`, starting with the **lowest priority** item
4. Items are shown when `occupiedSize < availableSize`, restoring the **highest priority** hidden item first
5. The `padding` prop (default 10px) reserves space for the "..." menu button

The manager marks hidden items with the `data-overflowing` attribute and uses a Griffel CSS rule `[data-overflowing] { display: none }` to hide them.

## Layout Patterns

### Pattern 1: Single Full-Width Toolbar

The simplest case — everything in one `<Overflow><Toolbar>`:

```tsx
<Overflow padding={40}>
    <Toolbar size="small">
        <ToolbarButton appearance="primary">Run</ToolbarButton>
        <OverflowItem id="save" priority={3}>
            <ToolbarButton>Save</ToolbarButton>
        </OverflowItem>
        <OverflowItem id="export" priority={2}>
            <ToolbarButton>Export</ToolbarButton>
        </OverflowItem>
        <OverflowItem id="settings" priority={1}>
            <ToolbarButton>Settings</ToolbarButton>
        </OverflowItem>
        <OverflowMenu />
    </Toolbar>
</Overflow>
```

Items without `<OverflowItem>` wrappers (like "Run") never overflow. This is the vscode-cosmosdb approach.

### Pattern 2: Pinned Left + Overflow Right (CSS Grid)

Two separate toolbars side-by-side:

```tsx
<div className="toolbarMainView">
    {/* Column 1: always visible */}
    <Toolbar size="small">
        <ToolbarButton appearance="primary">Find Query</ToolbarButton>
        <ToolbarButton>Refresh</ToolbarButton>
    </Toolbar>

    {/* Column 2: overflows into "..." menu */}
    <Overflow padding={40}>
        <Toolbar size="small">
            <OverflowItem id="import" priority={6}>...</OverflowItem>
            <OverflowItem id="shell"  priority={1}>...</OverflowItem>
            <OverflowMenu />
        </Toolbar>
    </Overflow>
</div>
```

CSS (SCSS):
```scss
.toolbarMainView {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 10px;

    .fui-Overflow {
        flex-wrap: nowrap;
        min-width: 0;
        overflow: hidden;
        justify-content: flex-end;  // right-align overflow items
    }
}
```

### Why Flexbox Fails

We tested extensively and found that Flexbox does not work reliably for side-by-side overflow layouts:

| Approach | Result |
|---|---|
| Flex row + `margin-right: auto` on first child | Overflow never triggers — second child's `clientWidth` stays at content width |
| Flex row + `flex-grow: 1` on Overflow child | Same — inline styles work but CSS classes don't (specificity/cascade issue) |
| Flex row with `min-width: 0` on second child | Overflow triggers but measurement is unreliable |
| **CSS Grid `auto minmax(0, 1fr)`** | **Works reliably** — Grid enforces a hard width constraint |

The root cause: in a flex row, the Overflow component's `clientWidth` measurement depends on complex interactions between flex item sizing, Griffel's atomic CSS classes, and SCSS stylesheets. CSS Grid avoids this by giving the second column a definite maximum width (`1fr` of remaining space), which the ResizeObserver can reliably observe.

## Divider Handling

### Toolbar Divider (visible separator between groups)

Use `useIsOverflowGroupVisible` to hide the divider when either adjacent group is fully overflowed:

```tsx
const OverflowGroupDivider = () => {
    const dataVisible = useIsOverflowGroupVisible('data');
    const queryVisible = useIsOverflowGroupVisible('query');
    if (dataVisible === 'hidden' || queryVisible === 'hidden') {
        return null;
    }
    return <ToolbarDivider />;
};
```

### Menu Divider (separator inside the overflow menu)

Show the divider in the menu when a group has at least one overflowed item:

```tsx
const dataGroupVisible = useIsOverflowGroupVisible('data');
// In the menu JSX:
{dataGroupVisible !== 'visible' && <MenuDivider />}
```

## Wrapping Non-Ref-Forwarding Components

`<OverflowItem>` attaches a ref to its direct child for measurement. Components like `<Menu>` don't forward refs, so you need a wrapper element:

```tsx
<OverflowItem id="import" groupId="data" priority={6}>
    <span className="overflowItemMenuWrapper">
        <Menu>
            <MenuTrigger>
                <ToolbarButton icon={<ArrowImportRegular />}>Import</ToolbarButton>
            </MenuTrigger>
            <MenuPopover>...</MenuPopover>
        </Menu>
    </span>
</OverflowItem>
```

**Critical CSS for the wrapper:**

```scss
.overflowItemMenuWrapper {
    display: inline-flex;

    // The overflow manager hides items via [data-overflowing] { display: none }.
    // Without this override, the class-based display: inline-flex wins over
    // the attribute selector due to CSS specificity/order.
    &[data-overflowing] {
        display: none;
    }
}
```

**Never use inline `style={{ display: 'inline-flex' }}`** — React will re-apply it on every render, fighting the overflow manager's `display: none`.

## Overflow Menu Button Pattern

```tsx
const OverflowMenuButton = (props) => {
    const { ref, overflowCount, isOverflowing } = useOverflowMenu<HTMLButtonElement>();

    if (!isOverflowing) return null;

    return (
        <Menu>
            <MenuTrigger disableButtonEnhancement>
                <ToolbarButton ref={ref} icon={<MoreHorizontalRegular />}>
                    +{overflowCount}
                </ToolbarButton>
            </MenuTrigger>
            <MenuPopover>
                <MenuList>
                    <OverflowMenuItem id="import">
                        <MenuItem onClick={...}>Import</MenuItem>
                    </OverflowMenuItem>
                    {/* ... more items in toolbar DOM order ... */}
                </MenuList>
            </MenuPopover>
        </Menu>
    );
};
```

Each menu item uses a wrapper component to call the `useIsOverflowItemVisible` hook:

```tsx
const OverflowMenuItem = ({ id, children }: { id: string; children: JSX.Element | null }) => {
    const isVisible = useIsOverflowItemVisible(id);
    return isVisible ? null : children;
};
```

**Menu item order**: List items in the same order as the toolbar DOM, not in priority order. When Shell (priority 1) overflows first, it appears at the bottom of the menu — matching its toolbar position.

## Debugging Checklist

When overflow doesn't work:

1. **Check `clientWidth`** — Inspect the `fui-Overflow` element. If `clientWidth` equals `scrollWidth`, the container isn't constrained. The fix is always a layout constraint (Grid `minmax(0, 1fr)`).

2. **Check `data-overflowing`** — Hidden items should have this attribute. If present but items are still visible, a CSS `display` rule is overriding `[data-overflowing] { display: none }`.

3. **Check for inline `style.display`** — React inline styles have the highest CSS specificity. If a wrapper sets `style={{ display: 'inline-flex' }}`, it will always override the attribute selector.

4. **Check Griffel class order** — Griffel (FluentUI's CSS-in-JS) injects `<style>` tags at runtime. SCSS styles in a separate `<link>` may load in a different order, causing specificity ties to resolve unexpectedly.

5. **Test with a plain `<div>` first** — Replace `<Toolbar>` with a `<div style={{ display: 'flex', ... }}>` to isolate whether the issue is Toolbar-specific or layout-specific.

## Key FluentUI Internals

| Component | Renders DOM element? | Key behavior |
|---|---|---|
| `<Overflow>` | **No** — clones its child, adds `fui-Overflow` class + ref | Provides OverflowContext |
| `<OverflowItem>` | **No** — clones its child, adds `data-overflow-item` + `data-overflow-group` attrs + ref | Registers item with manager |
| `<Toolbar>` | `<div role="toolbar">` with `display: flex; align-items: center` | Provides toolbar ARIA semantics |
| `useOverflowMenu` | Hook returning `{ ref, isOverflowing, overflowCount }` | Registers the menu with the manager |
| `useIsOverflowItemVisible` | Hook returning `boolean` | Reads item visibility from OverflowContext |
| `useIsOverflowGroupVisible` | Hook returning `'visible' \| 'hidden' \| 'overflow'` | Reads group visibility |
