/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { describe, expect, it } from 'vitest';
import { getAnalysisProfilePresentation } from '../../queryInsightsShared/analysisProfilePresentation';

describe('Query Insights result metric applicability', () => {
    it('keeps find labels and explanations unchanged', () => {
        expect(getAnalysisProfilePresentation('find')).toMatchObject({
            resultLabel: 'Documents Returned',
            resultTooltip: 'Number of documents returned by the query',
        });
        expect(getAnalysisProfilePresentation('find').resultSummary('12')).toBe('12 returned');
    });

    it('labels aggregate cursor throughput rather than claiming final pipeline output', () => {
        const presentation = getAnalysisProfilePresentation('aggregate');
        expect(presentation.resultLabel).toBe('Documents passed to pipeline');
        expect(presentation.resultTooltip).toContain('not the final pipeline output');
        expect(presentation.resultSummary('12')).toBe('12 passed to pipeline');
    });

    it('labels count results and makes the nCounted source explicit', () => {
        const presentation = getAnalysisProfilePresentation('count');
        expect(presentation.resultLabel).toBe('Documents counted');
        expect(presentation.resultTooltip).toContain('nCounted');
        expect(presentation.resultSummary('12')).toBe('12 counted');
        expect(presentation.resultSummary('N/A')).toBe('N/A counted');
    });
});
