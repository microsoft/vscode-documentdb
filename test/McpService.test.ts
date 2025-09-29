/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { McpService } from '../src/services/McpService';

describe('McpService', () => {
    let mcpService: McpService;

    beforeEach(() => {
        mcpService = McpService.getInstance();
    });

    afterEach(() => {
        if (mcpService) {
            mcpService.dispose();
        }
    });

    it('should create a singleton instance', () => {
        const instance1 = McpService.getInstance();
        const instance2 = McpService.getInstance();
        assert.strictEqual(instance1, instance2, 'McpService should return the same singleton instance');
    });

    it('should initialize without throwing when documentdb-mcp module is not available', async () => {
        // This test verifies that the service gracefully handles the absence of the documentdb-mcp module
        await assert.doesNotReject(
            async () => {
                await mcpService.initialize();
            },
            'McpService.initialize() should not throw when documentdb-mcp module is not available'
        );
    });

    it('should report server as not running when module is not available', async () => {
        await mcpService.initialize();
        assert.strictEqual(mcpService.isServerRunning, false, 'Server should not be running when module is not available');
    });

    it('should return appropriate connection status when module is not available', async () => {
        await mcpService.initialize();
        const status = await mcpService.getConnectionStatus();
        
        assert.strictEqual(status.serverRunning, false, 'Server should be reported as not running');
        assert.strictEqual(status.connected, false, 'Connection should be reported as false');
        assert.ok(status.error, 'Error should be present when server is not running');
    });

    it('should handle syncConnection gracefully when module is not available', async () => {
        await mcpService.initialize();
        
        // This should not throw, but should log appropriate messages
        await assert.doesNotReject(
            async () => {
                await mcpService.syncConnection('mongodb://localhost:27017');
            },
            'syncConnection should not throw when module is not available'
        );
    });

    it('should handle dispose correctly', () => {
        assert.doesNotThrow(() => {
            mcpService.dispose();
            // Calling dispose again should not throw
            mcpService.dispose();
        }, 'Dispose should not throw');
    });

    it('should throw when trying to use disposed service', async () => {
        mcpService.dispose();
        
        await assert.rejects(
            async () => {
                await mcpService.initialize();
            },
            /disposed/,
            'Should throw when trying to initialize disposed service'
        );

        await assert.rejects(
            async () => {
                await mcpService.syncConnection('mongodb://localhost:27017');
            },
            /disposed/,
            'Should throw when trying to sync connection on disposed service'
        );
    });
});