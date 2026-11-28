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
├── viewNameController.ts  # Backend communication logic (WebviewController subclass)
├── viewNameRouter.ts      # tRPC router with server-side procedures
├── constants.ts           # View-specific constants
├── components/            # Sub-components
│   ├── Component.tsx
│   ├── component.scss     # Component-specific styles (if needed)
│   ├── toolbar/           # Toolbar components
│   └── queryEditor/       # Feature-specific component groups
├── hooks/                 # Custom React hooks
│   └── useCustomHook.ts
├── types/                 # TypeScript type definitions
│   └── featureTypes.ts
└── utils/                 # Utility functions
    └── helper.ts
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
├── ProgressBar (conditional: isLoading)
├── Announcer (accessibility: screen reader announcements)
├── ToolbarMainView
├── QueryEditor
│   └── MonacoAutoHeight (multiple: filter, project, sort)
├── TabList (Results | Query Insights [PREVIEW])
├── Results Tab:
│   ├── resultsActionBar
│   │   ├── ToolbarViewNavigation
│   │   ├── ToolbarDocumentManipulation
│   │   └── ViewSwitcher (Dropdown: Table/Tree/JSON)
│   ├── resultsDisplayArea (switched based on currentView)
│   │   ├── DataViewPanelTable
│   │   ├── DataViewPanelTree
│   │   └── DataViewPanelJSON
│   └── ToolbarTableNavigation (conditional: Table View only)
└── Query Insights Tab:
    └── QueryInsightsMain (3-stage progressive loading)
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
  isFirstTimeLoad: boolean;
  currentView: Views;
  currentViewState?: TableViewState;
  activeQuery: {
    queryText: string; // deprecated: use filter instead
    filter: string;
    project: string;
    sort: string;
    skip: number;
    limit: number;
    pageNumber: number;
    pageSize: number;
    executionIntent?: 'initial' | 'refresh' | 'pagination'; // Intent of the query execution
  };
  commands: {
    disableAddDocument: boolean;
    disableViewDocument: boolean;
    disableEditDocument: boolean;
    disableDeleteDocument: boolean;
  };
  dataSelection: {
    selectedDocumentObjectIds: string[];
    selectedDocumentIndexes: number[];
  };
  queryEditor?: {
    getCurrentQuery: () => {
      filter: string;
      project: string;
      sort: string;
      skip: number;
      limit: number;
    };
    setJsonSchema(schema: object): Promise<void>;
  };
  isAiRowVisible: boolean;
  queryInsights: QueryInsightsState; // 3-stage progressive loading state
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
  activeQuery: {
    ...prev.activeQuery,
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

.monacoAutoHeightContainer {
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
  if (configuration.mode !== 'add') {
    const documentId: string = configuration.documentId;

    setIsLoading(true);

    void trpcClient.mongoClusters.documentView.getDocumentById
      .query(documentId)
      .then((response) => {
        setContent(response);
      })
      .catch((error) => {
        void trpcClient.common.displayErrorMessage.mutate({
          message: l10n.t('Error while loading the document'),
          modal: false,
          cause: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        setIsLoading(false);
      });
  }
}, []); // Empty array = run once on mount
```

#### Run on Specific State Changes

```tsx
useEffect(() => {
  // Update query editor context whenever filter value changes
  setCurrentContext((prev) => ({
    ...prev,
    queryEditor: prev.queryEditor
      ? {
          ...prev.queryEditor,
          getCurrentQuery: () => ({
            filter: filterValue,
            project: projectValue,
            sort: sortValue,
            skip: skipValue,
            limit: limitValue,
          }),
        }
      : prev.queryEditor,
  }));
}, [filterValue, projectValue, sortValue, skipValue, limitValue, setCurrentContext]); // Re-run when these change
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

**Example from QueryEditor** - storing query state in context:

```tsx
const getCurrentQueryFunction = () => ({
  filter: filterValue,
  project: projectValue,
  sort: sortValue,
  skip: skipValue,
  limit: limitValue,
});

setCurrentContext((prev) => ({
  ...prev,
  queryEditor: {
    getCurrentQuery: getCurrentQueryFunction,
    setJsonSchema: async (schema) => {
      /* ... */
    },
  },
}));
```

#### Event Handler Freshness

React event handlers passed through component props are refreshed during rendering. Prefer normal
closures with correct dependencies; refs are not a general requirement for third-party components.
Use a ref when a long-lived subscription or imperative API requires a stable callback, and keep
the ref synchronized with current state. Clean up subscriptions when their source changes or the
component unmounts.

### `useCallback` - Memoized Callbacks

Use `useCallback` when stable callback identity is useful. Include every reactive value used by
the callback in its dependency list. A ref is appropriate only when the API requires callback
identity to remain stable:

```tsx
const handleViewChanged = useCallback(
  (selection: Views): void => {
    setCurrentContext((previous) => ({ ...previous, currentView: selection }));
    getDataForView(selection);
  },
  [getDataForView, setCurrentContext],
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

### Auto Height Monaco Editor

The `MonacoAutoHeight` component extends Monaco with dynamic height based on content:

```tsx
<MonacoAutoHeight
  height={'100%'}
  width={'100%'}
  language="json"
  adaptiveHeight={{
    enabled: true,
    maxLines: 10,
    minLines: 1,
    lineHeight: 19,
  }}
  onExecuteRequest={() => {
    onExecuteRequest();
  }}
  onMount={(editor, monaco) => {
    handleEditorDidMount(editor, monaco);
  }}
  options={monacoOptions}
/>
```

**Features:**

- Adjusts height based on line count (between minLines and maxLines)
- Registers Ctrl/Cmd+Enter shortcut via `onExecuteRequest`
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

### Collection View Result Grids

The Table and Tree use RDG's `DataGrid`; their input contracts remain in
`src/utils/documentGrid/types.ts`.

- Table columns render `TablePage` cells, retaining BSON display text and type metadata.
  `getRowKey` uses the row identity supplied by the neutral shaper.
- The application builds a flattened visible hierarchy for the Tree, with path-based `TreeNode`
  keys, `aria-level` and `aria-expanded`; RDG does not own document expansion state.
- Use `DataGridHandle.setActivePosition` only where focus must be synchronized after a custom
  interaction. Keep focus on the surviving Tree cell before collapsing a branch.
- Preserve the current Table selection gestures and safe-ID action guard. Do not infer action
  eligibility from a selected row or invent an unapproved keyboard binding.
- Avoid per-cell Tab stops. Native grid navigation, Escape to the view picker, and the Tree's Enter
  expansion behavior are part of the current interaction contract.

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
        'Table View': <DataViewPanelTable {...props} />,
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

## Rendering Architecture

### Entry Point

The webview rendering pipeline starts in `index.tsx`:

```tsx
import { VSCodeFluentProvider } from '@microsoft/vscode-ext-webview-fluentui';
import { WebviewRegistry } from './_integration/WebviewRegistry';
import { WithWebviewContext } from './WebviewContext';

export function render<V extends ViewKey>(key: V, vscodeApi: WebviewApi<WebviewState>, rootId = 'root'): void {
  l10n.config({ contents: (globalThis.l10n_bundle as l10nJsonFormat) ?? {} });
  const container = document.getElementById(rootId);
  const Component: React.ComponentType = WebviewRegistry[key];
  const root = createRoot(container);

  root.render(
    <VSCodeFluentProvider>
      <WithWebviewContext vscodeApi={vscodeApi}>
        <Component />
      </WithWebviewContext>
    </VSCodeFluentProvider>,
  );
}
```

**Key architecture layers:**

- **`VSCodeFluentProvider`**: Adapts Fluent UI theming to VS Code's current color theme. It comes from `@microsoft/vscode-ext-webview-fluentui` rather than from `src/`, and importing it also injects that package's document-global Fluent overrides. Use `useActiveVSCodeThemeKind()` from the same package when a component needs the raw theme kind (Monaco does).
- **`WithWebviewContext`**: Provides `vscodeApi` (for postMessage) via React Context
- **`WebviewRegistry`**: Maps webview names to React components
- **`l10n` config**: Loads localization bundle injected by the extension host

### Configuration Flow

1. Extension host creates `WebviewController` with a configuration object
2. Configuration is serialized as `encodeURIComponent(JSON.stringify(config))` in the HTML template
3. Webview reads it via `useConfiguration<T>()` hook:

```tsx
export function useConfiguration<T>(): T {
  const [configuration] = useState<T>(() => {
    const configString = decodeURIComponent(window.config?.__initialData ?? '{}');
    return JSON.parse(configString) as T;
  });
  return configuration;
}
```

---

## AbortController, tRPC, and Accessibility

These topics are covered by dedicated skills. See:

- **AbortSignal & tRPC messaging**: `.github/skills/webview-trpc-messaging/SKILL.md`
- **Accessibility / ARIA patterns**: `.github/skills/accessibility-aria-expert/SKILL.md`

---

## Fluent UI Integration

The webviews use `@fluentui/react-components` (Fluent UI v9) as the primary component library, themed to match VS Code via `VSCodeFluentProvider`.

### Common Components

| Component                      | Usage                                     |
| ------------------------------ | ----------------------------------------- |
| `ProgressBar`                  | Loading indicators                        |
| `Button`, `ToggleButton`       | Toolbar actions                           |
| `Tab`, `TabList`               | View switching (Results / Query Insights) |
| `Dropdown`, `Option`           | Selection controls (ViewSwitcher)         |
| `Badge`                        | Status/preview indicators                 |
| `Input`, `Label`               | Form fields                               |
| `Tooltip`                      | Hover help text                           |
| `MessageBar`, `MessageBarBody` | Info/warning messages                     |
| `Skeleton`, `SkeletonItem`     | Loading placeholders                      |
| `Text`                         | Typography                                |

### Animations

Use `@fluentui/react-motion-components-preview` for collapse/expand animations:

```tsx
import { Collapse } from '@fluentui/react-motion-components-preview';

<Collapse visible={isExpanded}>
  <div>{/* collapsible content */}</div>
</Collapse>;
```

---

## Custom Hooks

### `useConfiguration<T>`

Reads the initial configuration object passed to the webview at creation:

```tsx
const configuration = useConfiguration<CollectionViewWebviewConfigurationType>();
```

### `useSelectiveContextMenuPrevention`

Prevents browser context menus everywhere except Monaco editors. Call once in the top-level view component.

### `useHideScrollbarsDuringResize`

Temporarily hides scrollbars during layout transitions (e.g., QueryEditor collapse animations) to prevent flickering:

```tsx
const hideScrollbarsTemporarily = useHideScrollbarsDuringResize();
// Call before triggering a layout change
hideScrollbarsTemporarily();
```

For tRPC-related hooks (`useTrpcClient`) and patterns, see the **webview-trpc-messaging** skill.

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

1. **Using refs as a blanket fix for stale closures**

   Ordinary React handlers can use the current render's values. For a long-lived external
   subscription, include current values in the effect dependencies and clean it up; use a ref only
   when the API requires a stable callback.

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
- Store imperative component handles in `useRef` when needed
- Use refs for current state only when a long-lived API requires callback identity to stay stable
- Clean up event listeners, subscriptions, and AbortControllers
- Use functional state updates when depending on previous state
- Always localize user-facing strings with `l10n.t()`
- Define styles in SCSS files, not inline
- Use `es-toolkit` for utilities like `debounce`
- Handle errors gracefully with user-friendly messages
- Use Monaco's manual layout for performance
- Use Fluent UI components themed via `VSCodeFluentProvider`

### ❌ Don'ts

- Don't use inline styles (move to SCSS)
- Don't overuse negative margins (fix layout instead)
- Don't forget to clean up in useEffect return (listeners, AbortControllers)
- Don't use `any` type (use proper types or `unknown`)
- Don't add refs for callbacks without a long-lived-API requirement
- Don't hardcode delays (use proper initialization checks)
- Don't forget to call `editor.layout()` after resize
- Don't mix state management patterns inconsistently

---

## References

- TypeScript Guidelines: See `.github/copilot-instructions.md`
- tRPC Messaging: See `.github/skills/webview-trpc-messaging/SKILL.md`
- Accessibility: See `.github/skills/accessibility-aria-expert/SKILL.md`
- VS Code Webview API: [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview)
- Monaco Editor API: [Monaco Editor API](https://microsoft.github.io/monaco-editor/api/index.html)
- React Data Grid: consult the exact dependency pin in the root `package.json`; do not assume the latest API applies
- React Hooks: [React Hooks Reference](https://react.dev/reference/react)

---

_Document Version: 2.1_
_Last Updated: November 27, 2026_
_Based on: DocumentView, CollectionView, QueryEditor, QueryInsights analysis_
