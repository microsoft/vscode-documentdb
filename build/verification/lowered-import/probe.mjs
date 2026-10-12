/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Built with `vite.config.ext.mjs` as a host entry, as the extension bundles azureauth's CommonJS.
import { loadArmSubscriptions } from './azureauthLowering.cjs';

export { loadArmSubscriptions };
