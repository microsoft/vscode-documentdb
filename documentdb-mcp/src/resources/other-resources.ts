import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { getDocumentDBContext } from '../context/documentdb';

export function registerOtherResources(server: McpServer) {
    // server_status
    server.registerResource(
        'server_status',
        'server://status',
        { title: 'Server Status', description: 'Server status information' },
        async () => {
            const { client, connected } = getDocumentDBContext();
            if (!connected || !client) {
                throw new Error('Not connected to any DocumentDB instance.');
            }
            const status = await client.db().admin().serverStatus();
            return {
                contents: [
                    {
                        uri: 'server://status',
                        mimeType: 'application/json',
                        text: JSON.stringify(status, null, 2),
                    },
                ],
            } as any;
        },
    );

    // replica_status
    server.registerResource(
        'replica_status',
        'server://replica_status',
        { title: 'Replica Status', description: 'Replica set status and configuration' },
        async () => {
            const { client, connected } = getDocumentDBContext();
            if (!connected || !client) {
                throw new Error('Not connected to any DocumentDB instance.');
            }
            try {
                const rsStatus = await client.db().admin().command({ replSetGetStatus: 1 });
                return {
                    contents: [
                        {
                            uri: 'server://replica_status',
                            mimeType: 'application/json',
                            text: JSON.stringify(rsStatus, null, 2),
                        },
                    ],
                } as any;
            } catch (e) {
                return {
                    contents: [
                        {
                            uri: 'server://replica_status',
                            mimeType: 'application/json',
                            text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }, null, 2),
                        },
                    ],
                } as any;
            }
        },
    );

    // performance_metrics (subset from serverStatus)
    server.registerResource(
        'performance_metrics',
        'server://performance_metrics',
        {
            title: 'Performance Metrics',
            description: 'Real-time performance metrics and profiling data',
        },
        async () => {
            const { client, connected } = getDocumentDBContext();
            if (!connected || !client) {
                throw new Error('Not connected to any DocumentDB instance.');
            }
            const status = await client.db().admin().serverStatus();
            const subset = {
                host: status.host,
                version: status.version,
                uptime: status.uptime,
                opcounters: status.opcounters,
                connections: status.connections,
                mem: status.mem,
                wiredTiger: status.wiredTiger?.cache ? { cache: status.wiredTiger.cache } : undefined,
            };
            return {
                contents: [
                    {
                        uri: 'server://performance_metrics',
                        mimeType: 'application/json',
                        text: JSON.stringify(subset, null, 2),
                    },
                ],
            } as any;
        },
    );
}
