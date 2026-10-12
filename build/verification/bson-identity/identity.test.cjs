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
        assert.ok(results[name].routes.includes('bson (dynamic import)'), `${name}: no dynamic import route`);
        assert.ok(results[name].routes.includes('mongodb (dynamic import)'), `${name}: no dynamic import route`);
    }
});

test('negative control: without the bson alias, the ES-module and dynamic-import routes get a second copy', async () => {
    await assert.rejects(checkBsonIdentity({ withoutAlias: true }), (error) => {
        for (const name of ['main', 'playgroundWorker']) {
            for (const route of ['ES module', 'dynamic import']) {
                assert.match(
                    error.message,
                    new RegExp(
                        `${name}: ObjectId via bson \\(${route}\\) is not the same constructor[^\\n]*bson/lib/bson\\.node\\.mjs`,
                    ),
                );
            }
        }
        return true;
    });
});
