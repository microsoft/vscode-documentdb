/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.loadArmSubscriptions = loadArmSubscriptions;

// TypeScript's CommonJS lowering of `await import(...)`, character for character as in
// @microsoft/vscode-azext-azureauth's VSCodeAzureSubscriptionProvider.getSubscriptionClient.
function loadArmSubscriptions() {
    return Promise.resolve().then(() => require('@azure/arm-resources-subscriptions'));
}
