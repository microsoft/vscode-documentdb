/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { McpServerService } from './McpServerService';
import { ext } from '../extensionVariables';

// Mock the extension variables
jest.mock('../extensionVariables', () => ({
    ext: {
        outputChannel: {
            appendLine: jest.fn(),
        },
    },
}));

// Mock vscode module
jest.mock('vscode', () => ({
    l10n: {
        t: (message: string, ...args: any[]) => {
            // Simple template string replacement for testing
            return message.replace(/\{(\w+)\}/g, (match, key) => {
                const values = args[0] || {};
                return values[key] || match;
            });
        },
    },
    workspace: {
        getConfiguration: jest.fn(() => ({
            get: jest.fn(),
        })),
    },
}));

describe('McpServerService', () => {
    let mcpService: McpServerService;

    beforeEach(() => {
        mcpService = McpServerService.getInstance();
        // Clear any previous calls to mocked functions
        jest.clearAllMocks();
    });

    afterEach(async () => {
        if (mcpService.isRunning()) {
            await mcpService.stopMcpServer();
        }
    });

    it('should be a singleton', () => {
        const anotherInstance = McpServerService.getInstance();
        expect(mcpService).toBe(anotherInstance);
    });

    it('should not be running initially', () => {
        expect(mcpService.isRunning()).toBe(false);
    });

    it('should handle MCP chat request and return mock collections', async () => {
        const mockContext = {
            telemetry: { properties: {}, measurements: {} },
            valuesToMask: [],
            errorHandling: {},
            ui: {},
        } as unknown as IActionContext;

        // Mock the server as running for this test
        (mcpService as any).isServerRunning = true;

        const collections = await mcpService.handleMcpChat('test-cluster-id', mockContext);
        
        expect(collections).toBeDefined();
        expect(Array.isArray(collections)).toBe(true);
        expect(collections.length).toBeGreaterThan(0);
        expect(collections).toContain('users');
        expect(collections).toContain('products');

        // Verify that output was logged
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(ext.outputChannel.appendLine).toHaveBeenCalledWith(
            expect.stringContaining('Processing MCP chat request for cluster: test-cluster-id')
        );
    });

    it('should throw error when MCP chat is called without server running', async () => {
        const mockContext = {
            telemetry: { properties: {}, measurements: {} },
            valuesToMask: [],
            errorHandling: {},
            ui: {},
        } as unknown as IActionContext;

        await expect(mcpService.handleMcpChat('test-cluster-id', mockContext))
            .rejects
            .toThrow('MCP server is not running');
    });
});