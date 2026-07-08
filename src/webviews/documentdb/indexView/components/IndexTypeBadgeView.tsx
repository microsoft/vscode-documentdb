/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, type BadgeProps } from '@fluentui/react-components';
import { type JSX } from 'react';
import { type IndexTypeBadge } from '../types';

/**
 * Colour token for the type badge.
 *
 * NOTE: index types are intentionally NOT colour-coded. Colour is a poor
 * (inaccessible) way to encode a category, and the previous per-type mapping
 * assigned alarming palette tokens with no real meaning — e.g. Wildcard →
 * `severe` (orange) and Hashed → `danger` (red) — which wrongly implied those
 * indexes were problematic. Every type now uses one neutral, legible tint; the
 * type is communicated by the badge's text label (and the card's icon).
 */
const BADGE_COLOR: BadgeProps['color'] = 'informative';

export interface IndexTypeBadgeViewProps {
    type: IndexTypeBadge;
    /** Badge size. Defaults to `medium` (table); cards pass `small` to match Query Insights. */
    size?: BadgeProps['size'];
}

export const IndexTypeBadgeView = ({ type, size = 'medium' }: IndexTypeBadgeViewProps): JSX.Element => {
    // Keep multi-word labels (e.g. "Single Field") on one line so the badge
    // doesn't wrap and blow up the row height — use a non-breaking space.
    return (
        <Badge appearance="tint" color={BADGE_COLOR} shape="rounded" size={size} aria-label={type}>
            {type.replace(/ /g, '\u00A0')}
        </Badge>
    );
};
