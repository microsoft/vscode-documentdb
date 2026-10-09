/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The contract between `SurveyService` and the invitation surface. Stage 2 implements
 * `SurveyPresenter` with a Secondary Sidebar webview view (D0013). Until a presenter is
 * registered, eligible invitations are deferred with reason `presenterUnavailable`.
 */

import type * as vscode from 'vscode';
import { type SurveyEligibilityExplanation, type SurveyOpenFormResult, type SurveyRating } from './surveyTypes';

export interface SurveyInvitationRequest {
    /** Joins the lifecycle events of this one invitation. Random; not derived from any user data. */
    readonly invitationSessionId: string;
    /** From the same eligibility result that triggered the invitation. */
    readonly explanation: SurveyEligibilityExplanation;
}

/** Choices that end an invitation without opening the form. `dismissed` = closed without a choice. */
export type SurveyInvitationChoice = 'askLater' | 'neverAgain' | 'dismissed';

/**
 * Supplied by the service for one invitation. Calls made after the invitation has ended
 * (resolved, disposed, or permission withdrawn) are ignored and record nothing.
 */
export interface SurveyInvitationCallbacks {
    /** The content is rendered and visible to the user. Only the first call counts. */
    onVisible(): void;
    /**
     * The primary "Continue to survey" button, with an optional locally selected rating (D0023).
     * On `opened` the service resolves the invitation and disposes the handle.
     * On `failed` the invitation stays open; the surface reports the failure in a modal error
     * and the user can choose "Continue to survey" again.
     */
    onOpenForm(selectedRating?: SurveyRating): Promise<SurveyOpenFormResult>;
    /**
     * Ends the invitation. For `neverAgain` the promise settles after the opt-out has been
     * saved or, if saving failed, honored in memory. The service disposes the handle afterwards.
     */
    onChoice(choice: SurveyInvitationChoice): Promise<void>;
}

/**
 * A constructed invitation. `dispose()` closes it silently: it must not call any callback,
 * so a programmatic close is never recorded as `dismissed`.
 */
export type SurveyInvitationHandle = vscode.Disposable;

export interface SurveyPresenter {
    /**
     * Shows the invitation without taking focus from the editor or terminal (D0012).
     * Resolves to `undefined` when the destination is unavailable. May reject on failure.
     * Must settle promptly, without waiting for the user to open a hidden view; resolve
     * `undefined` if the destination cannot be shown now.
     */
    present(
        request: SurveyInvitationRequest,
        callbacks: SurveyInvitationCallbacks,
    ): Promise<SurveyInvitationHandle | undefined>;
}
