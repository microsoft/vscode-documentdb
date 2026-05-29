/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Text, tokens } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';

export interface CurrentActionLineProps {
    /**
     * When false the component renders nothing. Callers use this to gate
     * visibility on the loading state.
     */
    active: boolean;

    /**
     * Optional override of the per-step dwell time in milliseconds. The last
     * step is "sticky" — once reached it stays until {@link active} flips
     * back to false. Defaults to 4000ms.
     */
    stepDurationMs?: number;

    /** Optional className for the outer Text element. */
    className?: string;
}

interface StepDescriptor {
    label: string;
}

const DEFAULT_STEP_DURATION_MS = 4000;
const TICK_INTERVAL_MS = 250;

/**
 * Single-line "current action" indicator shown under the spinner /
 * "AI is analyzing…" message inside {@link GetPerformanceInsightsCard}.
 * Replaces the previous four-step `StreamingProgressStepper` checklist —
 * the original main-branch loading state had only the spinner + label,
 * and the user requested a single sub-line with the current action be
 * added back below that.
 *
 * The step the component is currently on is derived from a client-side
 * timer (no backend signal) using the same step labels the stepper used.
 */
export function CurrentActionLine({
    active,
    stepDurationMs = DEFAULT_STEP_DURATION_MS,
    className,
}: CurrentActionLineProps): JSX.Element | null {
    const steps = useMemo<StepDescriptor[]>(
        () => [
            { label: l10n.t('Analyzing query plan…') },
            { label: l10n.t('Identifying issues…') },
            { label: l10n.t('Generating recommendations…') },
            { label: l10n.t('Finalizing…') },
        ],
        [],
    );

    const [elapsedMs, setElapsedMs] = useState(0);
    const startTimeRef = useRef<number | null>(null);

    useEffect(() => {
        if (!active) {
            startTimeRef.current = null;
            const resetTimer = setTimeout(() => setElapsedMs(0), 0);
            return () => clearTimeout(resetTimer);
        }

        startTimeRef.current = performance.now();
        const initialResetTimer = setTimeout(() => setElapsedMs(0), 0);

        const intervalId = setInterval(() => {
            if (startTimeRef.current === null) {
                return;
            }
            setElapsedMs(performance.now() - startTimeRef.current);
        }, TICK_INTERVAL_MS);

        return () => {
            clearTimeout(initialResetTimer);
            clearInterval(intervalId);
            startTimeRef.current = null;
        };
    }, [active]);

    if (!active) {
        return null;
    }

    const rawIndex = Math.floor(elapsedMs / Math.max(1, stepDurationMs));
    const activeIndex = Math.min(rawIndex, steps.length - 1);

    return (
        <Text
            size={200}
            className={className}
            role="status"
            aria-live="polite"
            style={{ color: tokens.colorNeutralForeground3 }}
        >
            {steps[activeIndex].label}
        </Text>
    );
}
