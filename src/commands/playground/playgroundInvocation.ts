/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PLAYGROUND_LANGUAGE_ID } from '../../documentdb/playground/constants';

export type PlaygroundActivationSource =
    | 'playgroundCodeLens'
    | 'playgroundEditorMenu'
    | 'playgroundScreenReaderKeybinding'
    | 'playgroundOther';

export interface PlaygroundInvocation {
    readonly activationSource: PlaygroundActivationSource;
    readonly uri?: vscode.Uri;
    readonly range?: { readonly startLine: number; readonly endLine: number };
    readonly screenReaderMode: boolean;
}

function isUri(value: unknown): value is vscode.Uri {
    return (
        value instanceof vscode.Uri ||
        (value !== null &&
            typeof value === 'object' &&
            'scheme' in value &&
            typeof value.scheme === 'string' &&
            'path' in value &&
            typeof value.path === 'string' &&
            'toString' in value &&
            typeof value.toString === 'function')
    );
}

export function parsePlaygroundInvocation(args: readonly unknown[]): PlaygroundInvocation {
    if (args.length === 2 && typeof args[0] === 'number' && typeof args[1] === 'number') {
        return {
            activationSource: 'playgroundCodeLens',
            range: { startLine: args[0], endLine: args[1] },
            screenReaderMode: false,
        };
    }

    if (
        args.length === 3 &&
        isUri(args[0]) &&
        typeof args[1] === 'number' &&
        typeof args[2] === 'number'
    ) {
        return {
            activationSource: 'playgroundCodeLens',
            uri: args[0],
            range: { startLine: args[1], endLine: args[2] },
            screenReaderMode: false,
        };
    }

    if (isUri(args[0])) {
        return {
            activationSource: 'playgroundEditorMenu',
            uri: args[0],
            screenReaderMode: false,
        };
    }

    const first = args[0];
    if (args.length === 1 && first && typeof first === 'object') {
        if ('screenReaderMode' in first && first.screenReaderMode === true) {
            return {
                activationSource: 'playgroundScreenReaderKeybinding',
                screenReaderMode: true,
            };
        }
        if (
            Object.keys(first).length === 1 &&
            'activationSource' in first &&
            first.activationSource === 'playgroundCodeLens'
        ) {
            return {
                activationSource: 'playgroundCodeLens',
                screenReaderMode: false,
            };
        }
    }

    return {
        activationSource: 'playgroundOther',
        screenReaderMode: false,
    };
}

export function resolvePlaygroundEditor(uri: vscode.Uri | undefined): vscode.TextEditor | undefined {
    const active = vscode.window.activeTextEditor;
    if (!uri) {
        return active?.document.languageId === PLAYGROUND_LANGUAGE_ID ? active : undefined;
    }

    if (
        active?.document.languageId === PLAYGROUND_LANGUAGE_ID &&
        active.document.uri.toString() === uri.toString()
    ) {
        return active;
    }

    return vscode.window.visibleTextEditors.find(
        (editor) =>
            editor.document.languageId === PLAYGROUND_LANGUAGE_ID &&
            editor.document.uri.toString() === uri.toString(),
    );
}
