/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const test = require('node:test');
const { checkAzureArmEsm } = require('./check.cjs');

test('azureauth ARM subscription subpaths expose runtime functions and bundle only ESM modules', async () => {
    await checkAzureArmEsm();
});
