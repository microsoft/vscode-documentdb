/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { shellAnsi, shellStyles } from './shellStyles';

describe('shellStyles', () => {
    it('uses the same string and number roles for input syntax and output results', () => {
        expect(shellStyles.syntax.string).toBe(shellStyles.result.string);
        expect(shellStyles.syntax.number).toBe(shellStyles.result.number);
    });

    it('represents ghost text as reduced emphasis without assigning a color', () => {
        expect(shellStyles.ghostText).toBe(shellAnsi.dim);
        expect(shellStyles.ghostText).not.toContain(shellAnsi.gray);
    });
});
