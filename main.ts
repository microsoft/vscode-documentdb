/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The extension entry point, bundled to `dist/main.mjs` (see vite.config.ext.mjs). It is a thin
// loader: the extension code is imported dynamically, so it lands in a separate chunk and
// `perfStats` measures how long that chunk takes to load (reported as `mainFileLoad` in the
// activation telemetry).

import { type apiUtils } from '@microsoft/vscode-azext-utils';
import type * as vscode from 'vscode';
import { type DocumentDBExtensionApi } from './api/src';

const perfStats = {
    loadStartTime: Date.now(),
    loadEndTime: -1,
};

// Top-level await: VS Code calls `activate` only after this module, and so the extension chunk,
// has finished evaluating.
const extension = await import('./src/extension');

perfStats.loadEndTime = Date.now();

export async function activate(
    ctx: vscode.ExtensionContext,
): Promise<apiUtils.AzureExtensionApiProvider | DocumentDBExtensionApi> {
    if (process.env['STOP_ON_ENTRY'] === 'true') {
        /**
         * It's useful to have a debugger statement here to stop the extension at the very beginning.
         * Otherwise, it's hard to attach the debugger to the extension host process before the extension starts.
         * In some environments (for example Windows+WSL), the extension host process starts quickly,
         * before the debugger can attach.
         */

        // eslint-disable-next-line no-debugger
        debugger;
    }

    return extension.activateInternal(ctx, perfStats);
}

export async function deactivate(ctx: vscode.ExtensionContext): Promise<void> {
    return extension.deactivateInternal(ctx);
}
