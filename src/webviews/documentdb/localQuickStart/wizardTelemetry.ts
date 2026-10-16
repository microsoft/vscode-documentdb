/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { randomUUID } from 'crypto';
import { QuickStartService } from '../../../services/localQuickStart/QuickStartService';
import {
    type QuickStartWizardPhase,
    type QuickStartWizardStepTrigger,
} from '../../../services/localQuickStart/quickStartTypes';

/**
 * One setup wizard panel, from open to close. Its id is stamped on every event the panel produces,
 * so a journey can be followed step by step and its exit point found.
 */
export interface QuickStartWizardSession {
    readonly id: string;
    readonly openedAt: number;
    readonly initialPhase: QuickStartWizardPhase;
    phase: QuickStartWizardPhase;
    phaseEnteredAt: number;
    stepChangeCount: number;
    setupAttemptCount: number;
    waitLongerCount: number;
    setupSucceeded: boolean;
    closeReason?: 'closeButton';
}

export function createWizardSession(
    id: string | undefined,
    initialPhase: QuickStartWizardPhase = 'introduction',
    now: number = Date.now(),
): QuickStartWizardSession {
    return {
        id: id ?? randomUUID(),
        openedAt: now,
        initialPhase,
        phase: initialPhase,
        phaseEnteredAt: now,
        stepChangeCount: 0,
        setupAttemptCount: 0,
        waitLongerCount: 0,
        setupSucceeded: false,
    };
}

/** Record a move to another phase as `documentDB.quickstart.wizard.step`. Repeats of the current phase are ignored. */
export function reportWizardStep(
    session: QuickStartWizardSession,
    to: QuickStartWizardPhase,
    trigger: QuickStartWizardStepTrigger,
    now: number = Date.now(),
): void {
    if (session.phase === to) {
        return;
    }
    const from = session.phase;
    const timeOnFromStepMs = now - session.phaseEnteredAt;
    session.phase = to;
    session.phaseEnteredAt = now;
    session.stepChangeCount++;
    const stepChangeIndex = session.stepChangeCount;

    void callWithTelemetryAndErrorHandling('documentDB.quickstart.wizard.step', (context) => {
        context.errorHandling.suppressDisplay = true;
        context.telemetry.properties.quickStartSessionId = session.id;
        context.telemetry.properties.fromStep = from;
        context.telemetry.properties.toStep = to;
        context.telemetry.properties.trigger = trigger;
        context.telemetry.properties.instanceState = QuickStartService.getStatus().state;
        context.telemetry.measurements.timeOnFromStepMs = timeOnFromStepMs;
        context.telemetry.measurements.stepChangeIndex = stepChangeIndex;
    });
}

/** Record where the journey ended as `documentDB.quickstart.wizard.close`. */
export function reportWizardClosed(session: QuickStartWizardSession, now: number = Date.now()): void {
    void callWithTelemetryAndErrorHandling('documentDB.quickstart.wizard.close', (context) => {
        context.errorHandling.suppressDisplay = true;
        context.telemetry.properties.quickStartSessionId = session.id;
        context.telemetry.properties.initialStep = session.initialPhase;
        context.telemetry.properties.lastStep = session.phase;
        context.telemetry.properties.closeReason = session.closeReason ?? 'panelClosed';
        context.telemetry.properties.setupSucceeded = session.setupSucceeded ? 'true' : 'false';
        context.telemetry.properties.instanceState = QuickStartService.getStatus().state;
        // The event closes a session, so its own duration says nothing; this is the time the panel was open.
        context.telemetry.measurements.sessionDurationMs = now - session.openedAt;
        context.telemetry.measurements.timeOnLastStepMs = now - session.phaseEnteredAt;
        context.telemetry.measurements.stepChangeCount = session.stepChangeCount;
        context.telemetry.measurements.setupAttemptCount = session.setupAttemptCount;
        context.telemetry.measurements.waitLongerCount = session.waitLongerCount;
    });
}
