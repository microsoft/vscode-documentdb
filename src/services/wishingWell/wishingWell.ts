/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WishingWellService } from './WishingWellService';
import { createWishPowers } from './wishPowers';

let instance: WishingWellService | undefined;

/** The extension's one well, shared by the tab, the shell, Copilot's tools and the MCP server. */
export function getWishingWell(): WishingWellService {
    instance ??= new WishingWellService(createWishPowers());
    return instance;
}
