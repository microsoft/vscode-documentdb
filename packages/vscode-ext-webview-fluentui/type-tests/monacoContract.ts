/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Proves the claim the `./monaco` entry rests on: its theme data is assignable to Monaco's own
 * `IStandaloneThemeData`, so a consumer needs no cast and the package needs no `monaco-editor`
 * dependency.
 *
 * This lives outside `src/` on purpose. `monaco-editor` is a package `devDependency`; importing it
 * from `src/` would put it in the emitted `.d.ts` and make it a real dependency of every consumer,
 * which is the outcome decision 0013 deferred the work to avoid. Nothing here is emitted, and
 * `tsc -p type-tests` runs as the second half of `npm run build`.
 *
 * If Monaco adds a required field to `IStandaloneThemeData`, or narrows `BuiltinTheme`, this is
 * where it surfaces - in the package's own build, where the fix belongs.
 */

// eslint-disable-next-line import/no-internal-modules
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import type { VSCodeMonacoBaseTheme, VSCodeMonacoThemeData, VSCodeMonacoTokenRule } from '../src/monaco/core/types.js';
import { createVSCodeMonacoTheme } from '../src/monaco/index.js';

declare const themeData: VSCodeMonacoThemeData;
declare const defineTheme: typeof monaco.editor.defineTheme;

/** The contract: what the package produces is what `defineTheme` accepts. */
export function acceptedByDefineTheme(): void {
    defineTheme('vscode-adaptive', themeData);
}

/** And the derived theme reaches it without a cast, exactly as a consumer writes it. */
export function acceptedFromDerivation(): void {
    const theme = createVSCodeMonacoTheme();

    defineTheme(theme.themeName, theme.data);
}

/** Field-level equivalence, so a widening on either side is caught rather than absorbed. */
export declare const baseThemeIsMonacoBuiltin: (value: VSCodeMonacoBaseTheme) => monaco.editor.BuiltinTheme;
export declare const monacoBuiltinIsBaseTheme: (value: monaco.editor.BuiltinTheme) => VSCodeMonacoBaseTheme;
export declare const ruleIsMonacoRule: (value: VSCodeMonacoTokenRule) => monaco.editor.ITokenThemeRule;
export declare const colorsAreMonacoColors: (value: VSCodeMonacoThemeData['colors']) => monaco.editor.IColors;
