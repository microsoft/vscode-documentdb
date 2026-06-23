/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EJSON, ObjectId } from 'bson';

// Mock vscode l10n so the localized throw message is deterministic.
jest.mock('vscode', () => ({
    l10n: {
        t: (message: string, ...args: unknown[]) => {
            let result = message;
            args.forEach((arg, index) => {
                result = result.replace(`{${index}}`, String(arg));
            });
            return result;
        },
    },
}));

// Capture output-channel diagnostics emitted on failure.
const outputChannelError = jest.fn();
jest.mock('../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            error: (...args: unknown[]) => outputChannelError(...args),
        },
    },
}));

import { parseDocumentId } from './parseDocumentId';

/**
 * The ids passed to parseDocumentId are produced by EJSON.stringify (canonical
 * for the table grid, relaxed for the document view). Build inputs the same way
 * so the tests exercise the real contract.
 */
const canonical = (value: unknown): string => EJSON.stringify(value, { relaxed: false });

describe('parseDocumentId', () => {
    beforeEach(() => {
        outputChannelError.mockClear();
    });

    it('parses an ObjectId from its EJSON $oid form (no hex guessing needed)', () => {
        const oid = new ObjectId();
        // This is exactly how the UI serializes an ObjectId _id: {"$oid":"..."}.
        expect(canonical(oid)).toBe(`{"$oid":"${oid.toHexString()}"}`);

        const result = parseDocumentId(canonical(oid));
        expect(result).toBeInstanceOf(ObjectId);
        expect((result as ObjectId).toHexString()).toBe(oid.toHexString());
    });

    it('does NOT guess: a bare 24-character hex string (no $oid) throws', () => {
        const hex = 'a'.repeat(24);
        expect(() => parseDocumentId(hex)).toThrow(/Unable to parse the document _id/);
        expect(outputChannelError).toHaveBeenCalledTimes(1);
    });

    it('keeps a string _id as a string', () => {
        expect(parseDocumentId(canonical('my-key'))).toBe('my-key');
    });

    it('keeps a numeric-looking string _id as a string (not coerced to a number)', () => {
        expect(parseDocumentId(canonical('42'))).toBe('42');
    });

    it('keeps a 24-hex-char string _id as a string when it arrives as EJSON', () => {
        const hexLikeString = 'f'.repeat(24);
        expect(parseDocumentId(canonical(hexLikeString))).toBe(hexLikeString);
    });

    it('parses a number _id to a number', () => {
        expect(parseDocumentId(canonical(2343345))).toBe(2343345);
    });

    it('keeps a UUID string _id as a string', () => {
        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        expect(parseDocumentId(canonical(uuid))).toBe(uuid);
    });

    it('parses an embedded-document _id, preserving field order and value types', () => {
        const embedded = { author: 'John', userId: 2343345 };
        const result = parseDocumentId(canonical(embedded)) as Record<string, unknown>;

        expect(result).toEqual(embedded);
        // Field order matters for embedded-document matching in the driver.
        expect(Object.keys(result)).toEqual(['author', 'userId']);
        expect(typeof result.userId).toBe('number');
        // Round-trips back to the exact canonical EJSON the driver would match on.
        expect(canonical(result)).toBe(canonical(embedded));
    });

    it('parses an array _id', () => {
        expect(parseDocumentId(canonical([1, 'a']))).toEqual([1, 'a']);
    });

    describe('unparseable ids', () => {
        it.each(['', '   ', 'not json', '{bad json', 'undefined'])(
            'throws and logs to the output channel for %p',
            (badId) => {
                expect(() => parseDocumentId(badId)).toThrow(/Unable to parse the document _id/);
                expect(outputChannelError).toHaveBeenCalledTimes(1);
                expect(outputChannelError.mock.calls[0][0]).toContain('Unable to parse document _id');
            },
        );

        it('echoes the offending value into the diagnostics', () => {
            expect(() => parseDocumentId('not json')).toThrow();
            expect(outputChannelError.mock.calls[0][0]).toContain('"not json"');
        });

        it('caps the echoed value for very long ids', () => {
            const longId = 'x'.repeat(5000); // not valid EJSON, not a hex ObjectId
            expect(() => parseDocumentId(longId)).toThrow();

            const logged = String(outputChannelError.mock.calls[0][0]);
            expect(logged).toContain('chars total');
            expect(logged).toContain('5000');
            // The raw value must not be dumped in full.
            expect(logged).not.toContain('x'.repeat(300));
        });
    });
});
