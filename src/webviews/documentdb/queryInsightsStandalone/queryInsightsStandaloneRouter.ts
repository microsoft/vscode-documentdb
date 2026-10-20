/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { z } from 'zod';
import { analyzeExplainForStage2 } from '../../../documentdb/queryInsights/analyzeExplainForStage2';
import { ExplainPlanAnalyzer } from '../../../documentdb/queryInsights/ExplainPlanAnalyzer';
import { buildStaticAnalysisSummary } from '../../../documentdb/queryInsights/staticAnalysisSummary';
import { StreamingResponseParser } from '../../../documentdb/queryInsights/streamingResponseParser';
import { transformStage1Response } from '../../../documentdb/queryInsights/transformations';
import { QueryInsightsAIService } from '../../../services/ai/QueryInsightsAIService';
import type { BaseRouterContext } from '../../_integration/appRouter';
import { publicProcedureWithTelemetry, router } from '../../_integration/trpc';
import type { QueryInsightsStreamEvent } from '../collectionView/types/queryInsightsStream';
import { parseStandaloneInput, standaloneInputSchema } from './queryInsightsStandaloneInput';
import type { QueryInsightsPrefill } from './types';

export type StandaloneRouterContext = BaseRouterContext & { prefill: QueryInsightsPrefill };

export const queryInsightsStandaloneRouter = router({
    getPrefill: publicProcedureWithTelemetry.query(({ ctx }) => (ctx as StandaloneRouterContext).prefill),
    validateInput: publicProcedureWithTelemetry.input(standaloneInputSchema).query(({ input }) => {
        const parsed = parseStandaloneInput(input);
        return { commandType: parsed.commandType, query: parsed.query };
    }),
    getStage1: publicProcedureWithTelemetry.input(standaloneInputSchema).query(({ input }) => {
        const parsed = parseStandaloneInput(input);
        return transformStage1Response(ExplainPlanAnalyzer.analyzeQueryPlanner(parsed.explain), 0);
    }),
    getStage2: publicProcedureWithTelemetry.input(standaloneInputSchema).query(({ input }) => {
        const parsed = parseStandaloneInput(input);
        return analyzeExplainForStage2(parsed.explain, parsed.totalDocs, parsed.filter);
    }),
    streamStage3: publicProcedureWithTelemetry
        .input(standaloneInputSchema.extend({ requestKey: z.string() }))
        .subscription(async function* ({ ctx, input }): AsyncGenerator<QueryInsightsStreamEvent, void, void> {
            const controller = new AbortController();
            const signal = (ctx as StandaloneRouterContext).signal;
            const abort = (): void => controller.abort();
            if (signal?.aborted) controller.abort();
            else signal?.addEventListener('abort', abort);
            const start = Date.now();
            const elapsed = (): number => Date.now() - start;
            try {
                if (controller.signal.aborted) return;
                yield { type: 'status', phase: 'connecting', elapsedMs: elapsed(), charsReceived: 0 };
                const parsed = parseStandaloneInput(input);
                const stage2 = analyzeExplainForStage2(parsed.explain, parsed.totalDocs, parsed.filter);
                const handle = await new QueryInsightsAIService().getOptimizationRecommendationsStreaming(
                    '', parsed.queryObject ?? parsed.query, input.databaseName, input.collectionName,
                    parsed.explain, controller.signal, buildStaticAnalysisSummary(stage2, parsed.totalDocs), {
                        providedData: { clusterInfo: { platform: input.clusterType } },
                        modelId: input.modelId, commandType: parsed.commandType,
                        collectionStats: parsed.collectionStats, indexStats: parsed.indexStats,
                    },
                );
                if (controller.signal.aborted) return;
                yield { type: 'status', phase: 'submitted', elapsedMs: elapsed(), charsReceived: 0 };
                const parser = new StreamingResponseParser();
                let charsReceived = 0;
                let lastStatus = 0;
                for await (const fragment of handle.fragments) {
                    if (controller.signal.aborted) return;
                    charsReceived += fragment.length;
                    for (const event of parser.feed(fragment)) {
                        if (controller.signal.aborted) return;
                        yield event;
                    }
                    if (elapsed() - lastStatus >= 250) {
                        lastStatus = elapsed();
                        yield { type: 'status', phase: 'receiving', elapsedMs: elapsed(), charsReceived };
                    }
                }
                if (controller.signal.aborted) return;
                yield { type: 'status', phase: 'parsing', elapsedMs: elapsed(), charsReceived };
                const response = await handle.completion;
                if (controller.signal.aborted) return;
                for (const event of parser.finalize().events) {
                    if (controller.signal.aborted) return;
                    yield event;
                }
                yield {
                    type: 'complete', durationMs: elapsed(), modelId: response.modelId,
                    modelFamily: response.modelFamily, modelDisplayName: response.modelDisplayName, usage: response.usage,
                };
            } finally {
                signal?.removeEventListener('abort', abort);
                controller.abort();
            }
        }),
});
