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
import type { StandaloneInput } from './types';

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
        return toFilterQueryObj(text) as unknown;
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
} {
    const explain = object(parseInput(input.explain));
    if (!explain || (!object(explain.queryPlanner) && !object(explain.executionStats) && !Array.isArray(explain.stages))) {
        throw new Error(vscode.l10n.t('Paste an explain plan containing queryPlanner, executionStats, or stages.'));
    }
    const command = object(explain.command) ?? {};
    const planner = object(explain.queryPlanner) ?? {};
    const detected = 'aggregate' in command ? CommandType.Aggregate : 'count' in command ? CommandType.Count : CommandType.Find;
    const commandType = input.commandType === 'auto' ? detected : input.commandType as CommandType;
    const extracted = commandType === CommandType.Aggregate
        ? command.pipeline ?? [] : command.filter ?? command.query ?? planner.parsedQuery ?? {};
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
    return {
        explain, commandType, query, queryObject,
        // These supplied objects are serialized into the prompt, never used for database actions.
        collectionStats: stats as unknown as CollectionStats | undefined,
        indexStats: indexes as IndexStats[] | undefined,
        totalDocs: typeof stats?.count === 'number' && stats.count >= 0 ? stats.count : undefined,
        filter: queryObject?.filter ?? (commandType === CommandType.Count ? queryRecord : undefined),
    };
}
