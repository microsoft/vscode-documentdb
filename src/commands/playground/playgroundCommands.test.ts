/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as vscode from 'vscode';
import { PlaygroundService } from '../../documentdb/playground/PlaygroundService';
import { ShellCommandIds } from '../../documentdb/shell/constants';
import { settingsKeys } from '../../settingsKeys';
import { executePlaygroundCode } from './executePlaygroundCode';
import { playgroundOpenQueryInCollectionView } from './playgroundOpenInCollectionView';
import { playgroundOpenQueryInShell } from './playgroundOpenInShell';
import { runAll } from './runAll';
import { runSelected } from './runSelected';

vi.mock('./executePlaygroundCode', () => ({
    executePlaygroundCode: vi.fn(),
}));

function makeEditor(uri: vscode.Uri, text: string, line: number): vscode.TextEditor {
    const lines = text.split('\n');
    const document = {
        uri,
        languageId: 'documentdb-playground',
        lineCount: lines.length,
        lineAt(index: number) {
            return { text: lines[index] ?? '' };
        },
        getText(range?: vscode.Range) {
            if (!range) {
                return text;
            }
            const start =
                lines.slice(0, range.start.line).reduce((total, value) => total + value.length + 1, 0) +
                range.start.character;
            const end =
                lines.slice(0, range.end.line).reduce((total, value) => total + value.length + 1, 0) +
                range.end.character;
            return text.substring(start, end);
        },
    } as unknown as vscode.TextDocument;
    return {
        document,
        selection: { active: new vscode.Position(line, 0) },
    } as unknown as vscode.TextEditor;
}

function makeContext(): {
    telemetry: { properties: Record<string, string>; measurements: Record<string, number> };
} {
    return {
        telemetry: { properties: {}, measurements: {} },
    };
}

describe('playground commands', () => {
    let activeEditor: vscode.TextEditor | undefined;
    let visibleEditors: vscode.TextEditor[];
    let service: PlaygroundService;

    beforeEach(() => {
        visibleEditors = [];
        vi.spyOn(vscode.window, 'activeTextEditor', 'get').mockImplementation(() => activeEditor);
        vi.spyOn(vscode.window, 'visibleTextEditors', 'get').mockImplementation(() => visibleEditors);
        vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);
        vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);
        vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
        vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
            get: () => false,
        } as unknown as vscode.WorkspaceConfiguration);
        service = PlaygroundService.getInstance();
    });

    afterEach(() => {
        service.dispose();
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it('runs the cursor block without arguments and preserves cursor telemetry', async () => {
        const editor = makeEditor(vscode.Uri.file('/active.documentdb.js'), 'db.users.find({});\n\ndb.orders.find({});', 0);
        activeEditor = editor;
        visibleEditors = [editor];
        const context = makeContext();

        await runSelected(context as never);

        expect(executePlaygroundCode).toHaveBeenCalledWith('db.users.find({});', 'runSelected', editor.document.uri, {
            afterRun: 'stay',
        });
        expect(context.telemetry.properties).toMatchObject({
            activationSource: 'playgroundOther',
            selectionSource: 'cursor',
        });
        expect(context.telemetry.measurements.blockCount).toBe(2);
    });

    it('runs the preceding block from a blank line and preserves fallback telemetry', async () => {
        const editor = makeEditor(vscode.Uri.file('/active.documentdb.js'), 'db.users.find({});\n\ndb.orders.find({});', 1);
        activeEditor = editor;
        visibleEditors = [editor];
        const context = makeContext();

        await runSelected(context as never);

        expect(executePlaygroundCode).toHaveBeenCalledWith('db.users.find({});', 'runSelected', editor.document.uri, {
            afterRun: 'stay',
        });
        expect(context.telemetry.properties.selectionSource).toBe('fallback');
    });

    it('preserves explicit Run Block CodeLens ranges', async () => {
        const editor = makeEditor(vscode.Uri.file('/active.documentdb.js'), 'db.users.find({});\n\ndb.orders.find({});', 0);
        activeEditor = editor;
        visibleEditors = [editor];
        const context = makeContext();

        await runSelected(context as never, 2, 2);

        expect(executePlaygroundCode).toHaveBeenCalledWith(
            'db.orders.find({});',
            'runSelected',
            editor.document.uri,
            { afterRun: 'stay' },
        );
        expect(context.telemetry.properties).toMatchObject({
            activationSource: 'playgroundCodeLens',
            selectionSource: 'codeLens',
        });
    });

    it('targets an inactive editor group when an editor-menu URI is supplied', async () => {
        const active = makeEditor(vscode.Uri.file('/active.documentdb.js'), 'db.active.find({});', 0);
        const target = makeEditor(vscode.Uri.file('/target.documentdb.js'), 'db.target.find({});', 0);
        activeEditor = active;
        visibleEditors = [active, target];
        const context = makeContext();

        await runSelected(context as never, target.document.uri);

        expect(executePlaygroundCode).toHaveBeenCalledWith(
            'db.target.find({});',
            'runSelected',
            target.document.uri,
            { afterRun: 'stay' },
        );
        expect(context.telemetry.properties.activationSource).toBe('playgroundEditorMenu');
    });

    it('targets the clicked inactive playground when editor-title context is supplied', async () => {
        const active = makeEditor(vscode.Uri.file('/active.documentdb.js'), 'db.active.find({});', 0);
        const target = makeEditor(vscode.Uri.file('/target.documentdb.js'), 'db.target.find({});', 0);
        activeEditor = active;
        visibleEditors = [active, target];
        const context = makeContext();

        await runSelected(context as never, target.document.uri, { groupId: 2, editorIndex: 0 });

        expect(executePlaygroundCode).toHaveBeenCalledWith(
            'db.target.find({});',
            'runSelected',
            target.document.uri,
            { afterRun: 'stay' },
        );
        expect(context.telemetry.properties.activationSource).toBe('playgroundEditorMenu');
    });

    it('opens the no-argument current block in Shell using the visible editor connection', async () => {
        const editor = makeEditor(vscode.Uri.file('/active.documentdb.js'), '// heading\n\ndb.users.find({});', 2);
        activeEditor = editor;
        visibleEditors = [editor];
        service.setConnection(editor.document.uri, {
            clusterId: 'cluster',
            clusterDisplayName: 'Cluster',
            databaseName: 'database',
        });
        const context = makeContext();

        await playgroundOpenQueryInShell(context as never);

        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            ShellCommandIds.openWithInput,
            expect.objectContaining({ initialInput: 'db.users.find({});' }),
        );
        expect(context.telemetry.properties.activationSource).toBe('playgroundOther');
    });

    it('preserves explicit Open CodeLens ranges and targets their editor', async () => {
        const active = makeEditor(vscode.Uri.file('/active.documentdb.js'), 'db.active.find({});', 0);
        const target = makeEditor(
            vscode.Uri.file('/target.documentdb.js'),
            'db.target.find({});\n\ndb.orders.find({});',
            0,
        );
        activeEditor = active;
        visibleEditors = [active, target];
        service.setConnection(target.document.uri, {
            clusterId: 'cluster',
            clusterDisplayName: 'Cluster',
            databaseName: 'database',
        });
        const context = makeContext();

        await playgroundOpenQueryInShell(context as never, target.document.uri, 2, 2);

        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            ShellCommandIds.openWithInput,
            expect.objectContaining({ initialInput: 'db.orders.find({});' }),
        );
        expect(context.telemetry.properties.activationSource).toBe('playgroundCodeLens');
    });

    it('opens the no-argument current block in Collection View', async () => {
        const editor = makeEditor(vscode.Uri.file('/active.documentdb.js'), 'db.users.find({ active: true });', 0);
        activeEditor = editor;
        visibleEditors = [editor];
        service.setConnection(editor.document.uri, {
            clusterId: 'cluster',
            clusterDisplayName: 'Cluster',
            databaseName: 'database',
        });
        const context = makeContext();

        await playgroundOpenQueryInCollectionView(context as never);

        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            'vscode-documentdb.command.internal.containerView.open',
            expect.objectContaining({
                collectionName: 'users',
                databaseName: 'database',
            }),
        );
    });

    it('attributes the explicit Run All CodeLens marker once', async () => {
        const editor = makeEditor(vscode.Uri.file('/active.documentdb.js'), 'db.users.find({});', 0);
        activeEditor = editor;
        visibleEditors = [editor];
        const context = makeContext();

        await runAll(context as never, { activationSource: 'playgroundCodeLens' });

        expect(context.telemetry.properties.activationSource).toBe('playgroundCodeLens');
        expect(executePlaygroundCode).toHaveBeenCalledWith(
            'db.users.find({});',
            'runAll',
            editor.document.uri,
            { afterRun: 'stay' },
        );
    });

    describe.each([
        ['Run All', runAll, 'runAll'],
        ['Run Block', runSelected, 'runSelected'],
    ] as const)('%s after-run behavior', (_label, command, runMode) => {
        it.each([
            ['auto', false, 'stay'],
            ['auto', true, 'focusResult'],
            ['stay', true, 'stay'],
            ['focusResult', false, 'focusResult'],
            ['notify', true, 'notify'],
        ] as const)('resolves %s with screenReaderMode=%s at invocation', async (setting, screenReaderMode, afterRun) => {
            const editor = makeEditor(vscode.Uri.file('/active.documentdb.js'), 'db.users.find({});', 0);
            activeEditor = editor;
            visibleEditors = [editor];
            vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
                get: (key: string): unknown => key === settingsKeys.playgroundAfterRun ? setting : false,
            } as vscode.WorkspaceConfiguration);
            const context = makeContext();

            await command(context as never, ...(screenReaderMode ? [{ screenReaderMode: true }] : []));

            expect(executePlaygroundCode).toHaveBeenCalledWith(
                'db.users.find({});', runMode, editor.document.uri, { afterRun },
            );
            expect(context.telemetry.properties).toMatchObject({
                afterRun,
                screenReaderMode: screenReaderMode ? 'true' : 'false',
                activationSource: screenReaderMode ? 'playgroundScreenReaderKeybinding' : 'playgroundOther',
            });
        });

        it.each(['stay', 'focusResult', 'notify'] as const)('applies explicit %s to CodeLens and menu invocation', async (afterRun) => {
            const editor = makeEditor(vscode.Uri.file('/active.documentdb.js'), 'db.users.find({});', 0);
            activeEditor = editor;
            visibleEditors = [editor];
            vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
                get: (key: string): unknown => key === settingsKeys.playgroundAfterRun ? afterRun : false,
            } as vscode.WorkspaceConfiguration);
            const args = runMode === 'runAll' ? [{ activationSource: 'playgroundCodeLens' }] : [0, 0];

            await command(makeContext() as never, ...args);
            await command(makeContext() as never, editor.document.uri);

            expect(executePlaygroundCode).toHaveBeenCalledTimes(2);
            expect(executePlaygroundCode).toHaveBeenNthCalledWith(
                1, 'db.users.find({});', runMode, editor.document.uri, { afterRun },
            );
            expect(executePlaygroundCode).toHaveBeenNthCalledWith(
                2, 'db.users.find({});', runMode, editor.document.uri, { afterRun },
            );
        });
    });
});
