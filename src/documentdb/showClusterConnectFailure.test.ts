/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { Links } from '../constants';
import { ErrorExplanationService } from '../services/errorExplanationService';
import { EntraDestinationRejectedError, evaluateEntraDestination } from './auth/oidcAllowedHosts';
import { showClusterConnectFailure } from './showClusterConnectFailure';

const { showErrorMessage, openExternal, update } = vi.hoisted(() => ({
    showErrorMessage: vi.fn<(...args: unknown[]) => Promise<string | undefined>>(),
    openExternal: vi.fn(),
    update: vi.fn(),
}));

vi.mock('vscode', () => ({
    window: { showErrorMessage },
    env: { openExternal },
    Uri: { parse: (value: string): string => value },
    workspace: { getConfiguration: (): object => ({ update }) },
}));

vi.mock('../services/errorExplanationService', () => ({
    ErrorExplanationService: { explain: vi.fn() },
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

    it.each(['Learn More', undefined])(
        'shows safe destination details and never writes settings when choosing %s',
        async (choice): Promise<void> => {
            showErrorMessage.mockResolvedValue(choice);
            const error = new EntraDestinationRejectedError(
                evaluateEntraDestination(
                    'mongodb://user:password@first.example.com:27017,second.example.com/?secret=value',
                ),
            );
            error.message = 'mongodb://user:password@first.example.com/?secret=value';
            const context = createMockContext();

            await showClusterConnectFailure({
                clusterId: 'stable-id',
                clusterName: 'Test Cluster',
                error,
                context,
                extraDetail: 'sensitive hint',
                buttons: ['Token anyway'],
            });

            expect(showErrorMessage).toHaveBeenCalledExactlyOnceWith(
                "Microsoft Entra ID isn't allowed for this server.",
                {
                    modal: true,
                    detail: 'Microsoft Entra ID is available only for Azure DocumentDB\nor servers allowed by the trusted-server setting.\nServer: first.example.com and 1 more',
                },
                'Learn More',
            );
            const detail = (showErrorMessage.mock.calls[0][1] as { detail: string }).detail;
            expect(detail.split('\n').length).toBeLessThanOrEqual(4);
            expect(detail).not.toMatch(/mongodb|user:|password|27017|secret|second.example|sensitive/);
            expect(update).not.toHaveBeenCalled();
            expect(ErrorExplanationService.explain).not.toHaveBeenCalled();
            if (choice) {
                expect(openExternal).toHaveBeenCalledExactlyOnceWith(Links.EntraTrustedServers);
            } else {
                expect(openExternal).not.toHaveBeenCalled();
            }
        },
    );

    it('does not append a host count for a single rejected server', async (): Promise<void> => {
        const error = new EntraDestinationRejectedError({ firstHost: 'single.example.com:27017', hostCount: 1 });
        await showClusterConnectFailure({
            clusterId: 'stable-id',
            clusterName: 'Test',
            error,
            context: createMockContext(),
        });
        expect(showErrorMessage).toHaveBeenCalledWith(
            "Microsoft Entra ID isn't allowed for this server.",
            { modal: true, detail: expect.stringContaining('\nServer: single.example.com') },
            'Learn More',
        );
        expect(JSON.stringify(showErrorMessage.mock.calls)).not.toContain('more');
    });

    it('shows the diagnosis with raw error detail and records its provider', async () => {
        const context = createMockContext();
        const error = new Error('raw driver error');
        vi.mocked(ErrorExplanationService.explain).mockResolvedValue({
            providerId: 'test-provider',
            message: 'Infrastructure explanation',
        });

        await showClusterConnectFailure({ clusterId: 'stable-id', clusterName: 'Test Cluster', error, context });

        expect(ErrorExplanationService.explain).toHaveBeenCalledWith({ clusterId: 'stable-id', error });
        expect(vi.mocked(ErrorExplanationService.explain).mock.calls[0][0].error).toBe(error);
        expect(showErrorMessage).toHaveBeenCalledWith('Infrastructure explanation', {
            modal: true,
            detail: 'raw driver error',
        });
        expect(context.telemetry.properties.diagnosisProviderId).toBe('test-provider');
        expect(error.message).toBe('raw driver error');
    });

    it('keeps the generic fallback when there is no diagnosis', async () => {
        const context = createMockContext();
        vi.mocked(ErrorExplanationService.explain).mockResolvedValue(undefined);

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
        vi.mocked(ErrorExplanationService.explain).mockResolvedValue(undefined);

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
        vi.mocked(ErrorExplanationService.explain).mockResolvedValue(undefined);

        await showClusterConnectFailure({
            clusterId: 'stable-id',
            clusterName: 'Test Cluster',
            error: 'string failure',
            context,
        });

        expect(ErrorExplanationService.explain).toHaveBeenCalledWith({
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
        vi.mocked(ErrorExplanationService.explain).mockResolvedValue(
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
        vi.mocked(ErrorExplanationService.explain).mockResolvedValue(undefined);
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
        vi.mocked(ErrorExplanationService.explain).mockImplementation(
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
