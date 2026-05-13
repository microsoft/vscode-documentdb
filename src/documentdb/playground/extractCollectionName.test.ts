/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { extractCollectionName } from './extractCollectionName';

describe('extractCollectionName', () => {
    it('should extract from db.getCollection with single quotes', () => {
        expect(extractCollectionName("db.getCollection('orders').find({})")).toBe('orders');
    });

    it('should extract from db.getCollection with double quotes', () => {
        expect(extractCollectionName('db.getCollection("users").find({})')).toBe('users');
    });

    it('should extract from db.getCollection with spaces', () => {
        expect(extractCollectionName("db.getCollection( 'events' ).find({})")).toBe('events');
    });

    it('should extract from direct property access pattern', () => {
        expect(extractCollectionName('db.orders.find({})')).toBe('orders');
    });

    it('should not extract built-in db methods', () => {
        expect(extractCollectionName('db.getCollectionNames()')).toBeUndefined();
        expect(extractCollectionName('db.adminCommand({ listDatabases: 1 })')).toBeUndefined();
    });

    it('should return undefined for unrecognizable code', () => {
        expect(extractCollectionName('const x = 42')).toBeUndefined();
        expect(extractCollectionName('print("hello")')).toBeUndefined();
    });

    it('should handle multiline code blocks', () => {
        const code = `
// Find active orders
db.getCollection('orders').find({
    status: "active"
}).sort({ createdAt: -1 })
`;
        expect(extractCollectionName(code)).toBe('orders');
    });

    it('should handle names with special characters via getCollection', () => {
        expect(extractCollectionName("db.getCollection('my-collection').find({})")).toBe('my-collection');
        expect(extractCollectionName("db.getCollection('events.2024').find({})")).toBe('events.2024');
    });
});
