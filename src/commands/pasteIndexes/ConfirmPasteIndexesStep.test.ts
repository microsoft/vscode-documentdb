import * as vscode from 'vscode';
import { type CollectionIndexCopier } from '../../services/taskService/data-api/indexes/CollectionIndexCopier';
import { ConfirmPasteIndexesStep } from './ConfirmPasteIndexesStep';
import { type PasteIndexesWizardContext } from './PasteIndexesWizardContext';

const showInformationMessage = vscode.window.showInformationMessage as unknown as jest.MockedFunction<
    (message: string, options: vscode.MessageOptions, ...items: string[]) => Thenable<string | undefined>
>;
const showWarningMessage = vscode.window.showWarningMessage as unknown as jest.MockedFunction<
    (message: string, options: vscode.MessageOptions, ...items: string[]) => Thenable<string | undefined>
>;

function createContext(scope: PasteIndexesWizardContext['scope']): PasteIndexesWizardContext {
    return {
        source: { clusterId: 'source', databaseName: 'sourceDb', collectionName: 'sourceCollection' },
        target: { clusterId: 'target', databaseName: 'targetDb', collectionName: 'targetCollection' },
        sourceConnectionName: 'Source',
        targetConnectionName: 'Target',
        targetIndexesId: 'target/indexes',
        scope,
        indexCopier: {} as CollectionIndexCopier,
        catalogCount: 4,
        copyableCount: 2,
        copyableIndexNames: ['email_1', 'expires_1'],
        excluded: [
            { name: '_id_', type: 'traditional', reason: 'builtInId' },
            { name: 'search', type: 'search', reason: 'notCopyable' },
        ],
        uniqueIndexNames: [],
        ttlIndexNames: [],
        telemetry: { properties: {}, measurements: {} },
    } as unknown as PasteIndexesWizardContext;
}

describe('ConfirmPasteIndexesStep', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        showInformationMessage.mockResolvedValue('Paste Indexes');
        showWarningMessage.mockResolvedValue('Paste Indexes');
    });

    it('shows parent catalog counts and itemized exclusions', async () => {
        await new ConfirmPasteIndexesStep().prompt(createContext({ kind: 'allIndexes' }));

        const options = showInformationMessage.mock.calls[0][1];
        expect(options.detail).toContain('2 of 4 indexes will be copied.');
        expect(options.detail).toContain('"_id_" (the target\'s own _id index already exists or is created automatically)');
        expect(options.detail).toContain('"search" (search index - recreate it manually on the target)');
        expect(options.detail).toContain('Search-index exclusions are best-effort');
    });

    it('shows only the selected index and selected warnings for a single-index copy', async () => {
        const context = createContext({ kind: 'index', indexName: 'email_1' });
        context.uniqueIndexNames = ['email_1'];

        await new ConfirmPasteIndexesStep().prompt(context);

        const options = showWarningMessage.mock.calls[0][1];
        expect(options.detail).toContain('Index to copy: "email_1"');
        expect(options.detail).toContain('existing target documents contain duplicate values');
        expect(options.detail).not.toContain('2 of 4');
        expect(options.detail).not.toContain('search');
        expect(options.detail).not.toContain('_id_');
        expect(options.detail).not.toContain('generated');
    });

    it('uses dedicated TTL wording about existing target data', async () => {
        const context = createContext({ kind: 'index', indexName: 'expires_1' });
        context.ttlIndexNames = ['expires_1'];

        await new ConfirmPasteIndexesStep().prompt(context);

        expect(showWarningMessage.mock.calls[0][1].detail).toContain(
            'may delete expired documents already in the target collection',
        );
    });

    it('omits the exclusion line when the parent catalog has no exclusions', async () => {
        const context = createContext({ kind: 'allIndexes' });
        context.catalogCount = 2;
        context.excluded = [];

        await new ConfirmPasteIndexesStep().prompt(context);

        expect(showInformationMessage.mock.calls[0][1].detail).toContain('2 of 2 indexes will be copied.');
        expect(showInformationMessage.mock.calls[0][1].detail).not.toContain('Not copied:');
    });

    it('reports an empty parent selection with its known exclusions', async () => {
        const context = createContext({ kind: 'allIndexes' });
        context.copyableCount = 0;
        context.copyableIndexNames = [];

        await new ConfirmPasteIndexesStep().prompt(context);

        expect(showInformationMessage.mock.calls[0][1].detail).toContain(
            'There are no copyable secondary indexes in the source collection.',
        );
        expect(showInformationMessage.mock.calls[0][1].detail).toContain('Not copied:');
    });

    it('cancels before execution when confirmation is dismissed', async () => {
        showInformationMessage.mockResolvedValue(undefined);

        await expect(new ConfirmPasteIndexesStep().prompt(createContext({ kind: 'allIndexes' }))).rejects.toThrow();
    });
});