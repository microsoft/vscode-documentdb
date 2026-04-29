/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { DEFAULT_SOURCE_ID, type KubeconfigSourceRecord } from '../config';

interface MockQuickPick {
    title?: string;
    placeholder?: string;
    canSelectMany?: boolean;
    ignoreFocusOut?: boolean;
    matchOnDescription?: boolean;
    matchOnDetail?: boolean;
    items: { source: KubeconfigSourceRecord; buttons?: unknown[] }[];
    selectedItems: { source: KubeconfigSourceRecord }[];
    show: jest.Mock;
    dispose: jest.Mock;
    onDidChangeSelection: (cb: (selected: { source: KubeconfigSourceRecord }[]) => void) => { dispose: jest.Mock };
    onDidTriggerItemButton: (cb: (event: { item: { source: KubeconfigSourceRecord } }) => Promise<void>) => void;
    onDidAccept: (cb: () => Promise<void>) => void;
    onDidHide: (cb: () => void) => void;
    triggerAccept: () => Promise<void>;
}

let activePicker: MockQuickPick | undefined;
let acceptHandler: (() => Promise<void>) | undefined;

const mockShowWarningMessage = jest.fn();
const mockSetHiddenSourceIds = jest.fn();
const mockReadHiddenSourceIds = jest.fn(async (): Promise<string[]> => []);
const mockReadSources = jest.fn(async (): Promise<KubeconfigSourceRecord[]> => []);
const mockRemoveSource = jest.fn();
const mockStopAllTunnels = jest.fn();
const mockRefresh = jest.fn();

jest.mock('vscode', () => ({
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    l10n: {
        t: jest.fn((message: string, ...values: string[]) =>
            values.reduce<string>((acc, v, i) => acc.replace(`{${String(i)}}`, v), message),
        ),
    },
    window: {
        createQuickPick: jest.fn(() => {
            const picker: MockQuickPick = {
                items: [],
                selectedItems: [],
                show: jest.fn(),
                dispose: jest.fn(),
                onDidChangeSelection: jest.fn(() => ({ dispose: jest.fn() })),
                onDidTriggerItemButton: jest.fn(),
                onDidAccept: jest.fn((cb: () => Promise<void>) => {
                    acceptHandler = cb;
                }),
                onDidHide: jest.fn(),
                triggerAccept: async () => {
                    if (acceptHandler) {
                        await acceptHandler();
                    }
                },
            };
            activePicker = picker;
            return picker;
        }),
        showWarningMessage: (...args: unknown[]) => mockShowWarningMessage(...args),
    },
}));

jest.mock('@microsoft/vscode-azext-utils', () => ({
    UserCancelledError: class UserCancelledError extends Error {},
}));

jest.mock('../../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            appendLine: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
        },
        discoveryBranchDataProvider: {
            refresh: mockRefresh,
            resetNodeErrorState: jest.fn(),
        },
    },
}));

jest.mock('../sources/sourceStore', () => ({
    readSources: () => mockReadSources(),
    readHiddenSourceIds: () => mockReadHiddenSourceIds(),
    setHiddenSourceIds: (ids: readonly string[]) => mockSetHiddenSourceIds(ids),
    removeSource: (id: string) => mockRemoveSource(id),
}));

jest.mock('../portForwardTunnel', () => ({
    PortForwardTunnelManager: {
        getInstance: () => ({ stopAll: mockStopAllTunnels }),
    },
}));

import { manageKubeconfigSources } from './manageKubeconfigSources';

function makeContext(): IActionContext {
    return {
        telemetry: { properties: {}, measurements: {} },
        valuesToMask: [],
        errorHandling: {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

beforeEach(() => {
    activePicker = undefined;
    acceptHandler = undefined;
    mockShowWarningMessage.mockReset();
    mockSetHiddenSourceIds.mockReset();
    mockReadHiddenSourceIds.mockReset();
    mockReadHiddenSourceIds.mockResolvedValue([]);
    mockReadSources.mockReset();
    mockRemoveSource.mockReset();
    mockStopAllTunnels.mockReset();
    mockRefresh.mockReset();
});

describe('manageKubeconfigSources', () => {
    const sources: KubeconfigSourceRecord[] = [
        { id: DEFAULT_SOURCE_ID, kind: 'default', label: 'Default kubeconfig' },
        { id: 'visible', kind: 'file', label: 'team.yaml', path: '/abs/team.yaml' },
        {
            id: 'hidden',
            kind: 'inline',
            label: 'Pasted YAML 1',
        },
    ];

    it('pre-selects only sources that are not hidden, including default when default is hidden', async () => {
        mockReadSources.mockResolvedValue(sources);
        mockReadHiddenSourceIds.mockResolvedValue([DEFAULT_SOURCE_ID, 'hidden']);

        const promise = manageKubeconfigSources(makeContext());
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await activePicker?.triggerAccept();
        await promise;

        const initialSelectionIds = activePicker?.selectedItems.map((it) => it.source.id);
        expect(initialSelectionIds).toEqual(['visible']);
        expect(mockSetHiddenSourceIds).toHaveBeenCalledWith([DEFAULT_SOURCE_ID, 'hidden']);
    });

    it('persists newly hidden ids when the user unchecks an entry (default included)', async () => {
        mockReadSources.mockResolvedValue(sources);
        mockReadHiddenSourceIds.mockResolvedValue([]);

        const promise = manageKubeconfigSources(makeContext());
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        if (!activePicker) {
            throw new Error('picker not created');
        }
        // Simulate user unchecking the default source.
        activePicker.selectedItems = activePicker.items.filter((it) => it.source.id !== DEFAULT_SOURCE_ID);
        await activePicker.triggerAccept();
        await promise;

        expect(mockSetHiddenSourceIds).toHaveBeenCalledWith([DEFAULT_SOURCE_ID]);
    });

    it('omits the remove button on the Default source so it cannot be deleted from the manage picker', async () => {
        mockReadSources.mockResolvedValue(sources);
        const promise = manageKubeconfigSources(makeContext());
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        if (!activePicker) {
            throw new Error('picker not created');
        }
        const buttonsByItem = Object.fromEntries(activePicker.items.map((it) => [it.source.id, it.buttons ?? []]));
        expect(buttonsByItem[DEFAULT_SOURCE_ID]?.length ?? 0).toBe(0);
        expect(buttonsByItem['visible']?.length).toBe(1);
        expect(buttonsByItem['hidden']?.length).toBe(1);
        await activePicker.triggerAccept();
        await promise;
    });
});
