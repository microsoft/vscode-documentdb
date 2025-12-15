/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n, ThemeIcon } from 'vscode';

/**
 * Configuration constants for the Azure Cosmos DB for MongoDB (vCore) discovery provider.
 */

/** Unique identifier for this discovery provider */
export const DISCOVERY_PROVIDER_ID = 'azure-mongo-vcore-discovery';

/** Resource type identifier for telemetry */
export const RESOURCE_TYPE = 'mongoVCore';

/** Display label for the discovery provider */
export const LABEL = l10n.t('Azure DocumentDB');

/** Description shown in the discovery provider list */
export const DESCRIPTION = l10n.t('Azure Service Discovery for Azure DocumentDB');

/** Icon for the discovery provider */
export const ICON_PATH = new ThemeIcon('azure');

/** Title shown in the discovery wizard */
export const WIZARD_TITLE = l10n.t('Azure Service Discovery');
