/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef } from 'react';

/**
 * Custom hook to temporarily hide scrollbars during layout transitions.
 *
 * This hook provides a function that hides scrollbars on .resultsDisplayArea for 500ms
 * to improve UX during QueryEditor transitions (Collapse animations). While the window-level
 * scrollbar flickering is fixed by a media query on .collectionView, this logic remains
 * useful for speeding up scrollbar re-rendering in SlickGrid (Table/Tree views) during
 * the ~100ms debounce period before resize handlers complete.
 *
 * @returns A function that temporarily hides scrollbars for 500ms
 */
export const useHideScrollbarsDuringResize = (): (() => void) => {
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    const hideScrollbarsTemporarily = () => {
        const resultsArea = document.querySelector('.resultsDisplayArea');
        if (resultsArea) {
            resultsArea.classList.add('resizing');

            // Clear any existing timeout
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }

            // Show scrollbars after 500ms
            timeoutRef.current = setTimeout(() => {
                resultsArea.classList.remove('resizing');
                timeoutRef.current = null;
            }, 500);
        }
    };

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
        };
    }, []);

    return hideScrollbarsTemporarily;
};
