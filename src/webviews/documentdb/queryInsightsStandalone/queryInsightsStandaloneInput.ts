/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { EJSON } from 'bson';
import * as vscode from 'vscode';
import { z } from 'zod';
import { CommandType, type QueryObject } from '../../../commands/llmEnhancedCommands/indexAdvisorCommands';
import type { CollectionStats, IndexStats } from '../../../documentdb/LlmEnhancedFeatureApis';
import { toFilterQueryObj } from '../../../documentdb/utils/toFilterQuery';
import { fixupDocumentDbExplain } from '../../../documentdb/utils/fixupDocumentDbExplain';
import type { ClusterMetadata } from '../../../documentdb/utils/getClusterMetadata';
import { getInitialExplainPlan } from '../../../documentdb/queryInsights/analysisProfiles';
import type { StandaloneInput } from './types';

export const queryInsightsPrefillSchema = z.object({
    explain: z.string().optional(), query: z.string().optional(),
    commandType: z.enum(['find', 'aggregate', 'count']).optional(),
    collectionStats: z.string().optional(), indexes: z.string().optional(),
    databaseName: z.string().optional(), collectionName: z.string().optional(),
    clusterType: z.enum(['azure-documentdb', 'documentdb', 'other']).optional(),
});

export const standaloneInputSchema = z.object({
    explain: z.string().min(1),
    query: z.string(),
    commandType: z.enum(['auto', 'find', 'aggregate', 'count']),
    collectionStats: z.string(),
    indexes: z.string(),
    databaseName: z.string(),
    collectionName: z.string(),
    clusterType: z.enum(['azure-documentdb', 'documentdb', 'other']),
    modelId: z.string().optional(),
});

function parseInput(text: string): unknown {
    try {
        return EJSON.parse(text, { relaxed: true }) as unknown;
    } catch {
        return EJSON.parse(EJSON.stringify(toFilterQueryObj(text)), { relaxed: true }) as unknown;
    }
}

function object(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : undefined;
}

export function parseStandaloneInput(input: StandaloneInput): {
    explain: Record<string, unknown>;
    commandType: CommandType;
    query: string;
    queryObject?: QueryObject;
    collectionStats?: CollectionStats;
    indexStats?: IndexStats[];
    totalDocs?: number;
    filter?: Record<string, unknown>;
    clusterInfo: ClusterMetadata;
} {
    const explain = object(parseInput(input.explain));
    if (!explain || (!object(explain.queryPlanner) && !object(explain.executionStats) && !Array.isArray(explain.stages))) {
        throw new Error(vscode.l10n.t('Paste an explain plan containing queryPlanner, executionStats, or stages.'));
    }
    const clusterInfo: ClusterMetadata = { platform: input.clusterType };
    if (input.clusterType === 'azure-documentdb') {
        clusterInfo.domainInfo_isAzure = 'true';
        clusterInfo.domainInfo_api = 'vCore';
        fixupDocumentDbExplain(explain, clusterInfo);
        const cursor = getInitialExplainPlan(explain, 'aggregate');
        if (cursor !== explain) fixupDocumentDbExplain(cursor, clusterInfo);
    }
    const command = object(explain.command) ?? {};
    const planner = object(getInitialExplainPlan(explain, 'aggregate').queryPlanner) ?? {};
    let detected = CommandType.Find;
    if ('aggregate' in command || Array.isArray(explain.stages)) detected = CommandType.Aggregate;
    else if ('count' in command) detected = CommandType.Count;
    const commandType = input.commandType === 'auto' ? detected : input.commandType as CommandType;
    const inferredPipeline: Record<string, unknown>[] = Array.isArray(explain.stages)
        ? (explain.stages as unknown[]).slice(1).flatMap((stage) => {
            const operators = Object.fromEntries(Object.entries(object(stage) ?? {}).filter(([key]) => key.startsWith('$')));
            return Object.keys(operators).length ? [operators] : [];
        }) : [];
    const initialFilter = object(planner.parsedQuery);
    if (initialFilter && Object.keys(initialFilter).length) inferredPipeline.unshift({ $match: initialFilter });
    const extracted = commandType === CommandType.Aggregate
        ? command.pipeline ?? inferredPipeline : command.filter ?? command.query ?? planner.parsedQuery ?? {};
    const query = input.query.trim() || EJSON.stringify(extracted, { relaxed: true }, 2);
    const parsedQuery = parseInput(query);
    const queryRecord = object(parsedQuery);
    if (commandType === CommandType.Aggregate ? !Array.isArray(parsedQuery) : !queryRecord) {
        throw new Error(vscode.l10n.t('Use a JSON array for an aggregate pipeline, or a JSON object for find/count.'));
    }
    const isQueryObject = commandType === CommandType.Find && queryRecord !== undefined &&
        ['filter', 'sort', 'projection', 'skip', 'limit'].some((key) => key in queryRecord);
    const queryObject = commandType === CommandType.Find
        ? isQueryObject ? queryRecord as QueryObject : {
            filter: queryRecord,
            sort: object(command.sort),
            projection: object(command.projection),
        } : undefined;
    const stats = input.collectionStats.trim() ? object(parseInput(input.collectionStats)) : undefined;
    if (input.collectionStats.trim() && !stats) {
        throw new Error(vscode.l10n.t('Collection statistics must be a JSON object.'));
    }
    const indexes = input.indexes.trim() ? parseInput(input.indexes) : undefined;
    if (indexes !== undefined && (!Array.isArray(indexes) || indexes.some((item: unknown) => !object(item)))) {
        throw new Error(vscode.l10n.t('Indexes must be a JSON array of index objects.'));
    }
    let filter = queryObject?.filter;
    if (commandType === CommandType.Count) filter = queryRecord;
    else if (commandType === CommandType.Aggregate) {
        filter = object(object(Array.isArray(parsedQuery) ? parsedQuery[0] : undefined)?.$match) ?? initialFilter;
    }
    return {
        explain, commandType, query, queryObject, clusterInfo,
        // These supplied objects are serialized into the prompt, never used for database actions.
        collectionStats: stats as unknown as CollectionStats | undefined,
        indexStats: indexes as IndexStats[] | undefined,
        totalDocs: typeof stats?.count === 'number' && stats.count >= 0 ? stats.count : undefined,
        filter,
    };
}
