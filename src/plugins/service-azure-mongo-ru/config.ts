/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n, ThemeIcon } from 'vscode';

/**
 * Configuration constants for the Azure Cosmos DB for MongoDB (RU) discovery provider.
 */

/** Unique identifier for this discovery provider */
export const DISCOVERY_PROVIDER_ID = 'azure-mongo-ru-discovery';

/** Resource type identifier for telemetry */
export const RESOURCE_TYPE = 'mongoRU';

/** Display label for the discovery provider */
export const LABEL = l10n.t('Azure Cosmos DB for MongoDB (RU)');

/** Description shown in the discovery provider list */
export const DESCRIPTION = l10n.t('Azure Service Discovery for MongoDB RU');

/** Icon for the discovery provider */
export const ICON_PATH = new ThemeIcon('azure');

/** Title shown in the discovery wizard */
export const WIZARD_TITLE = l10n.t('Azure Service Discovery');
