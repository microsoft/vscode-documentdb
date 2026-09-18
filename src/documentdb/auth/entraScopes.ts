/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The Microsoft Entra ID resource that DocumentDB (and the wider Azure OSS RDBMS family) accepts
 * tokens for.
 *
 * This is the `TOKEN_RESOURCE` value used in the driver-native connection string form documented on
 * Microsoft Learn, and the base of the `.default` scope requested by every Entra-based auth path in
 * this extension.
 */
export const DOCUMENTDB_TOKEN_RESOURCE = 'https://ossrdbms-aad.database.windows.net';

/** The scope form of {@link DOCUMENTDB_TOKEN_RESOURCE}, as passed to token providers. */
export const DOCUMENTDB_ENTRA_SCOPE = `${DOCUMENTDB_TOKEN_RESOURCE}/.default`;
