/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

vi.mock('vscode', () => ({
    l10n: { t: (message: string): string => message },
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    ThemeColor: class ThemeColor {
        constructor(public readonly id: string) {}
    },
    workspace: { getConfiguration: vi.fn() },
}));

vi.mock('@vscode/l10n', () => ({
    t: (message: string, ...args: unknown[]): string =>
        message.replace(/\{(\d+)\}/g, (_match: string, index: string) => String(args[Number(index)])),
}));

const mockOutputChannel = { info: vi.fn(), error: vi.fn() };
const { mockShowEntraUnavailableDetails } = vi.hoisted(() => ({ mockShowEntraUnavailableDetails: vi.fn() }));
const mockSettingsUpdate = vi.fn();
vi.mock('../../auth/showEntraUnavailableDetails', () => ({
    showEntraUnavailableDetails: mockShowEntraUnavailableDetails,
}));
vi.mock('../../../extensionVariables', () => ({
    ext: {
        get outputChannel(): typeof mockOutputChannel {
            return mockOutputChannel;
        },
    },
}));
beforeEach(() => {
    vi.clearAllMocks();
    mockShowEntraUnavailableDetails.mockReset().mockResolvedValue(undefined);
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        inspect: vi.fn().mockReturnValue(undefined),
        update: mockSettingsUpdate,
    } as unknown as vscode.WorkspaceConfiguration);
});

vi.mock('@microsoft/vscode-azext-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@microsoft/vscode-azext-utils')>()),
    AzureWizardPromptStep: class AzureWizardPromptStep {},
}));

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import { PromptAuthMethodStep as NewConnectionAuthStep } from '../../../commands/newConnection/PromptAuthMethodStep';
import { PromptAuthMethodStep as UpdateCredentialsAuthStep } from '../../../commands/updateCredentials/PromptAuthMethodStep';
import { AuthMethodId, type createAuthMethodQuickPickItems } from '../../auth/AuthMethod';
import { type AuthenticateWizardContext } from './AuthenticateWizardContext';
import { ChooseAuthMethodStep } from './ChooseAuthMethodStep';
import { SelectEntraTokenSourceStep } from './SelectEntraTokenSourceStep';

describe('ChooseAuthMethodStep authentication families', () => {
    it.each([
        [AuthMethodId.NativeAuth, AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity],
        [AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity],
    ])('denies Entra without destination context even when methods include %s', async (...availableAuthMethods) => {
        const showQuickPick = vi.fn().mockResolvedValue({ authMethod: AuthMethodId.NativeAuth });
        const context = {
            availableAuthMethods,
            telemetry: { properties: {}, measurements: {} },
            ui: { showQuickPick },
            selectedAuthMethod: undefined as AuthMethodId | undefined,
        };

        await new ChooseAuthMethodStep().prompt(context as never);

        expect(showQuickPick).toHaveBeenCalledOnce();
        const items = showQuickPick.mock.calls[0][0] as ReturnType<typeof createAuthMethodQuickPickItems>;
        expect(items.some((item) => item.authMethod === AuthMethodId.MicrosoftEntraID)).toBe(false);
        expect(items.some((item) => item.authMethod === AuthMethodId.ManagedIdentity)).toBe(false);
        expect(items.some((item) => item.entraUnavailable)).toBe(true);
        expect(context.selectedAuthMethod).toBe(AuthMethodId.NativeAuth);
    });

    it('auto-selects the Entra family when account and managed identity are the only methods', async () => {
        const showQuickPick = vi.fn();
        const context = {
            entraDestinationAllowed: true,
            availableAuthMethods: [AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity],
            telemetry: { properties: {}, measurements: {} },
            ui: { showQuickPick },
        } as unknown as AuthenticateWizardContext;

        await new ChooseAuthMethodStep().prompt(context);

        expect(context.selectedAuthMethod).toBe(AuthMethodId.MicrosoftEntraID);
        expect(context.authenticationMethodPrompted).toBe(false);
        expect(context.telemetry.properties).toMatchObject({
            authMethod: AuthMethodId.MicrosoftEntraID,
            authMethodSelectionSource: 'autoSelected',
        });
        expect(showQuickPick).not.toHaveBeenCalled();
        expect(JSON.stringify(mockOutputChannel.info.mock.calls)).toContain('singleSupportedFamily');
    });

    it.each([
        ['newConnection', new NewConnectionAuthStep()],
        ['updateCredentials', new UpdateCredentialsAuthStep()],
    ])('traces %s picker options and selection', async (source, step) => {
        const context = {
            connectionString: 'mongodb://cluster.mongocluster.cosmos.azure.com/',
            telemetry: { properties: {}, measurements: {} },
            availableAuthenticationMethods: [
                AuthMethodId.NativeAuth,
                AuthMethodId.MicrosoftEntraID,
                AuthMethodId.ManagedIdentity,
            ],
            ui: { showQuickPick: vi.fn().mockResolvedValue({ authMethod: AuthMethodId.MicrosoftEntraID }) },
        };

        await step.prompt(context as never);

        expect(context.telemetry.properties).toMatchObject({
            authMethod: AuthMethodId.MicrosoftEntraID,
            authMethodSelectionSource: 'prompt',
        });

        const output = JSON.stringify(mockOutputChannel.info.mock.calls);
        expect(output).toContain(`${source}.authMethodPicker`);
        expect(output).toContain('NativeAuth,MicrosoftEntraID,NoAuth');
        expect(output).toContain(`${source}.authMethodSelected`);
    });

    it('traces a family picker skipped because inference already chose the method', () => {
        const step = new NewConnectionAuthStep();
        const context = {
            selectedAuthenticationMethod: AuthMethodId.ManagedIdentity,
            telemetry: { properties: {}, measurements: {} },
        };
        expect(step.shouldPrompt(context as never)).toBe(false);
        expect(mockOutputChannel.info).not.toHaveBeenCalled();

        step.configureBeforePrompt(context as never);

        expect(context.telemetry.properties).toMatchObject({
            authMethod: AuthMethodId.ManagedIdentity,
            authMethodSelectionSource: 'preselected',
        });
        expect(mockOutputChannel.info).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(mockOutputChannel.info.mock.calls)).toContain('methodAlreadySelectedOrInferred');
    });

    it.each([
        ['new connection', () => new NewConnectionAuthStep()],
        ['update credentials', () => new UpdateCredentialsAuthStep()],
        ['reconnect', () => new ChooseAuthMethodStep()],
    ])('clears stale %s selection telemetry before a canceled re-prompt', async (_name, makeStep) => {
        const error = new Error('private cancellation detail');
        const context = {
            telemetry: {
                properties: {
                    authFlowOrigin: 'test',
                    authMethod: AuthMethodId.ManagedIdentity,
                    authMethodSelectionSource: 'prompt',
                    entraIdentityChoice: 'clientId',
                    entraIdentityPrompted: 'true',
                    entraIdentitySkipReason: 'oldReason',
                    managedIdentityKind: 'user',
                    managedIdentityClientIdSource: 'prompt',
                },
                measurements: {},
            },
            availableAuthMethods: [AuthMethodId.NativeAuth, AuthMethodId.MicrosoftEntraID],
            ui: { showQuickPick: vi.fn().mockRejectedValue(error) },
        };

        await expect(makeStep().prompt(context as never)).rejects.toBe(error);

        expect(context.telemetry.properties.authFlowOrigin).toBe('test');
        expect(context.telemetry.properties).toMatchObject({
            authMethod: undefined,
            authMethodSelectionSource: undefined,
            entraIdentityChoice: undefined,
            entraIdentityPrompted: undefined,
            entraIdentitySkipReason: undefined,
            managedIdentityKind: undefined,
            managedIdentityClientIdSource: undefined,
        });
        expect(JSON.stringify(context.telemetry)).not.toContain('private');
    });

    it.each([
        ['new connection', () => new NewConnectionAuthStep()],
        ['reconnect', () => new ChooseAuthMethodStep()],
    ])('keeps %s look-ahead silent and logs only when reached', (_name, makeStep) => {
        const step = makeStep();
        const context = {
            telemetry: { properties: {}, measurements: {} },
            selectedAuthenticationMethod: undefined as AuthMethodId | undefined,
            selectedAuthMethod: undefined as AuthMethodId | undefined,
        };
        expect(step.shouldPrompt(context as never)).toBe(true);
        expect(step.shouldPrompt(context as never)).toBe(true);
        expect(mockOutputChannel.info).not.toHaveBeenCalled();

        context.selectedAuthenticationMethod = AuthMethodId.ManagedIdentity;
        context.selectedAuthMethod = AuthMethodId.ManagedIdentity;
        step.configureBeforePrompt(context as never);
        expect(step.shouldPrompt(context as never)).toBe(false);

        expect(mockOutputChannel.info).toHaveBeenCalledTimes(1);
        expect(mockOutputChannel.info.mock.calls[0][0]).toContain('"skipped":true');

        context.selectedAuthenticationMethod = undefined;
        context.selectedAuthMethod = undefined;
        step.configureBeforePrompt(context as never);
        expect(step.shouldPrompt(context as never)).toBe(true);

        expect(mockOutputChannel.info).toHaveBeenCalledTimes(2);
        expect(mockOutputChannel.info.mock.calls[1][0]).toContain('"skipped":false');
    });
});

describe.each([
    ['new connection', () => new NewConnectionAuthStep()],
    ['update credentials', () => new UpdateCredentialsAuthStep()],
    ['first-open authentication', () => new ChooseAuthMethodStep()],
])('%s policy-aware authentication picker', (_name, makeStep) => {
    it.each([
        ['mongodb://cluster.mongocluster.cosmos.azure.com/', undefined, true],
        ['mongodb://cluster.mongocluster.cosmos.azure.us/', undefined, true],
        ['mongodb://cluster.mongocluster.cosmos.azure.cn/', undefined, true],
        ['mongodb://cluster.database.example.com/', '.database.example.com', true],
        ['mongodb://cluster.eastus.cloudapp.azure.com/', undefined, false],
        ['mongodb://cluster.mongo.cosmos.azure.com/', undefined, false],
        ['mongodb://cluster.mongocluster.cosmos.azure.com,other.example.com/', undefined, false],
        ['mongodb://cluster.mongocluster.cosmos.azure.com./', undefined, false],
        ['not a connection string', undefined, false],
        [undefined, undefined, false],
    ])('uses current destination policy for %s', async (connectionString, suffix, allowed) => {
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
            inspect: vi.fn().mockReturnValue({ globalValue: { hostnameSuffix: suffix } }),
            update: mockSettingsUpdate,
        } as unknown as vscode.WorkspaceConfiguration);
        const showQuickPick = vi.fn().mockResolvedValue({ authMethod: AuthMethodId.NativeAuth });
        const context = {
            connectionString,
            availableAuthMethods: [],
            availableAuthenticationMethods: [AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity],
            telemetry: { properties: {}, measurements: {} },
            ui: { showQuickPick },
        };

        await makeStep().prompt(context as never);

        const items = showQuickPick.mock.calls[0][0] as ReturnType<typeof createAuthMethodQuickPickItems>;
        expect(items.some((item) => item.authMethod === AuthMethodId.MicrosoftEntraID)).toBe(allowed);
        expect(items.some((item) => item.authMethod === AuthMethodId.ManagedIdentity)).toBe(false);
        expect(items.some((item) => item.entraUnavailable)).toBe(!allowed);
        expect(
            items
                .filter((item) => item.authMethod !== AuthMethodId.MicrosoftEntraID)
                .flatMap((item) => (item.authMethod ? [item.authMethod] : [])),
        ).toEqual([AuthMethodId.NativeAuth, AuthMethodId.NoAuth]);
        expect(mockSettingsUpdate).not.toHaveBeenCalled();
    });

    it('shows details repeatedly before selecting a real method without changing trust', async () => {
        const showQuickPick = vi
            .fn()
            .mockImplementationOnce((items: ReturnType<typeof createAuthMethodQuickPickItems>) =>
                Promise.resolve(items.find((item) => item.entraUnavailable)),
            )
            .mockImplementationOnce((items: ReturnType<typeof createAuthMethodQuickPickItems>) =>
                Promise.resolve(items.find((item) => item.entraUnavailable)),
            )
            .mockResolvedValue({ authMethod: AuthMethodId.NoAuth });
        const context = {
            connectionString: 'mongodb://other.example.com/',
            availableAuthMethods: [],
            telemetry: { properties: {}, measurements: {} },
            ui: { showQuickPick },
            selectedAuthMethod: undefined as AuthMethodId | undefined,
            selectedAuthenticationMethod: undefined as AuthMethodId | undefined,
        };
        mockShowEntraUnavailableDetails.mockImplementation(() => {
            expect(context.selectedAuthMethod).toBeUndefined();
            expect(context.selectedAuthenticationMethod).toBeUndefined();
            return Promise.resolve();
        });

        await makeStep().prompt(context as never);

        expect(mockShowEntraUnavailableDetails).toHaveBeenCalledTimes(2);
        expect(showQuickPick).toHaveBeenCalledTimes(3);
        expect(context.selectedAuthMethod ?? context.selectedAuthenticationMethod).toBe(AuthMethodId.NoAuth);
        expect(context.telemetry.properties).toMatchObject({ authMethod: AuthMethodId.NoAuth });
        expect(mockSettingsUpdate).not.toHaveBeenCalled();
    });

    it('does not select authentication when the picker is canceled after details', async () => {
        const canceled = new UserCancelledError();
        const showQuickPick = vi
            .fn()
            .mockImplementationOnce((items: ReturnType<typeof createAuthMethodQuickPickItems>) =>
                Promise.resolve(items.find((item) => item.entraUnavailable)),
            )
            .mockRejectedValueOnce(canceled);
        const context = {
            connectionString: 'mongodb://other.example.com/',
            availableAuthMethods: [],
            telemetry: { properties: {}, measurements: {} },
            ui: { showQuickPick },
            selectedAuthMethod: undefined as AuthMethodId | undefined,
            selectedAuthenticationMethod: undefined as AuthMethodId | undefined,
        };

        await expect(makeStep().prompt(context as never)).rejects.toBe(canceled);

        expect(showQuickPick).toHaveBeenCalledTimes(2);
        expect(mockShowEntraUnavailableDetails).toHaveBeenCalledOnce();
        expect(context.selectedAuthMethod).toBeUndefined();
        expect(context.selectedAuthenticationMethod).toBeUndefined();
        expect(context.telemetry.properties).toMatchObject({ authMethod: undefined });
        expect(mockSettingsUpdate).not.toHaveBeenCalled();
    });

    it('waits for details to settle before reprompting or selecting authentication', async () => {
        let closeDetails!: () => void;
        let detailsOpened!: () => void;
        const detailsStarted = new Promise<void>((resolve) => {
            detailsOpened = resolve;
        });
        mockShowEntraUnavailableDetails.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    closeDetails = resolve;
                    detailsOpened();
                }),
        );
        const showQuickPick = vi
            .fn()
            .mockImplementationOnce((items: ReturnType<typeof createAuthMethodQuickPickItems>) =>
                Promise.resolve(items.find((item) => item.entraUnavailable)),
            )
            .mockResolvedValueOnce({ authMethod: AuthMethodId.NativeAuth });
        const context = {
            connectionString: 'mongodb://other.example.com/',
            availableAuthMethods: [],
            telemetry: { properties: {}, measurements: {} },
            ui: { showQuickPick },
            selectedAuthMethod: undefined as AuthMethodId | undefined,
            selectedAuthenticationMethod: undefined as AuthMethodId | undefined,
        };

        const pending = makeStep().prompt(context as never);
        await detailsStarted;
        expect(showQuickPick).toHaveBeenCalledOnce();
        expect(context.selectedAuthMethod).toBeUndefined();
        expect(context.selectedAuthenticationMethod).toBeUndefined();
        expect(context.telemetry.properties).toMatchObject({ authMethod: undefined });
        expect(mockSettingsUpdate).not.toHaveBeenCalled();
        closeDetails();
        await pending;

        expect(showQuickPick).toHaveBeenCalledTimes(2);
        expect(context.selectedAuthMethod ?? context.selectedAuthenticationMethod).toBe(AuthMethodId.NativeAuth);
    });
});

describe('rejected OIDC explanation', () => {
    it('makes both identity routes reachable for an approved first-open link with no stored methods', async () => {
        const context = {
            connectionString: 'mongodb://cluster.mongocluster.cosmos.azure.com/',
            availableAuthMethods: [],
            telemetry: { properties: {}, measurements: {} },
            ui: { showQuickPick: vi.fn().mockResolvedValue({ authMethod: AuthMethodId.MicrosoftEntraID }) },
            selectedAuthMethod: undefined as AuthMethodId | undefined,
        };

        await new ChooseAuthMethodStep().prompt(context as never);

        expect(context.availableAuthMethods).toContain(AuthMethodId.ManagedIdentity);
        const identityStep = new SelectEntraTokenSourceStep<AuthenticateWizardContext>(
            (wizardContext) => wizardContext.selectedAuthMethod,
            (wizardContext, method) => {
                wizardContext.selectedAuthMethod = method;
            },
        );
        expect(identityStep.shouldPrompt(context as never)).toBe(true);
    });

    it.each([
        ['new connection', () => new NewConnectionAuthStep()],
        ['first-open authentication', () => new ChooseAuthMethodStep()],
    ])('explains why %s cannot use declared OIDC', async (_name, makeStep) => {
        const showQuickPick = vi.fn().mockResolvedValue({ authMethod: AuthMethodId.NativeAuth });
        const context = {
            connectionString: 'mongodb://other.example.com/?authMechanism=MONGODB-OIDC',
            connectionStringAuthFacts: { usesOidc: true },
            availableAuthMethods: [],
            telemetry: { properties: {}, measurements: {} },
            ui: { showQuickPick },
        };

        await makeStep().prompt(context as never);

        expect(showQuickPick.mock.calls[0][1].placeHolder).toBe(
            "This server can't use Microsoft Entra ID. Choose another method.",
        );
    });

    it('does not auto-select a rejected Entra-only family', async () => {
        const showQuickPick = vi.fn().mockResolvedValue({ authMethod: AuthMethodId.NativeAuth });
        const context = {
            entraDestinationAllowed: true,
            connectionString: 'mongodb://other.example.com/',
            availableAuthMethods: [AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity],
            telemetry: { properties: {}, measurements: {} },
            ui: { showQuickPick },
            selectedAuthMethod: undefined as AuthMethodId | undefined,
        };

        await new ChooseAuthMethodStep().prompt(context as never);

        expect(showQuickPick).toHaveBeenCalledOnce();
        expect(context.selectedAuthMethod).toBe(AuthMethodId.NativeAuth);
    });
});
