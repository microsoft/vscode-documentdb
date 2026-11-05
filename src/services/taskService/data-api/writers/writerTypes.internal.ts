/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Optimization mode configuration for dual-mode adaptive writer.
 */
export interface OptimizationModeConfig {
    mode: 'fast' | 'ru-limited';
    initialBatchSize: number;
    maxBatchSize: number;
    growthFactor: number;
}

/**
 * Fast mode: Optimized for unlimited-capacity environments.
 * - vCore clusters
 * - Local DocumentDB installations
 * - Self-hosted DocumentDB instances
 */
export const FAST_MODE: OptimizationModeConfig = {
    mode: 'fast',
    initialBatchSize: 500,
    maxBatchSize: 2000,
    growthFactor: 1.2, // 20% growth
};

/**
 * RU-limited mode: Optimized for rate-limited environments.
 * - Azure Cosmos DB for MongoDB RU-based (uses MongoDB API)
 * - Azure Cosmos DB for NoSQL (RU-based)
 */
export const RU_LIMITED_MODE: OptimizationModeConfig = {
    mode: 'ru-limited',
    initialBatchSize: 100,
    maxBatchSize: 1000,
    growthFactor: 1.1, // 10% growth
};
