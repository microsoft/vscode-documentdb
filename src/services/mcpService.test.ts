/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { McpService } from './mcpService';

describe('McpService', () => {
    beforeEach(() => {
        // Reset the service state before each test
        McpService.stop();
    });

    afterEach(() => {
        // Clean up after each test
        McpService.stop();
    });

    test('should be able to start and stop', async () => {
        expect(McpService.isActive()).toBe(false);
        
        await McpService.start();
        expect(McpService.isActive()).toBe(true);
        
        await McpService.stop();
        expect(McpService.isActive()).toBe(false);
    });

    test('should track connection context', () => {
        const context = McpService.getConnectionContext();
        expect(context).toEqual({});

        // Context should be empty initially
        expect(context.connectionString).toBeUndefined();
        expect(context.databaseName).toBeUndefined();
        expect(context.collectionName).toBeUndefined();
    });

    test('should be able to switch database and collection context', async () => {
        await McpService.switchDatabase('testDb');
        let context = McpService.getConnectionContext();
        expect(context.databaseName).toBe('testDb');

        await McpService.switchCollection('testCollection');
        context = McpService.getConnectionContext();
        expect(context.databaseName).toBe('testDb');
        expect(context.collectionName).toBe('testCollection');
    });
});