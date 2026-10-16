/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AtlasCredentialRecord } from '../credentials/atlasCredentialStore';
import { type AtlasCredentialError, type AtlasDiscoveryService } from '../discovery/AtlasDiscoveryService';

/**
 * One credential plus its resolved display label and, when it is unhealthy, the reason.
 */
export interface AtlasCredentialStatus {
    readonly record: AtlasCredentialRecord;
    readonly label: string;
    readonly error?: AtlasCredentialError;
}

/**
 * Wizard context for the "Manage MongoDB Atlas Credentials" QuickPick flow.
 *
 * Mirrors the Azure `CredentialsManagementWizardContext` shape so both providers stay
 * maintainable side by side: a cached collection that is initialised to `[]` (so `AzureWizard`
 * captures it in `propertiesBeforePrompt` and it survives back navigation), a selected item, and
 * a flag telling the caller whether anything changed.
 */
export interface AtlasCredentialsManagementWizardContext extends IActionContext {
    /** Aggregation service used for credential status and single-credential retries. */
    readonly discoveryService: AtlasDiscoveryService;

    /**
     * All credentials with their current status. Initialised with `[]` so it is captured in
     * `propertiesBeforePrompt` and survives back navigation; cleared to force a reload.
     */
    credentials: AtlasCredentialStatus[];

    /** The credential the user drilled into, if any. */
    selectedCredentialId?: string;

    /** Set when storage changed, so the caller knows to refresh the discovery tree. */
    changed: boolean;
}
