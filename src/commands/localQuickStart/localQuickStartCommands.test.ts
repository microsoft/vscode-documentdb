/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { QuickStartService } from '../../services/localQuickStart/QuickStartService';
import { InstanceState } from '../../services/localQuickStart/quickStartTypes';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { buildQuickStartCopyCredentials, deleteQuickStartInstance } from './localQuickStartCommands';

jest.mock('../../services/localQuickStart/QuickStartService', () => ({
    QuickStartService: { getStatus: jest.fn(), deleteContainer: jest.fn() },
}));
jest.mock('../../utils/dialogs/getConfirmation', () => ({ getConfirmationAsInSettings: jest.fn() }));
jest.mock('../../utils/dialogs/showConfirmation', () => ({ showConfirmationAsInSettings: jest.fn() }));

// UX review #7: the Quick Start "Copy Connection String" reuses the shared copy flow, which treats
// credentials.connectionString as a PASSWORD-FREE base (the password lives only in nativeAuthConfig).
// The Quick Start metadata string embeds the password, so the helper must strip it — otherwise
// "copy without password" would leak the password.
describe('buildQuickStartCopyCredentials (UX review #7)', () => {
    it('strips the embedded password from the base and carries it in nativeAuthConfig', () => {
        const credentials = buildQuickStartCopyCredentials(
            'mongodb://admin:s3cr3tPass@localhost:10260/?tls=true&tlsAllowInvalidCertificates=true',
            'admin',
        );

        expect(credentials).toBeDefined();
        // The base string handed to the shared copy flow must not contain the password.
        expect(credentials?.connectionString).not.toContain('s3cr3tPass');
        // The password is carried separately so the with-password branch can add it back.
        expect(credentials?.nativeAuthConfig?.connectionPassword).toBe('s3cr3tPass');
        expect(credentials?.nativeAuthConfig?.connectionUser).toBe('admin');
        expect(credentials?.selectedAuthMethod).toBe(AuthMethodId.NativeAuth);
    });

    it('handles a password-free connection string (no prompt path)', () => {
        const credentials = buildQuickStartCopyCredentials('mongodb://localhost:10260/?tls=true', 'admin');

        expect(credentials?.connectionString).not.toContain('@'); // no userinfo embedded
        expect(credentials?.nativeAuthConfig?.connectionPassword).toBe('');
    });

    it('fails closed (returns undefined) when the connection string cannot be parsed', () => {
        expect(buildQuickStartCopyCredentials('not a valid connection string', 'admin')).toBeUndefined();
    });
});

// GPT-5.6 review #1: the "DocumentDB Local container deleted." toast must be gated on the ACTUAL
// delete outcome. deleteContainer() refuses to touch a foreign container (returns 'refused') and
// no-ops when the alias is busy (returns 'busy'); in both cases nothing was removed, so a success
// toast would be contradictory and the instance would still be in the tree.
describe('deleteQuickStartInstance — success toast gated on the delete outcome (GPT-5.6 review #1)', () => {
    const getStatus = QuickStartService.getStatus as jest.Mock;
    const deleteContainer = QuickStartService.deleteContainer as jest.Mock;
    const confirm = getConfirmationAsInSettings as unknown as jest.Mock;
    const showToast = showConfirmationAsInSettings as unknown as jest.Mock;

    const makeContext = () =>
        ({ telemetry: { properties: {} as Record<string, string>, measurements: {} } }) as unknown as Parameters<
            typeof deleteQuickStartInstance
        >[0];

    beforeEach(() => {
        jest.clearAllMocks();
        getStatus.mockReturnValue({ state: InstanceState.Stopped });
        confirm.mockResolvedValue(true);
    });

    it('shows the confirmation only when the instance was actually removed', async () => {
        deleteContainer.mockResolvedValue('deleted');
        await deleteQuickStartInstance(makeContext());
        expect(deleteContainer).toHaveBeenCalledTimes(1);
        expect(showToast).toHaveBeenCalledTimes(1);
    });

    it('stays silent (no false success) when a foreign container is refused', async () => {
        deleteContainer.mockResolvedValue('refused');
        const context = makeContext();
        await deleteQuickStartInstance(context);
        expect(showToast).not.toHaveBeenCalled();
        expect(context.telemetry.properties.deleteOutcome).toBe('refused');
    });

    it('stays silent when the alias is busy (another lifecycle op is running)', async () => {
        deleteContainer.mockResolvedValue('busy');
        await deleteQuickStartInstance(makeContext());
        expect(showToast).not.toHaveBeenCalled();
    });

    it('stays silent when removing our container fails (the service already showed the error)', async () => {
        deleteContainer.mockResolvedValue('error');
        const context = makeContext();
        await deleteQuickStartInstance(context);
        expect(showToast).not.toHaveBeenCalled();
        expect(context.telemetry.properties.deleteOutcome).toBe('error');
    });

    it('does not delete or toast when the user cancels the confirmation', async () => {
        confirm.mockResolvedValue(false);
        await deleteQuickStartInstance(makeContext());
        expect(deleteContainer).not.toHaveBeenCalled();
        expect(showToast).not.toHaveBeenCalled();
    });
});
