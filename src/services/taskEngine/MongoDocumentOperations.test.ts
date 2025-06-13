/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/unbound-method */

import { MongoDocumentReader, MongoDocumentWriter } from './MongoDocumentOperations';
import { type DocumentDetails } from './DocumentInterfaces';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { type WithId, type Document, ObjectId } from 'mongodb';

// Mock ClustersClient
jest.mock('../../documentdb/ClustersClient');

describe('MongoDocumentOperations', () => {
    let mockClient: jest.Mocked<ClustersClient>;

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();

        // Create mock client instance
        mockClient = {
            streamDocuments: jest.fn(),
            runQuery: jest.fn(),
            insertDocuments: jest.fn(),
            listCollections: jest.fn(),
            createCollection: jest.fn(),
        } as unknown as jest.Mocked<ClustersClient>;

        // Mock the static getClient method
        (ClustersClient.getClient as jest.Mock).mockResolvedValue(mockClient);
    });

    describe('MongoDocumentReader', () => {
        let reader: MongoDocumentReader;

        beforeEach(() => {
            reader = new MongoDocumentReader();
        });

        describe('streamDocuments', () => {
            it('should stream documents and convert them to DocumentDetails format', async () => {
                const mockDocuments = [
                    { _id: new ObjectId('507f1f77bcf86cd799439011'), name: 'Doc 1' },
                    { _id: new ObjectId('507f1f77bcf86cd799439012'), name: 'Doc 2' },
                    { _id: new ObjectId('507f1f77bcf86cd799439013'), name: 'Doc 3' },
                ];

                // Mock the async generator
                async function* mockStreamDocuments() {
                    for (const doc of mockDocuments) {
                        yield doc;
                    }
                }

                mockClient.streamDocuments.mockReturnValue(mockStreamDocuments());

                const documents: DocumentDetails[] = [];
                for await (const doc of reader.streamDocuments('conn-1', 'test-db', 'test-coll')) {
                    documents.push(doc);
                }

                expect(documents).toHaveLength(3);
                expect(documents[0]).toEqual({
                    id: new ObjectId('507f1f77bcf86cd799439011'),
                    documentContent: { _id: new ObjectId('507f1f77bcf86cd799439011'), name: 'Doc 1' },
                });
                expect(documents[1]).toEqual({
                    id: new ObjectId('507f1f77bcf86cd799439012'),
                    documentContent: { _id: new ObjectId('507f1f77bcf86cd799439012'), name: 'Doc 2' },
                });

                expect(mockClient.streamDocuments).toHaveBeenCalledWith(
                    'test-db',
                    'test-coll',
                    expect.any(AbortSignal),
                    '{}',
                    0,
                    0,
                );
            });

            it('should handle empty document stream', async () => {
                async function* emptyStream() {
                    // Empty generator
                }

                mockClient.streamDocuments.mockReturnValue(emptyStream());

                const documents: DocumentDetails[] = [];
                for await (const doc of reader.streamDocuments('conn-1', 'test-db', 'test-coll')) {
                    documents.push(doc);
                }

                expect(documents).toHaveLength(0);
            });
        });

        describe('countDocuments', () => {
            it('should return document count from runQuery', async () => {
                const mockDocuments: WithId<Document>[] = [
                    { _id: new ObjectId('507f1f77bcf86cd799439011'), name: 'Doc 1' },
                    { _id: new ObjectId('507f1f77bcf86cd799439012'), name: 'Doc 2' },
                ];

                mockClient.runQuery.mockResolvedValue(mockDocuments);

                const count = await reader.countDocuments('conn-1', 'test-db', 'test-coll');

                expect(count).toBe(2);
                expect(mockClient.runQuery).toHaveBeenCalledWith('test-db', 'test-coll', '{}', 0, 0);
            });

            it('should return 0 for empty collection', async () => {
                mockClient.runQuery.mockResolvedValue([]);

                const count = await reader.countDocuments('conn-1', 'test-db', 'test-coll');

                expect(count).toBe(0);
            });
        });
    });

    describe('MongoDocumentWriter', () => {
        let writer: MongoDocumentWriter;

        beforeEach(() => {
            writer = new MongoDocumentWriter();
        });

        describe('writeDocuments', () => {
            it('should write documents and return success result', async () => {
                const documents = [
                    { id: '1', documentContent: { _id: '1', name: 'Doc 1' } },
                    { id: '2', documentContent: { _id: '2', name: 'Doc 2' } },
                ];

                mockClient.insertDocuments.mockResolvedValue({ insertedCount: 2 });

                const result = await writer.writeDocuments('conn-1', 'test-db', 'test-coll', documents);

                expect(result.insertedCount).toBe(2);
                expect(result.errors).toHaveLength(0);

                expect(mockClient.insertDocuments).toHaveBeenCalledWith('test-db', 'test-coll', [
                    { _id: '1', name: 'Doc 1' },
                    { _id: '2', name: 'Doc 2' },
                ]);
            });

            it('should handle empty document array', async () => {
                const result = await writer.writeDocuments('conn-1', 'test-db', 'test-coll', []);

                expect(result.insertedCount).toBe(0);
                expect(result.errors).toHaveLength(0);
                expect(mockClient.insertDocuments).not.toHaveBeenCalled();
            });

            it('should handle insertion errors', async () => {
                const documents = [
                    { id: '1', documentContent: { _id: '1', name: 'Doc 1' } },
                ];

                const error = new Error('Insertion failed');
                mockClient.insertDocuments.mockRejectedValue(error);

                const result = await writer.writeDocuments('conn-1', 'test-db', 'test-coll', documents);

                expect(result.insertedCount).toBe(0);
                expect(result.errors).toHaveLength(1);
                expect(result.errors[0].documentId).toBe('1');
                expect(result.errors[0].error).toBe(error);
            });
        });

        describe('ensureCollectionExists', () => {
            it('should not create collection if it already exists', async () => {
                mockClient.listCollections.mockResolvedValue([
                    { name: 'test-coll', type: 'collection' },
                    { name: 'other-coll', type: 'collection' },
                ]);

                await writer.ensureCollectionExists('conn-1', 'test-db', 'test-coll');

                expect(mockClient.listCollections).toHaveBeenCalledWith('test-db');
                expect(mockClient.createCollection).not.toHaveBeenCalled();
            });

            it('should create collection if it does not exist', async () => {
                mockClient.listCollections.mockResolvedValue([
                    { name: 'other-coll', type: 'collection' },
                ]);

                await writer.ensureCollectionExists('conn-1', 'test-db', 'test-coll');

                expect(mockClient.listCollections).toHaveBeenCalledWith('test-db');
                expect(mockClient.createCollection).toHaveBeenCalledWith('test-db', 'test-coll');
            });

            it('should handle list collections failure by attempting to create collection', async () => {
                mockClient.listCollections.mockRejectedValue(new Error('List failed'));
                mockClient.createCollection.mockResolvedValue(undefined as any); // eslint-disable-line @typescript-eslint/no-unsafe-argument

                await writer.ensureCollectionExists('conn-1', 'test-db', 'test-coll');

                expect(mockClient.listCollections).toHaveBeenCalledWith('test-db');
                expect(mockClient.createCollection).toHaveBeenCalledWith('test-db', 'test-coll');
            });

            it('should handle collection already exists error during creation', async () => {
                mockClient.listCollections.mockRejectedValue(new Error('List failed'));
                mockClient.createCollection.mockRejectedValue(new Error('Collection already exists'));

                // Should not throw an error
                await expect(writer.ensureCollectionExists('conn-1', 'test-db', 'test-coll')).resolves.not.toThrow();
            });

            it('should rethrow unexpected creation errors', async () => {
                mockClient.listCollections.mockRejectedValue(new Error('List failed'));
                mockClient.createCollection.mockRejectedValue(new Error('Unexpected error'));

                await expect(writer.ensureCollectionExists('conn-1', 'test-db', 'test-coll')).rejects.toThrow('Unexpected error');
            });
        });
    });
});