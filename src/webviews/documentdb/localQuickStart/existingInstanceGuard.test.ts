/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstanceState } from '../../../services/localQuickStart/quickStartTypes';
import { getExistingInstanceGuard, guardBlocksSetup, type GuardInput } from './existingInstanceGuard';

const status = (state: InstanceState, missing = false): GuardInput => ({ state, missing });

describe('getExistingInstanceGuard', () => {
    it('blocks setup for a running instance and offers to open it', () => {
        expect(getExistingInstanceGuard(status(InstanceState.Running))).toBe('healthy');
        expect(guardBlocksSetup('healthy')).toBe(true);
    });

    it('blocks setup for a stopped instance and offers to start it', () => {
        expect(getExistingInstanceGuard(status(InstanceState.Stopped))).toBe('stopped');
        expect(guardBlocksSetup('stopped')).toBe(true);
    });

    // The regression: a container removed outside VS Code is reported as Stopped WITH `missing`,
    // not as a state of its own. Reading only the state offered a "Start" button for a container
    // that no longer existed, so pressing it did nothing at all.
    it('does NOT offer to start a container that was removed outside VS Code', () => {
        expect(getExistingInstanceGuard(status(InstanceState.Stopped, /* missing */ true))).toBeUndefined();
    });

    it('does not guard a missing instance even if it was last seen running', () => {
        expect(getExistingInstanceGuard(status(InstanceState.Running, /* missing */ true))).toBeUndefined();
    });

    it('allows a warned setup when the credentials are gone, whatever the container state', () => {
        expect(getExistingInstanceGuard(status(InstanceState.CredentialsMissing))).toBe('credentialsMissing');
        expect(getExistingInstanceGuard(status(InstanceState.CredentialsMissing, /* missing */ true))).toBe(
            'credentialsMissing',
        );
        // Setup must stay available: erasing is the only way out of this state.
        expect(guardBlocksSetup('credentialsMissing')).toBe(false);
    });

    it('does not guard a machine with no instance', () => {
        expect(getExistingInstanceGuard(status(InstanceState.NotInstalled))).toBeUndefined();
        expect(getExistingInstanceGuard({ state: undefined })).toBeUndefined();
        expect(guardBlocksSetup(undefined)).toBe(false);
    });

    it('does not guard while a provision is in flight', () => {
        expect(getExistingInstanceGuard(status(InstanceState.Provisioning))).toBeUndefined();
    });
});
