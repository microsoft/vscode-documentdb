/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

function packedTestFailure(name, files) {
    const tests = files.filter((file) => /(?:^|\/)[^/]*\.(?:test|spec)\.[^/]+$/.test(file)).sort();
    return tests.length > 0 ? `${name}: packed test files are forbidden: ${tests.join(', ')}` : undefined;
}

module.exports = { packedTestFailure };
