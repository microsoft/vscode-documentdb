/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ReactModule from 'react';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client'; // eslint-disable-line import/no-internal-modules
import { type AwsCredentialsWebviewConfig } from './awsCredentialsController';

let mockConfiguration: AwsCredentialsWebviewConfig = { mode: 'add' };
const mockListProfiles = vi.hoisted(() => vi.fn());
const mockSubmit = vi.hoisted(() => vi.fn());
const mockStartSso = vi.hoisted(() => vi.fn());
const mockPollSso = vi.hoisted(() => vi.fn());
const mockCancelSso = vi.hoisted(() => vi.fn());
const mockComplete = vi.hoisted(() => vi.fn());
const mockClient = {
    awsCredentials: {
        listProfiles: { query: mockListProfiles },
        submit: { mutate: mockSubmit },
        startSso: { mutate: mockStartSso },
        pollSso: { query: mockPollSso },
        cancelSso: { mutate: mockCancelSso },
        listSsoRoles: { query: vi.fn() },
        complete: { mutate: mockComplete },
        cancel: { mutate: vi.fn() },
    },
    common: { openUrl: { mutate: vi.fn() } },
};

vi.mock('./awsCredentials.scss', () => ({}));
vi.mock('@vscode/l10n', () => ({
    t: (message: string, ...args: string[]): string =>
        args.reduce((text, value, index) => text.replace(`{${String(index)}}`, value), message),
}));
vi.mock('@microsoft/vscode-ext-webview/react', () => ({
    useConfiguration: (): AwsCredentialsWebviewConfig => mockConfiguration,
}));
vi.mock('../../_integration/useTrpcClient', () => ({
    useTrpcClient: (): typeof mockClient => mockClient,
}));

// The shared ESM shell has its own DOM/layout tests. Isolate that package boundary here while
// rendering real Fluent cards, fields, dropdowns, and messages and exercising the AWS state machine.
vi.mock('@microsoft/vscode-ext-webview-fluentui/components', async () => {
    const React = await vi.importActual<typeof ReactModule>('react');
    interface StepProps {
        value: string;
        label: string;
        title?: string;
        children?: ReactNode;
    }
    return {
        Wizard: (props: { activeStep: string; header: ReactNode; footer: ReactNode; children: ReactNode }): ReactNode =>
            React.createElement(
                'main',
                null,
                props.header,
                React.createElement(
                    'nav',
                    null,
                    React.Children.map(props.children, (child) =>
                        React.isValidElement<StepProps>(child)
                            ? React.createElement('span', null, child.props.label)
                            : null,
                    ),
                ),
                React.Children.map(props.children, (child) =>
                    React.isValidElement<StepProps>(child) && child.props.value === props.activeStep ? child : null,
                ),
                props.footer,
            ),
        WizardStep: (props: StepProps): ReactNode =>
            React.createElement('section', null, React.createElement('h2', null, props.title), props.children),
        ContainerHeader: (props: { title: string; subtitle: string }): ReactNode =>
            React.createElement('header', null, React.createElement('h1', null, props.title), props.subtitle),
        ContainerFooter: (props: { children: ReactNode; contentEnd: ReactNode }): ReactNode =>
            React.createElement('footer', null, props.children, props.contentEnd),
        StatusList: (props: { children: ReactNode; ariaLabel: string }): ReactNode =>
            React.createElement('ul', { 'aria-label': props.ariaLabel }, props.children),
        StatusListItem: (props: { label: string; status: string }): ReactNode =>
            React.createElement('li', { 'data-status': props.status }, props.label),
    };
});

import { AwsCredentialsView } from './AwsCredentialsView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: { host: HTMLElement; root: Root }[] = [];

async function renderView(): Promise<HTMLElement> {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ host, root });
    await act(async () => root.render(<AwsCredentialsView />));
    return host;
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
    const element = Array.from(host.querySelectorAll('button')).find((candidate) => candidate.textContent === label);
    if (!element) {
        throw new Error(`Missing button: ${label}`);
    }
    return element;
}

async function click(element: HTMLElement): Promise<void> {
    await act(async () => element.click());
}

async function choose(host: HTMLElement, method: string): Promise<void> {
    const radio = host.querySelector<HTMLInputElement>(`input[type="radio"][aria-label="${method}"]`);
    if (!radio) {
        throw new Error(`Missing method: ${method}`);
    }
    await click(radio);
    await click(button(host, 'Continue'));
}

async function fill(host: HTMLElement, label: string, value: string): Promise<void> {
    const fieldLabel = Array.from(host.querySelectorAll('label')).find((candidate) =>
        candidate.textContent?.startsWith(label),
    );
    const input = fieldLabel ? document.getElementById(fieldLabel.htmlFor) : null;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!(input instanceof HTMLInputElement) || !setter) {
        throw new Error(`Missing input: ${label}`);
    }
    await act(async () => {
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    mockConfiguration = { mode: 'add' };
    mockListProfiles.mockReset().mockResolvedValue([{ name: 'default', kind: 'static' }]);
    mockSubmit.mockReset();
    mockStartSso.mockReset();
    mockPollSso.mockReset();
    mockCancelSso.mockReset().mockResolvedValue(undefined);
    mockComplete.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
    for (const { host, root } of mounted.splice(0)) {
        await act(async () => root.unmount());
        host.remove();
    }
});

describe('AWS credentials onboarding', () => {
    it('matches the Atlas four-stage shell and card affordances with profile selected by default', async () => {
        const host = await renderView();
        const radios = Array.from(host.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
        expect(radios.map((radio) => radio.getAttribute('aria-label'))).toEqual([
            'AWS profile',
            'Access key',
            'SSO',
            'Temporary credentials',
        ]);
        expect(radios.map((radio) => radio.checked)).toEqual([true, false, false, false]);
        expect(host.textContent).toContain('Recommended');
        expect(host.querySelector('nav')?.textContent).toBe('Choose methodEnter detailsVerifyDone');
        expect(Array.from(host.querySelectorAll('footer button')).map((element) => element.textContent)).toEqual([
            'Continue',
            'Cancel',
            'Learn more',
        ]);
        const css = Array.from(document.querySelectorAll('style'))
            .map((style) =>
                Array.from(style.sheet?.cssRules ?? [])
                    .map((rule) => rule.cssText)
                    .join('\n'),
            )
            .join('\n');
        expect(css).toMatch(/max-width:\s*640px/);
        expect(css).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    });

    it('keeps details inside the wizard and submits the selected profile and remembered regions', async () => {
        mockConfiguration = { mode: 'edit', authMethod: 'profile', profile: 'work', regions: ['eu-west-1'] };
        mockListProfiles.mockResolvedValue([{ name: 'work', kind: 'role' }]);
        mockSubmit.mockResolvedValue({
            success: true,
            credential: {
                id: 'work',
                label: 'Work',
                authMethod: 'profile',
                regions: ['eu-west-1'],
                accountId: '123456789012',
                arn: 'arn:aws:iam::123456789012:role/work',
            },
        });
        const host = await renderView();
        expect(host.querySelector('h2')?.textContent).toBe('AWS profile');
        expect(host.textContent).toContain('eu-west-1');
        await click(button(host, 'Verify & Save'));
        expect(mockSubmit).toHaveBeenCalledWith(
            { authMethod: 'profile', profile: 'work', regions: ['eu-west-1'], label: undefined },
            expect.objectContaining({ signal: expect.any(AbortSignal) as AbortSignal }),
        );
        expect(host.querySelector('h2')?.textContent).toBe('Credential updated');
        expect(host.textContent).toContain('Discovery permissions are checked separately');
        await click(button(host, 'Close'));
        expect(mockComplete).toHaveBeenCalledTimes(1);
    });

    it('masks temporary credentials and truthfully describes session-only completion', async () => {
        mockSubmit.mockResolvedValue({
            success: true,
            credential: {
                id: 'session',
                label: 'Session',
                authMethod: 'temporary',
                regions: ['us-east-1'],
                accountId: '123456789012',
                arn: 'arn:aws:sts::123456789012:assumed-role/test/session',
            },
        });
        const host = await renderView();
        await choose(host, 'Temporary credentials');
        expect(host.querySelectorAll('input[type="password"]')).toHaveLength(2);
        await fill(host, 'Access Key ID', 'temporary-id');
        await fill(host, 'Secret Access Key', 'temporary-secret');
        await fill(host, 'Session token', 'temporary-token');
        await click(button(host, 'Verify & Save'));
        expect(mockSubmit).toHaveBeenCalledWith(
            expect.objectContaining({
                authMethod: 'temporary',
                accessKeyId: 'temporary-id',
                secretAccessKey: 'temporary-secret',
                sessionToken: 'temporary-token',
            }),
            expect.objectContaining({ signal: expect.any(AbortSignal) as AbortSignal }),
        );
        expect(host.textContent).toContain('not saved permanently');
        expect(host.textContent).not.toContain('successfully checked and saved');
        expect(host.querySelector('input[type="password"]')).toBeNull();
    });

    it('associates invalid expiration guidance with its input and clears it when corrected', async () => {
        const host = await renderView();
        await choose(host, 'Temporary credentials');
        await fill(host, 'Access Key ID', 'temporary-key');
        await fill(host, 'Secret Access Key', 'temporary-secret');
        await fill(host, 'Session token', 'temporary-token');
        await fill(host, 'Expiration (optional, ISO 8601)', 'not-a-date');

        const expirationLabel = Array.from(host.querySelectorAll('label')).find((candidate) =>
            candidate.textContent?.startsWith('Expiration (optional, ISO 8601)'),
        );
        const expirationInput = expirationLabel ? document.getElementById(expirationLabel.htmlFor) : null;
        const errorMessage = Array.from(host.querySelectorAll('*')).find(
            (element) => element.textContent === 'Enter a valid future expiration time.',
        );
        expect(expirationInput).toBeInstanceOf(HTMLInputElement);
        expect(errorMessage).toBeDefined();
        const describedBy = expirationInput?.getAttribute('aria-describedby')?.split(/\s+/) ?? [];
        expect(describedBy).toContain(errorMessage?.id);
        expect(button(host, 'Verify & Save').disabled).toBe(true);

        await fill(host, 'Expiration (optional, ISO 8601)', new Date(Date.now() + 60_000).toISOString());

        expect(host.textContent).not.toContain('Enter a valid future expiration time.');
        expect(button(host, 'Verify & Save').disabled).toBe(false);
    });

    it('keeps a failed verification on Verify and lets the user return to the same details', async () => {
        mockSubmit.mockResolvedValue({
            success: false,
            error: { title: 'Sign-in required', message: 'Renew the AWS profile session.' },
        });
        const host = await renderView();
        await click(button(host, 'Continue'));
        await click(button(host, 'Verify & Save'));
        expect(host.querySelector('h2')?.textContent).toBe('Verify your AWS credential');
        expect(host.textContent).toContain('Renew the AWS profile session.');
        expect(button(host, 'Verify & Save').disabled).toBe(true);
        expect(button(host, 'Retry').disabled).toBe(false);
        await click(button(host, 'Back'));
        expect(host.querySelector('h2')?.textContent).toBe('AWS profile');
        expect(host.textContent).toContain('default');
    });

    it('aborts an in-flight browser sign-in on Back and ignores its late result', async () => {
        let resolveStart:
            | ((value: { flowId: string; verificationUri: string; userCode: string; intervalSeconds: number }) => void)
            | undefined;
        mockStartSso.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveStart = resolve;
                }),
        );
        const host = await renderView();
        await choose(host, 'SSO');
        await fill(host, 'SSO start URL', 'https://work.awsapps.com/start');
        await click(button(host, 'Sign in with browser'));
        expect(mockStartSso).toHaveBeenCalledTimes(1);
        const requestOptions = mockStartSso.mock.calls[0][1] as { signal: AbortSignal };
        await click(button(host, 'Back'));
        expect(requestOptions.signal.aborted).toBe(true);
        expect(mockCancelSso).toHaveBeenLastCalledWith({});
        await act(async () =>
            resolveStart?.({
                flowId: 'late-flow',
                verificationUri: 'https://device.sso.us-east-1.amazonaws.com/',
                userCode: 'OLD-CODE',
                intervalSeconds: 1,
            }),
        );
        expect(host.querySelector('h2')?.textContent).toBe('Choose an authentication method');
        expect(host.textContent).not.toContain('OLD-CODE');
        expect(mockPollSso).not.toHaveBeenCalled();
    });

    it('shows the host startup diagnostic even when an RPC error is not the local TRPCClientError class', async () => {
        const message = 'VS Code could not open your browser. Check the default browser configuration and retry.';
        mockStartSso.mockRejectedValue(Object.assign(new Error(message), { name: 'TRPCClientError' }));
        const host = await renderView();
        await choose(host, 'SSO');
        await fill(host, 'SSO start URL', 'https://work.awsapps.com/start');
        await click(button(host, 'Sign in with browser'));
        expect(host.textContent).toContain(message);
        expect(host.textContent).not.toContain('Check your sign-in details, network, and AWS permissions, then retry.');
        expect(mockPollSso).not.toHaveBeenCalled();
        expect(button(host, 'Sign in with browser').disabled).toBe(false);
    });
});
