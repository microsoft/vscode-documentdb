/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ParseMode, parse as parseShellBSON } from '@mongodb-js/shell-bson-parser';
import { Binary, Decimal128, EJSON, Long, ObjectId } from 'bson';
import { describe, expect, it } from 'vitest';
import { toFilterQueryObj } from '../../documentdb/utils/toFilterQuery';
import { toShellQuery } from './wishQuery';

/** What a find or the collection view would query with. */
const asFilter = (text: string): Record<string, unknown> =>
    toFilterQueryObj(toShellQuery(text)) as Record<string, unknown>;

describe('toShellQuery', () => {
    it('turns a $date into a Date the find parser reads, not a sub-document that matches nothing', () => {
        const text = '{"joined":{"$gte":{"$date":"2024-03-01T00:00:00Z"},"$lt":{"$date":"2025-01-01T00:00:00Z"}}}';
        expect(toFilterQueryObj(text)).toEqual({
            joined: { $gte: { $date: '2024-03-01T00:00:00Z' }, $lt: expect.anything() },
        });

        const filter = asFilter(text) as { joined: { $gte: unknown; $lt: unknown } };
        expect(filter.joined.$gte).toBeInstanceOf(Date);
        expect(filter.joined.$gte).toEqual(new Date('2024-03-01T00:00:00Z'));
        expect(filter.joined.$lt).toEqual(new Date('2025-01-01T00:00:00Z'));
    });

    it('reads a $date given as milliseconds', () => {
        expect(asFilter('{"at":{"$date":{"$numberLong":"1709251200000"}}}').at).toEqual(new Date(1709251200000));
        expect(asFilter('{"at":{"$date":1709251200000}}').at).toEqual(new Date(1709251200000));
    });

    it('turns an $oid into an ObjectId the server accepts', () => {
        const id = asFilter('{"_id":{"$oid":"6b04df29e0e56cfc21895da6"}}')._id;
        expect(id).toBeInstanceOf(ObjectId);
        expect((id as ObjectId).toHexString()).toBe('6b04df29e0e56cfc21895da6');
    });

    it('turns long and decimal wrappers into their BSON types', () => {
        const filter = asFilter('{"a":{"$numberLong":"9007199254740993"},"b":{"$numberDecimal":"1.10"}}');
        expect(filter.a).toBeInstanceOf(Long);
        expect(String(filter.a)).toBe('9007199254740993');
        expect(filter.b).toBeInstanceOf(Decimal128);
        expect(String(filter.b)).toBe('1.10');
    });

    it('turns finite int and double wrappers into numbers, and leaves the rest alone', () => {
        expect(asFilter('{"a":{"$numberInt":"5"},"b":{"$numberDouble":"1.5"}}')).toEqual({ a: 5, b: 1.5 });
        expect(toShellQuery('{"a":{"$numberDouble":"Infinity"}}')).toBe('{"a":{"$numberDouble":"Infinity"}}');
    });

    it('turns a regular expression and a UUID into what the driver sends as BSON', () => {
        const filter = asFilter(
            '{"name":{"$regularExpression":{"pattern":"^a\\\\.b","options":"i"}},"key":{"$uuid":"123e4567-e89b-12d3-a456-426614174000"}}',
        );
        expect(filter.name).toEqual(/^a\.b/i);
        const strict = EJSON.parse('{"$uuid":"123e4567-e89b-12d3-a456-426614174000"}', { relaxed: false }) as Binary;
        expect(filter.key).toBeInstanceOf(Binary);
        expect((filter.key as Binary).sub_type).toBe(strict.sub_type);
        expect(Buffer.from((filter.key as Binary).buffer)).toEqual(Buffer.from(strict.buffer));
    });

    it.each([
        ['options JS does not have', '{"a":{"$regularExpression":{"pattern":"a","options":"x"}}}'],
        ['options the driver drops', '{"a":{"$regularExpression":{"pattern":"a","options":"s"}}}'],
        ['a pattern JS cannot read', '{"a":{"$regularExpression":{"pattern":"(","options":""}}}'],
        ['an id that is not 24 hex digits', '{"_id":{"$oid":"42"}}'],
        ['a date that is no date', '{"at":{"$date":"soon"}}'],
        ['a wrapper with another key', '{"at":{"$date":"2024-01-01T00:00:00Z","x":1}}'],
        ['operators', '{"name":{"$regex":"^a","$options":"i"},"tier":{"$in":["gold"]},"n":{"$gt":1}}'],
    ])('leaves %s as written', (_name, text) => {
        expect(toShellQuery(text)).toBe(text);
    });

    it('converts at any depth and inside arrays, as a pipeline would parse with EJSON', () => {
        const pipeline = JSON.stringify([
            {
                $match: {
                    $or: [
                        { at: { $gte: { $date: '2024-03-01T00:00:00Z' } } },
                        { _id: { $in: [{ $oid: '6b04df29e0e56cfc21895da6' }] } },
                    ],
                },
            },
            { $match: { big: { $numberLong: '42' }, price: { $numberDecimal: '9.99' } } },
            // No plain numbers: strict EJSON wraps those, the shell does not, and both send the same BSON.
            { $group: { _id: '$tier', total: { $sum: '$total' } } },
        ]);
        const parsed = parseShellBSON(toShellQuery(pipeline), { mode: ParseMode.Loose });
        expect(parsed).toEqual(EJSON.parse(pipeline, { relaxed: false }));
    });

    it('returns shell syntax, empty text and nothing unchanged', () => {
        for (const text of ['{ _id: ObjectId("6b04df29e0e56cfc21895da6") }', "{ name: 'Ada' }", '', '   ', undefined]) {
            expect(toShellQuery(text)).toBe(text);
        }
    });

    it('keeps JSON without wrappers exactly as written', () => {
        const text = '{ "total": { "$gt": 300 } }';
        expect(toShellQuery(text)).toBe(text);
    });

    it('changes nothing when run twice', () => {
        for (const text of [
            '{"at":{"$date":"2024-03-01T00:00:00Z"},"n":{"$numberInt":"5"}}',
            '[{"$match":{"_id":{"$oid":"6b04df29e0e56cfc21895da6"}}}]',
            '{"a":{"$numberDouble":"2.5"}}',
        ]) {
            const once = toShellQuery(text);
            expect(toShellQuery(once)).toBe(once);
        }
    });

    it.each([
        '{"at":{"$gte":{"$date":{"$numberInt":"1709251200"}}}}',
        '{"at":{"$date":{"$numberDouble":"1709251200000"}}}',
        '{"_id":{"$oid":{"$numberInt":"1"}}}',
    ])('leaves a wrapper it cannot convert exactly as written, inside too: %s', (text) => {
        // Converting only the inner wrapper made the second pass read a different date than the first.
        expect(toShellQuery(text)).toBe(text);
        expect(toShellQuery(toShellQuery(text))).toBe(text);
    });

    it('keeps a number too big for a double as Infinity, not null', () => {
        const filter = asFilter('{"score":{"$lt":1e400},"floor":-1e400,"at":{"$date":"2024-03-01T00:00:00Z"}}');
        expect(filter).toEqual({ score: { $lt: Infinity }, floor: -Infinity, at: new Date('2024-03-01T00:00:00Z') });
    });

    it('converts a $numberLong only when it fits in 64 bits, so it never wraps into another value', () => {
        expect(String(asFilter('{"n":{"$numberLong":"9223372036854775807"}}').n)).toBe('9223372036854775807');
        expect(String(asFilter('{"n":{"$numberLong":"-9223372036854775808"}}').n)).toBe('-9223372036854775808');
        for (const text of [
            '{"n":{"$gte":{"$numberLong":"9223372036854775808"}}}',
            '{"n":{"$numberLong":"-9223372036854775809"}}',
            '{"n":{"$numberLong":"99999999999999999999"}}',
        ]) {
            expect(toShellQuery(text)).toBe(text);
        }
    });

    it('returns a filter nested deeper than the stack unchanged instead of throwing', () => {
        let text = '{"_id":{"$oid":"6b04df29e0e56cfc21895da6"}}';
        for (let level = 0; level < 20_000; level++) {
            text = `{"a":${text}}`;
        }
        expect(toShellQuery(text)).toBe(text);
    });

    it('escapes line and paragraph separators, which the shell parser rejects in a string', () => {
        const separator = String.fromCharCode(0x2028);
        const text = JSON.stringify({ note: `a${separator}b`, at: { $date: '2024-03-01T00:00:00Z' } });
        expect(() => toFilterQueryObj(text)).toThrow();
        expect(asFilter(text)).toEqual({ note: `a${separator}b`, at: new Date('2024-03-01T00:00:00Z') });
    });
});
