/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Testing interface for AI-enhanced features
 * This module exposes internal commands for testing purposes only
 * Available only when running in test environment
 */

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import {
    type QueryGenerationContext,
    type QueryGenerationResult,
    generateQuery,
} from '../commands/llmEnhancedCommands/generateCommands';
import {
    type OptimizationResult,
    type QueryOptimizationContext,
    optimizeQuery,
} from '../commands/llmEnhancedCommands/optimizeCommands';

/**
 * Check if running in test environment
 */
function isTestEnvironment(): boolean {
    return process.env.NODE_ENV === 'test' || process.env.VSCODE_TEST === 'true';
}

/**
 * Testing interface for query optimization
 * Only available in test environment
 */
export async function testOptimizeQuery(
    context: IActionContext,
    queryContext: QueryOptimizationContext,
): Promise<OptimizationResult> {
    if (!isTestEnvironment()) {
        throw new Error('testOptimizeQuery is only available in test environment');
    }
    return optimizeQuery(context, queryContext);
}

/**
 * Testing interface for query generation
 * Only available in test environment
 */
export async function testGenerateQuery(
    context: IActionContext,
    queryContext: QueryGenerationContext,
): Promise<QueryGenerationResult> {
    if (!isTestEnvironment()) {
        throw new Error('testGenerateQuery is only available in test environment');
    }
    return generateQuery(context, queryContext);
}

/**
 * Export types for test framework
 */
export type { OptimizationResult, QueryGenerationContext, QueryGenerationResult, QueryOptimizationContext };
