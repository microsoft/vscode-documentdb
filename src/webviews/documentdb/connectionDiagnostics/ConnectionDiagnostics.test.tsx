/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SSRProvider } from '@fluentui/react-components';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client'; // eslint-disable-line import/no-internal-modules

import { ConnectionDiagnostics } from './ConnectionDiagnostics';
import { type PanelEvent, type RunUpdate, type TimeoutProfile } from './connectionDiagnosticsTypes';
import { formatDuration } from './formatEvidence';
import { panelRowIds, type PanelRow } from './panelTypes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no ResizeObserver; Fluent's MessageBar observes its own width to reflow its actions.
class NoopResizeObserver {
    public observe(): void {}
    public unobserve(): void {}
    public disconnect(): void {}
}
window.ResizeObserver ??= NoopResizeObserver;

interface Handlers<T> {
    onData(value: T): void;
    onError?(error: unknown): void;
}

interface RunCall {
    readonly input: {
        readonly timeoutProfile: TimeoutProfile;
        readonly trigger: 'initial' | 'rerun';
        readonly requestId: string;
    };
    readonly handlers: Handlers<RunUpdate>;
    readonly unsubscribe: ReturnType<typeof vi.fn>;
}

const client = vi.hoisted(() => {
    const runCalls: RunCall[] = [];
    const panelHandlers: Handlers<PanelEvent>[] = [];
    const mutation = (): { mutate: ReturnType<typeof vi.fn<() => Promise<void>>> } => ({
        mutate: vi.fn(async (): Promise<void> => undefined),
    });
    return {
        runCalls,
        panelHandlers,
        configuration: {
            feedbackPermitted: true as boolean | undefined,
            // Off unless a test is about pacing (decision 0043), so runs show at once.
            stepPacing: { stepMs: 0, jitterMs: 0 },
        },
        trpc: {
            common: {
                openFeedback: mutation(),
                confirm: { mutate: vi.fn(async (): Promise<{ confirmed: boolean }> => ({ confirmed: true })) },
            },
            connectionDiagnostics: {
                run: {
                    subscribe: vi.fn((input: RunCall['input'], handlers: Handlers<RunUpdate>) => {
                        const unsubscribe = vi.fn();
                        runCalls.push({ input, handlers, unsubscribe });
                        return { unsubscribe };
                    }),
                },
                panelEvents: {
                    subscribe: vi.fn((_input: undefined, handlers: Handlers<PanelEvent>) => {
                        panelHandlers.push(handlers);
                        return { unsubscribe: vi.fn() };
                    }),
                },
                cancel: mutation(),
                showDiagnostics: mutation(),
                setReportIdentifiers: mutation(),
                copyReport: mutation(),
                saveReport: mutation(),
            },
        },
    };
});

vi.mock('@vscode/l10n', () => ({
    t: (message: string, ...args: unknown[]): string =>
        args.reduce<string>((result, value, index) => result.replace(`{${index}}`, String(value)), message),
}));
vi.mock('@microsoft/vscode-ext-webview/react', () => ({
    useConfiguration: () => ({
        connectionName: 'Orders cluster',
        diagnosticsSessionId: 'session-1',
        feedbackPermitted: client.configuration.feedbackPermitted,
        stepPacing: client.configuration.stepPacing,
    }),
}));
vi.mock('../../_integration/useTrpcClient', () => ({ useTrpcClient: () => client.trpc }));

const labels = [
    'Diagnosis setup',
    'Connection settings',
    'Server address (DNS)',
    'Network connection (TCP)',
    'Secure connection (TLS)',
    'Server greeting (hello)',
    'Authentication',
    'Database access',
];

const pending: PanelRow[] = panelRowIds.map((id): PanelRow => ({ id, status: 'pending', segments: [] }));
const connected: PanelRow[] = [
    {
        id: 'setup',
        status: 'done',
        segments: [
            { kind: 'location', remoteKind: 'local' },
            { kind: 'platform', platform: 'linux' },
            { kind: 'arch', arch: 'x64' },
        ],
    },
    {
        id: 'connectionSettings',
        status: 'done',
        segments: [
            { kind: 'scheme', scheme: 'mongodb+srv' },
            { kind: 'user', userName: 'alice' },
            { kind: 'optionCount', count: 2 },
        ],
    },
    {
        id: 'serverAddress',
        status: 'done',
        segments: [
            { kind: 'srvHosts', count: 3 },
            { kind: 'resolved', resolved: 3, total: 3 },
        ],
    },
    {
        id: 'networkConnection',
        status: 'done',
        segments: [
            { kind: 'reachable', reachable: 3, total: 3 },
            { kind: 'port', port: 10260 },
        ],
    },
    {
        id: 'secureConnection',
        status: 'done',
        segments: [{ kind: 'certificateTrusted' }],
    },
    {
        id: 'serverResponse',
        status: 'done',
        segments: [{ kind: 'topology', topology: 'replicaSet', setName: 'rs0' }, { kind: 'primaryFound' }],
    },
    { id: 'authentication', status: 'done', segments: [] },
    { id: 'databaseAccess', status: 'done', segments: [] },
];
const coverage = { limited: false, retryWouldHelp: false, connectionTimeoutLimited: false };
const anyRequestId: unknown = expect.any(String);

function rowsWith(base: readonly PanelRow[], replacements: readonly PanelRow[]): PanelRow[] {
    return base.map((row): PanelRow => replacements.find((replacement): boolean => replacement.id === row.id) ?? row);
}

let host: HTMLDivElement;
let root: Root;

async function render(): Promise<void> {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
        root.render(
            <SSRProvider>
                <ConnectionDiagnostics />
            </SSRProvider>,
        );
    });
}

async function send(update: RunUpdate, call = client.runCalls[client.runCalls.length - 1]): Promise<void> {
    await act(async () => {
        call.handlers.onData(update);
    });
}

function cardResult(outcome: 'connected' | 'failed' | 'notTested'): Extract<RunUpdate, { type: 'finished' }>['result'] {
    return {
        outcome,
        firewallHint: false,
        earlierSignInFailure: false,
        runTimeoutBeforeAttempt: false,
        authenticated: outcome === 'connected',
    };
}

async function finish(runId: string, extra: Partial<Extract<RunUpdate, { type: 'finished' }>> = {}): Promise<void> {
    await send({ type: 'started', runId, startedAt: 1, rows: pending });
    await send({
        type: 'finished',
        runId,
        finishedAt: Date.now(),
        rows: connected,
        outcome: 'connected',
        result: cardResult(extra.outcome ?? 'connected'),
        coverage,
        ...extra,
    });
}

function items(): HTMLElement[] {
    return [...host.querySelectorAll<HTMLElement>('#connectivity-checks [role="listitem"]')];
}

function buttons(text: string): HTMLButtonElement[] {
    return [...host.querySelectorAll<HTMLButtonElement>('button')].filter(
        (button): boolean => button.textContent === text,
    );
}

function footerButton(text: string): HTMLButtonElement {
    const button = buttons(text).find((candidate): boolean => !candidate.closest('#connectivity-result'));
    if (!button) {
        throw new Error(`No footer button ${text}`);
    }
    return button;
}

async function click(element: HTMLElement): Promise<void> {
    await act(async () => {
        element.click();
    });
}

async function shareReport(action: 'Copy report to clipboard' | 'Save report to file…'): Promise<void> {
    await click(footerButton('Share report'));
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (candidate): boolean => candidate.textContent === action,
    );
    if (!item) {
        throw new Error(`Missing Share report action ${action}`);
    }
    await click(item);
    // The share warning adds a round trip before the report action itself.
    await act(async () => {
        await new Promise<void>((resolve): void => {
            setTimeout(resolve, 0);
        });
    });
}

async function settleAnnouncements(): Promise<void> {
    await act(async () => {
        await new Promise<void>((resolve): void => {
            setTimeout(resolve, 150);
        });
    });
}

function announcements(): string[] {
    return [...host.querySelectorAll('[role="status"]')]
        .map((region): string => region.textContent ?? '')
        .filter((text): boolean => text.length > 0);
}

describe('ConnectionDiagnostics', () => {
    beforeEach(() => {
        // jsdom has no native modal top layer; its selector engine recurses on Floating UI's check.
        const matches = Element.prototype.matches;
        vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string): boolean {
            return selector === ':modal' ? false : matches.call(this, selector) === true;
        });
        client.runCalls.length = 0;
        client.panelHandlers.length = 0;
        client.configuration.feedbackPermitted = true;
        client.configuration.stepPacing = { stepMs: 0, jitterMs: 0 };
        vi.clearAllMocks();
        client.trpc.common.confirm.mutate.mockResolvedValue({ confirmed: true });
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        host.remove();
        vi.restoreAllMocks();
    });

    it('shows the eight static labels in order from the first render and starts the default run', async () => {
        await render();
        expect(items()).toHaveLength(8);
        items().forEach((item, index) => {
            expect(item.textContent).toContain(labels[index]);
            expect(item.textContent).toContain('pending');
        });
        expect(client.runCalls.map((call) => call.input)).toEqual([
            { timeoutProfile: 'default', trigger: 'initial', requestId: anyRequestId },
        ]);
        expect(client.trpc.connectionDiagnostics.panelEvents.subscribe).toHaveBeenCalledTimes(1);
        expect(host.querySelector('h1')?.textContent).toBe('Connection Diagnostics');
        expect(host.textContent).toContain('Checking the connection…');
        expect(buttons('Re-run')).toHaveLength(0);
        expect(footerButton('Cancel').parentElement?.querySelectorAll('button')).toHaveLength(1);
    });

    it('updates last checked at the relative thresholds without a running timer', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
        try {
            await render();
            await act(async () => {
                vi.advanceTimersByTime(65_000);
            });
            expect(host.textContent).toContain('Checking the connection…');
            expect(host.textContent).not.toContain('Elapsed');
            await finish('run-1');
            expect(host.textContent).toContain('Checked a few seconds ago');
            for (const [ms, text] of [
                [29_999, 'Checked a few seconds ago'],
                [1, 'Checked less than a minute ago'],
                [29_999, 'Checked less than a minute ago'],
                [1, 'Checked 1 minute ago'],
                [59_999, 'Checked 1 minute ago'],
                [1, 'Checked 2 minutes ago'],
                [60_000, 'Checked 3 minutes ago'],
                [56 * 60_000, 'Checked 59 minutes ago'],
                [60_000, 'Checked 1 hour ago'],
                [60 * 60_000, 'Checked 2 hours ago'],
                [21 * 60 * 60_000, 'Checked 23 hours ago'],
                [60 * 60_000, 'Checked on '],
            ] as const) {
                // Step through every scheduled update: each one schedules the next after it renders.
                for (let left = ms; left > 0; left -= Math.min(left, 60_000)) {
                    await act(async () => {
                        vi.advanceTimersByTime(Math.min(left, 60_000));
                    });
                }
                expect(host.textContent).toContain(text);
            }
            await click(footerButton('Re-run'));
            await act(async () => {
                vi.advanceTimersByTime(60_000);
            });
            expect(host.textContent).toContain('Checking the connection…');
            expect(host.textContent).not.toContain('Checked');
        } finally {
            vi.useRealTimers();
        }
    });

    describe('header', () => {
        function header(): HTMLElement {
            // The header is the region before the `main` landmark, as in every Container surface.
            const container = host.querySelector('main')?.previousElementSibling;
            if (!(container instanceof HTMLElement) || !container.querySelector('h1')) {
                throw new Error('Missing header');
            }
            return container;
        }

        it('keeps the task header static and puts the connection and run status in a wizard-style content section', async () => {
            await render();
            expect(host.querySelectorAll('h1')).toHaveLength(1);
            const media = header().querySelector('svg');
            expect(media?.getAttribute('aria-hidden')).toBe('true');
            expect(header().textContent).toContain('Check a connection step by step and review the results.');
            expect(header().textContent).not.toContain('Orders cluster');
            expect(header().textContent).not.toContain('Elapsed');
            const headerText = header().textContent;
            const main = host.querySelector('main');
            const heading = main?.querySelector('h2');
            expect(heading?.textContent).toBe('Orders cluster');
            expect(main?.textContent).toContain('Checking the connection…');
            expect(
                heading && heading.compareDocumentPosition(items()[0]) & Node.DOCUMENT_POSITION_FOLLOWING,
            ).toBeTruthy();
            expect(host.querySelector('nav, [role="tablist"]')).toBeNull();
            await finish('run-1');
            expect(header().textContent).toBe(headerText);
            expect(main?.querySelector('h2')).toBe(heading);
            expect(main?.textContent).toContain('Checked a few seconds ago');
            await click(footerButton('Re-run'));
            expect(header().textContent).toBe(headerText);
            expect(main?.querySelector('h2')).toBe(heading);
            expect(main?.textContent).toContain('Checking the connection…');
        });

        it('offers Give Feedback, as the wizards do, when feedback is permitted', async () => {
            await render();
            const feedback = buttons('Give Feedback');
            expect(feedback).toHaveLength(1);
            expect(header().contains(feedback[0])).toBe(true);
            await click(feedback[0]);
            expect(client.trpc.common.openFeedback.mutate).toHaveBeenCalledWith({});
        });

        it('keeps a rejected feedback request out of the page', async () => {
            await render();
            client.trpc.common.openFeedback.mutate.mockRejectedValueOnce(new Error('aborted'));
            await click(buttons('Give Feedback')[0]);
        });

        it.each([false, undefined])('hides Give Feedback when feedbackPermitted is %s', async (permitted) => {
            client.configuration.feedbackPermitted = permitted;
            await render();
            expect(buttons('Give Feedback')).toHaveLength(0);
        });
    });

    it('updates only the status and detail of the same rows', async () => {
        await render();
        const before = items();
        await send({ type: 'started', runId: 'run-1', startedAt: 1, rows: pending });
        await send({
            type: 'rows',
            runId: 'run-1',
            rows: rowsWith(pending, [
                connected[0],
                { id: 'connectionSettings', status: 'active', segments: [{ kind: 'checking' }] },
            ]),
        });
        const after = items();
        expect(after).toHaveLength(8);
        after.forEach((item, index) => {
            expect(item).toBe(before[index]);
            expect(item.textContent).toContain(labels[index]);
        });
        expect(after[0].textContent).toContain('Running on this computer · Linux · x64');
        expect(after[0].textContent).toContain('done');
        expect(after[1].textContent).toContain('Checking…');
        expect(host.querySelector('#connectivity-result')).toBeNull();
    });

    it('renders the result card below the list only when the run finishes, and hides Cancel', async () => {
        await render();
        expect(footerButton('Cancel')).toBeDefined();
        await send({ type: 'started', runId: 'run-1', startedAt: 1, rows: pending });
        expect(host.querySelector('#connectivity-result')).toBeNull();
        await send({
            type: 'finished',
            runId: 'run-1',
            finishedAt: Date.now(),
            rows: connected,
            outcome: 'connected',
            result: cardResult('connected'),
            coverage,
        });
        const list = host.querySelector('#connectivity-checks');
        const card = host.querySelector('#connectivity-result');
        expect(list && card && list.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(card?.textContent).toContain('Connection successful');
        expect(card?.textContent).not.toContain('Contacting support?');
        expect(buttons('Cancel')).toHaveLength(0);
        expect(host.textContent).toContain('Checked a few seconds ago');
    });

    it('keeps the shown rows and shows only the cancelled card after Cancel', async () => {
        await render();
        await send({ type: 'started', runId: 'run-1', startedAt: 1, rows: pending });
        await send({
            type: 'rows',
            runId: 'run-1',
            rows: rowsWith(pending, [
                connected[0],
                { id: 'connectionSettings', status: 'active', segments: [{ kind: 'checking' }] },
            ]),
        });
        await click(footerButton('Cancel'));
        expect(client.trpc.connectionDiagnostics.cancel.mutate).toHaveBeenCalledTimes(1);
        await send({ type: 'rows', runId: 'run-1', rows: connected });
        await send({ type: 'cancelled', runId: 'run-1', rows: connected });
        const card = host.querySelector('#connectivity-result');
        expect(card?.textContent).toBe('Diagnosis cancelledYou cancelled the diagnosis. The results so far are kept.');
        expect(card?.querySelectorAll('button')).toHaveLength(0);
        expect(items()[0].textContent).toContain('done');
        expect(items()[1].textContent).toContain('pending');
        expect(items()[1].textContent).not.toContain('Checking…');
        expect(host.textContent).toContain('Diagnosis cancelled');
        expect(buttons('Cancel')).toHaveLength(0);
    });

    it('names the run it cancels, so a delayed Cancel cannot reach a replacement run', async () => {
        await render();
        await click(footerButton('Cancel'));
        await click(footerButton('Re-run'));
        await click(footerButton('Cancel'));

        const [first, second] = client.runCalls.map((call) => call.input.requestId);
        expect(first).toEqual(expect.any(String));
        expect(second).toEqual(expect.any(String));
        expect(second).not.toBe(first);
        expect(client.trpc.connectionDiagnostics.cancel.mutate.mock.calls).toEqual([
            [{ requestId: first }],
            [{ requestId: second }],
        ]);
    });

    it('sends the current run ID when toggling report identifiers, including during a re-run', async () => {
        await render();
        await finish('run-1');
        await click(buttons('Hide identifiers in the report')[0]);
        expect(client.trpc.connectionDiagnostics.setReportIdentifiers.mutate).toHaveBeenLastCalledWith({
            runId: 'run-1',
            hideIdentifiers: true,
        });
        await click(footerButton('Re-run'));
        await send({ type: 'started', runId: 'run-2', startedAt: Date.now(), rows: pending });
        await click(buttons('Show identifiers in the report')[0]);
        expect(client.trpc.connectionDiagnostics.setReportIdentifiers.mutate).toHaveBeenLastCalledWith({
            runId: 'run-2',
            hideIdentifiers: false,
        });
    });

    it('keeps a toggle made before the re-run started event and sends it with the new run ID', async () => {
        await render();
        await finish('run-1');
        await click(footerButton('Re-run'));
        await click(buttons('Hide identifiers in the report')[0]);
        expect(client.trpc.connectionDiagnostics.setReportIdentifiers.mutate).not.toHaveBeenCalled();
        await send({ type: 'started', runId: 'run-2', startedAt: Date.now(), rows: pending });
        expect(client.trpc.connectionDiagnostics.setReportIdentifiers.mutate).toHaveBeenLastCalledWith({
            runId: 'run-2',
            hideIdentifiers: true,
        });
    });

    it('shows report actions only for a finished run and passes its runId and the inline identifiers choice', async () => {
        await render();
        for (const name of ['Show report', 'Share report', 'Copy report', 'Save report…']) {
            expect(buttons(name)).toHaveLength(0);
        }
        expect(client.trpc.connectionDiagnostics.showDiagnostics.mutate).not.toHaveBeenCalled();
        expect(document.querySelector('[role="menu"]')).toBeNull();
        expect(client.trpc.connectionDiagnostics.copyReport.mutate).not.toHaveBeenCalled();
        expect(client.trpc.connectionDiagnostics.saveReport.mutate).not.toHaveBeenCalled();
        await finish('run-1');
        for (const name of ['Show report', 'Share report']) {
            expect(footerButton(name).getAttribute('aria-disabled')).not.toBe('true');
        }
        await click(footerButton('Show report'));
        expect(client.trpc.connectionDiagnostics.showDiagnostics.mutate).toHaveBeenCalledWith({
            runId: 'run-1',
            hideIdentifiers: false,
        });
        // Show report opens the report for the user's own reading: no share warning.
        expect(client.trpc.common.confirm.mutate).not.toHaveBeenCalled();
        expect(host.querySelector('[role="switch"]')).toBeNull();
        const hide = buttons('Hide identifiers in the report')[0];
        expect(hide?.classList.contains('fui-Link')).toBe(true);
        expect(hide?.getAttribute('aria-describedby')).toBe('connectivity-identifiers-note');
        expect(document.getElementById('connectivity-identifiers-note')?.textContent).toBe(
            'The report will include host and identity details.',
        );
        expect(host.textContent).toContain(
            'The report will include host and identity details. Hide identifiers in the report. Review the report before sharing.',
        );
        await click(hide);
        expect(client.trpc.connectionDiagnostics.setReportIdentifiers.mutate).toHaveBeenLastCalledWith({
            runId: 'run-1',
            hideIdentifiers: true,
        });
        expect(host.textContent).toContain(
            'The report will replace host and identity details with placeholders. Show identifiers in the report. Review the report before sharing.',
        );
        expect(buttons('Hide identifiers in the report')).toHaveLength(0);
        expect(buttons('Show identifiers in the report')).toHaveLength(1);
        await click(footerButton('Show report'));
        expect(client.trpc.connectionDiagnostics.showDiagnostics.mutate).toHaveBeenLastCalledWith({
            runId: 'run-1',
            hideIdentifiers: true,
        });
        await shareReport('Copy report to clipboard');
        await shareReport('Save report to file…');
        expect(client.trpc.connectionDiagnostics.copyReport.mutate).toHaveBeenCalledWith({
            runId: 'run-1',
            hideIdentifiers: true,
        });
        expect(client.trpc.connectionDiagnostics.saveReport.mutate).toHaveBeenCalledWith({
            runId: 'run-1',
            hideIdentifiers: true,
        });
        // With identifiers hidden there is nothing to warn about.
        expect(client.trpc.common.confirm.mutate).not.toHaveBeenCalled();
        await click(buttons('Show identifiers in the report')[0]);
        expect(host.textContent).toContain(
            'The report will include host and identity details. Hide identifiers in the report. Review the report before sharing.',
        );
        await shareReport('Copy report to clipboard');
        expect(client.trpc.common.confirm.mutate).toHaveBeenCalledTimes(1);
        expect(client.trpc.connectionDiagnostics.copyReport.mutate).toHaveBeenLastCalledWith({
            runId: 'run-1',
            hideIdentifiers: false,
            shareWarningOutcome: 'continued',
        });

        await click(footerButton('Re-run'));
        expect(buttons('Show report')).toHaveLength(0);
        expect(buttons('Share report')).toHaveLength(0);
        expect(client.runCalls[1].input).toEqual({
            timeoutProfile: 'default',
            trigger: 'rerun',
            requestId: anyRequestId,
        });
    });

    describe('share warning (decision 0040)', () => {
        const confirm = client.trpc.common.confirm.mutate;
        const copy = client.trpc.connectionDiagnostics.copyReport.mutate;
        const save = client.trpc.connectionDiagnostics.saveReport.mutate;

        it('warns before Copy and Save with identifiers, naming the action, and shares after Continue', async () => {
            await render();
            await finish('run-1');
            await shareReport('Copy report to clipboard');
            expect(confirm).toHaveBeenCalledWith({
                message: 'This report includes host and identity details.',
                detail: 'Host names, addresses and the user name are not hidden. To hide them, cancel, select Hide identifiers in the report, and then share again.',
                confirmLabel: 'Copy report',
                severity: 'warning',
            });
            expect(copy).toHaveBeenCalledWith({
                runId: 'run-1',
                hideIdentifiers: false,
                shareWarningOutcome: 'continued',
            });
            await settleAnnouncements();
            expect(announcements()).toContain('Report copied');

            await shareReport('Save report to file…');
            expect(confirm).toHaveBeenLastCalledWith(expect.objectContaining({ confirmLabel: 'Save report' }));
            expect(save).toHaveBeenCalledWith({
                runId: 'run-1',
                hideIdentifiers: false,
                shareWarningOutcome: 'continued',
            });
        });

        it('a cancelled warning shares nothing, shows no error and leaves the panel as it was', async () => {
            await render();
            await finish('run-1');
            confirm.mockResolvedValue({ confirmed: false });
            await settleAnnouncements();
            // The Share report menu's own attributes change as it opens and closes; the panel must not.
            const snapshot = (): [string, string | undefined] => [
                host.textContent ?? '',
                host.querySelector('main')?.innerHTML,
            ];
            const before = snapshot();
            await shareReport('Copy report to clipboard');
            await shareReport('Save report to file…');
            await settleAnnouncements();

            // The procedures only record the cancelled outcome; neither is asked to share.
            expect(copy.mock.calls).toEqual([
                [{ runId: 'run-1', hideIdentifiers: false, shareWarningOutcome: 'cancelled' }],
            ]);
            expect(save.mock.calls).toEqual([
                [{ runId: 'run-1', hideIdentifiers: false, shareWarningOutcome: 'cancelled' }],
            ]);
            expect(announcements()).not.toContain('Report copied');
            expect(host.textContent).not.toContain('Could not');
            expect(snapshot()).toEqual(before);
            // The menu returns focus to its trigger; the cancelled warning does not move it.
            expect(document.activeElement).toBe(footerButton('Share report'));
        });

        it('keeps an earlier report error when the warning is cancelled', async () => {
            await render();
            await finish('run-1');
            copy.mockRejectedValueOnce(new Error('Clipboard busy'));
            await shareReport('Copy report to clipboard');
            expect(host.textContent).toContain('Could not copy the report: Clipboard busy');
            confirm.mockResolvedValueOnce({ confirmed: false });
            await shareReport('Copy report to clipboard');
            expect(host.textContent).toContain('Could not copy the report: Clipboard busy');
        });

        it('shows an inline error when the warning itself cannot be shown', async () => {
            await render();
            await finish('run-1');
            confirm.mockRejectedValueOnce(new Error('No window'));
            await shareReport('Save report to file…');
            expect(save).not.toHaveBeenCalled();
            expect(host.textContent).toContain('Could not save the report: No window');
        });
    });

    it('keeps only Re-run, Show report and Share report in the finished footer and reveals both sharing choices', async () => {
        await render();
        await finish('run-1');
        const actions = footerButton('Re-run').parentElement;
        if (!actions) throw new Error('Missing footer actions');
        expect([...actions.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
            'Re-run',
            'Show report',
            'Share report',
        ]);
        expect(document.querySelector('[role="menu"]')).toBeNull();
        const share = footerButton('Share report');
        expect(share.getAttribute('aria-haspopup')).toBe('menu');
        await click(share);
        expect(share.getAttribute('aria-expanded')).toBe('true');
        expect([...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual([
            'Copy report to clipboard',
            'Save report to file…',
        ]);
        expect(client.trpc.connectionDiagnostics.copyReport.mutate).not.toHaveBeenCalled();
        expect(client.trpc.connectionDiagnostics.saveReport.mutate).not.toHaveBeenCalled();
    });

    it('shows nothing for a dismissed save and an inline error for a failed action', async () => {
        await render();
        await finish('run-1');
        const save = client.trpc.connectionDiagnostics.saveReport.mutate;
        save.mockRejectedValueOnce(
            Object.assign(new Error('Operation cancelled.'), { cause: { cause: { _isUserCancelledError: true } } }),
        );
        await shareReport('Save report to file…');
        expect(host.textContent).not.toContain('Could not save the report');
        save.mockRejectedValueOnce(new Error('Disk full'));
        await shareReport('Save report to file…');
        expect(host.textContent).toContain('Could not save the report: Disk full');
    });

    it('keeps report actions in the footer, without duplicating them in failed cards, and retries limited coverage', async () => {
        await render();
        await finish('run-1', { outcome: 'failed' });
        const card = (): Element | null => host.querySelector('#connectivity-result');
        expect(card()?.textContent).toContain('Connection failed');
        expect(card()?.textContent).toContain(
            'Contacting support? Use Share report at the bottom of the page to copy or save the report.',
        );
        expect(buttons('Retry with longer timeouts')).toHaveLength(0);
        expect(card()?.querySelectorAll('button')).toHaveLength(0);
        expect(buttons('Show report')).toHaveLength(1);
        expect(buttons('Share report')).toHaveLength(1);
        await shareReport('Copy report to clipboard');
        expect(client.trpc.connectionDiagnostics.copyReport.mutate).toHaveBeenCalledWith({
            runId: 'run-1',
            hideIdentifiers: false,
            shareWarningOutcome: 'continued',
        });

        await click(footerButton('Re-run'));
        await finish('run-2', {
            outcome: 'notTested',
            coverage: { limited: true, retryWouldHelp: true, connectionTimeoutLimited: true },
        });
        expect(card()?.textContent).toContain('Connection not tested');
        expect(card()?.textContent).toContain('This may wait until you cancel it.');
        expect(card()?.textContent).toContain('A timeout configured on the connection limited this check.');
        await click(buttons('Retry with longer timeouts')[0]);
        expect(client.runCalls[2].input).toEqual({
            timeoutProfile: 'longer',
            trigger: 'rerun',
            requestId: anyRequestId,
        });
        await finish('run-3', {
            outcome: 'connected',
            result: cardResult('connected'),
            coverage: { limited: true, retryWouldHelp: true, connectionTimeoutLimited: false },
        });
        expect(card()?.textContent).toContain('Connection successful');
        await click(buttons('Retry without diagnostic timeouts')[0]);
        expect(client.runCalls[3].input).toEqual({
            timeoutProfile: 'noDiagnosticTimeouts',
            trigger: 'rerun',
            requestId: anyRequestId,
        });
    });

    it('ignores late updates from a replaced run', async () => {
        await render();
        const first = client.runCalls[0];
        await send({ type: 'started', runId: 'run-1', startedAt: 1, rows: pending }, first);
        await click(footerButton('Cancel'));
        await click(footerButton('Re-run'));
        const second = client.runCalls[1];
        await send(
            {
                type: 'finished',
                runId: 'run-1',
                finishedAt: 2,
                rows: connected,
                outcome: 'connected',
                result: cardResult('connected'),
                coverage,
            },
            first,
        );
        expect(host.querySelector('#connectivity-result')).toBeNull();
        await send({ type: 'started', runId: 'run-2', startedAt: 3, rows: pending }, second);
        await send({ type: 'rows', runId: 'run-1', rows: connected }, second);
        expect(items()[0].textContent).toContain('pending');
        await send(
            {
                type: 'finished',
                runId: 'run-1',
                finishedAt: 4,
                rows: connected,
                outcome: 'failed',
                result: cardResult('failed'),
                coverage,
            },
            second,
        );
        expect(host.querySelector('#connectivity-result')).toBeNull();
        await send(
            {
                type: 'finished',
                runId: 'run-2',
                finishedAt: 5,
                rows: connected,
                outcome: 'connected',
                result: cardResult('connected'),
                coverage,
            },
            second,
        );
        expect(host.querySelector('#connectivity-result')?.textContent).toContain('Connection successful');
    });

    it('resets the same eight rows to pending on Re-run, then streams the second run into them', async () => {
        await render();
        const failedRows = rowsWith(connected, [
            { id: 'networkConnection', status: 'error', segments: [{ kind: 'reachable', reachable: 0, total: 1 }] },
            {
                id: 'secureConnection',
                status: 'skipped',
                segments: [{ kind: 'notChecked', reason: 'dependencyFailed', becauseRow: 'networkConnection' }],
            },
        ]);
        await finish('run-1', { outcome: 'failed', result: cardResult('failed'), rows: failedRows });
        const rowsBefore = items();
        expect(host.querySelector('#connectivity-result')?.textContent).toContain('Connection failed');

        await click(footerButton('Re-run'));
        expect(client.runCalls[1].input).toEqual({
            timeoutProfile: 'default',
            trigger: 'rerun',
            requestId: anyRequestId,
        });
        expect(items()).toHaveLength(8);
        items().forEach((item, index) => {
            expect(item).toBe(rowsBefore[index]);
            expect(item.textContent).toContain(labels[index]);
            expect(item.textContent).toContain('pending');
            expect(item.textContent).not.toMatch(/·|Checking…|Not checked/);
        });
        expect(host.querySelector('#connectivity-result')).toBeNull();
        expect(footerButton('Cancel')).toBeDefined();

        await send({ type: 'started', runId: 'run-2', startedAt: 3, rows: pending });
        await send({
            type: 'rows',
            runId: 'run-2',
            rows: rowsWith(pending, [
                connected[0],
                { id: 'connectionSettings', status: 'active', segments: [{ kind: 'checking' }] },
            ]),
        });
        expect(items()[0].textContent).toContain('Running on this computer · Linux · x64');
        expect(items()[1].textContent).toContain('Checking…');
        expect(items()[3].textContent).toContain('pending');
        expect(host.querySelector('#connectivity-result')).toBeNull();

        await send({
            type: 'finished',
            runId: 'run-2',
            finishedAt: 4,
            rows: connected,
            outcome: 'connected',
            result: cardResult('connected'),
            coverage,
        });
        items().forEach((item, index) => {
            expect(item).toBe(rowsBefore[index]);
            expect(item.textContent).toContain(labels[index]);
        });
        expect(items()[3].textContent).toContain('3 of 3 hosts reachable · Port 10260');
        const list = host.querySelector('#connectivity-checks');
        const card = host.querySelector('#connectivity-result');
        expect(list && card && list.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(card?.textContent).toContain('Connection successful');
    });

    it('never renders finding codes, AADSTS codes or timings', async () => {
        await render();
        await finish('run-1', {
            outcome: 'failed',
            rows: rowsWith(connected, [
                {
                    id: 'serverAddress',
                    status: 'error',
                    segments: [
                        { kind: 'finding', title: 'Host name not found', target: 'db-host-1' },
                        { kind: 'resolved', resolved: 0, total: 1 },
                    ],
                },
                {
                    id: 'networkConnection',
                    status: 'skipped',
                    segments: [{ kind: 'notChecked', reason: 'dependencyFailed', becauseRow: 'serverAddress' }],
                },
                { id: 'secureConnection', status: 'skipped', segments: [{ kind: 'notApplicable', reason: 'tlsOff' }] },
                {
                    id: 'serverResponse',
                    status: 'error',
                    segments: [{ kind: 'timedOut' }, { kind: 'clockOffset', offsetMs: 720_000 }],
                },
                {
                    id: 'authentication',
                    status: 'skipped',
                    segments: [{ kind: 'notChecked', reason: 'inputUnavailable' }],
                },
                {
                    id: 'databaseAccess',
                    status: 'skipped',
                    segments: [{ kind: 'notChecked', reason: 'runTimeoutExceeded' }],
                },
            ]),
            coverage: { limited: true, retryWouldHelp: true, connectionTimeoutLimited: true },
        });
        const text = host.textContent ?? '';
        expect(text).toContain('Host name not found (db-host-1)');
        expect(text).toContain('Not checked: Server address (DNS) did not succeed');
        expect(text).toContain("This computer's clock is 12 min behind");
        expect(text).not.toMatch(/\b[a-z]+\.[a-z][A-Za-z]+\b/);
        expect(text).not.toContain('AADSTS');
        expect(text).not.toMatch(/\d\s?ms\b/);
    });

    it('announces each settled row once and the result card, but not the Checking… detail', async () => {
        await render();
        await send({ type: 'started', runId: 'run-1', startedAt: 1, rows: pending });
        await send({
            type: 'rows',
            runId: 'run-1',
            rows: rowsWith(pending, [
                connected[0],
                connected[1],
                { id: 'serverAddress', status: 'active', segments: [{ kind: 'checking' }] },
            ]),
        });
        await settleAnnouncements();
        expect(announcements()).toEqual(['Diagnosis setup, done', 'Connection settings, done']);
        await send({
            type: 'rows',
            runId: 'run-1',
            rows: rowsWith(pending, [connected[0], connected[1], connected[2]]),
        });
        await send({
            type: 'finished',
            runId: 'run-1',
            finishedAt: 2,
            rows: connected,
            outcome: 'connected',
            result: cardResult('connected'),
            coverage,
        });
        await settleAnnouncements();
        expect(announcements()).toEqual([...labels.map((label) => `${label}, done`), 'Connection successful']);
        expect(announcements().join(' ')).not.toContain('Checking');
    });

    it('announces the card title with the row it stopped at, once', async () => {
        await render();
        await send({ type: 'started', runId: 'run-1', startedAt: 1, rows: pending });
        await send({
            type: 'finished',
            runId: 'run-1',
            finishedAt: 2,
            rows: connected,
            outcome: 'failed',
            result: { ...cardResult('failed'), stoppedAtRow: 'authentication' },
            coverage,
        });
        await settleAnnouncements();
        expect(announcements().filter((text) => text.startsWith('Connection failed'))).toEqual([
            'Connection failed at Authentication',
        ]);
        expect(host.querySelector('#connectivity-result')?.textContent).toContain(
            'Connection failed at Authentication',
        );
    });

    it('announces "Report copied" only after the copy succeeds, and again for a second copy', async () => {
        await render();
        await finish('run-1', { outcome: 'failed', result: cardResult('failed') });
        await settleAnnouncements();
        const copy = client.trpc.connectionDiagnostics.copyReport.mutate;
        copy.mockRejectedValueOnce(new Error('Clipboard unavailable'));
        await shareReport('Copy report to clipboard');
        await settleAnnouncements();
        expect(announcements()).not.toContain('Report copied');
        expect(host.textContent).toContain('Could not copy the report: Clipboard unavailable');

        let resolveCopy: () => void = () => undefined;
        copy.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    resolveCopy = resolve;
                }),
        );
        await shareReport('Copy report to clipboard');
        await settleAnnouncements();
        expect(announcements()).not.toContain('Report copied');
        await act(async () => resolveCopy());
        await settleAnnouncements();
        const copiedRegion = (): Element | undefined =>
            [...host.querySelectorAll('[role="status"]')].find((region) => region.textContent === 'Report copied');
        const first = copiedRegion();
        expect(first).toBeDefined();

        await shareReport('Copy report to clipboard');
        await settleAnnouncements();
        expect(announcements().filter((text) => text === 'Report copied')).toHaveLength(1);
        // A fresh live region, so screen readers hear the repeated message.
        expect(copiedRegion()).not.toBe(first);
        expect(client.trpc.connectionDiagnostics.copyReport.mutate).toHaveBeenCalledTimes(3);
    });

    it('offers a re-run from a second open only when no run is active', async () => {
        await render();
        await act(async () => client.panelHandlers[0].onData({ type: 'offerRerun' }));
        expect(host.textContent).not.toContain('This diagnostic page was already open.');
        await finish('run-1');
        await act(async () => client.panelHandlers[0].onData({ type: 'offerRerun' }));
        expect(host.textContent).toContain('This diagnostic page was already open. Run the check again?');
        const offer = buttons('Re-run').find((button) => button.closest('.fui-MessageBar'));
        if (!offer) throw new Error('Missing offer Re-run');
        await click(offer);
        expect(client.runCalls[1].input).toEqual({
            timeoutProfile: 'default',
            trigger: 'rerun',
            requestId: anyRequestId,
        });
        expect(host.textContent).not.toContain('This diagnostic page was already open.');
    });

    describe('focus when a focused control disappears', () => {
        async function focus(element: HTMLElement): Promise<void> {
            await act(async () => {
                element.focus();
            });
            expect(document.activeElement).toBe(element);
        }

        async function finishWithRetries(runId: string): Promise<void> {
            await finish(runId, {
                outcome: 'notTested',
                result: cardResult('notTested'),
                coverage: { limited: true, retryWouldHelp: true, connectionTimeoutLimited: false },
            });
        }

        it('keeps focus on the same primary button when Cancel changes to Re-run', async () => {
            await render();
            await send({ type: 'started', runId: 'run-1', startedAt: 1, rows: pending });
            const primary = footerButton('Cancel');
            await focus(primary);
            await click(primary);
            expect(buttons('Cancel')).toHaveLength(0);
            expect(footerButton('Re-run')).toBe(primary);
            expect(document.activeElement).toBe(footerButton('Re-run'));
        });

        it.each(['finished', 'cancelled', 'failed'] as const)(
            'moves focus to Re-run when the run ends as %s while Cancel has focus',
            async (ending) => {
                await render();
                await send({ type: 'started', runId: 'run-1', startedAt: 1, rows: pending });
                await focus(footerButton('Cancel'));
                if (ending === 'finished') {
                    await send({
                        type: 'finished',
                        runId: 'run-1',
                        finishedAt: 2,
                        rows: connected,
                        outcome: 'connected',
                        result: cardResult('connected'),
                        coverage,
                    });
                } else if (ending === 'cancelled') {
                    await send({ type: 'cancelled', runId: 'run-1', rows: pending });
                } else {
                    await send({ type: 'failed', runId: 'run-1', reason: 'unexpected' });
                }
                expect(buttons('Cancel')).toHaveLength(0);
                expect(document.activeElement).toBe(footerButton('Re-run'));
            },
        );

        it.each(['Retry with longer timeouts', 'Retry without diagnostic timeouts'])(
            'moves focus to Cancel when "%s" starts a run and the card disappears',
            async (label) => {
                await render();
                await finishWithRetries('run-1');
                const retry = buttons(label)[0];
                await focus(retry);
                await click(retry);
                expect(retry.isConnected).toBe(false);
                expect(document.activeElement).toBe(footerButton('Cancel'));
            },
        );

        it.each(['Dismiss', 'Re-run'])(
            'moves focus to the primary action when the re-run offer closes through %s',
            async (label) => {
                await render();
                await finish('run-1');
                await act(async () => client.panelHandlers[0].onData({ type: 'offerRerun' }));
                const offerButton = [...host.querySelectorAll<HTMLButtonElement>('.fui-MessageBar button')].find(
                    (button): boolean => (button.getAttribute('aria-label') ?? button.textContent) === label,
                );
                if (!offerButton) throw new Error(`Missing offer ${label}`);
                await focus(offerButton);
                await click(offerButton);
                expect(host.textContent).not.toContain('This diagnostic page was already open.');
                expect(document.activeElement).toBe(footerButton(label === 'Re-run' ? 'Cancel' : 'Re-run'));
            },
        );

        it('moves focus to Re-run when a report error is dismissed', async () => {
            await render();
            await finish('run-1');
            client.trpc.connectionDiagnostics.copyReport.mutate.mockRejectedValueOnce(new Error('Clipboard busy'));
            await shareReport('Copy report to clipboard');
            const dismiss = host.querySelector<HTMLButtonElement>('.fui-MessageBar button[aria-label="Dismiss"]');
            if (!dismiss) throw new Error('Missing report error Dismiss');
            await focus(dismiss);
            await click(dismiss);
            expect(host.textContent).not.toContain('Could not copy the report');
            expect(document.activeElement).toBe(footerButton('Re-run'));
        });

        it('leaves focus on the header action through a whole run and a re-run', async () => {
            await render();
            const feedback = buttons('Give Feedback')[0];
            await focus(feedback);
            await finishWithRetries('run-1');
            expect(document.activeElement).toBe(feedback);
            await click(footerButton('Re-run'));
            await focus(feedback);
            await send({ type: 'cancelled', runId: 'run-2', rows: pending });
            expect(document.activeElement).toBe(feedback);
        });

        it('leaves focus where it is when streamed updates and the result arrive', async () => {
            await render();
            const identifiersLink = buttons('Hide identifiers in the report')[0];
            await focus(identifiersLink);
            await finishWithRetries('run-1');
            expect(document.activeElement).toBe(identifiersLink);
            await click(identifiersLink);
            expect(document.activeElement).toBe(buttons('Show identifiers in the report')[0]);
            const showReport = footerButton('Show report');
            await focus(showReport);
            await click(showReport);
            expect(document.activeElement).toBe(showReport);
        });
    });
    describe('row details (WI-18 prototype)', () => {
        const rawHost = 'fc-0123-000.c-stage0.example.test';
        const dnsDetails: NonNullable<PanelRow['details']> = {
            findings: [
                {
                    severity: 'info',
                    title: 'Public address for this Azure host name',
                    explanation:
                        "The name goes through Azure's private-link alias and resolves to a public address. That is normal outside the cluster's private network.",
                    targets: [rawHost],
                },
            ],
            evidence: [
                {
                    kind: 'dnsHost',
                    host: rawHost,
                    cnameChain: ['fc-0123-000.privatelink.example.test'],
                    system: [{ address: '203.0.113.24', family: 4, addressClass: 'public' }],
                    direct: [{ address: '203.0.113.24', family: 4, addressClass: 'public' }],
                    systemFailed: false,
                    directFailed: false,
                    agree: true,
                },
            ],
        };
        const withDnsInfo = rowsWith(connected, [
            {
                id: 'serverAddress',
                status: 'done',
                segments: [
                    { kind: 'srvHosts', count: 1 },
                    { kind: 'resolved', resolved: 1, total: 1 },
                ],
                details: dnsDetails,
            },
        ]);

        function toggles(): HTMLButtonElement[] {
            return [...host.querySelectorAll<HTMLButtonElement>('#connectivity-checks button[aria-expanded]')];
        }

        function dnsToggle(): HTMLButtonElement {
            const toggle = toggles().find(
                (button): boolean => button.getAttribute('aria-label') === 'Details for Server address (DNS)',
            );
            if (!toggle) {
                throw new Error('Missing DNS details toggle');
            }
            return toggle;
        }

        function region(toggle: HTMLButtonElement): HTMLElement {
            const element = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
            if (!element) {
                throw new Error('Missing details region');
            }
            return element;
        }

        async function finishWithDnsInfo(runId: string): Promise<void> {
            await send({ type: 'started', runId, startedAt: 1, rows: pending });
            await send({
                type: 'finished',
                runId,
                finishedAt: 2,
                rows: withDnsInfo,
                outcome: 'connected',
                result: cardResult('connected'),
                coverage,
            });
        }

        it.each([
            ['AzureCloud', 'Azure'],
            ['AzureUSGovernment', 'Azure US Government'],
            ['AzureChinaCloud', 'Azure China'],
            ['custom', 'Custom cloud'],
        ] as const)('shows %s sign-in and cluster clouds in Details, not collapsed evidence', async (cloud, label) => {
            await render();
            await send({ type: 'started', runId: 'run-1', startedAt: 1, rows: pending });
            await send({
                type: 'finished', runId: 'run-1', finishedAt: 2,
                rows: rowsWith(connected, [{
                    id: 'authentication', status: 'done', segments: [{ kind: 'authMethod', method: 'entraId' }],
                    details: { findings: [], evidence: [{
                        kind: 'auth', method: 'entraId', user: 'user@example.com',
                        signInCloud: cloud, clusterCloud: 'AzureChinaCloud',
                        stages: [{ stage: 'getToken', outcome: 'done' }],
                    }] },
                }]),
                outcome: 'connected', result: cardResult('connected'), coverage,
            });
            const toggle = toggles().find(
                (button): boolean => button.getAttribute('aria-label') === 'Details for Authentication',
            );
            if (!toggle) {
                throw new Error('Missing Authentication details toggle');
            }
            expect(toggle.closest('[role="listitem"]')?.textContent).not.toContain('Sign-in cloud');
            await click(toggle);
            expect(region(toggle).textContent).toContain(
                `Signed in asuser@example.comSign-in cloud${label}Cluster cloudAzure ChinaSteps`,
            );
        });

        it('WI-27: labels each command outcome, telling sign-in and permission refusals from unsupported commands', async () => {
            await render();
            await send({ type: 'started', runId: 'run-1', startedAt: 1, rows: pending });
            await send({
                type: 'finished',
                runId: 'run-1',
                finishedAt: 2,
                rows: rowsWith(connected, [
                    {
                        id: 'databaseAccess',
                        status: 'warning',
                        segments: [{ kind: 'ping', ms: 93 }, { kind: 'listingNeedsSignIn' }],
                        details: {
                            findings: [
                                {
                                    severity: 'warning',
                                    title: 'Sign-in required to use this connection',
                                    explanation: 'The server answered, but it requires sign-in.',
                                },
                            ],
                            evidence: [
                                {
                                    kind: 'access',
                                    commands: [
                                        { command: 'ping', outcome: 'ok' },
                                        { command: 'connectionStatus', outcome: 'unsupported' },
                                        { command: 'listDatabases', outcome: 'signInRequired' },
                                        { command: 'buildInfo', outcome: 'denied' },
                                    ],
                                    pingMs: 93,
                                },
                            ],
                        },
                    },
                ]),
                outcome: 'connected',
                result: cardResult('connected'),
                coverage,
            });
            const toggle = toggles().find(
                (button): boolean => button.getAttribute('aria-label') === 'Details for Database access',
            );
            if (!toggle) {
                throw new Error('Missing Database access details toggle');
            }
            expect(toggle.closest('[role="listitem"]')?.textContent).toContain(
                'Ping 93 ms · Listing databases needs sign-in',
            );
            await click(toggle);
            const text = region(toggle).textContent ?? '';
            for (const line of [
                'ping succeeded',
                'connectionStatus not supported',
                'listDatabases requires sign-in',
                'buildInfo not allowed',
            ]) {
                expect(text).toContain(line);
            }
            expect(text).not.toMatch(/denied|\b(?:13|18|59|115)\b|Unauthorized|CommandNotFound/);
        });

        it('says how long each host took and when each attempt connected or failed, the TLS version as people write it and a formatted ping (0050, WI-33)', async () => {
            const hostA = 'node-a.example.test';
            const hostB = 'node-b.example.test';
            await render();
            await send({ type: 'started', runId: 'run-1', startedAt: 1, rows: pending });
            await send({
                type: 'finished',
                runId: 'run-1',
                finishedAt: 2,
                rows: rowsWith(connected, [
                    {
                        id: 'serverAddress',
                        status: 'done',
                        segments: [{ kind: 'resolved', resolved: 1, total: 1 }],
                        details: {
                            findings: [],
                            evidence: [
                                {
                                    kind: 'dnsHost',
                                    host: hostA,
                                    cnameChain: [],
                                    system: [{ address: '203.0.113.10', family: 4, addressClass: 'public' }],
                                    direct: [{ address: '203.0.113.10', family: 4, addressClass: 'public' }],
                                    systemFailed: false,
                                    directFailed: false,
                                    agree: true,
                                },
                            ],
                        },
                    },
                    {
                        id: 'networkConnection',
                        status: 'error',
                        segments: [{ kind: 'reachable', reachable: 1, total: 2 }],
                        details: {
                            findings: [],
                            evidence: [
                                {
                                    kind: 'tcpHost',
                                    host: hostA,
                                    port: 27017,
                                    connectedAddress: '203.0.113.10',
                                    connectMs: 23,
                                    failedAddresses: [{ address: '2001:db8::5', connectMs: 3000 }],
                                    durationMs: 3024,
                                },
                                {
                                    kind: 'tcpHost',
                                    host: hostB,
                                    port: 27017,
                                    failedAddresses: [
                                        { address: '203.0.113.11', connectMs: 2 },
                                        { address: '203.0.113.12' },
                                    ],
                                    durationMs: 5,
                                },
                            ],
                        },
                    },
                    {
                        id: 'secureConnection',
                        status: 'done',
                        segments: [{ kind: 'certificateTrusted' }],
                        details: {
                            findings: [],
                            evidence: [
                                { kind: 'tlsHost', host: hostA, protocol: 'TLSv1.3', trusted: true, durationMs: 61 },
                                { kind: 'tlsHost', host: hostB, protocol: 'TLSv1.2', trusted: true, durationMs: 75 },
                            ],
                        },
                    },
                    {
                        id: 'serverResponse',
                        status: 'done',
                        segments: [{ kind: 'answeredBeforeSignIn' }],
                        details: {
                            findings: [],
                            evidence: [
                                {
                                    kind: 'serverHost',
                                    host: hostA,
                                    command: 'hello',
                                    passwordMechanisms: ['SCRAM-SHA-256'],
                                },
                            ],
                        },
                    },
                    {
                        id: 'databaseAccess',
                        status: 'done',
                        segments: [{ kind: 'ping', ms: 0.4 }],
                        details: {
                            findings: [],
                            evidence: [
                                { kind: 'access', commands: [{ command: 'ping', outcome: 'ok' }], pingMs: 1234 },
                            ],
                        },
                    },
                ]),
                outcome: 'connected',
                result: cardResult('connected'),
                coverage,
            });
            const facts = async (label: string): Promise<string[]> => {
                const toggle = toggles().find(
                    (button): boolean => button.getAttribute('aria-label') === `Details for ${label}`,
                );
                if (!toggle) {
                    throw new Error(`Missing ${label} details toggle`);
                }
                await click(toggle);
                return [...region(toggle).querySelectorAll('dt')].map(
                    (term): string =>
                        `${term.textContent ?? ''}: ${(term.nextElementSibling?.textContent ?? '').replace(/\s+/g, ' ').trim()}`,
                );
            };

            // A single-host row has no per-host time: the row's badge already says it.
            expect((await facts('Server address (DNS)')).join('\n')).not.toMatch(/Took|Time/);
            const network = await facts('Network connection (TCP)');
            expect(network).toEqual(
                expect.arrayContaining([
                    `Connected to: 203.0.113.10:27017 in ${formatDuration(23)}`,
                    `Could not connect to: [2001:db8::5]:27017 after ${formatDuration(3000)}`,
                    `Took: ${formatDuration(3024)}`,
                    `Could not connect to: 203.0.113.11:27017 after ${formatDuration(2)}203.0.113.12:27017`,
                    `Took: ${formatDuration(5)}`,
                ]),
            );
            expect(await facts('Secure connection (TLS)')).toEqual(
                expect.arrayContaining([
                    'Protocol: TLS 1.3',
                    `Took: ${formatDuration(61)}`,
                    'Protocol: TLS 1.2',
                    `Took: ${formatDuration(75)}`,
                ]),
            );
            expect((await facts('Server greeting (hello)')).join('\n')).not.toMatch(/Took|Time/);
            expect(await facts('Database access')).toContain(`Ping: ${formatDuration(1234)}`);
            const text = host.textContent ?? '';
            expect(text).toContain('Ping < 1 ms');
            expect(text).not.toContain('TLSv1');
            // A time never carries a slow or fast rating.
            expect(text).not.toMatch(/\b(?:slow|fast)\b/i);
        });

        it('offers a disclosure only on settled rows that have details', async () => {
            await render();
            await send({ type: 'started', runId: 'run-1', startedAt: 1, rows: pending });
            // A pending or active row never offers details, even if the host sent some.
            await send({
                type: 'rows',
                runId: 'run-1',
                rows: rowsWith(pending, [
                    { id: 'serverAddress', status: 'active', segments: [{ kind: 'checking' }], details: dnsDetails },
                ]),
            });
            expect(toggles()).toHaveLength(0);

            await send({
                type: 'finished',
                runId: 'run-1',
                finishedAt: 2,
                rows: withDnsInfo,
                outcome: 'connected',
                result: cardResult('connected'),
                coverage,
            });
            expect(toggles().map((toggle) => toggle.getAttribute('aria-label'))).toEqual([
                'Details for Server address (DNS)',
            ]);
            expect(dnsToggle().textContent).toBe('Details');
            expect(host.querySelector('#connectivity-result')?.textContent).not.toContain('warning');
            expect(host.textContent).toContain('Connection successful');
        });

        it('expands in place without moving focus, into a region named by its toggle', async () => {
            await render();
            await finishWithDnsInfo('run-1');
            const toggle = dnsToggle();
            const details = region(toggle);
            expect(toggle.getAttribute('aria-expanded')).toBe('false');
            expect(details.hasAttribute('inert')).toBe(true);
            expect(details.childElementCount).toBe(0);
            expect(details.getAttribute('role')).toBe('region');
            expect(details.getAttribute('aria-labelledby')).toBe(toggle.id);
            const description = document.getElementById(toggle.getAttribute('aria-describedby') ?? '');
            expect(description?.textContent).toBe('Information: Public address for this Azure host name');

            await act(async () => {
                toggle.focus();
            });
            await click(toggle);
            expect(toggle.getAttribute('aria-expanded')).toBe('true');
            expect(details.hasAttribute('inert')).toBe(false);
            expect(document.activeElement).toBe(toggle);
            expect(details.textContent).toContain('Public address for this Azure host name');
            expect(details.textContent).not.toContain('Next:');
            expect(details.textContent).toContain('fc-0123-000.privatelink.example.test');
            expect(details.textContent).toContain('203.0.113.24 (IPv4, public)');
            // Agreeing lookups are one answer; nothing names how the names were looked up.
            expect(details.textContent).toContain('Addresses203.0.113.24 (IPv4, public)');
            expect(details.textContent).not.toMatch(/resolver|lookup|c-ares/i);

            await click(toggle);
            expect(toggle.getAttribute('aria-expanded')).toBe('false');
            expect(details.hasAttribute('inert')).toBe(true);
            expect(details.childElementCount).toBe(0);
            expect(document.activeElement).toBe(toggle);
        });

        it('puts the toggle at the end of the evidence line and keeps the label a plain heading (WI-19)', async () => {
            await render();
            await finishWithDnsInfo('run-1');
            const toggle = dnsToggle();
            const row = toggle.closest('[role="listitem"]');
            const [labelLine, evidenceLine] = [...(row?.lastElementChild?.children ?? [])];
            expect(labelLine.querySelector('button')).toBeNull();
            expect(labelLine.textContent).toBe('Server address (DNS), done');
            expect(evidenceLine.lastElementChild).toBe(toggle);
            expect(evidenceLine.textContent).toBe('SRV record lists 1 host · All resolve Details');
        });

        it('shows full identifiers, and toggling Hide identifiers changes nothing in the panel (0040)', async () => {
            await render();
            await finishWithDnsInfo('run-1');
            await click(dnsToggle());
            const panel = (): string => host.querySelector('main')?.textContent ?? '';
            const before = panel();
            expect(region(dnsToggle()).textContent).toContain(rawHost);
            expect(region(dnsToggle()).textContent).toContain('203.0.113.24 (IPv4, public)');

            await click(buttons('Hide identifiers in the report')[0]);
            expect(panel()).toBe(before);
            expect(region(dnsToggle()).textContent).toContain(rawHost);
            expect(dnsToggle().getAttribute('aria-expanded')).toBe('true');

            await click(buttons('Show identifiers in the report')[0]);
            expect(panel()).toBe(before);
        });

        it('collapses every row on a new run and moves focus from a vanished toggle to the primary action', async () => {
            await render();
            await finishWithDnsInfo('run-1');
            const toggle = dnsToggle();
            await click(toggle);
            await act(async () => {
                toggle.focus();
            });
            // A programmatic click starts the re-run without taking focus from the toggle.
            await click(footerButton('Re-run'));
            expect(toggle.isConnected).toBe(false);
            expect(document.activeElement).toBe(footerButton('Cancel'));

            await finishWithDnsInfo('run-2');
            expect(dnsToggle().getAttribute('aria-expanded')).toBe('false');
        });
    });

    describe('pacing (decision 0043)', () => {
        beforeEach(() => {
            vi.useFakeTimers();
            client.configuration.stepPacing = { stepMs: 300, jitterMs: 0 };
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        async function advance(ms: number): Promise<void> {
            await act(async () => {
                vi.advanceTimersByTime(ms);
            });
        }

        function statuses(): string[] {
            return items().map((item): string => item.getAttribute('data-status') ?? '');
        }

        /** A run whose checks all finish at once: setup settles with the next row checking, then the rest. */
        async function instantRun(runId: string): Promise<void> {
            await send({ type: 'started', runId, startedAt: 1, rows: pending });
            await send({
                type: 'rows',
                runId,
                rows: rowsWith(pending, [
                    connected[0],
                    { id: 'connectionSettings', status: 'active', segments: [{ kind: 'checking' }] },
                ]),
            });
            await send({
                type: 'finished',
                runId,
                finishedAt: 2,
                rows: connected,
                outcome: 'connected',
                result: cardResult('connected'),
                coverage,
            });
        }

        it('settles one row per step, then the card; Cancel stays and report actions wait for the card', async () => {
            await render();
            await instantRun('run-1');
            expect(statuses()).toEqual(Array<string>(8).fill('pending'));
            expect(host.querySelector('#connectivity-result')).toBeNull();

            await advance(300);
            expect(statuses().slice(0, 3)).toEqual(['done', 'active', 'pending']);
            expect(items()[1].textContent).toContain('Checking…');
            await advance(300);
            expect(statuses().slice(0, 3)).toEqual(['done', 'done', 'pending']);
            await advance(150);
            expect(announcements()).toEqual(['Diagnosis setup, done', 'Connection settings, done']);

            // The dynamic list needs no running timer while paced rows catch up.
            await advance(1_400);
            expect(host.textContent).toContain('Checking the connection…');
            expect(host.textContent).not.toContain('Elapsed');
            expect(footerButton('Cancel')).toBeDefined();
            expect(buttons('Show report')).toHaveLength(0);
            expect(buttons('Share report')).toHaveLength(0);

            await advance(2_400 - 2_150);
            expect(statuses()).toEqual(Array<string>(8).fill('done'));
            expect(host.querySelector('#connectivity-result')).toBeNull();
            expect(footerButton('Cancel')).toBeDefined();

            await advance(300);
            expect(host.querySelector('#connectivity-result')?.textContent).toContain('Connection successful');
            expect(buttons('Cancel')).toHaveLength(0);
            expect(buttons('Show report')).toHaveLength(1);
            await advance(150);
            expect(announcements()).toEqual([...labels.map((label) => `${label}, done`), 'Connection successful']);
        });

        it('Cancel shows the rows that already settled at once and cancels the run', async () => {
            await render();
            await send({ type: 'started', runId: 'run-1', startedAt: 1, rows: pending });
            await send({
                type: 'rows',
                runId: 'run-1',
                rows: rowsWith(pending, [
                    connected[0],
                    connected[1],
                    connected[2],
                    { id: 'networkConnection', status: 'active', segments: [{ kind: 'checking' }] },
                ]),
            });
            expect(statuses()[0]).toBe('pending');
            const cancel = footerButton('Cancel');
            await act(async () => {
                cancel.focus();
            });
            await click(cancel);
            expect(statuses()).toEqual(['done', 'done', 'done', 'pending', 'pending', 'pending', 'pending', 'pending']);
            expect(host.querySelector('#connectivity-result')?.textContent).toContain('Diagnosis cancelled');
            expect(client.trpc.connectionDiagnostics.cancel.mutate).toHaveBeenCalledTimes(1);
            expect(document.activeElement).toBe(footerButton('Re-run'));
            // The cancelled run's later updates never show, however long the timers run.
            await send({ type: 'rows', runId: 'run-1', rows: connected });
            await advance(5_000);
            expect(statuses()[3]).toBe('pending');
            expect(vi.getTimerCount()).toBe(0);
        });

        it('Cancel after the run already finished shows its result and cancels nothing', async () => {
            await render();
            await instantRun('run-1');
            await advance(300);
            await click(footerButton('Cancel'));
            expect(statuses()).toEqual(Array<string>(8).fill('done'));
            expect(host.querySelector('#connectivity-result')?.textContent).toContain('Connection successful');
            expect(buttons('Show report')).toHaveLength(1);
            expect(client.trpc.connectionDiagnostics.cancel.mutate).not.toHaveBeenCalled();
        });

        it('stops pacing on unmount', async () => {
            await render();
            await instantRun('run-1');
            await act(async () => root.unmount());
            expect(vi.getTimerCount()).toBe(0);
            // The shared afterEach unmounts again.
            host.remove();
            await render();
        });
    });
});
