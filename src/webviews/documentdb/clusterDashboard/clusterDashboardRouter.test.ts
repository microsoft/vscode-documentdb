import type { Document, MongoClient } from 'mongodb';

import { collectRawCommandReplies } from './clusterDashboardRouter';

describe('collectRawCommandReplies', () => {
    it('keeps each command invocation beside its raw response or error', async () => {
        const command = jest.fn(async (invocation: Document): Promise<Document> => {
            if (invocation.serverStatus === 1) {
                throw new Error('not authorized');
            }

            return { ok: 1, commandName: Object.keys(invocation)[0] };
        });
        const client = {
            db: () => ({ admin: () => ({ command }) }),
        } as unknown as MongoClient;

        const diagnostics = await collectRawCommandReplies(client);

        expect(diagnostics).toHaveLength(2);
        expect(diagnostics[0]).toEqual({
            database: 'admin',
            command: { buildInfo: 1 },
            result: { ok: true, response: { ok: 1, commandName: 'buildInfo' } },
        });
        expect(diagnostics[1]).toEqual({
            database: 'admin',
            command: { serverStatus: 1 },
            result: { ok: false, error: 'not authorized' },
        });
    });
});