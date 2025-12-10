/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n, ThemeIcon } from 'vscode';

/**
 * Configuration constants for the Azure VM discovery provider.
 */

/** Unique identifier for this discovery provider */
export const DISCOVERY_PROVIDER_ID = 'azure-vm-discovery';

/** Resource type identifier for telemetry */
export const RESOURCE_TYPE = 'azureVM';

/** Display label for the discovery provider */
export const LABEL = l10n.t('Azure VMs (DocumentDB)');

/** Description shown in the discovery provider list */
export const DESCRIPTION = l10n.t('Azure VM Service Discovery');

/** Icon for the discovery provider */
export const ICON_PATH = new ThemeIcon('vm');

/** Title shown in the discovery wizard */
export const WIZARD_TITLE = l10n.t('Azure VM Service Discovery');
