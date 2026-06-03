/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Centralised, named constants for the Index Management view. Keeping these
 * in one place avoids magic values scattered through the code and makes the
 * behaviour easy to tune in one spot.
 */

/** Document-count threshold above which the create-index dialog shows the build-performance warning banner. */
export const LARGE_COLLECTION_THRESHOLD_DOCS = 1_000_000;

/** Maximum number of field suggestions surfaced in the create-index dropdown. */
export const FIELD_SUGGESTION_LIMIT = 200;

/** Name of the immutable system `_id` index. */
export const DEFAULT_ID_INDEX_NAME = '_id_';

/** Index key special value for text indexes. */
export const TEXT_INDEX_DIRECTION = 'text';

/** Index key special values recognised as geospatial. */
export const GEOSPATIAL_INDEX_DIRECTIONS: ReadonlySet<string> = new Set(['2dsphere', '2d', 'geoHaystack']);

/** Conventional sort directions for traditional (b-tree) indexes. */
export const ASC_DIRECTION = 1 as const;
export const DESC_DIRECTION = -1 as const;

/**
 * Cross-component event used by the CollectionView toolbar to trigger the
 * Create Index dialog inside IndexesTab. Decouples the two components
 * without requiring a shared React context.
 */
export const OPEN_CREATE_INDEX_EVENT = 'documentdb:openCreateIndex';
