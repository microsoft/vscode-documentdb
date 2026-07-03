/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState } from 'react';

declare global {
    interface Window {
        config?: {
            __initialData?: string;
            [key: string]: unknown; // Optional: Allows any other properties in config
        };
    }
}

/**
 * Use this hook to access the configuration object that was passed to the
 * webview at its creation.
 *
 * @returns The configuration object that was passed to the webview at its creation.
 */
export function useConfiguration<T>(): T {
    const [configuration] = useState<T>(() => {
        try {
            const configString = decodeURIComponent(window.config?.__initialData ?? '{}');
            return JSON.parse(configString) as T;
        } catch (error) {
            // A malformed or missing `__initialData` payload must not crash the
            // webview on first render (which would white-screen the view). Fall back
            // to an empty config and log so the problem is diagnosable in the webview
            // devtools console.
            console.error('[vscode-ext-webview] Failed to parse webview configuration; using empty config.', error);
            return {} as T;
        }
    });

    return configuration;
}
