/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type QueryInsightsAnalysisProfile } from '../collectionView/types/queryInsights';

interface AnalysisProfilePresentation {
    resultLabel: string;
    resultTooltip: string;
    resultSummary: (value: string) => string;
}

export function getAnalysisProfilePresentation(profile: QueryInsightsAnalysisProfile): AnalysisProfilePresentation {
    if (profile === 'count') {
        return {
            resultLabel: l10n.t('Documents counted'),
            resultTooltip: l10n.t(
                'The count result from the execution stage nCounted field, not the number of documents returned by the count command.',
            ),
            resultSummary: (value) => l10n.t('{0} counted', value),
        };
    }
    if (profile === 'aggregate') {
        return {
            resultLabel: l10n.t('Documents passed to pipeline'),
            resultTooltip: l10n.t(
                'Documents produced by the initial cursor stage, not the final pipeline output. Selectivity and efficiency describe only this initial stage.',
            ),
            resultSummary: (value) => l10n.t('{0} passed to pipeline', value),
        };
    }
    return {
        resultLabel: l10n.t('Documents Returned'),
        resultTooltip: l10n.t('Number of documents returned by the query'),
        resultSummary: (value) => l10n.t('{0} returned', value),
    };
}
