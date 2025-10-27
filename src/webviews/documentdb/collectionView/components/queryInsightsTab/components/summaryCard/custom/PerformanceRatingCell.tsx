/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Text, tokens } from '@fluentui/react-components';
import { CollapseRelaxed } from '@fluentui/react-motion-components-preview';
import * as l10n from '@vscode/l10n';
import * as React from 'react';
import { CellBase } from '../CellBase';
import './PerformanceRatingCell.scss';

export type PerformanceRating = 'poor' | 'fair' | 'good' | 'excellent';

export interface PerformanceRatingCellProps {
    /** The label displayed at the top of the cell */
    label: string;

    /** The performance rating level */
    rating: PerformanceRating | null | undefined;

    /** Optional description text shown below the rating */
    description?: string;

    /** Whether the rating content is visible (for animation) */
    visible?: boolean;
}

/**
 * Custom cell component for displaying performance ratings with colored indicators.
 * Spans the full width (2 columns) of the summary grid.
 *
 * Example usage:
 * ```tsx
 * <PerformanceRatingCell
 *   label={l10n.t('Performance Rating')}
 *   rating="poor"
 *   description={l10n.t('Only 0.02% of examined documents were returned')}
 *   visible={stageState >= 2}
 * />
 * ```
 */
export const PerformanceRatingCell: React.FC<PerformanceRatingCellProps> = ({
    label,
    rating,
    description,
    visible = true,
}) => {
    const getRatingColor = (rating: PerformanceRating): string => {
        switch (rating) {
            case 'poor':
                return tokens.colorPaletteRedBackground3;
            case 'fair':
                return tokens.colorPaletteYellowBackground3;
            case 'good':
                return tokens.colorPaletteGreenBackground3;
            case 'excellent':
                return tokens.colorPaletteLightGreenBackground3;
        }
    };

    const getRatingText = (rating: PerformanceRating): string => {
        switch (rating) {
            case 'poor':
                return l10n.t('Poor');
            case 'fair':
                return l10n.t('Fair');
            case 'good':
                return l10n.t('Good');
            case 'excellent':
                return l10n.t('Excellent');
        }
    };

    const customContent =
        rating !== null && rating !== undefined ? (
            <CollapseRelaxed visible={visible}>
                <div className="efficiencyIndicator">
                    <div className="efficiencyDot" style={{ backgroundColor: getRatingColor(rating) }} />
                    <div style={{ flex: 1 }}>
                        <Text weight="semibold">{getRatingText(rating)}</Text>
                        {description && (
                            <Text size={200} style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>
                                {description}
                            </Text>
                        )}
                    </div>
                </div>
            </CollapseRelaxed>
        ) : undefined;

    return <CellBase label={label} value={customContent} placeholder="skeleton" span="full" />;
};
