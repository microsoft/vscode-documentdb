/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Card, Text } from '@fluentui/react-components';
import * as React from 'react';
import './SummaryCard.scss';

/**
 * Container component for displaying a summary card with a title and cells.
 *
 * Example usage:
 * ```tsx
 * <SummaryCard title={l10n.t('Query Efficiency Analysis')}>
 *   <GenericCell label={l10n.t('Execution Strategy')} value="COLLSCAN" />
 *   <GenericCell label={l10n.t('Index Used')} value={l10n.t('None')} />
 *   <PerformanceRatingCell label={l10n.t('Rating')} rating="poor" />
 * </SummaryCard>
 * ```
 */

export interface SummaryCardProps {
    /** The title displayed at the top of the card */
    title: string;

    /** Cell components to display in the card */
    children: React.ReactNode;
}

export const SummaryCard: React.FC<SummaryCardProps> = ({ title, children }) => {
    return (
        <Card className="summaryCard">
            <Text weight="semibold" size={400} style={{ marginBottom: '8px', display: 'block' }}>
                {title}
            </Text>
            <div className="summaryGrid">{children}</div>
        </Card>
    );
};
