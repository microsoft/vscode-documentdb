/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ParseMode, parse as parseShellBSON } from '@mongodb-js/shell-bson-parser';
import { EJSON } from 'bson';
import * as vscode from 'vscode';
import { z } from 'zod';
import { CommandType, type QueryObject } from '../../../commands/llmEnhancedCommands/indexAdvisorCommands';
import { type CollectionStats, type IndexStats } from '../../../documentdb/LlmEnhancedFeatureApis';
import { getInitialExplainPlan } from '../../../documentdb/queryInsights/analysisProfiles';
import { fixupDocumentDbExplain } from '../../../documentdb/utils/fixupDocumentDbExplain';
import { type ClusterMetadata } from '../../../documentdb/utils/getClusterMetadata';
import { toFilterQueryObj } from '../../../documentdb/utils/toFilterQuery';
import { type StandaloneInput } from './types';

export const queryInsightsPrefillSchema = z.object({
    explain: z.string().optional(),
    query: z.string().optional(),
    commandType: z.enum(['find', 'aggregate', 'count']).optional(),
    collectionStats: z.string().optional(),
    indexes: z.string().optional(),
    databaseName: z.string().optional(),
    collectionName: z.string().optional(),
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
        ? (value as Record<string, unknown>)
        : undefined;
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
    if (
        !explain ||
        (!object(explain.queryPlanner) && !object(explain.executionStats) && !Array.isArray(explain.stages))
    ) {
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
    const commandType = input.commandType === 'auto' ? detected : (input.commandType as CommandType);
    const inferredPipeline: Record<string, unknown>[] = Array.isArray(explain.stages)
        ? (explain.stages as unknown[]).slice(1).flatMap((stage) => {
              const operators = Object.fromEntries(
                  Object.entries(object(stage) ?? {}).filter(([key]) => key.startsWith('$')),
              );
              return Object.keys(operators).length ? [operators] : [];
          })
        : [];
    const initialFilter = object(planner.parsedQuery);
    if (initialFilter && Object.keys(initialFilter).length) inferredPipeline.unshift({ $match: initialFilter });
    const extracted =
        commandType === CommandType.Aggregate
            ? (command.pipeline ?? inferredPipeline)
            : (command.filter ?? command.query ?? planner.parsedQuery ?? {});
    const query = input.query.trim() || EJSON.stringify(extracted, { relaxed: true }, 2);
    const parsedQuery = parseInput(query);
    const queryRecord = object(parsedQuery);
    if (commandType === CommandType.Aggregate ? !Array.isArray(parsedQuery) : !queryRecord) {
        throw new Error(vscode.l10n.t('Use a JSON array for an aggregate pipeline, or a JSON object for find/count.'));
    }
    const isQueryObject =
        commandType === CommandType.Find &&
        queryRecord !== undefined &&
        ['filter', 'sort', 'projection', 'skip', 'limit'].some((key) => key in queryRecord);
    const queryObject =
        commandType === CommandType.Find
            ? isQueryObject
                ? (queryRecord as QueryObject)
                : {
                      filter: queryRecord,
                      sort: object(command.sort),
                      projection: object(command.projection),
                  }
            : undefined;
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
        explain,
        commandType,
        query,
        queryObject,
        clusterInfo,
        // These supplied objects are serialized into the prompt, never used for database actions.
        collectionStats: stats as unknown as CollectionStats | undefined,
        indexStats: indexes as IndexStats[] | undefined,
        totalDocs: typeof stats?.count === 'number' && stats.count >= 0 ? stats.count : undefined,
        filter,
    };
}

/** Where a supplied text failed to parse. Line and column are 1-based. */
export interface InputIssue {
    message: string;
    line?: number;
    column?: number;
}

export type ExplainInspection =
    | {
          ok: true;
          detectedCommandType: CommandType;
          databaseName?: string;
          collectionName?: string;
          /** Winning-plan stages in execution order (leaf first), then later pipeline stages. */
          planStages: string[];
      }
    | ({ ok: false } & InputIssue);

/** Non-throwing, per-field validation that the Configure step shows while the user types. */
export interface StandaloneInspection {
    explain?: ExplainInspection;
    commandType?: CommandType;
    /** The query that Analyze will send: the user's override, or the one extracted from the plan. */
    query?: string;
    queryIsExtracted?: boolean;
    queryIssue?: InputIssue;
    collectionStats?: { ok: true; documentCount?: number } | ({ ok: false } & InputIssue);
    indexes?: { ok: true; names: string[] } | ({ ok: false } & InputIssue);
    /** True when Analyze can run with these inputs. */
    ready: boolean;
}

function parseWithLocation(text: string): { value: unknown } | { issue: InputIssue } {
    try {
        return { value: EJSON.parse(text, { relaxed: true }) as unknown };
    } catch {
        try {
            const value = parseShellBSON(text, { mode: ParseMode.Loose }) as unknown;
            return { value: EJSON.parse(EJSON.stringify(value), { relaxed: true }) as unknown };
        } catch (cause) {
            const loc = (cause as { loc?: { line?: number; column?: number } }).loc;
            const raw = cause instanceof Error ? cause.message : String(cause);
            // The shell parser wraps the text in "(\n…\n)": its line is one too high and its column 0-based.
            const reason = raw.replace(/\s*\(\d+:\d+\)[\s\S]*$/, '').trim() || raw;
            return typeof loc?.line === 'number' && typeof loc.column === 'number'
                ? { issue: { message: reason, line: Math.max(1, loc.line - 1), column: loc.column + 1 } }
                : { issue: { message: reason } };
        }
    }
}

function planStageChain(plan: Record<string, unknown> | undefined): string[] {
    const chain: string[] = [];
    let node = plan;
    while (node && chain.length < 8) {
        if (typeof node.stage === 'string') chain.push(node.stage);
        node = object(node.inputStage) ?? object(Array.isArray(node.inputStages) ? node.inputStages[0] : undefined);
    }
    return chain.reverse();
}

function inspectExplain(explain: Record<string, unknown>): ExplainInspection {
    const command = object(explain.command) ?? {};
    const initial = getInitialExplainPlan(explain, 'aggregate');
    const planner = object(initial.queryPlanner) ?? object(explain.queryPlanner) ?? {};
    let detectedCommandType = CommandType.Find;
    if ('aggregate' in command || Array.isArray(explain.stages)) detectedCommandType = CommandType.Aggregate;
    else if ('count' in command) detectedCommandType = CommandType.Count;
    let databaseName: string | undefined;
    let collectionName: string | undefined;
    if (typeof planner.namespace === 'string' && planner.namespace.includes('.')) {
        const dot = planner.namespace.indexOf('.');
        databaseName = planner.namespace.slice(0, dot);
        collectionName = planner.namespace.slice(dot + 1);
    } else {
        const target = command.find ?? command.aggregate ?? command.count;
        collectionName = typeof target === 'string' ? target : undefined;
        databaseName = typeof command.$db === 'string' ? command.$db : undefined;
    }
    const laterStages = Array.isArray(explain.stages)
        ? (explain.stages as unknown[])
              .slice(1)
              .flatMap((stage) => Object.keys(object(stage) ?? {}).filter((key) => key.startsWith('$')))
        : [];
    return {
        ok: true,
        detectedCommandType,
        databaseName,
        collectionName,
        planStages: [
            ...planStageChain(object(planner.winningPlan) ?? object(object(initial.executionStats)?.executionStages)),
            ...laterStages,
        ],
    };
}

export function inspectStandaloneInput(input: StandaloneInput): StandaloneInspection {
    const result: StandaloneInspection = { ready: false };
    if (input.collectionStats.trim()) {
        const parsed = parseWithLocation(input.collectionStats);
        const stats = 'value' in parsed ? object(parsed.value) : undefined;
        result.collectionStats =
            'issue' in parsed
                ? { ok: false, ...parsed.issue }
                : stats
                  ? { ok: true, documentCount: typeof stats.count === 'number' ? stats.count : undefined }
                  : { ok: false, message: vscode.l10n.t('Collection statistics must be a JSON object.') };
    }
    if (input.indexes.trim()) {
        const parsed = parseWithLocation(input.indexes);
        const list =
            'value' in parsed && Array.isArray(parsed.value) && parsed.value.every((item: unknown) => object(item))
                ? (parsed.value as Record<string, unknown>[])
                : undefined;
        result.indexes =
            'issue' in parsed
                ? { ok: false, ...parsed.issue }
                : list
                  ? {
                        ok: true,
                        names: list.map((item) => (typeof item.name === 'string' ? item.name : '')).filter(Boolean),
                    }
                  : { ok: false, message: vscode.l10n.t('Indexes must be a JSON array of index objects.') };
    }
    if (!input.explain.trim()) return result;
    const parsedExplain = parseWithLocation(input.explain);
    if ('issue' in parsedExplain) {
        result.explain = { ok: false, ...parsedExplain.issue };
        return result;
    }
    const explain = object(parsedExplain.value);
    if (
        !explain ||
        (!object(explain.queryPlanner) && !object(explain.executionStats) && !Array.isArray(explain.stages))
    ) {
        result.explain = {
            ok: false,
            message: vscode.l10n.t('Paste an explain plan containing queryPlanner, executionStats, or stages.'),
        };
        return result;
    }
    result.explain = inspectExplain(explain);
    if (input.query.trim()) {
        const parsedQuery = parseWithLocation(input.query);
        if ('issue' in parsedQuery) {
            result.queryIssue = parsedQuery.issue;
            return result;
        }
    }
    try {
        // Optional inputs are validated above, so only explain/query problems can surface here.
        const parsed = parseStandaloneInput({ ...input, collectionStats: '', indexes: '' });
        result.commandType = parsed.commandType;
        result.query = parsed.query;
        result.queryIsExtracted = !input.query.trim();
    } catch (cause) {
        result.queryIssue = { message: cause instanceof Error ? cause.message : String(cause) };
        return result;
    }
    result.ready = result.collectionStats?.ok !== false && result.indexes?.ok !== false;
    return result;
}
