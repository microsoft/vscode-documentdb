# React Architecture Guidelines for DocumentDB Webviews

This document describes the patterns, practices, and architectural decisions used in the React-based webviews of the vscode-documentdb extension.

## Overview

The webviews folder contains React-based UI components for two main views:

- **`documentView/`**: Simpler, cleaner architecture for viewing/editing individual documents
- **`collectionView/`**: More complex view for querying and displaying collections with multiple data presentation modes

---

## Table of Contents

1. [Component Structure](#component-structure)
2. [State Management](#state-management)
3. [Styling Approach](#styling-approach)
4. [React Hooks Usage](#react-hooks-usage)
5. [Monaco Editor Integration](#monaco-editor-integration)
6. [Third-Party Component Integration](#third-party-component-integration)
7. [Common Patterns](#common-patterns)
8. [Known Issues & Anti-Patterns](#known-issues--anti-patterns)

---

## Component Structure

### File Organization

Each view follows a consistent structure:

```
viewName/
├── viewName.tsx           # Main component
├── viewName.scss          # View-specific styles
├── viewNameContext.ts     # Context and state types (if complex)
├── components/            # Sub-components
│   ├── Component.tsx
│   ├── component.scss     # Component-specific styles (if needed)
│   └── toolbar/           # Nested component groups
└── viewNameController.ts  # Backend communication logic
```

### Component Hierarchy Example

**DocumentView** (simpler):

```tsx
DocumentView
├── ToolbarDocuments (toolbar component)
└── MonacoEditor (editor component)
```

**CollectionView** (more complex):

```tsx
CollectionView
├── ToolbarMainView
├── QueryEditor
│   └── MonacoAdaptive
├── DataView (switched based on currentView)
│   ├── DataViewPanelTableV2
│   ├── DataViewPanelTree
│   └── DataViewPanelJSON
└── ToolbarTableNavigation
```

---

## State Management

### Local State with `useState`

Used for simple, component-local state:

```tsx
const [isLoading, setIsLoading] = useState(false);
const [isDirty, setIsDirty] = useState(true);
const [editorContent, setEditorContent] = useState('{ }');
```

### Context API for Shared State

**CollectionView** uses React Context for complex, cross-component state:

```tsx
// Define context type
export type CollectionViewContextType = {
  isLoading: boolean;
  currentView: Views;
  currentQueryDefinition: {
    queryText: string;
    pageNumber: number;
    pageSize: number;
  };
  dataSelection: {
    selectedDocumentObjectIds: string[];
    selectedDocumentIndexes: number[];
  };
  // ... more state
};

// Create context with tuple pattern [state, setState]
export const CollectionViewContext = createContext<
  [CollectionViewContextType, React.Dispatch<React.SetStateAction<CollectionViewContextType>>]
>([DefaultCollectionViewContext, () => {}]);

// Usage in parent component
const [currentContext, setCurrentContext] = useState<CollectionViewContextType>(DefaultCollectionViewContext);

return (
  <CollectionViewContext.Provider value={[currentContext, setCurrentContext]}>
    {/* children */}
  </CollectionViewContext.Provider>
);

// Usage in child component
const [currentContext, setCurrentContext] = useContext(CollectionViewContext);
```

**Note**: DocumentView is simpler and doesn't require context - it uses props and local state.

### State Updates

Always use functional updates when new state depends on previous state:

```tsx
setCurrentContext((prev) => ({
  ...prev,
  isLoading: true,
  currentQueryDefinition: {
    ...prev.currentQueryDefinition,
    pageNumber: 1,
  },
}));
```

---

## Styling Approach

### SCSS Files

Each component can have its own `.scss` file. Styles are imported directly in the component:

```tsx
import './collectionView.scss';
```

### Shared Styles

Common styles are in `sharedStyles.scss`:

```scss
// src/webviews/documentdb/sharedStyles.scss
@use '../index.scss';

$media-breakpoint-query-control-area: 1024px;
```

Use `@extend` to apply shared styles:

```scss
.collectionView {
  @extend .selectionDisabled;
  // ... other styles
}
```

### Spacing and Layout Patterns

**Consistent spacing unit: `10px`**

#### Flexbox Layouts with Gaps

```scss
.documentView {
  display: flex;
  flex-direction: column;
  height: 100vh;
  row-gap: 10px; // Consistent 10px spacing between flex children
}

.collectionView {
  display: flex;
  flex-direction: column;
  row-gap: 10px;
  height: 100vh;
}
```

#### Padding Patterns

```scss
.toolbarContainer {
  padding-top: 10px; // Top padding for toolbars
}

.monacoAdaptiveContainer {
  padding-top: 6px;
  padding-bottom: 6px;
  padding-right: 4px;
}
```

#### Flexbox Sizing

```scss
.monacoContainer {
  flex-grow: 1; // Take available space
  flex-shrink: 1; // Allow shrinking
  flex-basis: 0%; // Start from 0 and grow
}

.toolbarContainer {
  flex-grow: 0; // Don't grow
  flex-shrink: 1; // Allow shrinking
  flex-basis: auto; // Use content size
}
```

#### Negative Margins (Use with Caution)

```scss
.toolbarTableNavigation {
  margin-top: -10px; // Pull element up to reduce spacing
}
```

**⚠️ WARNING**: Negative margins can cause layout issues and should be used sparingly. Consider if the layout can be achieved with proper flexbox/gap instead.

#### Inline Styles (Avoid When Possible)

Some inline styles are used in components:

```tsx
<TabList selectedValue="tab_result" style={{ marginTop: '-10px' }}>
```

**🔴 ISSUE**: Inline styles should be moved to SCSS files for consistency and maintainability.

---

## React Hooks Usage

### `useEffect` - Component Lifecycle

#### Run Once on Mount (Empty Dependency Array)

```tsx
useEffect(() => {
  // Fetch initial data
  void trpcClient.mongoClusters.documentView.getDocumentById.query(documentId).then((response) => setContent(response));
}, []); // Empty array = run once on mount
```

#### Run on Specific State Changes

```tsx
useEffect(() => {
  // Run query whenever query definition changes
  trpcClient.mongoClusters.collectionView.runQuery.query({
    findQuery: currentContext.currentQueryDefinition.queryText,
    pageNumber: currentContext.currentQueryDefinition.pageNumber,
  });
}, [currentContext.currentQueryDefinition]); // Re-run when this changes
```

#### Cleanup Pattern

```tsx
useEffect(() => {
  const debouncedResizeHandler = debounce(handleResize, 200);
  window.addEventListener('resize', debouncedResizeHandler);

  // Cleanup function
  return () => {
    if (editorRef.current) {
      editorRef.current.dispose();
    }
    window.removeEventListener('resize', debouncedResizeHandler);
  };
}, []);
```

### `useRef` - Storing Mutable References

#### Storing DOM/Component References

```tsx
const editorRef = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null);

// Set ref when component mounts
const handleMonacoEditorMount = (editor: monacoEditor.editor.IStandaloneCodeEditor) => {
  editorRef.current = editor;
};

// Access later without causing re-renders
const getCurrentContent = () => editorRef.current?.getValue() || '';
```

#### Solving Stale Closure Issues

**🚨 CRITICAL PATTERN**: When using third-party components (like SlickGrid) that don't automatically update event handlers on re-renders:

```tsx
// Problem: Event handlers capture state at initialization time
// Solution: Store latest state in refs

const [currentQueryResults, setCurrentQueryResults] = useState<QueryResults>();
const currentQueryResultsRef = useRef(currentQueryResults);

// Keep ref in sync with state
useEffect(() => {
  currentQueryResultsRef.current = currentQueryResults;
}, [currentQueryResults]);

// In event handler, use ref to get latest data
const onCellDblClick = useCallback((event: CustomEvent) => {
  // ✅ Good: Access latest data via ref
  const activeDocument = currentQueryResultsRef.current?.tableData?.[row];

  // ❌ Bad: Would capture stale state
  // const activeDocument = currentQueryResults?.tableData?.[row];
}, []);
```

**Why this is needed:**

```tsx
// Third-party components like SlickGrid bind event handlers during initialization:
// 1. Component initializes with state = { data: [...] }
// 2. Event handler is created and captures state
// 3. State updates to { data: [...new items...] }
// 4. Event handler STILL sees old state (stale closure)
// 5. Using ref solves this because ref.current is always the latest value
```

### `useCallback` - Memoized Callbacks

Use `useCallback` for event handlers passed to child components or third-party libraries:

```tsx
const handleViewChanged = useCallback((optionValue: string) => {
  setCurrentContext((prev) => ({ ...prev, currentView: selection }));
  getDataForView(selection);
}, []); // Dependencies array
```

**Note**: When combined with the ref pattern, dependencies should only include stable references:

```tsx
const onSelectedRowsChanged = useCallback(
  (_eventData: unknown, _args: OnSelectedRowsChangedEventArgs): void => {
    setCurrentContext((prev) => ({
      ...prev,
      dataSelection: {
        selectedDocumentIndexes: _args.rows,
        // Use ref for latest data, not the prop
        selectedDocumentObjectIds: _args.rows.map((row) => liveDataRef.current[row]?.['x-objectid'] ?? ''),
      },
    }));
  },
  [setCurrentContext], // Only setCurrentContext, NOT liveData
);
```

---

## Monaco Editor Integration

### Basic Monaco Editor Setup

The project wraps Monaco Editor in a custom component:

```tsx
import { MonacoEditor } from '../../MonacoEditor';

<MonacoEditor
  height={'100%'}
  width={'100%'}
  language="json"
  options={monacoOptions}
  value={editorContent}
  onMount={handleMonacoEditorMount}
  onChange={() => setIsDirty(true)}
/>;
```

### Monaco Options

```tsx
const monacoOptions = {
  minimap: { enabled: true },
  scrollBeyondLastLine: false,
  readOnly: false,
  automaticLayout: false, // Handle manually for performance
};
```

### Manual Layout Updates

Monaco needs manual layout updates when container size changes:

```tsx
const handleResize = () => {
  if (editorRef.current) {
    editorRef.current.layout();
  }
};

useEffect(() => {
  const debouncedResizeHandler = debounce(handleResize, 200);
  window.addEventListener('resize', debouncedResizeHandler);
  handleResize(); // Initial layout

  return () => {
    window.removeEventListener('resize', debouncedResizeHandler);
  };
}, []);
```

### Adaptive Height Monaco Editor

The `MonacoAdaptive` component extends Monaco with dynamic height based on content:

```tsx
<MonacoAdaptive
  height={'100%'}
  width={'100%'}
  language="json"
  adaptiveHeight={{
    enabled: true,
    maxLines: 10,
    minLines: 1,
    lineHeight: 19,
  }}
  onExecuteRequest={(query) => {
    /* Handle Ctrl+Enter */
  }}
  onMount={handleEditorDidMount}
/>
```

**Features:**

- Adjusts height based on line count (between minLines and maxLines)
- Registers Ctrl/Cmd+Enter shortcut
- Uses ref pattern to avoid stale closures

### JSON Schema Integration

Set JSON schema for autocompletion and validation:

```tsx
monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
  validate: true,
  schemas: [
    {
      uri: 'mongodb-filter-query-schema.json',
      fileMatch: ['*'],
      schema: basicFindQuerySchema,
    },
  ],
});
```

**⚠️ Known Issue**: Monaco's JSON worker may not be initialized immediately after mount. Use a delay:

```tsx
await new Promise((resolve) => setTimeout(resolve, 2000));
monaco.languages.json.jsonDefaults.setDiagnosticsOptions({...});
```

**🔴 TODO**: Implement proper worker initialization check instead of hardcoded delay.

---

## Third-Party Component Integration

### SlickGrid Integration

SlickGrid is used for table and tree views. It requires special handling due to stale closure issues.

#### Basic SlickGrid Setup

```tsx
import { SlickgridReact, type GridOption } from 'slickgrid-react';

<SlickgridReact
  gridId="myGrid"
  gridOptions={gridOptions}
  columnDefinitions={gridColumns}
  dataset={liveData}
  onReactGridCreated={() => console.log('Grid created')}
/>;
```

#### Grid Options Pattern

```tsx
const gridOptions: GridOption = {
  autoResize: {
    calculateAvailableSizeBy: 'container',
    container: '#resultsDisplayAreaId', // Parent container selector
    delay: 100,
    bottomPadding: 2,
  },
  enableAutoResize: true,
  enableCellNavigation: true,
  enableTextSelectionOnCells: true,
  enableRowSelection: true,
  multiSelect: true,
};
```

#### Event Handlers with Refs (Critical!)

```tsx
// Store latest data in refs
const liveDataRef = useRef<TableDataEntry[]>(liveData);
const gridColumnsRef = useRef<GridColumn[]>([]);

// Keep refs in sync
useEffect(() => {
  liveDataRef.current = liveData;
}, [liveData]);

useEffect(() => {
  gridColumnsRef.current = gridColumns;
}, [gridColumns]);

// Event handler using refs
const onCellDblClick = useCallback(
  (event: CustomEvent<{ args: OnDblClickEventArgs }>) => {
    // ✅ Use ref to get latest data
    const activeDocument = liveDataRef.current[event.detail.args.row];
    const activeColumn = gridColumnsRef.current[event.detail.args.cell].field;

    // Process event...
  },
  [handleStepIn],
); // Only stable dependencies
```

**Why this matters:**

- SlickGrid binds event handlers at initialization
- These handlers don't update when props/state change
- Without refs, handlers see stale/outdated data
- This caused multiple bugs that took hours to debug

### Custom Cell Formatters

```tsx
const cellFormatter: Formatter<object> = (_row: number, _cell: number, value: CellValue) => {
  if (value === undefined || value === null) {
    return {
      text: '',
      toolTip: l10n.t('This field is not set'),
    };
  }
  return {
    text: value.value,
    addClasses: `typedTableCell type-${value.type}`,
    toolTip: bsonStringToDisplayString(value.type),
  };
};
```

---

## Common Patterns

### Loading State Management

```tsx
const [isLoading, setIsLoading] = useState(false);

// Before async operation
setIsLoading(true);

try {
  await someAsyncOperation();
} finally {
  setIsLoading(false); // Always reset in finally
}

// In render
{
  isLoading && <ProgressBar thickness="large" shape="square" className="progressBar" />;
}
```

### Progress Bar Positioning

```tsx
// In component
{isLoading && <ProgressBar className="progressBar" />}

// In SCSS
.progressBar {
    position: absolute;
    left: 0px;
    top: 0px;
}
```

### Conditional Rendering Patterns

**Object-based switch statement:**

```tsx
{
    {
        'Table View': <DataViewPanelTableV2 {...props} />,
        'Tree View': <DataViewPanelTree {...props} />,
        'JSON View': <DataViewPanelJSON {...props} />,
        default: <div>error '{currentContext.currentView}'</div>,
    }[currentContext.currentView]
}
```

**Conditional component rendering:**

```tsx
{
  currentContext.currentView === Views.TABLE && (
    <div className="toolbarTableNavigation">
      <ToolbarTableNavigation />
    </div>
  );
}
```

### Debouncing

Use `es-toolkit` for debouncing:

```tsx
import { debounce } from 'es-toolkit';

const debouncedResizeHandler = debounce(handleResize, 200);
```

### Error Handling

```tsx
try {
  const result = await trpcClient.someOperation.query();
} catch (error) {
  void trpcClient.common.displayErrorMessage.mutate({
    message: l10n.t('Error message'),
    modal: false, // or true for important errors
    cause: error instanceof Error ? error.message : String(error),
  });
}
```

### Telemetry/Event Reporting

```tsx
trpcClient.common.reportEvent
  .mutate({
    eventName: 'executeQuery',
    properties: {
      ui: 'button',
    },
    measurements: {
      queryLength: q.length,
    },
  })
  .catch((error) => {
    console.debug('Failed to report an event:', error);
  });
```

---

## Known Issues & Anti-Patterns

### 🔴 Issues to Fix

1. **Inline Styles**: Some components use inline styles instead of SCSS

   ```tsx
   // ❌ Bad - should be in SCSS
   <TabList style={{ marginTop: '-10px' }}>
   ```

2. **Negative Margins**: Overused to fix spacing issues

   ```scss
   // ⚠️ Use sparingly, indicates potential layout issue
   margin-top: -10px;
   ```

3. **Monaco Worker Initialization**: Hardcoded 2-second delay

   ```tsx
   // 🔴 TODO: Replace with proper worker ready check
   await new Promise((resolve) => setTimeout(resolve, 2000));
   ```

4. **Mixed Architecture**: CollectionView has some inconsistencies in component structure
   - Some components are well-separated
   - Others have tight coupling
   - DocumentView is cleaner as a reference

### ⚠️ Common Pitfalls

1. **Forgetting to use refs with third-party components**

   ```tsx
   // ❌ Will capture stale state
   const onClick = () => {
     console.log(someState);
   };

   // ✅ Use ref pattern
   const stateRef = useRef(someState);
   useEffect(() => {
     stateRef.current = someState;
   }, [someState]);
   const onClick = () => {
     console.log(stateRef.current);
   };
   ```

2. **Not cleaning up event listeners**

   ```tsx
   // ✅ Always clean up
   useEffect(() => {
     window.addEventListener('resize', handler);
     return () => window.removeEventListener('resize', handler);
   }, []);
   ```

3. **Forgetting Monaco manual layout**

   ```tsx
   // ✅ Always call layout() after resize or mount
   editorRef.current?.layout();
   ```

4. **Using `any` in TypeScript**
   - Follow project guidelines: Never use `any`
   - Use proper types or `unknown` with type guards

5. **Not using localization**

   ```tsx
   // ❌ Bad
   <button>Save</button>

   // ✅ Good
   <button>{l10n.t('Save')}</button>
   ```

### 🟡 Design Decisions to Review

1. **Context Pattern**: CollectionView uses context extensively while DocumentView doesn't
   - **Consider**: Is context needed for CollectionView? Could it be simplified?
   - **Benefit**: Reduces prop drilling
   - **Drawback**: Makes data flow harder to trace

2. **Component Splitting**: Some components are very large (400+ lines)
   - **Consider**: Breaking down into smaller, focused components
   - **DocumentView**: Better example of cleaner structure

3. **State Duplication**: Some data is duplicated between context and local state
   ```tsx
   // From CollectionView.tsx:
   const [currentQueryResults, setCurrentQueryResults] = useState<QueryResults>();
   // TODO comment mentions this might belong in global context
   ```

---

## Summary of Best Practices

### ✅ Do's

- Use consistent 10px spacing units
- Use flexbox with `row-gap`/`column-gap` for spacing
- Store third-party component references in `useRef`
- Use ref pattern to solve stale closure issues
- Clean up event listeners and subscriptions
- Use functional state updates when depending on previous state
- Always localize user-facing strings with `l10n.t()`
- Define styles in SCSS files, not inline
- Use `es-toolkit` for utilities like `debounce`
- Handle errors gracefully with user-friendly messages
- Use Monaco's manual layout for performance

### ❌ Don'ts

- Don't use inline styles (move to SCSS)
- Don't overuse negative margins (fix layout instead)
- Don't forget to clean up in useEffect return
- Don't use `any` type (use proper types or `unknown`)
- Don't capture state in closures for third-party components (use refs)
- Don't hardcode delays (use proper initialization checks)
- Don't forget to call `editor.layout()` after resize
- Don't mix state management patterns inconsistently

---

## References

- TypeScript Guidelines: See `.github/copilot-instructions.md`
- VS Code Webview API: [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview)
- Monaco Editor API: [Monaco Editor API](https://microsoft.github.io/monaco-editor/api/index.html)
- SlickGrid React: [SlickGrid React Docs](https://ghiscoding.gitbook.io/slickgrid-react/)
- React Hooks: [React Hooks Reference](https://react.dev/reference/react)

---

_Document Version: 1.0_
_Last Updated: October 14, 2025_
_Based on: DocumentView and CollectionView analysis_
