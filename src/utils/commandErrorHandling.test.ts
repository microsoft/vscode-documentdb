/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    createTestActionContext,
    registerCommand,
    UserCancelledError,
    type IActionContext,
    type TreeNodeCommandCallback,
} from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { rethrowBoundCommandUnavailable } from '../commands/rethrowBoundCommandUnavailable';
import { ConnectionUnavailableError } from '../documentdb/ConnectionUnavailableError';
import { ErrorExplanationService } from '../services/errorExplanationService';
import {
    markCommandErrorPresented,
    registerCommandWithTreeNodeUnwrappingAndDiagnostics,
    UserFacingError,
} from './commandErrorHandling';

vi.mock('@microsoft/vscode-azext-utils', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, registerCommand: vi.fn() };
});

vi.mock('vscode', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown> & { default: Record<string, unknown> }>();
    // The shared VS Code mock omits this constructor, which the real parseError uses.
    class CancellationError extends Error {}
    actual.default.CancellationError = CancellationError;
    return { ...actual, CancellationError };
});

vi.mock('../services/errorExplanationService', () => ({
    ErrorExplanationService: { explain: vi.fn() },
}));

interface TestNode {
    readonly id: string;
    readonly cluster?: { readonly clusterId: string };
}

const node: TestNode = { id: 'folder/tree-node', cluster: { clusterId: 'stable-cluster' } };
const explanation = { providerId: 'test-provider', message: 'Check the connection infrastructure.' };

function registerHandler(
    handler: TreeNodeCommandCallback<TestNode>,
): (context: IActionContext, ...args: unknown[]) => unknown {
    registerCommandWithTreeNodeUnwrappingAndDiagnostics('test.databaseAction', handler);
    const callback = vi.mocked(registerCommand).mock.calls.at(-1)?.[1];
    if (!callback) {
        throw new Error('Command was not registered.');
    }
    return callback;
}

describe('tree command failure feedback', () => {
    let context: IActionContext;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.mocked(ErrorExplanationService.explain).mockResolvedValue(undefined);
        vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(undefined);
        context = await createTestActionContext();
        context.errorHandling.suppressDisplay = false;
        context.errorHandling.rethrow = true;
    });

    it('passes unwrapped tree selections to the handler and preserves successful results', async () => {
        const result = { completed: true };
        const handler = vi.fn(() => result);
        const command = registerHandler(handler);

        await expect(command(context, { unwrap: () => node }, [{ unwrap: () => node }])).resolves.toBe(result);

        expect(handler).toHaveBeenCalledExactlyOnceWith(context, node, [node]);
        expect(ErrorExplanationService.explain).not.toHaveBeenCalled();
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        expect(context.errorHandling.suppressDisplay).toBe(false);
    });

    it('shows one translated tree modal with separate detail and rethrows the original error', async () => {
        const cause = Object.freeze(new Error('Original cause'));
        const error: Error = Object.freeze(new Error('Driver failure', { cause }));
        const handler = vi.fn(() => {
            throw error;
        });
        const command = registerHandler(handler);
        vi.mocked(ErrorExplanationService.explain).mockResolvedValue(explanation);

        await expect(command(context, { unwrap: () => node }, [{ unwrap: () => node }])).rejects.toBe(error);

        expect(handler).toHaveBeenCalledExactlyOnceWith(context, node, [node]);
        expect(ErrorExplanationService.explain).toHaveBeenCalledExactlyOnceWith({
            clusterId: node.cluster?.clusterId,
            error,
        });
        expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith(explanation.message, {
            modal: true,
            detail: 'Driver failure',
        });
        expect(context.telemetry.properties.explanationProviderId).toBe(explanation.providerId);
        expect(context.errorHandling.suppressDisplay).toBe(true);
        expect(context.errorHandling.rethrow).toBe(true);
        expect(error.cause).toBe(cause);
    });

    it.each([new Error('Presented failure'), 'Presented primitive failure'])(
        'does not duplicate feedback marked for the same error: %#',
        async (error) => {
            const rejectFailure = vi.fn<() => Promise<never>>().mockRejectedValue(error);
            const command = registerHandler(async (actionContext) => {
                actionContext.errorHandling.suppressDisplay = true;
                await vscode.window.showErrorMessage('Callback feedback.', { modal: true });
                markCommandErrorPresented(actionContext, error);
                return rejectFailure();
            });
            vi.mocked(ErrorExplanationService.explain).mockResolvedValue(explanation);

            await expect(command(context, node, [node])).rejects.toBe(error);

            expect(ErrorExplanationService.explain).toHaveBeenCalledExactlyOnceWith({
                clusterId: node.cluster?.clusterId,
                error,
            });
            expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith('Callback feedback.', {
                modal: true,
            });
            expect(context.telemetry.properties.explanationProviderId).toBe(explanation.providerId);
            expect(context.errorHandling.suppressDisplay).toBe(true);
            expect(context.errorHandling.rethrow).toBe(true);
        },
    );

    it('does not treat suppressDisplay without a presentation marker as feedback ownership', async () => {
        const error = new ConnectionUnavailableError('identityChanged');
        const command = registerHandler((actionContext) => {
            rethrowBoundCommandUnavailable(actionContext, error);
        });

        await expect(command(context, node, [node])).rejects.toBe(error);

        expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith('Unable to complete this tree action.', {
            modal: true,
            detail: error.message,
        });
        expect(context.errorHandling.suppressDisplay).toBe(true);
    });

    it('shows a different error thrown during cleanup after the original error was presented', async () => {
        const original = new Error('Original failure');
        const cleanup = new Error('Cleanup failure');
        const failCleanup = (): never => {
            throw cleanup;
        };
        const command = registerHandler(async (actionContext) => {
            try {
                throw original;
            } catch (error) {
                await vscode.window.showErrorMessage('Original callback feedback.', { modal: true });
                markCommandErrorPresented(actionContext, error);
                throw error;
            } finally {
                failCleanup();
            }
        });

        await expect(command(context, node, [node])).rejects.toBe(cleanup);

        expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(2);
        expect(vscode.window.showErrorMessage).toHaveBeenNthCalledWith(2, 'Unable to complete this tree action.', {
            modal: true,
            detail: cleanup.message,
        });
        expect(ErrorExplanationService.explain).toHaveBeenCalledExactlyOnceWith({
            clusterId: node.cluster?.clusterId,
            error: cleanup,
        });
    });

    it.each([
        { error: new Error('Driver failure'), detail: 'Driver failure' },
        { error: { error: { message: 'Structured driver failure' } }, detail: 'Structured driver failure' },
    ])('shows one fallback tree modal with parsed detail: $detail', async ({ error, detail }) => {
        const command = registerHandler(vi.fn().mockRejectedValue(error));

        await expect(command(context, node, [node])).rejects.toBe(error);

        expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith('Unable to complete this tree action.', {
            modal: true,
            detail,
        });
        expect(vscode.l10n.t).toHaveBeenCalledWith('Unable to complete this tree action.');
        expect(context.errorHandling.suppressDisplay).toBe(true);
        expect(context.telemetry.properties.explanationProviderId).toBeUndefined();
    });

    it('preserves UserFacingError content and details in the tree modal without translating it', async () => {
        const cause = new Error('Underlying cause');
        const error = new UserFacingError('Repair the connection.', { cause, details: 'Existing detail.' });
        const command = registerHandler(() => {
            throw error;
        });

        await expect(command(context, node, [node])).rejects.toBe(error);

        expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith(error.message, {
            modal: true,
            detail: error.options.details,
        });
        expect(ErrorExplanationService.explain).not.toHaveBeenCalled();
        expect(context.errorHandling.suppressDisplay).toBe(true);
        expect(error.options.cause).toBe(cause);
    });

    it.each(['collectionView', 'clusterDashboard'])(
        'keeps explained %s failures non-modal and passes origin metadata through real unwrapping',
        async (view) => {
            const error = new Error('Driver failure');
            const metadata = { source: `webview;${view}`, binding: { clusterId: 'stable-cluster' } };
            const handler = vi.fn(() => {
                throw error;
            });
            const command = registerHandler(handler);
            vi.mocked(ErrorExplanationService.explain).mockResolvedValue(explanation);

            await expect(command(context, { unwrap: () => node }, null, metadata)).rejects.toBe(error);

            expect(handler).toHaveBeenCalledExactlyOnceWith(context, node, undefined, metadata);
            expect(ErrorExplanationService.explain).toHaveBeenCalledExactlyOnceWith({
                clusterId: node.cluster?.clusterId,
                error,
            });
            expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith(
                `${explanation.message} (${error.message})`,
            );
            expect(context.errorHandling.suppressDisplay).toBe(true);
            expect(context.telemetry.properties.explanationProviderId).toBe(explanation.providerId);
        },
    );

    it('keeps webview notification behavior for an error marked by its callback', async () => {
        const error = new Error('Driver failure');
        const command = registerHandler((actionContext) => {
            markCommandErrorPresented(actionContext, error);
            throw error;
        });
        vi.mocked(ErrorExplanationService.explain).mockResolvedValue(explanation);

        await expect(command(context, node, null, { source: 'webview;collectionView' })).rejects.toBe(error);

        expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith(
            `${explanation.message} (${error.message})`,
        );
        expect(context.errorHandling.suppressDisplay).toBe(true);
        expect(context.telemetry.properties.explanationProviderId).toBe(explanation.providerId);
    });

    it('keeps unexplained webview failures on the default notification path', async () => {
        const error = new Error('Driver failure');
        const command = registerHandler(() => {
            throw error;
        });

        await expect(command(context, node, null, { source: 'webview;collectionView' })).rejects.toBe(error);

        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        expect(context.errorHandling.suppressDisplay).toBe(false);
        expect(context.errorHandling.rethrow).toBe(true);
    });

    it('keeps webview UserFacingError content and actions on the default notification path', async () => {
        const error = new UserFacingError('Existing message.', { details: 'Existing detail.' });
        const buttons = [{ title: 'Existing action', callback: vi.fn(async (): Promise<void> => {}) }];
        context.errorHandling.buttons = buttons;
        const command = registerHandler(() => {
            throw error;
        });

        await expect(command(context, node, null, { source: 'webview;clusterDashboard' })).rejects.toBe(error);

        expect(ErrorExplanationService.explain).not.toHaveBeenCalled();
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        expect(context.errorHandling.suppressDisplay).toBe(false);
        expect(context.errorHandling.buttons).toBe(buttons);
        expect(error.message).toBe('Existing message.');
        expect(error.options.details).toBe('Existing detail.');
    });

    it.each([new Error('Unassociated failure'), new UserFacingError('Unassociated user-facing failure')])(
        'keeps failures with no associated cluster on the default path: $message',
        async (error) => {
            const command = registerHandler(() => {
                throw error;
            });

            await expect(command(context, { id: 'no-cluster' }, [])).rejects.toBe(error);

            expect(ErrorExplanationService.explain).not.toHaveBeenCalled();
            expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
            expect(context.errorHandling.suppressDisplay).toBe(false);
        },
    );

    it.each([
        { error: new UserCancelledError(), suppressDisplay: false },
        { error: new UserCancelledError(), suppressDisplay: true },
        {
            error: { _isUserCancelledError: true, message: 'Cancelled by another package copy.' },
            suppressDisplay: false,
        },
    ])('rethrows cancellation silently without changing suppression: %#', async ({ error, suppressDisplay }) => {
        context.errorHandling.suppressDisplay = suppressDisplay;
        vi.mocked(ErrorExplanationService.explain).mockResolvedValue(explanation);
        const command = registerHandler(vi.fn().mockRejectedValue(error));

        await expect(command(context, node, [node])).rejects.toBe(error);

        expect(ErrorExplanationService.explain).not.toHaveBeenCalled();
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        expect(context.errorHandling.suppressDisplay).toBe(suppressDisplay);
        expect(context.errorHandling.rethrow).toBe(true);
    });
});
