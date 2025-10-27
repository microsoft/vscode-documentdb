/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Card, SkeletonItem, Text, tokens } from '@fluentui/react-components';
import { CollapseRelaxed } from '@fluentui/react-motion-components-preview';
import * as l10n from '@vscode/l10n';
import * as React from 'react';
import '../queryInsights.scss';
import './QueryEfficiencyAnalysis.scss';

interface QueryEfficiencyAnalysisProps {
    stageState: 1 | 2 | 3;
}

export const QueryEfficiencyAnalysis: React.FC<QueryEfficiencyAnalysisProps> = ({ stageState }) => {
    return (
        <Card className="executionSummary">
            <Text weight="semibold" size={400}>
                {l10n.t('Query Efficiency Analysis')}
            </Text>

            <div className="summaryGrid">
                <div className="summaryItem">
                    <div className="dataHeader">{l10n.t('Execution Strategy')}</div>
                    {stageState >= 2 ? <Text>COLLSCAN</Text> : <SkeletonItem size={16} />}
                </div>
                <div className="summaryItem">
                    <div className="dataHeader">{l10n.t('Index Used')}</div>
                    {stageState >= 2 ? <Text>{l10n.t('None')}</Text> : <SkeletonItem size={16} />}
                </div>
                <div className="summaryItem">
                    <div className="dataHeader">{l10n.t('Examined/Returned Ratio')}</div>
                    {stageState >= 2 ? <Text>5,000 : 1</Text> : <SkeletonItem size={16} />}
                </div>
                <div className="summaryItem">
                    <div className="dataHeader">{l10n.t('In-Memory Sort')}</div>
                    {stageState >= 2 ? <Text>{l10n.t('No')}</Text> : <SkeletonItem size={16} />}
                </div>
            </div>

            <div className="ratingSection">
                <div className="dataHeader ratingLabel">{l10n.t('Performance Rating')}</div>
                <CollapseRelaxed visible={stageState >= 2}>
                    <div className="efficiencyIndicator">
                        <div className="efficiencyDot" style={{ backgroundColor: tokens.colorPaletteRedBackground3 }} />
                        <div style={{ flex: 1 }}>
                            <Text weight="semibold">{l10n.t('Poor')}</Text>
                            <Text size={200} style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>
                                {l10n.t('Only 0.02% of examined documents were returned')}
                            </Text>
                        </div>
                    </div>
                </CollapseRelaxed>
                {stageState < 2 && <SkeletonItem size={16} />}
            </div>
        </Card>
    );
};
