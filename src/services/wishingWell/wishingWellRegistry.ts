/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type WishingWellService } from './WishingWellService';

/**
 * Lets the shell reach the well without importing it: the well imports the shell's opener, so a
 * direct import would be a cycle. Set once on activation.
 */
let current: Pick<WishingWellService, 'makeWish' | 'feelingLucky' | 'grant'> | undefined;

export function setWishingWell(well: typeof current): void {
    current = well;
}

export function currentWishingWell(): typeof current {
    return current;
}
