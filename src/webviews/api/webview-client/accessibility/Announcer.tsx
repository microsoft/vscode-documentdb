/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { useEffect, useRef, useState } from 'react';

export interface AnnouncerProps {
    /**
     * When true, the message will be announced to screen readers.
     * Announcement triggers on transition from false to true.
     */
    when: boolean;

    /**
     * The message to announce to screen readers.
     */
    message: string;

    /**
     * The politeness level of the announcement.
     * - 'polite': Waits for the user to finish their current activity before announcing (default)
     * - 'assertive': Interrupts the user immediately (use sparingly)
     * @default 'assertive'
     */
    politeness?: 'polite' | 'assertive';
}

/**
 * A declarative component for screen reader announcements.
 *
 * Announces the message when `when` transitions from false to true.
 * Uses ARIA live regions following WCAG 4.1.3 (Status Messages).
 *
 * @example
 * ```tsx
 * <Announcer when={isLoading} message={l10n.t('AI is analyzing...')} />
 * ```
 */
export function Announcer({ when, message, politeness = 'assertive' }: AnnouncerProps): React.ReactElement {
    const [announcement, setAnnouncement] = useState('');
    const wasActiveRef = useRef(false);

    useEffect(() => {
        if (when && !wasActiveRef.current) {
            // Transition to active - announce with delay for NVDA compatibility
            setAnnouncement('');
            const timer = setTimeout(() => setAnnouncement(message), 100);
            wasActiveRef.current = true;
            return () => clearTimeout(timer);
        } else if (!when) {
            // Reset for next activation
            wasActiveRef.current = false;
            setAnnouncement('');
        }
        return undefined;
    }, [when, message]);

    // Visually hidden but accessible to screen readers
    return (
        <div
            role="status"
            aria-live={politeness}
            aria-atomic="true"
            style={{
                position: 'absolute',
                width: '1px',
                height: '1px',
                padding: 0,
                margin: '-1px',
                overflow: 'hidden',
                clip: 'rect(0, 0, 0, 0)',
                whiteSpace: 'nowrap',
                borderWidth: 0,
            }}
        >
            {announcement}
        </div>
    );
}
