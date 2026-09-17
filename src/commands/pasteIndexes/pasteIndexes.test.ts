import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { CopyPasteBufferService } from '../../services/CopyPasteBufferService';
import { createIndexCopier } from '../../services/taskService/data-api/indexes/createIndexCopier';
import { type IndexesItem } from '../../tree/documentdb/IndexesItem';
import { pasteIndexes } from './pasteIndexes';

jest.mock('../../documentdb/CredentialCache', () => ({ CredentialCache: { hasCredentials: jest.fn() } }));
jest.mock('../../services/CopyPasteBufferService', () => ({
    CopyPasteBufferService: { getIndexes: jest.fn(), clearIndexes: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../services/taskService/data-api/indexes/createIndexCopier', () => ({ createIndexCopier: jest.fn() }));
jest.mock('@microsoft/vscode-azext-utils', () => ({
    AzureWizard: jest.fn().mockImplementation(() => ({
        prompt: jest.fn().mockResolvedValue(undefined),
        execute: jest.fn().mockResolvedValue(undefined),
    })),
    AzureWizardPromptStep: class {},
    AzureWizardExecuteStep: class {},
    UserCancelledError: class UserCancelledError extends Error {},
}));

function createContext(): IActionContext {
    return { telemetry: { properties: {}, measurements: {} } } as IActionContext;
}

const targetNode = {
    id: 'target-tree/db/collection/indexes',
    cluster: { clusterId: 'target', name: 'Target' },
    databaseInfo: { name: 'targetDb' },
    collectionInfo: { name: 'targetCollection' },
} as IndexesItem;

describe('pasteIndexes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(CredentialCache.hasCredentials).mockReturnValue(true);
        jest.mocked(createIndexCopier).mockReturnValue({} as ReturnType<typeof createIndexCopier>);
    });

    it('rejects an empty copied-index buffer with an actionable message', async () => {
        jest.mocked(CopyPasteBufferService.getIndexes).mockReturnValue(undefined);

        await expect(pasteIndexes(createContext(), targetNode)).rejects.toThrow('Use Copy Index or Copy Indexes first');
    });

    it('rejects the same source and target collection using stable identity', async () => {
        jest.mocked(CopyPasteBufferService.getIndexes).mockReturnValue({
            source: { clusterId: 'target', databaseName: 'targetDb', collectionName: 'targetCollection' },
            sourceConnectionName: 'Target',
            scope: { kind: 'allIndexes' },
        });

        await expect(pasteIndexes(createContext(), targetNode)).rejects.toThrow(
            'Source and target must be different collections',
        );
    });

    it('accepts a cross-connection target and leaves the buffer intact', async () => {
        jest.mocked(CopyPasteBufferService.getIndexes).mockReturnValue({
            source: { clusterId: 'source', databaseName: 'sourceDb', collectionName: 'sourceCollection' },
            sourceConnectionName: 'Source',
            scope: { kind: 'index', indexName: 'email_1' },
        });

        await pasteIndexes(createContext(), targetNode);

        expect(AzureWizard).toHaveBeenCalledWith(
            expect.objectContaining({
                sourceIndexNames: ['email_1'],
                targetIndexesId: 'target-tree/db/collection/indexes',
            }),
            expect.any(Object),
        );
        expect(CopyPasteBufferService.clearIndexes).not.toHaveBeenCalled();
    });
});