import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp';
import { getDocumentDBContext } from '../context/documentdb';

// Naming convention: snake_case aligned with tools: collection_indexes, collection_schema, etc.
export function registerCollectionResources(server: McpServer) {
    // Template for per-collection resources: /collection/{db}/{collection}/<type>
    const collectionVarTemplate = (suffix: string) =>
        new ResourceTemplate(`collection/{db}/{collection}/${suffix}`, {
            list: async () => ({ resources: [] }), // listing omitted for minimal change; could enumerate all collections
        });

    // collection_indexes
    server.registerResource(
        'collection_indexes',
        collectionVarTemplate('indexes'),
        { title: 'Collection Indexes', description: 'Index information for a collection' },
        async (_uri, vars) => {
            const { client, connected } = getDocumentDBContext();
            if (!connected || !client) {
                throw new Error('Not connected to any DocumentDB instance.');
            }
            const dbName = Array.isArray(vars.db) ? vars.db[0] : vars.db;
            const collName = Array.isArray(vars.collection) ? vars.collection[0] : vars.collection;
            const db = client.db(dbName);
            const coll = db.collection(collName);
            const indexes = await coll.listIndexes().toArray();
            return {
                contents: [
                    {
                        uri: _uri.toString(),
                        mimeType: 'application/json',
                        text: JSON.stringify(indexes, null, 2),
                    },
                ],
            } as any;
        },
    );

    // collection_schema (heuristic via sampling & key aggregation)
    server.registerResource(
        'collection_schema',
        collectionVarTemplate('schema'),
        {
            title: 'Collection Schema',
            description: 'Schema information (inferred) for a collection',
        },
        async (_uri, vars) => {
            const { client, connected } = getDocumentDBContext();
            if (!connected || !client) {
                throw new Error('Not connected to any DocumentDB instance.');
            }
            const dbName = Array.isArray(vars.db) ? vars.db[0] : vars.db;
            const collName = Array.isArray(vars.collection) ? vars.collection[0] : vars.collection;
            const db = client.db(dbName);
            const coll = db.collection(collName);
            const sample = await coll.aggregate([{ $sample: { size: 20 } }]).toArray();
            const fieldTypes: Record<string, Set<string>> = {};
            for (const doc of sample) {
                for (const [k, v] of Object.entries(doc)) {
                    const t = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
                    fieldTypes[k] = fieldTypes[k] || new Set();
                    fieldTypes[k].add(t);
                }
            }
            const schema = Object.fromEntries(Object.entries(fieldTypes).map(([k, set]) => [k, Array.from(set)]));
            return {
                contents: [
                    {
                        uri: _uri.toString(),
                        mimeType: 'application/json',
                        text: JSON.stringify(schema, null, 2),
                    },
                ],
            } as any;
        },
    );

    // collection_stats (reuse collStats)
    server.registerResource(
        'collection_stats',
        collectionVarTemplate('stats'),
        {
            title: 'Collection Stats',
            description: 'Performance and size statistics for a collection',
        },
        async (_uri, vars) => {
            const { client, connected } = getDocumentDBContext();
            if (!connected || !client) {
                throw new Error('Not connected to any DocumentDB instance.');
            }
            const dbName = Array.isArray(vars.db) ? vars.db[0] : vars.db;
            const collName = Array.isArray(vars.collection) ? vars.collection[0] : vars.collection;
            const db = client.db(dbName);
            const stats = await db.command({ collStats: collName, verbose: true });
            return {
                contents: [
                    {
                        uri: _uri.toString(),
                        mimeType: 'application/json',
                        text: JSON.stringify(stats, null, 2),
                    },
                ],
            } as any;
        },
    );

    // collection_validation (validator rules)
    server.registerResource(
        'collection_validation',
        collectionVarTemplate('validation'),
        {
            title: 'Collection Validation',
            description: 'Validation rules (JSON Schema) for a collection',
        },
        async (_uri, vars) => {
            const { client, connected } = getDocumentDBContext();
            if (!connected || !client) {
                throw new Error('Not connected to any DocumentDB instance.');
            }
            const dbName = Array.isArray(vars.db) ? vars.db[0] : vars.db;
            const collName = Array.isArray(vars.collection) ? vars.collection[0] : vars.collection;
            const db = client.db(dbName);
            const info = await db.command({ listCollections: 1, filter: { name: collName } });
            const collInfo = info.cursor.firstBatch[0];
            const validation = collInfo?.options?.validator || {};
            return {
                contents: [
                    {
                        uri: _uri.toString(),
                        mimeType: 'application/json',
                        text: JSON.stringify(validation, null, 2),
                    },
                ],
            } as any;
        },
    );

    // collections (list collections in a db) static template collections/{db}
    server.registerResource(
        'collections',
        new ResourceTemplate('collections/{db}', {
            list: async () => ({ resources: [] }),
        }),
        { title: 'Collections', description: 'List of collections in the current database' },
        async (_uri, vars) => {
            const { client, connected } = getDocumentDBContext();
            if (!connected || !client) {
                throw new Error('Not connected to any DocumentDB instance.');
            }
            const dbName = Array.isArray(vars.db) ? vars.db[0] : vars.db;
            const db = client.db(dbName);
            const cols = await db.listCollections().toArray();
            const names = cols.map((c) => c.name);
            return {
                contents: [
                    {
                        uri: _uri.toString(),
                        mimeType: 'application/json',
                        text: JSON.stringify(names, null, 2),
                    },
                ],
            } as any;
        },
    );
}
