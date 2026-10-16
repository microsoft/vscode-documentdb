/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ComponentPropsWithoutRef, type ReactNode } from 'react';

/**
 * A fixed vocabulary, deliberately. A custom icon slot would make the list mean whatever each
 * caller decided, which is the opposite of what a status list is for.
 */
export type StatusListItemStatus = 'pending' | 'active' | 'done' | 'error' | 'warning';

export interface StatusListProps extends ComponentPropsWithoutRef<'div'> {
    /** Accessible name of the list. */
    readonly ariaLabel: string;
    /**
     * The word appended to each row's label for assistive technology. Defaults to English; pass
     * localized words if the consumer ships translations.
     */
    readonly statusLabels?: Partial<Record<StatusListItemStatus, string>>;
    /** `StatusListItem` rows. */
    readonly children: ReactNode;
}

export interface StatusListItemProps extends ComponentPropsWithoutRef<'div'> {
    readonly label: ReactNode;
    readonly status: StatusListItemStatus;
    /**
     * One line under the label. Anything: text, a `Link`, a joined sentence. It is kept after the
     * row settles, so the list reads as a receipt rather than a transient log.
     */
    readonly detail?: ReactNode;
    /**
     * Hold the detail line's height before it has content, so the row does not grow, and shift
     * everything below it, when the detail arrives. Named after `TabList.reserveSelectedTabSpace`,
     * which solves the same problem in the same shape.
     */
    readonly reserveDetailSpace?: boolean;
}
