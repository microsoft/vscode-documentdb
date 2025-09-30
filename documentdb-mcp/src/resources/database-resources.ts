import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp';
import { getDocumentDBContext } from '../context/documentdb';

export function registerDatabaseResources(server: McpServer) {
    // databases (list all)
    server.registerResource(
        'databases',
        'dbs://list',
        { title: 'Databases', description: 'List of all accessible databases' },
        async () => {
            const { client, connected } = getDocumentDBContext();
            if (!connected || !client) {
                throw new Error('Not connected to any DocumentDB instance.');
            }
            const admin = client.db().admin();
            const info = await admin.listDatabases();
            const names = info.databases.map((d) => d.name);
            return {
                contents: [
                    {
                        uri: 'dbs://list',
                        mimeType: 'application/json',
                        text: JSON.stringify(names, null, 2),
                    },
                ],
            } as any;
        },
    );

    // database_users template: database_users/{db}
    server.registerResource(
        'database_users',
        new ResourceTemplate('database_users/{db}', { list: async () => ({ resources: [] }) }),
        {
            title: 'Database Users',
            description: 'Database users and roles in the current database',
        },
        async (uri, vars) => {
            const { client, connected } = getDocumentDBContext();
            if (!connected || !client) {
                throw new Error('Not connected to any DocumentDB instance.');
            }
            const dbName = Array.isArray(vars.db) ? vars.db[0] : vars.db;
            const db = client.db(dbName);
            const usersInfo = await db.command({ usersInfo: 1 });
            return {
                contents: [
                    {
                        uri: uri.toString(),
                        mimeType: 'application/json',
                        text: JSON.stringify(usersInfo, null, 2),
                    },
                ],
            } as any;
        },
    );

    // database_triggers (change streams simulated info) database_triggers/{db}
    server.registerResource(
        'database_triggers',
        new ResourceTemplate('database_triggers/{db}', { list: async () => ({ resources: [] }) }),
        {
            title: 'Database Triggers',
            description: 'Database change streams and event triggers configuration (simulated)',
        },
        async (uri, vars) => {
            const dbName = Array.isArray(vars.db) ? vars.db[0] : vars.db;
            const data = {
                db: dbName,
                triggers: [],
                note: 'Triggers listing not implemented; integrate with your trigger storage.',
            };
            return {
                contents: [
                    {
                        uri: uri.toString(),
                        mimeType: 'application/json',
                        text: JSON.stringify(data, null, 2),
                    },
                ],
            } as any;
        },
    );

    // stored_functions stored_functions/{db}
    server.registerResource(
        'stored_functions',
        new ResourceTemplate('stored_functions/{db}', { list: async () => ({ resources: [] }) }),
        {
            title: 'Stored Functions',
            description: 'Stored JavaScript functions in the current database (system.js)',
        },
        async (uri, vars) => {
            const { client, connected } = getDocumentDBContext();
            if (!connected || !client) {
                throw new Error('Not connected to any DocumentDB instance.');
            }
            const dbName = Array.isArray(vars.db) ? vars.db[0] : vars.db;
            const db = client.db(dbName);
            const functions = await db
                .collection('system.js')
                .find()
                .toArray()
                .catch(() => []);
            return {
                contents: [
                    {
                        uri: uri.toString(),
                        mimeType: 'application/json',
                        text: JSON.stringify(functions, null, 2),
                    },
                ],
            } as any;
        },
    );
}
