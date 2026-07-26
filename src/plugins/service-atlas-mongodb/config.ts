/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n, ThemeIcon } from 'vscode';

/**
 * Configuration constants for the MongoDB Atlas discovery provider.
 */

/** Unique identifier for this discovery provider */
export const DISCOVERY_PROVIDER_ID = 'atlas-mongodb-discovery';

/** Display label for the discovery provider */
export const LABEL = l10n.t('MongoDB Atlas');

/** Description shown in the discovery provider list */
export const DESCRIPTION = l10n.t('Service Discovery for MongoDB Atlas');

/** Icon for the discovery provider */
export const ICON_PATH = new ThemeIcon('cloud');

/** Title shown in the discovery wizard */
export const WIZARD_TITLE = l10n.t('MongoDB Atlas Service Discovery');

/** Base URL for Atlas Admin API v2 */
export const ATLAS_API_BASE_URL = 'https://cloud.mongodb.com/api/atlas/v2';

/** Atlas Service Account token endpoint (client_credentials grant) */
export const ATLAS_SERVICE_ACCOUNT_TOKEN_URL = 'https://cloud.mongodb.com/api/oauth/token';

/** Secret storage key prefixes */
export const SECRET_KEY_PREFIX = 'atlas-mongodb';

/** Global state keys */
export const STATE_AUTH_METHOD = `${SECRET_KEY_PREFIX}.authMethod`;
export const STATE_USER_DISPLAY_NAME = `${SECRET_KEY_PREFIX}.userDisplayName`;

/**
 * How the MongoDB Atlas discovery tree renders below its root:
 *
 * - `tree` (default): organization to project to cluster.
 * - `list`: a flat, deduplicated cluster list with `organization · project` in the description.
 *
 * Both modes render the same consolidated recovery row when a credential fails, so a failure
 * never forces a view-mode switch.
 */
export type AtlasViewMode = 'tree' | 'list';

/** Default view mode when the user has not toggled it yet. */
export const DEFAULT_ATLAS_VIEW_MODE: AtlasViewMode = 'tree';

/**
 * GlobalState key persisting the discovery tree {@link AtlasViewMode}.
 *
 * Stored directly via `ext.context.globalState`, matching the Kubernetes view-mode key, so the
 * last choice always persists without exposing a user-facing setting.
 */
export const DISCOVERY_VIEW_MODE_STATE_KEY = `${DISCOVERY_PROVIDER_ID}.viewMode`;
