/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { settingsKeys } from '../../settingsKeys';
import { evaluateEntraDestinationFromSettings, getEntraCustomHostnameSuffix } from './entraDestinationSettings';

describe('Entra destination settings', () => {
    afterEach(() => vi.restoreAllMocks());

    it('reads the existing machine setting without accepting workspace trust', () => {
        const inspect = vi.fn().mockReturnValue({
            globalValue: { hostnameSuffix: '.database.example.com' },
            workspaceValue: { hostnameSuffix: '.evil.example' },
            workspaceFolderValue: { hostnameSuffix: '.evil.example' },
        });
        vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
            inspect,
        } as unknown as vscode.WorkspaceConfiguration);
        expect(getEntraCustomHostnameSuffix()).toBe('.database.example.com');
        expect(inspect).toHaveBeenCalledWith(settingsKeys.customEnvironment);
        expect(evaluateEntraDestinationFromSettings('mongodb://node.database.example.com/').allowed).toBe(true);
        expect(evaluateEntraDestinationFromSettings('mongodb://node.evil.example/').allowed).toBe(false);
    });

    it('uses the default only when there is no machine value', () => {
        vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
            inspect: vi.fn().mockReturnValue({
                defaultValue: { hostnameSuffix: 'database.example.com' },
                workspaceValue: { hostnameSuffix: 'evil.example' },
            }),
        } as unknown as vscode.WorkspaceConfiguration);
        expect(getEntraCustomHostnameSuffix()).toBe('database.example.com');
    });

    it.each([
        undefined,
        null,
        '',
        'database.example.com',
        [],
        {},
        { hostnameSuffix: 1 },
        { hostnameSuffix: ['example.com'] },
    ])('fails closed for missing or malformed machine setting %s', (value) => {
        vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
            inspect: vi.fn().mockReturnValue({
                globalValue: value,
                workspaceValue: { hostnameSuffix: 'evil.example' },
            }),
        } as unknown as vscode.WorkspaceConfiguration);
        expect(evaluateEntraDestinationFromSettings('mongodb://node.evil.example/').allowed).toBe(false);
        expect(evaluateEntraDestinationFromSettings('mongodb://node.mongocluster.cosmos.azure.com/').allowed).toBe(
            true,
        );
    });

    it('reads current policy on each call, without caching trust', () => {
        const inspect = vi
            .fn()
            .mockReturnValueOnce({ globalValue: { hostnameSuffix: 'database.example.com' } })
            .mockReturnValueOnce({ globalValue: { hostnameSuffix: '' } });
        vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
            inspect,
        } as unknown as vscode.WorkspaceConfiguration);
        expect(evaluateEntraDestinationFromSettings('mongodb://node.database.example.com/').allowed).toBe(true);
        expect(evaluateEntraDestinationFromSettings('mongodb://node.database.example.com/').allowed).toBe(false);
    });
});
