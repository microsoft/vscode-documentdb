/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { type SurveyService } from '../SurveyService';
import { traceSurvey } from '../surveyDiagnostics';
import {
    type SurveyInvitationCallbacks,
    type SurveyInvitationHandle,
    type SurveyInvitationRequest,
    type SurveyPresenter,
} from '../surveyPresentation';
import { isSurveyRating, type SurveyOpenFormResult } from '../surveyTypes';
import { buildSurveyInvitationHtml, type SurveyInvitationStrings } from './surveyInvitationHtml';

export const SURVEY_VIEW_ID = 'documentdb.surveyInvitation';
export const SURVEY_ACTIVE_CONTEXT = 'documentdb.surveyInvitationActive';
export const SURVEY_PRESENTATION_TIMEOUT_MS = 1500;
const PRIVACY_STATEMENT_URL = 'https://go.microsoft.com/fwlink/?LinkId=521839';

interface Invitation {
    readonly request: SurveyInvitationRequest;
    readonly callbacks: SurveyInvitationCallbacks;
    readonly ready: (visible: boolean) => void;
    rendered: boolean;
    reported: boolean;
    busy: boolean;
    closed: boolean;
}

export class SurveyInvitationView implements SurveyPresenter, vscode.WebviewViewProvider, vscode.Disposable {
    private view: vscode.WebviewView | undefined;
    private active: Invitation | undefined;
    private listeners: vscode.Disposable[] = [];
    private disposed = false;

    public constructor(private readonly extensionUri: vscode.Uri) {}

    public async present(
        request: SurveyInvitationRequest,
        callbacks: SurveyInvitationCallbacks,
    ): Promise<SurveyInvitationHandle | undefined> {
        if (this.disposed || this.active) {
            traceSurvey((): string => vscode.l10n.t('[Survey] Presentation deferred: destination unavailable.'));
            return undefined;
        }
        let ready!: (visible: boolean) => void;
        const visible = new Promise<boolean>((resolve): void => {
            ready = resolve;
        });
        const invitation: Invitation = {
            request,
            callbacks,
            ready,
            rendered: false,
            reported: false,
            busy: false,
            closed: false,
        };
        this.active = invitation;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<boolean>((resolve): void => {
            timer = setTimeout((): void => {
                traceSurvey((): string => vscode.l10n.t('[Survey] Presentation deferred: reveal timed out.'));
                resolve(false);
            }, SURVEY_PRESENTATION_TIMEOUT_MS);
        });
        const reveal = async (): Promise<boolean> => {
            await vscode.commands.executeCommand('setContext', SURVEY_ACTIVE_CONTEXT, true);
            if (this.active !== invitation) {
                return false;
            }
            if (this.view) {
                this.render(invitation);
                this.view.show(true);
                this.checkVisibility();
            } else {
                await vscode.commands.executeCommand(`${SURVEY_VIEW_ID}.open`, { preserveFocus: true });
            }
            return visible;
        };
        try {
            if (!(await Promise.race([reveal(), timeout])) || this.active !== invitation) {
                this.clear(invitation);
                return undefined;
            }
            return { dispose: (): void => this.clear(invitation) };
        } catch {
            traceSurvey((): string => vscode.l10n.t('[Survey] Presentation deferred: reveal failed.'));
            this.clear(invitation);
            return undefined;
        } finally {
            clearTimeout(timer);
        }
    }

    public resolveWebviewView(view: vscode.WebviewView): void {
        for (const listener of this.listeners) {
            listener.dispose();
        }
        this.view = view;
        const resources = vscode.Uri.joinPath(this.extensionUri, 'resources', 'documentdb');
        view.webview.options = { enableScripts: true, localResourceRoots: [resources] };
        this.listeners = [
            view.webview.onDidReceiveMessage((message: unknown): void => {
                void this.handleMessage(message).catch((): void => undefined);
            }),
            view.onDidChangeVisibility((): void => this.checkVisibility()),
            view.onDidDispose((): void => {
                this.view = undefined;
                const invitation = this.active;
                if (invitation) {
                    invitation.closed = true;
                }
                if (invitation && !invitation.busy) {
                    invitation.busy = true;
                    invitation.ready(false);
                    void invitation.callbacks.onChoice('dismissed').catch((): void => undefined);
                }
            }),
        ];
        if (this.active && !this.disposed) {
            this.render(this.active);
            view.show(true);
            this.checkVisibility();
        } else {
            view.webview.html = '';
            void this.hide();
        }
    }

    public dispose(): void {
        this.disposed = true;
        if (this.active) {
            this.clear(this.active);
        }
        for (const listener of this.listeners) {
            listener.dispose();
        }
        this.listeners = [];
    }

    private render(invitation: Invitation): void {
        const webview = this.view?.webview;
        if (!webview) {
            return;
        }
        invitation.rendered = false;
        const artwork = (file: string): string =>
            webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'documentdb', file)).toString();
        webview.html = buildSurveyInvitationHtml({
            explanation: invitation.request.explanation,
            strings: getSurveyInvitationStrings(),
            nonce: randomBytes(16).toString('hex'),
            cspSource: webview.cspSource,
            artworkUri: artwork('documentdb_icon_light.svg'),
            artworkDarkUri: artwork('documentdb_icon_dark.svg'),
        });
    }

    private checkVisibility(): void {
        const invitation = this.active;
        if (!invitation || !this.view?.visible) {
            return;
        }
        invitation.ready(true);
        if (invitation.rendered && !invitation.reported) {
            invitation.reported = true;
            invitation.callbacks.onVisible();
        }
    }

    private async handleMessage(message: unknown): Promise<void> {
        const invitation = this.active;
        if (!invitation || !message || typeof message !== 'object' || !('type' in message)) {
            return;
        }
        switch (message.type) {
            case 'rendered':
                invitation.rendered = true;
                this.checkVisibility();
                return;
            case 'privacy': {
                let opened = false;
                try {
                    opened = await vscode.env.openExternal(vscode.Uri.parse(PRIVACY_STATEMENT_URL));
                } catch {
                    // Browser failures use the same generic notification, without sensitive error details.
                }
                if (!opened) {
                    await vscode.window.showErrorMessage(
                        vscode.l10n.t("We couldn't open the Privacy Statement in your browser. Please try again."),
                    );
                }
                return;
            }
            case 'openForm': {
                if (invitation.busy) {
                    return;
                }
                const selectedRating = 'selectedRating' in message ? message.selectedRating : undefined;
                if (selectedRating !== undefined && !isSurveyRating(selectedRating)) {
                    traceSurvey((): string => vscode.l10n.t('[Survey] Opening request blocked: invalid rating.'));
                    await this.reportOpenFailure(invitation, 'blocked');
                    return;
                }
                invitation.busy = true;
                let result: SurveyOpenFormResult;
                try {
                    result = await invitation.callbacks.onOpenForm(selectedRating);
                } finally {
                    invitation.busy = false;
                    if (this.active === invitation && invitation.closed) {
                        invitation.busy = true;
                        await invitation.callbacks.onChoice('dismissed');
                    }
                }
                if (result !== 'opened') {
                    await this.reportOpenFailure(invitation, result);
                }
                return;
            }
            case 'askLater':
            case 'neverAgain':
                if (!invitation.busy) {
                    invitation.busy = true;
                    await invitation.callbacks.onChoice(message.type);
                }
        }
    }

    /** Re-enables the invitation controls, then explains the failure in a modal. */
    private async reportOpenFailure(invitation: Invitation, result: 'failed' | 'blocked'): Promise<void> {
        if (this.active !== invitation) {
            return;
        }
        await this.view?.webview.postMessage({ type: 'openResult' });
        await vscode.window.showErrorMessage(
            result === 'failed'
                ? vscode.l10n.t("We couldn't open the survey in your browser. Please try again.")
                : vscode.l10n.t("Sorry, the survey can't be opened from here right now."),
            { modal: true },
        );
    }

    private clear(invitation: Invitation): void {
        if (this.active !== invitation) {
            return;
        }
        this.active = undefined;
        invitation.ready(false);
        if (this.view) {
            this.view.webview.html = '';
        }
        void this.hide();
    }

    private async hide(): Promise<void> {
        try {
            await vscode.commands.executeCommand('setContext', SURVEY_ACTIVE_CONTEXT, false);
        } catch {
            return;
        }
    }
}

export async function initializeSurveyInvitation(
    context: vscode.ExtensionContext,
    service: SurveyService,
): Promise<void> {
    await vscode.commands.executeCommand('setContext', SURVEY_ACTIVE_CONTEXT, false);
    const presenter = new SurveyInvitationView(context.extensionUri);
    context.subscriptions.push(presenter, vscode.window.registerWebviewViewProvider(SURVEY_VIEW_ID, presenter));
    service.setPresenter(presenter);
}

export function getSurveyInvitationStrings(): SurveyInvitationStrings {
    return {
        language: vscode.env.language,
        title: vscode.l10n.t('DocumentDB for VS Code'),
        question: vscode.l10n.t('How satisfied are you with DocumentDB for VS Code?'),
        stars: [
            vscode.l10n.t('Very dissatisfied'),
            vscode.l10n.t('Dissatisfied'),
            vscode.l10n.t('Neutral'),
            vscode.l10n.t('Satisfied'),
            vscode.l10n.t('Very satisfied'),
        ],
        openSurvey: vscode.l10n.t('Continue to survey'),
        browserNote: vscode.l10n.t('Pick a rating (optional), then finish the short survey in your browser.'),
        englishNote: vscode.l10n.t('The survey is in English.'),
        askLater: vscode.l10n.t('Remind me later'),
        neverAgain: vscode.l10n.t("Don't ask again"),
        why: vscode.l10n.t('Why am I seeing this?'),
        usage: vscode.l10n.t(
            "You've used DocumentDB for VS Code on {0} days, so we'd love to hear how it's going. This count stays on your device.",
        ),
        reminders: {
            opened: vscode.l10n.t("It's been a while since you last opened the survey, so we're checking in again."),
            askLater: vscode.l10n.t('You asked us to remind you later, so here we are.'),
            dismissed: vscode.l10n.t('You closed this invitation a while ago, so we are asking once more.'),
        },
        telemetry: vscode.l10n.t(
            "To improve these invitations, we record whether you qualified, whether the invitation was shown, what you chose, and any rating selected when you open the survey. We don't record your name, answers in the external form, or your usage count.",
        ),
        privacy: vscode.l10n.t('Privacy Statement'),
    };
}
