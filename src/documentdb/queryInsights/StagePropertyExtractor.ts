/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Document } from 'mongodb';
import { type ExtendedStageInfo } from '../../webviews/documentdb/collectionView/types/queryInsights';

/**
 * Extracts stage-specific properties from execution plans for UI display
 * Provides detailed information for each stage type in the query execution tree
 */
export class StagePropertyExtractor {
    /**
     * Extracts extended properties for all stages in execution plan
     * Recursively traverses the stage tree and collects stage-specific properties
     *
     * @param executionStages - Root execution stage from explain output
     * @returns Array of extended stage information for UI display
     */
    public static extractAllExtendedStageInfo(executionStages: Document): ExtendedStageInfo[] {
        const stageInfoList: ExtendedStageInfo[] = [];

        this.traverseStages(executionStages, stageInfoList);

        return stageInfoList;
    }

    /**
     * Recursively traverses execution stages and extracts properties
     * Handles single inputStage, multiple inputStages, and sharded queries
     *
     * @param stage - Current stage to process
     * @param accumulator - Array to accumulate stage information
     */
    private static traverseStages(stage: Document, accumulator: ExtendedStageInfo[]): void {
        if (!stage || !stage.stage) {
            return;
        }

        const properties = this.extractStageProperties(stage);

        accumulator.push({
            stageName: stage.stage as string,
            properties,
        });

        // Recurse into child stages
        if (stage.inputStage) {
            this.traverseStages(stage.inputStage as Document, accumulator);
        }
        if (stage.inputStages) {
            (stage.inputStages as Document[]).forEach((childStage: Document) => {
                this.traverseStages(childStage, accumulator);
            });
        }
        if (stage.shards) {
            (stage.shards as Document[]).forEach((shard: Document) => {
                this.traverseStages(shard, accumulator);
            });
        }
    }

    /**
     * Extracts stage-specific properties based on stage type
     * Maps stage type to relevant properties for UI display
     *
     * Stage-specific properties:
     * - IXSCAN/EXPRESS_IXSCAN: Index name, multi-key indicator, bounds, keys examined
     * - PROJECTION: Transform specification
     * - COLLSCAN: Documents examined, scan direction
     * - FETCH: Documents examined
     * - SORT: Sort pattern, memory usage, disk spill indicator
     * - LIMIT/SKIP: Limit/skip amounts
     * - TEXT stages: Search string, parsed query
     * - GEO_NEAR: Key pattern, index info
     * - COUNT/DISTINCT: Index usage, keys examined
     * - IDHACK: Keys/docs examined
     * - SHARDING_FILTER: Chunks skipped
     * - SHARD_MERGE/SINGLE_SHARD: Shard count
     * - DELETE/UPDATE: Documents modified
     *
     * @param stage - Stage object from explain plan
     * @returns Record of properties for UI display
     */
    private static extractStageProperties(stage: Document): Record<string, string | number | boolean | undefined> {
        const stageName = stage.stage as string;
        const properties: Record<string, string | number | boolean | undefined> = {};

        switch (stageName) {
            case 'IXSCAN':
            case 'EXPRESS_IXSCAN':
                if (stage.keyPattern) {
                    properties['Key Pattern'] = JSON.stringify(stage.keyPattern);
                }
                if (stage.indexName) {
                    properties['Index Name'] = stage.indexName as string;
                }
                if (stage.isMultiKey !== undefined) {
                    properties['Multi Key'] = stage.isMultiKey ? 'Yes' : 'No';
                }
                if (stage.direction) {
                    properties['Direction'] = stage.direction as string;
                }
                if (stage.indexBounds) {
                    properties['Index Bounds'] = JSON.stringify(stage.indexBounds);
                }
                if (stage.keysExamined !== undefined) {
                    properties['Keys Examined'] = stage.keysExamined as number;
                }
                break;

            case 'PROJECTION':
            case 'PROJECTION_SIMPLE':
            case 'PROJECTION_DEFAULT':
            case 'PROJECTION_COVERED':
                if (stage.transformBy) {
                    properties['Transform by'] = JSON.stringify(stage.transformBy);
                }
                break;

            case 'COLLSCAN':
                if (stage.direction) {
                    properties['Direction'] = stage.direction as string;
                }
                if (stage.filter) {
                    properties['Filter'] = JSON.stringify(stage.filter);
                }
                if (stage.docsExamined !== undefined) {
                    properties['Documents Examined'] = stage.docsExamined as number;
                }
                break;

            case 'FETCH':
                if (stage.filter) {
                    properties['Filter'] = JSON.stringify(stage.filter);
                }
                if (stage.docsExamined !== undefined) {
                    properties['Documents Examined'] = stage.docsExamined as number;
                }
                break;

            case 'SORT':
            case 'SORT_KEY_GENERATOR':
                if (stage.sortPattern) {
                    properties['Sort Pattern'] = JSON.stringify(stage.sortPattern);
                }
                if (stage.memLimit !== undefined) {
                    properties['Memory Limit'] = `${stage.memLimit} bytes`;
                }
                if (stage.memUsage !== undefined) {
                    properties['Memory Usage'] = `${stage.memUsage} bytes`;
                }
                if (stage.usedDisk !== undefined) {
                    properties['Spilled to Disk'] = stage.usedDisk ? 'Yes' : 'No';
                }
                if (stage.type) {
                    properties['Type'] = stage.type as string;
                }
                break;

            case 'LIMIT':
                if (stage.limitAmount !== undefined) {
                    properties['Limit Amount'] = stage.limitAmount as number;
                }
                break;

            case 'SKIP':
                if (stage.skipAmount !== undefined) {
                    properties['Skip Amount'] = stage.skipAmount as number;
                }
                break;

            case 'TEXT':
            case 'TEXT_MATCH':
            case 'TEXT_OR':
                if (stage.searchString) {
                    properties['Search String'] = stage.searchString as string;
                }
                if (stage.parsedTextQuery) {
                    properties['Parsed Text Query'] = JSON.stringify(stage.parsedTextQuery);
                }
                break;

            case 'GEO_NEAR_2D':
            case 'GEO_NEAR_2DSPHERE':
                if (stage.keyPattern) {
                    properties['Key Pattern'] = JSON.stringify(stage.keyPattern);
                }
                if (stage.indexName) {
                    properties['Index Name'] = stage.indexName as string;
                }
                if (stage.indexVersion !== undefined) {
                    properties['Index Version'] = stage.indexVersion as number;
                }
                break;

            case 'COUNT':
            case 'COUNT_SCAN':
                if (stage.indexName) {
                    properties['Index Name'] = stage.indexName as string;
                }
                if (stage.keysExamined !== undefined) {
                    properties['Keys Examined'] = stage.keysExamined as number;
                }
                break;

            case 'DISTINCT_SCAN':
                if (stage.indexName) {
                    properties['Index Name'] = stage.indexName as string;
                }
                if (stage.indexBounds) {
                    properties['Index Bounds'] = JSON.stringify(stage.indexBounds);
                }
                if (stage.keysExamined !== undefined) {
                    properties['Keys Examined'] = stage.keysExamined as number;
                }
                break;

            case 'IDHACK':
                if (stage.keysExamined !== undefined) {
                    properties['Keys Examined'] = stage.keysExamined as number;
                }
                if (stage.docsExamined !== undefined) {
                    properties['Documents Examined'] = stage.docsExamined as number;
                }
                break;

            case 'SHARDING_FILTER':
                if (stage.chunkSkips !== undefined) {
                    properties['Chunks Skipped'] = stage.chunkSkips as number;
                }
                break;

            case 'CACHED_PLAN':
                properties['Cached'] = true;
                break;

            case 'SUBPLAN':
                if (stage.subplanType) {
                    properties['Subplan Type'] = stage.subplanType as string;
                }
                break;

            case 'SHARD_MERGE':
            case 'SINGLE_SHARD':
                if (stage.shards && Array.isArray(stage.shards)) {
                    properties['Shard Count'] = stage.shards.length;
                }
                break;

            case 'BATCHED_DELETE':
                if (stage.batchSize !== undefined) {
                    properties['Batch Size'] = stage.batchSize as number;
                }
                if (stage.nWouldDelete !== undefined) {
                    properties['Documents Deleted'] = stage.nWouldDelete as number;
                }
                break;

            case 'DELETE':
                if (stage.nWouldDelete !== undefined) {
                    properties['Documents Modified'] = stage.nWouldDelete as number;
                }
                break;

            case 'UPDATE':
                if (stage.nWouldModify !== undefined) {
                    properties['Documents Modified'] = stage.nWouldModify as number;
                }
                break;

            default:
                // Unknown stage type - return empty properties
                break;
        }

        return properties;
    }
}
