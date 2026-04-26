/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Document } from 'mongodb';
import { fixupDocumentDbExplain, isAzureDocumentDb } from './fixupDocumentDbExplain';
import { type ClusterMetadata } from './getClusterMetadata';

const azureDocumentDbMetadata: ClusterMetadata = {
    domainInfo_isAzure: 'true',
    domainInfo_api: 'vCore',
};

const nonAzureMetadata: ClusterMetadata = {
    domainInfo_isAzure: 'false',
};

function makeCollscanExplain(totalKeysExamined: number, totalDocsExamined: number): Document {
    return {
        queryPlanner: {
            winningPlan: {
                stage: 'COLLSCAN',
                filter: { status: { $eq: 'active' } },
                direction: 'forward',
            },
            rejectedPlans: [],
        },
        executionStats: {
            executionSuccess: true,
            nReturned: 10,
            totalKeysExamined,
            totalDocsExamined,
            executionStages: {
                stage: 'COLLSCAN',
                keysExamined: totalKeysExamined,
                docsExamined: totalDocsExamined,
            },
        },
    };
}

function makeIxscanExplain(totalKeysExamined: number, totalDocsExamined: number): Document {
    return {
        queryPlanner: {
            winningPlan: {
                stage: 'FETCH',
                inputStage: {
                    stage: 'IXSCAN',
                    keyPattern: { status: 1 },
                },
            },
            rejectedPlans: [],
        },
        executionStats: {
            executionSuccess: true,
            nReturned: 10,
            totalKeysExamined,
            totalDocsExamined,
            executionStages: {
                stage: 'FETCH',
                keysExamined: 0,
                docsExamined: totalDocsExamined,
                inputStage: {
                    stage: 'IXSCAN',
                    keysExamined: totalKeysExamined,
                    docsExamined: 0,
                },
            },
        },
    };
}

describe('isAzureDocumentDb', () => {
    it('returns true for Azure DocumentDB metadata', () => {
        expect(isAzureDocumentDb(azureDocumentDbMetadata)).toBe(true);
    });

    it('returns false for non-Azure metadata', () => {
        expect(isAzureDocumentDb(nonAzureMetadata)).toBe(false);
    });

    it('returns false for undefined metadata', () => {
        expect(isAzureDocumentDb(undefined)).toBe(false);
    });

    it('returns false for Azure RU metadata', () => {
        expect(isAzureDocumentDb({ domainInfo_isAzure: 'true', domainInfo_api: 'RU' })).toBe(false);
    });
});

describe('fixupDocumentDbExplain', () => {
    describe('when connected to Azure DocumentDB', () => {
        it('zeros out totalKeysExamined for COLLSCAN plans', () => {
            const explain = makeCollscanExplain(2400, 2400);
            const result = fixupDocumentDbExplain(explain, azureDocumentDbMetadata)!;

            expect(result.executionStats.totalKeysExamined).toBe(0);
            expect(result.executionStats.executionStages.keysExamined).toBe(0);
            // Does not touch docsExamined
            expect(result.executionStats.totalDocsExamined).toBe(2400);
            expect(result.executionStats.executionStages.docsExamined).toBe(2400);
        });

        it('does not modify IXSCAN plans', () => {
            const explain = makeIxscanExplain(50, 50);
            const result = fixupDocumentDbExplain(explain, azureDocumentDbMetadata)!;

            expect(result.executionStats.totalKeysExamined).toBe(50);
            expect(result.executionStats.executionStages.inputStage.keysExamined).toBe(50);
        });

        it('handles SORT with COLLSCAN inputStage', () => {
            const explain: Document = {
                queryPlanner: {
                    winningPlan: {
                        stage: 'SORT',
                        inputStage: {
                            stage: 'COLLSCAN',
                            direction: 'forward',
                        },
                    },
                },
                executionStats: {
                    totalKeysExamined: 1000,
                    totalDocsExamined: 1000,
                    executionStages: {
                        stage: 'SORT',
                        keysExamined: 0,
                        inputStage: {
                            stage: 'COLLSCAN',
                            keysExamined: 1000,
                            docsExamined: 1000,
                        },
                    },
                },
            };

            const result = fixupDocumentDbExplain(explain, azureDocumentDbMetadata)!;
            expect(result.executionStats.totalKeysExamined).toBe(0);
            expect(result.executionStats.executionStages.keysExamined).toBe(0);
            expect(result.executionStats.executionStages.inputStage.keysExamined).toBe(0);
        });

        it('handles sharded executionStats', () => {
            const explain: Document = {
                queryPlanner: {
                    winningPlan: {
                        stage: 'COLLSCAN',
                    },
                },
                executionStats: {
                    totalKeysExamined: 500,
                    totalDocsExamined: 500,
                    shards: [
                        {
                            totalKeysExamined: 250,
                            totalDocsExamined: 250,
                            executionStages: {
                                stage: 'COLLSCAN',
                                keysExamined: 250,
                            },
                        },
                        {
                            totalKeysExamined: 250,
                            totalDocsExamined: 250,
                            executionStages: {
                                stage: 'COLLSCAN',
                                keysExamined: 250,
                            },
                        },
                    ],
                },
            };

            const result = fixupDocumentDbExplain(explain, azureDocumentDbMetadata)!;
            expect(result.executionStats.totalKeysExamined).toBe(0);
            expect(result.executionStats.shards[0].totalKeysExamined).toBe(0);
            expect(result.executionStats.shards[0].executionStages.keysExamined).toBe(0);
            expect(result.executionStats.shards[1].totalKeysExamined).toBe(0);
            expect(result.executionStats.shards[1].executionStages.keysExamined).toBe(0);
        });
    });

    describe('when not connected to Azure DocumentDB', () => {
        it('returns the result unchanged for non-Azure clusters', () => {
            const explain = makeCollscanExplain(2400, 2400);
            const result = fixupDocumentDbExplain(explain, nonAzureMetadata)!;

            expect(result.executionStats.totalKeysExamined).toBe(2400);
        });

        it('returns the result unchanged when metadata is undefined', () => {
            const explain = makeCollscanExplain(2400, 2400);
            const result = fixupDocumentDbExplain(explain, undefined)!;

            expect(result.executionStats.totalKeysExamined).toBe(2400);
        });
    });

    describe('edge cases', () => {
        it('returns undefined for undefined explain result', () => {
            expect(fixupDocumentDbExplain(undefined, azureDocumentDbMetadata)).toBeUndefined();
        });

        it('returns the result when queryPlanner is missing', () => {
            const explain: Document = { executionStats: { totalKeysExamined: 100 } };
            const result = fixupDocumentDbExplain(explain, azureDocumentDbMetadata)!;
            expect(result.executionStats.totalKeysExamined).toBe(100);
        });

        it('returns the result when executionStats is missing (queryPlanner-only)', () => {
            const explain: Document = {
                queryPlanner: {
                    winningPlan: {
                        stage: 'COLLSCAN',
                    },
                },
            };
            const result = fixupDocumentDbExplain(explain, azureDocumentDbMetadata)!;
            expect(result).toBeDefined();
            expect(result.executionStats).toBeUndefined();
        });
    });
});
