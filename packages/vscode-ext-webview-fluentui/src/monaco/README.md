# Monaco theme support

Entry point `./monaco`. The active VS Code theme, shaped for `monaco.editor.defineTheme()`.

## Before you start

Run the examples in the browser side of a VS Code webview, after its document exists, not in the
extension host or during server rendering. The theme is read from VS Code's `--vscode-*` CSS
properties and body attributes. No `VSCodeFluentProvider` is required, and importing `./monaco`
does not load Fluent UI or inject its stylesheet.

Your application owns its Monaco installation, loader, worker configuration, editor creation and
disposal. For the React example, install `monaco-editor` and `@monaco-editor/react` alongside your
React application and this package. Configure the loader to use your bundled Monaco instance and
configure its workers for your webview's bundler and content security policy before mounting.
This package does not configure workers or load Monaco from a CDN.

## React with `@monaco-editor/react`

The hook returns `{ themeName, data }`. Register the data with Monaco, apply the theme, and pass
the same name to `<Editor>` so its own theme prop does not select a different theme.

```tsx
import { useVSCodeMonacoTheme } from '@microsoft/vscode-ext-webview-fluentui/monaco';
import Editor, { useMonaco, type EditorProps } from '@monaco-editor/react';
import { useEffect, type JSX } from 'react';

export function ThemedEditor({ beforeMount, ...props }: EditorProps): JSX.Element {
	const monaco = useMonaco();
	const theme = useVSCodeMonacoTheme();

	useEffect(() => {
		if (!monaco) {
			return;
		}

		monaco.editor.defineTheme(theme.themeName, theme.data);
		monaco.editor.setTheme(theme.themeName);
	}, [monaco, theme]);

	return (
		<Editor
			{...props}
			theme={theme.themeName}
			beforeMount={(instance) => {
				beforeMount?.(instance);
				instance.editor.defineTheme(theme.themeName, theme.data);
			}}
		/>
	);
}
```

Use it like your existing editor, for example
`<ThemedEditor height="300px" defaultLanguage="json" defaultValue="{}" />`.
`beforeMount` registers the theme before the editor is created; the effect applies subsequent
changes. The React wrapper owns editor disposal, and the hook cleans up its theme subscription.

The hook follows light, dark, high-contrast dark and high-contrast light themes, including switches
between two themes of the same kind and edits to `workbench.colorCustomizations`. You do not need
an additional observer. Its snapshot is shared across editors and retains its identity when the
derived colors have not changed.

## Custom colors and syntax rules in React

The hook accepts only an optional `themeName`, defaulting to `vscode-adaptive`. Use the factory
inside an effect for overrides, with the hook providing the theme-change signal:

```tsx
import {
	createVSCodeMonacoTheme,
	useVSCodeMonacoTheme,
} from '@microsoft/vscode-ext-webview-fluentui/monaco';
import { useMonaco } from '@monaco-editor/react';
import { useEffect } from 'react';

export function useCustomEditorTheme(): string {
	const monaco = useMonaco();
	const activeTheme = useVSCodeMonacoTheme({ themeName: 'my-extension-editor' });

	useEffect(() => {
		if (!monaco) {
			return;
		}

		const theme = createVSCodeMonacoTheme({
			themeName: activeTheme.themeName,
			colors: { 'editor.lineHighlightBackground': '#00000000' },
			rules: [{ token: 'comment', fontStyle: 'italic' }],
		});

		monaco.editor.defineTheme(theme.themeName, theme.data);
		monaco.editor.setTheme(theme.themeName);
	}, [monaco, activeTheme]);

	return activeTheme.themeName;
}
```

Call this hook in place of the default theme effect and pass its returned name as the editor's
`theme` prop. Do not run both theme effects for the same editor. For registration before the
editor's first paint, also derive and define the customized theme in its `beforeMount` callback.

`colors` overrides the derived UI colors and takes Monaco-compatible hex strings, not CSS variable
expressions. `rules` supplies Monaco token rules. Fixed color overrides remain fixed across theme
changes, so check their contrast in every supported theme kind. Prefer inheriting VS Code colors
unless your application needs an override.

Monaco's active theme is global to a Monaco instance, not per editor. Different theme names do not
isolate editors: the last `setTheme()` call applies to all editors sharing that instance.

## Without React hooks

`createVSCodeMonacoTheme()` reads the current theme once. It does not subscribe to changes. Here is
an imperative integration with explicit observation and cleanup, using an already-configured
Monaco instance:

```typescript
import { createVSCodeMonacoTheme } from '@microsoft/vscode-ext-webview-fluentui/monaco';
import type * as Monaco from 'monaco-editor';

export function mountEditor(monaco: typeof Monaco, container: HTMLElement): () => void {
	const applyTheme = (): string => {
		const theme = createVSCodeMonacoTheme();
		monaco.editor.defineTheme(theme.themeName, theme.data);
		monaco.editor.setTheme(theme.themeName);
		return theme.themeName;
	};

	const observer = new MutationObserver(() => {
		applyTheme();
	});
	observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
	observer.observe(document.body, {
		attributes: true,
		attributeFilter: ['data-vscode-theme-kind', 'data-vscode-theme-id', 'data-vscode-theme-name', 'class'],
	});

	const editor = monaco.editor.create(container, {
		value: '{}',
		language: 'json',
		theme: applyTheme(),
		automaticLayout: true,
	});

	return () => {
		observer.disconnect();
		const model = editor.getModel();
		editor.dispose();
		model?.dispose();
	};
}
```

Give `container` a nonzero width and height. Call the returned cleanup function when removing it.
This example owns the model it creates; do not dispose models shared with other editors. For
multiple editors, register and observe the theme once at the owning view level. The example uses
no React hooks, but React remains a package peer dependency.

## API options

| API              | Option      | Default               | Purpose                                                            |
| ---------------- | ----------- | --------------------- | ------------------------------------------------------------------ |
| Hook and factory | `themeName` | `vscode-adaptive`     | Name passed to Monaco's theme APIs                                 |
| Factory          | `themeKind` | Active body attribute | Override the base theme kind, without changing the DOM colors read |
| Factory          | `colors`    | No overrides          | Merge UI colors over the derived values                            |
| Factory          | `rules`     | `[]`                  | Supply syntax token rules                                          |

Syntax token colors are not copied from VS Code's TextMate theme. By default, Monaco inherits
the built-in palette for the selected base theme. VS Code does not publish TextMate colors as
webview CSS variables.

## Implementation notes

No dependency on `monaco-editor`, not even a type import. `IStandaloneThemeData` is a plain
structural interface, so `core/types.ts` mirrors it and the result is assignable without a cast.
`type-tests/monacoContract.ts` proves that against the real Monaco types at build time, with
`monaco-editor` present only as a `devDependency`.

## The boundary

> The package owns **what VS Code's colours are**. The consumer owns **what Monaco does with them**.

So this folder produces data and stops. No loader configuration, no editor lifecycle, no React
wrapper around `<Editor>`, no accessibility work. Those belong to whoever mounts Monaco, and if they
ever want sharing it is a separate package (decisions 0002 and 0013).

## `core/`: no React

| File                         | What it is                                                        |
| ---------------------------- | ----------------------------------------------------------------- |
| `colorIds.ts`                | generated, committed: the 392 colour ids Monaco registers         |
| `fallbackChains.ts`          | where an unpublished id falls back to, and why that list is short |
| `createVSCodeMonacoTheme.ts` | the derivation                                                    |
| `types.ts`                   | the structural mirror of Monaco's theme types                     |

### Why 392 and not all 813

Monaco declares every colour it understands through `registerColor`. Measured against the installed
`monaco-editor`, that is 392 ids, and they are a **strict subset** of the workbench list the
extension used to supply. The other 421 - `activityBar.*`, `titleBar.*`, `welcomePage.*` - have no
reader inside Monaco, so supplying them costs a lookup and buys nothing.

That makes the curated list provably lossless rather than a judgement call. Regenerate it with
`npm run build:monaco-color-ids` after upgrading `monaco-editor`; `colorIds.test.ts` fails if the
committed list has drifted from the installed one.

### Why the fallback table is short

Unification is the point, but a chain is not automatically an improvement. For ids Monaco owns
outright - the cursor, the current-line highlight, bracket matching - Monaco's own default is the
right answer, and overriding it with some other VS Code colour would be worse than doing nothing.

So a chain exists only where the same visual concept is rendered twice, by two engines, resolving
it two different ways: a Fluent popover beside a Monaco hover widget, a Fluent menu beside Monaco's
context menu. Each chain mirrors one that already exists in `theme/core/themeGenerator.ts`.

## `react/`: React

`useVSCodeMonacoTheme` re-derives when the theme changes and holds its object identity when it has
not, so the consumer's `defineTheme` / `setTheme` effect - and Monaco's repaint - do not fire for
nothing.

"When the theme changes" means the `vscode/` change store, not `data-vscode-theme-kind`. Monaco
consumes a **snapshot** of the colours, and switching between two dark themes leaves the kind
unchanged while every colour moves. Keying on the kind is the bug this hook exists to not have.

## What it does not do

Syntax token colours. `rules` is empty, so Monaco colourizes from its built-in `vs`/`vs-dark`
palette: a string inside the editor is a different colour from the same string in the user's real
editor. VS Code publishes no TextMate colours as CSS variables, so closing that gap means
approximating from `--vscode-debugTokenExpression-*` and friends - a real improvement, but one with
its own taste debate. The `rules` option on `createVSCodeMonacoTheme` leaves the door open.
