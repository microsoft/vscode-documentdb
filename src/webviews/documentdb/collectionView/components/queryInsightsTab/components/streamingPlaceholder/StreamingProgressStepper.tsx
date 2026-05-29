/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CheckmarkCircleFilled } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { StreamingPlaceholder } from './StreamingPlaceholder';
import './StreamingProgressStepper.scss';

export interface StreamingProgressStepperProps {
    /**
     * When true the stepper is active: an elapsed-time clock runs and steps
     * advance over time. When false the component renders nothing — callers
     * use this to gate visibility on the loading state.
     */
    active: boolean;

    /**
     * Optional override of the per-step dwell time in milliseconds. The last
     * step is "sticky": once reached, the stepper stays there until {@link active}
     * flips back to false. Defaults to 4000ms (4s per step).
     */
    stepDurationMs?: number;

    /**
     * Optional className for the outer container.
     */
    className?: string;
}

interface StepDescriptor {
    /** Label shown when the step is pending or done. */
    label: string;
    /** Label shown when the step is the currently-active streaming placeholder. */
    activeLabel: string;
}

const DEFAULT_STEP_DURATION_MS = 4000;
const TICK_INTERVAL_MS = 250;

/**
 * Stage 3 perceived-progress stepper. Renders four sequential phases driven
 * by a client-side timer (no backend signal). Used during Stage 3 loading to
 * make the ~10–15s wait feel responsive while real streamed content is not
 * yet wired up (Phase 0 / WI-1).
 *
 * The active step uses the shared {@link StreamingPlaceholder} shimmer so the
 * visual vocabulary matches the future per-card placeholders.
 */
export function StreamingProgressStepper({
    active,
    stepDurationMs = DEFAULT_STEP_DURATION_MS,
    className,
}: StreamingProgressStepperProps): JSX.Element | null {
    const steps = useMemo<StepDescriptor[]>(
        () => [
            { label: l10n.t('Analyzing plan'), activeLabel: l10n.t('Analyzing plan…') },
            { label: l10n.t('Identifying issues'), activeLabel: l10n.t('Identifying issues…') },
            { label: l10n.t('Generating recommendations'), activeLabel: l10n.t('Generating recommendations…') },
            { label: l10n.t('Finalizing'), activeLabel: l10n.t('Finalizing…') },
        ],
        [],
    );

    const [elapsedMs, setElapsedMs] = useState(0);
    const startTimeRef = useRef<number | null>(null);

    useEffect(() => {
        if (!active) {
            startTimeRef.current = null;
            // Defer reset to next tick to satisfy react-hooks/set-state-in-effect
            // (mirrors the pattern used by Announcer.tsx in this repo).
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

    // Derive the active step index from elapsed time. The last step is sticky:
    // it stays active until the parent flips `active` to false on completion/error.
    const rawIndex = Math.floor(elapsedMs / Math.max(1, stepDurationMs));
    const activeIndex = Math.min(rawIndex, steps.length - 1);

    const rootClass = ['streaming-progress-stepper', className].filter(Boolean).join(' ');

    return (
        <div className={rootClass}>
            {steps.map((step, index) => {
                const isDone = index < activeIndex;
                const isActive = index === activeIndex;
                const stepClass = [
                    'streaming-progress-stepper__step',
                    isActive ? 'streaming-progress-stepper__step--active' : '',
                    isDone ? 'streaming-progress-stepper__step--done' : '',
                ]
                    .filter(Boolean)
                    .join(' ');

                if (isActive) {
                    return (
                        <div key={step.label} className={stepClass}>
                            <div className="streaming-progress-stepper__active">
                                <StreamingPlaceholder
                                    variant="inline"
                                    barPosition="leading"
                                    barStyle="pulse"
                                    label={step.activeLabel}
                                    elapsedMs={elapsedMs}
                                />
                            </div>
                        </div>
                    );
                }

                return (
                    <div key={step.label} className={stepClass}>
                        {isDone ? (
                            <CheckmarkCircleFilled
                                aria-hidden="true"
                                className="streaming-progress-stepper__marker streaming-progress-stepper__marker--done"
                            />
                        ) : (
                            <span
                                aria-hidden="true"
                                className="streaming-progress-stepper__marker streaming-progress-stepper__marker--pending"
                            />
                        )}
                        <span className="streaming-progress-stepper__label">{step.label}</span>
                    </div>
                );
            })}
        </div>
    );
}
