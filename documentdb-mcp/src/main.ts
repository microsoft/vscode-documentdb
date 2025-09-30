/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { config } from './config';
import { runServer } from './server';

async function main(): Promise<void> {
    console.error(`Starting DocumentDB MCP server with transport: ${config.transport}`);

    if (config.transport === 'streamable-http') {
        console.error(`Server will run on http://${config.host}:${config.port}/mcp`);
    } else if (config.transport === 'sse') {
        console.error(`Server will run (SSE) at http://${config.host}:${config.port}/sse`);
    } else if (config.transport === 'stdio') {
        console.error('Server will run on stdio transport');
    } else {
        console.error(`Warning: Unsupported transport '${config.transport}', falling back to stdio`);
    }

    try {
        await runServer();
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

const argvPath = path.resolve(process.argv[1] || '');
let shouldRun = false;

const currentFile: string | undefined = typeof __filename !== 'undefined' ? path.resolve(__filename) : undefined;

if (currentFile) {
    shouldRun = argvPath === currentFile;
} else {
    // Fallback: if we cannot determine, assume direct run (safer for CLI usage)
    shouldRun = true;
}

if (shouldRun) {
    main().catch((err) => {
        console.error('Unhandled error in main:', err);
        process.exit(1);
    });
}
