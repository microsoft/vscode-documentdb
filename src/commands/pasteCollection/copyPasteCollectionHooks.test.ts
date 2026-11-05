/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as vscode from 'vscode';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { ext } from '../../extensionVariables';
import { ConflictResolutionStrategy } from '../../services/taskService/data-api/types';
import { type TaskTelemetryContext } from '../../services/taskService/taskHost';
import { SourceValidationError } from '../../services/taskService/tasks/copy-and-paste/CopyPasteCollectionTask';
import { type CopyPasteConfig } from '../../services/taskService/tasks/copy-and-paste/copyPasteConfig';
import { createCollectMetadata, createValidateSource } from './copyPasteCollectionHooks';

vi.mock('../../documentdb/ClustersClient', () => ({
    ClustersClient: { getClient: vi.fn() },
}));

vi.mock('../../documentdb/CredentialCache', () => ({
    CredentialCache: { hasCredentials: vi.fn() },
}));

vi.mock('../../extensionVariables', () => ({
    ext: { copiedCollectionNode: undefined },
}));

vi.mock('vscode', () => ({
    commands: { executeCommand: vi.fn() },
    l10n: {
        t: (message: string, ...args: string[]): string =>
            args.reduce((result, value, index) => result.replace(`{${index}}`, value), message),
    },
}));

const config: CopyPasteConfig = {
    copyOperationCorrelationId: 'operation-id',
    source: { clusterId: 'source', databaseName: 'sourceDb', collectionName: 'sourceCollection' },
    target: { clusterId: 'target', databaseName: 'targetDb', collectionName: 'targetCollection' },
    onConflict: ConflictResolutionStrategy.Abort,
    copyIndexes: true,
};

function createContext(): TaskTelemetryContext {
    return { telemetry: { properties: {}, measurements: {} } };
}

beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(CredentialCache.hasCredentials).mockReturnValue(true);
    ext.copiedCollectionNode = { id: 'source/sourceDb/sourceCollection' } as NonNullable<
        typeof ext.copiedCollectionNode
    >;
    vi.mocked(vscode.commands.executeCommand).mockImplementation(async () => {
        expect(ext.copiedCollectionNode).toBeUndefined();
        return undefined;
    });
});

describe('createValidateSource', () => {
    it('clears the clipboard and records disconnected credentials before rejecting', async () => {
        vi.mocked(CredentialCache.hasCredentials).mockReturnValue(false);
        const context = createContext();

        const validation = createValidateSource(config)(new AbortController().signal, context);

        await expect(validation).rejects.toBeInstanceOf(SourceValidationError);
        await expect(validation).rejects.toThrow(
            'The source cluster is no longer connected. Please reconnect and copy the collection again.',
        );
        expect(ext.copiedCollectionNode).toBeUndefined();
        expect(vscode.commands.executeCommand).toHaveBeenCalledExactlyOnceWith(
            'setContext',
            'documentdb.copiedCollectionNode',
            false,
        );
        expect(context.telemetry.properties.sourceClusterDisconnected).toBe('true');
        expect(CredentialCache.hasCredentials).toHaveBeenCalledWith(config.source.clusterId);
        expect(ClustersClient.getClient).not.toHaveBeenCalled();
    });

    it('clears the clipboard and records a missing collection before rejecting', async () => {
        const listCollections = vi.fn().mockResolvedValue([{ name: 'anotherCollection' }]);
        vi.mocked(ClustersClient.getClient).mockResolvedValue({ listCollections } as unknown as ClustersClient);
        const context = createContext();

        const validation = createValidateSource(config)(new AbortController().signal, context);

        await expect(validation).rejects.toBeInstanceOf(SourceValidationError);
        await expect(validation).rejects.toThrow(
            'The source collection "sourceCollection" no longer exists in database "sourceDb". It may have been deleted or renamed.',
        );
        expect(ext.copiedCollectionNode).toBeUndefined();
        expect(vscode.commands.executeCommand).toHaveBeenCalledExactlyOnceWith(
            'setContext',
            'documentdb.copiedCollectionNode',
            false,
        );
        expect(context.telemetry.properties.sourceCollectionNotFound).toBe('true');
        expect(ClustersClient.getClient).toHaveBeenCalledWith(config.source.clusterId);
        expect(listCollections).toHaveBeenCalledWith(config.source.databaseName);
    });

    it('keeps the clipboard when the source collection exists without telemetry', async () => {
        const listCollections = vi.fn().mockResolvedValue([{ name: config.source.collectionName }]);
        vi.mocked(ClustersClient.getClient).mockResolvedValue({ listCollections } as unknown as ClustersClient);
        const copiedCollectionNode = ext.copiedCollectionNode;

        await expect(createValidateSource(config)(new AbortController().signal)).resolves.toBeUndefined();

        expect(ext.copiedCollectionNode).toBe(copiedCollectionNode);
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });

    it('leaves unexpected errors unchanged for the task to wrap without clearing the clipboard', async () => {
        const error = new Error('connection failed');
        vi.mocked(ClustersClient.getClient).mockRejectedValue(error);
        const copiedCollectionNode = ext.copiedCollectionNode;

        await expect(createValidateSource(config)(new AbortController().signal, createContext())).rejects.toBe(error);

        expect(ext.copiedCollectionNode).toBe(copiedCollectionNode);
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });
});

describe('createCollectMetadata', () => {
    it('prefixes source and target metadata properties', async () => {
        const sourceMetadata = vi.fn().mockResolvedValue({ serverInfo_version: '8.0', absent: undefined });
        const targetMetadata = vi.fn().mockResolvedValue({ serverInfo_version: '7.0' });
        vi.mocked(ClustersClient.getClient)
            .mockResolvedValueOnce({ getClusterMetadata: sourceMetadata } as unknown as ClustersClient)
            .mockResolvedValueOnce({ getClusterMetadata: targetMetadata } as unknown as ClustersClient);
        const context = createContext();

        await createCollectMetadata(config)(context);

        expect(ClustersClient.getClient).toHaveBeenNthCalledWith(1, config.source.clusterId);
        expect(ClustersClient.getClient).toHaveBeenNthCalledWith(2, config.target.clusterId);
        expect(sourceMetadata).toHaveBeenCalledOnce();
        expect(targetMetadata).toHaveBeenCalledOnce();
        expect(context.telemetry.properties).toEqual({
            source_serverInfo_version: '8.0',
            source_metadataCollectionSuccess: 'true',
            target_serverInfo_version: '7.0',
            target_metadataCollectionSuccess: 'true',
        });
    });

    it('skips target metadata when the source and target use the same cluster', async () => {
        const getClusterMetadata = vi.fn().mockResolvedValue({ serverInfo_version: '8.0' });
        vi.mocked(ClustersClient.getClient).mockResolvedValue({ getClusterMetadata } as unknown as ClustersClient);
        const context = createContext();

        await createCollectMetadata({
            ...config,
            target: { ...config.target, clusterId: config.source.clusterId },
        })(context);

        expect(ClustersClient.getClient).toHaveBeenCalledExactlyOnceWith(config.source.clusterId);
        expect(getClusterMetadata).toHaveBeenCalledOnce();
        expect(context.telemetry.properties).toEqual({
            source_serverInfo_version: '8.0',
            source_metadataCollectionSuccess: 'true',
        });
    });

    it.each([
        { error: new Error('metadata unavailable'), message: 'metadata unavailable' },
        { error: 'metadata unavailable', message: 'Unknown error' },
    ])('records metadata failures without preventing target metadata collection: $message', async ({ error, message }) => {
        vi.mocked(ClustersClient.getClient)
            .mockResolvedValueOnce({ getClusterMetadata: vi.fn().mockRejectedValue(error) } as unknown as ClustersClient)
            .mockResolvedValueOnce({ getClusterMetadata: vi.fn().mockResolvedValue({}) } as unknown as ClustersClient);
        const context = createContext();

        await expect(createCollectMetadata(config)(context)).resolves.toBeUndefined();

        expect(context.telemetry.properties).toEqual({
            source_metadata_error: message,
            source_metadataCollectionSuccess: 'false',
            target_metadataCollectionSuccess: 'true',
        });
    });
});
