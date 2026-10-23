/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type AIIndexRecommendation } from '../../../../services/ai/types';
import { type InsightCard, type InsightKind } from '../types/queryInsights';

/** Accepted spellings of each kind, in the `kind` field or as a `Kind:` prefix of the justification. */
const kindAliases: Record<Exclude<InsightKind, 'other'>, string[]> = {
    'query-change': ['query-change', 'query change', 'query'],
    verify: ['verify', 'verification'],
    maintenance: ['maintenance'],
    'data-model': ['data-model', 'data model'],
    support: ['support'],
};

function toKind(value: string | undefined): InsightKind | undefined {
    const normalized = value?.trim().toLowerCase().replace(/_/g, '-');
    if (!normalized) {
        return undefined;
    }
    for (const [kind, aliases] of Object.entries(kindAliases)) {
        if (aliases.includes(normalized)) {
            return kind as InsightKind;
        }
    }
    return undefined;
}

/**
 * Resolves the kind from `recommendation.kind`, else from a leading `Kind:` in the justification,
 * which is then removed from the description.
 */
function resolveKind(recommendation: AIIndexRecommendation): { kind: InsightKind; description: string } {
    const justification = recommendation.justification ?? '';
    const prefix = /^\s*([A-Za-z][A-Za-z -]{1,20}):\s*/.exec(justification);
    const prefixKind = prefix ? toKind(prefix[1]) : undefined;
    const description = prefixKind && prefix ? justification.slice(prefix[0].length) : justification;
    return { kind: toKind(recommendation.kind) ?? prefixKind ?? 'other', description };
}

function getTitle(kind: InsightKind): string {
    switch (kind) {
        case 'query-change':
            return l10n.t('Change the Query');
        case 'verify':
            return l10n.t('Verify First');
        case 'maintenance':
            return l10n.t('Maintenance');
        case 'data-model':
            return l10n.t('Data Model Change');
        case 'support':
            return l10n.t('Contact Support');
        default:
            return l10n.t('Query Performance Insight');
    }
}

/**
 * Builds the card for a non-index recommendation (`action: "none"`). Pure and synchronous.
 */
export function createInsightCardConfig(recommendation: AIIndexRecommendation, index: number): InsightCard {
    const { kind, description } = resolveKind(recommendation);
    const shellCommand = recommendation.shellCommand?.trim();
    const details = recommendation.risks?.trim();
    return {
        type: 'insight',
        cardId: `insight-${index}`,
        kind,
        title: getTitle(kind),
        priority: recommendation.priority,
        description,
        shellCommand: shellCommand ? shellCommand : undefined,
        details: details ? details : undefined,
    };
}
