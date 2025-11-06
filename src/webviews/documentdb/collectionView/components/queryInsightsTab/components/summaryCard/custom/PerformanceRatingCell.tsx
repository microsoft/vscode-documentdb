/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, SkeletonItem, Text, tokens, Tooltip } from '@fluentui/react-components';
import { InfoRegular } from '@fluentui/react-icons';
import { CollapseRelaxed } from '@fluentui/react-motion-components-preview';
import * as l10n from '@vscode/l10n';
import * as React from 'react';
import { type PerformanceDiagnostic } from '../../../../../../../documentdb/collectionView/types/queryInsights';
import { CellBase } from '../CellBase';
import './PerformanceRatingCell.scss';

export type PerformanceRating = 'poor' | 'fair' | 'good' | 'excellent';

export interface PerformanceRatingCellProps {
    /** The label displayed at the top of the cell */
    label: string;

    /** The performance rating level */
    rating: PerformanceRating | null | undefined;

    /** Array of diagnostic messages explaining the rating */
    diagnostics?: PerformanceDiagnostic[];

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
 *   diagnostics={[
 *     { type: 'negative', message: 'Collection scan detected' },
 *     { type: 'positive', message: 'Fast execution time' }
 *   ]}
 *   visible={stageState >= 2}
 * />
 * ```
 */
export const PerformanceRatingCell: React.FC<PerformanceRatingCellProps> = ({
    label,
    rating,
    diagnostics,
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

    const hasRating = rating !== null && rating !== undefined;

    const customContent = (
        <>
            {/* Always render CollapseRelaxed to enable animations when visible prop changes */}
            <CollapseRelaxed visible={hasRating && visible}>
                <div
                    className="efficiencyIndicator"
                    style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: '8px', rowGap: '8px' }}
                >
                    {/* First row, first column: dot */}
                    <div
                        className="efficiencyDot"
                        style={{ backgroundColor: getRatingColor(rating!), alignSelf: 'center' }}
                    />
                    {/* First row, second column: rating text */}
                    <Text weight="semibold" style={{ alignSelf: 'center' }}>
                        {getRatingText(rating!)}
                    </Text>
                    {/* Second row, first column: empty */}
                    {diagnostics && diagnostics.length > 0 && <div />}
                    {/* Second row, second column: diagnostic badges with tooltips */}
                    {diagnostics && diagnostics.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                            {diagnostics.map((diagnostic, index) => (
                                <Tooltip
                                    key={index}
                                    content={{
                                        children: (
                                            <div style={{ padding: '8px' }}>
                                                <div
                                                    style={{ fontWeight: 600, marginBottom: '12px', fontSize: '16px' }}
                                                >
                                                    {diagnostic.message}
                                                </div>
                                                <div style={{ whiteSpace: 'pre-line' }}>{diagnostic.details}</div>
                                            </div>
                                        ),
                                    }}
                                    positioning="above-start"
                                    relationship="description"
                                >
                                    <Badge
                                        appearance="tint"
                                        color={diagnostic.type === 'positive' ? 'success' : 'informative'}
                                        size="small"
                                        shape="rounded"
                                        icon={<InfoRegular />}
                                    >
                                        {diagnostic.message}
                                    </Badge>
                                </Tooltip>
                            ))}
                        </div>
                    )}
                </div>
            </CollapseRelaxed>
            {/* Show skeleton when rating is not available */}
            {!hasRating && <SkeletonItem size={16} />}
        </>
    );

    return <CellBase label={label} value={customContent} placeholder="empty" span="full" />;
};
