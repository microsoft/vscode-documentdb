/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

jest.mock('vscode', () => ({
    l10n: { t: (message: string): string => message },
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
}));

jest.mock('@vscode/l10n', () => ({
    t: (message: string, ...args: unknown[]): string =>
        message.replace(/\{(\d+)\}/g, (_match: string, index: string) => String(args[Number(index)])),
}));

const mockOutputChannel = { info: jest.fn(), error: jest.fn() };
jest.mock('../../../extensionVariables', () => ({
    ext: { get outputChannel(): typeof mockOutputChannel { return mockOutputChannel; } },
}));
beforeEach(() => { jest.clearAllMocks(); });

jest.mock('@microsoft/vscode-azext-utils', () => ({
    AzureWizardPromptStep: class AzureWizardPromptStep {},
}));

import { AuthMethodId } from '../../auth/AuthMethod';
import { PromptAuthMethodStep as NewConnectionAuthStep } from '../../../commands/newConnection/PromptAuthMethodStep';
import { PromptAuthMethodStep as UpdateCredentialsAuthStep } from '../../../commands/updateCredentials/PromptAuthMethodStep';
import { type AuthenticateWizardContext } from './AuthenticateWizardContext';
import { ChooseAuthMethodStep } from './ChooseAuthMethodStep';

describe('ChooseAuthMethodStep authentication families', () => {
    it('auto-selects the Entra family when account and managed identity are the only methods', async () => {
        const showQuickPick = jest.fn();
        const context = {
            availableAuthMethods: [AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity],
            telemetry: { properties: {}, measurements: {} },
            ui: { showQuickPick },
        } as unknown as AuthenticateWizardContext;

        await new ChooseAuthMethodStep().prompt(context);

        expect(context.selectedAuthMethod).toBe(AuthMethodId.MicrosoftEntraID);
        expect(context.authenticationMethodPrompted).toBe(false);
        expect(context.telemetry.properties).toMatchObject({
            authMethod: AuthMethodId.MicrosoftEntraID, authMethodSelectionSource: 'autoSelected',
        });
        expect(showQuickPick).not.toHaveBeenCalled();
        expect(JSON.stringify(mockOutputChannel.info.mock.calls)).toContain('singleSupportedFamily');
    });

    it.each([['newConnection', new NewConnectionAuthStep()], ['updateCredentials', new UpdateCredentialsAuthStep()]])(
        'traces %s picker options and selection', async (source, step) => {
            const context = {
                telemetry: { properties: {}, measurements: {} },
                availableAuthenticationMethods: [AuthMethodId.NativeAuth, AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity],
                ui: { showQuickPick: jest.fn().mockResolvedValue({ authMethod: AuthMethodId.MicrosoftEntraID }) },
            };

            await step.prompt(context as never);

            expect(context.telemetry.properties).toMatchObject({
                authMethod: AuthMethodId.MicrosoftEntraID, authMethodSelectionSource: 'prompt',
            });

            const output = JSON.stringify(mockOutputChannel.info.mock.calls);
            expect(output).toContain(`${source}.authMethodPicker`);
            expect(output).toContain('NativeAuth,MicrosoftEntraID,NoAuth');
            expect(output).toContain(`${source}.authMethodSelected`);
        },
    );

    it('traces a family picker skipped because inference already chose the method', () => {
        const step = new NewConnectionAuthStep();
        const context = { selectedAuthenticationMethod: AuthMethodId.ManagedIdentity, telemetry: { properties: {}, measurements: {} } };
        expect(step.shouldPrompt(context as never)).toBe(false);
        expect(mockOutputChannel.info).not.toHaveBeenCalled();

        step.configureBeforePrompt(context as never);

        expect(context.telemetry.properties).toMatchObject({
            authMethod: AuthMethodId.ManagedIdentity, authMethodSelectionSource: 'preselected',
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
            ui: { showQuickPick: jest.fn().mockRejectedValue(error) },
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
