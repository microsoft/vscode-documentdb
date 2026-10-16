/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('node:assert/strict');
const test = require('node:test');
const { checkLoweredImport } = require('./check.cjs');

test('azureauth-style lowered import() of @azure/arm-resources-subscriptions yields its namespace', async () => {
    await checkLoweredImport();
});

test('negative control: without the CommonJS alias, the lowered import() yields undefined (G5-I01)', async () => {
    await assert.rejects(
        checkLoweredImport({ withoutAlias: true }),
        /Lowered import\(\) of @azure\/arm-resources-subscriptions returned undefined, not its namespace/,
    );
});
