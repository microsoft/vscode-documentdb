/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as semver from 'semver';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { SurveyService } from '../SurveyService';
import { SURVEY_FORM_URL, SURVEY_STATE_KEY } from '../surveyConfig';
import { type SurveyInvitationCallbacks, type SurveyInvitationRequest } from '../surveyPresentation';
import { EMPTY_SURVEY_STATE, type SurveyStateStorage } from '../surveyState';
import { SurveyTelemetry, type SurveyTelemetryEvent } from '../surveyTelemetry';
import { type SurveyPersistedState } from '../surveyTypes';
import {
    initializeSurveyInvitation,
    SURVEY_ACTIVE_CONTEXT,
    SURVEY_VIEW_ID,
    SurveyInvitationView,
} from './SurveyInvitationView';

vi.mock('vscode', (): object => ({
    Uri: {
        joinPath: (...parts: unknown[]): object => ({ toString: (): string => parts.join('/') }),
        parse: (url: string): string => url,
    },
    commands: { executeCommand: vi.fn() },
    window: {
        registerWebviewViewProvider: vi.fn((): object => ({ dispose: vi.fn() })),
        showErrorMessage: vi.fn(),
    },
    env: { language: 'en', openExternal: vi.fn() },
    l10n: { t: (value: string): string => value },
}));
vi.mock('@microsoft/vscode-azext-utils', (): object => ({ callWithTelemetryAndErrorHandling: vi.fn() }));

function event<T>(): { fire: (value: T) => void; listen: vscode.Event<T> } {
    const listeners = new Set<(value: T) => unknown>();
    return {
        fire: (value): void => {
            for (const listener of listeners) listener(value);
        },
        listen: (listener): vscode.Disposable => {
            listeners.add(listener);
            return {
                dispose: (): void => {
                    listeners.delete(listener);
                },
            };
        },
    };
}

function createView(): {
    view: vscode.WebviewView;
    message: (message: unknown) => void;
    visibility: (visible: boolean) => void;
    close: () => void;
    postMessage: Mock;
    show: Mock;
} {
    const messages = event<unknown>();
    const visibility = event<void>();
    const dispose = event<void>();
    const postMessage = vi.fn().mockResolvedValue(true);
    const show = vi.fn();
    const view = {
        visible: true,
        show,
        webview: {
            html: '',
            cspSource: 'vscode-webview:',
            options: {},
            asWebviewUri: (uri: vscode.Uri): vscode.Uri => uri,
            onDidReceiveMessage: messages.listen,
            postMessage,
        },
        onDidChangeVisibility: visibility.listen,
        onDidDispose: dispose.listen,
    } as unknown as vscode.WebviewView;
    return {
        view,
        message: messages.fire,
        visibility: (visible): void => {
            Object.assign(view, { visible });
            visibility.fire();
        },
        close: (): void => dispose.fire(),
        postMessage,
        show,
    };
}

const request: SurveyInvitationRequest = {
    invitationSessionId: '12345678-abcd-4abc-8def-123456789abc',
    explanation: { activeDayCount: 3, requiredActiveDays: 3, isReminder: false, previousOutcome: undefined },
};

function callbacks(): SurveyInvitationCallbacks {
    return {
        onVisible: vi.fn(),
        onOpenForm: vi.fn().mockResolvedValue('failed'),
        onChoice: vi.fn().mockResolvedValue(undefined),
    };
}

async function flush(): Promise<void> {
    for (let turn = 0; turn < 15; turn++) await Promise.resolve();
}

function harness(): {
    presenter: SurveyInvitationView;
    surface: ReturnType<typeof createView>;
    service: SurveyService;
    flags: { permitted: boolean };
    events: SurveyTelemetryEvent[];
    state: () => SurveyPersistedState;
    open: Mock<(...args: [string]) => Promise<boolean>>;
    storage: SurveyStateStorage;
} {
    const presenter = new SurveyInvitationView(vscode.Uri.parse('extension:'));
    const surface = createView();
    vi.mocked(vscode.commands.executeCommand).mockImplementation(async (command): Promise<undefined> => {
        if (command === `${SURVEY_VIEW_ID}.open`) presenter.resolveWebviewView(surface.view);
        return undefined;
    });
    const values = new Map<string, unknown>([
        [SURVEY_STATE_KEY, { ...EMPTY_SURVEY_STATE, activeDayCount: 2, lastActiveDay: '2026-10-06' }],
    ]);
    const storage: SurveyStateStorage = {
        get: <T>(key: string): T | undefined => values.get(key) as T | undefined,
        update: vi.fn(async (key: string, value: unknown): Promise<void> => {
            values.set(key, value);
        }),
    };
    const flags = { permitted: true };
    const events: SurveyTelemetryEvent[] = [];
    const telemetry = new SurveyTelemetry({
        campaignId: 'test',
        policyVersion: '1',
        isPermitted: (): boolean => flags.permitted,
        sink: (event): void => {
            events.push(event);
        },
    });
    const open = vi.fn<(...args: [string]) => Promise<boolean>>().mockResolvedValue(false);
    const service = new SurveyService({
        storage,
        machineId: 'test',
        isSurveyEnabled: (): boolean => true,
        isFeedbackPermitted: (): boolean => flags.permitted,
        now: (): Date => new Date('2026-10-07T12:00:00Z'),
        openExternal: open,
        createInvitationSessionId: (): string => request.invitationSessionId,
        telemetry,
    });
    service.setPresenter(presenter);
    return {
        presenter,
        surface,
        service,
        flags,
        events,
        storage,
        state: (): SurveyPersistedState => values.get(SURVEY_STATE_KEY) as SurveyPersistedState,
        open,
    };
}

describe('SurveyInvitationView', (): void => {
    let originalOutputChannel: typeof ext.outputChannel;
    let trace: Mock<(...args: [string]) => void>;

    beforeEach((): void => {
        vi.clearAllMocks();
        originalOutputChannel = ext.outputChannel;
        trace = vi.fn<(...args: [string]) => void>();
        ext.outputChannel = { trace } as unknown as typeof ext.outputChannel;
    });
    afterEach((): void => {
        vi.useRealTimers();
        ext.outputChannel = originalOutputChannel;
    });

    it('renders the user-opened explanation and sends the selected rating on explicit form opening', async (): Promise<void> => {
        const h = harness();
        h.open.mockResolvedValue(true);
        expect(await h.service.showFeedbackForm()).toBe(true);
        expect(h.surface.view.webview.html).toContain('You opened this with Give Feedback');
        expect(h.surface.view.webview.html).not.toContain('days, so');
        h.surface.message({ type: 'rendered' });
        h.surface.message({ type: 'openForm', selectedRating: 3 });
        await flush();
        expect(h.open).toHaveBeenCalledWith(SURVEY_FORM_URL);
        expect(h.events.filter((event): boolean => event.name === 'survey.invitationShown')).toHaveLength(0);
        expect(h.events.filter((event): boolean => event.name === 'survey.invitationResolved')).toHaveLength(0);
        expect(h.events.find((event): boolean => event.name === 'survey.openForm')).toMatchObject({
            properties: { trigger: 'command' },
            measurements: { attempt: 1, selectedRating: 3 },
        });
        h.presenter.dispose();
        h.service.dispose();
    });

    it('contributes a stable, context-gated Secondary Sidebar webview and localized command', (): void => {
        const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
            engines: { vscode: string };
            enabledApiProposals?: string[];
            contributes: {
                viewsContainers: { secondarySidebar: { id: string; title: string }[] };
                views: Record<string, { id: string; type: string; when: string; name: string }[]>;
                commands: { command: string; title: string; category: string }[];
            };
        };
        const titles = JSON.parse(readFileSync(resolve(process.cwd(), 'package.nls.json'), 'utf8')) as Record<
            string,
            string
        >;
        // The stable secondarySidebar contribution needs VS Code 1.106 or later (D0018).
        expect(semver.gte(semver.minVersion(manifest.engines.vscode) ?? '0.0.0', '1.106.0')).toBe(true);
        expect(manifest.enabledApiProposals).toBeUndefined();
        expect(manifest.contributes.viewsContainers.secondarySidebar).toContainEqual(
            expect.objectContaining({ id: 'documentdb-survey', title: '%survey.containerTitle%' }),
        );
        expect(manifest.contributes.views['documentdb-survey']).toContainEqual(
            expect.objectContaining({
                id: SURVEY_VIEW_ID,
                type: 'webview',
                when: SURVEY_ACTIVE_CONTEXT,
                name: '%survey.viewTitle%',
            }),
        );
        expect(manifest.contributes.commands).toContainEqual({
            command: 'vscode-documentdb.command.giveFeedback',
            category: 'DocumentDB',
            title: '%survey.giveFeedbackTitle%',
        });
        expect(titles['survey.giveFeedbackTitle']).toBe('Give Feedback');
        expect(titles['survey.containerTitle']).toBeTruthy();
        expect(titles['survey.viewTitle']).toBeTruthy();
    });

    it.each([false, true])(
        'waits for a canceled automatic reveal before showing manual feedback, permission withdrawn=%s',
        async (withdrawn): Promise<void> => {
            const h = harness();
            let finishReveal!: () => void;
            const reveal = new Promise<void>((resolve): void => {
                finishReveal = resolve;
            });
            vi.mocked(vscode.commands.executeCommand).mockImplementation(async (command): Promise<undefined> => {
                if (command === `${SURVEY_VIEW_ID}.open`) {
                    h.presenter.resolveWebviewView(h.surface.view);
                    await reveal;
                }
                return undefined;
            });
            h.service.recordSurveyActivityWithInvitation('dataBrowsing');
            await flush();
            expect(h.surface.view.webview.html).toContain('days, so');
            if (withdrawn) {
                h.flags.permitted = false;
                h.service.handlePermissionChanged();
            }
            const opening = h.service.showFeedbackForm('collectionView', 'documents');
            finishReveal();

            expect(await opening).toBe(true);
            expect(h.surface.view.webview.html).toContain('You opened this with Give Feedback');
            expect(h.events.filter((event): boolean => event.name === 'survey.invitationResolved')).toHaveLength(0);
            h.service.dispose();
            h.presenter.dispose();
        },
    );

    it('closes manual feedback even when its reveal has not finished', async (): Promise<void> => {
        const h = harness();
        let finishReveal!: () => void;
        const reveal = new Promise<void>((resolve): void => {
            finishReveal = resolve;
        });
        vi.mocked(vscode.commands.executeCommand).mockImplementation(async (command): Promise<undefined> => {
            if (command === `${SURVEY_VIEW_ID}.open`) {
                h.presenter.resolveWebviewView(h.surface.view);
                await reveal;
            }
            return undefined;
        });
        const opening = h.service.showFeedbackForm();
        await flush();
        h.surface.message({ type: 'askLater' });
        await flush();
        finishReveal();

        expect(await opening).toBe(false);
        expect(h.surface.view.webview.html).toBe('');
        expect(await h.service.showFeedbackForm()).toBe(true);
        expect(h.surface.view.webview.html).toContain('You opened this with Give Feedback');
        h.service.dispose();
        h.presenter.dispose();
    });

    it('registers a presenter with startup context false and no retained webview state', async (): Promise<void> => {
        const context = {
            extensionUri: vscode.Uri.parse('extension:'),
            subscriptions: [],
        } as unknown as vscode.ExtensionContext;
        const service = { setPresenter: vi.fn() } as unknown as SurveyService;
        await initializeSurveyInvitation(context, service);
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith('setContext', SURVEY_ACTIVE_CONTEXT, false);
        expect(vscode.window.registerWebviewViewProvider).toHaveBeenCalledWith(
            SURVEY_VIEW_ID,
            expect.any(SurveyInvitationView),
        );
        expect(service.setPresenter).toHaveBeenCalled();
        const presenter = vi.mocked(service.setPresenter).mock.calls[0][0] as SurveyInvitationView;
        const surface = createView();
        presenter.resolveWebviewView(surface.view);
        expect(surface.view.webview.html).toBe('');
        expect(surface.show).not.toHaveBeenCalled();
        expect(surface.view.webview.options.enableScripts).toBe(true);
        expect(surface.view.webview.options.localResourceRoots?.map((uri): string => uri.toString())).toEqual([
            'extension:/resources/documentdb',
        ]);
        presenter.dispose();
    });

    it('reveals without focus and reports only rendered AND visible, once', async (): Promise<void> => {
        const h = harness();
        const calls = callbacks();
        const handle = await h.presenter.present(request, calls);
        expect(handle).toBeDefined();
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(`${SURVEY_VIEW_ID}.open`, { preserveFocus: true });
        expect(h.surface.show).toHaveBeenCalledWith(true);
        expect(calls.onVisible).not.toHaveBeenCalled();
        h.surface.visibility(false);
        h.surface.message({ type: 'rendered' });
        expect(calls.onVisible).not.toHaveBeenCalled();
        h.surface.visibility(true);
        h.surface.message({ type: 'rendered' });
        expect(calls.onVisible).toHaveBeenCalledTimes(1);
        expect(h.surface.postMessage).not.toHaveBeenCalledWith({ type: 'focus' });
        handle?.dispose();
        h.presenter.dispose();
    });

    it('moves focus to Continue to survey when the user opens feedback', async (): Promise<void> => {
        const h = harness();
        expect(await h.service.showFeedbackForm('clusterDashboard')).toBe(true);
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(`${SURVEY_VIEW_ID}.open`, { preserveFocus: false });
        expect(h.surface.show).toHaveBeenCalledWith(false);
        h.surface.message({ type: 'rendered' });
        expect(h.surface.postMessage).toHaveBeenCalledWith({ type: 'focus' });
        await flush();
        h.surface.postMessage.mockClear();
        h.surface.message({ type: 'rendered' });
        expect(h.surface.postMessage).not.toHaveBeenCalled();
        h.service.dispose();
        h.presenter.dispose();
    });

    it('focuses an open feedback form instead of rebuilding it', async (): Promise<void> => {
        const h = harness();
        expect(await h.service.showFeedbackForm('clusterDashboard')).toBe(true);
        h.surface.message({ type: 'rendered' });
        await flush();
        const html = h.surface.view.webview.html;
        h.surface.postMessage.mockClear();

        expect(await h.service.showFeedbackForm('collectionView', 'indexes')).toBe(true);
        expect(h.surface.view.webview.html).toBe(html);
        expect(h.surface.postMessage).toHaveBeenCalledWith({ type: 'focus' });
        h.service.dispose();
        h.presenter.dispose();
    });

    it('focuses a visible automatic invitation instead of replacing it when the user asks for feedback', async (): Promise<void> => {
        const h = harness();
        h.service.recordSurveyActivityWithInvitation('dataBrowsing');
        await h.service.whenIdle();
        h.surface.message({ type: 'rendered' });
        await flush();
        const html = h.surface.view.webview.html;
        expect(html).toContain('days, so');
        h.surface.show.mockClear();

        expect(await h.service.showFeedbackForm('collectionView', 'documents')).toBe(true);
        expect(h.surface.view.webview.html).toBe(html);
        expect(h.surface.show).toHaveBeenCalledWith(false);
        expect(h.surface.postMessage).toHaveBeenCalledWith({ type: 'focus' });
        expect(
            h.events
                .filter((event): boolean => event.name === 'survey.feedbackActivated')
                .map((event): string | undefined => event.properties.activationSource),
        ).toEqual(['automaticInvitation']);
        h.service.dispose();
        h.presenter.dispose();
    });

    it('does not wait for view resolution or visibility, and records a late impression only when rendered and visible', async (): Promise<void> => {
        vi.useFakeTimers();
        const h = harness();
        vi.mocked(vscode.commands.executeCommand).mockResolvedValue(undefined);
        h.service.recordSurveyActivityWithInvitation('connection');
        await h.service.whenIdle();
        expect(h.service.getDebugStatus().invitationActive).toBe(true);
        expect(h.state().nextEligibleAt).toBeUndefined();
        expect(h.events.some((event): boolean => event.name === 'survey.presentationDeferred')).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(5000);
        h.surface.visibility(false);
        h.presenter.resolveWebviewView(h.surface.view);
        h.surface.message({ type: 'rendered' });
        expect(h.surface.view.webview.html).not.toBe('');
        expect(h.events.some((event): boolean => event.name === 'survey.invitationShown')).toBe(false);
        expect(h.state().nextEligibleAt).toBeUndefined();
        h.surface.visibility(true);
        await flush();
        expect(h.events.filter((event): boolean => event.name === 'survey.invitationShown')).toHaveLength(1);
        expect(h.state().nextEligibleAt).toBe('2026-10-21T12:00:00.000Z');
        h.service.dispose();
        h.presenter.dispose();
    });

    it('re-reveals a cold sidebar if the first open returns before the view resolves', async (): Promise<void> => {
        const h = harness();
        let opens = 0;
        vi.mocked(vscode.commands.executeCommand).mockImplementation(async (command): Promise<undefined> => {
            if (command === `${SURVEY_VIEW_ID}.open` && ++opens === 2) {
                h.presenter.resolveWebviewView(h.surface.view);
            }
            return undefined;
        });
        expect(await h.service.showFeedbackForm()).toBe(true);
        expect(opens).toBe(2);
        expect(h.surface.view.webview.html).toContain('You opened this with Give Feedback');
        h.service.dispose();
        h.presenter.dispose();
    });

    it('waits for a pending hide before activating feedback in a cold sidebar', async (): Promise<void> => {
        const h = harness();
        let finishHide!: () => void;
        const pendingHide = new Promise<void>((resolve): void => {
            finishHide = resolve;
        });
        const contexts: boolean[] = [];
        vi.mocked(vscode.commands.executeCommand).mockImplementation(
            async (command, _key, active): Promise<undefined> => {
                if (command === 'setContext') {
                    if (active === false) await pendingHide;
                    contexts.push(active as boolean);
                } else if (command === `${SURVEY_VIEW_ID}.open`) {
                    h.presenter.resolveWebviewView(h.surface.view);
                }
                return undefined;
            },
        );
        h.presenter.resolveWebviewView(h.surface.view);
        const opening = h.service.showFeedbackForm();
        await flush();
        expect(contexts).toEqual([]);
        finishHide();
        expect(await opening).toBe(true);
        expect(contexts).toEqual([false, true]);
        expect(h.surface.view.webview.html).toContain('You opened this with Give Feedback');
        h.service.dispose();
        h.presenter.dispose();
    });

    it('shows the debug invitation on a cold sidebar whose first reveal does not resolve the view', async (): Promise<void> => {
        const h = harness();
        let opens = 0;
        vi.mocked(vscode.commands.executeCommand).mockImplementation(async (command): Promise<undefined> => {
            if (command === `${SURVEY_VIEW_ID}.open` && ++opens === 2) {
                h.presenter.resolveWebviewView(h.surface.view);
            }
            return undefined;
        });
        await h.service.showInvitationForDebug('connection');
        expect(opens).toBe(2);
        expect(h.surface.view.webview.html).toContain('survey-question');
        h.surface.message({ type: 'rendered' });
        expect(h.events.filter((event): boolean => event.name === 'survey.invitationShown')).toHaveLength(1);
        h.service.dispose();
        h.presenter.dispose();
    });

    it('replaces an open feedback form with the debug invitation', async (): Promise<void> => {
        const h = harness();
        expect(await h.service.showFeedbackForm('helpAndFeedbackView')).toBe(true);
        expect(h.surface.view.webview.html).toContain('You opened this with Give Feedback');
        await h.service.showInvitationForDebug('connection');
        expect(h.service.getDebugStatus().invitationActive).toBe(true);
        expect(h.surface.view.webview.html).toContain('survey-question');
        expect(h.surface.view.webview.html).not.toContain('You opened this with Give Feedback');
        h.service.dispose();
        h.presenter.dispose();
    });

    it.each(['setContext', `${SURVEY_VIEW_ID}.open`])(
        'ignores late completion of %s after programmatic disposal',
        async (delayedCommand): Promise<void> => {
            const h = harness();
            let complete!: () => void;
            const pendingCommand = new Promise<void>((resolve): void => {
                complete = resolve;
            });
            vi.mocked(vscode.commands.executeCommand).mockImplementation(async (command): Promise<undefined> => {
                if (command === delayedCommand) await pendingCommand;
                return undefined;
            });
            const calls = callbacks();
            const pending = h.presenter.present(request, calls);
            await flush();
            h.presenter.dispose();
            complete();
            expect(await pending).toBeUndefined();
            h.presenter.resolveWebviewView(h.surface.view);
            h.surface.message({ type: 'rendered' });
            expect(h.surface.view.webview.html).toBe('');
            expect(calls.onVisible).not.toHaveBeenCalled();
            expect(calls.onChoice).not.toHaveBeenCalled();
        },
    );

    it('keeps a cold invitation live when its first view is disposed during reveal', async (): Promise<void> => {
        const h = harness();
        let complete!: () => void;
        let opens = 0;
        vi.mocked(vscode.commands.executeCommand).mockImplementation(async (command): Promise<undefined> => {
            if (command === `${SURVEY_VIEW_ID}.open`) {
                if (++opens === 1) {
                    h.presenter.resolveWebviewView(h.surface.view);
                    await new Promise<void>((resolve): void => {
                        complete = resolve;
                    });
                }
            }
            return undefined;
        });
        const calls = callbacks();
        const pending = h.presenter.present(request, calls);
        await flush();
        h.surface.close();
        complete();
        expect(await pending).toBeDefined();
        expect(calls.onChoice).not.toHaveBeenCalled();
        const replacement = createView();
        h.presenter.resolveWebviewView(replacement.view);
        replacement.message({ type: 'rendered' });
        expect(replacement.view.webview.html).toContain('survey-question');
        expect(calls.onVisible).toHaveBeenCalledOnce();
        h.surface.close();
        expect(calls.onChoice).not.toHaveBeenCalled();
        h.presenter.dispose();
    });

    it('returns undefined when reveal fails', async (): Promise<void> => {
        const h = harness();
        vi.mocked(vscode.commands.executeCommand).mockRejectedValue(new Error('unavailable'));
        expect(await h.presenter.present(request, callbacks())).toBeUndefined();
        expect(trace.mock.calls).toEqual([['[Survey] Presentation deferred: reveal failed.']]);
        h.presenter.dispose();
    });

    it('traces an unavailable disposed destination without surfacing a notification', async (): Promise<void> => {
        const h = harness();
        h.presenter.dispose();
        expect(await h.presenter.present(request, callbacks())).toBeUndefined();
        expect(trace.mock.calls).toEqual([['[Survey] Presentation deferred: destination unavailable.']]);
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it('programmatic disposal is silent, clears HTML, and hides the contribution', async (): Promise<void> => {
        const h = harness();
        const calls = callbacks();
        const handle = await h.presenter.present(request, calls);
        handle?.dispose();
        h.surface.close();
        h.surface.message({ type: 'neverAgain' });
        await flush();
        expect(calls.onChoice).not.toHaveBeenCalled();
        expect(h.surface.view.webview.html).toBe('');
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith('setContext', SURVEY_ACTIVE_CONTEXT, false);
        h.presenter.dispose();
    });

    it('withdrawal before navigation opens nothing and emits no new events or outcome', async (): Promise<void> => {
        const h = harness();
        h.service.recordSurveyActivityWithInvitation('connection');
        await h.service.whenIdle();
        const before = h.events.length;
        h.flags.permitted = false;
        h.surface.message({ type: 'openForm' });
        await flush();
        expect(h.open).not.toHaveBeenCalled();
        expect(h.events).toHaveLength(before);
        expect(h.surface.postMessage).toHaveBeenCalledWith({ type: 'openResult' });
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
            "Sorry, the survey can't be opened from here right now.",
            { modal: true },
        );
        h.service.handlePermissionChanged();
        h.surface.close();
        expect(h.state().lastOutcome).toBeUndefined();
        h.service.dispose();
        h.presenter.dispose();
    });

    it('reports each failed opening in a modal and keeps the invitation usable until success', async (): Promise<void> => {
        const h = harness();
        h.service.recordSurveyActivityWithInvitation('connection');
        await h.service.whenIdle();
        for (let attempt = 1; attempt <= 4; attempt++) {
            h.surface.message({ type: 'openForm' });
            await flush();
            expect(h.surface.postMessage).toHaveBeenLastCalledWith({ type: 'openResult' });
            expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(attempt);
            expect(vscode.window.showErrorMessage).toHaveBeenLastCalledWith(
                "We couldn't open the survey in your browser. Please try again.",
                { modal: true },
            );
            expect(h.state().nextEligibleAt).toBeUndefined();
            expect(h.surface.view.webview.html).toContain('id="open-survey"');
        }
        h.open.mockResolvedValue(true);
        h.surface.message({ type: 'openForm' });
        await flush();
        expect(h.open.mock.calls).toEqual(Array.from({ length: 5 }, (): string[] => [SURVEY_FORM_URL]));
        expect(h.state().lastOutcome).toBe('opened');
        expect(
            h.events
                .filter((event): boolean => event.name === 'survey.openForm')
                .map((event): unknown => event.measurements.attempt),
        ).toEqual([1, 2, 3]);
        expect(h.surface.view.webview.html).toBe('');
        h.service.dispose();
        h.presenter.dispose();
    });

    it('passes a selected rating through the host only on an explicit opening request', async (): Promise<void> => {
        const h = harness();
        h.service.recordSurveyActivityWithInvitation('connection');
        await h.service.whenIdle();
        expect(h.events.some((event): boolean => 'selectedRating' in event.measurements)).toBe(false);
        h.surface.message({ type: 'openForm', selectedRating: 4 });
        await flush();
        const openings = h.events.filter((event): boolean => event.name === 'survey.openForm');
        expect(openings).toHaveLength(1);
        expect(openings[0].measurements).toEqual({ attempt: 1, selectedRating: 4 });
        expect(h.open).toHaveBeenCalledWith(SURVEY_FORM_URL);
        expect(h.state()).not.toHaveProperty('selectedRating');
        h.flags.permitted = false;
        h.surface.message({ type: 'openForm', selectedRating: 2 });
        await flush();
        expect(h.open).toHaveBeenCalledTimes(1);
        expect(h.events.filter((event): boolean => event.name === 'survey.openForm')).toHaveLength(1);
        h.service.dispose();
        h.presenter.dispose();
    });

    it.each([
        { selectedRating: 0 },
        { selectedRating: 6 },
        { selectedRating: 1.5 },
        { selectedRating: NaN },
        { selectedRating: Infinity },
        { selectedRating: null },
        { selectedRating: '5' },
        { selectedRating: { value: 5 } },
        { selectedRating: [5] },
    ])('blocks malformed selected rating $selectedRating', async ({ selectedRating }): Promise<void> => {
        const h = harness();
        h.service.recordSurveyActivityWithInvitation('connection');
        await h.service.whenIdle();
        const before = h.events.length;
        h.surface.message({ type: 'openForm', selectedRating });
        await flush();
        expect(h.open).not.toHaveBeenCalled();
        expect(h.events).toHaveLength(before);
        expect(h.surface.postMessage).toHaveBeenCalledWith({ type: 'openResult' });
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
            "Sorry, the survey can't be opened from here right now.",
            { modal: true },
        );
        h.service.dispose();
        h.presenter.dispose();
    });

    it('Never again saves before the host closes, including a hide during the pending save', async (): Promise<void> => {
        const h = harness();
        h.service.recordSurveyActivityWithInvitation('connection');
        await h.service.whenIdle();
        const original = h.storage.update.bind(h.storage);
        let complete!: () => void;
        vi.mocked(h.storage.update).mockImplementationOnce(async (key, value): Promise<void> => {
            await new Promise<void>((resolve): void => {
                complete = resolve;
            });
            await original(key, value);
        });
        h.surface.message({ type: 'neverAgain' });
        await flush();
        expect(h.surface.view.webview.html).not.toBe('');
        h.surface.close();
        complete();
        await flush();
        expect(h.state().optedOutAt).toBeDefined();
        expect(h.state().lastOutcome).toBeUndefined();
        expect(
            h.events.filter((event): boolean => event.name === 'survey.invitationResolved')[0].properties.outcome,
        ).toBe('neverAgain');
        h.service.dispose();
        h.presenter.dispose();
    });

    it('explicit hide records dismissed, while collapse or switching containers does not', async (): Promise<void> => {
        const h = harness();
        h.service.recordSurveyActivityWithInvitation('connection');
        await h.service.whenIdle();
        h.surface.visibility(false);
        await flush();
        expect(h.state().lastOutcome).toBeUndefined();
        h.surface.close();
        await flush();
        expect(h.state().lastOutcome).toBe('dismissed');
        expect(
            h.events.filter((event): boolean => event.name === 'survey.invitationResolved')[0].properties.outcome,
        ).toBe('dismissed');
        h.service.dispose();
        h.presenter.dispose();
    });

    it('Ask me later is distinct from closing', async (): Promise<void> => {
        const h = harness();
        h.service.recordSurveyActivityWithInvitation('connection');
        await h.service.whenIdle();
        h.surface.message({ type: 'askLater' });
        await flush();
        expect(h.state().lastOutcome).toBe('askLater');
        h.service.dispose();
        h.presenter.dispose();
    });

    it('closing during a failed browser open still records dismissed', async (): Promise<void> => {
        const h = harness();
        h.service.recordSurveyActivityWithInvitation('connection');
        await h.service.whenIdle();
        let complete!: (result: boolean) => void;
        h.open.mockImplementationOnce(
            (): Promise<boolean> =>
                new Promise((resolve): void => {
                    complete = resolve;
                }),
        );
        h.surface.message({ type: 'openForm' });
        h.surface.close();
        complete(false);
        await flush();
        expect(h.state().lastOutcome).toBe('dismissed');
        h.service.dispose();
        h.presenter.dispose();
    });

    it('privacy uses openExternal without survey callbacks, telemetry, or URL payloads', async (): Promise<void> => {
        const h = harness();
        vi.mocked(vscode.env.openExternal).mockResolvedValue(true);
        h.service.recordSurveyActivityWithInvitation('connection');
        await h.service.whenIdle();
        const before = h.events.length;
        const stateBefore = { ...h.state() };
        h.surface.message({ type: 'privacy' });
        await flush();
        expect(vscode.env.openExternal).toHaveBeenCalledWith('https://go.microsoft.com/fwlink/?LinkId=521839');
        expect(h.open).not.toHaveBeenCalled();
        expect(h.events).toHaveLength(before);
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        expect(h.state()).toEqual(stateBefore);
        expect(h.surface.view.webview.html).not.toBe('');
        h.service.dispose();
        h.presenter.dispose();
    });

    it.each(['false', 'rejection'] as const)(
        'notifies on privacy opening %s without changing lifecycle or telemetry, and keeps the link usable',
        async (failure): Promise<void> => {
            const h = harness();
            vi.mocked(vscode.env.openExternal).mockResolvedValue(true);
            if (failure === 'false') {
                vi.mocked(vscode.env.openExternal).mockResolvedValueOnce(false);
            } else {
                vi.mocked(vscode.env.openExternal).mockRejectedValueOnce(new Error('secret-browser-details'));
            }
            h.service.recordSurveyActivityWithInvitation('connection');
            await h.service.whenIdle();
            h.surface.message({ type: 'rendered' });
            await flush();
            const before = h.events.length;
            const stateBefore = { ...h.state() };
            const writesBefore = vi.mocked(h.storage.update).mock.calls.length;
            const htmlBefore = h.surface.view.webview.html;
            h.surface.message({ type: 'privacy' });
            await flush();
            expect(vi.mocked(vscode.window.showErrorMessage).mock.calls).toEqual([
                ["We couldn't open the Privacy Statement in your browser. Please try again."],
            ]);
            expect(h.surface.view.webview.html).toBe(htmlBefore);
            expect(h.service.getDebugStatus().invitationActive).toBe(true);
            expect(h.state()).toEqual(stateBefore);
            expect(vi.mocked(h.storage.update).mock.calls).toHaveLength(writesBefore);
            expect(h.surface.postMessage).not.toHaveBeenCalled();
            h.surface.message({ type: 'privacy' });
            await flush();
            expect(vscode.env.openExternal).toHaveBeenCalledTimes(2);
            expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
            expect(h.events).toHaveLength(before);
            expect(h.open).not.toHaveBeenCalled();
            h.service.dispose();
            h.presenter.dispose();
        },
    );
});
