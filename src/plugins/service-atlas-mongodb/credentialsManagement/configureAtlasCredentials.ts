/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AzureWizard,
    callWithTelemetryAndErrorHandling,
    UserCancelledError,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { randomUUID } from 'crypto';
import { ext } from '../../../extensionVariables';
import { type TreeElement } from '../../../tree/TreeElement';
import { DISCOVERY_PROVIDER_ID } from '../config';
import { type AtlasDiscoveryService } from '../discovery/AtlasDiscoveryService';
import { AtlasCredentialActionStep } from './AtlasCredentialActionStep';
import { type AtlasCredentialsManagementWizardContext } from './AtlasCredentialsManagementWizardContext';
import {
    ATLAS_CREDENTIAL_ADDED,
    ATLAS_CREDENTIAL_MANAGEMENT_EXIT,
    SelectAtlasCredentialStep,
} from './SelectAtlasCredentialStep';

/**
 * Entry point for "Manage MongoDB Atlas Credentials".
 *
 * Deliberately mirrors {@link configureAzureCredentials}: an `AzureWizard` of QuickPick prompt
 * steps, `GoBackError` for navigation, and a sentinel `UserCancelledError` message to distinguish
 * a graceful exit from a real cancellation. Keeping the two providers on the same shape is what
 * makes the credential flows maintainable side by side.
 *
 * One deliberate difference: leaving this flow always forces a full Atlas refresh, not only when
 * storage changed. See the comment at the call site.
 *
 * @returns `true` when credential storage changed and the caller (for example the connection
 * wizard) may proceed.
 */
export async function configureAtlasCredentials(
    context: IActionContext,
    discoveryService: AtlasDiscoveryService,
    node?: TreeElement,
): Promise<boolean> {
    const result = await callWithTelemetryAndErrorHandling(
        'serviceDiscovery.configureAtlasCredentials',
        async (telemetryContext: IActionContext) => {
            const journeyCorrelationId = context.telemetry.properties.journeyCorrelationId ?? randomUUID();
            telemetryContext.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
            telemetryContext.telemetry.properties.nodeProvided = node ? 'true' : 'false';
            telemetryContext.telemetry.properties.journeyCorrelationId = journeyCorrelationId;
            context.telemetry.properties.journeyCorrelationId = journeyCorrelationId;

            const wizardContext: AtlasCredentialsManagementWizardContext = {
                ...telemetryContext,
                discoveryService,
                // Initialised with [] so AzureWizard captures it in propertiesBeforePrompt and it
                // survives back navigation (null/undefined values are filtered out).
                credentials: [],
                selectedCredentialId: undefined,
                changed: false,
            };

            const wizard = new AzureWizard(wizardContext, {
                title: l10n.t('Manage MongoDB Atlas Credentials'),
                promptSteps: [new SelectAtlasCredentialStep(), new AtlasCredentialActionStep()],
            });

            try {
                await wizard.prompt();
            } catch (error) {
                if (!(error instanceof UserCancelledError)) {
                    throw error;
                }

                if (error.message === ATLAS_CREDENTIAL_ADDED) {
                    telemetryContext.telemetry.properties.credentialsManagementResult = 'Succeeded';
                    ext.outputChannel.info(l10n.t('MongoDB Atlas credential added.'));
                } else if (error.message === ATLAS_CREDENTIAL_MANAGEMENT_EXIT) {
                    telemetryContext.telemetry.properties.credentialsManagementResult = 'Succeeded';
                } else {
                    telemetryContext.telemetry.properties.credentialsManagementResult = 'Canceled';
                }
            }

            // Credential management always ends with a full Atlas refresh, even when nothing was
            // stored. This is deliberately stronger than the shared discovery default of
            // refreshing only when storage changed, because Atlas has state the extension cannot
            // observe: the user may have granted a role or added project access in the Atlas UI
            // while this QuickPick was open, and a Service Account access token carries the scope
            // it was minted with for about an hour. Dropping the sessions as well as the snapshot
            // is what makes such a change visible immediately instead of at the next token expiry.
            discoveryService.reset();
            refreshDiscoveryTree(node);

            // Only report success when something actually happened; a cancelled or dismissed flow
            // must never claim that credential management completed.
            context.telemetry.properties.credentialsManagementResult =
                telemetryContext.telemetry.properties.credentialsManagementResult ?? 'Canceled';

            return wizardContext.changed;
        },
    );

    return result ?? false;
}

function refreshDiscoveryTree(node?: TreeElement): void {
    if (node?.id) {
        ext.discoveryBranchDataProvider.resetNodeErrorState(node.id);
    }
    if (node) {
        ext.discoveryBranchDataProvider.refresh(node);
    } else {
        ext.discoveryBranchDataProvider.refresh();
    }
}
