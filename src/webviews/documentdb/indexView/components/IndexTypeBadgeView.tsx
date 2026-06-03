/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, type BadgeProps } from '@fluentui/react-components';
import { type JSX } from 'react';
import { type IndexTypeBadge } from '../types';

/**
 * Maps each badge label to a Fluent UI Badge `color` token. We rely on the
 * design system's palette (rendered via `--colorPalette*` CSS variables) so
 * the badge tints adapt to the active VS Code theme without introducing any
 * hard-coded hex values.
 */
const BADGE_COLOR: Record<IndexTypeBadge, BadgeProps['color']> = {
    Default: 'informative',
    ObjectId: 'subtle',
    'Single Field': 'brand',
    Compound: 'important',
    Text: 'success',
    Geospatial: 'warning',
};

export interface IndexTypeBadgeViewProps {
    type: IndexTypeBadge;
}

export const IndexTypeBadgeView = ({ type }: IndexTypeBadgeViewProps): JSX.Element => {
    return (
        <Badge appearance="tint" color={BADGE_COLOR[type]} shape="rounded">
            {type}
        </Badge>
    );
};
