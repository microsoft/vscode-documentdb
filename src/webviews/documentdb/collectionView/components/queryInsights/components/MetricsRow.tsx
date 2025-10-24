/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Card, SkeletonItem, Tooltip } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import * as React from 'react';
import '../queryInsights.scss';
import './MetricsRow.scss';

interface MetricsRowProps {
    stageState: 1 | 2 | 3;
    inPanel?: boolean;
}

export const MetricsRow: React.FC<MetricsRowProps> = ({ stageState, inPanel = false }) => {
    const containerClass = inPanel ? 'metricsRowInPanel' : 'metricsRow';

    return (
        <div className={containerClass}>
            <Tooltip content={l10n.t('WIP: Available at Stage 1')} relationship="label">
                <Card className="metricCard" appearance="filled">
                    <div className="dataHeader">{l10n.t('Execution Time')}</div>
                    <div className="dataValue">{stageState >= 2 ? '2.333 ms' : '2.35 ms'}</div>
                </Card>
            </Tooltip>
            <Tooltip content={l10n.t('WIP: Available at Stage 1')} relationship="label">
                <Card className="metricCard" appearance="filled">
                    <div className="dataHeader">{l10n.t('Documents Returned')}</div>
                    <div className="dataValue">2</div>
                </Card>
            </Tooltip>
            <Tooltip content={l10n.t('WIP: Available at Stage 2')} relationship="label">
                <Card className="metricCard" appearance="filled">
                    <div className="dataHeader">{l10n.t('Keys Examined')}</div>
                    <div className="dataValue">{stageState >= 2 ? '2' : <SkeletonItem size={28} />}</div>
                </Card>
            </Tooltip>
            <Tooltip content={l10n.t('WIP: Available at Stage 2')} relationship="label">
                <Card className="metricCard" appearance="filled">
                    <div className="dataHeader">{l10n.t('Docs Examined')}</div>
                    <div className="dataValue">{stageState >= 2 ? '10,000' : <SkeletonItem size={28} />}</div>
                </Card>
            </Tooltip>
        </div>
    );
};
