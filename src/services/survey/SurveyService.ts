/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { readDebugOverrides } from '../../debug/debugOverrides';
import { affectsFeedbackPermission, isFeedbackPermitted } from '../../utils/feedbackPermission';
import { DEFAULT_SURVEY_POLICY_CONFIG, SURVEY_ENABLED, SURVEY_FORM_URL } from './surveyConfig';
import { traceSurvey } from './surveyDiagnostics';
import {
    computeNextEligibleAt,
    computeSamplingValue,
    evaluateEligibility,
    evaluatePreconditions,
    toLocalDay,
} from './surveyPolicy';
import { type SurveyInvitationCallbacks, type SurveyPresenter } from './surveyPresentation';
import { SurveyStateStore, type SurveyStateStorage, type SurveyStateWriteResult } from './surveyState';
import { SurveyTelemetry } from './surveyTelemetry';
import {
    SURVEY_FEATURE_AREAS,
    type SurveyActivation,
    type SurveyCollectionTab,
    type SurveyFeatureArea,
    type SurveyLocalDay,
    type SurveyOpenFormResult,
    type SurveyPolicyConfig,
    type SurveyRating,
    type SurveyTimedOutcome,
} from './surveyTypes';

export interface SurveyDebugStatus {
    readonly alwaysInvite: boolean;
    readonly enabled: boolean;
    readonly feedbackPermitted: boolean;
    readonly optedOut: boolean;
    readonly presenterRegistered: boolean;
    readonly invitationActive: boolean;
}

export interface SurveyServiceOptions {
    readonly alwaysInvite?: boolean;
    readonly storage: SurveyStateStorage;
    /** `vscode.env.machineId`; used only to compute the local sampling value. */
    readonly machineId: string;
    /** Shared code kill switch (D0021). Read on every use. */
    readonly isSurveyEnabled: () => boolean;
    /** Defaults to `isFeedbackPermitted`. Read on every use, never cached. */
    readonly isFeedbackPermitted?: () => boolean;
    /** Defaults to `DEFAULT_SURVEY_POLICY_CONFIG`. */
    readonly config?: SurveyPolicyConfig;
    /** Defaults to a `SurveyTelemetry` built from `config` and `isFeedbackPermitted`. */
    readonly telemetry?: SurveyTelemetry;
    readonly now?: () => Date;
    /** Defaults to `vscode.env.openExternal(vscode.Uri.parse(url))`. */
    readonly openExternal?: (url: string) => Thenable<boolean>;
    /** Defaults to `crypto.randomUUID`. */
    readonly createInvitationSessionId?: () => string;
    /** Surfaces a failed save of the opt-out. Defaults to a localized modal error. */
    readonly reportOptOutSaveFailure?: () => void;
}

interface ActiveInvitation {
    id: string;
    activation: SurveyActivation;
    isReminder: boolean;
    visible: boolean;
    openAttempts: number;
    ended: boolean;
    handle: vscode.Disposable | undefined;
}

/**
 * Orchestrates the survey: activity, eligibility, presentation, outcomes.
 *
 * Contract:
 * - `recordSurveyActivity` and `recordSurveyActivityWithInvitation` are synchronous,
 *   fire-and-forget, and never throw. When a precondition fails (kill switch, permission,
 *   opt-out) they only trace: no write, no event.
 * - `recordSurveyActivity` only counts the active day: no eligibility evaluation or event and
 *   no invitation. Only `recordSurveyActivityWithInvitation` evaluates and may present.
 * - All work runs through one shared in-flight promise, so concurrent calls evaluate once. An
 *   inviting call that arrives during in-flight counting is evaluated right after it.
 *   Repeated activity on an already counted day, with no state change since the last
 *   evaluation, is a no-op apart from local traces, without writes or events.
 * - An eligible result reserves the invitation synchronously, before any await, then rechecks
 *   permission and presents right away (D0012).
 * - Permission withdrawal cancels pending work and disposes the invitation without recording
 *   an outcome or emitting an event.
 */
export class SurveyService implements vscode.Disposable {
    private readonly options: SurveyServiceOptions;
    private readonly store: SurveyStateStore;
    private readonly config: SurveyPolicyConfig;
    private readonly telemetry: SurveyTelemetry;
    private readonly isPermitted: () => boolean;
    private readonly now: () => Date;
    private readonly openExternal: (url: string) => Thenable<boolean>;
    private readonly createInvitationSessionId: () => string;
    private readonly reportOptOutSaveFailure: () => void;
    private samplingValue: number | undefined;
    private inFlight: Promise<void> | undefined;
    private inFlightInvites = false;
    private pendingInvitation: SurveyFeatureArea | undefined;
    private generation = 0;
    private sessionEvaluated = false;
    private lastEvaluatedDay: SurveyLocalDay | undefined;
    private needsEvaluation = false;
    private invitationReserved = false;
    private activeInvitation: ActiveInvitation | undefined;
    private manualHandle: vscode.Disposable | undefined;
    private manualOpening: Promise<boolean> | undefined;
    private presenter: SurveyPresenter | undefined;
    private disposed = false;
    private forcedInvite = false;

    public constructor(options: SurveyServiceOptions) {
        this.options = options;
        this.store = new SurveyStateStore(options.storage);
        this.config = options.config ?? DEFAULT_SURVEY_POLICY_CONFIG;
        this.isPermitted = options.isFeedbackPermitted ?? isFeedbackPermitted;
        this.telemetry =
            options.telemetry ??
            new SurveyTelemetry({
                campaignId: this.config.campaignId,
                policyVersion: this.config.policyVersion,
                isPermitted: this.isPermitted,
            });
        this.now = options.now ?? ((): Date => new Date());
        this.openExternal =
            options.openExternal ?? ((url): Thenable<boolean> => vscode.env.openExternal(vscode.Uri.parse(url)));
        this.createInvitationSessionId = options.createInvitationSessionId ?? randomUUID;
        this.reportOptOutSaveFailure = options.reportOptOutSaveFailure ?? reportOptOutSaveFailure;
    }

    /** Counts a successful milestone in `featureArea` as usage, without evaluating or inviting. */
    public recordSurveyActivity(featureArea: SurveyFeatureArea): void {
        this.recordActivity(featureArea, false);
    }

    /**
     * Counts a successful milestone and may show the invitation. Only Collection View and
     * Cluster Dashboard milestones use this (D0031). See the class contract.
     */
    public recordSurveyActivityWithInvitation(featureArea: SurveyFeatureArea): void {
        this.recordActivity(featureArea, true);
    }

    private recordActivity(featureArea: SurveyFeatureArea, invite: boolean): void {
        try {
            if (this.disposed) {
                traceSurvey((): string => vscode.l10n.t('[Survey] Admission suppressed: service disposed.'));
                return;
            }
            if (!this.isAdmitted()) {
                return;
            }
            if (SURVEY_FEATURE_AREAS.includes(featureArea)) {
                traceSurvey((): string => vscode.l10n.t('[Survey] Acknowledged usage: {0}.', featureArea));
            }
            this.telemetry.reportCohortEntry(featureArea);
            if (this.inFlight) {
                if (invite && !this.inFlightInvites) {
                    this.pendingInvitation = featureArea;
                    traceSurvey((): string =>
                        vscode.l10n.t('[Survey] Evaluation queued behind in-flight usage counting.'),
                    );
                } else {
                    traceSurvey((): string =>
                        vscode.l10n.t('[Survey] Skipping evaluation: covered by an in-flight evaluation.'),
                    );
                }
                return;
            }
            const today = toLocalDay(this.now());
            if (!invite) {
                if (this.store.current.lastActiveDay === today) {
                    this.traceActiveDay(false, this.store.current.activeDayCount);
                    return;
                }
            } else if (
                !this.alwaysInvite &&
                this.sessionEvaluated &&
                today === this.lastEvaluatedDay &&
                !this.needsEvaluation
            ) {
                this.traceActiveDay(false, this.store.current.activeDayCount);
                traceSurvey((): string =>
                    vscode.l10n.t("[Survey] Skipping evaluation: today's activity was already evaluated."),
                );
                return;
            }
            const gen = this.generation;
            this.pendingInvitation = undefined;
            const run = (invite ? this.process(today, gen) : this.countActiveDay(today))
                .catch((): void => {
                    traceSurvey((): string => vscode.l10n.t('[Survey] Activity processing failed.'));
                })
                .then((): void => {
                    if (this.inFlight !== run) {
                        return;
                    }
                    this.inFlight = undefined;
                    const pending = this.pendingInvitation;
                    this.pendingInvitation = undefined;
                    if (pending) {
                        this.recordActivity(pending, true);
                    }
                });
            this.inFlight = run;
            this.inFlightInvites = invite;
        } catch {
            // Survey failures must never affect the successful feature milestone.
            traceSurvey((): string => vscode.l10n.t('[Survey] Activity processing failed.'));
        }
    }

    /** Registers the invitation surface (Stage 2). `undefined` unregisters it. */
    public setPresenter(presenter: SurveyPresenter | undefined): void {
        this.presenter = presenter;
    }

    /** Opens the sidebar on explicit request, independently of invitation eligibility and opt-out. */
    public async showFeedbackForm(
        source:
            | 'clusterDashboard'
            | 'collectionView'
            | 'atlasCredentials'
            | 'localQuickStart'
            | 'helpAndFeedbackView' = 'clusterDashboard',
        collectionTab?: SurveyCollectionTab,
    ): Promise<boolean> {
        if (this.manualOpening) {
            return this.manualOpening;
        }
        const opening = this.presentFeedbackForm({ source, collectionTab });
        this.manualOpening = opening;
        try {
            return await opening;
        } finally {
            if (this.manualOpening === opening) {
                this.manualOpening = undefined;
            }
        }
    }

    private async presentFeedbackForm(activation: SurveyActivation): Promise<boolean> {
        traceSurvey((): string => vscode.l10n.t('[Survey] Feedback requested from {0}.', activation.source));
        if (this.disposed || !this.presenter) {
            traceSurvey((): string => vscode.l10n.t('[Survey] Feedback presentation unavailable.'));
            return false;
        }
        this.generation++;
        this.inFlight = undefined;
        this.cancelInvitation();
        this.needsEvaluation = true;
        disposeHandle(this.manualHandle);
        this.manualHandle = undefined;
        const gen = this.generation;
        const request = {
            invitationSessionId: this.createInvitationSessionId(),
            explanation: { activeDayCount: 0, requiredActiveDays: 0, isReminder: false, previousOutcome: undefined },
            manuallyOpened: true,
        };
        const close = (): void => {
            disposeHandle(this.manualHandle);
            this.manualHandle = undefined;
        };
        try {
            const handle = await this.presenter.present(request, {
                onVisible: (): void => {
                    traceSurvey((): string => vscode.l10n.t('[Survey] Feedback visible from {0}.', activation.source));
                    if (this.isEnabled()) {
                        this.telemetry.reportFeedbackActivated(activation, request.invitationSessionId);
                    }
                },
                onOpenForm: async (selectedRating): Promise<SurveyOpenFormResult> => {
                    const result = await this.openSurveyFormFromCommand(selectedRating, activation);
                    if (result === 'opened') {
                        close();
                    }
                    return result;
                },
                onChoice: async (): Promise<void> => close(),
            });
            if (gen !== this.generation || this.disposed) {
                disposeHandle(handle);
                return false;
            }
            if (!handle) {
                traceSurvey((): string => vscode.l10n.t('[Survey] Feedback presentation unavailable.'));
                return false;
            }
            this.manualHandle = handle;
            return true;
        } catch {
            traceSurvey((): string => vscode.l10n.t('[Survey] Feedback presentation failed.'));
            return false;
        }
    }

    /**
     * User-requested form opening (command or feedback sidebar). Opens even after
     * "Never again" and regardless of the kill switch or permission. Emits `survey.openForm`
     * with trigger `command` only when the survey is enabled and permission is
     * granted. On success, applies the opened cooldown only when the survey is enabled,
     * permission is granted, and the user is not opted out. Never clears the opt-out.
     */
    public async openSurveyFormFromCommand(
        selectedRating?: SurveyRating,
        activation: SurveyActivation = { source: 'giveFeedbackCommand' },
    ): Promise<SurveyOpenFormResult> {
        traceSurvey((): string => vscode.l10n.t('[Survey] Form requested from {0}.', activation.source));
        if (activation.source === 'giveFeedbackCommand' && this.isEnabled()) {
            this.telemetry.reportFeedbackActivated(activation);
        }
        const gen = this.generation;
        let ok = false;
        try {
            ok = !!(await this.openExternal(SURVEY_FORM_URL));
        } catch {
            // Browser failures are returned to the caller, not recorded as outcomes.
        }
        traceSurvey((): string =>
            vscode.l10n.t('[Survey] Form opening from {0}: {1}.', activation.source, ok ? 'success' : 'failure'),
        );
        if (gen !== this.generation) {
            return ok ? 'opened' : 'failed';
        }
        const enabled = this.isEnabled();
        const permitted = this.isPermitted();
        if (enabled && permitted) {
            this.telemetry.reportOpenForm(
                'command',
                ok ? 'success' : 'failure',
                1,
                undefined,
                selectedRating,
                activation,
            );
        }
        if (ok && enabled && permitted && !this.store.isOptedOut) {
            traceSurvey((): string => vscode.l10n.t('[Survey] Command outcome: opened.'));
            const write = await this.store.recordOutcome(
                'opened',
                computeNextEligibleAt('opened', this.now(), this.config),
            );
            this.tracePersistence('command outcome', write);
            if (gen === this.generation) {
                this.needsEvaluation = true;
            }
        }
        return ok ? 'opened' : 'failed';
    }

    /** Called when `telemetry.telemetryLevel` may have changed. Handles withdrawal. */
    public handlePermissionChanged(): void {
        try {
            if (this.isPresentationPermitted()) {
                return;
            }
            traceSurvey((): string =>
                vscode.l10n.t('[Survey] Feedback permission withdrawn: canceling pending work and invitation.'),
            );
            this.generation++;
            this.inFlight = undefined;
            this.cancelInvitation();
            this.needsEvaluation = true;
        } catch {
            // A settings notification must not throw into the extension host.
        }
    }

    /** Resolves when the in-flight work, if any, has settled. For tests. */
    public async whenIdle(): Promise<void> {
        while (this.inFlight) {
            await this.inFlight;
        }
    }

    public async resetState(): Promise<void> {
        this.generation++;
        this.cancelInvitation();
        await this.whenIdle();
        const result = await this.store.reset();
        this.tracePersistence('reset', result);
        if (!result.persisted) {
            throw result.error;
        }
        this.invitationReserved = false;
        this.sessionEvaluated = false;
        this.lastEvaluatedDay = undefined;
        this.needsEvaluation = false;
    }

    /** For the development-only debug commands. */
    public getDebugStatus(): SurveyDebugStatus {
        return {
            alwaysInvite: this.alwaysInvite,
            enabled: this.isEnabled(),
            feedbackPermitted: this.isPermitted(),
            optedOut: this.store.isOptedOut,
            presenterRegistered: this.presenter !== undefined,
            invitationActive: this.activeInvitation !== undefined && !this.activeInvitation.ended,
        };
    }

    /**
     * Development only: switches this session to always-invite and shows an invitation now,
     * replacing any open one.
     */
    public async showInvitationForDebug(featureArea: SurveyFeatureArea): Promise<void> {
        this.forcedInvite = true;
        this.generation++;
        this.inFlight = undefined;
        this.cancelInvitation();
        disposeHandle(this.manualHandle);
        this.manualHandle = undefined;
        this.invitationReserved = false;
        this.recordSurveyActivityWithInvitation(featureArea);
        await this.whenIdle();
    }

    public dispose(): void {
        this.disposed = true;
        this.generation++;
        this.inFlight = undefined;
        this.cancelInvitation();
        disposeHandle(this.manualHandle);
        this.manualHandle = undefined;
    }

    private get alwaysInvite(): boolean {
        return this.options.alwaysInvite === true || this.forcedInvite;
    }

    private isEnabled(): boolean {
        try {
            return this.alwaysInvite || this.options.isSurveyEnabled();
        } catch {
            return false;
        }
    }

    private isAdmitted(): boolean {
        try {
            const result = evaluatePreconditions({
                alwaysInvite: this.alwaysInvite,
                surveyEnabled: this.isEnabled(),
                feedbackPermitted: this.isPermitted(),
                optedOut: this.store.isOptedOut,
            });
            if (!result.admitted) {
                switch (result.failedPrecondition) {
                    case 'killSwitch':
                        traceSurvey((): string => vscode.l10n.t('[Survey] Admission suppressed: survey disabled.'));
                        break;
                    case 'feedbackPermission':
                        traceSurvey((): string =>
                            vscode.l10n.t('[Survey] Admission suppressed: feedback not permitted.'),
                        );
                        break;
                    case 'permanentOptOut':
                        traceSurvey((): string => vscode.l10n.t('[Survey] Admission suppressed: opted out.'));
                        break;
                }
            }
            return result.admitted;
        } catch {
            traceSurvey((): string => vscode.l10n.t('[Survey] Admission suppressed: preconditions unavailable.'));
            return false;
        }
    }

    private traceActiveDay(changed: boolean, activeDayCount: number): void {
        traceSurvey((): string =>
            changed
                ? vscode.l10n.t(
                      '[Survey] Counted a new active day: {0} of {1} required.',
                      activeDayCount,
                      this.config.requiredActiveDays,
                  )
                : vscode.l10n.t(
                      '[Survey] Active day already counted: {0} of {1} required.',
                      activeDayCount,
                      this.config.requiredActiveDays,
                  ),
        );
    }

    private tracePersistence(
        operation:
            | 'active day'
            | 'command outcome'
            | 'visibility cooldown'
            | 'invitation outcome'
            | 'opt-out'
            | 'reset',
        write: SurveyStateWriteResult,
    ): void {
        traceSurvey((): string =>
            write.persisted
                ? vscode.l10n.t('[Survey] Persistence {0}: succeeded.', operation)
                : vscode.l10n.t('[Survey] Persistence {0}: failed.', operation),
        );
    }

    private async recordVisibilityCooldown(nextEligibleAt: Date): Promise<void> {
        const write = await this.store.recordCooldown(nextEligibleAt);
        this.tracePersistence('visibility cooldown', write);
    }

    private async countActiveDay(today: SurveyLocalDay): Promise<void> {
        const transition = await this.store.recordActiveDay(today);
        if (transition.changed) {
            this.tracePersistence('active day', transition.write);
        }
        this.traceActiveDay(transition.changed, this.store.current.activeDayCount);
    }

    private async process(today: SurveyLocalDay, gen: number): Promise<void> {
        const transition = await this.store.recordActiveDay(today);
        if (transition.changed) {
            this.tracePersistence('active day', transition.write);
        }
        if (gen !== this.generation) {
            traceSurvey((): string => vscode.l10n.t('[Survey] Skipping evaluation: pending work canceled.'));
            return;
        }
        if (!this.isAdmitted()) {
            return;
        }
        let trigger: 'sessionStart' | 'newActiveDay' | 'stateChange' = 'stateChange';
        if (!this.sessionEvaluated) {
            trigger = 'sessionStart';
        } else if (transition.changed) {
            trigger = 'newActiveDay';
        }
        this.sessionEvaluated = true;
        this.lastEvaluatedDay = today;
        this.needsEvaluation = false;
        this.samplingValue ??= computeSamplingValue(this.options.machineId);
        const state = this.store.current;
        const now = this.now();
        this.traceActiveDay(transition.changed, state.activeDayCount);
        const result = evaluateEligibility(
            {
                alwaysInvite: this.alwaysInvite,
                state,
                now,
                samplingValue: this.samplingValue,
                invitationIssuedThisSession: this.invitationReserved,
            },
            this.config,
        );
        this.telemetry.reportEligibility(result, trigger);
        if (result.overall !== 'eligible') {
            switch (result.firstBlockingGate) {
                case 'sampling':
                    traceSurvey((): string => vscode.l10n.t('[Survey] Not showing invitation: sampling gate blocked.'));
                    break;
                case 'activeDays':
                    traceSurvey((): string =>
                        vscode.l10n.t('[Survey] Not showing invitation: active-day threshold not reached.'),
                    );
                    break;
                case 'cooldown':
                    traceSurvey((): string => {
                        const deadline = Date.parse(state.nextEligibleAt ?? '');
                        return vscode.l10n.t(
                            '[Survey] Not showing invitation: cooldown has not expired; eligible after {0}, remaining {1} ms.',
                            new Date(deadline).toISOString(),
                            deadline - now.getTime(),
                        );
                    });
                    break;
                case 'sessionSuppression':
                    traceSurvey((): string =>
                        vscode.l10n.t(
                            '[Survey] Not showing invitation: an invitation was already issued this session.',
                        ),
                    );
                    break;
            }
            return;
        }
        traceSurvey((): string => vscode.l10n.t('[Survey] Eligible for an invitation.'));
        this.invitationReserved = true;
        this.cancelInvitation();
        const invitation: ActiveInvitation = {
            id: this.createInvitationSessionId(),
            isReminder: result.explanation.isReminder,
            activation: {
                source: 'automaticInvitation',
                invitationKind:
                    state.invitationHistory === 'new'
                        ? 'first'
                        : state.invitationHistory === 'seen'
                          ? 'returning'
                          : 'unknown',
                ...(state.invitationHistory === 'seen' ? { returnReason: state.lastInvitationOutcome ?? 'none' } : {}),
                ...(state.invitationHistory === 'unknown' ? { returnReason: 'unknown' } : {}),
            },
            visible: false,
            openAttempts: 0,
            ended: false,
            handle: undefined,
        };
        this.activeInvitation = invitation;
        if (!this.presenter) {
            traceSurvey((): string => vscode.l10n.t('[Survey] Presentation deferred: destination unavailable.'));
            this.release(invitation);
            this.telemetry.reportPresentationDeferred('presenterUnavailable');
            this.needsEvaluation = true;
            return;
        }
        if (!this.isPresentationPermitted()) {
            traceSurvey((): string => vscode.l10n.t('[Survey] Presentation canceled: feedback not permitted.'));
            this.release(invitation);
            return;
        }
        let handle: vscode.Disposable | undefined;
        try {
            traceSurvey((): string => vscode.l10n.t('[Survey] Presentation requested.'));
            handle = await this.presenter.present(
                { invitationSessionId: invitation.id, explanation: result.explanation },
                this.callbacksFor(invitation),
            );
        } catch {
            if (gen !== this.generation || invitation.ended) {
                return;
            }
            this.release(invitation);
            traceSurvey((): string => vscode.l10n.t('[Survey] Presentation deferred: presentation failed.'));
            this.telemetry.reportPresentationDeferred('presentationFailed');
            this.needsEvaluation = true;
            return;
        }
        if (gen !== this.generation || invitation.ended || this.activeInvitation !== invitation) {
            disposeHandle(handle);
            return;
        }
        if (handle === undefined) {
            traceSurvey((): string => vscode.l10n.t('[Survey] Presentation deferred: destination unavailable.'));
            this.release(invitation);
            this.telemetry.reportPresentationDeferred('presenterUnavailable');
            this.needsEvaluation = true;
            return;
        }
        invitation.handle = handle;
    }

    private release(invitation: ActiveInvitation): void {
        invitation.ended = true;
        if (this.activeInvitation === invitation) {
            this.activeInvitation = undefined;
        }
        this.invitationReserved = false;
    }

    private isLive(invitation: ActiveInvitation): boolean {
        return this.activeInvitation === invitation && !invitation.ended;
    }

    private isPresentationPermitted(): boolean {
        return this.alwaysInvite || this.isPermitted();
    }

    private callbacksFor(invitation: ActiveInvitation): SurveyInvitationCallbacks {
        return {
            onVisible: (): void => {
                if (!this.isLive(invitation) || invitation.visible) {
                    return;
                }
                invitation.visible = true;
                traceSurvey((): string => vscode.l10n.t('[Survey] Invitation rendered and visible.'));
                void this.recordVisibilityCooldown(computeNextEligibleAt('askLater', this.now(), this.config));
                this.telemetry.reportInvitationShown(invitation.id, invitation.isReminder);
                this.telemetry.reportFeedbackActivated(invitation.activation, invitation.id);
            },
            onOpenForm: async (selectedRating): Promise<SurveyOpenFormResult> => {
                if (!this.isLive(invitation) || !this.isEnabled() || !this.isPresentationPermitted()) {
                    return 'blocked';
                }
                const attempt = ++invitation.openAttempts;
                const gen = this.generation;
                let ok = false;
                try {
                    ok = !!(await this.openExternal(SURVEY_FORM_URL));
                } catch {
                    // A failed open leaves the invitation live for another explicit user attempt.
                }
                traceSurvey((): string =>
                    vscode.l10n.t('[Survey] Form opening from invitation: {0}.', ok ? 'success' : 'failure'),
                );
                if (gen !== this.generation || !this.isLive(invitation)) {
                    return ok ? 'opened' : 'failed';
                }
                this.telemetry.reportOpenForm(
                    'invitation',
                    ok ? 'success' : 'failure',
                    attempt,
                    invitation.id,
                    selectedRating,
                    invitation.activation,
                );
                if (!ok) {
                    return 'failed';
                }
                await this.endInvitation(invitation, 'opened');
                return 'opened';
            },
            onChoice: async (choice): Promise<void> => {
                if (!this.isLive(invitation)) {
                    return;
                }
                if (choice !== 'neverAgain') {
                    await this.endInvitation(invitation, choice);
                    return;
                }
                const gen = this.generation;
                invitation.ended = true;
                traceSurvey((): string => vscode.l10n.t('[Survey] Invitation outcome: neverAgain.'));
                const write = await this.store.recordOptOut(this.now());
                this.tracePersistence('opt-out', write);
                // The save error is local UI, not telemetry, so it is surfaced even after withdrawal.
                if (!write.persisted) {
                    try {
                        this.reportOptOutSaveFailure();
                    } catch {
                        // Reporting must not prevent the invitation from closing.
                    }
                }
                if (gen !== this.generation) {
                    return;
                }
                this.telemetry.reportInvitationResolved(invitation.id, 'neverAgain', invitation.visible);
                this.finishInvitation(invitation);
            },
        };
    }

    private async endInvitation(invitation: ActiveInvitation, outcome: SurveyTimedOutcome): Promise<void> {
        const gen = this.generation;
        invitation.ended = true;
        traceSurvey((): string => vscode.l10n.t('[Survey] Invitation outcome: {0}.', outcome));
        const write = await this.store.recordOutcome(
            outcome,
            computeNextEligibleAt(outcome, this.now(), this.config),
            invitation.visible,
        );
        this.tracePersistence('invitation outcome', write);
        if (gen !== this.generation) {
            return;
        }
        this.telemetry.reportInvitationResolved(invitation.id, outcome, invitation.visible);
        this.finishInvitation(invitation);
    }

    private finishInvitation(invitation: ActiveInvitation): void {
        disposeHandle(invitation.handle);
        invitation.handle = undefined;
        if (this.activeInvitation === invitation) {
            this.activeInvitation = undefined;
        }
        this.needsEvaluation = true;
    }

    private cancelInvitation(): void {
        const invitation = this.activeInvitation;
        this.activeInvitation = undefined;
        if (invitation) {
            invitation.ended = true;
            disposeHandle(invitation.handle);
            invitation.handle = undefined;
        }
    }
}

let instance: SurveyService | undefined;

/**
 * Uses the shared code kill switch in every mode (D0021), listens for permission changes,
 * and registers disposal.
 */
export function initializeSurveyService(context: vscode.ExtensionContext): SurveyService {
    if (instance) {
        return instance;
    }
    const debugOverrides = readDebugOverrides(context.extensionMode);
    const service = new SurveyService({
        storage: context.globalState,
        machineId: vscode.env.machineId,
        alwaysInvite: debugOverrides.surveyAlwaysInvite,
        isSurveyEnabled: (): boolean => SURVEY_ENABLED,
    });
    const listener = vscode.workspace.onDidChangeConfiguration((event): void => {
        if (affectsFeedbackPermission(event)) {
            service.handlePermissionChanged();
        }
    });
    context.subscriptions.push(service, listener, {
        dispose: (): void => {
            instance = undefined;
        },
    });
    instance = service;
    return service;
}

/** The singleton, or `undefined` before `initializeSurveyService`. */
export function getSurveyService(): SurveyService | undefined {
    return instance;
}

/**
 * Counts a feature milestone as usage without showing the invitation. Fire-and-forget, never
 * throws, and a no-op before initialization. Call only after a successful, user-requested milestone.
 */
export function recordSurveyActivity(featureArea: SurveyFeatureArea): void {
    try {
        instance?.recordSurveyActivity(featureArea);
    } catch {
        // Never throw into features.
    }
}

/** Like `recordSurveyActivity`, but may show the invitation. Collection View and Cluster Dashboard only. */
export function recordSurveyActivityWithInvitation(featureArea: SurveyFeatureArea): void {
    try {
        instance?.recordSurveyActivityWithInvitation(featureArea);
    } catch {
        // Never throw into features.
    }
}

function disposeHandle(handle: vscode.Disposable | undefined): void {
    try {
        handle?.dispose();
    } catch {
        // Closing an invitation must not affect the feature or permission notification.
    }
}

function reportOptOutSaveFailure(): void {
    void Promise.resolve(
        vscode.window.showErrorMessage(
            vscode.l10n.t(
                'Saving your choice not to be asked for feedback again failed. It still applies until VS Code restarts.',
            ),
            { modal: true },
        ),
    ).catch((): void => undefined);
}
