/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { l10n, window } from 'vscode';
import { areAllHostsLocal, canonicalizeTlsException } from '../../documentdb/utils/tlsException';
import { ext } from '../../extensionVariables';
import { ConnectionStorageService, ConnectionType, isConnection } from '../../services/connectionStorageService';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { nonNullValue } from '../../utils/nonNull';
import { type UpdateCSWizardContext } from './UpdateCSWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<UpdateCSWizardContext> {
    public priority: number = 100;

    public async execute(context: UpdateCSWizardContext): Promise<void> {
        const resourceType =
            context.storageZone ?? (context.isEmulator ? ConnectionType.Emulators : ConnectionType.Clusters);
        const connection = await ConnectionStorageService.get(context.storageId, resourceType);

        if (!connection || !connection.secrets?.connectionString) {
            ext.outputChannel.error(
                l10n.t('Failed to update connection: connection not found in storage or missing connection string.'),
            );
            void window.showErrorMessage(l10n.t('Failed to update the connection.'));
            return;
        }

        try {
            // Canonicalize the edited connection string: strip any TLS-bypass param and keep
            // `emulatorConfiguration.disableEmulatorSecurity` as the single source of truth (§7).
            // Recompute the exception host-gated against the EDITED hosts: honor a freshly-requested
            // bypass OR preserve an existing exception, but ONLY while every host stays local/private.
            // Editing to a public/mixed host therefore CLEARS allow-invalid so the public host
            // validates certificates (it never stays latched from the old value).
            const canonicalTls = canonicalizeTlsException(
                nonNullValue(context.newConnectionString?.trim(), 'context.newConnectionString', 'ExecuteStep.ts'),
            );

            connection.secrets = {
                ...connection.secrets,
                connectionString: canonicalTls.connectionString,
            };

            if (isConnection(connection)) {
                // Host-gate BOTH emulator flags against the EDITED hosts. Editing a local emulator or
                // TLS-exception connection to a public/mixed host therefore CLEARS allow-invalid (so
                // the public host validates certificates) AND clears `isEmulator` in storage — neither
                // flag stays latched from the old local value. A still-local edit preserves both.
                // (Note: a legacy connection still rendered under the Emulators tree node is forced to
                // `isEmulator:true` at runtime by LocalEmulatorsItem regardless of the stored value, so
                // the "(Emulator)" label/timeout there only fully clears once the §4 migration retires
                // that node; the security-relevant `disableEmulatorSecurity` is honored from storage.)
                const existing = connection.properties.emulatorConfiguration;
                const allLocal = areAllHostsLocal(canonicalTls.connectionString);
                const disableEmulatorSecurity =
                    allLocal && (canonicalTls.disableEmulatorSecurity || !!existing?.disableEmulatorSecurity);
                const isEmulator = allLocal && !!existing?.isEmulator;
                connection.properties.emulatorConfiguration =
                    isEmulator || disableEmulatorSecurity ? { isEmulator, disableEmulatorSecurity } : undefined;
            }

            await ConnectionStorageService.save(resourceType, connection, true);

            showConfirmationAsInSettings(l10n.t('Connection updated successfully.'));
        } catch (pushError) {
            ext.outputChannel.error(l10n.t('Failed to update connection: {0}', String(pushError)));
            void window.showErrorMessage(l10n.t('Failed to update the connection.'));
        }
    }

    public shouldExecute(context: UpdateCSWizardContext): boolean {
        return !!context.newConnectionString && context.newConnectionString !== context.originalConnectionString;
    }
}
