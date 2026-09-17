import { type IActionContext, openUrl } from '@microsoft/vscode-azext-utils';
import { window } from 'vscode';
import { ext } from '../../extensionVariables';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';
import { copyCollection } from './copyCollection';

jest.mock('@microsoft/vscode-azext-utils', () => ({
    openUrl: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../extensionVariables', () => ({
    ext: { copiedCollectionNode: undefined },
}));

const showInformationMessage = window.showInformationMessage as unknown as jest.MockedFunction<
    (message: string, ...items: string[]) => Thenable<string | undefined>
>;

function createContext(): IActionContext {
    return { telemetry: { properties: {}, measurements: {} } } as IActionContext;
}

const node = {
    collectionInfo: { name: 'collection' },
    databaseInfo: { name: 'database' },
} as CollectionItem;

describe('copyCollection notification', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        ext.copiedCollectionNode = undefined;
    });

    it('offers Cancel Copy and clears the collection selection when chosen', async () => {
        showInformationMessage.mockResolvedValue('Cancel Copy');
        const context = createContext();

        await copyCollection(context, node);

        expect(showInformationMessage).toHaveBeenCalledWith(
            expect.any(String),
            'OK',
            'Cancel Copy',
            'Learn More',
        );
        expect(ext.copiedCollectionNode).toBeUndefined();
        expect(context.telemetry.properties.copiedCollectionUndone).toBe('true');
    });

    it('opens documentation from Learn More', async () => {
        showInformationMessage.mockResolvedValue('Learn More');
        const context = createContext();

        await copyCollection(context, node);

        expect(openUrl).toHaveBeenCalledWith('https://aka.ms/vscode-documentdb-copy-and-paste');
        expect(context.telemetry.properties.learnMoreClicked).toBe('true');
    });
});