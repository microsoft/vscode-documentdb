/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { maskSecrets, MaskingLineBuffer } from './outputMasking';

describe('outputMasking (Quick Start D14)', () => {
    const PASSWORD = 'Sup3rS3cretPwd';

    describe('maskSecrets', () => {
        it('redacts every occurrence of a secret', () => {
            expect(maskSecrets(`user=admin pass=${PASSWORD}`, [PASSWORD])).toBe('user=admin pass=***');
            expect(maskSecrets(`${PASSWORD} ${PASSWORD}`, [PASSWORD])).toBe('*** ***');
        });

        it('redacts a secret embedded in a connection string', () => {
            const line = `mongodb://admin:${PASSWORD}@localhost:10260/?tls=true`;
            expect(maskSecrets(line, [PASSWORD])).toBe('mongodb://admin:***@localhost:10260/?tls=true');
        });

        it('handles multiple secrets and ignores empty ones', () => {
            expect(maskSecrets('a b c', ['b', '', 'c'])).toBe('a *** ***');
        });

        it('is a no-op when no secret is present', () => {
            expect(maskSecrets('nothing to hide here', [PASSWORD])).toBe('nothing to hide here');
        });
    });

    describe('MaskingLineBuffer', () => {
        function collect(): { emitted: string[]; buffer: MaskingLineBuffer } {
            const emitted: string[] = [];
            const buffer = new MaskingLineBuffer((line) => emitted.push(line), [PASSWORD]);
            return { emitted, buffer };
        }

        it('emits one masked line per newline', () => {
            const { emitted, buffer } = collect();
            buffer.push(`starting\nconnecting with ${PASSWORD}\n`);
            expect(emitted).toEqual(['starting', 'connecting with ***']);
        });

        it('never leaks a secret split across two chunks', () => {
            const { emitted, buffer } = collect();
            const half = Math.floor(PASSWORD.length / 2);
            // The password is split across two pushes; nothing is emitted until the newline.
            buffer.push(`pass=${PASSWORD.slice(0, half)}`);
            expect(emitted).toEqual([]);
            buffer.push(`${PASSWORD.slice(half)} done\n`);
            expect(emitted).toEqual(['pass=*** done']);
            expect(emitted.join('\n')).not.toContain(PASSWORD);
        });

        it('masks a trailing partial line on flush', () => {
            const { emitted, buffer } = collect();
            buffer.push(`tail with ${PASSWORD}`);
            expect(emitted).toEqual([]);
            buffer.flush();
            expect(emitted).toEqual(['tail with ***']);
        });

        it('strips a trailing carriage return (CRLF streams)', () => {
            const { emitted, buffer } = collect();
            buffer.push('windows line\r\n');
            expect(emitted).toEqual(['windows line']);
        });
    });
});
