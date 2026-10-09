/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SRV_RESOLVER_PACKAGE } from './index';

describe('SRV_RESOLVER_PACKAGE', () => {
    it('identifies this workspace package', () => {
        expect(SRV_RESOLVER_PACKAGE).toBe('@documentdb-js/srv-resolver');
    });
});
