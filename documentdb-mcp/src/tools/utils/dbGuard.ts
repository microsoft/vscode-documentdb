import { ensureConnected, getDocumentDBContext } from '../../context/documentdb';

/**
 * Wrap a handler so that it only executes when a DB connection is available.
 * If not connected, attempts a lazy ensureConnected(). If still disconnected, returns a standard error payload.
 */
export function withDbGuard<Inp extends Record<string, any>>(handler: (input: Inp) => Promise<any> | any) {
    return async (input: Inp) => {
        // First check existing context
        let { connected } = getDocumentDBContext();
        if (!connected) {
            const ctx = await ensureConnected();
            connected = ctx.connected;
        }
        if (!connected) {
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(
                            { error: 'Not connected to any DocumentDB instance. Use connect_mongodb first.' },
                            null,
                            2,
                        ),
                    },
                ],
                isError: true,
            };
        }
        return handler(input);
    };
}
