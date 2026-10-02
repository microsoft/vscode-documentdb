/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const { main } = require('./runner.cjs');

main(process.argv.slice(2), true).catch((error) => {
    console.error(`L3 PROOF FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
});
