/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// G5-I01: a lowered `import()` of @azure/arm-resources-subscriptions must yield its namespace
// when built with the shipped host config (production), which pins the package to CommonJS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { buildHostProbes } = require('../vite-host-probe.cjs');

const specifier = '@azure/arm-resources-subscriptions';

async function checkLoweredImport({ withoutAlias = false } = {}) {
    const outputPath = fs.mkdtempSync(path.join(os.tmpdir(), 'documentdb-lowered-import-'));
    try {
        await buildHostProbes({
            input: { loweredImport: path.join(__dirname, 'probe.mjs') },
            outputPath,
            pinned: specifier,
            withoutAlias,
        });
        const { loadArmSubscriptions } = await import(pathToFileURL(path.join(outputPath, 'loweredImport.mjs')));
        const namespace = await loadArmSubscriptions();
        assert.equal(
            typeof namespace?.SubscriptionClient,
            'function',
            `Lowered import() of ${specifier} returned ${namespace === undefined ? 'undefined' : 'an object without SubscriptionClient'}, not its namespace`,
        );
        return { exports: Object.keys(namespace).length };
    } finally {
        fs.rmSync(outputPath, { recursive: true, force: true });
    }
}

async function main(args) {
    const result = await checkLoweredImport({ withoutAlias: args.includes('--without-alias') });
    console.log(`PASS: lowered import() of ${specifier} returned its namespace (${result.exports} exports)`);
    if (args.includes('--prove')) {
        await assert.rejects(checkLoweredImport({ withoutAlias: true }), /returned undefined, not its namespace/);
        console.log(`PASS: ${specifier}-alias-removed rejected for the expected reason`);
    }
}

if (require.main === module) {
    main(process.argv.slice(2)).catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}

module.exports = { checkLoweredImport };
