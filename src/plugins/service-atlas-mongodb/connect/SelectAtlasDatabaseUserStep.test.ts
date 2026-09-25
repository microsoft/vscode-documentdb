/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import { AuthMethodId } from '../../../documentdb/auth/AuthMethod';
import { type AuthenticateWizardContext } from '../../../documentdb/wizards/authenticate/AuthenticateWizardContext';
import { type AtlasDatabaseUserCandidate } from './atlasDatabaseUsers';
import { SelectAtlasDatabaseUserStep } from './SelectAtlasDatabaseUserStep';

jest.mock('@vscode/l10n', () => ({
    t: jest.fn((message: string, values?: Record<string, string>) => {
        if (!values) {
            return message;
        }
        return Object.entries(values).reduce((result, [key, value]) => result.replace(`{${key}}`, value), message);
    }),
}));

jest.mock('vscode', () => ({
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    QuickPickItemKind: { Separator: -1, Default: 0 },
    ProgressLocation: { Window: 10, Notification: 15 },
    l10n: {
        t: jest.fn((message: string) => message),
    },
    window: {
        withProgress: async (_options: unknown, task: () => Promise<unknown>) => task(),
    },
}));

jest.mock('@microsoft/vscode-azext-utils', () => ({
    AzureWizardPromptStep: class AzureWizardPromptStep {},
    UserCancelledError: class UserCancelledError extends Error {},
}));

jest.mock('../atlasTrace', () => ({
    atlasTrace: jest.fn(),
    atlasWarn: jest.fn(),
}));

interface PickItem {
    label: string;
    kind?: number;
    candidate?: AtlasDatabaseUserCandidate;
    isCustomOption?: boolean;
}

const showQuickPick = jest.fn();
const showWarningMessage = jest.fn();

function createContext(): AuthenticateWizardContext {
    return {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: {},
        valuesToMask: [],
        ui: { showQuickPick, showWarningMessage },
        adminUserName: undefined,
        resourceName: 'Cluster0',
        availableAuthMethods: [AuthMethodId.NativeAuth],
        selectedAuthMethod: AuthMethodId.NativeAuth,
    } as unknown as AuthenticateWizardContext;
}

function scram(username: string): AtlasDatabaseUserCandidate {
    return { username, supported: true, authMethodLabel: 'Username and password' };
}

function federated(username: string, authMethodLabel: string): AtlasDatabaseUserCandidate {
    return { username, supported: false, authMethodLabel };
}

function createStep(users: AtlasDatabaseUserCandidate[] | Error): SelectAtlasDatabaseUserStep {
    return new SelectAtlasDatabaseUserStep(async () => {
        if (users instanceof Error) {
            throw users;
        }
        return users;
    }, 'Cluster0');
}

beforeEach(() => {
    showQuickPick.mockReset();
    showWarningMessage.mockReset();
});

describe('SelectAtlasDatabaseUserStep decisions', () => {
    it('stays out of the way when the project has no database users', async () => {
        const context = createContext();
        const step = createStep([]);

        await step.configureBeforePrompt(context);

        expect(step.shouldPrompt(context)).toBe(false);
        expect(context.adminUserName).toBeUndefined();
        expect(context.telemetry.properties.atlasDatabaseUserSource).toBe('unavailable');
    });

    it('stays out of the way when the lookup fails, so a convenience never blocks sign-in', async () => {
        const context = createContext();
        const step = createStep(new Error('403 IP_ADDRESS_NOT_ON_ACCESS_LIST'));

        await step.configureBeforePrompt(context);

        expect(step.shouldPrompt(context)).toBe(false);
        expect(context.adminUserName).toBeUndefined();
        expect(context.telemetry.properties.atlasDatabaseUserSource).toBe('failed');
    });

    it('prefills the username prompt instead of showing a list of one', async () => {
        const context = createContext();
        const step = createStep([scram('app_rw')]);

        await step.configureBeforePrompt(context);

        expect(step.shouldPrompt(context)).toBe(false);
        expect(context.adminUserName).toBe('app_rw');
        expect(context.telemetry.properties.atlasDatabaseUserSource).toBe('prefilled');
    });

    it('still shows the list for a single unusable user, so the reason is visible', async () => {
        const context = createContext();
        const step = createStep([federated('CN=svc,OU=eng', 'X.509')]);

        await step.configureBeforePrompt(context);

        expect(step.shouldPrompt(context)).toBe(true);
        expect(context.adminUserName).toBeUndefined();
    });

    it('does not prompt once a username is already known', async () => {
        const context = createContext();
        context.selectedUserName = 'already_chosen';
        const step = createStep([scram('a'), scram('b')]);

        await step.configureBeforePrompt(context);

        expect(step.shouldPrompt(context)).toBe(false);
    });

    it('does not prompt when a non-native authentication method was chosen', async () => {
        const context = createContext();
        context.selectedAuthMethod = AuthMethodId.MicrosoftEntraID;
        const step = createStep([scram('a'), scram('b')]);

        await step.configureBeforePrompt(context);

        expect(step.shouldPrompt(context)).toBe(false);
    });
});

describe('SelectAtlasDatabaseUserStep list', () => {
    it('offers manual entry first and groups usable users apart from the rest', async () => {
        const context = createContext();
        const step = createStep([scram('app_rw'), federated('CN=svc,OU=eng', 'X.509'), scram('analytics_ro')]);
        await step.configureBeforePrompt(context);

        showQuickPick.mockImplementation((items: PickItem[]) => {
            expect(items[0].isCustomOption).toBe(true);
            expect(items.map((item) => item.label)).toEqual([
                'Enter a username',
                'Username and password (SCRAM)',
                'app_rw',
                'analytics_ro',
                'Not supported yet',
                'CN=svc,OU=eng',
            ]);
            return Promise.resolve(items[0]);
        });

        await step.prompt(context);

        expect(showQuickPick).toHaveBeenCalledTimes(1);
    });

    it('records a picked user so the username prompt is skipped', async () => {
        const context = createContext();
        const step = createStep([scram('app_rw'), scram('analytics_ro')]);
        await step.configureBeforePrompt(context);

        showQuickPick.mockImplementation((items: PickItem[]) =>
            Promise.resolve(items.find((item) => item.candidate?.username === 'analytics_ro')),
        );

        await step.prompt(context);

        expect(context.selectedUserName).toBe('analytics_ro');
        expect(context.nativeAuthConfig?.connectionUser).toBe('analytics_ro');
        expect(context.isUserNameUpdated).toBe(true);
        expect(context.valuesToMask).toContain('analytics_ro');
        expect(context.telemetry.properties.atlasDatabaseUserSource).toBe('picked');
    });

    it('leaves the username unset when manual entry is chosen', async () => {
        const context = createContext();
        const step = createStep([scram('app_rw'), scram('analytics_ro')]);
        await step.configureBeforePrompt(context);

        showQuickPick.mockImplementation((items: PickItem[]) => Promise.resolve(items[0]));

        await step.prompt(context);

        expect(context.selectedUserName).toBeUndefined();
        expect(context.telemetry.properties.atlasDatabaseUserSource).toBe('custom');
    });

    it('explains an unusable user and returns to the list rather than accepting it', async () => {
        const context = createContext();
        const step = createStep([scram('app_rw'), federated('CN=svc,OU=eng', 'X.509')]);
        await step.configureBeforePrompt(context);

        showQuickPick
            .mockImplementationOnce((items: PickItem[]) =>
                Promise.resolve(items.find((item) => item.candidate?.supported === false)),
            )
            .mockImplementationOnce((items: PickItem[]) =>
                Promise.resolve(items.find((item) => item.candidate?.username === 'app_rw')),
            );

        await step.prompt(context);

        expect(showWarningMessage).toHaveBeenCalledTimes(1);
        expect(showQuickPick).toHaveBeenCalledTimes(2);
        expect(context.selectedUserName).toBe('app_rw');
        expect(context.telemetry.properties.atlasDatabaseUserUnsupportedPicked).toBe('true');
    });

    it('returns to the list when the explanation modal is dismissed instead of cancelling sign-in', async () => {
        const context = createContext();
        const step = createStep([scram('app_rw'), federated('CN=svc,OU=eng', 'X.509')]);
        await step.configureBeforePrompt(context);

        // azext-utils reports a dismissed modal as a cancellation; here it means "never mind".
        showWarningMessage.mockRejectedValueOnce(new UserCancelledError());

        showQuickPick
            .mockImplementationOnce((items: PickItem[]) =>
                Promise.resolve(items.find((item) => item.candidate?.supported === false)),
            )
            .mockImplementationOnce((items: PickItem[]) => Promise.resolve(items[0]));

        await step.prompt(context);

        expect(showQuickPick).toHaveBeenCalledTimes(2);
        expect(context.telemetry.properties.atlasDatabaseUserSource).toBe('custom');
    });
});
