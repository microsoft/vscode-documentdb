/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MongoClient } from 'mongodb';
import { DocumentDBServiceProvider } from './DocumentDBServiceProvider';
import { DocumentDBShellRuntime } from './DocumentDBShellRuntime';

// Mock @mongosh modules to avoid needing a real database connection
jest.mock('@mongosh/shell-api', () => ({
    ShellInstanceState: jest.fn().mockImplementation(() => ({
        displayBatchSizeFromDBQuery: 50,
        setCtx: jest.fn(),
        setEvaluationListener: jest.fn(),
    })),
}));

jest.mock('@mongosh/shell-evaluator', () => ({
    ShellEvaluator: jest.fn().mockImplementation(() => ({
        customEval: jest.fn().mockResolvedValue({
            type: 'Document',
            printable: { _id: 1 },
        }),
    })),
}));

jest.mock('./DocumentDBServiceProvider', () => ({
    DocumentDBServiceProvider: {
        createForDocumentDB: jest.fn().mockReturnValue({
            serviceProvider: {},
            bus: { on: jest.fn(), emit: jest.fn() },
        }),
    },
}));

const mockCreateForDocumentDB = DocumentDBServiceProvider.createForDocumentDB as jest.MockedFunction<
    typeof DocumentDBServiceProvider.createForDocumentDB
>;

describe('DocumentDBShellRuntime', () => {
    let mockClient: MongoClient;

    beforeEach(() => {
        mockClient = {} as MongoClient;
        jest.clearAllMocks();
    });

    describe('persistent: false (default)', () => {
        it('creates fresh @mongosh context per evaluate() call', async () => {
            const runtime = new DocumentDBShellRuntime(mockClient);

            await runtime.evaluate('db.test.find()', 'testDb');
            await runtime.evaluate('db.test.find()', 'testDb');

            // Each evaluate() should create a new service provider
            expect(mockCreateForDocumentDB).toHaveBeenCalledTimes(2);
        });

        it('returns intercepted results without creating context', async () => {
            const runtime = new DocumentDBShellRuntime(mockClient);

            const result = await runtime.evaluate('help', 'testDb');

            expect(result.type).toBe('Help');
            expect(mockCreateForDocumentDB).not.toHaveBeenCalled();
        });
    });

    describe('persistent: true', () => {
        it('creates @mongosh context only once across multiple evaluate() calls', async () => {
            const runtime = new DocumentDBShellRuntime(mockClient, undefined, {
                persistent: true,
            });

            await runtime.evaluate('db.test.find()', 'testDb');
            await runtime.evaluate('db.test.find()', 'testDb');
            await runtime.evaluate('db.test.find()', 'testDb');

            // Only the first evaluate() should create the service provider
            expect(mockCreateForDocumentDB).toHaveBeenCalledTimes(1);
        });

        it('returns intercepted results without creating context', async () => {
            const runtime = new DocumentDBShellRuntime(mockClient, undefined, {
                persistent: true,
            });

            const result = await runtime.evaluate('help', 'testDb');

            expect(result.type).toBe('Help');
            expect(mockCreateForDocumentDB).not.toHaveBeenCalled();
        });

        it('clears persistent state on dispose()', async () => {
            const runtime = new DocumentDBShellRuntime(mockClient, undefined, {
                persistent: true,
            });

            await runtime.evaluate('db.test.find()', 'testDb');
            expect(mockCreateForDocumentDB).toHaveBeenCalledTimes(1);

            runtime.dispose();

            // After dispose, evaluate should throw
            await expect(runtime.evaluate('db.test.find()', 'testDb')).rejects.toThrow(
                'Shell runtime has been disposed',
            );
        });
    });

    describe('dispose', () => {
        it('throws on evaluate() after dispose', async () => {
            const runtime = new DocumentDBShellRuntime(mockClient);
            runtime.dispose();

            await expect(runtime.evaluate('help', 'testDb')).rejects.toThrow('Shell runtime has been disposed');
        });
    });
});
