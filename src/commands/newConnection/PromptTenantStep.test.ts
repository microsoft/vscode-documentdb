/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const mockGetTenants = jest.fn();
const mockIsSignedIn = jest.fn();
const mockConfigureAzureCredentials = jest.fn();
const mockOutputChannel = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

jest.mock('../../extensionVariables', () => ({
    ext: {
        get outputChannel(): typeof mockOutputChannel {
            return mockOutputChannel;
        },
    },
}));

jest.mock('@microsoft/vscode-azext-azureauth', () => ({
    VSCodeAzureSubscriptionProvider: jest.fn().mockImplementation(() => ({
        getTenants: mockGetTenants,
        isSignedIn: mockIsSignedIn,
    })),
}));

jest.mock('@microsoft/vscode-azext-utils', () => ({
    AzureWizardPromptStep: class AzureWizardPromptStep {},
}));

jest.mock('@vscode/l10n', () => ({
    t: jest.fn((message: string, ...args: unknown[]) =>
        message.replace(/\{(\d+)\}/g, (_match: string, index: string) => String(args[Number(index)])),
    ),
}));

jest.mock('vscode', () => ({
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    QuickPickItemKind: { Separator: -1 },
    l10n: { t: jest.fn((message: string) => message) },
}));

jest.mock('../../plugins/api-shared/azure/credentialsManagement', () => ({
    configureAzureCredentials: mockConfigureAzureCredentials,
}));

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { traceTenantLookup } from '../../plugins/api-shared/azure/traceTenantLookup';
import { PromptTenantStep as UpdateCredentialsPromptTenantStep } from '../updateCredentials/PromptTenantStep';
import { PromptTenantStep as NewConnectionPromptTenantStep } from './PromptTenantStep';

const TENANT_ID = '11111111-2222-3333-4444-555555555555';
const tenant = {
    tenantId: TENANT_ID,
    displayName: 'Example Organization',
    defaultDomain: 'example.test',
    account: { id: 'account', label: 'alex@example.test' },
};

type PromptTenantStep = NewConnectionPromptTenantStep | UpdateCredentialsPromptTenantStep;

function makeContext(showQuickPick: jest.Mock): IActionContext {
    return {
        valuesToMask: [],
        telemetry: { properties: {}, measurements: {} },
        errorHandling: {},
        ui: { showQuickPick, showInputBox: jest.fn().mockResolvedValue(TENANT_ID) } as unknown as IActionContext['ui'],
    } as unknown as IActionContext;
}

function outputText(): string {
    return [
        ...mockOutputChannel.info.mock.calls,
        ...mockOutputChannel.warn.mock.calls,
        ...mockOutputChannel.error.mock.calls,
    ]
        .map((call) => String(call[0]))
        .join('\n');
}

function makeFallbackContext(): IActionContext {
    return makeContext(
        jest.fn().mockImplementation(async (itemsPromise: Promise<unknown[]>) => {
            await itemsPromise;
            return { isCustomOption: true };
        }),
    );
}

describe.each([
    ['new connection', () => new NewConnectionPromptTenantStep()],
    ['update credentials', () => new UpdateCredentialsPromptTenantStep()],
])('PromptTenantStep for %s', (_name, makeStep: () => PromptTenantStep) => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockIsSignedIn.mockReset().mockResolvedValue(true);
        mockGetTenants.mockReset().mockResolvedValue([tenant]);
        mockConfigureAzureCredentials.mockResolvedValue(undefined);
    });

    afterEach(() => {
        jest.useRealTimers();
        for (const sensitiveValue of [TENANT_ID, tenant.displayName, tenant.defaultDomain, tenant.account.label]) {
            expect(outputText()).not.toContain(sensitiveValue);
        }
    });

    it('keeps look-ahead silent and logs the current tenant gate only when reached', () => {
        const step = makeStep();
        const context = { selectedAuthenticationMethod: undefined as AuthMethodId | undefined };
        expect(step.shouldPrompt(context as never)).toBe(false);
        expect(step.shouldPrompt(context as never)).toBe(false);
        expect(mockOutputChannel.info).not.toHaveBeenCalled();

        context.selectedAuthenticationMethod = AuthMethodId.MicrosoftEntraID;
        step.configureBeforePrompt(context as never);
        expect(step.shouldPrompt(context as never)).toBe(true);
        expect(mockOutputChannel.info).toHaveBeenCalledTimes(1);
        expect(mockOutputChannel.info.mock.calls[0][0]).toContain('"skipped":false');
        expect(mockOutputChannel.info.mock.calls[0][0]).toContain('interactiveEntra');

        context.selectedAuthenticationMethod = AuthMethodId.ManagedIdentity;
        step.configureBeforePrompt(context as never);
        expect(step.shouldPrompt(context as never)).toBe(false);
        expect(mockOutputChannel.info).toHaveBeenCalledTimes(2);
        expect(mockOutputChannel.info.mock.calls[1][0]).toContain('"skipped":true');
        expect(mockOutputChannel.info.mock.calls[1][0]).toContain('notInteractiveEntra');
        expect(mockIsSignedIn).not.toHaveBeenCalled();
        expect(mockGetTenants).not.toHaveBeenCalled();
    });

    it('runs account management before listing tenants when signed out', async () => {
        mockIsSignedIn.mockResolvedValue(false);
        const showQuickPick = jest.fn().mockImplementation(async (itemsPromise: Promise<unknown[]>) => {
            const items = await itemsPromise;
            return items.find((item) => (item as { tenant?: unknown }).tenant);
        });
        const context = makeContext(showQuickPick);

        await makeStep().prompt(context as never);

        expect(mockConfigureAzureCredentials).toHaveBeenCalledTimes(1);
        expect(mockGetTenants).toHaveBeenCalledTimes(1);
        expect((context as IActionContext & { entraIdAuthConfig?: { tenantId?: string } }).entraIdAuthConfig).toEqual({
            tenantId: TENANT_ID,
        });
        expect(context.telemetry.properties.tenantSelectionMethod).toBe('signInTriggered');
        expect(outputText()).toContain('signedIn=false');
        expect(outputText()).toContain('tenants=1; accountsWithTenants=1');
    });

    it('re-enumerates tenants after account management without exiting the wizard', async () => {
        mockIsSignedIn.mockResolvedValue(true);
        const showQuickPick = jest
            .fn()
            .mockImplementationOnce(async (items: Promise<unknown[]>) => {
                await items;
                return { isSignInOption: true };
            })
            .mockImplementationOnce(async (items: Promise<unknown[]>) => {
                await items;
                return { tenant };
            });
        const context = makeContext(showQuickPick);

        await makeStep().prompt(context as never);

        expect(showQuickPick).toHaveBeenCalledTimes(2);
        expect(mockGetTenants).toHaveBeenCalledTimes(2);
        expect(mockConfigureAzureCredentials).toHaveBeenCalledTimes(1);
        expect((context as IActionContext & { entraIdAuthConfig?: { tenantId?: string } }).entraIdAuthConfig).toEqual({
            tenantId: TENANT_ID,
        });
    });

    it('distinguishes a successful empty result from failure and timeout', async () => {
        mockGetTenants.mockResolvedValue([]);
        const context = makeFallbackContext();

        await makeStep().prompt(context as never);

        expect(outputText()).toContain('signedIn=true');
        expect(outputText()).toContain('tenants=0; accountsWithTenants=0');
        expect(mockOutputChannel.warn).not.toHaveBeenCalled();
        expect(mockOutputChannel.error).not.toHaveBeenCalled();
        expect(context.telemetry.measurements.availableTenantsCount).toBe(0);
    });

    it('logs safe failure details without messages or identifiers', async () => {
        const error = Object.assign(new Error(`AADSTS65001 ${tenant.account.label} secret-token ${TENANT_ID}`), {
            name: 'RestError',
            code: 'AuthorizationFailed',
            statusCode: 403,
        });
        mockGetTenants.mockRejectedValue(error);

        await makeStep().prompt(makeFallbackContext() as never);

        expect(outputText()).toContain('failed in');
        expect(outputText()).toContain(
            'type=RestError; code=AuthorizationFailed; httpStatus=403; aadsts=AADSTS65001',
        );
        expect(outputText()).not.toContain('secret-token');
        expect(mockOutputChannel.warn).not.toHaveBeenCalled();
    });

    it('does not print unrecognized error metadata', async () => {
        mockGetTenants.mockRejectedValue(
            Object.assign(new Error('secret-token'), {
                name: tenant.account.label,
                code: 'secret-token',
                statusCode: TENANT_ID,
            }),
        );

        await makeStep().prompt(makeFallbackContext() as never);

        expect(outputText()).toContain('type=unknown; code=unknown; httpStatus=unknown; aadsts=none');
        expect(outputText()).not.toContain('secret-token');
    });

    it('does not print arbitrary thrown values', async () => {
        mockGetTenants.mockRejectedValue(`secret-token ${tenant.account.label}`);

        await makeStep().prompt(makeFallbackContext() as never);

        expect(outputText()).toContain('type=unknown; code=unknown; httpStatus=unknown; aadsts=none');
        expect(outputText()).not.toContain('secret-token');
    });

    it('logs sign-in failure while preserving the existing true fallback', async () => {
        mockIsSignedIn.mockRejectedValue(new Error('secret-token'));

        await makeStep().prompt(makeFallbackContext() as never);

        expect(outputText()).toMatch(/isSignedIn: failed in/);
        expect(mockConfigureAzureCredentials).not.toHaveBeenCalled();
        expect(mockGetTenants).toHaveBeenCalledTimes(1);
        expect(outputText()).not.toContain('secret-token');
    });

    it('logs sign-in timeout while preserving the existing true fallback', async () => {
        jest.useFakeTimers();
        mockIsSignedIn.mockReturnValue(new Promise<boolean>(() => {}));

        const prompt = makeStep().prompt(makeFallbackContext() as never);
        await jest.advanceTimersByTimeAsync(5000);
        await prompt;

        expect(outputText()).toContain('isSignedIn: timed out after 5000 ms; using fallback (signedIn=true)');
        expect(mockConfigureAzureCredentials).not.toHaveBeenCalled();
        expect(mockGetTenants).toHaveBeenCalledTimes(1);
    });

    it('logs late tenant completion without replacing the timeout fallback', async () => {
        jest.useFakeTimers();
        let completeLookup!: (tenants: (typeof tenant)[]) => void;
        mockGetTenants.mockReturnValue(
            new Promise<(typeof tenant)[]>((resolve) => {
                completeLookup = resolve;
            }),
        );
        const context = makeFallbackContext();

        const prompt = makeStep().prompt(context as never);
        await jest.advanceTimersByTimeAsync(4999);
        expect(mockOutputChannel.warn).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(1);
        await prompt;

        expect(outputText()).toContain('getTenants: timed out after 5000 ms; using fallback (tenants=0)');
        await jest.advanceTimersByTimeAsync(1000);
        completeLookup([tenant]);
        await jest.advanceTimersByTimeAsync(0);

        expect(outputText()).toContain('completed after timeout in 6000 ms; tenants=1');
        expect(context.telemetry.measurements.availableTenantsCount).toBe(0);
    });

    it('logs late provider rejection after a timeout', async () => {
        jest.useFakeTimers();
        let failLookup!: (reason: Error) => void;
        mockGetTenants.mockReturnValue(
            new Promise<(typeof tenant)[]>((_resolve, reject) => {
                failLookup = reject;
            }),
        );

        const prompt = makeStep().prompt(makeFallbackContext() as never);
        await jest.advanceTimersByTimeAsync(5000);
        await prompt;
        failLookup(Object.assign(new Error('secret-token'), { code: 'ECONNRESET' }));
        await jest.advanceTimersByTimeAsync(0);

        expect(outputText()).toContain('failed after timeout in 5000 ms; type=Error; code=ECONNRESET');
        expect(outputText()).not.toContain('secret-token');
    });

    it('offers an explicit retry after timeout and allows 30 seconds for it', async () => {
        jest.useFakeTimers();
        mockGetTenants
            .mockReturnValueOnce(new Promise<(typeof tenant)[]>(() => {}))
            .mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve([tenant]), 29_000)));
        const showQuickPick = jest.fn()
            .mockImplementationOnce(async (itemsPromise: Promise<{ isRetryOption?: boolean; detail?: string }[]>) => {
                const items = await itemsPromise;
                const retry = items.find((item) => item.isRetryOption);
                expect(retry?.detail).toContain('timed out after 5 seconds');
                return retry;
            })
            .mockImplementationOnce(async (itemsPromise: Promise<{ tenant?: unknown; isRetryOption?: boolean }[]>) => {
                const items = await itemsPromise;
                expect(items.some((item) => item.isRetryOption)).toBe(false);
                return items.find((item) => item.tenant);
            });
        const context = makeContext(showQuickPick);
        const prompt = makeStep().prompt(context as never);

        await jest.advanceTimersByTimeAsync(5000);
        expect(mockGetTenants).toHaveBeenCalledTimes(2);
        await jest.advanceTimersByTimeAsync(29_000);
        await prompt;

        expect(outputText()).toContain('getTenants: started; timeout=30000 ms.');
        expect(context.telemetry.measurements.availableTenantsCount).toBe(1);
        expect(mockConfigureAzureCredentials).not.toHaveBeenCalled();
    });

    it('keeps manual entry, account management, and retry available after a retry timeout', async () => {
        jest.useFakeTimers();
        mockGetTenants.mockReturnValue(new Promise<(typeof tenant)[]>(() => {}));
        const showQuickPick = jest.fn()
            .mockImplementationOnce(async (itemsPromise: Promise<{ isRetryOption?: boolean }[]>) =>
                (await itemsPromise).find((item) => item.isRetryOption),
            )
            .mockImplementationOnce(async (itemsPromise: Promise<{
                isRetryOption?: boolean; isCustomOption?: boolean; isSignInOption?: boolean; detail?: string;
            }[]>) => {
                const items = await itemsPromise;
                expect(items.find((item) => item.isRetryOption)?.detail).toContain('timed out after 30 seconds');
                expect(items.some((item) => item.isSignInOption)).toBe(true);
                return items.find((item) => item.isCustomOption);
            });
        const prompt = makeStep().prompt(makeContext(showQuickPick) as never);

        await jest.advanceTimersByTimeAsync(35_000);
        await prompt;

        expect(mockGetTenants).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['empty', undefined, 'No tenants were returned'],
        ['failure', new Error('synthetic failure'), 'Unable to load tenants'],
    ])('offers retry for a %s result without misreporting a timeout', async (_name, error, detail) => {
        if (error) {
            mockGetTenants.mockRejectedValueOnce(error);
        } else {
            mockGetTenants.mockResolvedValueOnce([]);
        }
        const showQuickPick = jest.fn().mockImplementation(async (itemsPromise: Promise<{
            isRetryOption?: boolean; isCustomOption?: boolean; detail?: string;
        }[]>) => {
            const items = await itemsPromise;
            expect(items.find((item) => item.isRetryOption)?.detail).toContain(detail);
            return items.find((item) => item.isCustomOption);
        });

        await makeStep().prompt(makeContext(showQuickPick) as never);
        expect(mockGetTenants).toHaveBeenCalledTimes(1);
    });
});

describe('unbounded account-management tenant tracing', () => {
    it('logs results without adding a timeout', async () => {
        jest.clearAllMocks();
        const result = await traceTenantLookup('accountManagement.getTenants', () => Promise.resolve([tenant]));

        expect(result).toEqual([tenant]);
        expect(outputText()).toContain('accountManagement.getTenants: started; no timeout.');
        expect(outputText()).toContain('tenants=1; accountsWithTenants=1');
        expect(outputText()).not.toContain(TENANT_ID);
        expect(outputText()).not.toContain(tenant.account.label);
    });
});
