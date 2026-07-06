/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Webview-side per-recommendation UI transform.
 *
 * The Stage 3 streaming subscription emits raw {@link AIIndexRecommendation}
 * domain objects (one per `improvements[]` item in the canonical Stage 3
 * JSON schema / {@link AIOptimizationResponse}), and the webview owns
 * the construction of the {@link ImprovementCardConfig} that
 * {@link ImprovementCard} renders.
 *
 * Historical note (for future maintainers): this used to be the webview
 * twin of a server-side `createImprovementCard` inside
 * `src/documentdb/queryInsights/transformations.ts` (paired with the
 * buffered `getQueryInsightsStage3` procedure). When that buffered path
 * was removed, the server twin went with it — so this is now the SINGLE
 * source of truth for the AIIndexRecommendation → ImprovementCardConfig
 * shape. If you add a property here, no server-side counterpart needs
 * the same edit. If you ever reintroduce a server-side renderer, port
 * this file rather than diverging from it.
 *
 * WI-9 of the Stage 3 progressive-streaming plan (D7: webview owns the
 * card-component choice; D11: the shell version uses the same icon as the
 * final card so the card's identity never changes when content arrives —
 * see {@link ImprovementCard} / `ImprovementCardShell`).
 */

import * as l10n from '@vscode/l10n';
import { type AIIndexRecommendation } from '../../../../services/ai/types';
import { type ImprovementCard as ImprovementCardConfig } from '../types/queryInsights';

/**
 * Context the webview already has access to (via `useConfiguration`), used
 * to populate the action-button payload that the cluster commands consume.
 */
export interface ImprovementCardContext {
    clusterId: string;
    databaseName: string;
    collectionName: string;
}

/**
 * Transform a single {@link AIIndexRecommendation} (as emitted by the
 * `recommendation` streaming event) into the {@link ImprovementCardConfig}
 * the {@link ImprovementCard} component renders. Pure and synchronous —
 * safe to call inside a setState reducer / per-event handler.
 */
export function createImprovementCardConfig(
    improvement: AIIndexRecommendation,
    index: number,
    context: ImprovementCardContext,
): ImprovementCardConfig {
    const cardTitle = getCardTitle(improvement.action);
    const indexSpecStr = JSON.stringify(improvement.indexSpec, null, 2);
    const indexOptionsStr =
        improvement.indexOptions && Object.keys(improvement.indexOptions).length > 0
            ? JSON.stringify(improvement.indexOptions, null, 2)
            : undefined;
    const primaryButtonLabel = getPrimaryButtonLabel(improvement.action, improvement.shellCommand);

    return {
        type: 'improvement',
        cardId: `improvement-${index}`,
        title: cardTitle,
        priority: improvement.priority,
        description: improvement.justification,
        recommendedIndex: indexSpecStr,
        indexName: improvement.indexName,
        recommendedIndexDetails: generateIndexExplanation(improvement),
        indexOptions: indexOptionsStr,
        details: improvement.risks || l10n.t('Additional write and storage overhead for maintaining a new index.'),
        shellCommand: improvement.shellCommand,
        primaryButton: {
            label: primaryButtonLabel,
            actionId: getPrimaryActionId(improvement.action),
            payload: {
                clusterId: context.clusterId,
                databaseName: context.databaseName,
                collectionName: context.collectionName,
                action: improvement.action,
                indexSpec: improvement.indexSpec,
                indexOptions: improvement.indexOptions,
                shellCommand: improvement.shellCommand,
            },
        },
    };
}

function getPrimaryButtonLabel(action: string, shellCommand: string): string {
    switch (action) {
        case 'create':
            return l10n.t('Create Index…');
        case 'drop':
            return l10n.t('Drop Index…');
        case 'modify':
            if (shellCommand.includes('.hideIndex(')) {
                return l10n.t('Hide Index…');
            } else if (shellCommand.includes('.unhideIndex(')) {
                return l10n.t('Unhide Index…');
            }
            return l10n.t('Modify Index…');
        default:
            return l10n.t('No Action');
    }
}

function getCardTitle(action: string): string {
    switch (action) {
        case 'create':
            return l10n.t('Recommendation: Create Index');
        case 'drop':
            return l10n.t('Recommendation: Drop Index');
        case 'modify':
            return l10n.t('Recommendation: Modify Index');
        default:
            return l10n.t('Query Performance Insight');
    }
}

function getPrimaryActionId(action: string): string {
    switch (action) {
        case 'create':
            return 'createIndex';
        case 'drop':
            return 'dropIndex';
        case 'modify':
            return 'modifyIndex';
        default:
            return 'noAction';
    }
}

function generateIndexExplanation(improvement: AIIndexRecommendation): string {
    const fields = Object.keys(improvement.indexSpec).join(', ');

    switch (improvement.action) {
        case 'create':
            return l10n.t(
                'An index on {0} would allow direct lookup of matching documents and eliminate full collection scans.',
                fields,
            );
        case 'drop':
            return l10n.t(
                'This index on {0} is not being used and adds unnecessary overhead to write operations.',
                fields,
            );
        case 'modify':
            return l10n.t(
                'Optimizing the index on {0} can improve query performance by better matching the query pattern.',
                fields,
            );
        default:
            return l10n.t('No index changes needed at this time.');
    }
}
