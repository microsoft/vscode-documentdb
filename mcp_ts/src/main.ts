/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { runServer } from './server.js';
import { config } from './config.js';

async function main(): Promise<void> {
    console.error(`Starting DocumentDB MCP server with transport: ${config.transport}`);
    
    if (config.transport !== 'stdio') {
        console.error('Note: Currently only stdio transport is implemented');
        console.error('Falling back to stdio transport');
    }
    
    try {
        await runServer();
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error('Unhandled error in main:', error);
        process.exit(1);
    });
}