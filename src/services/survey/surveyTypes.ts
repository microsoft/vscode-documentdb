/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared types for the survey feature. See `docs/ai-and-plans/features/survey/` for the
 * requirements, the decisions (D0001 to D0017), and the event schema in `design.md`.
 */

/**
 * Feature areas that can mark a day as active. One value per row of the README
 * "Broader Activity Coverage" table. Closed on purpose: adding an area is a reviewed change.
 */
export const SURVEY_FEATURE_AREAS = [
    'connection',
    'dataBrowsing',
    'queryPlayground',
    'interactiveShell',
    'dataManagement',
    'queryInsights',
    'clusterDashboard',
] as const;

export type SurveyFeatureArea = (typeof SURVEY_FEATURE_AREAS)[number];

// ---------------------------------------------------------------------------------------------
// Preconditions: checked before any survey activity is collected or any survey event is emitted.
// A failed precondition is never reported as a gate rejection.
// ---------------------------------------------------------------------------------------------

export const SURVEY_PRECONDITION_ORDER = ['killSwitch', 'feedbackPermission', 'permanentOptOut'] as const;

export type SurveyPreconditionId = (typeof SURVEY_PRECONDITION_ORDER)[number];

export interface SurveyPreconditionInput {
    readonly alwaysInvite?: boolean;
    /** Shared code kill switch (D0021). */
    readonly surveyEnabled: boolean;
    /** Result of `isFeedbackPermitted()`: `telemetry.telemetryLevel === 'all'`, fail closed. */
    readonly feedbackPermitted: boolean;
    /** The user chose "Never again" (D0002). Permanent. */
    readonly optedOut: boolean;
}

export type SurveyPreconditionResult =
    | { readonly admitted: true }
    | { readonly admitted: false; readonly failedPrecondition: SurveyPreconditionId };

// ---------------------------------------------------------------------------------------------
// Gates: evaluated in this fixed order and reported in `survey.eligibility`. Once a gate blocks,
// every later gate is `notEvaluated`.
// ---------------------------------------------------------------------------------------------

export const SURVEY_GATE_ORDER = ['sampling', 'activeDays', 'cooldown', 'sessionSuppression'] as const;

export type SurveyGateId = (typeof SURVEY_GATE_ORDER)[number];

export type SurveyGateStatus = 'passed' | 'blocked' | 'notEvaluated';

export interface SurveyGateResult {
    readonly gate: SurveyGateId;
    readonly status: SurveyGateStatus;
}

export type SurveyEligibilityOverall = 'eligible' | 'blocked';

/** Outcomes that set a timed cooldown. "Never again" is stored separately as a permanent opt-out. */
export type SurveyTimedOutcome = 'opened' | 'askLater' | 'dismissed';

/** Every way an invitation can end. `dismissed` means closed without a choice (D0007). */
export type SurveyInvitationOutcome = SurveyTimedOutcome | 'neverAgain';

/**
 * Local data for the "Why am I seeing this?" section. Never sent in telemetry: the exact
 * active-day count stays on the device.
 */
export interface SurveyEligibilityExplanation {
    readonly activeDayCount: number;
    readonly requiredActiveDays: number;
    /** The outcome of the previous invitation, if any. Explains why an invitation returned. */
    readonly previousOutcome: SurveyTimedOutcome | undefined;
    /** True when `previousOutcome` is defined. */
    readonly isReminder: boolean;
}

export interface SurveyEligibilityResult {
    /** One entry per gate, in `SURVEY_GATE_ORDER`. */
    readonly gates: readonly SurveyGateResult[];
    readonly overall: SurveyEligibilityOverall;
    /** Undefined when `overall` is `eligible`. */
    readonly firstBlockingGate: SurveyGateId | undefined;
    readonly explanation: SurveyEligibilityExplanation;
}

export interface SurveyEligibilityInput {
    readonly alwaysInvite?: boolean;
    readonly state: SurveyPersistedState;
    readonly now: Date;
    /** Deterministic per-installation value in [0, 1), see `computeSamplingValue`. */
    readonly samplingValue: number;
    /** An invitation was already reserved or shown in this extension host session. */
    readonly invitationIssuedThisSession: boolean;
}

export interface SurveyPolicyConfig {
    /** D0009: one long-lived campaign ID, sent with every survey event. */
    readonly campaignId: string;
    /** Identifies this gate configuration, sent with every survey event. Bump when a value below changes. */
    readonly policyVersion: string;
    /** D0004. */
    readonly requiredActiveDays: number;
    /** D0008: fraction in [0, 1]. An installation passes when its sampling value is below it. */
    readonly samplingFraction: number;
    /** D0005. */
    readonly askLaterCooldownDays: number;
    /** D0007: own constant, same value as `askLaterCooldownDays`. */
    readonly dismissedCooldownDays: number;
    /** D0006. */
    readonly openedCooldownDays: number;
}

// ---------------------------------------------------------------------------------------------
// Persisted state (D0011: starts empty, no legacy values are read)
// ---------------------------------------------------------------------------------------------

export const SURVEY_STATE_VERSION = 1;

/** Local calendar day (D0003), formatted `YYYY-MM-DD`. */
export type SurveyLocalDay = string;

/**
 * The single versioned object stored in `globalState`. Written only on real transitions:
 * a new active day, an invitation outcome, or the opt-out.
 */
export interface SurveyPersistedState {
    readonly version: typeof SURVEY_STATE_VERSION;
    /** Number of distinct local days with a qualifying milestone. */
    readonly activeDayCount: number;
    /** The last day counted in `activeDayCount`. */
    readonly lastActiveDay: SurveyLocalDay | undefined;
    /** Outcome of the most recent resolved invitation that set a cooldown. */
    readonly lastOutcome: SurveyTimedOutcome | undefined;
    /** ISO 8601 timestamp. Invitations are suppressed until then. */
    readonly nextEligibleAt: string | undefined;
    /** ISO 8601 timestamp of "Never again". When set, the user is permanently opted out. */
    readonly optedOutAt: string | undefined;
}

// ---------------------------------------------------------------------------------------------
// Opening the external form
// ---------------------------------------------------------------------------------------------

export type SurveyRating = 1 | 2 | 3 | 4 | 5;

export function isSurveyRating(value: unknown): value is SurveyRating {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

/** Where the request to open the form came from (D0015). */
export type SurveyOpenFormTrigger = 'invitation' | 'command';

/**
 * - `opened`: `openExternal` reported success. Not proof of survey completion.
 * - `failed`: `openExternal` failed or threw; the caller reports it in a modal error.
 * - `blocked`: not attempted (permission withdrawn, survey disabled, or no active invitation).
 */
export type SurveyOpenFormResult = 'opened' | 'failed' | 'blocked';
