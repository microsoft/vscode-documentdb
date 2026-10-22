/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { z } from 'zod';
import { getAvailableModels, setSavedModelId, type AvailableModelsResult } from '../../../services/ai/modelSelection';
import { publicProcedureWithTelemetry, router } from '../../_integration/trpc';

export const queryInsightsModelsRouter = router({
    getAvailableModels: publicProcedureWithTelemetry.query(async (): Promise<AvailableModelsResult> => {
        return getAvailableModels();
    }),
    setSelectedModel: publicProcedureWithTelemetry
        .input(z.object({ modelId: z.string().min(1).nullable() }))
        .mutation(async ({ input }): Promise<AvailableModelsResult> => {
            await setSavedModelId(input.modelId);
            return getAvailableModels();
        }),
});
