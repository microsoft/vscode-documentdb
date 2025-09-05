/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'dotenv/config';

export interface MCPConfig {
    transport: 'stdio' | 'sse' | 'streamable-http';
    host: string;
    port: number;
    documentDbUri: string;
}

export const config: MCPConfig = {
    transport: (process.env.TRANSPORT as 'stdio' | 'sse' | 'streamable-http') || 'stdio',
    host: process.env.HOST || 'localhost',
    port: parseInt(process.env.PORT || '8070', 10),
    documentDbUri: process.env.DOCUMENTDB_URI || 'mongodb://localhost:27017',
};