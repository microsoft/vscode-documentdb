/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import {
    type CommandType,
    type OptimizationResult,
    type QueryOptimizationContext,
} from '../../../src/commands/llmEnhancedCommands/optimizeCommands';
import {
    type QueryGenerationContext,
    type QueryGenerationResult,
} from '../../../src/commands/llmEnhancedCommands/generateCommands';

/**
 * Test-only API for AI enhanced features
 * This API is only available when running in test mode
 */
export interface TestingApi {
    /**
     * Test method for optimizeQuery
     * @param context Action context for telemetry
     * @param queryContext Query optimization context
     * @returns Optimization result
     */
    optimizeQuery(context: IActionContext, queryContext: QueryOptimizationContext): Promise<OptimizationResult>;

    /**
     * Test method for generateQuery
     * @param context Action context for telemetry
     * @param queryContext Query generation context
     * @returns Generated query result
     */
    generateQuery(context: IActionContext, queryContext: QueryGenerationContext): Promise<QueryGenerationResult>;

    /**
     * Test method to detect command type from query string
     * @param command The MongoDB command string
     * @returns The detected command type
     */
    detectCommandType(command: string): CommandType;
}
