/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseFindExpression } from './parseFindExpression';

describe('parseFindExpression', () => {
    it('should parse simple find with filter', () => {
        const result = parseFindExpression("db.getCollection('orders').find({ status: 'active' })");
        expect(result).toMatchObject({
            collectionName: 'orders',
            filter: "{ status: 'active' }",
        });
    });

    it('should parse find with filter and projection', () => {
        const result = parseFindExpression("db.getCollection('users').find({ age: 25 }, { name: 1, email: 1 })");
        expect(result).toMatchObject({
            collectionName: 'users',
            filter: '{ age: 25 }',
            project: '{ name: 1, email: 1 }',
        });
    });

    it('should parse find with sort', () => {
        const result = parseFindExpression(
            "db.getCollection('orders').find({ status: 'active' }).sort({ createdAt: -1 })",
        );
        expect(result).toMatchObject({
            collectionName: 'orders',
            filter: "{ status: 'active' }",
            sort: '{ createdAt: -1 }',
        });
    });

    it('should parse find with filter, projection, and sort', () => {
        const result = parseFindExpression(
            "db.getCollection('orders').find({ status: 'active' }, { name: 1 }).sort({ date: -1 })",
        );
        expect(result).toMatchObject({
            collectionName: 'orders',
            filter: "{ status: 'active' }",
            project: '{ name: 1 }',
            sort: '{ date: -1 }',
        });
    });

    it('should handle direct collection access', () => {
        const result = parseFindExpression('db.orders.find({ qty: { $gt: 10 } })');
        expect(result).toMatchObject({
            collectionName: 'orders',
            filter: '{ qty: { $gt: 10 } }',
        });
    });

    it('should handle empty find', () => {
        const result = parseFindExpression("db.getCollection('test').find({})");
        expect(result).toMatchObject({
            collectionName: 'test',
            filter: '{}',
        });
    });

    it('should handle nested objects in filter', () => {
        const result = parseFindExpression(
            "db.getCollection('users').find({ address: { city: 'NYC', zip: '10001' } })",
        );
        expect(result).toMatchObject({
            collectionName: 'users',
            filter: "{ address: { city: 'NYC', zip: '10001' } }",
        });
    });

    it('should return partial result when no find() is present', () => {
        const result = parseFindExpression("db.getCollection('orders').aggregate([])");
        expect(result).toMatchObject({
            collectionName: 'orders',
        });
        expect(result.filter).toBeUndefined();
    });

    it('should return empty object for unrecognizable code', () => {
        const result = parseFindExpression('const x = 42');
        expect(result.collectionName).toBeUndefined();
        expect(result.filter).toBeUndefined();
    });

    it('should handle strings with commas inside filter', () => {
        const result = parseFindExpression("db.getCollection('logs').find({ msg: 'hello, world' })");
        expect(result).toMatchObject({
            collectionName: 'logs',
            filter: "{ msg: 'hello, world' }",
        });
    });

    it('should parse skip and limit', () => {
        const result = parseFindExpression(
            "db.getCollection('orders').find({ status: 'active' }).sort({ date: -1 }).skip(20).limit(10)",
        );
        expect(result).toMatchObject({
            collectionName: 'orders',
            filter: "{ status: 'active' }",
            sort: '{ date: -1 }',
            skip: 20,
            limit: 10,
        });
    });

    it('should parse limit without skip', () => {
        const result = parseFindExpression("db.getCollection('users').find({}).limit(50)");
        expect(result).toMatchObject({
            collectionName: 'users',
            filter: '{}',
            limit: 50,
        });
        expect(result.skip).toBeUndefined();
    });
});
