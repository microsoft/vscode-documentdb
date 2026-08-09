/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QuickStartDiagnosticsProvider } from './QuickStartDiagnosticsProvider';
import { QuickStartService } from './QuickStartService';
import { InstanceState, type InstanceStatus } from './quickStartTypes';

function status(clusterId: string, alias = 'default'): InstanceStatus {
    return {
        alias,
        displayName: 'DocumentDB Local',
        state: InstanceState.Running,
        missing: false,
        canResumeReadiness: false,
        metadata: { clusterId } as InstanceStatus['metadata'],
    };
}

describe('QuickStartDiagnosticsProvider', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('stays silent for a cluster it does not manage, without probing Docker', async () => {
        jest.spyOn(QuickStartService, 'listStatuses').mockReturnValue([status('quickstart-cluster')]);
        const preflight = jest.spyOn(QuickStartService, 'prepareForConnection');

        const result = await new QuickStartDiagnosticsProvider().explain({
            clusterId: 'some-other-cluster',
            error: new Error('boom'),
        });

        expect(result).toBeUndefined();
        expect(preflight).not.toHaveBeenCalled();
    });

    it.each([
        ['stopped', 'not appear to be running'],
        ['missing', 'cannot find the DocumentDB Local container'],
        ['foreign', 'not created by this extension'],
        ['unavailable', 'cannot reach DocumentDB Local'],
        ['dockerUnreachable', 'Docker does not appear to be running'],
    ] as const)('explains a %s container', async (verdict, expected) => {
        jest.spyOn(QuickStartService, 'listStatuses').mockReturnValue([status('quickstart-cluster')]);
        jest.spyOn(QuickStartService, 'prepareForConnection').mockResolvedValue(verdict);

        const result = await new QuickStartDiagnosticsProvider().explain({
            clusterId: 'quickstart-cluster',
            error: new Error('boom'),
        });

        expect(result).toContain(expected);
    });

    it.each(['ready', 'busy'] as const)('stays silent when the container is %s', async (verdict) => {
        jest.spyOn(QuickStartService, 'listStatuses').mockReturnValue([status('quickstart-cluster')]);
        jest.spyOn(QuickStartService, 'prepareForConnection').mockResolvedValue(verdict);

        await expect(
            new QuickStartDiagnosticsProvider().explain({
                clusterId: 'quickstart-cluster',
                error: new Error('boom'),
            }),
        ).resolves.toBeUndefined();
    });

    it('never lets prepareForConnection show its own warning', async () => {
        jest.spyOn(QuickStartService, 'listStatuses').mockReturnValue([status('quickstart-cluster')]);
        const preflight = jest.spyOn(QuickStartService, 'prepareForConnection').mockResolvedValue('foreign');

        await new QuickStartDiagnosticsProvider().explain({ clusterId: 'quickstart-cluster', error: new Error('x') });

        expect(preflight).toHaveBeenCalledWith('default', { silent: true });
    });

    it('re-checks on every failure so a container the user just started is reported as running', async () => {
        jest.spyOn(QuickStartService, 'listStatuses').mockReturnValue([status('quickstart-cluster')]);
        const preflight = jest
            .spyOn(QuickStartService, 'prepareForConnection')
            .mockResolvedValueOnce('stopped')
            .mockResolvedValueOnce('ready');
        const provider = new QuickStartDiagnosticsProvider();

        const first = await provider.explain({ clusterId: 'quickstart-cluster', error: new Error('boom') });
        const second = await provider.explain({ clusterId: 'quickstart-cluster', error: new Error('boom') });

        expect(first).toContain('not appear to be running');
        expect(second).toBeUndefined();
        expect(preflight).toHaveBeenCalledTimes(2);
    });
});
