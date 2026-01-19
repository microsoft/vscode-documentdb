/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { useCallback, useRef, useState } from 'react';

/**
 * Options for the useAnnounce hook
 */
export interface UseAnnounceOptions {
    /**
     * The politeness level of the announcement.
     * - 'polite': Waits for the user to finish their current activity before announcing (default)
     * - 'assertive': Interrupts the user immediately (use sparingly)
     * @default 'polite'
     */
    politeness?: 'polite' | 'assertive';
}

/**
 * Return type for the useAnnounce hook
 */
export interface UseAnnounceReturn {
    /**
     * Function to trigger a screen reader announcement
     * @param message - The message to announce. Pass empty string to clear.
     */
    announce: (message: string) => void;

    /**
     * React element to render in your component tree.
     * This creates the ARIA live region that screen readers listen to.
     * Place this anywhere in your JSX - it's visually hidden but accessible.
     */
    AnnouncerElement: React.ReactElement;
}

/**
 * A React hook for making screen reader announcements using ARIA live regions.
 *
 * This hook provides a clean API for announcing dynamic content changes to screen readers,
 * following WCAG 4.1.3 (Status Messages) guidelines. It abstracts the implementation details
 * of ARIA live regions, making it easy to announce search results, loading states, errors, etc.
 *
 * @example
 * ```tsx
 * const { announce, AnnouncerElement } = useAnnounce();
 *
 * useEffect(() => {
 *     if (!isLoading && hasResults !== undefined) {
 *         announce(hasResults ? 'Results found' : 'No results found');
 *     }
 * }, [isLoading, hasResults, announce]);
 *
 * return (
 *     <div>
 *         {AnnouncerElement}
 *         {// ... rest of your UI}
 *     </div>
 * );
 * ```
 *
 * @param options - Configuration options for the announcer
 * @returns Object containing the announce function and AnnouncerElement to render
 *
 * @see https://www.w3.org/WAI/WCAG21/Understanding/status-messages.html
 */
export function useAnnounce(options: UseAnnounceOptions = {}): UseAnnounceReturn {
    const { politeness = 'polite' } = options;

    const [message, setMessage] = useState<string>('');
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const announce = useCallback((newMessage: string) => {
        // Clear any pending timeout
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        // Clear the message first to ensure re-announcement of identical messages
        setMessage('');

        // Set the new message after a brief delay to ensure the live region updates
        timeoutRef.current = setTimeout(() => {
            setMessage(newMessage);
        }, 100);
    }, []);

    // Styles that visually hide the element but keep it accessible to screen readers
    const srOnlyStyles: React.CSSProperties = {
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: 0,
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        borderWidth: 0,
    };

    const AnnouncerElement = (
        <div role="status" aria-live={politeness} aria-atomic="true" style={srOnlyStyles}>
            {message}
        </div>
    );

    return { announce, AnnouncerElement };
}
