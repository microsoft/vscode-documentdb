/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { PlaygroundCodeLensProvider } from './PlaygroundCodeLensProvider';
import { PlaygroundService } from './PlaygroundService';
import { PlaygroundCommandIds } from './constants';

/**
 * Helper to create a mock TextDocument from a multiline string.
 */
function mockDocument(text: string): vscode.TextDocument {
    const lines = text.split('\n');
    return {
        lineCount: lines.length,
        lineAt(lineNumber: number) {
            return { text: lines[lineNumber] ?? '' };
        },
        getText() {
            return text;
        },
    } as unknown as vscode.TextDocument;
}

describe('PlaygroundCodeLensProvider', () => {
    let provider: PlaygroundCodeLensProvider;
    let service: PlaygroundService;

    beforeEach(() => {
        service = PlaygroundService.getInstance();
        provider = new PlaygroundCodeLensProvider();
    });

    afterEach(() => {
        provider.dispose();
        service.dispose();
    });

    it('provides connection status lens at line 0 when disconnected', () => {
        const doc = mockDocument('db.test.find({})');
        const lenses = provider.provideCodeLenses(doc);

        // First lens should be connection status
        const connectionLens = lenses[0];
        expect(connectionLens.command?.command).toBe(PlaygroundCommandIds.connect);
        expect(connectionLens.command?.title).toContain('Connect to a database');
        expect(connectionLens.range.start.line).toBe(0);
    });

    it('provides connection status lens showing cluster name when connected', () => {
        service.setConnection({
            clusterId: 'test-id',
            clusterDisplayName: 'MyCluster',
            databaseName: 'orders',
        });

        const doc = mockDocument('db.test.find({})');
        const lenses = provider.provideCodeLenses(doc);

        const connectionLens = lenses[0];
        expect(connectionLens.command?.title).toContain('MyCluster / orders');
    });

    it('provides Run All lens at line 0', () => {
        const doc = mockDocument('db.test.find({})');
        const lenses = provider.provideCodeLenses(doc);

        const runAllLens = lenses[1];
        expect(runAllLens.command?.command).toBe(PlaygroundCommandIds.runAll);
        expect(runAllLens.command?.title).toContain('Run All');
        expect(runAllLens.range.start.line).toBe(0);
    });

    it('provides only top-level lenses when no active editor (per-block lens follows cursor)', () => {
        const doc = mockDocument('db.users.find({});\n\ndb.orders.find({});');
        const lenses = provider.provideCodeLenses(doc);

        // Only 2 top lenses (connection + Run All) — per-block lens requires active editor
        expect(lenses.length).toBe(2);
    });

    it('shows running state when executing', () => {
        service.setExecuting(true);
        const doc = mockDocument('db.test.find({})');
        const lenses = provider.provideCodeLenses(doc);

        const runAllLens = lenses[1];
        expect(runAllLens.command?.title).toContain('Running');
    });
});
