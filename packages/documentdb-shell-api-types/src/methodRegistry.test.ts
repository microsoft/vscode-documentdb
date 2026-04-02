/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getMethodsByTarget, getRequiredServerCommands, SHELL_API_METHODS } from './methodRegistry';

describe('methodRegistry', () => {
    it('should have methods for all target types', () => {
        expect(getMethodsByTarget('database').length).toBeGreaterThan(0);
        expect(getMethodsByTarget('collection').length).toBeGreaterThan(0);
        expect(getMethodsByTarget('findCursor').length).toBeGreaterThan(0);
        expect(getMethodsByTarget('aggregationCursor').length).toBeGreaterThan(0);
        expect(getMethodsByTarget('global').length).toBeGreaterThan(0);
    });

    it('should have unique method names within each target', () => {
        const targets = ['database', 'collection', 'findCursor', 'aggregationCursor', 'global'] as const;
        for (const target of targets) {
            const methods = getMethodsByTarget(target);
            const names = methods.map((m) => m.name);
            const unique = new Set(names);
            expect(unique.size).toBe(names.length);
        }
    });

    it('should have non-empty server commands for non-shell-only methods', () => {
        for (const method of SHELL_API_METHODS) {
            if (!method.shellOnly) {
                expect(method.serverCommands.length).toBeGreaterThan(0);
            }
        }
    });

    it('should have empty server commands for shell-only methods', () => {
        for (const method of SHELL_API_METHODS) {
            if (method.shellOnly) {
                expect(method.serverCommands).toHaveLength(0);
            }
        }
    });

    it('should return required server commands sorted and deduplicated', () => {
        const commands = getRequiredServerCommands();
        expect(commands.length).toBeGreaterThan(0);

        // Should be sorted
        const sorted = [...commands].sort();
        expect(commands).toEqual(sorted);

        // Should be unique
        const unique = new Set(commands);
        expect(unique.size).toBe(commands.length);
    });

    it('should include expected high-level commands', () => {
        const commands = getRequiredServerCommands();
        expect(commands).toContain('find');
        expect(commands).toContain('insert');
        expect(commands).toContain('update');
        expect(commands).toContain('delete');
        expect(commands).toContain('aggregate');
        expect(commands).toContain('createIndexes');
    });
});
