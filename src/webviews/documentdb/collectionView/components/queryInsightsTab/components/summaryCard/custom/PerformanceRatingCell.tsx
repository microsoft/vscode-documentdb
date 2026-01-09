/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Text, tokens, Tooltip } from '@fluentui/react-components';
import { InfoRegular } from '@fluentui/react-icons';
import { CollapseRelaxed } from '@fluentui/react-motion-components-preview';
import * as l10n from '@vscode/l10n';
import * as React from 'react';
import { useState } from 'react';
import '../../../../../../../components/focusableBadge/focusableBadge.scss';
import { type PerformanceDiagnostic } from '../../../../../../../documentdb/collectionView/types/queryInsights';
import { CellBase } from '../CellBase';
import './PerformanceRatingCell.scss';

export type PerformanceRating = 'poor' | 'fair' | 'good' | 'excellent';

export interface PerformanceRatingCellProps {
    /** The label displayed at the top of the cell */
    label: string;

    /** The performance rating level
     * - undefined: Data is loading (shows skeleton)
     * - null: Data is unavailable (shows nullValuePlaceholder)
     * - PerformanceRating: Shows rating with color and diagnostics
     */
    rating: PerformanceRating | null | undefined;

    /** Array of diagnostic messages explaining the rating */
    diagnostics?: PerformanceDiagnostic[];

    /** Whether the rating content is visible (for animation) */
    visible?: boolean;

    /** What to display when rating is explicitly null (data unavailable) */
    nullValuePlaceholder?: string;
}

/**
 * Custom cell component for displaying performance ratings with colored indicators.
 * Spans the full width (2 columns) of the summary grid.
 *
 * Value handling:
 * - undefined: Shows loading skeleton (data is being fetched)
 * - null: Shows N/A or custom nullValuePlaceholder (data unavailable/error)
 * - PerformanceRating: Displays rating badge with diagnostics
 *
 * Diagnostic badges are keyboard accessible with focus indicators.
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
 *
 * // In error state
 * <PerformanceRatingCell
 *   label={l10n.t('Performance Rating')}
 *   rating={null}
 *   nullValuePlaceholder={l10n.t('Not available')}
 * />
 * ```
 */
export const PerformanceRatingCell: React.FC<PerformanceRatingCellProps> = ({
    label,
    rating,
    diagnostics,
    visible = true,
    nullValuePlaceholder = 'N/A',
}) => {
    const [openTooltips, setOpenTooltips] = useState<Record<number, boolean>>({});

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

    // Determine the content to display based on rating value
    let customContent: React.ReactNode;

    if (rating === null) {
        // Explicit null: data unavailable (will use CellBase's nullValuePlaceholder)
        customContent = null;
    } else if (rating === undefined) {
        // Undefined: data loading (will show skeleton)
        customContent = undefined;
    } else {
        // Has rating: display with animation
        customContent = (
            <CollapseRelaxed visible={visible}>
                <div
                    className="efficiencyIndicator"
                    style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: '8px', rowGap: '8px' }}
                >
                    {/* First row, first column: dot */}
                    <div
                        className="efficiencyDot"
                        style={{ backgroundColor: getRatingColor(rating), alignSelf: 'center' }}
                    />
                    {/* First row, second column: rating text */}
                    <Text weight="semibold" style={{ alignSelf: 'center' }}>
                        {getRatingText(rating)}
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
                                    visible={openTooltips[index] ?? false}
                                    onVisibleChange={(_e, data) => {
                                        setOpenTooltips((prev) => ({ ...prev, [index]: data.visible }));
                                    }}
                                >
                                    <Badge
                                        appearance="tint"
                                        color={diagnostic.type === 'positive' ? 'success' : 'informative'}
                                        size="small"
                                        shape="rounded"
                                        icon={<InfoRegular />}
                                        tabIndex={0}
                                        className="focusableBadge"
                                        role="button"
                                        aria-label={`${diagnostic.message}. Press Enter or Space for details.`}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                setOpenTooltips((prev) => ({ ...prev, [index]: !prev[index] }));
                                            }
                                        }}
                                    >
                                        {diagnostic.message}
                                    </Badge>
                                </Tooltip>
                            ))}
                        </div>
                    )}
                </div>
            </CollapseRelaxed>
        );
    }

    return <CellBase label={label} value={customContent} nullValuePlaceholder={nullValuePlaceholder} span="full" />;
};
