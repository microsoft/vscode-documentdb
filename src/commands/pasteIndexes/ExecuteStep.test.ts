import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { type CollectionIndexCopier } from '../../services/taskService/data-api/indexes/CollectionIndexCopier';
import { CopyIndexesTask } from '../../services/taskService/tasks/copy-indexes/CopyIndexesTask';
import { TaskService, TaskState, type TaskStateChangeEvent } from '../../services/taskService/taskService';
import { ExecuteStep } from './ExecuteStep';
import { type PasteIndexesWizardContext } from './PasteIndexesWizardContext';

const stateListeners: Array<(event: TaskStateChangeEvent) => void> = [];
const start = jest.fn().mockResolvedValue(undefined);
const fakeTask = {
    start,
    onDidChangeState: jest.fn((listener: (event: TaskStateChangeEvent) => void) => {
        stateListeners.push(listener);
        return { dispose: jest.fn() };
    }),
};

jest.mock('../../services/taskService/tasks/copy-indexes/CopyIndexesTask', () => ({
    CopyIndexesTask: jest.fn(() => fakeTask),
}));
jest.mock('../../services/taskService/taskService', () => {
    const actual = jest.requireActual('../../services/taskService/taskService') as object;
    return { ...actual, TaskService: { registerTask: jest.fn() } };
});
jest.mock('../../extensionVariables', () => ({
    ext: {
        state: {
            notifyChildrenChanged: jest.fn(),
            runWithTemporaryDescription: jest.fn(
                (_id: string, _description: string, callback: () => Promise<void>) => callback(),
            ),
        },
    },
}));

function createContext(): PasteIndexesWizardContext {
    return {
        source: { clusterId: 'source', databaseName: 'sourceDb', collectionName: 'sourceCollection' },
        target: { clusterId: 'target', databaseName: 'targetDb', collectionName: 'targetCollection' },
        sourceConnectionName: 'Source',
        targetConnectionName: 'Target',
        targetIndexesId: 'target-tree/indexes',
        scope: { kind: 'allIndexes' },
        indexCopier: {} as CollectionIndexCopier,
        catalogCount: 0,
        copyableCount: 0,
        copyableIndexNames: [],
        excluded: [],
        uniqueIndexNames: [],
        ttlIndexNames: [],
        telemetry: { properties: {}, measurements: {} },
    } as unknown as PasteIndexesWizardContext & IActionContext;
}

describe('Paste Indexes ExecuteStep', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        stateListeners.length = 0;
    });

    it.each([TaskState.Completed, TaskState.Failed, TaskState.Stopped])(
        'annotates and refreshes the target indexes node when the task reaches %s',
        async (terminalState) => {
            await new ExecuteStep().execute(createContext());

            expect(CopyIndexesTask).toHaveBeenCalled();
            expect(TaskService.registerTask).toHaveBeenCalledWith(fakeTask);
            expect(ext.state.runWithTemporaryDescription).toHaveBeenCalledWith(
                'target-tree/indexes',
                'Pasting...',
                expect.any(Function),
                true,
            );
            expect(start).toHaveBeenCalledTimes(1);

            for (const listener of [...stateListeners]) {
                listener({ previousState: TaskState.Running, newState: terminalState, taskId: 'task' });
            }
            expect(ext.state.notifyChildrenChanged).toHaveBeenCalledWith('target-tree/indexes');
        },
    );
});