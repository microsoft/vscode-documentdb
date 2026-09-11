/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Structural mirror of `monaco.editor.BuiltinTheme`.
 *
 * Declared rather than imported: `monaco-editor` is a roughly 5 MB dependency, and nothing here
 * needs more than the shape. See decision 0032.
 */
export type VSCodeMonacoBaseTheme = 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';

/** Structural mirror of `monaco.editor.ITokenThemeRule`. */
export interface VSCodeMonacoTokenRule {
    token: string;
    foreground?: string;
    background?: string;
    fontStyle?: string;
}

/** Structurally assignable to `monaco.editor.IStandaloneThemeData`. */
export interface VSCodeMonacoThemeData {
    base: VSCodeMonacoBaseTheme;
    inherit: boolean;
    rules: VSCodeMonacoTokenRule[];
    colors: Record<string, string>;
}

/** A Monaco theme derived from the user's active VS Code theme, ready for `defineTheme`. */
export interface VSCodeMonacoTheme {
    /** Pass to `monaco.editor.defineTheme()`, then to `monaco.editor.setTheme()`. */
    readonly themeName: string;
    /** Pass as the second argument to `monaco.editor.defineTheme()`. */
    readonly data: VSCodeMonacoThemeData;
}
