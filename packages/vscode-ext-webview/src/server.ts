/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Transitional compatibility shim for the legacy `./server` subpath.
 *
 * The host code now lives under `./host` and the side-agnostic code under `.`.
 * This file re-exports both so the historical `./server` entry keeps resolving
 * during the restructure. It is removed in WI-B4 when the package's `exports`
 * map is rewired to the four-subpath layout (`.`, `./host`, `./webview`,
 * `./react`).
 */

export * from './host';
export * from './shared';

