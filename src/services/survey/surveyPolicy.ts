/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure, synchronous survey policy. No `vscode` imports, no I/O, no clock reads: every input
 * is a parameter so the rules can be tested exhaustively.
 */

import { createHash } from 'crypto';

import {
    SURVEY_GATE_ORDER,
    SURVEY_PRECONDITION_ORDER,
    type SurveyEligibilityInput,
    type SurveyEligibilityResult,
    type SurveyGateId,
    type SurveyGateResult,
    type SurveyLocalDay,
    type SurveyPolicyConfig,
    type SurveyPreconditionId,
    type SurveyPreconditionInput,
    type SurveyPreconditionResult,
    type SurveyTimedOutcome,
} from './surveyTypes';

/**
 * Checks the preconditions in `SURVEY_PRECONDITION_ORDER` (kill switch, feedback permission,
 * permanent opt-out) and returns the first that fails. The kill switch is checked on its own:
 * a permitted telemetry level never enables a disabled survey, and vice versa.
 */
export function evaluatePreconditions(input: SurveyPreconditionInput): SurveyPreconditionResult {
    if (input.alwaysInvite) {
        return { admitted: true };
    }
    const preconditions: Record<SurveyPreconditionId, boolean> = {
        killSwitch: input.surveyEnabled,
        feedbackPermission: input.feedbackPermitted,
        permanentOptOut: !input.optedOut,
    };

    for (const precondition of SURVEY_PRECONDITION_ORDER) {
        if (!preconditions[precondition]) {
            return { admitted: false, failedPrecondition: precondition };
        }
    }
    return { admitted: true };
}

/**
 * Evaluates the gates in `SURVEY_GATE_ORDER`:
 * - `sampling`: passes when `samplingValue < config.samplingFraction`.
 * - `activeDays`: passes when `state.activeDayCount >= config.requiredActiveDays`.
 * - `cooldown`: passes when `state.nextEligibleAt` is undefined, unparseable, or `<= now`.
 * - `sessionSuppression`: passes when `invitationIssuedThisSession` is false.
 *
 * The first blocked gate stops evaluation; every later gate is `notEvaluated`. The explanation
 * is built from the same input, so the invitation text always matches this result.
 * Preconditions (including the opt-out) are not evaluated here; see `evaluatePreconditions`.
 */
export function evaluateEligibility(
    input: SurveyEligibilityInput,
    config: SurveyPolicyConfig,
): SurveyEligibilityResult {
    const { state, now, samplingValue, invitationIssuedThisSession } = input;
    const gates: SurveyGateResult[] = [];
    let firstBlockingGate: SurveyGateId | undefined;

    for (const gate of SURVEY_GATE_ORDER) {
        if (firstBlockingGate !== undefined) {
            gates.push({ gate, status: 'notEvaluated' });
            continue;
        }

        let passed: boolean;
        switch (gate) {
            case 'sampling':
                passed = Number.isFinite(samplingValue) && samplingValue < config.samplingFraction;
                break;
            case 'activeDays':
                passed = state.activeDayCount >= config.requiredActiveDays;
                break;
            case 'cooldown': {
                if (state.nextEligibleAt === undefined) {
                    passed = true;
                } else {
                    const nextEligibleAt = Date.parse(state.nextEligibleAt);
                    passed = Number.isNaN(nextEligibleAt) || nextEligibleAt <= now.getTime();
                }
                break;
            }
            case 'sessionSuppression':
                passed = !invitationIssuedThisSession;
                break;
        }

        passed = input.alwaysInvite || passed;
        gates.push({ gate, status: passed ? 'passed' : 'blocked' });
        if (!passed) {
            firstBlockingGate = gate;
        }
    }

    return {
        gates,
        overall: firstBlockingGate === undefined ? 'eligible' : 'blocked',
        firstBlockingGate,
        explanation: {
            activeDayCount: state.activeDayCount,
            requiredActiveDays: config.requiredActiveDays,
            previousOutcome: state.lastOutcome,
            isReminder: state.lastOutcome !== undefined,
        },
    };
}

/** The local calendar day of `date` (D0003), `YYYY-MM-DD`, using the host's local time zone. */
export function toLocalDay(date: Date): SurveyLocalDay {
    const year = String(date.getFullYear()).padStart(4, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * When the next invitation may appear after `outcome`: `now` plus the outcome's cooldown in
 * days (`openedCooldownDays`, `askLaterCooldownDays`, or `dismissedCooldownDays`), measured as
 * elapsed time (days * 24h), not calendar days.
 */
export function computeNextEligibleAt(outcome: SurveyTimedOutcome, now: Date, config: SurveyPolicyConfig): Date {
    let days: number;
    switch (outcome) {
        case 'opened':
            days = config.openedCooldownDays;
            break;
        case 'askLater':
            days = config.askLaterCooldownDays;
            break;
        case 'dismissed':
            days = config.dismissedCooldownDays;
            break;
        default: {
            const exhaustiveOutcome: never = outcome;
            throw new Error(`Unknown survey outcome: ${exhaustiveOutcome}`);
        }
    }
    return new Date(now.getTime() + days * 86_400_000);
}

/**
 * Deterministic value in [0, 1) derived from the machine ID with SHA-256 (first 4 bytes as an
 * unsigned 32-bit integer divided by 2^32). Same input, same value. Never sent in telemetry.
 */
export function computeSamplingValue(machineId: string): number {
    const hash = createHash('sha256').update(machineId, 'utf8').digest();
    return hash.readUInt32BE(0) / 2 ** 32;
}
