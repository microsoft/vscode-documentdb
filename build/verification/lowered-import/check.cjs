/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Check azureauth's ARM subscription import routes with the shipped production host config.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { buildHostProbes } = require('../vite-host-probe.cjs');

const specifier = '@azure/arm-resources-subscriptions';

async function checkAzureArmEsm() {
    const outputPath = fs.mkdtempSync(path.join(os.tmpdir(), 'documentdb-lowered-import-'));
    try {
        const chunks = await buildHostProbes({
            input: { loweredImport: path.join(__dirname, 'probe.mjs') },
            outputPath,
        });
        const armModules = chunks
            .flatMap((chunk) => chunk.moduleIds)
            .flatMap((id) => {
                const match = /\/node_modules\/@azure\/arm-resources-subscriptions\/(.+)$/.exec(
                    id.replaceAll('\\', '/'),
                );
                return match ? [match[1]] : [];
            });
        assert.ok(armModules.length > 0, `Host probe did not bundle any ${specifier} modules`);
        assert.deepEqual(
            armModules.filter((id) => !id.startsWith('dist/esm/')),
            [],
            `Host probe bundled ${specifier} modules outside dist/esm`,
        );

        const runtime = await import(pathToFileURL(path.join(outputPath, 'loweredImport.mjs')));
        for (const name of ['createSubscription', 'listSubscriptions', 'listTenants']) {
            assert.equal(typeof runtime[name], 'function', `Bundled ${specifier} export ${name} is not a function`);
        }
        return armModules;
    } finally {
        fs.rmSync(outputPath, { recursive: true, force: true });
    }
}

async function main() {
    const armModules = await checkAzureArmEsm();
    console.log(`PASS: ${specifier} runtime exports are functions (${armModules.length} dist/esm modules)`);
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}

module.exports = { checkAzureArmEsm };
