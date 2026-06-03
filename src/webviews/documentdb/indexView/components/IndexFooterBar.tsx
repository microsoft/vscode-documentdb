/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
import { type IndexRow } from '../types';
import { formatBytes, formatOps } from '../utils/format';

export interface IndexFooterBarProps {
    indexes: ReadonlyArray<IndexRow>;
}

export const IndexFooterBar = ({ indexes }: IndexFooterBarProps): JSX.Element => {
    const totalMemory = indexes.reduce((sum, idx) => sum + (idx.sizeBytes ?? 0), 0);
    const totalUsage = indexes.reduce((sum, idx) => sum + (idx.usageOps ?? 0), 0);

    return (
        <div className="indexFooter" role="status" aria-live="polite">
            <div className="footerMetric">
                <span className="footerMetricLabel">{l10n.t('Total Indexes')}</span>
                <span className="footerMetricValue">{indexes.length}</span>
            </div>
            <div className="footerMetric">
                <span className="footerMetricLabel">{l10n.t('Total Memory')}</span>
                <span className="footerMetricValue">{formatBytes(totalMemory)}</span>
            </div>
            <div className="footerMetric">
                <span className="footerMetricLabel">{l10n.t('Total Usage')}</span>
                <span className="footerMetricValue">{formatOps(totalUsage)}</span>
            </div>
        </div>
    );
};
