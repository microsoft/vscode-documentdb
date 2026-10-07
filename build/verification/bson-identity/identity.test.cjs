/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('node:assert/strict');
const test = require('node:test');
const { checkBsonIdentity } = require('./check.cjs');

test('host and playground worker graphs reach one ObjectId constructor', async () => {
    const results = await checkBsonIdentity();
    for (const name of ['main', 'playgroundWorker']) {
        assert.deepEqual(results[name].bsonModules, ['bson/lib/bson.cjs']);
    }
});

test('negative control: without the bson alias, the ES-module route gets a second copy', async () => {
    await assert.rejects(
        checkBsonIdentity({ withoutAlias: true }),
        /ObjectId via bson \(ES module\) is not the same constructor[^\n]*bson\/lib\/bson\.node\.mjs/,
    );
});
