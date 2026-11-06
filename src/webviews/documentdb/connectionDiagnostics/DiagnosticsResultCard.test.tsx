/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client'; // eslint-disable-line import/no-internal-modules

import { Links } from '../../../constants';
import { type ResultCardData } from './connectionDiagnosticsTypes';
import { cardIssues, DiagnosticsResultCard, resultCardTitle, type RunResult } from './DiagnosticsResultCard';
import { type PanelFindingDetail, type PanelRow } from './panelTypes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no ResizeObserver; Fluent's MessageBar observes its own width to reflow its actions.
class NoopResizeObserver {
    public observe(): void {}
    public unobserve(): void {}
    public disconnect(): void {}
}
window.ResizeObserver ??= NoopResizeObserver;

vi.mock('@vscode/l10n', () => ({
    t: (message: string, ...args: unknown[]): string =>
        args.reduce<string>((result, value, index) => result.replace(`{${index}}`, String(value)), message),
}));

const FIREWALL =
    'A firewall or IP allowlist may be blocking this connection. Check access from the computer or remote host where these checks ran, including VPN and network rules.';
const SUPPORT = 'Contacting support? Use Share report at the bottom of the page to copy or save the report.';
const coverage = { limited: false, retryWouldHelp: false, connectionTimeoutLimited: false };

type FinishedResult = Extract<RunResult, { kind: 'finished' }>;

function card(outcome: ResultCardData['outcome'], extra: Partial<ResultCardData> = {}): FinishedResult {
    return {
        kind: 'finished',
        outcome,
        coverage,
        card: {
            outcome,
            firewallHint: false,
            earlierSignInFailure: false,
            runTimeoutBeforeAttempt: false,
            authenticated: outcome === 'connected',
            ...extra,
        },
    };
}

const mounted: { host: HTMLElement; root: Root }[] = [];

async function render(
    result: RunResult,
    rows: readonly PanelRow[] = [],
    onOpenUrl?: (url: string) => void,
): Promise<HTMLElement> {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ host, root });
    await act(async () => {
        root.render(<DiagnosticsResultCard result={result} rows={rows} onRetry={vi.fn()} onOpenUrl={onOpenUrl} />);
    });
    return host;
}

/** The headline and each message line, in reading order. */
/** The card's text lines; separators are layout, not lines. */
function lines(host: HTMLElement): string[] {
    return [...(host.querySelector('.fui-MessageBarBody')?.children ?? [])]
        .filter((element) => element.getAttribute('role') !== 'separator')
        .map((element) => element.textContent ?? '');
}

function headline(host: HTMLElement): HTMLElement | null {
    return host.querySelector('[role="heading"]');
}

function row(id: PanelRow['id'], status: PanelRow['status'], findings: PanelFindingDetail[] = []): PanelRow {
    return { id, status, segments: [], ...(findings.length > 0 ? { details: { findings, evidence: [] } } : {}) };
}

function finding(severity: PanelFindingDetail['severity'], title: string): PanelFindingDetail {
    return { severity, title, explanation: `${title} explained.` };
}

function buttonNames(host: HTMLElement): string[] {
    return [...host.querySelectorAll('button')].map((button) => button.textContent ?? '');
}

afterEach(async () => {
    for (const { host, root } of mounted.splice(0)) {
        await act(async () => root.unmount());
        host.remove();
    }
});

describe('DiagnosticsResultCard', () => {
    it('summarizes a clean successful connection in one sentence, without server facts or report actions', async () => {
        const host = await render(
            card('connected', {
                serverLine: {
                    engineVersion: '0.107.0',
                    apiVersion: '7.0',
                    serverVersion: '7.0.12',
                    host: 'c-1.example.net',
                    pingMs: 12,
                },
            }),
            [row('setup', 'done'), row('secureConnection', 'skipped')],
        );
        expect(lines(host)).toEqual([
            'Connection successful',
            'All applicable checks passed. Sign-in succeeded and the database answered.',
        ]);
        // Versions, ping and the answering host live in the rows' Details (decision 0041).
        expect(host.textContent).not.toMatch(/0\.107\.0|7\.0|c-1\.example\.net|Ping/);
        expect(buttonNames(host)).toEqual([]);
    });

    it.each([
        [true, true, 'All applicable checks passed. Sign-in succeeded and the database answered.'],
        [true, false, 'All applicable checks passed. The database answered.'],
        [false, true, 'All checks passed. Sign-in succeeded and the database answered.'],
        [false, false, 'All checks passed. The database answered.'],
    ])('qualifies the all-clear when skipped=%s and authenticated=%s', async (skipped, authenticated, summary) => {
        const rows = [
            row('setup', 'done', [finding('info', 'Informational finding')]),
            row('secureConnection', skipped ? 'skipped' : 'done'),
        ];
        const host = await render(card('connected', { authenticated }), rows);
        expect(lines(host)).toEqual(['Connection successful', summary]);
    });

    it.each([
        [1, 'Connection successful, but 1 check needs attention'],
        [2, 'Connection successful, but 2 checks need attention'],
    ])('counts %i warning rows as checks in the success title', async (count, title) => {
        const rows = [row('secureConnection', 'warning'), row('databaseAccess', 'warning')].slice(0, count);
        const result = card('connected');
        expect(resultCardTitle(result, rows)).toBe(title);
        expect(lines(await render(result, rows))[0]).toBe(title);
    });

    it('does not count the public Azure private-link address information as a warning', async () => {
        const rows = [row('serverAddress', 'done', [finding('info', 'Public address for this Azure host name')])];
        expect(cardIssues(rows)).toEqual([]);
        const host = await render(card('connected'), rows);
        expect(lines(host)).toEqual([
            'Connection successful',
            'All checks passed. Sign-in succeeded and the database answered.',
        ]);
        expect(host.textContent).not.toMatch(/warning|private access/i);
    });

    it('marks the headline as the level-3 heading under the connection section, larger than the body', async () => {
        const host = await render(card('connected'));
        const heading = headline(host);
        expect(heading?.textContent).toBe('Connection successful');
        expect(heading?.getAttribute('aria-level')).toBe('3');
    });

    it('never says "authenticated" or "sign-in" for a connection without authentication', async () => {
        const host = await render(card('connected', { authenticated: false }));
        expect(lines(host)).toEqual(['Connection successful', 'All checks passed. The database answered.']);
        expect(host.textContent?.toLowerCase()).not.toMatch(/authenticated|sign-in/);
    });

    it('counts and names the rows that ended in a warning, pointing to their Details', async () => {
        const rows = [
            row('setup', 'done'),
            row('secureConnection', 'warning', [
                finding('info', 'Certificate details'),
                finding('warning', 'Certificate checks weakened'),
            ]),
        ];
        const result = card('connected');
        expect(resultCardTitle(result, rows)).toBe('Connection successful, but 1 check needs attention');
        const host = await render(result, rows);
        expect(lines(host)).toEqual([
            'Connection successful, but 1 check needs attention',
            'The connection works, but these checks need attention:',
            'Warning: Certificate checks weakened · Secure connection (TLS)',
            'Select Details on a row to see why and what to do.',
        ]);

        const two = [...rows, row('databaseAccess', 'warning', [finding('warning', 'Listing databases denied')])];
        expect(resultCardTitle(result, two)).toBe('Connection successful, but 2 checks need attention');
    });

    it('names rows that failed while the connection succeeded (review R6)', async () => {
        const failed = [row('networkConnection', 'error', [finding('error', 'Connection refused')])];
        expect(resultCardTitle(card('connected'), failed)).toBe('Connection successful, but 1 check failed');
        const host = await render(card('connected'), failed);
        expect(lines(host)).toContain('Failed: Connection refused · Network connection (TCP)');

        const both = [
            ...failed,
            row('secureConnection', 'warning', [finding('warning', 'Certificate checks weakened')]),
        ];
        expect(resultCardTitle(card('connected'), both)).toBe('Connection successful, but 2 checks need attention');
        expect(cardIssues(both).map((issue) => issue.row)).toEqual(['networkConnection', 'secureConnection']);
        expect(resultCardTitle(card('connected'), [...failed, row('serverResponse', 'error')])).toBe(
            'Connection successful, but 2 checks failed',
        );
    });

    it('shows a failed run: what failed, why, the next step, supporting evidence and provider hint', async () => {
        const host = await render(
            card('failed', {
                stoppedAtRow: 'authentication',
                headline: {
                    title: 'Authentication rejected',
                    explanation: 'The server rejected the selected authentication credentials.',
                    nextStep: 'Check the username and password, and the authentication database.',
                    target: 'db-2:27017',
                },
                supporting: { title: 'Network connection refused', target: 'db-1:27017' },
                providerHint: 'The Kubernetes port forward is managed by the extension.',
            }),
        );
        const title = 'Connection failed at Authentication';
        expect(resultCardTitle(card('failed', { stoppedAtRow: 'authentication' }), [])).toBe(title);
        expect(lines(host)).toEqual([
            title,
            'Authentication rejected (db-2:27017)',
            'The server rejected the selected authentication credentials.',
            'Next: Check the username and password, and the authentication database.',
            'Also detected: Network connection refused (db-1:27017)',
            'The Kubernetes port forward is managed by the extension.',
            SUPPORT,
        ]);
        expect(buttonNames(host)).toEqual([]);
        expect(host.textContent).not.toContain(FIREWALL);
    });

    it.each([
        ['sovereignClouds', Links.SovereignClouds, 'Sovereign Clouds (Azure Government, Azure China)'],
        ['srvDns', Links.SrvDnsTroubleshooting, 'Troubleshoot SRV DNS Lookups (querySrv EBADRESP)'],
    ] as const)(
        'WI-8: opens the %s documentation link while keeping the private-access hint',
        async (topic, url, title) => {
            const onOpenUrl = vi.fn<(url: string) => void>();
            const hint = 'Connect from the private network.';
            const host = await render(card('failed', { providerHint: hint, learnMore: { topic, url } }), [], onOpenUrl);
            const link = host.querySelector<HTMLElement>('.fui-Link');
            expect(link?.textContent).toBe(title);
            expect(lines(host)).toEqual(['Connection failed', hint, title, SUPPORT]);
            expect(onOpenUrl).not.toHaveBeenCalled();
            await act(async () => link?.click());
            expect(onOpenUrl).toHaveBeenCalledExactlyOnceWith(url);
        },
    );

    it('WI-8: shows a documentation link without a provider hint', async () => {
        const host = await render(
            card('failed', { learnMore: { topic: 'srvDns', url: Links.SrvDnsTroubleshooting } }),
            [],
            vi.fn(),
        );
        expect(lines(host)).toEqual([
            'Connection failed',
            'Troubleshoot SRV DNS Lookups (querySrv EBADRESP)',
            SUPPORT,
        ]);
    });

    it('WI-8: omits the documentation link without an open-URL callback', async () => {
        const host = await render(card('failed', { learnMore: { topic: 'srvDns', url: Links.SrvDnsTroubleshooting } }));
        expect(host.querySelector('.fui-Link')).toBeNull();
        expect(lines(host)).toEqual(['Connection failed', SUPPORT]);
    });

    it("WI-27: words the driver's agreeing failure as corroboration of the root cause (decision 0047)", async () => {
        const failed = card('failed', {
            stoppedAtRow: 'networkConnection',
            headline: {
                title: 'Network connection timed out',
                explanation:
                    'The TCP connection attempt timed out without connecting. This does not identify what blocked it.',
                nextStep: `Check the endpoint and network path, then run the diagnosis again. ${FIREWALL}`,
                target: 'asf.com:27017',
            },
            supporting: { title: 'No server selected', corroboration: 'serverSelection' },
            firewallHint: true,
        });
        const host = await render(failed);
        expect(lines(host)).toEqual([
            'Connection failed at Network connection (TCP)',
            'Network connection timed out (asf.com:27017)',
            'The TCP connection attempt timed out without connecting. This does not identify what blocked it.',
            `Next: Check the endpoint and network path, then run the diagnosis again. ${FIREWALL}`,
            'The driver also could not reach a server.',
            SUPPORT,
        ]);
        expect(host.textContent).not.toMatch(/Also detected|No server selected|Authentication/);

        const timedOut = await render(
            card('failed', { supporting: { title: 'Step timed out', corroboration: 'timedOut' } }),
        );
        expect(lines(timedOut)).toContain("The driver's connection attempt also did not finish in time.");
    });

    it('WI-27: a connection that needs sign-in says so as a warning, without listing Database access again (decision 0048)', async () => {
        const signIn = {
            title: 'Sign-in required to use this connection',
            explanation:
                'The server answered, but it requires sign-in to list or read databases. This connection is set to No authentication.',
            nextStep:
                'Choose an authentication method for this connection (Update Credentials…), then run the diagnosis again.',
        };
        const result = card('connected', { authenticated: false, signInRequired: true, headline: signIn });
        const access = row('databaseAccess', 'warning', [finding('warning', signIn.title)]);
        expect(resultCardTitle(result, [access])).toBe('Connection works, but sign-in is required');
        const host = await render(result, [row('setup', 'done'), access]);
        expect(lines(host)).toEqual([
            'Connection works, but sign-in is required',
            signIn.explanation,
            `Next: ${signIn.nextStep}`,
        ]);
        expect(host.textContent).not.toMatch(
            /Connection successful|All (applicable )?checks passed|check needs attention|Contacting support/,
        );

        const tls = row('secureConnection', 'warning', [finding('warning', 'Certificate checks weakened')]);
        const both = await render(result, [tls, access]);
        expect(lines(both)).toEqual([
            'Connection works, but sign-in is required',
            signIn.explanation,
            `Next: ${signIn.nextStep}`,
            'These checks also need attention:',
            'Warning: Certificate checks weakened · Secure connection (TLS)',
            'Select Details on a row to see why and what to do.',
        ]);
        expect(both.textContent?.match(/Sign-in required to use this connection/g) ?? []).toHaveLength(0);
    });

    it('titles a failed run without a row "Connection failed", and omits absent parts', async () => {
        const host = await render(card('failed', { supporting: { title: 'Host name not found' } }));
        expect(lines(host)).toEqual(['Connection failed', 'Also detected: Host name not found', SUPPORT]);
        // A divider sets the support line apart; it is body text, not a smaller caption.
        const body = [...(host.querySelector('.fui-MessageBarBody')?.children ?? [])];
        expect(body.at(-2)?.getAttribute('role')).toBe('separator');
        expect(body.filter((element) => element.getAttribute('role') === 'separator')).toHaveLength(1);
    });

    it('shows a not-tested run with the sign-in next step and the earlier sign-in failure', async () => {
        const result = card('notTested', {
            stoppedAtRow: 'authentication',
            headline: {
                title: 'Sign-in needed',
                explanation: 'No Microsoft Entra ID sign-in is available without a prompt.',
                nextStep:
                    "Connection diagnosis doesn't open sign-in. Connect to the cluster once, then run the diagnosis again.",
            },
            earlierSignInFailure: true,
        });
        expect(resultCardTitle(result, [])).toBe('Connection not tested');
        const host = await render(result);
        expect(lines(host)).toEqual([
            'Connection not tested',
            'Sign-in needed',
            'No Microsoft Entra ID sign-in is available without a prompt.',
            "Next: Connection diagnosis doesn't open sign-in. Connect to the cluster once, then run the diagnosis again.",
            'A sign-in for this connection failed earlier. Show report has the details.',
            SUPPORT,
        ]);
        expect(host.textContent).not.toContain('failed at');
    });

    it('says the diagnosis stopped at the time limit, without claiming the connection failed', async () => {
        const result = card('notTested', { runTimeoutBeforeAttempt: true });
        expect(resultCardTitle(result, [])).toBe('Diagnosis stopped at the time limit');
        const host = await render(result);
        expect(lines(host)).toEqual([
            'Diagnosis stopped at the time limit',
            'The time limit was reached before sign-in was attempted. This does not show that the server is unreachable.',
            SUPPORT,
        ]);
        expect(host.textContent).not.toMatch(/Connection failed|not tested/);

        const limited = await render({
            ...result,
            coverage: { limited: true, retryWouldHelp: true, connectionTimeoutLimited: false },
        });
        // The support line closes the card, after the retry note.
        expect(lines(limited).at(-1)).toBe(SUPPORT);
    });

    it('says the diagnosis was cancelled or did not finish, not that the connection failed', async () => {
        const cancelled = await render({ kind: 'cancelled' });
        expect(lines(cancelled)).toEqual([
            'Diagnosis cancelled',
            'You cancelled the diagnosis. The results so far are kept.',
        ]);
        const failed = await render({ kind: 'failed', reason: 'unexpected' });
        expect(lines(failed)).toEqual([
            'Diagnosis did not finish',
            'Something went wrong while running the checks. Re-run to try again.',
        ]);
    });

    it('adds the firewall sentence only when the run flags it, and says it once', async () => {
        const flagged = await render(card('failed', { stoppedAtRow: 'networkConnection', firewallHint: true }));
        expect(lines(flagged)).toEqual(['Connection failed at Network connection (TCP)', FIREWALL, SUPPORT]);

        const inNextStep = await render(
            card('failed', {
                stoppedAtRow: 'networkConnection',
                firewallHint: true,
                headline: {
                    title: 'Network connection refused',
                    explanation: 'The TCP connection was refused.',
                    nextStep: `Check the port. ${FIREWALL}`,
                },
            }),
        );
        expect(inNextStep.textContent?.split(FIREWALL)).toHaveLength(2);

        const notFlagged = await render(card('failed', { stoppedAtRow: 'authentication' }));
        expect(notFlagged.textContent).not.toContain('firewall');
    });

    it('keeps the retry actions and connection-timeout sentence for a timeout-limited run', async () => {
        const result: FinishedResult = {
            ...card('connected'),
            coverage: { limited: true, retryWouldHelp: true, connectionTimeoutLimited: true },
        };
        const host = await render(result);
        expect(buttonNames(host)).toEqual(['Retry with longer timeouts', 'Retry without diagnostic timeouts']);
        expect(host.textContent).toContain('This may wait until you cancel it.');
        expect(host.textContent).toContain('A timeout configured on the connection limited this check.');
    });

    it('renders only the host-localized text: no codes, URIs, rule IDs or timings', async () => {
        const host = await render(
            card('failed', {
                stoppedAtRow: 'authentication',
                headline: {
                    title: 'Microsoft Entra ID sign-in failed',
                    explanation: "This account does not appear to belong to the cluster's organization.",
                    nextStep: 'Use Update Credentials to choose another account or tenant.',
                },
                earlierSignInFailure: true,
            }),
        );
        const text = host.textContent ?? '';
        expect(text).not.toMatch(/\b(?:env|cs|srv|dns|tcp|tls|hello|auth|access|check)\.[a-z][A-Za-z]+\b/);
        expect(text).not.toMatch(/AADSTS|https?:|accountNotInTenant/);
        expect(text).not.toMatch(/\d\s?ms\b/);
    });
});
