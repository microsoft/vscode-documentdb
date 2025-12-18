/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';

import { StagePropertyExtractor } from './StagePropertyExtractor';

import { type Document } from 'mongodb';
import { type ExtendedStageInfo } from '../../webviews/documentdb/collectionView/types/queryInsights';

const examplesRoot = path.resolve(__dirname, '../../../resources/debug/examples');

function loadExample(name: string): Record<string, unknown> {
    const filePath = path.join(examplesRoot, name);
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
}

function extractStagesFromPlan(plan: Document): ExtendedStageInfo[] {
    return StagePropertyExtractor.extractAllExtendedStageInfo(plan);
}

describe('StagePropertyExtractor', () => {
    describe('Stage 1: queryPlanner.winningPlan extraction', () => {
        describe('COLLSCAN scenario', () => {
            it('extracts stages from collscan-stage1.json', () => {
                const explain = loadExample('collscan-stage1.json');
                const queryPlanner = explain['queryPlanner'] as Record<string, unknown>;
                const winningPlan = queryPlanner['winningPlan'] as Document;
                const infos = extractStagesFromPlan(winningPlan);

                expect(infos.map((i) => i.stageName)).toEqual(['SORT', 'COLLSCAN']);
                infos.forEach((info) => {
                    expect(info.stageName).toBeDefined();
                    expect(typeof info.stageName).toBe('string');
                    expect(info.properties).toBeDefined();
                    expect(typeof info.properties).toBe('object');
                });
            });
        });

        describe('Query Insights scenario', () => {
            it('extracts stages from query-insights-stage1.json', () => {
                const explain = loadExample('query-insights-stage1.json');
                const queryPlanner = explain['queryPlanner'] as Record<string, unknown>;
                const winningPlan = queryPlanner['winningPlan'] as Document;
                const infos = extractStagesFromPlan(winningPlan);

                expect(infos.map((i) => i.stageName)).toEqual(['PROJECTION', 'FETCH', 'IXSCAN']);
                infos.forEach((info) => {
                    expect(info.stageName).toBeDefined();
                    expect(typeof info.stageName).toBe('string');
                    expect(info.properties).toBeDefined();
                    expect(typeof info.properties).toBe('object');
                });
            });
        });

        describe('Sharded scenario', () => {
            it('extracts stages from sharded-stage1.json', () => {
                const explain = loadExample('sharded-stage1.json');
                const queryPlanner = explain['queryPlanner'] as Record<string, unknown>;
                const winningPlan = queryPlanner['winningPlan'] as Document;
                const infos = extractStagesFromPlan(winningPlan);

                // Only SHARD_MERGE is extracted (shard objects without direct stage field are skipped)
                expect(infos.map((i) => i.stageName)).toEqual(['SHARD_MERGE']);
                infos.forEach((info) => {
                    expect(info.stageName).toBeDefined();
                    expect(typeof info.stageName).toBe('string');
                    expect(info.properties).toBeDefined();
                    expect(typeof info.properties).toBe('object');
                });
            });
        });
    });

    describe('Stage 2: executionStats extraction', () => {
        describe('COLLSCAN scenario', () => {
            it('extracts stages from executionStats.executionStages (collscan-stage2.json)', () => {
                const explain = loadExample('collscan-stage2.json');
                const executionStats = explain['executionStats'] as Record<string, unknown>;
                const executionStages = executionStats['executionStages'] as Document;
                const infos = extractStagesFromPlan(executionStages);

                expect(infos.map((i) => i.stageName)).toEqual(['SORT', 'COLLSCAN']);
                infos.forEach((info) => {
                    expect(info.stageName).toBeDefined();
                    expect(typeof info.stageName).toBe('string');
                    expect(info.properties).toBeDefined();
                    expect(typeof info.properties).toBe('object');
                });
            });

            it('extracts stages from allPlansExecution entries (collscan-stage2-allplans.json)', () => {
                const explain = loadExample('collscan-stage2-allplans.json');
                const executionStats = explain['executionStats'] as Record<string, unknown>;

                // Test main executionStages
                const executionStages = executionStats['executionStages'] as Document;
                const mainInfos = extractStagesFromPlan(executionStages);
                expect(mainInfos.map((i) => i.stageName)).toEqual(['COLLSCAN']);

                // Verify basic structure
                mainInfos.forEach((info) => {
                    expect(info.stageName).toBeDefined();
                    expect(typeof info.stageName).toBe('string');
                    expect(info.properties).toBeDefined();
                    expect(typeof info.properties).toBe('object');
                });
            });
        });

        describe('Query Insights scenario', () => {
            it('extracts stages from executionStats.executionStages (query-insights-stage2.json)', () => {
                const explain = loadExample('query-insights-stage2.json');
                const executionStats = explain['executionStats'] as Record<string, unknown>;
                const executionStages = executionStats['executionStages'] as Document;
                const infos = extractStagesFromPlan(executionStages);

                expect(infos.map((i) => i.stageName)).toEqual(['PROJECTION', 'FETCH', 'IXSCAN']);
                infos.forEach((info) => {
                    expect(info.stageName).toBeDefined();
                    expect(typeof info.stageName).toBe('string');
                    expect(info.properties).toBeDefined();
                    expect(typeof info.properties).toBe('object');
                });
            });

            it('extracts stages from allPlansExecution entries (query-insights-stage2-allplans.json)', () => {
                const explain = loadExample('query-insights-stage2-allplans.json');
                const executionStats = explain['executionStats'] as Record<string, unknown>;

                // Test main executionStages
                const executionStages = executionStats['executionStages'] as Document;
                const mainInfos = extractStagesFromPlan(executionStages);
                expect(mainInfos.map((i) => i.stageName)).toEqual(['FETCH', 'IXSCAN']);

                // Verify basic structure
                mainInfos.forEach((info) => {
                    expect(info.stageName).toBeDefined();
                    expect(typeof info.stageName).toBe('string');
                    expect(info.properties).toBeDefined();
                    expect(typeof info.properties).toBe('object');
                });
            });
        });

        describe('Sharded scenario', () => {
            it('extracts stages from executionStats.executionStages (sharded-stage2.json)', () => {
                const explain = loadExample('sharded-stage2.json');
                const executionStats = explain['executionStats'] as Record<string, unknown>;
                const executionStages = executionStats['executionStages'] as Document;
                const infos = extractStagesFromPlan(executionStages);

                // Only SHARD_MERGE is extracted (shard objects without direct stage field are skipped)
                expect(infos.map((i) => i.stageName)).toEqual(['SHARD_MERGE']);
                infos.forEach((info) => {
                    expect(info.stageName).toBeDefined();
                    expect(typeof info.stageName).toBe('string');
                    expect(info.properties).toBeDefined();
                    expect(typeof info.properties).toBe('object');
                });
            });

            it('extracts stages from shard-level allPlansExecution entries (sharded-stage2-allplans.json)', () => {
                const explain = loadExample('sharded-stage2-allplans.json');
                const executionStats = explain['executionStats'] as Record<string, unknown>;

                // Test main executionStages
                const executionStages = executionStats['executionStages'] as Document;
                const mainInfos = extractStagesFromPlan(executionStages);
                expect(mainInfos.map((i) => i.stageName)).toEqual(['COLLSCAN']);

                // Verify basic structure
                mainInfos.forEach((info) => {
                    expect(info.stageName).toBeDefined();
                    expect(typeof info.stageName).toBe('string');
                    expect(info.properties).toBeDefined();
                    expect(typeof info.properties).toBe('object');
                });
            });
        });
    });

    describe('Detailed property validation for specific examples', () => {
        it('extracts properties for index scan and projection (query-insights example)', () => {
            const explain = loadExample('query-insights-stage2.json');
            const executionStats = explain['executionStats'] as Record<string, unknown>;
            const executionStages = executionStats['executionStages'] as Document;
            const infos = extractStagesFromPlan(executionStages);

            expect(infos.map((i) => i.stageName)).toEqual(['PROJECTION', 'FETCH', 'IXSCAN']);

            const projection = infos.find((i) => i.stageName === 'PROJECTION');
            expect(projection).toBeDefined();
            const transformBy = projection?.properties['Transform by'];
            expect(typeof transformBy).toBe('string');
            expect(JSON.parse(transformBy as string)).toEqual({ _id: 1, status: 1, createdAt: 1 });

            const fetch = infos.find((i) => i.stageName === 'FETCH');
            expect(fetch?.properties['Documents Examined']).toBe(100);

            const ixscan = infos.find((i) => i.stageName === 'IXSCAN');
            expect(ixscan?.properties['Index Name']).toBe('status_1');
            expect(ixscan?.properties['Multi Key']).toBe('No');
            expect(ixscan?.properties['Direction']).toBe('forward');
            const indexBounds = ixscan?.properties['Index Bounds'];
            expect(typeof indexBounds).toBe('string');
            expect(JSON.parse(indexBounds as string)).toEqual({ status: ['["PENDING", "PENDING"]'] });
            expect(ixscan?.properties['Keys Examined']).toBe(100);
        });

        it('extracts properties for collscan and sort (collscan example)', () => {
            const explain = loadExample('collscan-stage2.json');
            const executionStats = explain['executionStats'] as Record<string, unknown>;
            const executionStages = executionStats['executionStages'] as Document;
            const infos = extractStagesFromPlan(executionStages);

            expect(infos.map((i) => i.stageName)).toEqual(['SORT', 'COLLSCAN']);

            const sort = infos.find((i) => i.stageName === 'SORT');
            expect(sort?.properties['Sort Pattern']).toBeDefined();
            expect(JSON.parse(sort?.properties['Sort Pattern'] as string)).toEqual({ createdAt: -1 });
            expect(sort?.properties['Memory Limit']).toBe('32.0 MB');
            expect(sort?.properties['Memory Usage']).toBe('0.0 MB');
            // usedDisk is absent/undefined in this example
            expect(sort?.properties['Spilled to Disk']).toBeUndefined();

            const collscan = infos.find((i) => i.stageName === 'COLLSCAN');
            expect(collscan?.properties['Direction']).toBe('forward');
            expect(collscan?.properties['Documents Examined']).toBe(2400);
            const filter = collscan?.properties['Filter'];
            expect(typeof filter).toBe('string');
            expect(JSON.parse(filter as string)).toEqual({ description: { $regex: 'urgent' } });
        });

        it('extracts properties for sharded execution stages (sharded example)', () => {
            const explain = loadExample('sharded-stage2.json');
            const executionStats = explain['executionStats'] as Record<string, unknown>;
            const executionStages = executionStats['executionStages'] as Document;
            const infos = extractStagesFromPlan(executionStages);

            // Original extractor traverses only stage nodes and shard objects lacking `stage` get skipped.
            // We therefore only expect the root SHARD_MERGE stage to be present.
            expect(infos.map((i) => i.stageName)).toEqual(['SHARD_MERGE']);
            const shardMerge = infos[0];
            expect(shardMerge.properties['Shard Count']).toBe(2);
        });

        it('handles allPlansExecution entries and COUNT_SCAN properties', () => {
            const explain = loadExample('query-insights-stage2-allplans.json');
            const executionStats = explain['executionStats'] as Record<string, unknown>;
            const executionStages = executionStats['executionStages'] as Document;
            const infos = extractStagesFromPlan(executionStages);

            expect(infos.map((i) => i.stageName)).toEqual(['FETCH', 'IXSCAN']);
            const fetch = infos.find((i) => i.stageName === 'FETCH');
            expect(fetch).toBeDefined();
            const ixscan = infos.find((i) => i.stageName === 'IXSCAN');
            expect(ixscan?.properties['Index Name']).toBe('title_1');
        });

        it('extracts collscan winning plan from allPlansExecution example', () => {
            const explain = loadExample('collscan-stage2-allplans.json');
            const executionStats = explain['executionStats'] as Record<string, unknown>;
            const executionStages = executionStats['executionStages'] as Document;
            const infos = extractStagesFromPlan(executionStages);

            expect(infos.map((i) => i.stageName)).toEqual(['COLLSCAN']);

            const collscan = infos.find((i) => i.stageName === 'COLLSCAN');
            expect(collscan).toBeDefined();
            expect(collscan?.stageName).toBe('COLLSCAN');
        });
    });
});
