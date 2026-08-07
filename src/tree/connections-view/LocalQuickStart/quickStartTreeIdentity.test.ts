/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QuickStartService } from '../../../services/localQuickStart/QuickStartService';
import { InstanceState, type QuickStartStatus } from '../../../services/localQuickStart/quickStartTypes';
import {
    buildQuickStartInstanceTreeId,
    buildQuickStartTreeId,
    isQuickStartClusterId,
    resolveQuickStartClusterTreeId,
} from './quickStartTreeIdentity';

describe('Quick Start tree identity', () => {
    afterEach(() => jest.restoreAllMocks());

    it('builds the managed tree hierarchy from its parent view', () => {
        expect(buildQuickStartTreeId()).toBe('connectionsView/localQuickStart');
        expect(buildQuickStartInstanceTreeId()).toBe('connectionsView/localQuickStart/instance');
        expect(buildQuickStartInstanceTreeId('customView')).toBe('customView/localQuickStart/instance');
    });

    it('claims only the exact stable ID of the supported managed instance', () => {
        expect(isQuickStartClusterId('quickstart-vscode-documentdb-local')).toBe(true);
        expect(isQuickStartClusterId('quickstart-similar-name')).toBe(false);
        expect(isQuickStartClusterId('stored-connection-id')).toBe(false);
    });

    it('resolves the active managed instance by exact stable cluster ID', () => {
        jest.spyOn(QuickStartService, 'getStatus').mockReturnValue({
            state: InstanceState.Running,
            metadata: {
                containerId: 'container-1',
                alias: 'vscode-documentdb-local',
                boundPort: 10260,
                clusterId: 'quickstart-vscode-documentdb-local',
                connectionString: 'mongodb://user:password@localhost:10260/',
                username: 'user',
            },
            missing: false,
            canResumeReadiness: false,
        } as QuickStartStatus);

        expect(resolveQuickStartClusterTreeId('quickstart-vscode-documentdb-local')).toBe(
            'connectionsView/localQuickStart/instance',
        );
        expect(resolveQuickStartClusterTreeId('quickstart-similar-name')).toBeUndefined();
    });

    it('does not resolve when there is no managed instance metadata', () => {
        jest.spyOn(QuickStartService, 'getStatus').mockReturnValue({
            state: InstanceState.NotInstalled,
            metadata: undefined,
            missing: false,
            canResumeReadiness: false,
        } as QuickStartStatus);

        expect(resolveQuickStartClusterTreeId('quickstart-vscode-documentdb-local')).toBeUndefined();
    });
});
