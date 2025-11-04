/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AIIndexRecommendation, type AIOptimizationResponse } from '../../services/ai/types';
import {
    type ImprovementCard,
    type QueryInsightsStage3Response,
} from '../../webviews/documentdb/collectionView/types/queryInsights';

/**
 * Context from the router containing connection and collection info
 */
interface TransformationContext {
    clusterId: string;
    databaseName: string;
    collectionName: string;
}

/**
 * Transforms AI optimization response to UI-friendly format
 * Adds action buttons with complete payloads for execution
 *
 * @param aiResponse - Raw AI service response
 * @param context - Router context with connection info
 * @returns Transformed response ready for UI consumption
 */
export function transformAIResponseForUI(
    aiResponse: AIOptimizationResponse,
    context: TransformationContext,
): QueryInsightsStage3Response {
    const analysisCard = {
        type: 'analysis' as const,
        content: aiResponse.analysis,
    };

    const improvementCards = aiResponse.improvements.map((improvement, index) => {
        return createImprovementCard(improvement, index, context);
    });

    // Join verification steps into a single string
    const verificationSteps = aiResponse.verification.join('\n');

    return {
        analysisCard,
        improvementCards,
        verificationSteps,
        educationalContent: aiResponse.educationalContent,
    };
}

/**
 * Creates an improvement card from an AI recommendation
 */
function createImprovementCard(
    improvement: AIIndexRecommendation,
    index: number,
    context: TransformationContext,
): ImprovementCard {
    const actionVerb = getActionVerb(improvement.action);
    const cardTitle = getCardTitle(improvement.action);
    const indexSpecStr = JSON.stringify(improvement.indexSpec, null, 2);

    return {
        type: 'improvement',
        cardId: `improvement-${index}`,
        title: cardTitle,
        priority: improvement.priority,
        description: improvement.justification,
        recommendedIndex: indexSpecStr,
        recommendedIndexDetails: generateIndexExplanation(improvement),
        details: improvement.risks || 'Additional write and storage overhead for maintaining a new index.',
        mongoShellCommand: improvement.mongoShell,
        primaryButton: {
            label: `${actionVerb} Index`,
            actionId: getPrimaryActionId(improvement.action),
            payload: {
                clusterId: context.clusterId,
                databaseName: context.databaseName,
                collectionName: context.collectionName,
                action: improvement.action,
                indexSpec: improvement.indexSpec,
                indexOptions: improvement.indexOptions,
                mongoShell: improvement.mongoShell,
            },
        },
        secondaryButton: {
            label: 'Learn More',
            actionId: 'learnMore',
            payload: {
                topic: 'index-optimization',
            },
        },
    };
}

/**
 * Gets the action verb for display
 */
function getActionVerb(action: string): string {
    switch (action) {
        case 'create':
            return 'Create';
        case 'drop':
            return 'Drop';
        case 'modify':
            return 'Modify';
        default:
            return 'No Action';
    }
}

/**
 * Gets the card title based on the action type
 */
function getCardTitle(action: string): string {
    switch (action) {
        case 'create':
            return 'Recommendation: Create Index';
        case 'drop':
            return 'Recommendation: Drop Index';
        case 'modify':
            return 'Recommendation: Modify Index';
        default:
            return 'Query Performance Insight';
    }
}

/**
 * Gets the primary action ID for the button
 */
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

/**
 * Generates a user-friendly explanation of what the index does
 */
function generateIndexExplanation(improvement: AIIndexRecommendation): string {
    const fields = Object.keys(improvement.indexSpec).join(', ');

    switch (improvement.action) {
        case 'create':
            return `An index on ${fields} would allow direct lookup of matching documents and eliminate full collection scans.`;
        case 'drop':
            return `This index on ${fields} is not being used and adds unnecessary overhead to write operations.`;
        case 'modify':
            return `Optimizing the index on ${fields} can improve query performance by better matching the query pattern.`;
        default:
            return 'No index changes needed at this time.';
    }
}
