/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { classifyCodeBlock, classifyCommand } from '../../src/utils/classifyCommand';

describe('classifyCommand', () => {
    // ── Find ─────────────────────────────────────────────────────────────
    it.each([
        ["db.col.find({ name: 'x' })", 'find'],
        ['db.col.findOne({})', 'find'],
        ['db.getCollection("users").find()', 'find'],
    ])('classifies "%s" as "%s"', (input, expected) => {
        expect(classifyCommand(input)).toBe(expected);
    });

    // ── Insert ───────────────────────────────────────────────────────────
    it.each([
        ['db.col.insertOne({ a: 1 })', 'insert'],
        ['db.col.insertMany([{ a: 1 }])', 'insert'],
        ['db.col.insert({ a: 1 })', 'insert'],
    ])('classifies "%s" as "%s"', (input, expected) => {
        expect(classifyCommand(input)).toBe(expected);
    });

    // ── Update ───────────────────────────────────────────────────────────
    it.each([
        ['db.col.updateOne({ a: 1 }, { $set: { b: 2 } })', 'update'],
        ['db.col.updateMany({}, { $set: { x: 1 } })', 'update'],
        ['db.col.replaceOne({ a: 1 }, { b: 2 })', 'update'],
        ['db.col.findOneAndUpdate({ a: 1 }, { $set: { b: 2 } })', 'update'],
        ['db.col.findOneAndReplace({ a: 1 }, { b: 2 })', 'update'],
    ])('classifies "%s" as "%s"', (input, expected) => {
        expect(classifyCommand(input)).toBe(expected);
    });

    // ── Delete ───────────────────────────────────────────────────────────
    it.each([
        ['db.col.deleteOne({ a: 1 })', 'delete'],
        ['db.col.deleteMany({})', 'delete'],
        ['db.col.findOneAndDelete({ a: 1 })', 'delete'],
        ['db.col.remove({ a: 1 })', 'delete'],
    ])('classifies "%s" as "%s"', (input, expected) => {
        expect(classifyCommand(input)).toBe(expected);
    });

    // ── Aggregate ────────────────────────────────────────────────────────
    it('classifies aggregate', () => {
        expect(classifyCommand('db.col.aggregate([{ $match: {} }])')).toBe('aggregate');
    });

    // ── Count ────────────────────────────────────────────────────────────
    it.each([
        ['db.col.count()', 'count'],
        ['db.col.countDocuments({})', 'count'],
        ['db.col.estimatedDocumentCount()', 'count'],
    ])('classifies "%s" as "%s"', (input, expected) => {
        expect(classifyCommand(input)).toBe(expected);
    });

    // ── Index ────────────────────────────────────────────────────────────
    it.each([
        ['db.col.createIndex({ a: 1 })', 'index'],
        ['db.col.dropIndex("a_1")', 'index'],
        ['db.col.getIndexes()', 'index'],
    ])('classifies "%s" as "%s"', (input, expected) => {
        expect(classifyCommand(input)).toBe(expected);
    });

    // ── runCommand ───────────────────────────────────────────────────────
    it.each([
        ['db.runCommand({ ping: 1 })', 'runCommand'],
        ['db.runCommand({ serverStatus: 1 })', 'runCommand'],
    ])('classifies "%s" as "%s"', (input, expected) => {
        expect(classifyCommand(input)).toBe(expected);
    });

    // ── Shell commands ───────────────────────────────────────────────────
    it.each([
        ['help', 'help'],
        ['db.col.help()', 'help'],
        ['show dbs', 'show'],
        ['show collections', 'show'],
        ['use mydb', 'use'],
        ['exit', 'exit'],
        ['quit', 'exit'],
        ['cls', 'clear'],
        ['clear', 'clear'],
        ['it', 'cursor'],
    ])('classifies shell command "%s" as "%s"', (input, expected) => {
        expect(classifyCommand(input)).toBe(expected);
    });

    // ── Other ────────────────────────────────────────────────────────────
    it('classifies unknown commands as "other"', () => {
        expect(classifyCommand('const x = 42')).toBe('other');
        expect(classifyCommand('print("hello")')).toBe('other');
    });

    // ── Whitespace handling ──────────────────────────────────────────────
    it('handles leading/trailing whitespace', () => {
        expect(classifyCommand('  help  ')).toBe('help');
        expect(classifyCommand('  show dbs  ')).toBe('show');
    });
});

describe('classifyCodeBlock', () => {
    it('classifies a single-statement block', () => {
        const result = classifyCodeBlock('db.col.find({})');
        expect(result.primaryCategory).toBe('find');
        expect(result.totalCommands).toBe(1);
        expect(result.categoryCounts).toEqual({ find: 1 });
    });

    it('classifies a multi-statement block with a dominant category', () => {
        const code = [
            "db.col.find({ name: 'a' })",
            "db.col.findOne({ name: 'b' })",
            "db.col.insertOne({ name: 'c' })",
        ].join('\n');
        const result = classifyCodeBlock(code);
        expect(result.primaryCategory).toBe('find');
        expect(result.totalCommands).toBe(3);
        expect(result.categoryCounts).toEqual({ find: 2, insert: 1 });
    });

    it('returns "other" for unrecognized code', () => {
        const result = classifyCodeBlock('const x = 42;\nconsole.log(x);');
        expect(result.primaryCategory).toBe('other');
        expect(result.totalCommands).toBe(0);
    });

    it('counts multiple categories correctly', () => {
        const code = [
            'db.col.aggregate([{ $match: {} }])',
            'db.col.deleteOne({ a: 1 })',
            'db.col.updateOne({ a: 1 }, { $set: { b: 2 } })',
        ].join('\n');
        const result = classifyCodeBlock(code);
        expect(result.totalCommands).toBe(3);
        expect(result.categoryCounts.aggregate).toBe(1);
        expect(result.categoryCounts.delete).toBe(1);
        expect(result.categoryCounts.update).toBe(1);
    });
});
