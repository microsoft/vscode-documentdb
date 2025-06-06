/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect } from 'react';

/**
 * Custom hook that selectively prevents context menus based on element selectors.
 * Currently allows context menus in Monaco editor elements while preventing them elsewhere.
 * This preserves editor functionality (copy/paste/formatting) while preventing unwanted
 * context menus in data tables and other UI elements.
 *
 * Additional editor selectors can be added to the allowlist as needed.
 */
/**
 * List of allowed selectors for context menus in the Monaco editor.
 * Update this list as needed to accommodate future editor changes.
 */
const ALLOWED_SELECTORS = [
    '.monaco-editor',
    '.monaco-editor-background',
    '.view-lines',
    '.monaco-scrollable-element',
    '.monaco-mouse-cursor-text',
    // Add other editor selectors here as needed
];

export const useSelectiveContextMenuPrevention = (): void => {
    useEffect(() => {
        const allowedSelectors = ALLOWED_SELECTORS;

        const handleContextMenu = (e: MouseEvent): void => {
            const target = e.target as HTMLElement;

            // Check if target is within any allowed element
            const isInAllowedElement = allowedSelectors.some((selector) => target.closest(selector) !== null);

            if (!isInAllowedElement) {
                e.preventDefault();
            }
        };

        document.addEventListener('contextmenu', handleContextMenu);

        return () => {
            document.removeEventListener('contextmenu', handleContextMenu);
        };
    }, []);
};
