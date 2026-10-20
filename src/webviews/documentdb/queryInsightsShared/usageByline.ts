/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as l10n from '@vscode/l10n';
import type { QueryInsightsStreamUsage } from '../collectionView/types/queryInsightsStream';

export function usageByline(usage: QueryInsightsStreamUsage | undefined): string {
    const parts: string[] = [];
    if (usage?.credits !== undefined) {
        const credits = usage.credits > 0 && usage.credits < 0.01
            ? '< 0.01'
            : new Intl.NumberFormat(navigator.language, { maximumFractionDigits: 2 }).format(usage.credits);
        parts.push(l10n.t('{0} credits', credits));
    }
    if (usage?.promptTokens !== undefined && usage.responseTokens !== undefined) {
        const formatTokens = new Intl.NumberFormat(navigator.language);
        parts.push(
            l10n.t(
                '{0} in / {1} out tokens',
                formatTokens.format(usage.promptTokens),
                formatTokens.format(usage.responseTokens),
            ),
        );
    }
    return parts.length ? ` · ${parts.join(' · ')}` : '';
}
