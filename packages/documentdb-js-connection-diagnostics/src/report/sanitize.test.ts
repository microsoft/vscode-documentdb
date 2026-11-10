/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';

import { sanitizeValue } from './sanitize.js';

describe('report sanitization', (): void => {
    it('strips controls before truncation, retaining tabs and newlines', (): void => {
        expect(sanitizeValue(`\0${'a'.repeat(8190)}\r\u001b\u007f\u0085\t\n`)).toBe(`${'a'.repeat(8190)}\t\n`);
        expect(sanitizeValue(`\0${'a'.repeat(8193)}\r`)).toBe(`${'a'.repeat(8192)} [truncated 1 characters]`);
    });

    it('keeps 8192 UTF-16 code units and reports the omitted count at 8193', (): void => {
        expect(sanitizeValue('a'.repeat(8192))).toBe('a'.repeat(8192));
        expect(sanitizeValue('a'.repeat(8193))).toBe(`${'a'.repeat(8192)} [truncated 1 characters]`);
        expect(sanitizeValue('😀'.repeat(4097))).toBe(`${'😀'.repeat(4096)} [truncated 2 characters]`);
    });

    it('keeps the first 32 entries and appends exactly one omission marker', (): void => {
        const entries = Array.from({ length: 32 }, (_, index): number => index);
        expect(sanitizeValue(entries)).toEqual(entries);
        expect(sanitizeValue([...entries, 32, 33])).toEqual([...entries, '[2 more omitted]']);
        expect(sanitizeValue([...entries.slice(0, 31), undefined, 'last'])).toEqual([
            ...entries.slice(0, 31),
            '[1 more omitted]',
        ]);
    });

    it('drops non-JSON values, non-finite numbers and overlong keys', (): void => {
        class Example {
            readonly value = 'private';
        }
        const invalid = [
            undefined,
            (): void => {},
            Symbol('value'),
            1n,
            new Example(),
            new Date(),
            Buffer.from('bytes'),
            new Uint8Array([1]),
            NaN,
            Infinity,
            -Infinity,
            new Map(),
            new Set(),
        ];
        for (const value of invalid) {
            expect(sanitizeValue(value)).toBeUndefined();
        }
        expect(
            sanitizeValue({
                keep: [null, true, false, 1, 'text', ...invalid],
                ...Object.fromEntries(invalid.map((value, index): [string, unknown] => [`invalid${index}`, value])),
                ['k'.repeat(129)]: 'dropped',
                ['k'.repeat(128)]: 'kept',
            }),
        ).toEqual({ keep: [null, true, false, 1, 'text'], ['k'.repeat(128)]: 'kept' });
    });

    it('copies own enumerable string keys only, including null-prototype objects', (): void => {
        const source = Object.assign(Object.create(null) as Record<string, unknown>, { nested: { value: 1 } });
        Object.defineProperty(source, 'hidden', { value: 'not enumerable' });
        Object.defineProperty(source, Symbol('not a string'), { value: 'not a string', enumerable: true });
        const result = sanitizeValue(source);
        expect(result).toEqual({ nested: { value: 1 } });
        expect(result).not.toBe(source);
        expect((result as Record<string, unknown>).nested).not.toBe(source.nested);
    });

    it('allows depth eight and replaces deeper values, bounding cycles too', (): void => {
        let source: unknown = 'leaf';
        for (let depth = 0; depth < 8; depth++) {
            source = { child: source };
        }
        expect(sanitizeValue(source)).toEqual(source);
        const deeper = sanitizeValue({ child: source });
        expect(JSON.stringify(deeper)).toContain('[depth limit]');
        expect(JSON.stringify(deeper)).not.toContain('leaf');
        const cycle: Record<string, unknown> = {};
        cycle.self = cycle;
        expect(JSON.stringify(sanitizeValue(cycle))).toContain('[depth limit]');
    });

    it('never invokes the __proto__ setter when copying keys', (): void => {
        const source: unknown = JSON.parse(
            '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}',
        );
        const result = sanitizeValue(source) as Record<string, unknown>;
        expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
        expect(Object.hasOwn(result, '__proto__')).toBe(true);
        expect(Object.hasOwn({}, 'polluted')).toBe(false);
        expect(result.polluted).toBeUndefined();
    });
});
