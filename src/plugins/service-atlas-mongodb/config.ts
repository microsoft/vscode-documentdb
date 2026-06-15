/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n, ThemeIcon } from 'vscode';

/**
 * Configuration constants for the Atlas MongoDB discovery provider.
 */

/** Unique identifier for this discovery provider */
export const DISCOVERY_PROVIDER_ID = 'atlas-mongodb-discovery';

/** Display label for the discovery provider */
export const LABEL = l10n.t('Atlas MongoDB');

/** Description shown in the discovery provider list */
export const DESCRIPTION = l10n.t('Service Discovery for MongoDB Atlas');

/** Icon for the discovery provider */
export const ICON_PATH = new ThemeIcon('cloud');

/** Title shown in the discovery wizard */
export const WIZARD_TITLE = l10n.t('Atlas MongoDB Service Discovery');

/** Base URL for Atlas Admin API v2 */
export const ATLAS_API_BASE_URL = 'https://cloud.mongodb.com/api/atlas/v2';

/** Atlas OAuth 2.0 Device Flow endpoints (from go.mongodb.org/atlas/auth) */
export const ATLAS_OAUTH_DEVICE_AUTHORIZE_URL = 'https://cloud.mongodb.com/api/private/unauth/account/device/authorize';
export const ATLAS_OAUTH_TOKEN_URL = 'https://cloud.mongodb.com/api/private/unauth/account/device/token';

/** Atlas Service Account OAuth 2.0 token endpoint (client_credentials grant) */
export const ATLAS_SERVICE_ACCOUNT_TOKEN_URL = 'https://cloud.mongodb.com/api/oauth/token';

/** Secret storage key prefixes */
export const SECRET_KEY_PREFIX = 'atlas-mongodb';

/** Global state keys */
export const STATE_AUTH_METHOD = `${SECRET_KEY_PREFIX}.authMethod`;
export const STATE_SELECTED_PROJECTS = `${SECRET_KEY_PREFIX}.selectedProjects`;
export const STATE_SELECTED_ORG_ID = `${SECRET_KEY_PREFIX}.selectedOrgId`;
export const STATE_USER_DISPLAY_NAME = `${SECRET_KEY_PREFIX}.userDisplayName`;
