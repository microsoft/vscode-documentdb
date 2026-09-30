/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseError } from '@microsoft/vscode-azext-utils';
import { improveError } from './improveError';

describe('improveError', () => {
    it('leaves unrelated messages alone', () => {
        const msg = 'where is c:\\Program Files\\MongoDBServer\\4.0\\bin\\mongo.exe?';

        expect(parseError(improveError(msg)).message).toBe(msg);
    });

    it('rewrites spawn ENOENT into a missing-file message', () => {
        const msg = 'spawn c:\\Program Files\\MongoDBServer\\4.0\\bin\\mongo.exe ENOENT';

        expect(parseError(improveError(msg)).message).toBe(
            'Could not find c:\\Program Files\\MongoDBServer\\4.0\\bin\\mongo.exe',
        );
    });
});
