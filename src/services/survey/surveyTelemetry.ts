/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The only place survey telemetry is emitted. Every method checks feedback permission at
 * emission time and applies the per-session bounds below. The schema is documented in
 * `docs/ai-and-plans/features/survey/design.md`.
 *
 * Privacy boundary: only an explicitly submitted 1-5 rating may accompany invitation
 * openings. No hovered star, element ID, URL, active-day count, date, or free text is sent.
 */

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';

import { isFeedbackPermitted } from '../../utils/feedbackPermission';
import { MAX_OPEN_FORM_TELEMETRY_ATTEMPTS } from './surveyConfig';
import {
    isSurveyRating,
    SURVEY_FEATURE_AREAS,
    SURVEY_GATE_ORDER,
    type SurveyEligibilityResult,
    type SurveyFeatureArea,
    type SurveyGateId,
    type SurveyGateResult,
    type SurveyGateStatus,
    type SurveyInvitationOutcome,
    type SurveyOpenFormTrigger,
} from './surveyTypes';

const ELIGIBILITY_TRIGGERS = ['sessionStart', 'newActiveDay', 'stateChange'] as const;
const DEFERRAL_REASONS = ['presenterUnavailable', 'presentationFailed'] as const;
const OPEN_FORM_TRIGGERS = ['invitation', 'command'] as const;
const OPEN_FORM_RESULTS = ['success', 'failure'] as const;
const INVITATION_OUTCOMES = ['opened', 'askLater', 'dismissed', 'neverAgain'] as const;
const GATE_STATUSES = ['passed', 'blocked', 'notEvaluated'] as const;
const ELIGIBILITY_OVERALLS = ['eligible', 'blocked'] as const;
const INVITATION_SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SurveyEventName = {
    /** First meaningful usage in this host session, before any gate. Once per host session. */
    CohortEntry: 'survey.cohortEntry',
    /** Ordered gate snapshot. First evaluation per host session, then only when the result changes. */
    Eligibility: 'survey.eligibility',
    /** Eligible but not presented. Once per changed reason. */
    PresentationDeferred: 'survey.presentationDeferred',
    /** The invitation is rendered and visible. Once per invitation. */
    InvitationShown: 'survey.invitationShown',
    /** One attempt to open the external form. Only the first `MAX_OPEN_FORM_TELEMETRY_ATTEMPTS` are reported. */
    OpenForm: 'survey.openForm',
    /** How the invitation ended. Once per invitation; never after permission withdrawal. */
    InvitationResolved: 'survey.invitationResolved',
} as const;

export type SurveyEventName = (typeof SurveyEventName)[keyof typeof SurveyEventName];

/** Why an eligibility snapshot was taken. */
export type SurveyEligibilityTrigger = 'sessionStart' | 'newActiveDay' | 'stateChange';

/**
 * Why an eligible invitation was not presented.
 * - `presenterUnavailable`: no presenter registered, or the presenter reported no destination.
 * - `presentationFailed`: the presenter threw.
 */
export type SurveyDeferralReason = 'presenterUnavailable' | 'presentationFailed';

/** Named `openResult`, not `result`, because the telemetry framework owns `result`. */
export type SurveyOpenFormTelemetryResult = 'success' | 'failure';

/** Property names. `gate_<gateId>` carries each gate's status in `survey.eligibility`. */
export const SurveyTelemetryProperty = {
    CampaignId: 'surveyCampaignId',
    PolicyVersion: 'surveyPolicyVersion',
    InvitationSessionId: 'invitationSessionId',
    FeatureArea: 'featureArea',
    Overall: 'overall',
    FirstBlockingGate: 'firstBlockingGate',
    Trigger: 'trigger',
    Reason: 'reason',
    IsReminder: 'isReminder',
    OpenResult: 'openResult',
    Outcome: 'outcome',
    WasVisible: 'wasVisible',
} as const;

/** Measurement names. */
export const SurveyTelemetryMeasurement = {
    Attempt: 'attempt',
    SelectedRating: 'selectedRating',
} as const;

/** `firstBlockingGate` value when every gate passed. */
export const NO_BLOCKING_GATE = 'none';

export function gatePropertyName(gate: SurveyGateId): `gate_${SurveyGateId}` {
    return `gate_${gate}`;
}

export interface SurveyTelemetryEvent {
    readonly name: SurveyEventName;
    readonly properties: Readonly<Record<string, string>>;
    readonly measurements: Readonly<Record<string, number>>;
}

/** Sends one event. The default sink uses `callWithTelemetryAndErrorHandling` and never shows UI. */
export type SurveyTelemetrySink = (event: SurveyTelemetryEvent) => void;

export interface SurveyTelemetryOptions {
    readonly campaignId: string;
    readonly policyVersion: string;
    /** Defaults to `isFeedbackPermitted`. Called at every emission, never cached. */
    readonly isPermitted?: () => boolean;
    /** Defaults to the `callWithTelemetryAndErrorHandling` sink. */
    readonly sink?: SurveyTelemetrySink;
}

/** Per-gate statuses as they appear in `survey.eligibility`. */
export type SurveyGateStatusProperties = Record<`gate_${SurveyGateId}`, SurveyGateStatus>;

/**
 * Emits survey events. One instance per extension host session; it holds the session's
 * dedupe state. Every `report*` method returns `true` only when an event was sent.
 * Dedupe state changes only when an event is actually sent, so an event suppressed for lack
 * of permission can still be sent later in the session if permission is granted.
 * Every event carries `surveyCampaignId` and `surveyPolicyVersion`.
 */
export class SurveyTelemetry {
    private readonly campaignId: string;
    private readonly policyVersion: string;
    private readonly isPermitted: () => boolean;
    private readonly sink: SurveyTelemetrySink;
    private cohortEntrySent = false;
    private lastSentEligibilitySignature: string | undefined;
    private lastSentDeferralReason: SurveyDeferralReason | undefined;
    private readonly shownInvitationIds = new Set<string>();
    private readonly resolvedInvitationIds = new Set<string>();

    public constructor(options: SurveyTelemetryOptions) {
        this.campaignId = options.campaignId;
        this.policyVersion = options.policyVersion;
        this.isPermitted = options.isPermitted ?? isFeedbackPermitted;
        this.sink = options.sink ?? defaultSink;
    }

    /** Once per host session. */
    public reportCohortEntry(featureArea: SurveyFeatureArea): boolean {
        if (!SURVEY_FEATURE_AREAS.includes(featureArea) || this.cohortEntrySent) {
            return false;
        }
        const sent = this.send(SurveyEventName.CohortEntry, { [SurveyTelemetryProperty.FeatureArea]: featureArea }, {});
        if (sent) {
            this.cohortEntrySent = true;
        }
        return sent;
    }

    /**
     * The first call in the session is sent. Later calls are sent only when the gate statuses
     * or `overall` differ from the last sent snapshot; `trigger` and the explanation are not
     * part of that comparison and the explanation is never sent.
     */
    public reportEligibility(result: SurveyEligibilityResult, trigger: SurveyEligibilityTrigger): boolean {
        if (
            !ELIGIBILITY_TRIGGERS.includes(trigger) ||
            !ELIGIBILITY_OVERALLS.includes(result.overall) ||
            (result.firstBlockingGate !== undefined && !SURVEY_GATE_ORDER.includes(result.firstBlockingGate)) ||
            !Array.isArray(result.gates) ||
            result.gates.length !== SURVEY_GATE_ORDER.length
        ) {
            return false;
        }

        const statuses = new Map<SurveyGateId, SurveyGateStatus>();
        const gates: readonly (SurveyGateResult | undefined)[] = result.gates;
        for (const gateResult of gates) {
            if (!gateResult) {
                return false;
            }
            const { gate, status } = gateResult;
            if (!SURVEY_GATE_ORDER.includes(gate) || !GATE_STATUSES.includes(status) || statuses.has(gate)) {
                return false;
            }
            statuses.set(gate, status);
        }

        const properties: Record<string, string> = {
            [SurveyTelemetryProperty.Overall]: result.overall,
            [SurveyTelemetryProperty.FirstBlockingGate]: result.firstBlockingGate ?? NO_BLOCKING_GATE,
            [SurveyTelemetryProperty.Trigger]: trigger,
        };
        for (const gate of SURVEY_GATE_ORDER) {
            const status = statuses.get(gate);
            if (status === undefined) {
                return false;
            }
            properties[gatePropertyName(gate)] = status;
        }
        const signature = JSON.stringify([
            ...SURVEY_GATE_ORDER.map((gate): string => properties[gatePropertyName(gate)]),
            result.overall,
        ]);
        if (signature === this.lastSentEligibilitySignature) {
            return false;
        }
        const sent = this.send(SurveyEventName.Eligibility, properties, {});
        if (sent) {
            this.lastSentEligibilitySignature = signature;
        }
        return sent;
    }

    /** Sent only when `reason` differs from the last sent deferral reason. */
    public reportPresentationDeferred(reason: SurveyDeferralReason): boolean {
        if (!DEFERRAL_REASONS.includes(reason) || reason === this.lastSentDeferralReason) {
            return false;
        }
        const sent = this.send(SurveyEventName.PresentationDeferred, { [SurveyTelemetryProperty.Reason]: reason }, {});
        if (sent) {
            this.lastSentDeferralReason = reason;
        }
        return sent;
    }

    /** Once per `invitationSessionId`. Also clears the last deferral reason. */
    public reportInvitationShown(invitationSessionId: string, isReminder: boolean): boolean {
        if (!isInvitationSessionId(invitationSessionId) || this.shownInvitationIds.has(invitationSessionId)) {
            return false;
        }
        const sent = this.send(
            SurveyEventName.InvitationShown,
            {
                [SurveyTelemetryProperty.InvitationSessionId]: invitationSessionId,
                [SurveyTelemetryProperty.IsReminder]: isReminder ? 'true' : 'false',
            },
            {},
        );
        if (sent) {
            this.shownInvitationIds.add(invitationSessionId);
            this.lastSentDeferralReason = undefined;
        }
        return sent;
    }

    /**
     * Once per attempt; attempts above `MAX_OPEN_FORM_TELEMETRY_ATTEMPTS` are not sent.
     * `invitationSessionId` is sent only for the `invitation` trigger.
     * A selected rating is included only on invitation openings (D0023).
     */
    public reportOpenForm(
        trigger: SurveyOpenFormTrigger,
        openResult: SurveyOpenFormTelemetryResult,
        attempt: number,
        invitationSessionId: string | undefined,
        selectedRating?: unknown,
    ): boolean {
        if (
            !OPEN_FORM_TRIGGERS.includes(trigger) ||
            !OPEN_FORM_RESULTS.includes(openResult) ||
            !Number.isInteger(attempt) ||
            attempt < 1 ||
            attempt > MAX_OPEN_FORM_TELEMETRY_ATTEMPTS ||
            (selectedRating !== undefined && (trigger !== 'invitation' || !isSurveyRating(selectedRating)))
        ) {
            return false;
        }
        const properties: Record<string, string> = {
            [SurveyTelemetryProperty.Trigger]: trigger,
            [SurveyTelemetryProperty.OpenResult]: openResult,
        };
        if (trigger === 'invitation') {
            if (!isInvitationSessionId(invitationSessionId)) {
                return false;
            }
            properties[SurveyTelemetryProperty.InvitationSessionId] = invitationSessionId;
        }
        const measurements: Record<string, number> = { [SurveyTelemetryMeasurement.Attempt]: attempt };
        if (isSurveyRating(selectedRating)) {
            measurements[SurveyTelemetryMeasurement.SelectedRating] = selectedRating;
        }
        return this.send(SurveyEventName.OpenForm, properties, measurements);
    }

    /** Once per `invitationSessionId`. */
    public reportInvitationResolved(
        invitationSessionId: string,
        outcome: SurveyInvitationOutcome,
        wasVisible: boolean,
    ): boolean {
        if (
            !isInvitationSessionId(invitationSessionId) ||
            !INVITATION_OUTCOMES.includes(outcome) ||
            this.resolvedInvitationIds.has(invitationSessionId)
        ) {
            return false;
        }
        const sent = this.send(
            SurveyEventName.InvitationResolved,
            {
                [SurveyTelemetryProperty.InvitationSessionId]: invitationSessionId,
                [SurveyTelemetryProperty.Outcome]: outcome,
                [SurveyTelemetryProperty.WasVisible]: wasVisible ? 'true' : 'false',
            },
            {},
        );
        if (sent) {
            this.resolvedInvitationIds.add(invitationSessionId);
        }
        return sent;
    }

    private send(
        name: SurveyEventName,
        properties: Readonly<Record<string, string>>,
        measurements: Readonly<Record<string, number>>,
    ): boolean {
        try {
            if (!this.isPermitted()) {
                return false;
            }
            this.sink({
                name,
                properties: {
                    ...properties,
                    [SurveyTelemetryProperty.CampaignId]: this.campaignId,
                    [SurveyTelemetryProperty.PolicyVersion]: this.policyVersion,
                },
                measurements,
            });
            return true;
        } catch {
            return false;
        }
    }
}

function isInvitationSessionId(value: string | undefined): value is string {
    return typeof value === 'string' && INVITATION_SESSION_ID_PATTERN.test(value);
}

function defaultSink(event: SurveyTelemetryEvent): void {
    void callWithTelemetryAndErrorHandling(event.name, (context): void => {
        context.errorHandling.suppressDisplay = true;
        context.errorHandling.rethrow = false;
        context.telemetry.suppressIfSuccessful = false;
        Object.assign(context.telemetry.properties, event.properties);
        Object.assign(context.telemetry.measurements, event.measurements);
    }).catch((): undefined => undefined);
}
