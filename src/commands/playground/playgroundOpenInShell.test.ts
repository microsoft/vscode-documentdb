/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

const getConnection = vi.fn();

vi.mock('vscode', () => ({
    commands: { executeCommand: vi.fn() },
    l10n: { t: vi.fn((message: string) => message) },
    window: { showWarningMessage: vi.fn() },
    workspace: { openTextDocument: vi.fn(async () => ({ getText: () => 'db.orders.find()\n' })) },
    Range: class {},
}));

vi.mock('../../documentdb/playground/PlaygroundService', () => ({
    PlaygroundService: { getInstance: () => ({ getConnection }) },
}));

import { playgroundOpenQueryInShell } from './playgroundOpenInShell';

describe('playgroundOpenQueryInShell', () => {
    it("opens the shell in the playground connection's tree view", async () => {
        getConnection.mockReturnValue({
            clusterId: 'cluster-id',
            clusterDisplayName: 'Test cluster',
            databaseName: 'shop',
            viewId: 'discoveryView',
        });
        const context = { telemetry: { properties: {}, measurements: {} } } as unknown as IActionContext;

        await playgroundOpenQueryInShell(context, {} as vscode.Uri, 0, 0);

        expect(vscode.commands.executeCommand).toHaveBeenCalledWith('vscode-documentdb.command.shell.open.withInput', {
            clusterId: 'cluster-id',
            clusterDisplayName: 'Test cluster',
            databaseName: 'shop',
            viewId: 'discoveryView',
            initialInput: 'db.orders.find()',
        });
    });
});
