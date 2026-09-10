/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Entry point `./components`.
 *
 * Deliberately imports neither `theme/` nor `styles/`: a component must not require the
 * package's theming, and importing this entry must not inject a stylesheet (invariant I1).
 */

export * from './components/index.js';
