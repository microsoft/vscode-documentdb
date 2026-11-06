/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ConnectionDiagnosticsService } from '../services/connectionDiagnosticsService';
import { showClusterConnectFailure } from './showClusterConnectFailure';

const { showErrorMessage } = vi.hoisted(() => ({
    showErrorMessage: vi.fn<(...args: unknown[]) => Promise<string | undefined>>(),
}));

vi.mock('vscode', () => ({
    window: { showErrorMessage },
}));

vi.mock('../services/connectionDiagnosticsService', () => ({
    ConnectionDiagnosticsService: { explain: vi.fn() },
}));

function createMockContext(): IActionContext {
    return {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        ui: {} as IActionContext['ui'],
        valuesToMask: [],
    } as unknown as IActionContext;
}

describe('showClusterConnectFailure', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('shows the diagnosis with raw error detail and records its provider', async () => {
        const context = createMockContext();
        const error = new Error('raw driver error');
        vi.mocked(ConnectionDiagnosticsService.explain).mockResolvedValue({
            providerId: 'test-provider',
            message: 'Infrastructure explanation',
        });

        await showClusterConnectFailure({ clusterId: 'stable-id', clusterName: 'Test Cluster', error, context });

        expect(ConnectionDiagnosticsService.explain).toHaveBeenCalledWith({ clusterId: 'stable-id', error });
        expect(vi.mocked(ConnectionDiagnosticsService.explain).mock.calls[0][0].error).toBe(error);
        expect(showErrorMessage).toHaveBeenCalledWith('Infrastructure explanation', {
            modal: true,
            detail: 'raw driver error',
        });
        expect(context.telemetry.properties.diagnosisProviderId).toBe('test-provider');
        expect(error.message).toBe('raw driver error');
    });

    it('keeps the generic fallback when there is no diagnosis', async () => {
        const context = createMockContext();
        vi.mocked(ConnectionDiagnosticsService.explain).mockResolvedValue(undefined);

        await showClusterConnectFailure({
            clusterId: 'stable-id',
            clusterName: 'Test Cluster',
            error: new Error('raw driver error'),
            context,
        });

        expect(showErrorMessage).toHaveBeenCalledWith('Failed to connect to "Test Cluster"', {
            modal: true,
            detail: 'Revisit connection details and try again.\n\nError: raw driver error',
        });
        expect(context.telemetry.properties.diagnosisProviderId).toBe('none');
    });

    it('uses the supplied fallback heading when there is no diagnosis', async () => {
        const context = createMockContext();
        vi.mocked(ConnectionDiagnosticsService.explain).mockResolvedValue(undefined);

        await showClusterConnectFailure({
            clusterId: 'stable-id',
            clusterName: 'Test Cluster',
            fallbackHeading: 'Failed to connect to VM "Test Cluster"',
            error: new Error('raw driver error'),
            context,
        });

        expect(showErrorMessage).toHaveBeenCalledWith('Failed to connect to VM "Test Cluster"', {
            modal: true,
            detail: 'Revisit connection details and try again.\n\nError: raw driver error',
        });
    });

    it('stringifies non-Error failures without changing the diagnostics input', async () => {
        const context = createMockContext();
        vi.mocked(ConnectionDiagnosticsService.explain).mockResolvedValue(undefined);

        await showClusterConnectFailure({
            clusterId: 'stable-id',
            clusterName: 'Test Cluster',
            error: 'string failure',
            context,
        });

        expect(ConnectionDiagnosticsService.explain).toHaveBeenCalledWith({
            clusterId: 'stable-id',
            error: 'string failure',
        });
        expect(showErrorMessage).toHaveBeenCalledWith('Failed to connect to "Test Cluster"', {
            modal: true,
            detail: 'Revisit connection details and try again.\n\nError: string failure',
        });
    });

    it.each([true, false])('appends extra detail when a diagnosis is present: %s', async (hasDiagnosis) => {
        const context = createMockContext();
        vi.mocked(ConnectionDiagnosticsService.explain).mockResolvedValue(
            hasDiagnosis ? { providerId: 'test-provider', message: 'Infrastructure explanation' } : undefined,
        );

        await showClusterConnectFailure({
            clusterId: 'stable-id',
            clusterName: 'Test Cluster',
            error: new Error('raw driver error'),
            context,
            extraDetail: 'Password hint',
        });

        expect(showErrorMessage).toHaveBeenCalledWith(expect.any(String), {
            modal: true,
            detail:
                (hasDiagnosis
                    ? 'raw driver error'
                    : 'Revisit connection details and try again.\n\nError: raw driver error') + '\n\nPassword hint',
        });
    });

    it('forwards extra buttons and returns the selected button', async () => {
        const context = createMockContext();
        vi.mocked(ConnectionDiagnosticsService.explain).mockResolvedValue(undefined);
        showErrorMessage.mockResolvedValue('Retry');

        const selected = await showClusterConnectFailure({
            clusterId: 'stable-id',
            clusterName: 'Test Cluster',
            error: new Error('raw driver error'),
            context,
            buttons: ['Retry', 'Other'],
        });

        expect(showErrorMessage).toHaveBeenCalledWith(
            'Failed to connect to "Test Cluster"',
            { modal: true, detail: 'Revisit connection details and try again.\n\nError: raw driver error' },
            'Retry',
            'Other',
        );
        expect(selected).toBe('Retry');
    });

    it('waits for diagnostics before showing the modal', async () => {
        const context = createMockContext();
        let finishDiagnosis: (() => void) | undefined;
        vi.mocked(ConnectionDiagnosticsService.explain).mockImplementation(
            () =>
                new Promise((resolve) => {
                    finishDiagnosis = (): void => resolve(undefined);
                }),
        );

        const pending = showClusterConnectFailure({
            clusterId: 'stable-id',
            clusterName: 'Test Cluster',
            error: new Error('raw driver error'),
            context,
        });

        expect(showErrorMessage).not.toHaveBeenCalled();
        finishDiagnosis?.();
        await expect(pending).resolves.toBeUndefined();
        expect(showErrorMessage).toHaveBeenCalledOnce();
    });
});
