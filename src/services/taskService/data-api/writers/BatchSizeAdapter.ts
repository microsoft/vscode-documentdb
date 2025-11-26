/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n } from 'vscode';
import { ext } from '../../../../extensionVariables';
import { FAST_MODE, type OptimizationModeConfig, RU_LIMITED_MODE } from '../writerTypes.internal';

/**
 * Configuration for batch size adaptation behavior.
 */
export interface BatchSizeAdapterConfig {
    /** Buffer memory limit in MB (default: 24) */
    bufferMemoryLimitMB?: number;
    /** Minimum batch size (default: 1) */
    minBatchSize?: number;
}

const DEFAULT_CONFIG: Required<BatchSizeAdapterConfig> = {
    bufferMemoryLimitMB: 24,
    minBatchSize: 1,
};

/**
 * Adaptive batch size manager for dual-mode operation (fast vs. RU-limited).
 *
 * This class encapsulates the adaptive batching logic extracted from BaseDocumentWriter.
 * It handles:
 * - Dual-mode operation: Fast mode (vCore/local) vs RU-limited mode (Cosmos DB RU)
 * - Batch size growth after successful writes
 * - Batch size shrinking on throttle detection
 * - Mode switching from Fast to RU-limited on first throttle
 *
 * The adapter maintains internal state and should be created per-writer instance.
 *
 * @example
 * const adapter = new BatchSizeAdapter();
 *
 * // Get current batch size for buffer management
 * const batchSize = adapter.getCurrentBatchSize();
 *
 * // On successful write
 * adapter.grow();
 *
 * // On throttle with partial progress
 * adapter.handleThrottle(50); // 50 docs succeeded before throttle
 *
 * // Check buffer constraints
 * const constraints = adapter.getBufferConstraints();
 */
export class BatchSizeAdapter {
    private readonly config: Required<BatchSizeAdapterConfig>;

    /** Current optimization mode configuration */
    private currentMode: OptimizationModeConfig;

    /** Current batch size (adaptive, changes based on success/throttle) */
    private currentBatchSize: number;

    constructor(config?: BatchSizeAdapterConfig) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.currentMode = FAST_MODE;
        this.currentBatchSize = FAST_MODE.initialBatchSize;
    }

    /**
     * Gets the current batch size for buffer management.
     */
    getCurrentBatchSize(): number {
        return this.currentBatchSize;
    }

    /**
     * Gets the current optimization mode ('fast' or 'ru-limited').
     */
    getCurrentMode(): 'fast' | 'ru-limited' {
        return this.currentMode.mode;
    }

    /**
     * Gets buffer constraints for streaming document writers.
     *
     * @returns Optimal document count and memory limit
     */
    getBufferConstraints(): { optimalDocumentCount: number; maxMemoryMB: number } {
        return {
            optimalDocumentCount: this.currentBatchSize,
            maxMemoryMB: this.config.bufferMemoryLimitMB,
        };
    }

    /**
     * Grows the batch size after a successful write operation.
     *
     * Growth behavior depends on current optimization mode:
     * - Fast mode: 20% growth per success, max 2000 documents
     * - RU-limited mode: 10% growth per success, max 1000 documents
     */
    grow(): void {
        if (this.currentBatchSize >= this.currentMode.maxBatchSize) {
            return;
        }

        const previousBatchSize = this.currentBatchSize;
        const growthFactor = this.currentMode.growthFactor;
        const percentageIncrease = Math.floor(this.currentBatchSize * growthFactor);
        const minimalIncrease = this.currentBatchSize + 1;

        this.currentBatchSize = Math.min(this.currentMode.maxBatchSize, Math.max(percentageIncrease, minimalIncrease));

        ext.outputChannel.trace(
            l10n.t(
                '[BatchSizeAdapter] Success: Growing batch size {0} → {1} (mode: {2}, growth: {3}%)',
                previousBatchSize.toString(),
                this.currentBatchSize.toString(),
                this.currentMode.mode,
                ((growthFactor - 1) * 100).toFixed(1),
            ),
        );
    }

    /**
     * Shrinks the batch size after encountering throttling with partial progress.
     *
     * Sets the batch size to the proven capacity (number of documents that
     * were successfully written before throttling occurred).
     *
     * @param successfulCount Number of documents successfully written before throttling
     */
    shrink(successfulCount: number): void {
        const previousBatchSize = this.currentBatchSize;
        this.currentBatchSize = Math.max(this.config.minBatchSize, successfulCount);

        ext.outputChannel.trace(
            l10n.t(
                '[BatchSizeAdapter] Throttle: Reducing batch size {0} → {1} (proven capacity: {2})',
                previousBatchSize.toString(),
                this.currentBatchSize.toString(),
                successfulCount.toString(),
            ),
        );
    }

    /**
     * Halves the batch size after throttling with no progress.
     *
     * Used when a throttle occurs before any documents are processed.
     */
    halve(): void {
        const previousBatchSize = this.currentBatchSize;
        this.currentBatchSize = Math.max(this.config.minBatchSize, Math.floor(this.currentBatchSize / 2) || 1);

        ext.outputChannel.trace(
            l10n.t(
                '[BatchSizeAdapter] Throttle with no progress: Halving batch size {0} → {1}',
                previousBatchSize.toString(),
                this.currentBatchSize.toString(),
            ),
        );
    }

    /**
     * Handles throttle detection, switching to RU-limited mode if necessary.
     *
     * This one-way transition occurs when the first throttle error is detected,
     * indicating the target database has throughput limits.
     *
     * Mode changes:
     * - Initial batch size: 500 → 100
     * - Max batch size: 2000 → 1000
     * - Growth factor: 20% → 10%
     *
     * @param successfulCount Number of documents successfully written before throttling
     */
    handleThrottle(successfulCount: number): void {
        // Switch to RU-limited mode if still in fast mode
        if (this.currentMode.mode === 'fast') {
            this.switchToRuLimitedMode(successfulCount);
        }

        // Adjust batch size based on partial progress
        if (successfulCount > 0) {
            this.shrink(successfulCount);
        } else {
            this.halve();
        }
    }

    /**
     * Switches from Fast mode to RU-limited mode.
     */
    private switchToRuLimitedMode(successfulCount: number): void {
        const previousMode = this.currentMode.mode;
        const previousBatchSize = this.currentBatchSize;
        const previousMaxBatchSize = this.currentMode.maxBatchSize;

        // Switch to RU-limited mode
        this.currentMode = RU_LIMITED_MODE;

        // Reset batch size based on proven capacity vs RU mode initial
        if (successfulCount <= RU_LIMITED_MODE.initialBatchSize) {
            // Low proven capacity: respect what actually worked
            this.currentBatchSize = Math.max(this.config.minBatchSize, successfulCount);
        } else {
            // High proven capacity: start conservatively with RU initial, can grow later
            this.currentBatchSize = Math.min(successfulCount, RU_LIMITED_MODE.maxBatchSize);
        }

        ext.outputChannel.info(
            l10n.t(
                '[BatchSizeAdapter] Switched from {0} mode to {1} mode after throttle. ' +
                    'Batch size: {2} → {3}, Max: {4} → {5}',
                previousMode,
                this.currentMode.mode,
                previousBatchSize.toString(),
                this.currentBatchSize.toString(),
                previousMaxBatchSize.toString(),
                this.currentMode.maxBatchSize.toString(),
            ),
        );
    }

    /**
     * Resets the adapter to initial fast mode state.
     * Useful for testing or reusing the adapter.
     */
    reset(): void {
        this.currentMode = FAST_MODE;
        this.currentBatchSize = FAST_MODE.initialBatchSize;
    }
}
