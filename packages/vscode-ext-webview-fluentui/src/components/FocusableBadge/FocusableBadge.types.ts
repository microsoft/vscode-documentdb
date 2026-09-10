/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type BadgeProps } from '@fluentui/react-components';
import { type ReactNode } from 'react';

export interface FocusableBadgeProps extends Omit<BadgeProps, 'aria-label' | 'aria-labelledby' | 'role' | 'tabIndex'> {
    /**
     * Whether the badge participates in sequential keyboard navigation.
     *
     * Set this to `false` for a plain badge in a mixed list where only badges with supplementary
     * tooltip content should be reachable. It then emits the same DOM as a plain Fluent `Badge`.
     *
     * @default true
     */
    readonly focusable?: boolean;
    /** Visible content. When focusable, this content also names the badge. */
    readonly children: ReactNode;
}
